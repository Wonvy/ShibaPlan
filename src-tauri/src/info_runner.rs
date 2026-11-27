use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

const MAX_OUTPUT_BYTES: usize = 1024 * 1024; // 1 MB cap per stream
const MAX_SCRIPT_READ_BYTES: u64 = 512 * 1024; // 512 KB cap

#[derive(Default)]
pub struct InfoRunnerState {
    pub running: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoRunRequest {
    pub widget_id: String,
    #[serde(default)]
    pub widget_title: String,
    #[serde(default)]
    pub trigger: String,
    pub kind: String, // "script" | "command" | "http"
    #[serde(default)]
    pub script_path: Option<String>,
    #[serde(default)]
    pub inline_code: Option<String>,
    #[serde(default)]
    pub script_lang: Option<String>,
    #[serde(default)]
    pub interpreter: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub use_shell: Option<bool>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub params: HashMap<String, String>,
    #[serde(default)]
    pub timeout_sec: Option<u64>,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub custom_dir: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InfoRunResult {
    pub ok: bool,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub timed_out: bool,
    pub cancelled: bool,
    pub http_status: Option<u16>,
    pub error: Option<String>,
    pub ran_at: String,
}

struct RunningGuard {
    map: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    widget_id: String,
    flag: Arc<AtomicBool>,
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.map.lock() {
            if let Some(current) = guard.get(&self.widget_id) {
                if Arc::ptr_eq(current, &self.flag) {
                    guard.remove(&self.widget_id);
                }
            }
        }
    }
}

struct TempScriptGuard {
    path: Option<PathBuf>,
}

impl Drop for TempScriptGuard {
    fn drop(&mut self) {
        if let Some(p) = self.path.take() {
            let _ = fs::remove_file(p);
        }
    }
}

fn apply_no_window(_cmd: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        _cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
}

fn kill_child_tree(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        let pid = child.id();
        let mut killer = Command::new("taskkill");
        apply_no_window(&mut killer);
        let _ = killer
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn read_stream_capped<R: Read>(mut reader: R, limit: usize) -> String {
    let mut out = Vec::new();
    let mut buf = [0u8; 4096];
    let mut truncated = false;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if out.len() < limit {
                    let take = n.min(limit - out.len());
                    out.extend_from_slice(&buf[..take]);
                    if take < n {
                        truncated = true;
                    }
                } else {
                    truncated = true;
                }
            }
            Err(_) => break,
        }
    }
    let mut text = String::from_utf8_lossy(&out).to_string();
    if truncated {
        text.push_str("\n... [输出超过 1MB，已截断]");
    }
    text
}

fn wait_child_with_timeout(
    mut child: Child,
    timeout: Duration,
    cancel_flag: &Arc<AtomicBool>,
) -> Result<(i32, String, String, bool, bool), String> {
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let out_handle = thread::spawn(move || {
        stdout_pipe
            .map(|r| read_stream_capped(r, MAX_OUTPUT_BYTES))
            .unwrap_or_default()
    });
    let err_handle = thread::spawn(move || {
        stderr_pipe
            .map(|r| read_stream_capped(r, MAX_OUTPUT_BYTES))
            .unwrap_or_default()
    });

    let started = Instant::now();
    let mut timed_out = false;
    let mut cancelled = false;
    let mut exit_code: i32 = -1;

    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            cancelled = true;
            kill_child_tree(&mut child);
            break;
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            kill_child_tree(&mut child);
            break;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                exit_code = status.code().unwrap_or(if status.success() { 0 } else { -1 });
                break;
            }
            Ok(None) => {
                thread::sleep(Duration::from_millis(30));
            }
            Err(e) => {
                kill_child_tree(&mut child);
                let _ = out_handle.join();
                let _ = err_handle.join();
                return Err(format!("等待子进程结束失败: {}", e));
            }
        }
    }

    let stdout = out_handle.join().unwrap_or_default();
    let stderr = err_handle.join().unwrap_or_default();
    Ok((exit_code, stdout, stderr, timed_out, cancelled))
}

fn sanitize_id_part(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        "widget".to_string()
    } else {
        s
    }
}

fn normalize_param_env_key(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        None
    } else {
        Some(format!("SHIBA_PARAM_{}", trimmed))
    }
}

fn lang_to_ext(lang: &str) -> &'static str {
    match lang.trim().to_ascii_lowercase().as_str() {
        "python" | "py" => "py",
        "powershell" | "ps1" => "ps1",
        "node" | "js" | "javascript" | "mjs" => "js",
        "batch" | "bat" | "cmd" => "bat",
        "bash" | "sh" | "shell" => "sh",
        _ => "txt",
    }
}

fn resolve_scripts_dir(custom_dir: Option<String>) -> PathBuf {
    crate::resolve_data_dir(custom_dir).join("scripts")
}

fn resolve_cache_file(custom_dir: Option<String>) -> PathBuf {
    crate::resolve_data_dir(custom_dir)
        .join("info-cache")
        .join("results.json")
}

