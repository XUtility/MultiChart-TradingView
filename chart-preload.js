/**
 * Chart Preload Script (High Performance 120 FPS / Zero Lag)
 * Injected into each TradingView webview instance.
 * Facilitates bidirectional synchronization: Crosshair, Symbol, Timeframe, and Drawings.
 */
let _ipcRenderer = null;
let webFrame = null;
try {
  if (typeof require === 'function') {
    const el = require('electron');
    _ipcRenderer = el.ipcRenderer;
    webFrame = el.webFrame;
  }
} catch(e) {}

let paneId = null;
try {
  const urlParams = new URLSearchParams(window.location.search);
  paneId = urlParams.get('pane_id');
} catch(e) {}

const __tvMessageHandlers = {};
const STUDIES_LEGEND_KEY = 'tv-splitsync-studies-legend';
const ipcRenderer = {
  sendToHost: function(channel, data) {
    if (_ipcRenderer && typeof _ipcRenderer.sendToHost === 'function') {
      _ipcRenderer.sendToHost(channel, data);
    } else {
      try {
        document.title = 'TV_IPC:' + JSON.stringify({ channel: channel, payload: data, paneId: paneId, _ts: Date.now() });
      } catch(err) {}
    }
  },
  on: function(channel, callback) {
    if (!__tvMessageHandlers[channel]) __tvMessageHandlers[channel] = [];
    __tvMessageHandlers[channel].push(callback);
    if (_ipcRenderer && typeof _ipcRenderer.on === 'function') {
      _ipcRenderer.on(channel, callback);
    }
  }
};

window.__tvDispatchMessage = function(channel, data) {
  const handlers = __tvMessageHandlers[channel];
  if (handlers) {
    handlers.forEach(fn => {
      try { fn({ channel: channel }, data); } catch(e) {}
    });
  }
};

/* TradingView paints a bare white (light profile) or black page for the seconds before the
   chart renders, which inside a grid of panes reads as a broken window. Cover it with the
   shell's own background until the first chart canvas is on screen. */
(function installBootVeil() {
  const BOOT_TIMEOUT_MS = 10000;
  const root = document.documentElement;
  if (!root) { setTimeout(installBootVeil, 15); return; }
  if (document.getElementById('tv-boot-veil')) return;

  const style = document.createElement('style');
  style.textContent =
    '#tv-boot-veil{position:fixed;inset:0;z-index:2147483000;background:#131722;' +
    'display:flex;align-items:center;justify-content:center;pointer-events:none}' +
    '#tv-boot-veil i{width:20px;height:20px;border-radius:50%;' +
    'border:2px solid rgba(209,212,220,.22);border-top-color:#2962ff;' +
    'animation:tv-boot-spin .8s linear infinite}' +
    '@keyframes tv-boot-spin{to{transform:rotate(360deg)}}';

  const veil = document.createElement('div');
  veil.id = 'tv-boot-veil';
  veil.appendChild(document.createElement('i'));
  root.appendChild(style);
  root.appendChild(veil);

  const startedAt = Date.now();
  const timer = setInterval(() => {
    let painted = false;
    const canvases = document.getElementsByTagName('canvas');
    for (let i = 0; i < canvases.length; i++) {
      if (canvases[i].width >= 100 && canvases[i].height >= 100) { painted = true; break; }
    }
    if (painted || Date.now() - startedAt > BOOT_TIMEOUT_MS) {
      clearInterval(timer);
      try { veil.remove(); style.remove(); } catch(e) {}
    }
  }, 150);
})();

