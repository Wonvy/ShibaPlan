use base64::Engine;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn resolve_data_dir(custom_dir: Option<String>) -> PathBuf {
    if let Some(dir) = custom_dir {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::document_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ShibaPlan")
}

#[tauri::command]
fn get_default_data_dir() -> String {
    resolve_data_dir(None).to_string_lossy().to_string()
}

#[tauri::command]
fn load_workspace_data(custom_dir: Option<String>) -> Result<Option<String>, String> {
    let dir = resolve_data_dir(custom_dir);
    let file_path = dir.join("shibaplan-data.json");
    if !file_path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&file_path)
        .map(Some)
        .map_err(|e| format!("读取数据失败: {}", e))
}

#[tauri::command]
fn save_workspace_data(
    app: AppHandle,
    data_json: String,
    custom_dir: Option<String>,
) -> Result<String, String> {
    let dir = resolve_data_dir(custom_dir);
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    let file_path = dir.join("shibaplan-data.json");
    fs::write(&file_path, &data_json).map_err(|e| format!("保存数据失败: {}", e))?;
    let _ = app.emit("workspace-updated", &data_json);
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn save_pasted_image(
    base64_data: String,
    ext: String,
    custom_dir: Option<String>,
) -> Result<String, String> {
    let dir = resolve_data_dir(custom_dir).join("assets");
    fs::create_dir_all(&dir).map_err(|e| format!("创建图片目录失败: {}", e))?;

    let clean_b64 = base64_data
        .split(',')
        .last()
        .unwrap_or(&base64_data)
        .trim();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(clean_b64)
        .map_err(|e| format!("解析图片失败: {}", e))?;

    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f");
    let safe_ext = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    let final_ext = if safe_ext.is_empty() {
        "png".to_string()
    } else {
        safe_ext
    };
    let file_path = dir.join(format!("shot_{}.{}", timestamp, final_ext));
    fs::write(&file_path, bytes).map_err(|e| format!("写入图片失败: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn export_idea_markdown(
    filename: String,
    content: String,
    custom_dir: Option<String>,
) -> Result<String, String> {
    let dir = resolve_data_dir(custom_dir).join("ideas");
    fs::create_dir_all(&dir).map_err(|e| format!("创建导出目录失败: {}", e))?;

    let safe_name: String = filename
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || ('\u{4e00}'..='\u{9fff}').contains(&c)
            {
                c
            } else {
                '_'
            }
        })
        .collect();
    let final_name = if safe_name.trim_matches('_').is_empty() {
        format!("idea_{}", Local::now().format("%Y%m%d_%H%M%S"))
    } else {
        safe_name
    };

    let file_path = dir.join(format!("{}.md", final_name));
    fs::write(&file_path, content).map_err(|e| format!("导出 Markdown 失败: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

fn toggle_capture(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        let is_visible = win.is_visible().unwrap_or(false);
        if is_visible {
            let _ = win.hide();
        } else {
            let _ = win.center();
            let _ = win.show();
            let _ = win.set_focus();
            let _ = app.emit("capture-opened", ());
        }
        return;
    }

    if let Ok(win) = WebviewWindowBuilder::new(
        app,
        "capture",
        WebviewUrl::App("index.html?window=capture".into()),
    )
    .title("ShibaPlan Quick Capture")
    .inner_size(620.0, 340.0)
    .center()
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .build()
    {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("capture-opened", ());
    }
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[derive(Serialize, Clone)]
struct OsDragDropPayload {
    kind: String,
    paths: Vec<String>,
    x: f64,
    y: f64,
}

#[derive(Serialize)]
struct PathInfo {
    path: String,
    name: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct FolderEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct ArchiveScanEntry {
    name: String,
    path: String,
    root_path: String,
    relative_path: String,
    is_dir: bool,
    is_project: bool,
    ext: String,
    size: u64,
    modified_ms: u64,
    context_year: Option<i32>,
    context_month: Option<u32>,
    child_count: usize,
    thumbnail_path: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct ArchiveIndexCache {
    roots: Vec<String>,
    updated_at_ms: u64,
    entries: Vec<ArchiveScanEntry>,
}

fn is_preview_image_ext(ext: &str) -> bool {
    matches!(ext, "jpg" | "jpeg" | "png" | "webp" | "bmp" | "gif" | "svg" | "avif")
}

fn score_thumbnail_candidate(name: &str, ext: &str, size: u64, depth: usize) -> i32 {
    if !is_preview_image_ext(ext) || size < 1_024 || size > 15_000_000 {
        return -1;
    }
    let lower = name.to_lowercase();
    let mut score: i32 = match depth {
        0 => 40,
        1 => 25,
        _ => 10,
    };
    if matches!(ext, "jpg" | "jpeg" | "png" | "webp") {
        score += 15;
    }
    for kw in [
        "cover", "thumb", "preview", "final", "render", "poster", "logo", "main",
        "封面", "效果", "成品", "海报", "主图", "展示", "定稿", "终稿", "渲染",
    ] {
        if lower.contains(kw) {
            score += 80;
            break;
        }
    }
    if lower.starts_with("._") || lower.contains("backup") || lower.contains("tmp") {
        score -= 50;
    }
    score
}

fn find_project_thumbnail_inner(
    dir: &PathBuf,
    depth: usize,
    best: &mut Option<(i32, String)>,
    visited: &mut usize,
) {
    if depth > 2 || *visited > 160 {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in read_dir.flatten() {
        *visited += 1;
        if *visited > 160 {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_archive_name(&name) || name == "__MACOSX" {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            if depth < 2 {
                subdirs.push(path);
            }
        } else {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let s = score_thumbnail_candidate(&name, &ext, meta.len(), depth);
            if s > 0 {
                let replace = match best {
                    Some((cur, _)) => s > *cur,
                    None => true,
                };
                if replace {
                    *best = Some((s, path.to_string_lossy().to_string()));
                }
            }
        }
    }
    for sub in subdirs {
        find_project_thumbnail_inner(&sub, depth + 1, best, visited);
    }
}

fn find_project_thumbnail(dir: &PathBuf) -> Option<String> {
    let mut best: Option<(i32, String)> = None;
    let mut visited = 0usize;
    find_project_thumbnail_inner(dir, 0, &mut best, &mut visited);
    best.map(|(_, p)| p)
}

fn parse_pure_year_folder(name: &str) -> Option<i32> {
    let trimmed = name.trim().trim_start_matches('#').trim_end_matches('年').trim();
    if trimmed.len() == 4 && trimmed.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(y) = trimmed.parse::<i32>() {
            if (1990..=2099).contains(&y) {
                return Some(y);
            }
        }
    }
    None
}

fn parse_pure_month_folder(name: &str) -> Option<u32> {
    let trimmed = name.trim().trim_start_matches('#').trim();
    let stripped = trimmed
        .strip_suffix('月')
        .or_else(|| trimmed.strip_suffix("月份"))
        .unwrap_or(trimmed)
        .trim();
    if (1..=2).contains(&stripped.len()) && stripped.chars().all(|c| c.is_ascii_digit()) {
        if let Ok(m) = stripped.parse::<u32>() {
            if (1..=12).contains(&m) {
                return Some(m);
            }
        }
    }
    // Also support YYYY-MM or YYYY.MM as month container
    if trimmed.len() == 7 {
        let bytes = trimmed.as_bytes();
        if (bytes[4] == b'-' || bytes[4] == b'.' || bytes[4] == b'_')
            && trimmed[0..4].chars().all(|c| c.is_ascii_digit())
            && trimmed[5..7].chars().all(|c| c.is_ascii_digit())
        {
            if let Ok(m) = trimmed[5..7].parse::<u32>() {
                if (1..=12).contains(&m) {
                    return Some(m);
                }
            }
        }
    }
    None
}

fn should_skip_archive_name(name: &str) -> bool {
    matches!(
        name,
        ".DS_Store"
            | "Thumbs.db"
            | "desktop.ini"
            | "$RECYCLE.BIN"
            | "System Volume Information"
            | ".git"
            | "node_modules"
            | ".svn"
            | "__pycache__"
    )
}

fn scan_archive_recursive(
    dir: &PathBuf,
    root: &PathBuf,
    root_str: &str,
    depth: usize,
    inside_project: bool,
    ctx_year: Option<i32>,
    ctx_month: Option<u32>,
    out: &mut Vec<ArchiveScanEntry>,
    max_entries: usize,
) {
    if out.len() >= max_entries || depth > 5 {
        return;
    }
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };

    for entry in read_dir.flatten() {
        if out.len() >= max_entries {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip_archive_name(&name) {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let is_dir = meta.is_dir();
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let relative_path = path
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| name.clone());

        if is_dir {
            // Check if this folder is purely an organizational Year or Month container (when not yet inside a project)
            if !inside_project {
                if let Some(y) = parse_pure_year_folder(&name) {
                    scan_archive_recursive(
                        &path,
                        root,
                        root_str,
                        depth + 1,
                        false,
                        Some(y),
                        None,
                        out,
                        max_entries,
                    );
                    continue;
                }
                if let Some(m) = parse_pure_month_folder(&name) {
                    let next_year = if name.len() == 7 {
                        name[0..4].parse::<i32>().ok().or(ctx_year)
                    } else {
                        ctx_year
                    };
                    scan_archive_recursive(
                        &path,
                        root,
                        root_str,
                        depth + 1,
                        false,
                        next_year,
                        Some(m),
                        out,
                        max_entries,
                    );
                    continue;
                }
            }

            let is_project = !inside_project;
            let (child_count, thumbnail_path) = if is_project {
                let count = fs::read_dir(&path)
                    .map(|rd| rd.flatten().take(200).count())
                    .unwrap_or(0);
                let thumb = find_project_thumbnail(&path);
                (count, thumb)
            } else {
                (0, None)
            };

            out.push(ArchiveScanEntry {
                name,
                path: path.to_string_lossy().to_string(),
                root_path: root_str.to_string(),
                relative_path,
                is_dir: true,
                is_project,
                ext: String::new(),
                size: 0,
                modified_ms,
                context_year: ctx_year,
                context_month: ctx_month,
                child_count,
                thumbnail_path,
            });

            // Also index up to 2 levels inside each project for Everything-style instant file search
            if depth < 4 {
                scan_archive_recursive(
                    &path,
                    root,
                    root_str,
                    depth + 1,
                    true,
                    ctx_year,
                    ctx_month,
                    out,
                    max_entries,
                );
            }
        } else {
            let ext = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            let path_str = path.to_string_lossy().to_string();
            let thumbnail_path = if is_preview_image_ext(&ext) && meta.len() <= 15_000_000 {
                Some(path_str.clone())
            } else {
                None
            };
            out.push(ArchiveScanEntry {
                name,
                path: path_str,
                root_path: root_str.to_string(),
                relative_path,
                is_dir: false,
                is_project: !inside_project,
                ext,
                size: meta.len(),
                modified_ms,
                context_year: ctx_year,
                context_month: ctx_month,
                child_count: 0,
                thumbnail_path,
            });
        }
    }
}

#[tauri::command]
fn scan_project_archive_roots(
    roots: Vec<String>,
    custom_dir: Option<String>,
) -> Result<Vec<ArchiveScanEntry>, String> {
    let mut results: Vec<ArchiveScanEntry> = Vec::new();
    let max_entries = 18_000;
    let mut normalized_roots: Vec<String> = Vec::new();

    for raw_root in roots {
        let clean = raw_root.trim().trim_matches('"');
        if clean.is_empty() {
            continue;
        }
        normalized_roots.push(clean.to_string());
        let root_path = PathBuf::from(clean);
        if !root_path.is_dir() {
            continue;
        }
        let root_str = root_path.to_string_lossy().to_string();
        let root_name = root_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let initial_year = parse_pure_year_folder(&root_name);

        scan_archive_recursive(
            &root_path,
            &root_path,
            &root_str,
            0,
            false,
            initial_year,
            None,
            &mut results,
            max_entries,
        );
    }

    // Persist index cache to disk for instant startup & Everything-style search
    let data_dir = resolve_data_dir(custom_dir);
    if fs::create_dir_all(&data_dir).is_ok() {
        let cache_file = data_dir.join("project_archive_cache.json");
        let updated_at_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let cache = ArchiveIndexCache {
            roots: normalized_roots,
            updated_at_ms,
            entries: results.clone(),
        };
        if let Ok(json) = serde_json::to_string(&cache) {
            let _ = fs::write(cache_file, json);
        }
    }

    Ok(results)
}

#[tauri::command]
fn load_project_archive_cache(
    custom_dir: Option<String>,
) -> Result<Option<ArchiveIndexCache>, String> {
    let cache_file = resolve_data_dir(custom_dir).join("project_archive_cache.json");
    if !cache_file.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(&cache_file).map_err(|e| e.to_string())?;
    let parsed: ArchiveIndexCache = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(parsed))
}

#[tauri::command]
async fn pick_folder_path(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择项目归档文件夹")
            .blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("打开文件夹选择器失败: {}", e))?;

    Ok(picked.and_then(|fp| fp.into_path().ok()).map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
fn read_archive_thumbnail(path: String) -> Result<String, String> {
    let p = PathBuf::from(path.trim());
    if !p.is_file() {
        return Err("缩略图文件不存在".to_string());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 15_000_000 {
        return Err("图片过大".to_string());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

#[tauri::command]
fn inspect_path(path: String) -> Result<PathInfo, String> {
    let clean = path.trim().trim_matches('"');
    let p = PathBuf::from(clean);
    if !p.exists() {
        return Err("路径不存在".to_string());
    }
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| clean.to_string());
    Ok(PathInfo {
        path: p.to_string_lossy().to_string(),
        name,
        is_dir: p.is_dir(),
    })
}

#[tauri::command]
fn list_folder_entries(folder_path: String) -> Result<Vec<FolderEntry>, String> {
    let p = PathBuf::from(folder_path.trim());
    if !p.is_dir() {
        return Err("不是有效的文件夹路径".to_string());
    }
    let read_dir = fs::read_dir(&p).map_err(|e| format!("读取文件夹失败: {}", e))?;
    let mut entries: Vec<FolderEntry> = Vec::new();

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".DS_Store" || name == "Thumbs.db" || name == "desktop.ini" {
            continue;
        }
        let path = entry.path();
        let is_dir = path.is_dir();
        entries.push(FolderEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries.truncate(80);
    Ok(entries)
}

#[tauri::command]
fn open_path_in_os(target_path: String) -> Result<(), String> {
    let p = PathBuf::from(target_path.trim());
    if !p.exists() {
        return Err("目标路径不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if p.is_dir() {
            Command::new("explorer")
                .arg(&p)
                .spawn()
                .map_err(|e| format!("打开文件夹失败: {}", e))?;
        } else {
            Command::new("cmd")
                .args(["/C", "start", "", &p.to_string_lossy()])
                .spawn()
                .map_err(|e| format!("打开文件失败: {}", e))?;
        }
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&p)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }

    Ok(())
}

#[derive(Serialize, Clone)]
struct LanServerInfo {
    running: bool,
    ip: String,
    port: u16,
    url: String,
}

struct LanServerState {
    running: Arc<AtomicBool>,
    port: Mutex<u16>,
    custom_dir: Mutex<Option<String>>,
}

impl Default for LanServerState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Mutex::new(18420),
            custom_dir: Mutex::new(None),
        }
    }
}

fn detect_lan_ip() -> String {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn guess_mime(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") || path.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else {
        "application/octet-stream"
    }
}

fn send_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn handle_lan_client(mut stream: TcpStream, app: AppHandle, custom_dir: Option<String>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut header_end = None;
    let mut content_length: usize = 0;

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if header_end.is_none() {
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        header_end = Some(pos + 4);
                        let headers_str = String::from_utf8_lossy(&buf[..pos]);
                        for line in headers_str.lines() {
                            if let Some((k, v)) = line.split_once(':') {
                                if k.trim().eq_ignore_ascii_case("content-length") {
                                    content_length = v.trim().parse().unwrap_or(0);
                                }
                            }
                        }
                    }
                }
                if let Some(end) = header_end {
                    if buf.len() >= end + content_length {
                        break;
                    }
                }
                if buf.len() > 20 * 1024 * 1024 {
                    break;
                }
            }
            Err(_) => break,
        }
    }

    let Some(end) = header_end else {
        return;
    };
    let head_str = String::from_utf8_lossy(&buf[..end]);
    let first_line = head_str.lines().next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let raw_target = parts.next().unwrap_or("/");
    let path_only = raw_target.split('?').next().unwrap_or("/");

    if method == "OPTIONS" {
        send_http_response(&mut stream, "204 No Content", "text/plain", b"");
        return;
    }

    if path_only == "/api/workspace" {
        let dir = resolve_data_dir(custom_dir);
        let file_path = dir.join("shibaplan-data.json");

        if method == "GET" {
            match fs::read(&file_path) {
                Ok(bytes) => {
                    send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", &bytes);
                }
                Err(_) => {
                    send_http_response(&mut stream, "200 OK", "application/json; charset=utf-8", b"null");
                }
            }
            return;
        }

        if method == "POST" {
            let body_bytes = &buf[end..buf.len().min(end + content_length)];
            if let Ok(body_str) = std::str::from_utf8(body_bytes) {
                let _ = fs::create_dir_all(&dir);
                if fs::write(&file_path, body_str).is_ok() {
                    let _ = app.emit("workspace-updated", body_str);
                    send_http_response(
                        &mut stream,
                        "200 OK",
                        "application/json; charset=utf-8",
                        b"{\"ok\":true}",
                    );
                    return;
                }
            }
            send_http_response(&mut stream, "500 Internal Server Error", "text/plain", b"save failed");
            return;
        }
    }

    // Serve static frontend assets (bundled Tauri assets first, then ../dist fallback for dev)
    let clean_rel = if path_only == "/" {
        "index.html"
    } else {
        path_only.trim_start_matches('/')
    };

    if let Some(asset) = app.asset_resolver().get(clean_rel.to_string()) {
        send_http_response(&mut stream, "200 OK", &asset.mime_type, &asset.bytes);
        return;
    }

    // Fallback: serve from ../dist when running under `tauri dev`
    let dev_dist = PathBuf::from("../dist").join(clean_rel);
    if dev_dist.is_file() {
        if let Ok(bytes) = fs::read(&dev_dist) {
            send_http_response(&mut stream, "200 OK", guess_mime(clean_rel), &bytes);
            return;
        }
    }

    // SPA fallback to index.html
    if let Some(asset) = app.asset_resolver().get("index.html".to_string()) {
        send_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", &asset.bytes);
        return;
    }
    let dev_index = PathBuf::from("../dist/index.html");
    if let Ok(bytes) = fs::read(&dev_index) {
        send_http_response(&mut stream, "200 OK", "text/html; charset=utf-8", &bytes);
        return;
    }

    send_http_response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not Found");
}

#[tauri::command]
fn get_lan_server_info(state: tauri::State<'_, LanServerState>) -> LanServerInfo {
    let running = state.running.load(Ordering::SeqCst);
    let port = *state.port.lock().unwrap();
    let ip = detect_lan_ip();
    LanServerInfo {
        running,
        url: format!("http://{}:{}", ip, port),
        ip,
        port,
    }
}

#[tauri::command]
fn start_lan_server(
    app: AppHandle,
    state: tauri::State<'_, LanServerState>,
    port: Option<u16>,
    custom_dir: Option<String>,
) -> Result<LanServerInfo, String> {
    let target_port = port.unwrap_or(18420);
    *state.custom_dir.lock().unwrap() = custom_dir.clone();

    if state.running.load(Ordering::SeqCst) {
        let cur_port = *state.port.lock().unwrap();
        let ip = detect_lan_ip();
        return Ok(LanServerInfo {
            running: true,
            url: format!("http://{}:{}", ip, cur_port),
            ip,
            port: cur_port,
        });
    }

    let listener = TcpListener::bind(("0.0.0.0", target_port))
        .map_err(|e| format!("启动局域网服务失败（端口 {}）: {}", target_port, e))?;
    let _ = listener.set_nonblocking(true);

    *state.port.lock().unwrap() = target_port;
    state.running.store(true, Ordering::SeqCst);

    let running_flag = state.running.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        while running_flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let app_inner = app_clone.clone();
                    let dir_inner = custom_dir.clone();
                    thread::spawn(move || {
                        handle_lan_client(stream, app_inner, dir_inner);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(60));
                }
                Err(_) => break,
            }
        }
    });

    let ip = detect_lan_ip();
    Ok(LanServerInfo {
        running: true,
        url: format!("http://{}:{}", ip, target_port),
        ip,
        port: target_port,
    })
}