fn build_stdin_context(req: &InfoRunRequest, data_dir: &Path) -> String {
    serde_json::json!({
        "widgetId": req.widget_id,
        "widgetTitle": req.widget_title,
        "trigger": req.trigger,
        "dataDir": data_dir.to_string_lossy(),
        "lastRunAt": req.last_run_at,
        "params": req.params,
    })
    .to_string()
}

fn inject_common_env(cmd: &mut Command, req: &InfoRunRequest, data_dir: &Path) {
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    cmd.env("SHIBA_WIDGET_ID", &req.widget_id);
    cmd.env("SHIBA_WIDGET_TITLE", &req.widget_title);
    cmd.env(
        "SHIBA_TRIGGER",
        if req.trigger.trim().is_empty() {
            "manual"
        } else {
            req.trigger.trim()
        },
    );
    cmd.env("SHIBA_DATA_DIR", data_dir.to_string_lossy().to_string());
    if let Some(last) = &req.last_run_at {
        if !last.trim().is_empty() {
            cmd.env("SHIBA_LAST_RUN_AT", last.trim());
        }
    }
    for (k, v) in &req.env {
        let key = k.trim();
        if !key.is_empty() {
            cmd.env(key, v);
        }
    }
    for (k, v) in &req.params {
        if let Some(env_key) = normalize_param_env_key(k) {
            cmd.env(env_key, v);
        }
    }
}

fn apply_cwd(cmd: &mut Command, req_cwd: &Option<String>, default_dir: &Path) {
    if let Some(c) = req_cwd {
        let trimmed = c.trim();
        if !trimmed.is_empty() {
            let p = PathBuf::from(trimmed);
            if p.is_dir() {
                cmd.current_dir(p);
                return;
            }
        }
    }
    if default_dir.is_dir() {
        cmd.current_dir(default_dir);
    }
}

#[cfg(target_os = "windows")]
fn quote_cmd_arg(arg: &str) -> String {
    if arg.is_empty()
        || arg
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '"' | '&' | '|' | '<' | '>' | '^' | '%'))
    {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        arg.to_string()
    }
}

fn run_http_source(
    req: &InfoRunRequest,
    timeout: Duration,
    cancel_flag: &Arc<AtomicBool>,
    started: Instant,
    ran_at: String,
) -> Result<InfoRunResult, String> {
    let url = req.url.as_deref().unwrap_or("").trim();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(InfoRunResult {
            ok: false,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: started.elapsed().as_millis() as u64,
            timed_out: false,
            cancelled: false,
            http_status: None,
            error: Some("无效的 HTTP URL（仅支持 http:// 或 https://）".to_string()),
            ran_at,
        });
    }

    let curl_bin = if cfg!(target_os = "windows") {
        "curl.exe"
    } else {
        "curl"
    };

    let raw_method = req.method.as_deref().unwrap_or("GET").trim().to_ascii_uppercase();
    let http_method = match raw_method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" => raw_method.as_str(),
        _ => "GET",
    };

    let mut cmd = Command::new(curl_bin);
    apply_no_window(&mut cmd);
    cmd.arg("-sS")
        .arg("--max-time")
        .arg(timeout.as_secs().max(2).to_string())
        .arg("-X")
        .arg(http_method);

    for (k, v) in &req.headers {
        let key = k.trim();
        if !key.is_empty() {
            cmd.arg("-H").arg(format!("{}: {}", key, v));
        }
    }

    let body_text = req.body.as_deref().unwrap_or("");
    let has_body = matches!(http_method, "POST" | "PUT" | "PATCH" | "DELETE") && !body_text.is_empty();
    if has_body {
        cmd.arg("--data-binary").arg("@-");
    }

    cmd.arg("-w")
        .arg("\n__SHIBA_HTTP_STATUS__%{http_code}")
        .arg(url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 HTTP 客户端 ({}): {}", curl_bin, e))?;

    if has_body {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(body_text.as_bytes());
        }
    } else {
        drop(child.stdin.take());
    }

    let (exit_code, raw_out, stderr, timed_out, cancelled) =
        wait_child_with_timeout(child, timeout, cancel_flag)?;

    let marker = "\n__SHIBA_HTTP_STATUS__";
    let (resp_body, status_code) = if let Some(idx) = raw_out.rfind(marker) {
        let b = raw_out[..idx].to_string();
        let code_str = raw_out[idx + marker.len()..].trim();
        let code = code_str.parse::<u16>().ok();
        (b, code)
    } else {
        (raw_out, None)
    };

    let ok = !timed_out
        && !cancelled
        && exit_code == 0
        && status_code.map(|c| (200..300).contains(&c)).unwrap_or(false);

    let error = if cancelled {
        Some("已取消执行".to_string())
    } else if timed_out {
        Some(format!("请求超时（>{}s）", timeout.as_secs()))
    } else if exit_code != 0 {
        Some(if stderr.trim().is_empty() {
            format!("HTTP 请求失败（退出码 {}）", exit_code)
        } else {
            stderr.trim().to_string()
        })
    } else if let Some(code) = status_code {
        if !(200..300).contains(&code) {
            Some(format!("HTTP 状态码异常: {}", code))
        } else {
            None
        }
    } else {
        Some("未能解析 HTTP 状态码".to_string())
    };

    Ok(InfoRunResult {
        ok,
        exit_code,
        stdout: resp_body,
        stderr,
        duration_ms: started.elapsed().as_millis() as u64,
        timed_out,
        cancelled,
        http_status: status_code,
        error,
        ran_at,
    })
}