(function() {
  let initHideDrawing = false;
  let initCleanMode = true;
  let initStudiesLegend = true;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    paneId = urlParams.get('pane_id') || paneId;
    if (urlParams.has('hide_drawing')) {
      initHideDrawing = urlParams.get('hide_drawing') === '1' || urlParams.get('hide_drawing') === 'true';
    }
    if (urlParams.has('clean_mode')) {
      initCleanMode = urlParams.get('clean_mode') !== '0' && urlParams.get('clean_mode') !== 'false';
    }
    // Each account profile has its own storage, so the legend preference is kept here as well
    // as in the shell; a webview rebuilt after startup restores it without waiting for a push.
    initStudiesLegend = localStorage.getItem(STUDIES_LEGEND_KEY) !== '0';
  } catch(e) {}

  if (!paneId) {
    try {
      paneId = 'pane_' + Math.random().toString(36).substring(2, 7);
    } catch(e) {
      paneId = 'pane_default';
    }
  }

  // --- MULTI-CHART STABILITY & ANTI-CONNECTION-DROP SHIELD ---
  // 1. Isolate BroadcastChannel per pane to prevent TradingView tab eviction across panes
  try {
    const OrigBroadcastChannel = window.BroadcastChannel;
    if (OrigBroadcastChannel) {
      window.BroadcastChannel = class ScopedBroadcastChannel extends OrigBroadcastChannel {
        constructor(channelName) {
          super(`${channelName}_${paneId || 'p'}`);
        }
      };
    }
  } catch(e) {}

  // 2. Isolate Web Locks (navigator.locks) so all panes acquire locks concurrently
  try {
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      const origRequest = navigator.locks.request.bind(navigator.locks);
      navigator.locks.request = function(name, options, callback) {
        const scopedName = (typeof name === 'string') ? `${name}_${paneId || 'p'}` : name;
        if (typeof options === 'function') {
          return origRequest(scopedName, options);
        }
        return origRequest(scopedName, options, callback);
      };
    }
  } catch(e) {}

  // 3. Prevent cross-tab heartbeat/session takeover via storage events
  try {
    const origAddEventListener = window.addEventListener.bind(window);
    window.addEventListener = function(type, listener, options) {
      if (type === 'storage') {
        const safeListener = function(event) {
          if (event && event.key) {
            const k = String(event.key).toLowerCase();
            if (
              k.includes('active_session') ||
              k.includes('chart_session') ||
              k.includes('active_tab') ||
              k.includes('heartbeat') ||
              k.includes('device_id') ||
              k.includes('concurrent') ||
              k.includes('tab_id') ||
              k.includes('session_id')
            ) {
              return;
            }
          }
          if (typeof listener === 'function') {
            return listener.call(this, event);
          } else if (listener && typeof listener.handleEvent === 'function') {
            return listener.handleEvent(event);
          }
        };
        return origAddEventListener(type, safeListener, options);
      }
      return origAddEventListener(type, listener, options);
    };
  } catch(e) {}

  // 4. WebSocket Optimization & Live Data Stream Tracking
  const _activeDataSockets = new Set();
  window.__activeDataSockets = _activeDataSockets;
  window.__isTabActive = true;

  try {
    const OrigWebSocket = window.WebSocket;
    if (OrigWebSocket) {
      function TrackedWebSocket(url, protocols) {
        let instance;
        if (protocols !== undefined) {
          instance = new OrigWebSocket(url, protocols);
        } else {
          instance = new OrigWebSocket(url);
        }

        _activeDataSockets.add(instance);
        const onCleanup = () => {
          _activeDataSockets.delete(instance);
        };
        instance.addEventListener('close', onCleanup);
        instance.addEventListener('error', onCleanup);

        return instance;
      }

      TrackedWebSocket.prototype = OrigWebSocket.prototype;
      TrackedWebSocket.CONNECTING = OrigWebSocket.CONNECTING || 0;
      TrackedWebSocket.OPEN = OrigWebSocket.OPEN || 1;
      TrackedWebSocket.CLOSING = OrigWebSocket.CLOSING || 2;
      TrackedWebSocket.CLOSED = OrigWebSocket.CLOSED || 3;

      window.WebSocket = TrackedWebSocket;
    }
  } catch(e) {}

  function applyInitialClasses() {
    try {
      if (initHideDrawing) {
        document.body && document.body.classList.add('hide-drawing-toolbar');
        document.documentElement && document.documentElement.classList.add('hide-drawing-toolbar');
      } else {
        document.body && document.body.classList.remove('hide-drawing-toolbar');
        document.documentElement && document.documentElement.classList.remove('hide-drawing-toolbar');
      }
      if (initCleanMode) {
        document.body && document.body.classList.add('clean-mode');
        document.documentElement && document.documentElement.classList.add('clean-mode');
      } else {
        document.body && document.body.classList.remove('clean-mode');
        document.documentElement && document.documentElement.classList.remove('clean-mode');
      }
      if (!initStudiesLegend) {
        document.body && document.body.classList.add('hide-studies-legend');
        document.documentElement && document.documentElement.classList.add('hide-studies-legend');
      }
    } catch(e) {}
  }

  let linkGroup = 'A';
  let isMouseOverThisChart = false;
  let lastReportedSymbol = '';
  let lastReportedTimeframe = '';

  // Cached viewport dimensions for ultra-fast ratio calculation (zero DOM reflows)
  let cachedWidth = window.innerWidth || 1200;
  let cachedHeight = window.innerHeight || 800;
  window.addEventListener('resize', () => {
    cachedWidth = window.innerWidth || 1200;
    cachedHeight = window.innerHeight || 800;
  }, { passive: true });

  // (Crosshair overlay removed per user request for clean performance)

  // Chart Info in-page DOM Overlay Badge
  let chartInfoOverlay = null;

  function createChartInfoOverlay() {
    if (chartInfoOverlay || document.getElementById('tv-splitsync-chart-info-overlay')) {
      chartInfoOverlay = document.getElementById('tv-splitsync-chart-info-overlay');
      return;
    }
    const container = document.body || document.documentElement;
    if (!container) return;

    chartInfoOverlay = document.createElement('div');
    chartInfoOverlay.id = 'tv-splitsync-chart-info-overlay';
    chartInfoOverlay.className = 'chart-info-overlay';

    chartInfoOverlay.innerHTML = `
      <div class="info-badge-details">
        <span class="info-badge-symbol" title="Current Symbol">---</span>
        <span class="info-badge-broker" style="display:none"></span>
        <button type="button" class="info-badge-tf" title="Click to change timeframe">
          <span class="info-badge-tf-label">---</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="8" height="8" class="info-badge-tf-arrow">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <button type="button" class="info-badge-studies" title="Indicators, metrics and strategies">ƒ Indicators</button>
      </div>
      <button type="button" class="info-badge-toggle" title="Toggle info badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>
      <div class="info-badge-tf-menu hidden">
        <div class="tf-menu-sec-title">Minutes</div>
        <div class="tf-menu-grid">
          <button type="button" class="tf-btn" data-tf="1">1m</button>
          <button type="button" class="tf-btn" data-tf="3">3m</button>
          <button type="button" class="tf-btn" data-tf="5">5m</button>
          <button type="button" class="tf-btn" data-tf="15">15m</button>
          <button type="button" class="tf-btn" data-tf="30">30m</button>
          <button type="button" class="tf-btn" data-tf="45">45m</button>
        </div>
        <div class="tf-menu-sec-title">Hours</div>
        <div class="tf-menu-grid tf-grid-4">
          <button type="button" class="tf-btn" data-tf="60">1h</button>
          <button type="button" class="tf-btn" data-tf="120">2h</button>
          <button type="button" class="tf-btn" data-tf="180">3h</button>
          <button type="button" class="tf-btn" data-tf="240">4h</button>
        </div>
        <div class="tf-menu-sec-title">Days & Weeks</div>
        <div class="tf-menu-grid">
          <button type="button" class="tf-btn" data-tf="D">1D</button>
          <button type="button" class="tf-btn" data-tf="W">1W</button>
          <button type="button" class="tf-btn" data-tf="M">1M</button>
        </div>
      </div>
    `;

    const toggleBtn = chartInfoOverlay.querySelector('.info-badge-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        chartInfoOverlay.classList.toggle('collapsed');
        const tfMenu = chartInfoOverlay.querySelector('.info-badge-tf-menu');
        if (tfMenu) tfMenu.classList.add('hidden');
      });
    }

    const tfBtn = chartInfoOverlay.querySelector('.info-badge-tf');
    const tfMenu = chartInfoOverlay.querySelector('.info-badge-tf-menu');
    if (tfBtn && tfMenu) {
      tfBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tfMenu.classList.toggle('hidden');
      });

      function applyTf(selectedTf) {
        if (!selectedTf) return;
        if (window.__TVSync && typeof window.__TVSync.setTimeframe === 'function') {
          window.__TVSync.setTimeframe(selectedTf);
          ipcRenderer.sendToHost('chart-timeframe-detected', { timeframe: selectedTf, paneId: paneId });
        }
        tfMenu.classList.add('hidden');
      }

      tfMenu.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const selectedTf = btn.getAttribute('data-tf');
          applyTf(selectedTf);
        });
      });

      document.addEventListener('click', (e) => {
        if (!tfMenu.contains(e.target) && !tfBtn.contains(e.target)) {
          tfMenu.classList.add('hidden');
        }
      });
    }

    // Clean mode hides TradingView's top toolbar, so the indicators dialog needs its own entry point.
    const studiesBtn = chartInfoOverlay.querySelector('.info-badge-studies');
    if (studiesBtn) {
      studiesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openIndicatorsDialog();
      });
    }

    container.appendChild(chartInfoOverlay);
  }

  function openIndicatorsDialog() {
    // Clean mode hides the top toolbar, but its button still handles the click.
    const btn = document.querySelector('[data-name="open-indicators-dialog"]');
    if (!btn) return false;
    btn.click();
    return true;
  }

  function updateStudiesBadge() {
    if (!chartInfoOverlay) return;
    const studiesBtn = chartInfoOverlay.querySelector('.info-badge-studies');
    if (!studiesBtn) return;
    const count = document.querySelectorAll('[class*="item-"][class*="study-"]').length;
    const label = count > 0 ? `\u0192 ${count}` : '\u0192 Indicators';
    // Rewriting identical text would re-trigger the layout observer that calls us.
    if (studiesBtn.textContent !== label) studiesBtn.textContent = label;
  }

  // The badge is pinned to the top-left, exactly where the chart legend draws its indicator list.
  function placeBadgeClearOfLegend() {
    if (!chartInfoOverlay) return;
    const legend = document.querySelector('[class*="chart-gui-wrapper__legend"]')
      || document.querySelector('[class*="chart-legend"]');
    const rect = legend ? legend.getBoundingClientRect() : null;
    const top = rect && rect.height > 2 ? Math.round(rect.bottom) + 6 : 10;
    chartInfoOverlay.style.setProperty('top', `${top}px`, 'important');
    updateStudiesBadge();
  }

  // Native Main World TradingView API and layout controller (Zero CSP restrictions)
  window.__TVSync = {
    getChartApi: function() {
      try {
        if (window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV) {
          return window.TradingViewApi._activeChartWidgetWV.value();
        }
        if (window.ChartApiInstance) return window.ChartApiInstance;
        var col = window._exposed_chartWidgetCollection;
        if (col && col.activeChartWidget) {
          return typeof col.activeChartWidget.value === 'function' ? col.activeChartWidget.value() : col.activeChartWidget;
        }
      } catch(e) {}
      return null;
    },

    setSymbol: function(symbol) {
      try {
        var chart = this.getChartApi();
        if (chart && typeof chart.setSymbol === 'function') {
          chart.setSymbol(symbol, {});
          this.updateChartInfo(symbol);
          return true;
        }
        var col = window._exposed_chartWidgetCollection;
        if (col && typeof col.setSymbol === 'function') {
          col.setSymbol(symbol);
          this.updateChartInfo(symbol);
          return true;
        }
      } catch(e) {}
      return false;
    },

    setTimeframe: function(tf) {
      try {
        var strTf = String(tf);
        var chart = this.getChartApi();
        if (chart && typeof chart.setResolution === 'function') {
          chart.setResolution(strTf, {});
          this.updateChartInfo(null, strTf);
          return true;
        }
        var col = window._exposed_chartWidgetCollection;
        if (col && typeof col.setResolution === 'function') {
          col.setResolution(strTf);
          this.updateChartInfo(null, strTf);
          return true;
        }
        var active = col && col.activeChartWidget ? (typeof col.activeChartWidget.value === 'function' ? col.activeChartWidget.value() : col.activeChartWidget) : null;
        if (active && typeof active.setResolution === 'function') {
          active.setResolution(strTf, {});
          this.updateChartInfo(null, strTf);
          return true;
        }
      } catch(e) {}
      return false;
    },

    updateChartInfo: function(sym, tf, brk) {
      createChartInfoOverlay();
      if (!chartInfoOverlay) return;
      if (sym) {
        let ticker = sym;
        let broker = brk || '';
        if (ticker.includes(':')) {
          const parts = ticker.split(':');
          if (!broker) broker = parts[0];
          ticker = parts[1];
        }
        const symEl = chartInfoOverlay.querySelector('.info-badge-symbol');
        const brkEl = chartInfoOverlay.querySelector('.info-badge-broker');
        if (symEl) symEl.textContent = ticker;
        if (brkEl) {
          brkEl.textContent = broker || 'TV';
          brkEl.style.display = broker ? 'inline-block' : 'none';
        }
      }
      if (tf) {
        const tfLabel = chartInfoOverlay.querySelector('.info-badge-tf-label') || chartInfoOverlay.querySelector('.info-badge-tf');
        let formattedTf = String(tf).toUpperCase();
        const tfMap = {
          '1': '1m', '2': '2m', '3': '3m', '5': '5m', '10': '10m', '15': '15m', '30': '30m', '45': '45m',
          '60': '1h', '120': '2h', '180': '3h', '240': '4h', '360': '6h', '480': '8h', '720': '12h',
          'D': '1D', '1D': '1D', '2D': '2D', '3D': '3D',
          'W': '1W', '1W': '1W', '2W': '2W',
          'M': '1M', '1M': '1M', '3M': '3M', '6M': '6M', '12M': '12M'
        };
        const displayTf = tfMap[formattedTf] || formattedTf;
        if (tfLabel) {
          tfLabel.textContent = displayTf;
        }
        // Also highlight active button in menu
        const tfMenu = chartInfoOverlay.querySelector('.info-badge-tf-menu');
        if (tfMenu) {
          tfMenu.querySelectorAll('.tf-btn').forEach(b => {
            const bTf = b.getAttribute('data-tf');
            const isActive = (bTf === String(tf) || bTf === formattedTf || bTf.toUpperCase() === formattedTf);
            b.classList.toggle('active', isActive);
          });
        }
      }
    },

    setChartInfoVisible: function(visible) {
      createChartInfoOverlay();
      if (!chartInfoOverlay) return;
      if (visible) {
        chartInfoOverlay.classList.remove('hidden');
      } else {
        chartInfoOverlay.classList.add('hidden');
      }
    },

    setStudiesLegendVisible: function(visible) {
      const show = visible !== false;
      try { localStorage.setItem(STUDIES_LEGEND_KEY, show ? '1' : '0'); } catch(e) {}
      [document.body, document.documentElement].forEach(el => {
        if (!el) return;
        if (show) el.classList.remove('hide-studies-legend');
        else el.classList.add('hide-studies-legend');
      });
      initStudiesLegend = show;
      placeBadgeClearOfLegend();
    },

    getState: function() {
      var chart = this.getChartApi();
      if (!chart) return null;
      try {
        return {
          symbol: typeof chart.symbol === 'function' ? chart.symbol() : null,
          resolution: typeof chart.resolution === 'function' ? chart.resolution() : null
        };
      } catch(e) { return null; }
    },

    ensureDrawingSystemEnabled: function() {
      try {
        var col = window._exposed_chartWidgetCollection;
        var active = col && col.activeChartWidget ? col.activeChartWidget.value() : null;
        if (active && typeof active.getCheckableActionState === 'function') {
          var cur = active.getCheckableActionState('drawingToolbarAction');
          if (cur === false) {
            active.executeActionById('drawingToolbarAction');
          }
        }
        if (col && typeof col.lineToolPropertiesToolbar === 'function') {
          var lbar = col.lineToolPropertiesToolbar();
          if (lbar && typeof lbar.setValue === 'function') lbar.setValue(true);
        }
        if (col && col._lineToolPropertiesToolbar && typeof col._lineToolPropertiesToolbar.setValue === 'function') {
          col._lineToolPropertiesToolbar.setValue(true);
        }
      } catch(e) {}
    },

    setDrawingToolbar: function(visible) {
      if (visible) {
        this.ensureDrawingSystemEnabled();
      }
      this.ensureFullBleedLayout();
    },

    ensureFullBleedLayout: function() {
      try {
        var col = window._exposed_chartWidgetCollection;
        if (!col) return;

        col._computeContentBox = function() {
          var isClean = document.body && (document.body.classList.contains('clean-mode') || document.documentElement.classList.contains('clean-mode'));
          var isHideDrawing = document.body && (document.body.classList.contains('hide-drawing-toolbar') || document.documentElement.classList.contains('hide-drawing-toolbar'));
          var topOffset = isClean ? 0 : 38;
          var leftOffset = isHideDrawing ? 0 : 52;
          var h = Math.max(100, (window.innerHeight || document.documentElement.clientHeight || 800) - topOffset);
          var w = Math.max(100, (window.innerWidth || document.documentElement.clientWidth || 1000) - leftOffset);
          return { width: w, height: h, top: 0, left: 0 };
        };

        // Close right widgetbar tabs if active to prevent internal width subtraction
        var activeTabs = document.querySelectorAll('[class*="widgetbar"] [class*="isActive-"], [class*="widgetbar"] .active, button[aria-pressed="true"][class*="button-"]');
        activeTabs.forEach(function(tab) {
          var parentRight = tab.closest('.layout__area--right, div[data-name="right-toolbar"], div[class*="widgetbar"]');
          if (parentRight) tab.click();
        });

        col._updateLayout();
        var active = col.activeChartWidget ? col.activeChartWidget.value() : null;
        if (active && typeof active.resize === 'function') active.resize();
        if (active && typeof active.paint === 'function') active.paint();
      } catch(e) {}
    },

    disableStayInDrawingMode: function() {
      try {
        var col = window._exposed_chartWidgetCollection;
        if (col && col._stayInDrawingMode && typeof col._stayInDrawingMode.setValue === 'function') {
          col._stayInDrawingMode.setValue(false);
        }
        if (col && col.stayInDrawingMode && typeof col.stayInDrawingMode.setValue === 'function') {
          col.stayInDrawingMode.setValue(false);
        }
        var active = col && col.activeChartWidget ? col.activeChartWidget.value() : null;
        if (active && typeof active.getCheckableActionState === 'function') {
          ['drawingToolbarStayInDrawingModeAction', 'stayInDrawingModeAction', 'stayInDrawingMode'].forEach(function(act) {
            try {
              if (active.getCheckableActionState(act) === true) {
                active.executeActionById(act);
              }
            } catch(e) {}
          });
        }
        if (window.TradingView && window.TradingView.settings && typeof window.TradingView.settings.setValue === 'function') {
          window.TradingView.settings.setValue('tradingview.stayInDrawingMode', false);
        }
      } catch(e) {}
    },

    _getDrawingCount: function() {
      try {
        var col = window._exposed_chartWidgetCollection;
        var active = col && col.activeChartWidget ? col.activeChartWidget.value() : null;
        if (!active) return 0;
        var m = active.model ? (active.model().model ? active.model().model() : active.model()) : null;
        if (m) {
          if (typeof m.allLineTools === 'function') {
            return m.allLineTools().length;
          }
          if (m.panes && m.panes()[0] && typeof m.panes()[0].dataSources === 'function') {
            return m.panes()[0].dataSources().length;
          }
        }
      } catch(e) {}
      return 0;
    },

    selectDrawingTool: function(toolName) {
      try {
        window.__pendingDrawingTool = toolName;
        window.__currentSelectedTool = toolName;

        var col = window._exposed_chartWidgetCollection;
        var active = col && col.activeChartWidget ? (typeof col.activeChartWidget.value === 'function' ? col.activeChartWidget.value() : col.activeChartWidget) : null;

        if (toolName === 'removeAllDrawingTools') {
          try { if (active && typeof active.removeAllDrawingTools === 'function') active.removeAllDrawingTools(); } catch(e) {}
          try { if (col && typeof col.removeAllDrawingTools === 'function') col.removeAllDrawingTools(); } catch(e) {}
          return;
        }

        // If collection not ready yet, poll rapidly to apply as soon as it appears
        if (!col) {
          let retries = 0;
          const retryTimer = setInterval(function() {
            retries++;
            if (window._exposed_chartWidgetCollection) {
              clearInterval(retryTimer);
              if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') {
                window.__TVSync.selectDrawingTool(toolName);
              }
            } else if (retries >= 30) {
              clearInterval(retryTimer);
            }
          }, 100);
        }

        // Turn off stayInDrawingMode so TradingView naturally reverts to cursor after 1 drawing
        this.ensureDrawingSystemEnabled();
        this.disableStayInDrawingMode();

        var TOOL_ALIASES = {
          'LineToolTrendLine': ['LineToolTrendLine', 'TrendLine', 'trend_line'],
          'LineToolHorzLine': ['LineToolHorzLine', 'HorizontalLine', 'LineToolHorizontalLine', 'horz_line'],
          'LineToolHorzRay': ['LineToolHorzRay', 'HorizontalRay', 'LineToolHorizontalRay', 'horz_ray'],
          'LineToolRay': ['LineToolRay', 'Ray', 'ray'],
          'LineToolArrow': ['LineToolArrow', 'Arrow', 'arrow_line'],
          'LineToolExtended': ['LineToolExtended', 'ExtendedLine', 'LineToolExtendedLine', 'extended_line'],
          'LineToolVertLine': ['LineToolVertLine', 'VerticalLine', 'LineToolVerticalLine', 'vert_line', 'vertical_line'],
          'LineToolCrossLine': ['LineToolCrossLine', 'CrossLine', 'LineToolCrosshair', 'cross_line'],
          'LineToolParallelChannel': ['LineToolParallelChannel', 'ParallelChannel', 'LineToolChannel', 'parallel_channel', 'channel'],
          'LineToolDisjointChannel': ['LineToolDisjointAngle', 'LineToolDisjointChannel', 'DisjointAngle', 'DisjointChannel', 'disjoint_angle'],
          'LineToolFlatBottom': ['LineToolFlatBottom', 'FlatBottom', 'flat_bottom'],
          'LineToolArrowMarkUp': ['LineToolArrowMarkUp', 'ArrowMarkUp', 'arrow_up', 'arrow_mark_up'],
          'LineToolArrowMarkDown': ['LineToolArrowMarkDown', 'ArrowMarkDown', 'arrow_down', 'arrow_mark_down'],
          'LineToolArrowMarker': ['LineToolArrowMarker', 'ArrowMarker', 'arrow_marker'],
          'LineToolFlagMark': ['LineToolFlagMark', 'FlagMark', 'flag_mark', 'flag'],
          'LineToolRectangle': ['LineToolRectangle', 'Rectangle', 'rectangle'],
          'LineToolRotatedRectangle': ['LineToolRotatedRectangle', 'RotatedRectangle', 'rotated_rectangle'],
          'LineToolCircle': ['LineToolCircle', 'Circle', 'LineToolEllipse', 'Ellipse', 'circle', 'ellipse'],
          'LineToolTriangle': ['LineToolTriangle', 'Triangle', 'triangle'],
          'LineToolArc': ['LineToolArc', 'Arc', 'LineToolCurve', 'Curve', 'arc', 'curve'],
          'LineToolPath': ['LineToolPath', 'Path', 'LineToolPolyline', 'Polyline', 'path', 'polyline'],
          'LineToolFibRetracement': ['LineToolFibRetracement', 'LineToolRetracements', 'FibRetracement', 'Retracements', 'fib_retracement'],
          'LineToolTrendBasedFibExtension': ['LineToolTrendBasedFibExtension', 'TrendBasedFibExtension', 'FibExtension', 'trend_based_fib_extension'],
          'LineToolFibChannel': ['LineToolFibChannel', 'FibChannel', 'fib_channel'],
          'LineToolFibTimeZone': ['LineToolFibTimeZone', 'FibTimeZone', 'fib_time_zone'],
          'LineToolPitchfork': ['LineToolPitchfork', 'Pitchfork', 'pitchfork'],
          'LineToolGannBox': ['LineToolGannBox', 'GannBox', 'gann_box', 'gann-box', 'gannbox'],
          'LineToolGannSquare': ['LineToolGannSquare', 'GannSquare', 'gann_square', 'gann-square', 'gannsquare'],
          'LineToolGannComplex': ['LineToolGannComplex', 'GannComplex', 'gann_complex', 'gann-complex', 'ganncomplex'],
          'LineToolGannFan': ['LineToolGannFan', 'GannFan', 'gann_fan', 'gann-fan', 'gannfan'],
          'LineToolGannFixed': ['LineToolGannFixed', 'GannFixed', 'gann_fixed', 'gann-fixed'],
          'LineToolBrush': ['LineToolBrush', 'Brush', 'brush'],
          'LineToolHighlighter': ['LineToolHighlighter', 'Highlighter', 'highlighter'],
          'LineToolText': ['LineToolText', 'Text', 'text'],
          'LineToolCallout': ['LineToolCallout', 'Callout', 'callout'],
          'LineToolPriceLabel': ['LineToolPriceLabel', 'PriceLabel', 'price_label'],
          'LineToolPriceNote': ['LineToolPriceNote', 'PriceNote', 'price_note'],
          'LineToolRiskRewardLong': ['LineToolRiskRewardLong', 'LineToolLongPosition', 'RiskRewardLong', 'LongPosition', 'long_position'],
          'LineToolRiskRewardShort': ['LineToolRiskRewardShort', 'LineToolShortPosition', 'RiskRewardShort', 'ShortPosition', 'short_position'],
          'LineToolPrediction': ['LineToolPrediction', 'LineToolPositionForecast', 'Prediction', 'PositionForecast', 'prediction', 'forecast'],
          'LineToolDateAndPriceRange': ['LineToolDateAndPriceRange', 'DateAndPriceRange', 'date_and_price_range'],
          'LineToolPriceRange': ['LineToolPriceRange', 'PriceRange', 'price_range'],
          'LineToolDateRange': ['LineToolDateRange', 'DateRange', 'date_range'],
          'measure': ['measure', 'LineToolMeasure', 'Measure'],
          'eraser': ['eraser', 'LineToolEraser', 'Eraser'],
          'cursor': ['cursor', 'LineToolCursor', 'Cursor', 'crosshair', 'pointer']
        };

        function tryApplyTool(name) {
          var ok = false;

          // 1. Chart collection tool WatchedValue
          try {
            var toolWV = null;
            if (col) {
              if (typeof col.tool === 'function') toolWV = col.tool();
              else if (col._tool) toolWV = col._tool;
            }
            if (toolWV && typeof toolWV.setValue === 'function') {
              toolWV.setValue(name);
              var curVal = typeof toolWV.value === 'function' ? toolWV.value() : toolWV.value;
              if (curVal === name) ok = true;
            }
          } catch(e) {}

          // 2. Chart collection direct setTool
          try {
            if (col && typeof col.setTool === 'function') {
              col.setTool(name);
              ok = true;
            }
          } catch(e) {}
          try {
            if (col && typeof col.selectLineTool === 'function') {
              col.selectLineTool(name);
              ok = true;
            }
          } catch(e) {}

          // 3. Active Chart Widget API
          try {
            if (active) {
              if (typeof active.setTool === 'function') {
                active.setTool(name);
                ok = true;
              }
              if (typeof active.selectLineTool === 'function') {
                active.selectLineTool(name);
                ok = true;
              }
              if (typeof active.setDrawingTool === 'function') {
                active.setDrawingTool(name);
                ok = true;
              }
            }
          } catch(e) {}

          // 4. TradingView Public API
          try {
            if (window.TradingViewApi && typeof window.TradingViewApi.selectLineTool === 'function') {
              window.TradingViewApi.selectLineTool(name);
              ok = true;
            }
          } catch(e) {}

          // 5. Model and LineToolsModel
          try {
            if (active && active.model) {
              var m = typeof active.model === 'function' ? active.model() : active.model;
              if (m) {
                var innerM = typeof m.model === 'function' ? m.model() : m;
                if (innerM) {
                  if (typeof innerM.setTool === 'function') {
                    innerM.setTool(name);
                    ok = true;
                  }
                  if (typeof innerM.selectLineTool === 'function') {
                    innerM.selectLineTool(name);
                    ok = true;
                  }
                  var ltM = typeof innerM.lineToolsModel === 'function' ? innerM.lineToolsModel() : innerM.lineToolsModel;
                  if (ltM) {
                    if (typeof ltM.setTool === 'function') {
                      ltM.setTool(name);
                      ok = true;
                    }
                    if (typeof ltM.selectLineTool === 'function') {
                      ltM.selectLineTool(name);
                      ok = true;
                    }
                  }
                }
              }
            }
          } catch(e) {}

          // 6. DOM left drawing toolbar button matching
          try {
            var raw = name.replace(/^LineTool/, '').toLowerCase();
            var hyphenated = name.replace(/^LineTool/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
            var selList = [
              '[data-name="' + name + '"]',
              '[data-name="' + raw + '"]',
              '[data-name="' + hyphenated + '"]',
              '[data-name="linetool-' + raw + '"]',
              '[data-name="linetool-' + hyphenated + '"]',
              '[data-name*="' + raw + '"]',
              '[data-name*="' + hyphenated + '"]',
              '[data-value="' + name + '"]',
              '[data-value="' + raw + '"]',
              '[data-value="' + hyphenated + '"]',
              '[data-tool="' + name + '"]',
              '[data-tool="' + raw + '"]',
              '[data-tool="' + hyphenated + '"]',
              'button[data-name*="' + raw + '" i]',
              'button[data-name*="' + hyphenated + '" i]',
              'div[data-name*="' + raw + '" i]',
              'div[data-name*="' + hyphenated + '" i]',
              '[aria-label*="' + raw + '" i]',
              '[aria-label*="' + hyphenated + '" i]',
              '[title*="' + raw + '" i]',
              '[title*="' + hyphenated + '" i]'
            ];
            for (var s = 0; s < selList.length; s++) {
              var domBtn = document.querySelector(selList[s]);
              if (domBtn) {
                domBtn.click();
                ok = true;
                break;
              }
            }
          } catch(e) {}

          return ok;
        }

        var aliases = TOOL_ALIASES[toolName] || [
          toolName,
          toolName.replace(/^LineTool/, ''),
          'LineTool' + toolName
        ];

        var applied = false;
        for (var i = 0; i < aliases.length; i++) {
          if (tryApplyTool(aliases[i])) {
            applied = true;
            break;
          }
        }
        if (!applied) {
          tryApplyTool(toolName);
          tryApplyTool(toolName.replace(/^LineTool/, ''));
        }

        try {
          window.focus();
          var canvas = document.querySelector('canvas');
          if (canvas) canvas.focus();
        } catch(e) {}
      } catch(e) {}
    }
  };

  function setupToolSubscriptions() {
    try {
      var col = window._exposed_chartWidgetCollection;
      var toolWV = null;
      if (col) {
        if (typeof col.tool === 'function') toolWV = col.tool();
        else if (col._tool) toolWV = col._tool;
      }
      if (toolWV && typeof toolWV.subscribe === 'function' && !col.__toolSubscribed) {
        col.__toolSubscribed = true;
        toolWV.subscribe(function(tool) {
          window.__currentSelectedTool = tool;
          ipcRenderer.sendToHost('chart-drawing-tool-changed', { tool: tool, paneId: paneId });
        });
      }
    } catch(e) {}
  }

  // Hook TradingView collection as soon as loaded (and stop polling once hooked)
  let tvCollectionHooked = false;
  const tvHookTimer = setInterval(function() {
    if (window._exposed_chartWidgetCollection) {
      tvCollectionHooked = true;
      clearInterval(tvHookTimer);
      if (window.__TVSync) {
        window.__TVSync.ensureFullBleedLayout();
        window.__TVSync.disableStayInDrawingMode();
        setupToolSubscriptions();
        if (window.__pendingDrawingTool) {
          window.__TVSync.selectDrawingTool(window.__pendingDrawingTool);
        }
      }
    }
  }, 100);

  // Debounced resize listener to avoid jumping/flickering
  var tvResizeTimer = null;
  window.addEventListener('resize', function() {
    if (tvResizeTimer) clearTimeout(tvResizeTimer);
    tvResizeTimer = setTimeout(function() {
      if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') {
        window.__TVSync.ensureFullBleedLayout();
      }
      enforceCleanLayout();
    }, 80);
  }, { passive: true });

  // Send status updates when chart is ready
  setInterval(function() {
    if (window.__TVSync && typeof window.__TVSync.getState === 'function') {
      var state = window.__TVSync.getState();
      if (state && state.symbol) {
        if (typeof window.__TVSync.updateChartInfo === 'function') {
          window.__TVSync.updateChartInfo(state.symbol, state.resolution);
        }
        if (state.symbol !== lastReportedSymbol) {
          lastReportedSymbol = state.symbol;
          ipcRenderer.sendToHost('chart-symbol-detected', { symbol: state.symbol, paneId: paneId });
        }
        if (state.resolution && state.resolution !== lastReportedTimeframe) {
          lastReportedTimeframe = state.resolution;
          ipcRenderer.sendToHost('chart-timeframe-detected', { timeframe: state.resolution, paneId: paneId });
        }
      }
    }
  }, 1500);

  window.addEventListener('message', function(event) {
    if (!event.data || !event.data.type) return;
    if (event.data.type === 'TV_SYNC_EXEC_SET_SYMBOL') {
      window.__TVSync.setSymbol(event.data.symbol);
    } else if (event.data.type === 'TV_SYNC_EXEC_SET_TIMEFRAME') {
      window.__TVSync.setTimeframe(event.data.timeframe);
    } else if (event.data.type === 'TV_SYNC_EXEC_SET_DRAWING_TOOLBAR') {
      window.__TVSync.setDrawingToolbar(event.data.visible);
    } else if (event.data.type === 'TV_SYNC_EXEC_SET_DRAWING_TOOL') {
      window.__TVSync.selectDrawingTool(event.data.tool);
    } else if (event.data.type === 'TV_SYNC_EXEC_LAYOUT_UPDATE') {
      window.__TVSync.ensureFullBleedLayout();
    }
  });

  // Handle messages from the injected main world script
  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;
    
    if (event.data.type === 'TV_SYNC_STATE_UPDATE') {
      const { symbol, resolution } = event.data.state;
      if (symbol && symbol !== lastReportedSymbol) {
        lastReportedSymbol = symbol;
        ipcRenderer.sendToHost('chart-symbol-detected', { symbol, paneId });
      }
      if (resolution && resolution !== lastReportedTimeframe) {
        lastReportedTimeframe = resolution;
        ipcRenderer.sendToHost('chart-timeframe-detected', { timeframe: resolution, paneId });
      }
    }
    else if (event.data.type === 'TV_SYNC_TOOL_CHANGED') {
      ipcRenderer.sendToHost('chart-drawing-tool-changed', { tool: event.data.tool, paneId });
    }
  });



  // Clean up surrounding bars to maximize chart space (Single shared master bar)
  function triggerChartResize() {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new UIEvent('resize'));
    try {
      window.postMessage({ type: 'TV_SYNC_EXEC_LAYOUT_UPDATE' }, '*');
    } catch(e) {}
  }

  // Clean up surrounding bars to maximize chart space (Single shared master bar)
  function cleanUI() {
    const target = document.head || document.documentElement;
    if (!target) return;
    if (document.getElementById('tv-splitsync-clean-ui-styles')) return;

    const style = document.createElement('style');
    style.id = 'tv-splitsync-clean-ui-styles';
    style.textContent = `
      /* Hide Promotional elements, toasts, banners (NEVER hide floating properties toolbars or color dialogs) */
      [data-name="go-pro-button"],
      [class*="trial-banner"],
      [class*="banner-"],
      #overlap-manager-root > div[class*="container-"][class*="banner-"] {
        display: none !important;
      }

      /* In-chart DOM info badge overlay */
      .chart-info-overlay {
        position: fixed !important;
        top: 10px !important;
        left: 60px !important;
        z-index: 999999 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        background: rgba(20, 24, 35, 0.90) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 6px !important;
        padding: 3px 8px !important;
        color: #ffffff !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5) !important;
        pointer-events: auto !important;
        user-select: none !important;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }

      body.hide-drawing-toolbar .chart-info-overlay,
      html.hide-drawing-toolbar .chart-info-overlay {
        left: 10px !important;
      }

      .chart-info-overlay.hidden {
        display: none !important;
      }

      .chart-info-overlay.collapsed .info-badge-details {
        display: none !important;
      }

      .chart-info-overlay.collapsed {
        padding: 3px 5px !important;
        opacity: 0.6 !important;
      }

      .chart-info-overlay.collapsed:hover {
        opacity: 1 !important;
      }

      .chart-info-overlay .info-badge-details {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }

      .chart-info-overlay .info-badge-symbol {
        font-size: 12px !important;
        font-weight: 800 !important;
        color: #ffffff !important;
        letter-spacing: 0.3px !important;
      }

      .chart-info-overlay .info-badge-broker {
        font-size: 9px !important;
        font-weight: 700 !important;
        background: rgba(41, 98, 255, 0.2) !important;
        color: #2962ff !important;
        border: 1px solid rgba(41, 98, 255, 0.4) !important;
        padding: 1px 4px !important;
        border-radius: 3px !important;
        text-transform: uppercase !important;
      }

      .chart-info-overlay .info-badge-tf {
        display: inline-flex !important;
        align-items: center !important;
        gap: 3px !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        background: rgba(255, 152, 0, 0.2) !important;
        color: #ff9800 !important;
        border: 1px solid rgba(255, 152, 0, 0.4) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        text-transform: uppercase !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        font-family: inherit !important;
        line-height: 1 !important;
      }

      .chart-info-overlay .info-badge-tf:hover {
        background: rgba(255, 152, 0, 0.35) !important;
        border-color: #ff9800 !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 2px 6px rgba(255, 152, 0, 0.3) !important;
      }

      .chart-info-overlay .info-badge-tf-arrow {
        color: #ff9800 !important;
        transition: transform 0.15s ease !important;
      }

      .chart-info-overlay .info-badge-studies {
        display: inline-flex !important;
        align-items: center !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        background: rgba(41, 98, 255, 0.2) !important;
        color: #60a5fa !important;
        border: 1px solid rgba(41, 98, 255, 0.4) !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        font-family: inherit !important;
        line-height: 1 !important;
      }

      .chart-info-overlay .info-badge-studies:hover {
        background: rgba(41, 98, 255, 0.4) !important;
        border-color: #2962ff !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 2px 6px rgba(41, 98, 255, 0.35) !important;
      }

      .chart-info-overlay .info-badge-tf-menu {
        position: absolute !important;
        top: calc(100% + 6px) !important;
        left: 0 !important;
        background: rgba(18, 22, 34, 0.96) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: 1px solid rgba(255, 255, 255, 0.16) !important;
        border-radius: 8px !important;
        padding: 8px !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75) !important;
        z-index: 1000000 !important;
        width: 175px !important;
        box-sizing: border-box !important;
      }

      .chart-info-overlay .info-badge-tf-menu.hidden {
        display: none !important;
      }

      .chart-info-overlay .tf-menu-sec-title {
        font-size: 9px !important;
        font-weight: 800 !important;
        color: #787b86 !important;
        letter-spacing: 0.5px !important;
        text-transform: uppercase !important;
        margin: 4px 0 4px 2px !important;
      }

      .chart-info-overlay .tf-menu-grid {
        display: grid !important;
        grid-template-columns: repeat(3, 1fr) !important;
        gap: 4px !important;
        margin-bottom: 6px !important;
      }

      .chart-info-overlay .tf-menu-grid.tf-grid-4 {
        grid-template-columns: repeat(4, 1fr) !important;
      }

      .chart-info-overlay .tf-menu-grid:last-child {
        margin-bottom: 0 !important;
      }

      .chart-info-overlay .tf-btn {
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        border-radius: 4px !important;
        color: #d1d4dc !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        font-family: inherit !important;
        padding: 4px 0 !important;
        cursor: pointer !important;
        text-align: center !important;
        transition: all 0.12s ease !important;
        line-height: 1.2 !important;
      }

      .chart-info-overlay .tf-btn:hover {
        background: #2962ff !important;
        color: #ffffff !important;
        border-color: #2962ff !important;
        transform: translateY(-1px) !important;
      }

      .chart-info-overlay .tf-btn.active {
        background: rgba(255, 152, 0, 0.25) !important;
        color: #ff9800 !important;
        border-color: #ff9800 !important;
        font-weight: 700 !important;
      }

      .chart-info-overlay .info-badge-toggle {
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 18px !important;
        height: 18px !important;
        border-radius: 3px !important;
        background: transparent !important;
        border: none !important;
        color: #787b86 !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        margin-left: 2px !important;
        padding: 0 !important;
      }

      .chart-info-overlay .info-badge-toggle:hover {
        color: #ffffff !important;
        background: rgba(255, 255, 255, 0.15) !important;
      }

      /* 1. Reset parent containers so they fill 100% with no empty borders/strips */
      html, body,
      .js-rootresizer__contents,
      [class*="layout-with-border-radius"] {
        border: none !important;
        border-radius: 0 !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      /* 2. Remove Right Sidebar (Watchlist, Alerts, News, Social - Image 3) */
      .layout__area--right,
      div[data-name="right-toolbar"],
      div[class*="widgetbar-wrap"],
      div[class*="widgetbar-pages"],
      div[class*="widgetbar-tabs"],
      div[class*="widgetbar-"],
      #overlap-manager-root div[class*="widgetbar-"] {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        min-width: 0 !important;
        visibility: hidden !important;
      }

      /* 3. Remove Bottom Time Range Bar & Chart Controls Bar (Eliminates the bottom bar completely!) */
      .layout__area--bottom,
      .chart-controls-bar,
      [class*="chart-controls-bar"],
      .chart-toolbar.chart-controls-bar,
      div[data-name="time-ranges"],
      div[class*="bottom-widgetbar-content"],
      div[class*="bottom-widgetbar"],
      div[class*="date-range-wrapper"] {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
        min-width: 0 !important;
        min-height: 0 !important;
        visibility: hidden !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      /* 4. Left Drawing Toolbar Toggle (Hides ONLY the left sidebar, NEVER the floating line tool properties toolbar) */
      body.hide-drawing-toolbar .layout__area--left,
      html.hide-drawing-toolbar .layout__area--left,
      body.hide-drawing-toolbar .layout__area--left #drawing-toolbar,
      html.hide-drawing-toolbar .layout__area--left #drawing-toolbar {
        display: none !important;
        width: 0 !important;
        min-width: 0 !important;
        visibility: hidden !important;
      }

      /* Ensure Floating Line Tool Properties Toolbar (Color, Thickness, Style, Settings, Lock, Trash) is ALWAYS VISIBLE */
      div[class*="tv-floating-toolbar"],
      div[class*="floating-toolbar"],
      div[data-name="linetool-properties"],
      div[data-name="drawing-properties-toolbar"],
      div[class*="drawingPropertiesToolbar"],
      #overlap-manager-root div[class*="tv-floating-toolbar"],
      #overlap-manager-root div[class*="floating-toolbar"],
      #overlap-manager-root [data-name="linetool-properties"] {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        z-index: 99999 !important;
      }

      /* Ensure Color picker, Line width, and dropdown menus from the floating toolbar work */
      #overlap-manager-root div[class*="menu-"],
      #overlap-manager-root div[class*="popup-"],
      #overlap-manager-root div[class*="dropdown-"],
      #overlap-manager-root div[data-name="menu-inner"] {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        z-index: 100000 !important;
      }

      body.hide-drawing-toolbar .layout__area--center,
      html.hide-drawing-toolbar .layout__area--center {
        left: 0 !important;
        width: 100% !important;
      }

      body:not(.hide-drawing-toolbar) .layout__area--left {
        display: block !important;
        width: 52px !important;
      }

      body:not(.hide-drawing-toolbar) .layout__area--center {
        left: 52px !important;
        width: calc(100% - 52px) !important;
      }

      /* 5. Clean Mode (Top Header): Eliminates top bar for maximum candle space */
      body.clean-mode .layout__area--top,
      body.clean-mode .layout__area--topleft,
      body.clean-mode div[data-name="header-toolbar"],
      body.clean-mode #header-toolbar-root,
      html.clean-mode .layout__area--top,
      html.clean-mode .layout__area--topleft,
      html.clean-mode div[data-name="header-toolbar"],
      html.clean-mode #header-toolbar-root {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
        visibility: hidden !important;
      }

      body.clean-mode .layout__area--center,
      html.clean-mode .layout__area--center {
        top: 0 !important;
        height: 100% !important;
      }

      body:not(.clean-mode) .layout__area--center {
        top: 38px !important;
        height: calc(100% - 38px) !important;
      }

      /* 6. Layout area center & chart container must span completely to all edges with zero bottom gap */
      .layout__area--center,
      .layout__area--center .chart-container,
      .layout__area--center div[class*="chart-container"],
      .layout__area--center div[class*="chart-gui-wrapper"]:not([class*="legend"]),
      .layout__area--center div[class*="viewWrapper-"],
      .layout__area--center div[data-name="chart-layout"] {
        bottom: 0 !important;
        margin: 0 !important;
        border: none !important;
        border-radius: 0 !important;
      }

      .layout__area--center {
        position: absolute !important;
        bottom: 0 !important;
        right: 0 !important;
      }

      .layout__area--center .chart-container,
      .layout__area--center div[class*="chart-container"],
      .layout__area--center div[class*="chart-gui-wrapper"]:not([class*="legend"]) {
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        height: 100% !important;
      }

      /* 7. TradingView clamps the legend row to "100% minus the price axis area" with an
         inline style sized for the normal window; in our full-bleed panes that goes
         negative and hides the whole indicator list, so re-clamp it to the pane. */
      .layout__area--center div[class*="chart-gui-wrapper__"][class*="legend-"] {
        max-width: calc(100% - 70px) !important;
      }

      /* 8. On short panes TradingView switches the legend to its "micro" state and hides the
         study rows behind an expand arrow, so the indicator list is never visible. */
      .layout__area--center div[class*="chart-gui-wrapper__"][class*="legend-"] [class*="sources-"] {
        display: flex !important;
      }

      /* 9. Toolbar toggle: drop the whole legend strip (symbol header + indicator rows) */
      body.hide-studies-legend div[class*="chart-gui-wrapper__"][class*="legend-"],
      html.hide-studies-legend div[class*="chart-gui-wrapper__"][class*="legend-"],
      body.hide-studies-legend [class*="chart-legend"],
      html.hide-studies-legend [class*="chart-legend"] {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);

    // Dynamic layout observer to eliminate any late-rendered bottom bar or gap
    setupCleanLayoutObserver();
  }

  function enforceCleanLayout() {
    try {
      const bottomBars = document.querySelectorAll('.chart-controls-bar, [class*="chart-controls-bar"], .layout__area--bottom, div[data-name="time-ranges"], div[class*="bottom-widgetbar"]');
      bottomBars.forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('height', '0px', 'important');
        el.style.setProperty('min-height', '0px', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      });

      const rightBars = document.querySelectorAll('.layout__area--right, div[data-name="right-toolbar"], div[class*="widgetbar-wrap"], div[class*="widgetbar-pages"], div[class*="widgetbar-tabs"], div[class*="widgetbar-"]');
      rightBars.forEach(el => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('width', '0px', 'important');
        el.style.setProperty('min-width', '0px', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
      });

      const centerArea = document.querySelector('.layout__area--center');
      if (centerArea) {
        centerArea.style.setProperty('bottom', '0px', 'important');
        centerArea.style.setProperty('right', '0px', 'important');
        const isToolbarHidden = document.body.classList.contains('hide-drawing-toolbar') || document.documentElement.classList.contains('hide-drawing-toolbar');
        if (isToolbarHidden) {
          centerArea.style.setProperty('left', '0px', 'important');
          centerArea.style.setProperty('width', '100%', 'important');
        } else {
          centerArea.style.setProperty('left', '52px', 'important');
          centerArea.style.setProperty('width', 'calc(100% - 52px)', 'important');
        }
        const isClean = document.body.classList.contains('clean-mode') || document.documentElement.classList.contains('clean-mode');
        if (isClean) {
          centerArea.style.setProperty('top', '0px', 'important');
          centerArea.style.setProperty('height', '100%', 'important');
        } else {
          centerArea.style.setProperty('top', '38px', 'important');
          centerArea.style.setProperty('height', 'calc(100% - 38px)', 'important');
        }
      }

      const containers = document.querySelectorAll('.layout__area--center .chart-container, .layout__area--center div[class*="chart-container"], .layout__area--center div[class*="chart-gui-wrapper"]:not([class*="legend"])');
      containers.forEach(c => {
        c.style.setProperty('top', '0px', 'important');
        c.style.setProperty('left', '0px', 'important');
        c.style.setProperty('right', '0px', 'important');
        c.style.setProperty('bottom', '0px', 'important');
        c.style.setProperty('width', '100%', 'important');
        c.style.setProperty('height', '100%', 'important');
      });

      placeBadgeClearOfLegend();
    } catch(e) {}
  }

  let cleanLayoutDebounceTimer = null;
  function setupCleanLayoutObserver() {
    enforceCleanLayout();
    try {
      const observer = new MutationObserver(() => {
        if (cleanLayoutDebounceTimer) return;
        cleanLayoutDebounceTimer = setTimeout(() => {
          cleanLayoutDebounceTimer = null;
          enforceCleanLayout();
        }, 300);
      });
      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    } catch(e) {}
  }

  // Handle messages received from the host application
  ipcRenderer.on('init-pane', (event, data) => {
    paneId = data.paneId || paneId;
    linkGroup = data.linkGroup || linkGroup;
    const hideDrawing = data.hideDrawingToolbar !== undefined ? !!data.hideDrawingToolbar : false;
    if (hideDrawing) {
      document.body.classList.add('hide-drawing-toolbar');
      document.documentElement.classList.add('hide-drawing-toolbar');
    } else {
      document.body.classList.remove('hide-drawing-toolbar');
      document.documentElement.classList.remove('hide-drawing-toolbar');
    }
    if (data.cleanMode) {
      document.body.classList.add('clean-mode');
      document.documentElement.classList.add('clean-mode');
    } else {
      document.body.classList.remove('clean-mode');
      document.documentElement.classList.remove('clean-mode');
    }
    if (window.__TVSync && typeof window.__TVSync.setDrawingToolbar === 'function') {
      window.__TVSync.setDrawingToolbar(!hideDrawing);
    }
    enforceCleanLayout();
    triggerChartResize();
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 150);
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 500);
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 1200);
  });

  ipcRenderer.on('set-drawing-toolbar', (event, data) => {
    const visible = !!data.visible;
    if (visible) {
      document.body.classList.remove('hide-drawing-toolbar');
      document.documentElement.classList.remove('hide-drawing-toolbar');
    } else {
      document.body.classList.add('hide-drawing-toolbar');
      document.documentElement.classList.add('hide-drawing-toolbar');
    }
    if (window.__TVSync && typeof window.__TVSync.setDrawingToolbar === 'function') {
      window.__TVSync.setDrawingToolbar(visible);
    }
    enforceCleanLayout();
    triggerChartResize();
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 50);
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 200);
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 500);
  });

  ipcRenderer.on('set-clean-mode', (event, data) => {
    if (data.enabled) {
      document.body.classList.add('clean-mode');
      document.documentElement.classList.add('clean-mode');
    } else {
      document.body.classList.remove('clean-mode');
      document.documentElement.classList.remove('clean-mode');
    }
    if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') {
      window.__TVSync.ensureFullBleedLayout();
    }
    enforceCleanLayout();
    triggerChartResize();
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 50);
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 200);
    setTimeout(() => { enforceCleanLayout(); triggerChartResize(); }, 500);
  });

  ipcRenderer.on('set-drawing-tool', (event, data) => {
    try {
      if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') {
        window.__TVSync.selectDrawingTool(data.tool);
      }
    } catch(e) {}
  });

  ipcRenderer.on('set-chart-info-visible', (event, data) => {
    try {
      if (window.__TVSync && typeof window.__TVSync.setChartInfoVisible === 'function') {
        window.__TVSync.setChartInfoVisible(!!data.visible);
      }
    } catch(e) {}
  });

  ipcRenderer.on('update-chart-info', (event, data) => {
    try {
      if (window.__TVSync && typeof window.__TVSync.updateChartInfo === 'function') {
        window.__TVSync.updateChartInfo(data.symbol, data.timeframe, data.broker);
      }
    } catch(e) {}
  });


  function triggerSaveLayout() {
    try {
      const saveBtn = document.querySelector('#header-toolbar-save-load, [data-name="save-load-menu"], button[data-tooltip*="Save"]');
      if (saveBtn) {
        saveBtn.click();
      } else {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
      }
      return true;
    } catch(e) { return false; }
  }

  // Auto-save drawings whenever mouse is released (debounced 1.2s)
  let saveDebounceTimer = null;
  document.addEventListener('mouseup', () => {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      triggerSaveLayout();
    }, 1200);
  }, { passive: true });

  ipcRenderer.on('set-symbol', (event, data) => {
    const targetSymbol = data.symbol;
    if (!targetSymbol) return;

    window.postMessage({ type: 'TV_SYNC_EXEC_SET_SYMBOL', symbol: targetSymbol }, '*');

    // Attempt in-page search dialog
    try {
      const symbolBtn = document.querySelector('#header-toolbar-symbol-search, [data-name="legend-series-item"]');
      if (symbolBtn) {
        symbolBtn.click();
        setTimeout(() => {
          const input = document.querySelector('input[data-role="search"], input[type="text"][class*="search"]');
          if (input) {
            input.value = targetSymbol;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(() => {
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            }, 120);
          }
        }, 80);
      }
    } catch(e) {}
  });

  ipcRenderer.on('set-timeframe', (event, data) => {
    const targetTf = data.timeframe;
    if (!targetTf) return;

    window.postMessage({ type: 'TV_SYNC_EXEC_SET_TIMEFRAME', timeframe: targetTf }, '*');

    const tfNorm = String(targetTf).toUpperCase();
    const map = {
      '1': ['1', '1M', '1 MINUTE'],
      '3': ['3', '3M'],
      '5': ['5', '5M', '5 MINUTES'],
      '15': ['15', '15M', '15 MINUTES'],
      '30': ['30', '30M'],
      '60': ['60', '1H', '1 HOUR'],
      '120': ['120', '2H'],
      '240': ['240', '4H', '4 HOURS'],
      'D': ['1D', 'D', 'DAY', '1 DAY'],
      '1D': ['1D', 'D', 'DAY', '1 DAY'],
      'W': ['1W', 'W', 'WEEK', '1 WEEK'],
      '1W': ['1W', 'W', 'WEEK', '1 WEEK'],
      'M': ['1M', 'M', 'MONTH', '1 MONTH'],
      '1M': ['1M', 'M', 'MONTH', '1 MONTH']
    };
    const targets = map[tfNorm] || [tfNorm];

    try {
      const buttons = Array.from(document.querySelectorAll('#header-toolbar-intervals button, #header-toolbar-intervals [role="button"], [data-value], [data-name="interval-button"]'));
      let clicked = false;
      for (let b of buttons) {
        const txt = (b.textContent || '').trim().toUpperCase();
        const val = (b.getAttribute('data-value') || '').trim().toUpperCase();
        if (targets.includes(txt) || targets.includes(val)) {
          b.click();
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        const dropdown = document.querySelector('#header-toolbar-intervals [class*="menu-"], #header-toolbar-intervals [data-name="menu-inner"], #header-toolbar-intervals button[class*="arrow"]');
        if (dropdown) {
          dropdown.click();
          setTimeout(() => {
            const items = Array.from(document.querySelectorAll('div[data-name="menu-inner"] [role="button"], div[role="menuitem"]'));
            for (let it of items) {
              const itText = (it.textContent || '').trim().toUpperCase();
              if (targets.some(t => itText === t || itText.startsWith(t + ' '))) {
                it.click();
                return;
              }
            }
          }, 100);
        }
      }
    } catch(e) {}
  });

  // Force cloud save of drawings / layout
  ipcRenderer.on('sync-drawings', () => {
    triggerSaveLayout();
    setTimeout(() => {
      ipcRenderer.sendToHost('chart-drawings-saved', { paneId });
    }, 400);
  });

  // --- AUTOMATIC CONNECTION RESTORE & ANTI-MODAL SHIELD ---
  function attemptConnectionRestore() {
    let handled = false;

    try {
      // 1. Direct targeted selectors for TradingView reconnect / restore buttons (EN + FA)
      const allButtons = document.querySelectorAll('button, [role="button"]');
      for (const btn of allButtons) {
        const text = (btn.textContent || '').trim().toLowerCase();
        const dataName = (btn.getAttribute('data-name') || '').toLowerCase();
        if (
          text === 'restore connection' ||
          text.includes('restore connection') ||
          text === 'reconnect' ||
          text.includes('reconnect') ||
          text.includes('بازیابی اتصال') ||
          text.includes('برقراری مجدد') ||
          text.includes('تلاش مجدد') ||
          dataName === 'reconnect' ||
          dataName === 'restore-connection'
        ) {
          try {
            btn.click();
            handled = true;
          } catch(e) {}
        }
      }

      // 2. Look for the "We've closed this connection" dialog or connection limit dialogs
      const modals = document.querySelectorAll(
        '[data-dialog-name="connection-error"], [data-dialog-name="multiple-tabs-limit"], [data-dialog-name="session-limit"], [class*="dialog-"], [class*="modal-"], [role="dialog"]'
      );
      for (const m of modals) {
        const text = (m.textContent || '').toLowerCase();
        if (
          text.includes("closed this connection") ||
          text.includes("plan's limits") ||
          text.includes("connection closed") ||
          text.includes("restore connection") ||
          text.includes("اتصال بسته شد") ||
          text.includes("محدودیت پلن") ||
          text.includes("اتصال را دوباره")
        ) {
          const btns = m.querySelectorAll('button');
          for (const b of btns) {
            const bText = (b.textContent || '').toLowerCase();
            if (
              bText.includes('restore') ||
              bText.includes('reconnect') ||
              bText.includes('بازیابی') ||
              bText.includes('برقرار') ||
              bText.includes('تلاش')
            ) {
              try { b.click(); handled = true; } catch(e) {}
            }
          }
          const closeBtn = m.querySelector('button[data-name="close"], [class*="close-"], button[aria-label="Close"]');
          if (closeBtn) {
            try { closeBtn.click(); } catch(e) {}
          } else {
            try { m.style.setProperty('display', 'none', 'important'); } catch(e) {}
          }
        }
      }
    } catch(e) {}

    return handled;
  }

  // Wake-up and hibernation triggers (NO page reload, NO artificial socket kills)
  window.__wakeUpChart = function() {
    window.__isTabActive = true;
    try {
      window.dispatchEvent(new Event('resize'));
    } catch(e) {}
    attemptConnectionRestore();
  };

  window.__sleepChart = function() {
    window.__isTabActive = false;
  };

  window.__hibernateChart = window.__sleepChart;
  window.__unhibernateChart = window.__wakeUpChart;

  ipcRenderer.on('hibernate-chart', () => {
    if (window.__sleepChart) window.__sleepChart();
  });

  ipcRenderer.on('unhibernate-chart', () => {
    if (window.__wakeUpChart) window.__wakeUpChart();
  });

  function setupConnectionErrorRecovery() {
    // Continuously check every 1.5s on active chart to instantly auto-click "Restore connection"
    setInterval(() => {
      if (window.__isTabActive !== false) {
        attemptConnectionRestore();
      }
    }, 1500);
  }

  // Initialize once DOM is ready
  function initPreload() {
    try { applyInitialClasses(); } catch(e) {}
    try { cleanUI(); } catch(e) {}
    try { createChartInfoOverlay(); } catch(e) {}
    try { enforceCleanLayout(); } catch(e) {}
    try { setupConnectionErrorRecovery(); } catch(e) {}
    if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') {
      try { window.__TVSync.ensureFullBleedLayout(); } catch(e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreload);
  } else {
    initPreload();
  }
})();
