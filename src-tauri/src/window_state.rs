use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const DEFAULT_MIN_WIDTH: f64 = 900.0;
const DEFAULT_MIN_HEIGHT: f64 = 600.0;
const SAVE_DEBOUNCE_MS: u64 = 350;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WindowGeometry {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    #[serde(default)]
    pub maximized: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct WindowStateStore {
    #[serde(default)]
    pub main: Option<WindowGeometry>,
}

struct WindowStateInner {
    path: PathBuf,
    store: WindowStateStore,
    ready: bool,
}

pub struct WindowStateManager {
    inner: Arc<Mutex<WindowStateInner>>,
    save_seq: Arc<AtomicU64>,
}

impl WindowStateManager {
    pub fn new(app: &AppHandle) -> Self {
        let path = resolve_state_path(app);
        let store = load_store_from_disk(&path);
        Self {
            inner: Arc::new(Mutex::new(WindowStateInner {
                path,
                store,
                ready: false,
            })),
            save_seq: Arc::new(AtomicU64::new(0)),
        }
    }

    /// Restore saved main window geometry/position/maximized state before showing it,
    /// then show and focus the window and enable subsequent state tracking.
    pub fn restore_and_show_main(&self, win: &WebviewWindow) {
        let saved = {
            let guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            guard.store.main.clone()
        };

        if let Some(geom) = saved {
            apply_validated_geometry(win, &geom);
            let _ = win.show();
            if geom.maximized {
                let _ = win.maximize();
            }
            let _ = win.unminimize();
            let _ = win.set_focus();
        } else {
            let _ = win.center();
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }

        if let Ok(mut guard) = self.inner.lock() {
            guard.ready = true;
        }
    }

    /// Record window resize/move/maximize changes for the main window (debounced disk write).
    pub fn record_main_window(&self, win: &WebviewWindow) {
        if !self.capture_main_geometry(win) {
            return;
        }

        let seq = self.save_seq.fetch_add(1, Ordering::SeqCst) + 1;
        let save_seq = Arc::clone(&self.save_seq);
        let inner = Arc::clone(&self.inner);

        thread::spawn(move || {
            thread::sleep(Duration::from_millis(SAVE_DEBOUNCE_MS));
            if save_seq.load(Ordering::SeqCst) != seq {
                return;
            }
            write_inner_to_disk(&inner);
        });
    }

    /// Capture current main window state (if visible and valid) and immediately flush to disk.
    pub fn flush_main_window(&self, win: Option<&WebviewWindow>) {
        if let Some(w) = win {
            let _ = self.capture_main_geometry(w);
        }
        // Cancel any pending debounced write by advancing sequence
        self.save_seq.fetch_add(1, Ordering::SeqCst);
        write_inner_to_disk(&self.inner);
    }

    fn capture_main_geometry(&self, win: &WebviewWindow) -> bool {
        let ready = self
            .inner
            .lock()
            .map(|g| g.ready)
            .unwrap_or(false);
        if !ready {
            return false;
        }

        if win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(true) {
            return false;
        }

        let is_max = win.is_maximized().unwrap_or(false);
        let mut guard = match self.inner.lock() {
            Ok(g) => g,
            Err(e) => e.into_inner(),
        };

        if is_max {
            if let Some(ref mut existing) = guard.store.main {
                if existing.maximized {
                    return false;
                }
                existing.maximized = true;
            } else {
                let scale = win.scale_factor().unwrap_or(1.0);
                guard.store.main = Some(WindowGeometry {
                    width: (1180.0 * scale).round() as u32,
                    height: (780.0 * scale).round() as u32,
                    x: 100,
                    y: 100,
                    maximized: true,
                });
            }
            return true;
        }

        let Ok(size) = win.inner_size() else {
            return false;
        };
        let Ok(pos) = win.outer_position() else {
            return false;
        };

        // Ignore invalid / minimized sentinel coordinates (e.g. Windows -32000)
        if size.width < 400 || size.height < 300 || pos.x <= -16000 || pos.y <= -16000 {
            return false;
        }

        let next = WindowGeometry {
            width: size.width,
            height: size.height,
            x: pos.x,
            y: pos.y,
            maximized: false,
        };

        if let Some(ref existing) = guard.store.main {
            if existing.width == next.width
                && existing.height == next.height
                && existing.x == next.x
                && existing.y == next.y
                && existing.maximized == next.maximized
            {
                return false;
            }
        }

        guard.store.main = Some(next);
        true
    }
}

fn resolve_state_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_local_data_dir()
        .ok()
        .or_else(|| dirs::config_dir().map(|d| d.join("ShibaPlan")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("window-state.json")
}

fn load_store_from_disk(path: &PathBuf) -> WindowStateStore {
    let Ok(raw) = fs::read_to_string(path) else {
        return WindowStateStore::default();
    };
    serde_json::from_str::<WindowStateStore>(&raw).unwrap_or_default()
}

fn write_inner_to_disk(inner: &Arc<Mutex<WindowStateInner>>) {
    let (path, json) = {
        let guard = inner.lock().unwrap_or_else(|e| e.into_inner());
        if guard.store.main.is_none() {
            return;
        }
        let Ok(serialized) = serde_json::to_string_pretty(&guard.store) else {
            return;
        };
        (guard.path.clone(), serialized)
    };

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let tmp_path = path.with_extension("json.tmp");
    if fs::write(&tmp_path, &json).is_ok() {
        if fs::rename(&tmp_path, &path).is_err() {
            let _ = fs::write(&path, &json);
            let _ = fs::remove_file(&tmp_path);
        }
    }
}

fn apply_validated_geometry(win: &WebviewWindow, geom: &WindowGeometry) {
    let monitors = win.available_monitors().unwrap_or_default();
    let fallback_scale = win.scale_factor().unwrap_or(1.0);

    let mut best_monitor = None;
    let mut best_overlap: i64 = 0;

    let gx1 = geom.x as i64;
    let gy1 = geom.y as i64;
    let gx2 = gx1 + geom.width as i64;
    let gy2 = gy1 + geom.height as i64;

    for mon in &monitors {
        let mp = mon.position();
        let ms = mon.size();
        let mx1 = mp.x as i64;
        let my1 = mp.y as i64;
        let mx2 = mx1 + ms.width as i64;
        let my2 = my1 + ms.height as i64;

        let ox = (gx2.min(mx2) - gx1.max(mx1)).max(0);
        let oy = (gy2.min(my2) - gy1.max(my1)).max(0);
        let area = ox * oy;
        let titlebar_reachable = gy1 >= my1 - 16 && gy1 < my2 - 40;

        if ox >= 120 && oy >= 80 && titlebar_reachable && area > best_overlap {
            best_overlap = area;
            best_monitor = Some(mon);
        }
    }

    if let Some(mon) = best_monitor {
        let scale = mon.scale_factor();
        let ms = mon.size();
        let min_w = (DEFAULT_MIN_WIDTH * scale).round() as u32;
        let min_h = (DEFAULT_MIN_HEIGHT * scale).round() as u32;
        let clamped_w = geom.width.clamp(min_w, ms.width.max(min_w));
        let clamped_h = geom.height.clamp(min_h, ms.height.max(min_h));

        let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(
            clamped_w, clamped_h,
        )));
        let _ = win.set_position(tauri::Position::Physical(PhysicalPosition::new(
            geom.x, geom.y,
        )));
    } else {
        // Saved monitor is no longer available or window was off-screen:
        // preserve the user's preferred size (clamped to primary monitor) and re-center.
        let target_mon = win
            .primary_monitor()
            .ok()
            .flatten()
            .or_else(|| monitors.into_iter().next());

        let (clamped_w, clamped_h) = if let Some(mon) = target_mon {
            let scale = mon.scale_factor();
            let ms = mon.size();
            let min_w = (DEFAULT_MIN_WIDTH * scale).round() as u32;
            let min_h = (DEFAULT_MIN_HEIGHT * scale).round() as u32;
            (
                geom.width.clamp(min_w, ms.width.max(min_w)),
                geom.height.clamp(min_h, ms.height.max(min_h)),
            )
        } else {
            let min_w = (DEFAULT_MIN_WIDTH * fallback_scale).round() as u32;
            let min_h = (DEFAULT_MIN_HEIGHT * fallback_scale).round() as u32;
            (geom.width.max(min_w), geom.height.max(min_h))
        };

        let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(
            clamped_w, clamped_h,
        )));
        let _ = win.center();
    }
}