fn spawn_script_command(
    req: &InfoRunRequest,
    script_file: &Path,
    data_dir: &Path,
    scripts_dir: &Path,
) -> Result<Child, String> {
    let custom_interp = req
        .interpreter
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let ext = script_file
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let lang = req
        .script_lang
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(ext.as_str());

    let build_and_spawn = |mut cmd: Command| -> std::io::Result<Child> {
        apply_no_window(&mut cmd);
        apply_cwd(&mut cmd, &req.cwd, scripts_dir);
        inject_common_env(&mut cmd, req, data_dir);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        cmd.spawn()
    };

    if let Some(interp) = custom_interp {
        let mut cmd = Command::new(interp);
        cmd.arg(script_file).args(&req.args);
        return build_and_spawn(cmd).map_err(|e| format!("启动解释器「{}」失败: {}", interp, e));
    }

    match lang.to_ascii_lowercase().as_str() {
        "py" | "python" => {
            #[cfg(target_os = "windows")]
            {
                let mut c1 = Command::new("python");
                c1.arg("-u").arg(script_file).args(&req.args);
                match build_and_spawn(c1) {
                    Ok(child) => Ok(child),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        let mut c2 = Command::new("py");
                        c2.arg("-3").arg("-u").arg(script_file).args(&req.args);
                        build_and_spawn(c2)
                            .map_err(|e2| format!("未找到 Python（已尝试 python 与 py -3）: {}", e2))
                    }
                    Err(e) => Err(format!("启动 Python 失败: {}", e)),
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut c1 = Command::new("python3");
                c1.arg("-u").arg(script_file).args(&req.args);
                match build_and_spawn(c1) {
                    Ok(child) => Ok(child),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        let mut c2 = Command::new("python");
                        c2.arg("-u").arg(script_file).args(&req.args);
                        build_and_spawn(c2)
                            .map_err(|e2| format!("未找到 Python: {}", e2))
                    }
                    Err(e) => Err(format!("启动 Python 失败: {}", e)),
                }
            }
        }
        "ps1" | "powershell" => {
            let ps_bin = if cfg!(target_os = "windows") {
                "powershell"
            } else {
                "pwsh"
            };
            let mut cmd = Command::new(ps_bin);
            cmd.env("SHIBA_SCRIPT_FILE", script_file.to_string_lossy().to_string());
            cmd.args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $OutputEncoding=[System.Text.UTF8Encoding]::new($false); & $env:SHIBA_SCRIPT_FILE @args",
            ])
            .args(&req.args);
            build_and_spawn(cmd).map_err(|e| format!("启动 PowerShell 失败: {}", e))
        }
        "js" | "mjs" | "cjs" | "node" | "javascript" => {
            let mut cmd = Command::new("node");
            cmd.arg(script_file).args(&req.args);
            build_and_spawn(cmd).map_err(|e| format!("启动 Node.js 失败: {}", e))
        }
        "bat" | "cmd" | "batch" => {
            #[cfg(target_os = "windows")]
            {
                let mut parts = vec![format!("\"{}\"", script_file.to_string_lossy())];
                for a in &req.args {
                    parts.push(quote_cmd_arg(a));
                }
                let line = format!("chcp 65001 >nul & call {}", parts.join(" "));
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", &line]);
                build_and_spawn(cmd).map_err(|e| format!("启动批处理脚本失败: {}", e))
            }
            #[cfg(not(target_os = "windows"))]
            {
                let mut cmd = Command::new("sh");
                cmd.arg(script_file).args(&req.args);
                build_and_spawn(cmd).map_err(|e| format!("启动脚本失败: {}", e))
            }
        }
        "sh" | "bash" | "shell" => {
            let mut c1 = Command::new("bash");
            c1.arg(script_file).args(&req.args);
            match build_and_spawn(c1) {
                Ok(child) => Ok(child),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    let mut c2 = Command::new("sh");
                    c2.arg(script_file).args(&req.args);
                    build_and_spawn(c2).map_err(|e2| format!("启动 Shell 失败: {}", e2))
                }
                Err(e) => Err(format!("启动 Bash 失败: {}", e)),
            }
        }
        _ => {
            let mut cmd = Command::new(script_file);
            cmd.args(&req.args);
            build_and_spawn(cmd).map_err(|e| format!("运行目标程序失败: {}", e))
        }
    }
}

