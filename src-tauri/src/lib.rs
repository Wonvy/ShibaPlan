use base64::Engine;
use chrono::Local;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
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
            open_path_in_os,
            hide_capture_window,
            open_capture_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ShibaPlan");
}
