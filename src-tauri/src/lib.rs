use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{
    webview::{Color, WebviewBuilder}, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size,
    WebviewUrl,
};
use serde::{Deserialize, Serialize};

const CHART_PRELOAD_SCRIPT: &str = include_str!("../../chart-preload.js");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChartPaneInfo {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub symbol: String,
    pub timeframe: String,
    pub visible: bool,
    #[serde(default)]
    pub account_id: Option<String>,
}

use std::sync::atomic::{AtomicU64, Ordering};
static WV_SEQ: AtomicU64 = AtomicU64::new(1);
/// Newest layout request already applied, as (page session, counter). Requests are async and
/// overlap whenever a cold webview is being created, and an older one arriving late must never
/// hide a pane that a newer one just showed. The session makes a shell reload restart the run.
static SYNC_APPLIED: std::sync::Mutex<(u64, u64)> = std::sync::Mutex::new((0, 0));

/// `sync_chart_views` is async and awaits between webview creations, so two overlapping
/// IPC calls could both see an empty registry slot and create a webview for the same pane.
/// The extra one stayed hidden underneath, so hiding "the" chart left a visible orphan.
static SYNC_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// How many *hidden* chart webviews stay loaded. Each one is a full TradingView page in its
/// own WebView2 browser processes, so the pool is sized from physical RAM instead of a fixed
/// count: a cap of 4 could not hold a 5-account workspace, so every tab switch rebuilt ~8
/// panes from scratch and the user watched the charts reload each time.
const MIN_WARM_PANES: usize = 6;
const MAX_WARM_PANES: usize = 28;
/// A machine already this short on free RAM sheds its warm panes down to the minimum; this is
/// the guard that keeps the shell answering once several account tabs have been visited.
const LOW_FREE_RAM: u64 = 4 * 1024 * 1024 * 1024;
const RAM_PER_WARM_PANE: u64 = 2 * 1024 * 1024 * 1024;