fn spawn_command_source(
    req: &InfoRunRequest,
    data_dir: &Path,
    scripts_dir: &Path,
) -> Result<Child, String> {
    let raw_cmd = req.command.as_deref().unwrap_or("").trim();
    if raw_cmd.is_empty() {
        return Err("命令内容不能为空".to_string());
    }

    let mut cmd = if req.use_shell.unwrap_or(true) {
        #[cfg(target_os = "windows")]
        {
            let mut c = Command::new("cmd");
            let full_line = if req.args.is_empty() {
                format!("chcp 65001 >nul & {}", raw_cmd)
            } else {
                let extra: Vec<String> = req.args.iter().map(|a| quote_cmd_arg(a)).collect();
                format!("chcp 65001 >nul & {} {}", raw_cmd, extra.join(" "))
            };
            c.args(["/C", &full_line]);
            c
        }
        #[cfg(not(target_os = "windows"))]
        {
            let mut c = Command::new("sh");
            if req.args.is_empty() {
                c.args(["-c", raw_cmd]);
            } else {
                c.args(["-c", &format!("{} {}", raw_cmd, req.args.join(" "))]);
            }
            c
        }
    } else {
        let mut c = Command::new(raw_cmd);
        c.args(&req.args);
        c
    };

    apply_no_window(&mut cmd);
    apply_cwd(&mut cmd, &req.cwd, scripts_dir);
    inject_common_env(&mut cmd, req, data_dir);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    cmd.spawn()
        .map_err(|e| format!("启动命令「{}」失败: {}", raw_cmd, e))
}

fn is_ps1_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("ps1"))
        .unwrap_or(false)
}

fn write_script_content(path: &Path, content: &str) -> std::io::Result<()> {
    // Windows PowerShell 5.1 parses .ps1 files with ANSI/GBK unless a UTF-8 BOM is present.
    if is_ps1_path(path) && !content.starts_with('\u{FEFF}') {
        let mut bytes = Vec::with_capacity(3 + content.len());
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        bytes.extend_from_slice(content.as_bytes());
        fs::write(path, bytes)
    } else {
        fs::write(path, content.as_bytes())
    }
}

#[tauri::command]
pub async fn run_info_source(
    state: tauri::State<'_, InfoRunnerState>,
    req: InfoRunRequest,
) -> Result<InfoRunResult, String> {
    let running_map = state.running.clone();
    crate::run_blocking(move || run_info_source_impl(running_map, req)).await
}

