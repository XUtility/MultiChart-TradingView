use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    webview::WebviewBuilder, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size,
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
}

#[derive(Default)]
pub struct AppState {
    pub active_charts: Mutex<HashMap<String, ChartPaneInfo>>,
    pub charts_visible: Mutex<bool>,
}

pub mod commands {
    use super::*;

    #[tauri::command]
    pub async fn sync_chart_views(
        window: tauri::Window,
        panes: Vec<ChartPaneInfo>,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        let mut active = state.active_charts.lock().map_err(|e| e.to_string())?;
        let global_visible = *state.charts_visible.lock().map_err(|e| e.to_string())?;

        let mut new_wv_created = 0;
        for pane in &panes {
            let is_visible = pane.visible && global_visible;
            let w = pane.width.max(10.0);
            let h = pane.height.max(10.0);

            if let Some(existing_wv) = window.app_handle().get_webview(&pane.id) {
                if is_visible {
                    let _ = existing_wv.show();
                    let _ = existing_wv.set_position(Position::Logical(LogicalPosition::new(pane.x, pane.y)));
                    let _ = existing_wv.set_size(Size::Logical(LogicalSize::new(w, h)));
                } else {
                    let _ = existing_wv.hide();
                }
            } else if is_visible {
                if new_wv_created > 0 {
                    std::thread::sleep(std::time::Duration::from_millis(180));
                }
                new_wv_created += 1;

                let target_url = format!(
                    "https://www.tradingview.com/chart/?symbol={}&interval={}&theme=dark&pane_id={}&clean_mode=1&hide_drawing=0",
                    urlencoding::encode(&pane.symbol),
                    urlencoding::encode(&pane.timeframe),
                    urlencoding::encode(&pane.id)
                );

                let app_handle = window.app_handle().clone();
                let parsed_url: url::Url = target_url.parse().map_err(|e: url::ParseError| e.to_string())?;

                let wv_builder = WebviewBuilder::new(&pane.id, WebviewUrl::External(parsed_url))
                    .initialization_script(CHART_PRELOAD_SCRIPT)
                    .on_new_window(|_url, _features| {
                        tauri::webview::NewWindowResponse::Allow
                    })
                    .on_navigation(|url| {
                        println!("[Tauri child on_navigation] {:?}", url);
                        true
                    })
                    .on_page_load(|wv, _payload| {
                        let _ = wv.eval("if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') { window.__TVSync.ensureFullBleedLayout(); }");
                    })
                    .on_document_title_changed(move |_wv, title| {
                        if let Some(payload_str) = title.strip_prefix("TV_IPC:") {
                            if let Ok(val) = serde_json::from_str::<serde_json::Value>(payload_str) {


                                // 2. Direct evaluation in main window frontend
                                if let Some(main_wv) = app_handle.get_webview("main") {
                                    let script = format!(
                                        "if(window.__tvReceiveChartMessage)window.__tvReceiveChartMessage({});",
                                        payload_str
                                    );
                                    let _ = main_wv.eval(&script);
                                }

                                // 3. Also emit standard event for any event listeners
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
                        println!("[Tauri] Successfully created child webview '{}' at ({}, {}) {}x{}", pane.id, pane.x, pane.y, w, h);
                    }
                    Err(e) => {
                        eprintln!("[Tauri] ERROR: Failed to create child webview '{}': {:?}", pane.id, e);
                    }
                }
            }
            active.insert(pane.id.clone(), pane.clone());
        }

        Ok(())
    }

    #[tauri::command]
    pub fn set_charts_visible(
        app: tauri::AppHandle,
        visible: bool,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        let mut g_visible = state.charts_visible.lock().map_err(|e| e.to_string())?;
        *g_visible = visible;

        let active = state.active_charts.lock().map_err(|e| e.to_string())?;
        for (id, pane) in active.iter() {
            if let Some(wv) = app.get_webview(id) {
                if visible && pane.visible {
                    let _ = wv.show();
                } else {
                    let _ = wv.hide();
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
        if let Some(wv) = app.get_webview(&pane_id) {
            let _ = wv.eval(&script);
        }
        Ok(())
    }

    #[tauri::command]
    pub fn eval_in_all_charts(
        app: tauri::AppHandle,
        script: String,
        state: tauri::State<'_, AppState>,
    ) -> Result<(), String> {
        let active = state.active_charts.lock().map_err(|e| e.to_string())?;
        for id in active.keys() {
            if let Some(wv) = app.get_webview(id) {
                let _ = wv.eval(&script);
            }
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
}

use commands::*;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState {
        active_charts: Mutex::new(HashMap::new()),
        charts_visible: Mutex::new(true),
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
        .invoke_handler(tauri::generate_handler![
            sync_chart_views,
            set_charts_visible,
            eval_in_chart,
            eval_in_all_charts,
            broadcast_sync,
            search_symbols,
            start_browser_login,
            submit_auth_token,
            read_clipboard,
            window_minimize,
            window_maximize,
            window_close,
            toggle_fullscreen,
            open_new_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