/// (total, available) physical memory in bytes.
#[cfg(windows)]
fn physical_memory() -> Option<(u64, u64)> {
    #[repr(C)]
    struct MEMORYSTATUSEX {
        dw_length: u32,
        dw_memory_load: u32,
        ull_total_phys: u64,
        ull_avail_phys: u64,
        ull_total_page_file: u64,
        ull_avail_page_file: u64,
        ull_total_virtual: u64,
        ull_avail_virtual: u64,
        ull_avail_extended_virtual: u64,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(lp_memory_status: *mut MEMORYSTATUSEX) -> i32;
    }

    let mut status = MEMORYSTATUSEX {
        dw_length: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        dw_memory_load: 0,
        ull_total_phys: 0,
        ull_avail_phys: 0,
        ull_total_page_file: 0,
        ull_avail_page_file: 0,
        ull_total_virtual: 0,
        ull_avail_virtual: 0,
        ull_avail_extended_virtual: 0,
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 {
        return None;
    }
    Some((status.ull_total_phys, status.ull_avail_phys))
}

#[cfg(not(windows))]
fn physical_memory() -> Option<(u64, u64)> {
    None
}

fn warm_budget() -> usize {
    let Some((total, available)) = physical_memory() else {
        return MAX_WARM_PANES;
    };
    if available < LOW_FREE_RAM {
        return MIN_WARM_PANES;
    }
    let by_ram = (total / RAM_PER_WARM_PANE) as usize;
    by_ram.clamp(MIN_WARM_PANES, MAX_WARM_PANES)
}

/// The shell's `--bg-primary`. WebView2 clears to black before the page paints, so an
/// unloaded pane reads as a dead window instead of an empty slot.
const SHELL_BG: Color = Color(19, 23, 34, 255);

/// Every live child webview label belonging to a pane, oldest first.
fn pane_labels(app: &tauri::AppHandle, pane_id: &str) -> Vec<String> {
    let prefix = format!("{}_v", pane_id);
    let mut found: Vec<(u64, String)> = app
        .webviews()
        .into_keys()
        .filter_map(|label| {
            let seq: u64 = label.strip_prefix(&prefix)?.parse().ok()?;
            Some((seq, label))
        })
        .collect();
    found.sort();
    found.into_iter().map(|(_, label)| label).collect()
}

/// Child webviews are labelled `<pane_id>_v<seq>`; everything else (`main`, `win_2`,
/// `login_acc_1`) belongs to the shell.
fn is_chart_label(label: &str) -> bool {
    label.rsplit_once("_v").is_some_and(|(_, seq)| seq.parse::<u64>().is_ok())
}

#[derive(Default)]
pub struct AppState {
    pub active_charts: Mutex<HashMap<String, ChartPaneInfo>>,
    pub charts_visible: Mutex<bool>,
    /// Pane id -> when its webview last went off screen. Oldest entries are dropped first.
    pub warm_hidden: Mutex<HashMap<String, Instant>>,
}

pub mod commands {
    use super::*;

    /// Apply a logical rect to a child webview, but only when it actually changed.
    /// Re-sending identical bounds is harmless but noisy; skipping it avoids spurious
    /// resize/layout passes inside the embedded TradingView page.
    fn apply_bounds_if_changed(wv: &tauri::Webview, x: f64, y: f64, w: f64, h: f64) {
        let scale = wv.window().scale_factor().unwrap_or(1.0);
        let px = (x * scale).round() as i32;
        let py = (y * scale).round() as i32;
        let pw = (w * scale).round().max(1.0) as u32;
        let ph = (h * scale).round().max(1.0) as u32;

        let cur_pos = wv.position().ok();
        let cur_size = wv.size().ok();

        let same_pos = matches!(cur_pos, Some(p) if p.x == px && p.y == py);
        let same_size = matches!(cur_size, Some(s) if s.width == pw && s.height == ph);

        if !same_pos {
            let _ = wv.set_position(Position::Logical(LogicalPosition::new(x, y)));
        }
        if !same_size {
            let _ = wv.set_size(Size::Logical(LogicalSize::new(w, h)));
        }
    }

    /// Keep only the newest child webview of a pane and close the orphans left behind by
    /// earlier races; returns the survivor.
    fn prune_pane_webviews(app: &tauri::AppHandle, pane_id: &str) -> Option<tauri::Webview> {
        let labels = pane_labels(app, pane_id);
        let keep = labels.last().cloned();
        for label in labels.iter().filter(|l| Some(*l) != keep.as_ref()) {
            if let Some(wv) = app.get_webview(label) {
                let _ = wv.close();
            }
        }
        keep.and_then(|l| app.get_webview(&l))
    }

    #[tauri::command]
    pub async fn sync_chart_views(
        window: tauri::Window,
        session: u64,
        seq: u64,
        panes: Vec<ChartPaneInfo>,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        let _guard = SYNC_LOCK.lock().await;

        {
            let mut last = SYNC_APPLIED.lock().map_err(|e| e.to_string())?;
            if session < last.0 || (session == last.0 && seq <= last.1) {
                return Ok(());
            }
            *last = (session, seq);
        }

        let app = window.app_handle().clone();
        let global_visible = *state.charts_visible.lock().map_err(|e| e.to_string())?;
        let current_active = state.active_charts.lock().map_err(|e| e.to_string())?.clone();

        for pane in &panes {
            let acc_id = pane.account_id.as_deref().unwrap_or("default");
            let mut existing = prune_pane_webviews(&app, &pane.id);

            // A profile switch needs a brand new webview: the data directory is fixed at
            // creation time, so the cookie store cannot be swapped in place.
            if let Some(info) = current_active.get(&pane.id) {
                if info.account_id.as_deref().unwrap_or("default") != acc_id {
                    if let Some(wv) = existing.take() {
                        let _ = wv.close();
                    }
                }
            }

            let is_visible = pane.visible && global_visible;
            let w = pane.width.max(10.0);
            let h = pane.height.max(10.0);

            let mut kept_hidden = false;
            if let Some(wv) = existing {
                if is_visible {
                    apply_bounds_if_changed(&wv, pane.x, pane.y, w, h);
                    let _ = wv.show();
                    let _ = wv.eval("if (window.__wakeUpChart) { window.__wakeUpChart(); }");
                } else {
                    // NEVER resize/move a hidden chart: a 1x1 resize makes TradingView run a
                    // destructive layout pass, so the chart comes back broken when re-shown.
                    let _ = wv.hide();
                    let _ = wv.eval("if (window.__sleepChart) { window.__sleepChart(); }");
                    kept_hidden = true;
                }
            } else if is_visible {
                let wv_seq_num = WV_SEQ.fetch_add(1, Ordering::SeqCst);
                let new_wv_label = format!("{}_v{}", pane.id, wv_seq_num);

                // Preserve user saved theme, candles, and background by omitting hardcoded theme parameter
                let target_url = format!(
                    "https://www.tradingview.com/chart/?symbol={}&interval={}&pane_id={}&clean_mode=1&hide_drawing=0",
                    urlencoding::encode(&pane.symbol),
                    urlencoding::encode(&pane.timeframe),
                    urlencoding::encode(&pane.id)
                );

                let app_handle = app.clone();
                let parsed_url: url::Url = target_url.parse().map_err(|e: url::ParseError| e.to_string())?;

                let mut wv_builder = WebviewBuilder::new(&new_wv_label, WebviewUrl::External(parsed_url))
                    .initialization_script(CHART_PRELOAD_SCRIPT)
                    .background_color(SHELL_BG);

                if let Ok(app_dir) = app_handle.path().app_data_dir() {
                    let prof_dir = app_dir.join("profiles").join(acc_id);
                    let _ = std::fs::create_dir_all(&prof_dir);
                    wv_builder = wv_builder.data_directory(prof_dir);
                }

                let wv_builder = wv_builder
                    .on_new_window(|_url, _features| {
                        tauri::webview::NewWindowResponse::Allow
                    })
                    .on_navigation(|url| {
                        println!("[Tauri child on_navigation] {:?}", url);
                        true
                    })
                    .on_page_load(|wv, _payload| {
                        let _ = wv.eval("if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') { window.__TVSync.ensureFullBleedLayout(); }");
                        let _ = wv.eval("if (window.__wakeUpChart) { window.__wakeUpChart(); }");
                    })
                    .on_document_title_changed(move |_wv, title| {
                        if let Some(payload_str) = title.strip_prefix("TV_IPC:") {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_str) {
                                if let Some(main_wv) = app_handle.get_webview("main") {
                                    let script = format!(
                                        "if(window.__tvReceiveChartMessage)window.__tvReceiveChartMessage({});",
                                        payload_str
                                    );
                                    let _ = main_wv.eval(&script);
                                }
                                let _ = app_handle.emit("chart-message", val);
                            }
                        }
                    });

                match window.add_child(
                    wv_builder,
                    LogicalPosition::new(pane.x, pane.y),
                    LogicalSize::new(w, h),
                ) {
                    Ok(_) => {
                        println!("[Tauri] Created child webview '{}' (pane '{}', acc '{}')", new_wv_label, pane.id, acc_id);
                    }
                    Err(e) => {
                        eprintln!("[Tauri] ERROR creating child webview '{}': {:?}", new_wv_label, e);
                    }
                }
            }

            if let Ok(mut warm) = state.warm_hidden.lock() {
                if kept_hidden {
                    warm.entry(pane.id.clone()).or_insert_with(Instant::now);
                } else {
                    warm.remove(&pane.id);
                }
            }

            if let Ok(mut act) = state.active_charts.lock() {
                if pane.visible && pane.width > 20.0 && pane.height > 20.0 {
                    act.insert(pane.id.clone(), pane.clone());
                } else {
                    act.remove(&pane.id);
                }
            }
        }

        let budget = warm_budget();
        let evict = {
            let warm = state.warm_hidden.lock().map_err(|e| e.to_string())?;
            if warm.len() <= budget {
                Vec::new()
            } else {
                let mut by_age: Vec<(Instant, String)> =
                    warm.iter().map(|(id, at)| (*at, id.clone())).collect();
                by_age.sort();
                by_age.truncate(warm.len() - budget);
                by_age.into_iter().map(|(_, id)| id).collect()
            }
        };
        for pane_id in evict {
            for label in pane_labels(&app, &pane_id) {
                if let Some(wv) = app.get_webview(&label) {
                    let _ = wv.close();
                }
            }
            if let Ok(mut warm) = state.warm_hidden.lock() {
                warm.remove(&pane_id);
            }
            println!("[Tauri] Evicted warm hidden chart '{}'", pane_id);
        }

        Ok(())
    }

    #[tauri::command]
    pub fn close_chart_views(
        app: tauri::AppHandle,
        pane_ids: Vec<String>,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        for id in &pane_ids {
            for label in pane_labels(&app, id) {
                if let Some(wv) = app.get_webview(&label) {
                    let _ = wv.close();
                }
            }
        }
        if let Ok(mut active) = state.active_charts.lock() {
            for id in &pane_ids {
                active.remove(id);
            }
        }
        if let Ok(mut warm) = state.warm_hidden.lock() {
            for id in &pane_ids {
                warm.remove(id);
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub fn set_charts_visible(
        app: tauri::AppHandle,
        visible: bool,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        let active_panes = {
            let mut g_visible = state.charts_visible.lock().map_err(|e| e.to_string())?;
            *g_visible = visible;
            state.active_charts.lock().map_err(|e| e.to_string())?.clone()
        };

        if !visible {
            // Hide the native chart webviews so HTML overlays (dropdown menus, modals) are
            // fully visible and clickable.
            //
            // IMPORTANT: only toggle visibility. Never resize/move the chart webviews here.
            // Shrinking them to 1x1 (the previous behaviour) makes the embedded TradingView
            // run a real resize + relayout pass, which destroys the chart state - when the
            // menu closes the chart comes back blank / squashed / scrolled to the wrong place.
            for id in active_panes.keys() {
                for label in pane_labels(&app, id) {
                    if let Some(wv) = app.get_webview(&label) {
                        let _ = wv.hide();
                    }
                }
            }
        } else {
            // RESTORE active panes to their exact positions and sizes
            for (id, pane) in &active_panes {
                if let Some(wv) = prune_pane_webviews(&app, id) {
                    apply_bounds_if_changed(
                        &wv,
                        pane.x,
                        pane.y,
                        pane.width.max(10.0),
                        pane.height.max(10.0),
                    );
                    let _ = wv.show();
                }
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub fn eval_in_chart(
        app: tauri::AppHandle,
        pane_id: String,
        script: String,
    ) -> Result<(), String> {
        if let Some(wv) = prune_pane_webviews(&app, &pane_id) {
            let _ = wv.eval(&script);
        }
        Ok(())
    }

    #[tauri::command]
    pub fn eval_in_all_charts(
        app: tauri::AppHandle,
        script: String,
    ) -> Result<(), String> {
        for (label, wv) in app.webviews() {
            if is_chart_label(&label) {
                let _ = wv.eval(&script);
            }
        }
        Ok(())
    }

    // --- NATIVE OVERLAY LAYER -------------------------------------------------------
    // Chart webviews are native windows, so they always paint above the shell's HTML and
    // swallow any dropdown rendered by the main webview. Rather than blanking the charts
    // for the whole time a menu is open, mirror the open overlay into a transparent,
    // non-activating popup owned by the main window and forward its pointer events back.

    pub const OVERLAY_LABEL: &str = "overlay";

    pub fn sync_overlay_bounds<R: tauri::Runtime>(main: &tauri::Window<R>, overlay: &tauri::WebviewWindow<R>) {
        if let (Ok(pos), Ok(size)) = (main.inner_position(), main.inner_size()) {
            let _ = overlay.set_position(Position::Physical(pos));
            let _ = overlay.set_size(Size::Physical(size));
        }
    }

    /// Keep clicks on the popup from activating it: keyboard focus must stay in the main
    /// window so the symbol search box keeps accepting typing while its list is mirrored.
    #[cfg(windows)]
    fn make_non_activating(win: &tauri::WebviewWindow) {
        extern "system" {
            fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
            fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
        }
        const GWL_EXSTYLE: i32 = -20;
        const WS_EX_TOOLWINDOW: isize = 0x0000_0080;
        const WS_EX_NOACTIVATE: isize = 0x0800_0000;

        if let Ok(hwnd) = win.hwnd() {
            let raw = hwnd.0 as isize;
            let ex = unsafe { GetWindowLongPtrW(raw, GWL_EXSTYLE) };
            unsafe { SetWindowLongPtrW(raw, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) };
        }
    }

    /// WebView2 hands keyboard focus to the popup's own render widget when it initialises,
    /// even though the window is non-activating, so the shell page stops receiving keys
    /// (`document.hasFocus()` goes false). Activating the main window is not enough: the
    /// key sink is the webview's child widget, so focus has to be set on that HWND.
    #[cfg(windows)]
    fn refocus_shell(app: &tauri::AppHandle) {
        #[repr(C)]
        struct Rect {
            left: i32,
            top: i32,
            right: i32,
            bottom: i32,
        }
        extern "system" {
            fn EnumChildWindows(
                parent: isize,
                cb: Option<unsafe extern "system" fn(isize, isize) -> i32>,
                lparam: isize,
            ) -> i32;
            fn GetClassNameW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
            fn GetWindowRect(hwnd: isize, rect: *mut Rect) -> i32;
            fn SetFocus(hwnd: isize) -> isize;
            fn SetForegroundWindow(hwnd: isize) -> i32;
        }
        unsafe extern "system" fn collect(hwnd: isize, lparam: isize) -> i32 {
            (*(lparam as *mut Vec<isize>)).push(hwnd);
            1
        }

        fn class(hwnd: isize) -> String {
            let mut buf = [0u16; 256];
            let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), 256) };
            if len <= 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buf[..len as usize])
        }

        fn area(hwnd: isize) -> i64 {
            let mut r = Rect { left: 0, top: 0, right: 0, bottom: 0 };
            if unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
                return 0;
            }
            (r.right - r.left) as i64 * (r.bottom - r.top) as i64
        }

        let moved = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(main_wv) = moved.get_webview("main") else { return };
            let window = main_wv.window();
            let Ok(hwnd) = window.hwnd() else { return };
            let _ = window.set_focus();
            // Keys follow the active window, so the popup has to lose the foreground too.
            unsafe { SetForegroundWindow(hwnd.0 as isize) };

            let mut kids: Vec<isize> = Vec::new();
            unsafe {
                EnumChildWindows(
                    hwnd.0 as isize,
                    Some(collect),
                    &mut kids as *mut Vec<isize> as isize,
                )
            };
            // One widget per webview; the shell is the only one covering the whole client,
            // because chart webviews are always laid out inside it.
            let shell = kids
                .iter()
                .filter(|h| class(**h) == "Chrome_WidgetWin_1")
                .max_by_key(|h| area(**h))
                .copied()
                .unwrap_or(0);
            if shell != 0 {
                unsafe { SetFocus(shell) };
            }
        });
    }

    #[cfg(not(windows))]
    fn refocus_shell(app: &tauri::AppHandle) {
        if let Some(main) = app.get_webview("main") {
            let _ = main.window().set_focus();
        }
    }

    /// The popup grabs focus again every time it is shown, so chase it for a moment.
    fn chase_shell_focus(app: &tauri::AppHandle) {
        refocus_shell(app);
        let delayed = app.clone();
        tokio::spawn(async move {
            for delay in [120u64, 260, 450, 800] {
                tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                refocus_shell(&delayed);
            }
        });
    }

    #[tauri::command]
    pub async fn overlay_show(app: tauri::AppHandle) -> Result<(), String> {
        // The shell webview is looked up as a plain webview: once the chart webviews are
        // attached to the same window, "main" is no longer a one-webview-per-window pair.
        let main_wv = app.get_webview("main").ok_or("main webview not found")?;
        let main = main_wv.window().clone();

        if let Some(existing) = app.get_webview_window(OVERLAY_LABEL) {
            sync_overlay_bounds(&main, &existing);
            let _ = existing.show();
            chase_shell_focus(&app);
            return Ok(());
        }

        let builder = tauri::WebviewWindowBuilder::new(
            &app,
            OVERLAY_LABEL,
            WebviewUrl::App("overlay.html".into()),
        )
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(false)
        .inner_size(200.0, 200.0);

        // An owned window floats above its owner (and above the native chart webviews that
        // live inside it) without covering unrelated applications.
        #[cfg(windows)]
        let builder = builder.owner_raw(main.hwnd().map_err(|e| e.to_string())?);
        #[cfg(not(windows))]
        let builder = builder.always_on_top(true);

        let overlay = builder.build().map_err(|e| e.to_string())?;

        #[cfg(windows)]
        make_non_activating(&overlay);
        sync_overlay_bounds(&main, &overlay);
        let _ = overlay.show();
        chase_shell_focus(&app);
        Ok(())
    }

    #[tauri::command]
    pub async fn overlay_refocus(app: tauri::AppHandle) -> Result<(), String> {
        refocus_shell(&app);
        Ok(())
    }

    #[tauri::command]
    pub async fn overlay_hide(app: tauri::AppHandle) -> Result<(), String> {
        if let Some(overlay) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = overlay.hide();
        }
        refocus_shell(&app);
        Ok(())
    }

    #[tauri::command]
    pub async fn overlay_publish(app: tauri::AppHandle, markup: String) -> Result<(), String> {
        let overlay = app
            .get_webview_window(OVERLAY_LABEL)
            .ok_or("overlay window not ready")?;
        let payload = serde_json::to_string(&markup).map_err(|e| e.to_string())?;
        overlay
            .eval(format!("window.__renderMirror && window.__renderMirror({payload});"))
            .map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub async fn overlay_event(app: tauri::AppHandle, event: serde_json::Value) -> Result<(), String> {
        if let Some(main) = app.get_webview("main") {
            let payload = serde_json::to_string(&event).map_err(|e| e.to_string())?;
            let _ = main.eval(format!("window.__mirrorEvent && window.__mirrorEvent({payload});"));
        }
        Ok(())
    }
    #[tauri::command]
    pub fn broadcast_sync(
        app: tauri::AppHandle,
        data: serde_json::Value,
    ) -> Result<(), String> {
        app.emit("on-broadcast-sync", data).map_err(|e| e.to_string())
    }

    fn strip_html_tags(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut inside_tag = false;
        for c in s.chars() {
            if c == '<' {
                inside_tag = true;
            } else if c == '>' {
                inside_tag = false;
            } else if !inside_tag {
                out.push(c);
            }
        }
        out.trim().to_string()
    }

    #[tauri::command]
    pub async fn search_symbols(query: String) -> Result<serde_json::Value, String> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(serde_json::json!([]));
        }

        let client = reqwest::Client::new();
        let url = format!(
            "https://symbol-search.tradingview.com/symbol_search/?text={}&hl=0",
            urlencoding::encode(q)
        );
        let resp = client
            .get(&url)
            .header("Referer", "https://www.tradingview.com/")
            .header("Origin", "https://www.tradingview.com")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            )
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

        let symbols = if let Some(arr) = body.as_array() {
            arr.clone()
        } else if let Some(arr) = body.get("symbols").and_then(|v| v.as_array()) {
            arr.clone()
        } else {
            Vec::new()
        };

        let mut results = Vec::new();
        for item in symbols.iter().take(12) {
            let raw_symbol = item.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
            let clean_symbol = strip_html_tags(raw_symbol);
            if clean_symbol.is_empty() {
                continue;
            }

            let raw_desc = item.get("description").and_then(|v| v.as_str()).unwrap_or("");
            let clean_desc = strip_html_tags(raw_desc);

            let prefix = item
                .get("prefix")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("exchange").and_then(|v| v.as_str()))
                .unwrap_or("");
            let exchange = item.get("exchange").and_then(|v| v.as_str()).unwrap_or(prefix);
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("").to_uppercase();
            let country = item.get("country").and_then(|v| v.as_str()).unwrap_or("");

            let full_ticker = if !prefix.is_empty() {
                format!("{}:{}", prefix, clean_symbol)
            } else if !exchange.is_empty() {
                format!("{}:{}", exchange, clean_symbol)
            } else {
                clean_symbol.clone()
            };

            results.push(serde_json::json!({
                "symbol": clean_symbol,
                "fullTicker": full_ticker,
                "description": if clean_desc.is_empty() { clean_symbol.clone() } else { clean_desc },
                "exchange": exchange,
                "type": item_type,
                "country": country
            }));
        }

        Ok(serde_json::Value::Array(results))
    }

    #[tauri::command]
    pub async fn start_browser_login() -> Result<serde_json::Value, String> {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let key_source = format!("tvd_{:x}", ms);
        let signin_url = format!(
            "https://www.tradingview.com/accounts/signin/?source=desktop&key_source={}",
            key_source
        );
        let _ = open::that(&signin_url);
        Ok(serde_json::json!({
            "success": true,
            "keySource": key_source,
            "url": signin_url
        }))
    }

    #[tauri::command]
    pub async fn submit_auth_token(
        app: tauri::AppHandle,
        token_or_url: String,
        key_source: Option<String>,
    ) -> Result<serde_json::Value, String> {
        let mut token = token_or_url.trim().to_string();
        if let Some(idx) = token.find("token=") {
            let substr = &token[idx + 6..];
            let end_idx = substr.find('&').unwrap_or(substr.len());
            token = substr[..end_idx].to_string();
        }

        if token.is_empty() {
            return Err("No token provided".to_string());
        }

        let client = reqwest::Client::new();
        let complete_url = if let Some(ks) = &key_source {
            format!(
                "https://www.tradingview.com/accounts/tvd/complete/?token={}&key_source={}",
                urlencoding::encode(&token),
                urlencoding::encode(ks)
            )
        } else {
            format!(
                "https://www.tradingview.com/accounts/tvd/complete/?token={}",
                urlencoding::encode(&token)
            )
        };

        let resp = client
            .post(&complete_url)
            .header("Referer", "https://www.tradingview.com/")
            .header("Origin", "https://www.tradingview.com")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
            )
            .send()
            .await;

        let mut session_id = token.clone();
        let mut username = "Trader".to_string();

        if let Ok(r) = resp {
            if let Ok(body) = r.json::<serde_json::Value>().await {
                if let Some(s) = body.get("sessionid").and_then(|v| v.as_str()) {
                    session_id = s.to_string();
                }
                if let Some(u) = body
                    .get("user")
                    .and_then(|u| u.get("username"))
                    .and_then(|v| v.as_str())
                {
                    username = u.to_string();
                }
            }
        }

        let status = serde_json::json!({
            "loggedIn": true,
            "username": username,
            "sessionid": session_id
        });
        let _ = app.emit("session-login-completed", &status);

        Ok(serde_json::json!({
            "success": true,
            "status": status
        }))
    }

    #[tauri::command]
    pub fn read_clipboard() -> Result<String, String> {
        let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
        cb.get_text().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn window_minimize(window: tauri::Window) -> Result<(), String> {
        window.minimize().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn window_maximize(window: tauri::Window) -> Result<(), String> {
        if window.is_maximized().unwrap_or(false) {
            window.unmaximize().map_err(|e| e.to_string())
        } else {
            window.maximize().map_err(|e| e.to_string())
        }
    }

    #[tauri::command]
    pub fn window_close(window: tauri::Window) -> Result<(), String> {
        window.close().map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn toggle_fullscreen(window: tauri::Window) -> Result<(), String> {
        let is_fs = window.is_fullscreen().unwrap_or(false);
        window.set_fullscreen(!is_fs).map_err(|e| e.to_string())
    }

    #[tauri::command]
    pub fn open_new_window(
        app: tauri::AppHandle,
        config: Option<serde_json::Value>,
    ) -> Result<(), String> {
        use std::sync::atomic::{AtomicU32, Ordering};
        static WIN_COUNTER: AtomicU32 = AtomicU32::new(1);
        let count = WIN_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
        let label = format!("win_{}", count);

        let (symbol, layout, timeframe) = if let Some(cfg) = &config {
            (
                cfg.get("symbol")
                    .and_then(|v| v.as_str())
                    .unwrap_or("BINANCE:BTCUSDT"),
                cfg.get("layout").and_then(|v| v.as_str()).unwrap_or("1"),
                cfg.get("timeframe")
                    .and_then(|v| v.as_str())
                    .unwrap_or("1D"),
            )
        } else {
            ("BINANCE:BTCUSDT", "1", "1D")
        };

        let query = format!(
            "windowId={}&windowNum={}&symbol={}&layout={}&timeframe={}",
            label, count, symbol, layout, timeframe
        );

        let win_url = format!("index.html?{}", query);

        let _win = tauri::WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::App(win_url.into()),
        )
        .title(format!("TradingView Multi-Window - Window {}", count))
        .inner_size(1450.0, 920.0)
        .min_inner_size(650.0, 500.0)
        .build()
        .map_err(|e| e.to_string())?;

        Ok(())
    }

    #[tauri::command]
    pub fn log_to_file(app: tauri::AppHandle, msg: String) -> Result<(), String> {
        // Opt-in diagnostics only: set TV_DEBUG_LOG=1 before launching to get a log file.
        // By default this is a no-op so the UI never pays for synchronous disk writes.
        if std::env::var("TV_DEBUG_LOG").is_err() {
            return Ok(());
        }
        use std::io::Write;
        let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("ui-debug.log"))
        {
            let _ = writeln!(f, "[JS] {}", msg);
        }
        Ok(())
    }

    #[tauri::command]
    pub fn open_account_login_window(
        app: tauri::AppHandle,
        account_id: String,
    ) -> Result<(), String> {
        let label = format!("login_{}", account_id);
        if let Some(existing) = app.get_webview_window(&label) {
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(());
        }

        let signin_url: url::Url = "https://www.tradingview.com/accounts/signin/"
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?;

        let mut builder = tauri::WebviewWindowBuilder::new(
            &app,
            &label,
            WebviewUrl::External(signin_url),
        )
        .title(format!("TradingView Sign In - Profile ({})", account_id))
        .inner_size(560.0, 720.0)
        .center();

        if let Ok(app_dir) = app.path().app_data_dir() {
            let prof_dir = app_dir.join("profiles").join(&account_id);
            let _ = std::fs::create_dir_all(&prof_dir);
            builder = builder.data_directory(prof_dir);
        }

        let _win = builder.build().map_err(|e| e.to_string())?;
        Ok(())
    }
}