fn run_info_source_impl(
    running_map: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    req: InfoRunRequest,
) -> Result<InfoRunResult, String> {
    let started = Instant::now();
    let ran_at = Local::now().to_rfc3339();
    let timeout = Duration::from_secs(req.timeout_sec.unwrap_or(30).clamp(2, 300));

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = running_map.lock().unwrap();
        if let Some(prev) = map.insert(req.widget_id.clone(), cancel_flag.clone()) {
            prev.store(true, Ordering::SeqCst);
        }
    }
    let _running_guard = RunningGuard {
        map: running_map,
        widget_id: req.widget_id.clone(),
        flag: cancel_flag.clone(),
    };

    if req.kind == "http" {
        return run_http_source(&req, timeout, &cancel_flag, started, ran_at);
    }

    let data_dir = crate::resolve_data_dir(req.custom_dir.clone());
    let scripts_dir = resolve_scripts_dir(req.custom_dir.clone());
    let _ = fs::create_dir_all(&scripts_dir);

    let mut _temp_guard = TempScriptGuard { path: None };

    let mut child = if req.kind == "script" {
        let inline = req
            .inline_code
            .as_deref()
            .filter(|s| !s.trim().is_empty());
        let saved_path = req
            .script_path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let use_temp_inline = inline.is_some() && (req.trigger == "test" || saved_path.is_none());

        let script_file: PathBuf = if use_temp_inline {
            let code = inline.unwrap();
            let ext = req
                .script_lang
                .as_deref()
                .map(lang_to_ext)
                .or_else(|| {
                    saved_path.and_then(|p| {
                        Path::new(p)
                            .extension()
                            .and_then(|e| e.to_str())
                            .map(lang_to_ext)
                    })
                })
                .unwrap_or("py");
            let temp_name = format!(
                ".tmp_{}_{}.{}",
                sanitize_id_part(&req.widget_id),
                Local::now().timestamp_millis(),
                ext
            );
            let temp_path = scripts_dir.join(temp_name);
            write_script_content(&temp_path, code)
                .map_err(|e| format!("写入临时脚本失败: {}", e))?;
            _temp_guard.path = Some(temp_path.clone());
            temp_path
        } else if let Some(p) = saved_path {
            let pb = PathBuf::from(p);
            if !pb.is_file() {
                return Ok(InfoRunResult {
                    ok: false,
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: String::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                    timed_out: false,
                    cancelled: false,
                    http_status: None,
                    error: Some(format!("脚本文件不存在: {}", p)),
                    ran_at,
                });
            }
            #[cfg(target_os = "windows")]
            {
                if is_ps1_path(&pb) {
                    if let Ok(bytes) = fs::read(&pb) {
                        let has_bom = bytes.starts_with(&[0xEF, 0xBB, 0xBF]);
                        let has_non_ascii = bytes.iter().any(|&b| b >= 0x80);
                        if !has_bom && has_non_ascii {
                            if let Ok(text) = std::str::from_utf8(&bytes) {
                                let temp_name = format!(
                                    ".tmp_{}_{}.ps1",
                                    sanitize_id_part(&req.widget_id),
                                    Local::now().timestamp_millis()
                                );
                                let temp_path = scripts_dir.join(temp_name);
                                write_script_content(&temp_path, text)
                                    .map_err(|e| format!("写入临时脚本失败: {}", e))?;
                                _temp_guard.path = Some(temp_path.clone());
                                temp_path
                            } else {
                                pb
                            }
                        } else {
                            pb
                        }
                    } else {
                        pb
                    }
                } else {
                    pb
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                pb
            }
        } else {
            return Ok(InfoRunResult {
                ok: false,
                exit_code: -1,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms: started.elapsed().as_millis() as u64,
                timed_out: false,
                cancelled: false,
                http_status: None,
                error: Some("请指定脚本文件或输入脚本代码".to_string()),
                ran_at,
            });
        };

        match spawn_script_command(&req, &script_file, &data_dir, &scripts_dir) {
            Ok(c) => c,
            Err(err_msg) => {
                crate::write_log_line("WARN", "info", &err_msg, None, req.custom_dir.clone());
                return Ok(InfoRunResult {
                    ok: false,
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: String::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                    timed_out: false,
                    cancelled: false,
                    http_status: None,
                    error: Some(err_msg),
                    ran_at,
                });
            }
        }
    } else if req.kind == "command" {
        match spawn_command_source(&req, &data_dir, &scripts_dir) {
            Ok(c) => c,
            Err(err_msg) => {
                crate::write_log_line("WARN", "info", &err_msg, None, req.custom_dir.clone());
                return Ok(InfoRunResult {
                    ok: false,
                    exit_code: -1,
                    stdout: String::new(),
                    stderr: String::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                    timed_out: false,
                    cancelled: false,
                    http_status: None,
                    error: Some(err_msg),
                    ran_at,
                });
            }
        }
    } else {
        return Err(format!("未知数据源类型: {}", req.kind));
    };

    if let Some(mut stdin) = child.stdin.take() {
        let ctx = build_stdin_context(&req, &data_dir);
        let _ = stdin.write_all(ctx.as_bytes());
        let _ = stdin.flush();
    }

    let (exit_code, stdout, stderr, timed_out, cancelled) =
        wait_child_with_timeout(child, timeout, &cancel_flag)?;

    let ok = !timed_out && !cancelled && exit_code == 0;
    let error = if cancelled {
        Some("已手动停止运行".to_string())
    } else if timed_out {
        Some(format!("执行超时（>{}s）", timeout.as_secs()))
    } else if exit_code != 0 {
        Some(format!("进程退出码异常: {}", exit_code))
    } else {
        None
    };

    Ok(InfoRunResult {
        ok,
        exit_code,
        stdout,
        stderr,
        duration_ms: started.elapsed().as_millis() as u64,
        timed_out,
        cancelled,
        http_status: None,
        error,
        ran_at,
    })
}

#[tauri::command]
pub fn cancel_info_run(
    state: tauri::State<'_, InfoRunnerState>,
    widget_id: String,
) -> bool {
    let map = state.running.lock().unwrap();
    if let Some(flag) = map.get(&widget_id) {
        flag.store(true, Ordering::SeqCst);
        true
    } else {
        false
    }
}

#[tauri::command]
pub async fn load_info_cache(custom_dir: Option<String>) -> Result<String, String> {
    crate::run_blocking(move || {
        let path = resolve_cache_file(custom_dir);
        if !path.is_file() {
            return Ok("{}".to_string());
        }
        fs::read_to_string(&path).map_err(|e| format!("读取信息缓存失败: {}", e))
    })
    .await
}

#[tauri::command]
pub async fn save_info_cache(cache_json: String, custom_dir: Option<String>) -> Result<(), String> {
    crate::run_blocking(move || {
        let path = resolve_cache_file(custom_dir);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建缓存目录失败: {}", e))?;
        }
        fs::write(&path, cache_json).map_err(|e| format!("保存信息缓存失败: {}", e))
    })
    .await
}

