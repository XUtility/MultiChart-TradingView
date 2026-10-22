/**
 * Tauri Bridge for MultiChart-TradingView
 * Bridges window.electronAPI calls to native Tauri v2 commands and event emitters.
 * Enables app.js to run identically on both Electron and Tauri with zero regressions.
 */
(function() {
  if (typeof window === 'undefined') return;

  window.__chartMessageListeners = window.__chartMessageListeners || [];
  window.__syncChartSeq = window.__syncChartSeq || 0;
  window.__syncChartSession = Date.now();
  window.__broadcastSyncListeners = window.__broadcastSyncListeners || [];
  window.__windowCountListeners = window.__windowCountListeners || [];
  window.__sessionLoginListeners = window.__sessionLoginListeners || [];
  window.__updateProgressListeners = window.__updateProgressListeners || [];

  // Global direct dispatch hook called by Rust native backend eval
  window.__tvReceiveChartMessage = function(msg) {
    if (!msg) return;
    window.__chartMessageListeners.forEach(fn => {
      try { fn(msg); } catch(e) { console.error('[TauriBridge] onChartMessage error:', e); }
    });
  };

  function getInvoke() {
    const tauri = window.__TAURI__ || window.__TAURI_INTERNALS__;
    if (!tauri) return null;
    return (tauri.core && typeof tauri.core.invoke === 'function' ? tauri.core.invoke : null) ||
           (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function' ? window.__TAURI_INTERNALS__.invoke : null) ||
           (typeof tauri.invoke === 'function' ? tauri.invoke : null);
  }

  function safeInvoke(cmd, args) {
    const fn = getInvoke();
    if (fn) {
      return fn(cmd, args || {});
    }
    return new Promise((resolve, reject) => {
      let tries = 0;
      const poll = setInterval(() => {
        tries++;
        const readyFn = getInvoke();
        if (readyFn) {
          clearInterval(poll);
          readyFn(cmd, args || {}).then(resolve).catch(reject);
        } else if (tries > 40) {
          clearInterval(poll);
          reject(new Error('Tauri invoke timed out for command: ' + cmd));
        }
      }, 25);
    });
  }

  // Define window.electronAPI SYNCHRONOUSLY so app.js can attach listeners without race conditions
  window.electronAPI = {
    isTauri: true,

    minimizeWindow: () => safeInvoke('window_minimize'),
    maximizeWindow: () => safeInvoke('window_maximize'),
    closeWindow: () => safeInvoke('window_close'),
    toggleFullscreen: () => safeInvoke('toggle_fullscreen'),

    broadcastSync: (data) => safeInvoke('broadcast_sync', { data }),
    onBroadcastSync: (callback) => {
      if (typeof callback === 'function') window.__broadcastSyncListeners.push(callback);
    },

    openNewWindow: (config) => safeInvoke('open_new_window', { config: config || null }),
    onWindowCountUpdate: (callback) => {
      if (typeof callback === 'function') window.__windowCountListeners.push(callback);
    },

    getChartPreloadPath: () => '',
    searchSymbols: (query) => safeInvoke('search_symbols', { query }),
    openExternal: (url) => safeInvoke('start_browser_login'),
    openLoginWindow: () => safeInvoke('start_browser_login'),
    startBrowserLogin: () => safeInvoke('start_browser_login'),
    submitAuthToken: (tokenOrUrl) => safeInvoke('submit_auth_token', { tokenOrUrl, keySource: null }),
    readClipboardText: () => safeInvoke('read_clipboard'),
    openAccountLoginWindow: (accountId) => safeInvoke('open_account_login_window', { accountId: accountId || 'acc_1' }),
    checkLoginStatus: async () => ({ loggedIn: false }),
    onSessionLoginCompleted: (callback) => {
      if (typeof callback === 'function') window.__sessionLoginListeners.push(callback);
    },

    // Tauri Native Multi-Chart View Controllers
    // Each push carries a rising sequence number: requests are asynchronous and can overlap,
    // and the native layer must apply the newest layout, never an older one that arrives late.
    syncChartViews: (panes) => safeInvoke('sync_chart_views', {
      panes, session: window.__syncChartSession, seq: ++window.__syncChartSeq
    }),
    closeChartViews: (paneIds) => safeInvoke('close_chart_views', { paneIds }),
    logToFile: (msg) => safeInvoke('log_to_file', { msg }),
    setChartsVisible: (visible) => safeInvoke('set_charts_visible', { visible }),
    overlayShow: () => safeInvoke('overlay_show'),
    overlayHide: () => safeInvoke('overlay_hide'),
    overlayPublish: (markup) => safeInvoke('overlay_publish', { markup }),
    overlayRefocus: () => safeInvoke('overlay_refocus'),
    evalInChart: (paneId, script) => safeInvoke('eval_in_chart', { paneId, script }),
    evalInAllCharts: (script) => safeInvoke('eval_in_all_charts', { script }),
    onChartMessage: (callback) => {
      if (typeof callback === 'function') {
        window.__chartMessageListeners.push(callback);
      }
    },

    updateCheck: () => safeInvoke('update_check'),
    updateDownload: (url, sha256) => safeInvoke('update_download', { url, sha256: sha256 || null }),
    updateInstall: (path) => safeInvoke('update_install', { path }),
    onUpdateProgress: (callback) => {
      if (typeof callback === 'function') window.__updateProgressListeners.push(callback);
    }
  };

  // Wire up Tauri event listeners as soon as event module is available
  function initTauriEventListeners() {
    const tauri = window.__TAURI__ || window.__TAURI_INTERNALS__;
    const eventModule = (tauri && tauri.event) || (window.__TAURI__ && window.__TAURI__.event);
    if (eventModule && eventModule.listen) {
      eventModule.listen('chart-message', (event) => {
        window.__tvReceiveChartMessage(event.payload);
      });
      eventModule.listen('on-broadcast-sync', (event) => {
        window.__broadcastSyncListeners.forEach(fn => { try { fn(event.payload); } catch(e) {} });
      });
      eventModule.listen('window-count-update', (event) => {
        window.__windowCountListeners.forEach(fn => { try { fn(event.payload); } catch(e) {} });
      });
      eventModule.listen('session-login-completed', (event) => {
        window.__sessionLoginListeners.forEach(fn => { try { fn(event.payload); } catch(e) {} });
      });
      eventModule.listen('update-progress', (event) => {
        window.__updateProgressListeners.forEach(fn => { try { fn(event.payload); } catch(e) {} });
      });
      return true;
    }
    return false;
  }

  if (!initTauriEventListeners()) {
    let retries = 0;
    const poll = setInterval(() => {
      retries++;
      if (initTauriEventListeners() || retries > 50) {
        clearInterval(poll);
      }
    }, 50);
  }

  console.log('[TauriBridge] Synchronous window.electronAPI initialized successfully.');
})();