#[tauri::command]
fn stop_lan_server(state: tauri::State<'_, LanServerState>) -> Result<LanServerInfo, String> {
    state.running.store(false, Ordering::SeqCst);
    let port = *state.port.lock().unwrap();
    let ip = detect_lan_ip();
    Ok(LanServerInfo {
        running: false,
        url: format!("http://{}:{}", ip, port),
        ip,
        port,
    })
}

#[tauri::command]
fn hide_capture_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("capture") {
        let _ = win.hide();
    }
}

#[tauri::command]
fn open_capture_window(app: AppHandle) {
    toggle_capture(&app);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(LanServerState::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_capture(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            eprintln!("[ShibaPlan] setup started");
            // Register global shortcut: Alt+Space (fallback to Ctrl+Shift+Space if occupied)
            let primary = Shortcut::new(Some(Modifiers::ALT), Code::Space);
            let fallback = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);

            let shortcut_manager = app.global_shortcut();
            match shortcut_manager.register(primary) {
                Ok(_) => eprintln!("[ShibaPlan] registered Alt+Space"),
                Err(e) => {
                    eprintln!("[ShibaPlan] Alt+Space occupied ({}), trying Ctrl+Shift+Space", e);
                    let _ = shortcut_manager.register(fallback);
                }
            }

            // Build system tray menu
            let open_main_item = MenuItem::with_id(app, "open_main", "打开 ShibaPlan", true, None::<&str>)?;
            let capture_item = MenuItem::with_id(app, "quick_capture", "快速记录灵感 (Alt+Space)", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_main_item, &capture_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("ShibaPlan - 设计/开发/评测节奏工作台")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open_main" => show_main(app),
                    "quick_capture" => toggle_capture(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;
            eprintln!("[ShibaPlan] tray built");

            if let Some(win) = app.get_webview_window("main") {
                eprintln!("[ShibaPlan] main window exists, showing...");
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
                eprintln!("[ShibaPlan] main window visible={:?}", win.is_visible());
            } else {
                eprintln!("[ShibaPlan] ERROR: main window NOT FOUND!");
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                // Hide to system tray instead of exiting so global shortcut stays active
                if window.label() == "main" || window.label() == "capture" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
            WindowEvent::DragDrop(drag_event) => {
                if window.label() != "main" {
                    return;
                }
                let payload = match drag_event {
                    tauri::DragDropEvent::Enter { paths, position } => Some(OsDragDropPayload {
                        kind: "enter".into(),
                        paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                        x: position.x,
                        y: position.y,
                    }),
                    tauri::DragDropEvent::Over { position } => Some(OsDragDropPayload {
                        kind: "over".into(),
                        paths: vec![],
                        x: position.x,
                        y: position.y,
                    }),
                    tauri::DragDropEvent::Drop { paths, position } => Some(OsDragDropPayload {
                        kind: "drop".into(),
                        paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                        x: position.x,
                        y: position.y,
                    }),
                    tauri::DragDropEvent::Leave => Some(OsDragDropPayload {
                        kind: "leave".into(),
                        paths: vec![],
                        x: 0.0,
                        y: 0.0,
                    }),
                    _ => None,
                };
                if let Some(p) = payload {
                    let _ = window.emit("os-drag-drop", p);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_default_data_dir,
            load_workspace_data,
            save_workspace_data,
            save_pasted_image,
            export_idea_markdown,
            inspect_path,
            list_folder_entries,
            scan_project_archive_roots,
            load_project_archive_cache,
            pick_folder_path,
            read_archive_thumbnail,
            open_path_in_os,
            get_lan_server_info,
            start_lan_server,
            stop_lan_server,
            hide_capture_window,
            open_capture_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShibaPlan");
}