#[tauri::command]
pub async fn get_info_scripts_dir(custom_dir: Option<String>) -> Result<String, String> {
    crate::run_blocking(move || {
        let dir = resolve_scripts_dir(custom_dir);
        fs::create_dir_all(&dir).map_err(|e| format!("创建脚本目录失败: {}", e))?;
        Ok(dir.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn read_script_file(path: String) -> Result<String, String> {
    crate::run_blocking(move || {
        let pb = PathBuf::from(path.trim());
        if !pb.is_file() {
            return Err("脚本文件不存在".to_string());
        }
        let meta = fs::metadata(&pb).map_err(|e| format!("读取文件信息失败: {}", e))?;
        if meta.len() > MAX_SCRIPT_READ_BYTES {
            return Err("脚本文件超过 512KB，暂不支持在内置编辑器中打开".to_string());
        }
        let bytes = fs::read(&pb).map_err(|e| format!("读取脚本失败: {}", e))?;
        let text = String::from_utf8_lossy(&bytes);
        Ok(text.strip_prefix('\u{FEFF}').unwrap_or(&text).to_string())
    })
    .await
}

#[tauri::command]
pub async fn write_script_file(
    path: String,
    content: String,
    custom_dir: Option<String>,
) -> Result<String, String> {
    crate::run_blocking(move || {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err("文件名或路径不能为空".to_string());
        }
        let has_sep = trimmed.contains('/') || trimmed.contains('\\');
        let target = if has_sep {
            PathBuf::from(trimmed)
        } else {
            resolve_scripts_dir(custom_dir).join(trimmed)
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建脚本目录失败: {}", e))?;
        }
        write_script_content(&target, &content).map_err(|e| format!("保存脚本文件失败: {}", e))?;
        Ok(target.to_string_lossy().to_string())
    })
    .await
}

#[tauri::command]
pub async fn pick_script_file(app: AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择脚本或可执行程序")
            .blocking_pick_file()
    })
    .await
    .map_err(|e| format!("打开文件选择器失败: {}", e))?;

    Ok(picked
        .and_then(|fp| fp.into_path().ok())
        .map(|p| p.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn open_in_code_editor(path: String) -> Result<(), String> {
    crate::run_blocking(move || open_in_code_editor_impl(path)).await
}

fn open_in_code_editor_impl(path: String) -> Result<(), String> {
    let pb = PathBuf::from(path.trim());
    if !pb.exists() {
        return Err("目标脚本文件不存在".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        // Safety: NEVER invoke `cmd /C start` on .bat/.ps1/.py files as that executes them.
        let mut cmd = Command::new("powershell");
        apply_no_window(&mut cmd);
        cmd.env("SHIBA_EDIT_FILE", pb.to_string_lossy().to_string())
            .args([
                "-NoProfile",
                "-Command",
                "try { Start-Process -FilePath $env:SHIBA_EDIT_FILE -Verb Edit -ErrorAction Stop } catch { Start-Process notepad.exe -ArgumentList $env:SHIBA_EDIT_FILE }",
            ])
            .spawn()
            .map_err(|e| format!("打开系统编辑器失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-t")
            .arg(&pb)
            .spawn()
            .map_err(|e| format!("打开系统编辑器失败: {}", e))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&pb)
            .spawn()
            .map_err(|e| format!("打开系统编辑器失败: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// External Script HTTP Push Receiver (Zero Polling Overhead)
// ============================================================================

const MAX_PUSH_BODY_BYTES: usize = 1024 * 1024; // 1 MB max per push payload

pub struct InfoPushServerState {
    pub running: Arc<AtomicBool>,
    pub port: Arc<Mutex<u16>>,
    pub allow_lan: Arc<Mutex<bool>>,
    pub auto_create: Arc<AtomicBool>,
    pub tokens: Arc<Mutex<HashMap<String, Option<String>>>>,
    pub last_error: Arc<Mutex<Option<String>>>,
}

impl Default for InfoPushServerState {
    fn default() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            port: Arc::new(Mutex::new(18421)),
            allow_lan: Arc::new(Mutex::new(false)),
            auto_create: Arc::new(AtomicBool::new(true)),
            tokens: Arc::new(Mutex::new(HashMap::new())),
            last_error: Arc::new(Mutex::new(None)),
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InfoPushServerStatus {
    pub running: bool,
    pub port: u16,
    pub allow_lan: bool,
    pub auto_create: bool,
    pub base_url: String,
    pub lan_url: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoPushRule {
    pub key: String,
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InfoPushEventPayload {
    pub key: String,
    pub title: Option<String>,
    pub content_type: String,
    pub body: String,
    pub remote_addr: String,
    pub received_at: String,
}

fn build_push_status(state: &InfoPushServerState) -> InfoPushServerStatus {
    let running = state.running.load(Ordering::SeqCst);
    let port = *state.port.lock().unwrap();
    let allow_lan = *state.allow_lan.lock().unwrap();
    let auto_create = state.auto_create.load(Ordering::SeqCst);
    let error = state.last_error.lock().unwrap().clone();
    let base_url = format!("http://127.0.0.1:{}", port);
    let lan_url = if allow_lan {
        Some(format!("http://{}:{}", crate::detect_lan_ip(), port))
    } else {
        None
    };
    InfoPushServerStatus {
        running,
        port,
        allow_lan,
        auto_create,
        base_url,
        lan_url,
        error,
    }
}

fn decode_percent(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(val) = u8::from_str_radix(hex, 16) {
                    out.push(val);
                    i += 3;
                    continue;
                }
            }
        } else if bytes[i] == b'+' {
            out.push(b' ');
            i += 1;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        if let Some((k, v)) = pair.split_once('=') {
            map.insert(decode_percent(k), decode_percent(v));
        } else {
            map.insert(decode_percent(pair), String::new());
        }
    }
    map
}

fn send_push_http_response(stream: &mut TcpStream, status: &str, body_json: &str) {
    let bytes = body_json.as_bytes();
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, X-Shiba-Token, X-Shiba-Key, X-Shiba-Title\r\nConnection: close\r\n\r\n",
        status,
        bytes.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(bytes);
    let _ = stream.flush();
}

fn handle_push_client(
    mut stream: TcpStream,
    app: AppHandle,
    tokens: Arc<Mutex<HashMap<String, Option<String>>>>,
    auto_create: Arc<AtomicBool>,
) {
    let remote_addr = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));

    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let mut header_end: Option<usize> = None;
    let mut content_length: usize = 0;
    let mut sent_continue = false;

    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if header_end.is_none() {
                    if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        header_end = Some(pos + 4);
                        let headers_str = String::from_utf8_lossy(&buf[..pos]);
                        for line in headers_str.lines().skip(1) {
                            if let Some((k, v)) = line.split_once(':') {
                                let kl = k.trim().to_ascii_lowercase();
                                if kl == "content-length" {
                                    content_length = v.trim().parse().unwrap_or(0);
                                } else if kl == "expect"
                                    && v.trim().eq_ignore_ascii_case("100-continue")
                                    && !sent_continue
                                {
                                    sent_continue = true;
                                    let _ = stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n");
                                    let _ = stream.flush();
                                }
                            }
                        }
                        if content_length > MAX_PUSH_BODY_BYTES {
                            send_push_http_response(
                                &mut stream,
                                "413 Payload Too Large",
                                r#"{"ok":false,"error":"payload exceeds 1MB limit"}"#,
                            );
                            return;
                        }
                    }
                }
                if let Some(end) = header_end {
                    if buf.len() >= end + content_length {
                        break;
                    }
                }
                if buf.len() > MAX_PUSH_BODY_BYTES + 16384 {
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
    let mut lines = head_str.lines();
    let first_line = lines.next().unwrap_or("");
    let mut req_parts = first_line.split_whitespace();
    let method = req_parts.next().unwrap_or("GET").to_ascii_uppercase();
    let raw_target = req_parts.next().unwrap_or("/");
    let (path_only, query_str) = raw_target
        .split_once('?')
        .unwrap_or((raw_target, ""));
    let query = parse_query_params(query_str);

    let mut req_headers: HashMap<String, String> = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            req_headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    if method == "OPTIONS" {
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, X-Shiba-Token, X-Shiba-Key, X-Shiba-Title\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes());
        let _ = stream.flush();
        return;
    }

    if method == "GET" && (path_only == "/api/info/health" || path_only == "/health") {
        send_push_http_response(
            &mut stream,
            "200 OK",
            r#"{"ok":true,"service":"shibaplan-info-push"}"#,
        );
        return;
    }

    let is_push_route =
        path_only == "/api/info/push" || path_only.starts_with("/api/info/push/");
    if method == "POST" && is_push_route {
        let path_key = path_only
            .strip_prefix("/api/info/push/")
            .map(|s| decode_percent(s.trim_matches('/')))
            .unwrap_or_default();
        let push_key = if !path_key.is_empty() {
            path_key
        } else if let Some(qk) = query.get("key").filter(|s| !s.trim().is_empty()) {
            qk.trim().to_string()
        } else if let Some(hk) = req_headers.get("x-shiba-key").filter(|s| !s.trim().is_empty()) {
            hk.trim().to_string()
        } else {
            String::new()
        };

        if push_key.is_empty() {
            send_push_http_response(
                &mut stream,
                "400 Bad Request",
                r#"{"ok":false,"error":"missing push key in URL path or ?key="}"#,
            );
            return;
        }

        let provided_token = req_headers
            .get("x-shiba-token")
            .cloned()
            .or_else(|| {
                req_headers
                    .get("authorization")
                    .and_then(|v| {
                        let trimmed = v.trim();
                        if trimmed.len() > 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
                            Some(trimmed[7..].trim().to_string())
                        } else {
                            Some(trimmed.to_string())
                        }
                    })
            })
            .or_else(|| query.get("token").cloned());

        let (matched, authorized) = {
            let map = tokens.lock().unwrap();
            if let Some(expected_opt) = map.get(&push_key) {
                let ok = match expected_opt {
                    Some(expected) if !expected.is_empty() => {
                        provided_token.as_deref() == Some(expected.as_str())
                    }
                    _ => true,
                };
                (true, ok)
            } else {
                (false, true)
            }
        };

        if matched && !authorized {
            send_push_http_response(
                &mut stream,
                "401 Unauthorized",
                r#"{"ok":false,"error":"invalid push token"}"#,
            );
            return;
        }

        if !matched && !auto_create.load(Ordering::SeqCst) {
            send_push_http_response(
                &mut stream,
                "404 Not Found",
                r#"{"ok":false,"error":"unknown push key and autoCreate is disabled"}"#,
            );
            return;
        }

        let body_end = buf.len().min(end + content_length);
        let body_str = String::from_utf8_lossy(&buf[end..body_end]).to_string();
        let content_type = req_headers
            .get("content-type")
            .cloned()
            .unwrap_or_else(|| "text/plain".to_string());
        let title = query
            .get("title")
            .cloned()
            .or_else(|| req_headers.get("x-shiba-title").cloned())
            .filter(|s| !s.trim().is_empty());
        let received_at = Local::now().to_rfc3339();

        let event_payload = InfoPushEventPayload {
            key: push_key.clone(),
            title,
            content_type,
            body: body_str,
            remote_addr,
            received_at: received_at.clone(),
        };

        let _ = app.emit("info-push-received", event_payload);
        let resp = serde_json::json!({
            "ok": true,
            "key": push_key,
            "matched": matched,
            "receivedAt": received_at,
        })
        .to_string();
        send_push_http_response(&mut stream, "200 OK", &resp);
        return;
    }

    send_push_http_response(
        &mut stream,
        "404 Not Found",
        r#"{"ok":false,"error":"route not found; POST /api/info/push/<key>"}"#,
    );
}

#[tauri::command]
pub fn get_info_push_server_status(
    state: tauri::State<'_, InfoPushServerState>,
) -> InfoPushServerStatus {
    build_push_status(&state)
}

#[tauri::command]
pub fn start_info_push_server(
    app: AppHandle,
    state: tauri::State<'_, InfoPushServerState>,
    port: Option<u16>,
    allow_lan: Option<bool>,
    auto_create: Option<bool>,
) -> Result<InfoPushServerStatus, String> {
    let target_port = port.unwrap_or(18421).max(1024);
    let target_lan = allow_lan.unwrap_or(false);
    if let Some(ac) = auto_create {
        state.auto_create.store(ac, Ordering::SeqCst);
    }

    let cur_port = *state.port.lock().unwrap();
    let cur_lan = *state.allow_lan.lock().unwrap();
    if state.running.load(Ordering::SeqCst) {
        if cur_port == target_port && cur_lan == target_lan {
            return Ok(build_push_status(&state));
        }
        // Stop old listener before binding new port/address
        state.running.store(false, Ordering::SeqCst);
        thread::sleep(Duration::from_millis(90));
    }

    let bind_ip = if target_lan { "0.0.0.0" } else { "127.0.0.1" };
    let listener = match TcpListener::bind((bind_ip, target_port)) {
        Ok(l) => l,
        Err(e) => {
            let msg = format!("启动推送接收服务失败（{}:{}）: {}", bind_ip, target_port, e);
            *state.last_error.lock().unwrap() = Some(msg.clone());
            return Err(msg);
        }
    };
    let _ = listener.set_nonblocking(true);

    *state.port.lock().unwrap() = target_port;
    *state.allow_lan.lock().unwrap() = target_lan;
    *state.last_error.lock().unwrap() = None;
    state.running.store(true, Ordering::SeqCst);

    let running_flag = state.running.clone();
    let tokens_ref = state.tokens.clone();
    let auto_create_ref = state.auto_create.clone();

    thread::spawn(move || {
        while running_flag.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    let app_inner = app.clone();
                    let tok = tokens_ref.clone();
                    let ac = auto_create_ref.clone();
                    thread::spawn(move || {
                        handle_push_client(stream, app_inner, tok, ac);
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => break,
            }
        }
    });

    Ok(build_push_status(&state))
}

#[tauri::command]
pub fn stop_info_push_server(
    state: tauri::State<'_, InfoPushServerState>,
) -> InfoPushServerStatus {
    state.running.store(false, Ordering::SeqCst);
    *state.last_error.lock().unwrap() = None;
    build_push_status(&state)
}

#[tauri::command]
pub fn sync_info_push_rules(
    state: tauri::State<'_, InfoPushServerState>,
    rules: Vec<InfoPushRule>,
    auto_create: bool,
) {
    state.auto_create.store(auto_create, Ordering::SeqCst);
    let mut map = state.tokens.lock().unwrap();
    map.clear();
    for rule in rules {
        let key = rule.key.trim().to_string();
        if !key.is_empty() {
            let tok = rule.token.filter(|t| !t.trim().is_empty());
            map.insert(key, tok);
        }
    }
}