use commands::*;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        active_charts: Mutex::new(HashMap::new()),
        charts_visible: Mutex::new(true),
        warm_hidden: Mutex::new(HashMap::new()),
    };

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            let win_keys: Vec<_> = app.webview_windows().keys().cloned().collect();
            println!("[Tauri setup] WebviewWindows in app: {:?}", win_keys);
            if let Some(win) = app.get_webview_window("main") {
                println!("[Tauri setup] Found main webview window!");
                let _ = win.show();
                let _ = win.set_focus();
            } else if let Some(win) = app.get_window("main") {
                println!("[Tauri setup] Found main window (not webview window)!");
                let _ = win.show();
                let _ = win.set_focus();
            } else {
                eprintln!("[Tauri setup] Neither main webview window nor main window found!");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The popup is an owned window: it does not follow the shell on its own.
            if window.label() != "main" {
                return;
            }
            if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
                if let Some(overlay) = window.app_handle().get_webview_window(OVERLAY_LABEL) {
                    if overlay.is_visible().unwrap_or(false) {
                        sync_overlay_bounds(window, &overlay);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            sync_chart_views,
            close_chart_views,
            set_charts_visible,
            eval_in_chart,
            eval_in_all_charts,
            overlay_show,
            overlay_hide,
            overlay_refocus,
            overlay_publish,
            overlay_event,
            broadcast_sync,
            search_symbols,
            start_browser_login,
            submit_auth_token,
            read_clipboard,
            window_minimize,
            window_maximize,
            window_close,
            toggle_fullscreen,
            open_new_window,
            open_account_login_window,
            log_to_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
