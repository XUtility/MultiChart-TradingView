/**
 * TradingView Multi-Window & SplitSync - Frontend Application Logic
 * Supports true multi-window, edge split screen, custom vertical watchlist,
 * master favorite drawing toolbar, chart info badges, and cross-window sync.
 */

(function() {
  // Parse query parameters
  const urlParams = new URLSearchParams(window.location.search);
  const currentWindowId = urlParams.get('windowId') || 'win_' + Math.random().toString(36).substring(2, 7);
  const currentWindowNum = urlParams.get('windowNum') || '1';
  const initialLayout = urlParams.get('layout') || '1';
  const initialSymbol = urlParams.get('symbol') || 'BINANCE:BTCUSDT';
  const initialTimeframe = urlParams.get('timeframe') || '1D';

  // Storage Keys for persistent settings
  const SETTINGS_KEY = 'tv_splitsync_user_settings_v7';
  const TABS_KEY = 'tv_splitsync_user_tabs_v7';
  const WATCHLIST_KEY = 'tv_splitsync_watchlist_v7';
  const DEFAULT_WATCHLIST = [
    'BINANCE:BTCUSDT'
  ];

  // Helper: Parse Symbol and Broker
  function parseSymbolAndBroker(fullSymbol) {
    if (!fullSymbol) return { symbol: 'BTCUSDT', broker: 'BINANCE' };
    const parts = fullSymbol.split(':');
    if (parts.length >= 2) {
      return { broker: parts[0].toUpperCase(), symbol: parts[1].toUpperCase() };
    }
    return { broker: '', symbol: fullSymbol.toUpperCase() };
  }

  // Helper: Format Timeframe
  function formatTimeframe(tf) {
    if (!tf) return '1D';
    const s = String(tf).toUpperCase();
    if (s === '1D' || s === 'D') return '1D';
    if (s === '2D') return '2D';
    if (s === '3D') return '3D';
    if (s === '1W' || s === 'W') return '1W';
    if (s === '2W') return '2W';
    if (s === '1M' || s === 'M') return '1M';
    if (s === '3M') return '3M';
    if (s === '6M') return '6M';
    if (s === '12M' || s === '1Y') return '1Y';
    const n = parseInt(s, 10);
    if (!isNaN(n)) {
      if (n >= 60) {
        const hrs = n / 60;
        return Number.isInteger(hrs) ? `${hrs}h` : `${n}m`;
      }
      return `${n}m`;
    }
    return s;
  }

  // TradingView profiles with an independent session/cookie each. A tab picks one of
  // them (click its badge); every pane of that tab inherits it.
  const ACCOUNT_IDS = ['acc_1', 'acc_2', 'acc_3', 'acc_4', 'acc_5', 'acc_6', 'acc_7', 'acc_8'];

  function getAccountShortLabel(accId) {
    if (!accId) return 'A1';
    return String(accId).replace('acc_', 'A').toUpperCase();
  }

  // Helper: Factory to create a tab workspace data object
  function createTabObject(title, symbol, layout = '2v', panesConfig = null, customId = null, splitRatio = 50, splitRatioSub = 50, accountId = null) {
    const tabId = customId || ('tab_' + Math.random().toString(36).substring(2, 8));
    const sym = symbol || 'BINANCE:BTCUSDT';
    const { symbol: ticker } = parseSymbolAndBroker(sym);
    const defaultTimeframes = ['1D', '240', '60', '15', '5', '1', '1W', '1M', '30', '45', '120', '180', '2D', '3D', '3M', '12M'];

    // A tab keeps one account for every pane: a layout with 4, 8 or even 16 charts must
    // not silently spread itself over profiles that are not signed in. Any pane account
    // stored by the old round-robin is ignored, which folds those workspaces back together.
    let tabAcc = accountId;
    if (!tabAcc) {
      const tabs = (state && Array.isArray(state.tabs)) ? state.tabs : [];
      const source = tabs.find(t => t.id === (state && state.activeTabId)) || tabs[tabs.length - 1];
      tabAcc = (source && source.accountId) || 'acc_1';
    }

    const panes = [];
    for (let i = 0; i < 16; i++) {
      const savedP = (Array.isArray(panesConfig) && panesConfig[i]) ? panesConfig[i] : {};
      const paneAcc = tabAcc;

      panes.push({
        id: `${tabId}_p${i + 1}`,
        symbol: savedP.symbol || sym,
        timeframe: savedP.timeframe || defaultTimeframes[i] || '1D',
        group: 'A',
        isMaximized: false,
        isInfoCollapsed: !!savedP.isInfoCollapsed,
        accountId: paneAcc,
        webview: null
      });
    }

    return {
      id: tabId,
      title: title || ticker || 'Chart',
      symbol: sym,
      layout: layout || '2v',
      splitRatio: typeof splitRatio === 'number' ? splitRatio : 50,
      splitRatioSub: typeof splitRatioSub === 'number' ? splitRatioSub : 50,
      accountId: tabAcc,
      panes: panes,
      workspaceEl: null
    };
  }

  // Load Saved Tabs & Settings from localStorage
  function loadSavedTabs() {
    try {
      const raw = localStorage.getItem(TABS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          return parsed;
        }
      }
    } catch(e) {}
    return null;
  }

  const savedTabData = loadSavedTabs();

  // App State
  const state = {
    windowId: currentWindowId,
    windowNum: currentWindowNum,
    tabs: [],
    activeTabId: null,
    symbolSync: savedTabData?.symbolSync ?? true,
    showDrawingToolbar: savedTabData?.showDrawingToolbar ?? false,
    cleanMode: savedTabData?.cleanMode ?? true,
    showChartInfo: savedTabData?.showChartInfo ?? true,
    showStudiesLegend: savedTabData?.showStudiesLegend ?? true,
    activeDrawingTool: savedTabData?.activeDrawingTool || 'cursor',
    maximizedPaneId: null
  };

  // Restore Tabs or initialize defaults: 1 single full chart with BINANCE:BTCUSDT
  if (savedTabData && Array.isArray(savedTabData.tabs) && savedTabData.tabs.length > 0) {
    state.tabs = savedTabData.tabs.map(st => createTabObject(
      st.title,
      st.symbol,
      st.layout,
      st.panes,
      st.id,
      st.splitRatio,
      st.splitRatioSub,
      st.accountId
    ));
    state.activeTabId = savedTabData.activeTabId || state.tabs[0].id;
  } else {
    state.tabs = [
      createTabObject('BTCUSDT', 'BINANCE:BTCUSDT', '1', null, null, 50, 50, 'acc_1')
    ];
    state.activeTabId = state.tabs[0].id;
  }

  // Active Tab Getter
  function getActiveTab() {
    if (!state.tabs || state.tabs.length === 0) return null;
    return state.tabs.find(t => t.id === state.activeTabId) || state.tabs[0];
  }

  // Dynamic state properties mapped seamlessly to active tab
  Object.defineProperty(state, 'layout', {
    get() { const t = getActiveTab(); return t ? t.layout : '2v'; },
    set(v) { const t = getActiveTab(); if (t) t.layout = v; }
  });
  Object.defineProperty(state, 'splitRatio', {
    get() { const t = getActiveTab(); return t ? t.splitRatio : 50; },
    set(v) { const t = getActiveTab(); if (t) t.splitRatio = v; }
  });
  Object.defineProperty(state, 'splitRatioSub', {
    get() { const t = getActiveTab(); return t ? t.splitRatioSub : 50; },
    set(v) { const t = getActiveTab(); if (t) t.splitRatioSub = v; }
  });
  Object.defineProperty(state, 'globalSymbol', {
    get() { const t = getActiveTab(); return t ? t.symbol : 'BINANCE:BTCUSDT'; },
    set(v) { const t = getActiveTab(); if (t) t.symbol = v; }
  });
  Object.defineProperty(state, 'panes', {
    get() { const t = getActiveTab(); return t ? t.panes : []; }
  });

  // Debounced Settings Persistence
  let saveSettingsTimeout = null;
  function saveAppSettings() {
    if (saveSettingsTimeout) clearTimeout(saveSettingsTimeout);
    saveSettingsTimeout = setTimeout(() => {
      try {
        const tabsToSave = state.tabs.map(tab => ({
          id: tab.id,
          title: tab.title,
          symbol: tab.symbol,
          layout: tab.layout,
          splitRatio: tab.splitRatio,
          splitRatioSub: tab.splitRatioSub,
          accountId: tab.accountId || 'acc_1',
          panes: tab.panes.map(p => ({
            symbol: p.symbol,
            timeframe: p.timeframe,
            isInfoCollapsed: !!p.isInfoCollapsed,
            accountId: p.accountId || tab.accountId || 'acc_1'
          }))
        }));

        const data = {
          activeTabId: state.activeTabId,
          tabs: tabsToSave,
          symbolSync: state.symbolSync,
          showDrawingToolbar: state.showDrawingToolbar,
          cleanMode: state.cleanMode,
          showChartInfo: state.showChartInfo,
          showStudiesLegend: state.showStudiesLegend,
          activeDrawingTool: state.activeDrawingTool
        };
        localStorage.setItem(TABS_KEY, JSON.stringify(data));
      } catch(e) {}
    }, 250);
  }

  // DOM Elements
  const appTabsWrapper = document.getElementById('appTabsWrapper');
  const btnAddNewTab = document.getElementById('btnAddNewTab');
  const workspace = document.getElementById('workspace');
  const dragShield = document.getElementById('dragShield');
  const windowBadge = document.getElementById('windowBadge');
  const activeWindowCount = document.getElementById('activeWindowCount');
  const btnLayoutDropdown = document.getElementById('btnLayoutDropdown');
  const layoutMenu = document.getElementById('layoutMenu');
  const currentLayoutLabel = document.getElementById('currentLayoutLabel');
  const btnResetSplit = document.getElementById('btnResetSplit');
  const btnToggleSymbolSync = document.getElementById('btnToggleSymbolSync');
  const inputGlobalSymbol = document.getElementById('inputGlobalSymbol');
  const symbolAutocompleteList = document.getElementById('symbolAutocompleteList');
  const btnApplyGlobalSymbol = document.getElementById('btnApplyGlobalSymbol');

  // Multi-Watchlist elements
  const btnWatchlistToggle = document.getElementById('btnWatchlistToggle');
  const watchlistActiveTitle = document.getElementById('watchlistActiveTitle');
  const watchlistBadgeCount = document.getElementById('watchlistBadgeCount');
  const watchlistDropdownMenu = document.getElementById('watchlistDropdownMenu');
  const watchlistTabsBar = document.getElementById('watchlistTabsBar');
  const btnWatchlistNewTab = document.getElementById('btnWatchlistNewTab');
  const inputWatchlistQuickAdd = document.getElementById('inputWatchlistQuickAdd');
  const btnWatchlistQuickAdd = document.getElementById('btnWatchlistQuickAdd');
  const watchlistVerticalList = document.getElementById('watchlistVerticalList');
  const btnDeleteCurrentWatchlist = document.getElementById('btnDeleteCurrentWatchlist');

  // Header toggles & actions
  const btnToggleChartInfo = document.getElementById('btnToggleChartInfo');
  const btnToggleStudiesLegend = document.getElementById('btnToggleStudiesLegend');
  const btnToggleDrawingToolbar = document.getElementById('btnToggleDrawingToolbar');
  const btnToggleCleanMode = document.getElementById('btnToggleCleanMode');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnHelp = document.getElementById('btnHelp');
  const helpModal = document.getElementById('helpModal');
  const btnCloseHelp = document.getElementById('btnCloseHelp');
  const btnSyncDrawings = document.getElementById('btnSyncDrawings');
  const toastNotification = document.getElementById('toastNotification');

  let toastTimer = null;
  function showToast(message) {
    if (!toastNotification) return;
    toastNotification.textContent = message;
    toastNotification.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastNotification.classList.remove('show');
    }, 2500);
  }

  if (windowBadge) {
    windowBadge.textContent = `Window ${currentWindowNum}`;
  }

  // Preload path for webviews
  let chartPreloadPath = urlParams.get('chartPreload') || '';
  if (!chartPreloadPath && window.electronAPI && window.electronAPI.getChartPreloadPath) {
    chartPreloadPath = window.electronAPI.getChartPreloadPath();
  }

  // Helper: Strip HTML tags from strings
  function stripHtmlTags(str) {
    return (str || '').replace(/<[^>]*>/g, '').trim();
  }

  // =========================================================================
  // --- MULTI-WATCHLIST MANAGEMENT ENGINE ---
  // =========================================================================
  const WATCHLISTS_KEY = 'tv_splitsync_multi_watchlists_v2';
  const ACTIVE_WATCHLIST_ID_KEY = 'tv_splitsync_active_watchlist_id';

  const DEFAULT_WATCHLISTS = [
    {
      id: 'crypto',
      name: '🪙 Crypto',
      isDefault: true,
      symbols: ['BINANCE:BTCUSDT', 'BINANCE:ETHUSDT', 'BINANCE:SOLUSDT', 'BINANCE:BNBUSDT', 'BINANCE:XRPUSDT', 'BINANCE:DOGEUSDT', 'BINANCE:ADAUSDT', 'BINANCE:AVAXUSDT']
    },
    {
      id: 'forex',
      name: '💱 Forex & Gold',
      isDefault: true,
      symbols: ['FX:EURUSD', 'FX:GBPUSD', 'FX:USDJPY', 'OANDA:XAUUSD', 'TVC:GOLD', 'TVC:SILVER', 'TVC:USOIL']
    },
    {
      id: 'stocks',
      name: '📈 Stocks & Indices',
      isDefault: true,
      symbols: ['INDEX:SPX', 'INDEX:NDX', 'INDEX:DJI', 'NASDAQ:AAPL', 'NASDAQ:MSFT', 'NASDAQ:NVDA', 'NASDAQ:TSLA']
    }
  ];

  function getAllWatchlists() {
    try {
      const stored = localStorage.getItem(WATCHLISTS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch(e) {}

    // Check for migration from legacy WATCHLIST_KEY
    try {
      const oldStored = localStorage.getItem('tv_splitsync_watchlist_v7');
      if (oldStored) {
        const oldParsed = JSON.parse(oldStored);
        if (Array.isArray(oldParsed) && oldParsed.length > 0) {
          const list = JSON.parse(JSON.stringify(DEFAULT_WATCHLISTS));
          list.unshift({
            id: 'favorites',
            name: '⭐ Favorites',
            isDefault: false,
            symbols: oldParsed.map(s => stripHtmlTags(s).toUpperCase()).filter(Boolean)
          });
          saveAllWatchlists(list);
          return list;
        }
      }
    } catch(e) {}

    return JSON.parse(JSON.stringify(DEFAULT_WATCHLISTS));
  }

  function saveAllWatchlists(lists) {
    try {
      localStorage.setItem(WATCHLISTS_KEY, JSON.stringify(lists));
    } catch(e) {}
  }

  function getActiveWatchlistId() {
    const lists = getAllWatchlists();
    const storedId = localStorage.getItem(ACTIVE_WATCHLIST_ID_KEY);
    if (storedId && lists.some(l => l.id === storedId)) {
      return storedId;
    }
    return lists[0].id;
  }

  function setActiveWatchlistId(id) {
    localStorage.setItem(ACTIVE_WATCHLIST_ID_KEY, id);
    renderWatchlist();
  }

  function getActiveWatchlist() {
    const lists = getAllWatchlists();
    const id = getActiveWatchlistId();
    return lists.find(l => l.id === id) || lists[0];
  }

  function renderWatchlist() {
    const lists = getAllWatchlists();
    const activeList = getActiveWatchlist();

    if (watchlistActiveTitle) {
      watchlistActiveTitle.textContent = activeList.name.replace(/^[^\w\s]+\s*/, '');
    }
    if (watchlistBadgeCount) {
      watchlistBadgeCount.textContent = (activeList.symbols || []).length;
    }
    if (btnDeleteCurrentWatchlist) {
      btnDeleteCurrentWatchlist.style.display = activeList.isDefault ? 'none' : 'inline-block';
    }

    // Render Tabs
    if (watchlistTabsBar) {
      watchlistTabsBar.innerHTML = '';
      lists.forEach(wl => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `watchlist-tab-chip ${wl.id === activeList.id ? 'active' : ''}`;
        chip.textContent = wl.name;
        chip.title = `Switch to ${wl.name}`;
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          setActiveWatchlistId(wl.id);
        });
        watchlistTabsBar.appendChild(chip);
      });
    }

    // Render Symbols List
    if (!watchlistVerticalList) return;
    watchlistVerticalList.innerHTML = '';

    const currentUpper = (state.globalSymbol || '').toUpperCase();
    const { symbol: currentTicker } = parseSymbolAndBroker(currentUpper);
    const symbols = activeList.symbols || [];

    if (symbols.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.style.padding = '14px 10px';
      emptyRow.style.color = '#787b86';
      emptyRow.style.fontSize = '11px';
      emptyRow.style.textAlign = 'center';
      emptyRow.textContent = 'No pairs yet. Add one above!';
      watchlistVerticalList.appendChild(emptyRow);
      return;
    }

    symbols.forEach(item => {
      const { symbol: ticker, broker } = parseSymbolAndBroker(item);
      const isItemActive = (item.toUpperCase() === currentUpper || ticker === currentTicker);

      const row = document.createElement('div');
      row.className = `watchlist-vertical-row ${isItemActive ? 'active' : ''}`;
      row.title = `Click to load ${item}`;

      const left = document.createElement('div');
      left.className = 'watchlist-row-left';

      const sym = document.createElement('span');
      sym.className = 'watchlist-row-symbol';
      sym.textContent = ticker;
      left.appendChild(sym);

      if (broker) {
        const brk = document.createElement('span');
        brk.className = 'watchlist-row-broker';
        brk.textContent = broker;
        left.appendChild(brk);
      }

      const removeBtn = document.createElement('span');
      removeBtn.className = 'watchlist-row-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = `Remove ${ticker}`;
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const curLists = getAllWatchlists();
        const cur = curLists.find(l => l.id === activeList.id);
        if (cur) {
          cur.symbols = (cur.symbols || []).filter(x => x.toUpperCase() !== item.toUpperCase());
          saveAllWatchlists(curLists);
          renderWatchlist();
          showToast(`Removed ${ticker}`);
        }
      });

      row.appendChild(left);
      row.appendChild(removeBtn);

      row.addEventListener('click', () => {
        applyGlobalSymbol(item);
        if (watchlistDropdownMenu) watchlistDropdownMenu.classList.remove('show');
        if (btnWatchlistToggle) btnWatchlistToggle.classList.remove('active');
      });

      watchlistVerticalList.appendChild(row);
    });
  }

  function addToWatchlist(item) {
    if (!item) return;
    item = stripHtmlTags(item).trim().toUpperCase();
    if (!item) return;

    const curLists = getAllWatchlists();
    const activeList = curLists.find(l => l.id === getActiveWatchlistId()) || curLists[0];
    if (!activeList.symbols) activeList.symbols = [];

    const { symbol: targetTicker, broker: targetBroker } = parseSymbolAndBroker(item);
    const exists = activeList.symbols.some(existing => {
      const exUpper = existing.toUpperCase();
      const { symbol: exTicker, broker: exBroker } = parseSymbolAndBroker(exUpper);
      if (targetBroker && exBroker) return exUpper === item;
      return exTicker === targetTicker;
    });

    if (exists) {
      showToast(`${item} is already in this list`);
      return;
    }

    activeList.symbols.unshift(item);
    saveAllWatchlists(curLists);
    renderWatchlist();
    showToast(`Added ${item} to ${activeList.name}`);
  }

  // Create new custom watchlist
  if (btnWatchlistNewTab) {
    btnWatchlistNewTab.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = prompt('Enter a name for the new watchlist:');
      if (name && name.trim()) {
        const trimmed = name.trim();
        const curLists = getAllWatchlists();
        const newId = 'wl_' + Date.now();
        curLists.push({
          id: newId,
          name: trimmed,
          isDefault: false,
          symbols: []
        });
        saveAllWatchlists(curLists);
        setActiveWatchlistId(newId);
        showToast(`Created watchlist "${trimmed}"`);
      }
    });
  }

  // Delete current custom watchlist
  if (btnDeleteCurrentWatchlist) {
    btnDeleteCurrentWatchlist.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeList = getActiveWatchlist();
      if (activeList.isDefault) return;
      if (confirm(`Are you sure you want to delete "${activeList.name}"?`)) {
        let curLists = getAllWatchlists().filter(l => l.id !== activeList.id);
        if (curLists.length === 0) curLists = JSON.parse(JSON.stringify(DEFAULT_WATCHLISTS));
        saveAllWatchlists(curLists);
        setActiveWatchlistId(curLists[0].id);
        showToast(`Deleted watchlist`);
      }
    });
  }

  // Watchlist Dropdown toggle
  if (btnWatchlistToggle && watchlistDropdownMenu) {
    btnWatchlistToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = watchlistDropdownMenu.classList.toggle('show');
      btnWatchlistToggle.classList.toggle('active', isOpen);
      if (isOpen && inputWatchlistQuickAdd) {
        setTimeout(() => inputWatchlistQuickAdd.focus(), 50);
      }
      updateTauriOverlaysState();
    });

    document.addEventListener('click', (e) => {
      if (!btnWatchlistToggle.contains(e.target) && !watchlistDropdownMenu.contains(e.target)) {
        if (watchlistDropdownMenu.classList.contains('show')) {
          watchlistDropdownMenu.classList.remove('show');
          btnWatchlistToggle.classList.remove('active');
          updateTauriOverlaysState();
        }
      }
    });
  }

  // Watchlist quick-add form
  if (btnWatchlistQuickAdd && inputWatchlistQuickAdd) {
    const handleQuickAdd = () => {
      const val = inputWatchlistQuickAdd.value.trim();
      if (!val) return;
      addToWatchlist(val);
      inputWatchlistQuickAdd.value = '';
    };

    btnWatchlistQuickAdd.addEventListener('click', handleQuickAdd);
    inputWatchlistQuickAdd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleQuickAdd();
      }
    });
  }

  // --- MASTER FAVORITE DRAWINGS TOOLBAR & CUSTOMIZATION SYSTEM ---
  const ALL_AVAILABLE_TOOLS = [
    // --- CURSOR ---
    {
      id: 'cursor',
      name: 'Cursor / Pan',
      category: 'Cursor',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l7 18 3-7 7-3L3 3z"></path></svg>'
    },

    // --- LINES & TREND ---
    {
      id: 'LineToolTrendLine',
      name: 'Trend Line',
      category: 'Lines & Trend',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"></line><circle cx="5" cy="19" r="2" fill="currentColor"></circle><circle cx="19" cy="5" r="2" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolHorzLine',
      name: 'Horizontal Line',
      category: 'Lines & Trend',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolHorzRay',
      name: 'Horizontal Ray',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="12" x2="21" y2="12"></line><circle cx="10" cy="12" r="2" fill="currentColor"></circle><path d="M18 9l3 3-3 3"></path></svg>'
    },
    {
      id: 'LineToolRay',
      name: 'Ray',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="18" x2="19" y2="5"></line><circle cx="6" cy="18" r="2" fill="currentColor"></circle><path d="M15 5h4v4"></path></svg>'
    },
    {
      id: 'LineToolArrow',
      name: 'Arrow Line',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"></line><polyline points="13 5 19 5 19 11"></polyline></svg>'
    },
    {
      id: 'LineToolExtended',
      name: 'Extended Line',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="2" y1="22" x2="22" y2="2"></line><circle cx="8" cy="16" r="2" fill="currentColor"></circle><circle cx="16" cy="8" r="2" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolVertLine',
      name: 'Vertical Line',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="3" x2="12" y2="21"></line><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolCrossLine',
      name: 'Cross Line',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="12" y1="3" x2="12" y2="21"></line><circle cx="12" cy="12" r="2.5" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolParallelChannel',
      name: 'Parallel Channel',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="15" x2="20" y2="6"></line><line x1="4" y1="20" x2="20" y2="11"></line><line x1="4" y1="17.5" x2="20" y2="8.5" stroke-dasharray="2,2"></line></svg>'
    },
    {
      id: 'LineToolDisjointChannel',
      name: 'Disjoint Channel',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="18" x2="21" y2="10"></line><line x1="3" y1="12" x2="21" y2="4"></line></svg>'
    },
    {
      id: 'LineToolFlatBottom',
      name: 'Flat Top / Bottom',
      category: 'Lines & Trend',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="10"></line></svg>'
    },

    // --- ARROWS & MARKERS (Shot 3/4) ---
    {
      id: 'LineToolArrowMarkUp',
      name: 'Arrow mark up',
      category: 'Arrows',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l-6 6h4v9h4v-9h4l-6-6z"></path></svg>'
    },
    {
      id: 'LineToolArrowMarkDown',
      name: 'Arrow mark down',
      category: 'Arrows',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20l6-6h-4V5h-4v9H6l6 6z"></path></svg>'
    },
    {
      id: 'LineToolArrowMarker',
      name: 'Arrow Marker',
      category: 'Arrows',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 00-4 4c0 3 4 8 4 8s4-5 4-8a4 4 0 00-4-4z"></path><polyline points="9 16 12 22 15 16"></polyline></svg>'
    },
    {
      id: 'LineToolFlagMark',
      name: 'Flag Mark',
      category: 'Arrows',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>'
    },

    // --- SHAPES ---
    {
      id: 'LineToolRectangle',
      name: 'Rectangle',
      category: 'Shapes',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="1"></rect><circle cx="4" cy="4" r="1.5" fill="currentColor"></circle><circle cx="20" cy="4" r="1.5" fill="currentColor"></circle><circle cx="4" cy="20" r="1.5" fill="currentColor"></circle><circle cx="20" cy="20" r="1.5" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolRotatedRectangle',
      name: 'Rotated Rectangle',
      category: 'Shapes',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="1" transform="rotate(25 12 12)"></rect></svg>'
    },
    {
      id: 'LineToolCircle',
      name: 'Circle / Ellipse',
      category: 'Shapes',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="6"></ellipse></svg>'
    },
    {
      id: 'LineToolTriangle',
      name: 'Triangle',
      category: 'Shapes',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 4 4 20 20 20"></polygon></svg>'
    },
    {
      id: 'LineToolArc',
      name: 'Curve / Arc',
      category: 'Shapes',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18C4 10 10 4 18 4"></path><circle cx="4" cy="18" r="1.5" fill="currentColor"></circle><circle cx="18" cy="4" r="1.5" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolPath',
      name: 'Path / Polyline',
      category: 'Shapes',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 17 9 11 13 15 21 7"></polyline><circle cx="3" cy="17" r="1.5" fill="currentColor"></circle><circle cx="9" cy="11" r="1.5" fill="currentColor"></circle><circle cx="13" cy="15" r="1.5" fill="currentColor"></circle><circle cx="21" cy="7" r="1.5" fill="currentColor"></circle></svg>'
    },

    // --- FIBONACCI & PITCHFORKS ---
    {
      id: 'LineToolFibRetracement',
      name: 'Fib Retracement',
      category: 'Fibonacci',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="5" x2="20" y2="5"></line><line x1="4" y1="9.5" x2="20" y2="9.5"></line><line x1="4" y1="14.5" x2="20" y2="14.5"></line><line x1="4" y1="19" x2="20" y2="19"></line><line x1="5" y1="19" x2="19" y2="5" stroke-dasharray="2,2"></line><circle cx="5" cy="19" r="1.5" fill="currentColor"></circle><circle cx="19" cy="5" r="1.5" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolTrendBasedFibExtension',
      name: 'Fib Extension',
      category: 'Fibonacci',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="4 18 10 6 16 14 21 4"></polyline><line x1="4" y1="10" x2="20" y2="10" stroke-dasharray="2,2"></line></svg>'
    },
    {
      id: 'LineToolFibChannel',
      name: 'Fib Channel',
      category: 'Fibonacci',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="16" x2="18" y2="4"></line><line x1="6" y1="18" x2="20" y2="6"></line><line x1="8" y1="20" x2="22" y2="8"></line></svg>'
    },
    {
      id: 'LineToolFibTimeZone',
      name: 'Fib Time Zone',
      category: 'Fibonacci',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="4" y1="4" x2="4" y2="20"></line><line x1="7" y1="4" x2="7" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line><line x1="20" y1="4" x2="20" y2="20"></line></svg>'
    },
    {
      id: 'LineToolPitchfork',
      name: 'Pitchfork',
      category: 'Fibonacci',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="12" x2="20" y2="12"></line><line x1="12" y1="6" x2="20" y2="6"></line><line x1="12" y1="18" x2="20" y2="18"></line><line x1="4" y1="12" x2="12" y2="6"></line><line x1="4" y1="12" x2="12" y2="18"></line></svg>'
    },
    {
      id: 'LineToolGannBox',
      name: 'Gann Box',
      category: 'Fibonacci',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16"></rect><line x1="9.3" y1="4" x2="9.3" y2="20"></line><line x1="14.7" y1="4" x2="14.7" y2="20"></line><line x1="4" y1="9.3" x2="20" y2="9.3"></line><line x1="4" y1="14.7" x2="20" y2="14.7"></line><circle cx="4" cy="20" r="1.8" fill="var(--color-bg-primary, #131722)" stroke="currentColor" stroke-width="1.4"></circle><circle cx="20" cy="4" r="1.8" fill="var(--color-bg-primary, #131722)" stroke="currentColor" stroke-width="1.4"></circle></svg>'
    },
    {
      id: 'LineToolGannSquare',
      name: 'Gann Square',
      category: 'Fibonacci',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="4" width="16" height="16"></rect><line x1="4" y1="4" x2="20" y2="20"></line><line x1="4" y1="20" x2="20" y2="4"></line></svg>'
    },

    // --- DRAW & TEXT ---
    {
      id: 'LineToolBrush',
      name: 'Brush',
      category: 'Draw & Text',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 12l-8 8H4v-6l8-8 6 6z"></path><path d="M15 3l6 6"></path></svg>'
    },
    {
      id: 'LineToolHighlighter',
      name: 'Highlighter',
      category: 'Draw & Text',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l-6 6v3h3l6-6"></path><path d="M14 6l4 4"></path><path d="M19 3l2 2-2 2-2-2 2-2z"></path></svg>'
    },
    {
      id: 'LineToolText',
      name: 'Text Note',
      category: 'Draw & Text',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="12" y1="4" x2="12" y2="20"></line><line x1="9" y1="20" x2="15" y2="20"></line></svg>'
    },
    {
      id: 'LineToolCallout',
      name: 'Callout',
      category: 'Draw & Text',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path></svg>'
    },
    {
      id: 'LineToolPriceLabel',
      name: 'Price Label',
      category: 'Draw & Text',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"></path><circle cx="7" cy="7" r="1.5" fill="currentColor"></circle></svg>'
    },
    {
      id: 'LineToolPriceNote',
      name: 'Price Note',
      category: 'Draw & Text',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"></rect><line x1="7" y1="9" x2="17" y2="9"></line><line x1="7" y1="13" x2="13" y2="13"></line></svg>'
    },

    // --- TRADING & MEASUREMENT ---
    {
      id: 'LineToolRiskRewardLong',
      name: 'Long Position',
      category: 'Trading & Measure',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="7" fill="rgba(38,166,154,0.3)" stroke="#26a69a"></rect><rect x="4" y="11" width="16" height="9" fill="rgba(239,83,80,0.3)" stroke="#ef5350"></rect><line x1="4" y1="11" x2="20" y2="11" stroke="#ffffff" stroke-width="2"></line></svg>'
    },
    {
      id: 'LineToolRiskRewardShort',
      name: 'Short Position',
      category: 'Trading & Measure',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="9" fill="rgba(239,83,80,0.3)" stroke="#ef5350"></rect><rect x="4" y="13" width="16" height="7" fill="rgba(38,166,154,0.3)" stroke="#26a69a"></rect><line x1="4" y1="13" x2="20" y2="13" stroke="#ffffff" stroke-width="2"></line></svg>'
    },
    {
      id: 'LineToolPrediction',
      name: 'Forecast / Prediction',
      category: 'Trading & Measure',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"></circle><path d="M12 8v4l3 3"></path></svg>'
    },
    {
      id: 'LineToolDateAndPriceRange',
      name: 'Date & Price Range',
      category: 'Trading & Measure',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" stroke-dasharray="3,3"></rect><path d="M8 12h8M12 8v8"></path></svg>'
    },
    {
      id: 'LineToolPriceRange',
      name: 'Price Range',
      category: 'Trading & Measure',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="6" y1="4" x2="18" y2="4"></line><line x1="6" y1="20" x2="18" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>'
    },
    {
      id: 'LineToolDateRange',
      name: 'Date Range',
      category: 'Trading & Measure',
      defaultEnabled: false,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="4" y2="18"></line><line x1="20" y1="6" x2="20" y2="18"></line><line x1="4" y1="12" x2="20" y2="12"></line></svg>'
    },

    // --- UTILITY ---
    {
      id: 'measure',
      name: 'Measure',
      category: 'Utility',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21l18-18M7 17l2-2M11 13l2-2M15 9l2-2"></path></svg>'
    },
    {
      id: 'eraser',
      name: 'Eraser',
      category: 'Utility',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 14l-6 6H4l4-4 9-9 5 5-4 2z"></path><path d="M14 6l4 4"></path></svg>'
    },
    {
      id: 'removeAllDrawingTools',
      name: 'Clear All (Trash)',
      category: 'Utility',
      defaultEnabled: true,
      svg: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>'
    }
  ];

  const CUSTOM_TOOLS_KEY = 'tv_splitsync_favorite_tools_v3';
  const DEFAULT_ENABLED_TOOLS = ALL_AVAILABLE_TOOLS.filter(t => t.defaultEnabled).map(t => t.id);

  function getEnabledTools() {
    try {
      const stored = localStorage.getItem(CUSTOM_TOOLS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch(e) {}
    return [...DEFAULT_ENABLED_TOOLS];
  }

  function saveEnabledTools(tools) {
    try {
      localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(tools));
    } catch(e) {}
  }

  function updateFavoriteToolButtonsActive() {
    const cur = state.activeDrawingTool || 'cursor';
    document.querySelectorAll('#favoriteDrawingsBar .fav-tool-btn').forEach(btn => {
      const toolId = btn.getAttribute('data-tool');
      if (toolId === 'removeAllDrawingTools' || toolId === 'customize') return;
      btn.classList.toggle('active', toolId === cur);
    });
  }

  function selectDrawingTool(tool) {
    if (tool === 'removeAllDrawingTools') {
      if (window.electronAPI && window.electronAPI.evalInAllCharts) {
        window.electronAPI.evalInAllCharts(`if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') { window.__TVSync.selectDrawingTool('removeAllDrawingTools'); }`);
      }
      const curTab = getActiveTab();
      const tabPanes = (curTab && curTab.panes) ? curTab.panes : state.panes;
      tabPanes.forEach(pane => {
        if (pane.webview) {
          try {
            pane.webview.send('set-drawing-tool', { tool: 'removeAllDrawingTools' });
            pane.webview.executeJavaScript(`
              if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') {
                window.__TVSync.selectDrawingTool('removeAllDrawingTools');
              }
            `).catch(() => {});
          } catch(e) {}
        }
      });
      showToast('Drawings cleared on active chart');
      return;
    }

    // Toggle off: if clicking already active tool, revert to cursor
    if (state.activeDrawingTool === tool && tool !== 'cursor') {
      tool = 'cursor';
    }

    state.activeDrawingTool = tool;
    updateFavoriteToolButtonsActive();
    saveAppSettings();

    if (window.electronAPI && window.electronAPI.evalInAllCharts) {
      window.electronAPI.evalInAllCharts(`if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') { window.__TVSync.selectDrawingTool('${tool}'); }`);
    }

    const curTab = getActiveTab();
    const tabPanes = (curTab && curTab.panes) ? curTab.panes : state.panes;
    tabPanes.forEach(pane => {
      if (pane.webview) {
        try {
          pane.webview.send('set-drawing-tool', { tool: tool });
          pane.webview.executeJavaScript(`
            if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') {
              window.__TVSync.selectDrawingTool('${tool}');
            }
          `).catch(() => {});
        } catch(e) {}
      }
    });

    const toolObj = ALL_AVAILABLE_TOOLS.find(t => t.id === tool);
    const toolName = toolObj ? toolObj.name : tool;
    showToast(`Tool: ${toolName}`);
  }

  function renderFavoriteDrawingsBar() {
    const container = document.getElementById('favoriteDrawingsBar');
    if (!container) return;
    container.innerHTML = '';

    const enabledIds = getEnabledTools();
    const curActive = state.activeDrawingTool || 'cursor';

    enabledIds.forEach(id => {
      const toolObj = ALL_AVAILABLE_TOOLS.find(t => t.id === id);
      if (!toolObj) return;

      const btn = document.createElement('button');
      const isClearAll = toolObj.id === 'removeAllDrawingTools';
      btn.className = `fav-tool-btn ${isClearAll ? 'btn-clear-chart-drawings' : ''} ${toolObj.id === curActive && !isClearAll ? 'active' : ''}`;
      btn.setAttribute('data-tool', toolObj.id);
      btn.title = toolObj.name;
      btn.innerHTML = toolObj.svg;

      btn.addEventListener('click', () => {
        selectDrawingTool(toolObj.id);
      });

      container.appendChild(btn);
    });

    // Append Customize Button (Gear Icon)
    const btnCustomize = document.createElement('button');
    btnCustomize.id = 'btnCustomizeDrawings';
    btnCustomize.className = 'fav-tool-btn btn-customize-tools';
    btnCustomize.setAttribute('data-tool', 'customize');
    btnCustomize.title = 'Customize toolbar (Add or remove drawing tools)';
    btnCustomize.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"></path>
      </svg>
    `;
    btnCustomize.addEventListener('click', (e) => {
      e.stopPropagation();
      openCustomizeToolsModal();
    });
    container.appendChild(btnCustomize);
  }

  // Customize Tools Modal Handling
  const customizeToolsModal = document.getElementById('customizeToolsModal');
  const btnCloseCustomizeTools = document.getElementById('btnCloseCustomizeTools');
  const btnDoneCustomizeTools = document.getElementById('btnDoneCustomizeTools');
  const btnResetDefaultTools = document.getElementById('btnResetDefaultTools');
  const customizeToolsGrid = document.getElementById('customizeToolsGrid');
  const customizeToolsCountBadge = document.getElementById('customizeToolsCountBadge');

  function openCustomizeToolsModal() {
    if (!customizeToolsModal) return;
    renderCustomizeToolsGrid();
    customizeToolsModal.classList.add('show');
    if (typeof updateTauriOverlaysState === 'function') updateTauriOverlaysState();
  }

  function closeCustomizeToolsModal() {
    if (!customizeToolsModal) return;
    customizeToolsModal.classList.remove('show');
    if (typeof updateTauriOverlaysState === 'function') updateTauriOverlaysState();
  }

  function renderCustomizeToolsGrid() {
    if (!customizeToolsGrid) return;
    customizeToolsGrid.innerHTML = '';

    const enabledIds = getEnabledTools();
    if (customizeToolsCountBadge) {
      customizeToolsCountBadge.textContent = `${enabledIds.length} of ${ALL_AVAILABLE_TOOLS.length} active`;
    }

    // Group tools by category
    const categories = ['Cursor', 'Lines & Trend', 'Arrows', 'Shapes', 'Fibonacci', 'Draw & Text', 'Trading', 'Utility'];

    categories.forEach(cat => {
      const toolsInCat = ALL_AVAILABLE_TOOLS.filter(t => t.category === cat);
      if (toolsInCat.length === 0) return;

      const groupEl = document.createElement('div');
      groupEl.className = 'tool-category-group';

      const titleEl = document.createElement('div');
      titleEl.className = 'tool-category-title';
      titleEl.textContent = cat;
      groupEl.appendChild(titleEl);

      const itemsGrid = document.createElement('div');
      itemsGrid.className = 'tool-items-container';

      toolsInCat.forEach(tool => {
        const isChecked = enabledIds.includes(tool.id);
        const card = document.createElement('div');
        card.className = `tool-customize-card ${isChecked ? 'checked' : ''}`;
        card.dataset.id = tool.id;

        card.innerHTML = `
          <div class="tool-card-left">
            <div class="tool-card-icon">${tool.svg}</div>
            <span class="tool-card-name">${tool.name}</span>
          </div>
          <div class="tool-card-switch"></div>
        `;

        card.addEventListener('click', () => {
          let currentList = getEnabledTools();
          if (currentList.includes(tool.id)) {
            // Cannot disable cursor if it is the only tool
            if (currentList.length <= 1) {
              showToast('At least one tool must remain active');
              return;
            }
            currentList = currentList.filter(id => id !== tool.id);
            card.classList.remove('checked');
          } else {
            currentList.push(tool.id);
            card.classList.add('checked');
          }

          saveEnabledTools(currentList);
          if (customizeToolsCountBadge) {
            customizeToolsCountBadge.textContent = `${currentList.length} of ${ALL_AVAILABLE_TOOLS.length} active`;
          }
          renderFavoriteDrawingsBar();
        });

        itemsGrid.appendChild(card);
      });

      groupEl.appendChild(itemsGrid);
      customizeToolsGrid.appendChild(groupEl);
    });
  }

  function setupCustomizeToolsModal() {
    if (btnCloseCustomizeTools) {
      btnCloseCustomizeTools.addEventListener('click', closeCustomizeToolsModal);
    }
    if (btnDoneCustomizeTools) {
      btnDoneCustomizeTools.addEventListener('click', closeCustomizeToolsModal);
    }
    if (btnResetDefaultTools) {
      btnResetDefaultTools.addEventListener('click', () => {
        saveEnabledTools([...DEFAULT_ENABLED_TOOLS]);
        renderCustomizeToolsGrid();
        renderFavoriteDrawingsBar();
        showToast('Drawing tools reset to default');
      });
    }
    if (customizeToolsModal) {
      customizeToolsModal.addEventListener('click', (e) => {
        if (e.target === customizeToolsModal) closeCustomizeToolsModal();
      });
    }
  }

  // --- CHART INFO OVERLAY BADGE UPDATER ---
  function updatePaneInfoBadge(paneId, symbol, timeframe) {
    const { symbol: ticker, broker } = parseSymbolAndBroker(symbol);
    const badge = document.getElementById(`info_badge_${paneId}`);
    if (badge) {
      const symEl = badge.querySelector('.info-badge-symbol');
      const brkEl = badge.querySelector('.info-badge-broker');
      const tfEl = badge.querySelector('.info-badge-tf');

      if (symEl) symEl.textContent = ticker;
      if (brkEl) {
        brkEl.textContent = broker || 'TV';
        brkEl.style.display = broker ? 'inline-block' : 'none';
      }
      if (tfEl && timeframe) tfEl.textContent = formatTimeframe(timeframe);
    }

    // Direct synchronization into child webview overlay badge
    if (window.electronAPI && window.electronAPI.evalInChart) {
      const safeSym = (ticker || '').replace(/'/g, "\\'");
      const safeTf = (timeframe || '').replace(/'/g, "\\'");
      const safeBrk = (broker || '').replace(/'/g, "\\'");
      window.electronAPI.evalInChart(paneId, `if (window.__TVSync && typeof window.__TVSync.updateChartInfo === 'function') { window.__TVSync.updateChartInfo('${safeSym}', '${safeTf}', '${safeBrk}'); }`);
    }
  }

  // Global Chart Info Toggle Button
  if (btnToggleChartInfo) {
    btnToggleChartInfo.classList.toggle('active', state.showChartInfo);
    btnToggleChartInfo.addEventListener('click', () => {
      state.showChartInfo = !state.showChartInfo;
      btnToggleChartInfo.classList.toggle('active', state.showChartInfo);

      document.querySelectorAll('.chart-info-overlay').forEach(badge => {
        badge.classList.toggle('hidden', !state.showChartInfo);
      });

      if (window.electronAPI && window.electronAPI.evalInAllCharts) {
        window.electronAPI.evalInAllCharts(`if (window.__TVSync && typeof window.__TVSync.setChartInfoVisible === 'function') { window.__TVSync.setChartInfoVisible(${state.showChartInfo}); }`);
      }

      saveAppSettings();
      showToast(state.showChartInfo ? 'Chart Info: Visible' : 'Chart Info: Hidden');
    });
  }

  // Indicator legend (study list) toggle
  function broadcastStudiesLegendState() {
    if (!window.electronAPI || !window.electronAPI.evalInAllCharts) return;
    // The eval also re-stamps the preference inside each chart profile, so charts rebuilt
    // later come up with the same legend state without waiting for another push.
    window.electronAPI.evalInAllCharts(`if (window.__TVSync && typeof window.__TVSync.setStudiesLegendVisible === 'function') { window.__TVSync.setStudiesLegendVisible(${state.showStudiesLegend}); }`);
  }

  if (btnToggleStudiesLegend) {
    btnToggleStudiesLegend.classList.toggle('active', state.showStudiesLegend);
    btnToggleStudiesLegend.addEventListener('click', () => {
      state.showStudiesLegend = !state.showStudiesLegend;
      btnToggleStudiesLegend.classList.toggle('active', state.showStudiesLegend);
      broadcastStudiesLegendState();
      saveAppSettings();
      showToast(state.showStudiesLegend ? 'Indicator legend: Visible' : 'Indicator legend: Hidden');
    });
  }

  // --- COMPREHENSIVE MULTI-CHART LAYOUT DEFINITIONS & VISIBLE PANES GETTER ---
  const LAYOUT_PANE_COUNTS = {
    '1': 1,
    '2v': 2, '2h': 2,
    '3v': 3, '3h': 3, '3-left': 3, '3-right': 3, '3-top': 3, '3-bottom': 3, '3': 3,
    '4-grid': 4, '4h': 4, '4v': 4, '4-left': 4, '4-right': 4, '4-top': 4, '4-bottom': 4, '4-cols-2-1': 4, '4-cols-1-2': 4, '4-rows-2-1': 4, '4': 4,
    '5-top': 5, '5v': 5, '5h': 5, '5-left': 5, '5-right': 5, '5-grid-2-3': 5, '5-grid-3-2': 5, '5-bottom': 5, '5-cols-2-3': 5, '5-cols-3-2': 5,
    '6-grid': 6, '6v': 6, '6h': 6, '6-grid-2x3': 6, '6-top-2-4': 6, '6-top-4-2': 6, '6': 6,
    '7-grid-4-3': 7, '7v': 7, '7-left': 7,
    '8-grid': 8, '8-grid-2x4': 8, '8v': 8, '8h': 8,
    '9-grid': 9,
    '10-grid': 10,
    '12-grid': 12,
    '16-grid': 16, '16-grid-2x8': 16, '16-grid-8x2': 16
  };

  const LAYOUT_DISPLAY_LABELS = {
    '1': 'Single',
    '2v': '2V', '2h': '2H',
    '3v': '3V', '3h': '3H', '3-left': '3 Left', '3-right': '3 Right', '3-top': '3 Top', '3-bottom': '3 Bottom', '3': '3 Left',
    '4-grid': '4 Grid', '4h': '4H', '4v': '4V', '4-left': '4 Left', '4-right': '4 Right', '4-top': '4 Top', '4-bottom': '4 Bottom', '4-cols-2-1': '4 Cols', '4-cols-1-2': '4 Cols', '4-rows-2-1': '4 Rows', '4': '4 Grid',
    '5-top': '5 Top', '5v': '5V', '5h': '5H', '5-left': '5 Left', '5-right': '5 Right', '5-grid-2-3': '5 Grid (2/3)', '5-grid-3-2': '5 Grid (3/2)', '5-bottom': '5 Bottom', '5-cols-2-3': '5 Cols', '5-cols-3-2': '5 Cols',
    '6-grid': '6 Grid', '6v': '6V', '6h': '6H', '6-grid-2x3': '6 Grid (2x3)', '6-top-2-4': '6 Top', '6-top-4-2': '6 Bottom', '6': '6 Grid',
    '7-grid-4-3': '7 Grid', '7v': '7V', '7-left': '7 Left',
    '8-grid': '8 Grid (4x2)', '8-grid-2x4': '8 Grid (2x4)', '8v': '8V', '8h': '8H',
    '9-grid': '9 Grid (3x3)',
    '10-grid': '10 Grid (5x2)',
    '12-grid': '12 Grid (4x3)',
    '16-grid': '16 Grid (4x4)',
    '16-grid-2x8': '16 Grid (8x2)',
    '16-grid-8x2': '16 Grid (2x8)'
  };

  function getLayoutDisplayLabel(layout) {
    return LAYOUT_DISPLAY_LABELS[layout] || layout?.toUpperCase() || 'Layout';
  }

  function getVisiblePanesForTab(tab) {
    if (!tab || !Array.isArray(tab.panes)) return [];
    const count = LAYOUT_PANE_COUNTS[tab.layout] || 1;
    return tab.panes.slice(0, count);
  }

  // --- UNIFIED PANE CHART UPDATER (Works seamlessly in both Tauri & Electron) ---
  function updatePaneChart(pane, symbol, timeframe) {
    if (!pane) return;
    const targetSymbol = symbol || pane.symbol || 'BINANCE:BTCUSDT';
    const targetTf = timeframe || pane.timeframe || '1D';

    const symbolChanged = (pane.symbol !== targetSymbol);
    const tfChanged = (pane.timeframe !== targetTf);

    pane.symbol = targetSymbol;
    pane.timeframe = targetTf;

    updatePaneInfoBadge(pane.id, targetSymbol, targetTf);

    const isTauriEnv = !!(window.electronAPI && window.electronAPI.isTauri) || !!window.__TAURI__ || !!window.__TAURI_INTERNALS__;

    if (isTauriEnv && window.electronAPI && window.electronAPI.evalInChart) {
      const script = `
        (function() {
          var targetSym = '${targetSymbol}';
          var targetTf = '${targetTf}';
          var needSym = ${symbolChanged};
          var needTf = ${tfChanged};

          function tryApply() {
            var appliedSym = !needSym;
            var appliedTf = !needTf;

            if (window.__TVSync) {
              if (needSym && typeof window.__TVSync.setSymbol === 'function') {
                appliedSym = window.__TVSync.setSymbol(targetSym);
              }
              if (needTf && typeof window.__TVSync.setTimeframe === 'function') {
                appliedTf = window.__TVSync.setTimeframe(targetTf);
              }
            }
            return appliedSym && appliedTf;
          }

          if (!tryApply()) {
            var retries = 0;
            var timer = setInterval(function() {
              retries++;
              if (tryApply() || retries >= 15) {
                clearInterval(timer);
              }
            }, 120);
          }
        })();
      `;
      window.electronAPI.evalInChart(pane.id, script);
    } else if (pane.webview) {
      updateWebviewChart(pane.webview, targetSymbol, targetTf);
    }
  }

  // Listen for active window count updates from main process
  if (window.electronAPI && window.electronAPI.onWindowCountUpdate) {
    window.electronAPI.onWindowCountUpdate((data) => {
      if (activeWindowCount) activeWindowCount.textContent = data.count || '1';
    });
  }

  // Listen for cross-window broadcast sync from main process
  if (window.electronAPI && window.electronAPI.onBroadcastSync) {
    window.electronAPI.onBroadcastSync((data) => {
      // If event came from this window, ignore to prevent echo loops
      if (data.sourceWindowId === state.windowId) return;

      if (data.type === 'symbol' && state.symbolSync) {
        state.globalSymbol = data.symbol;
        if (inputGlobalSymbol) inputGlobalSymbol.value = data.symbol;
        renderWatchlist();
        const curTab = getActiveTab();
        const visiblePanes = getVisiblePanesForTab(curTab);
        visiblePanes.forEach(pane => {
          updatePaneChart(pane, data.symbol, pane.timeframe);
        });
        saveAppSettings();
      }
    });
  }

  // --- RENDER WORKSPACE FOR A SPECIFIC TAB ---
  function renderWorkspaceForTab(tab) {
    if (!tab) return;
    let tabWs = tab.workspaceEl || document.getElementById(`workspace_${tab.id}`);
    if (!tabWs) {
      tabWs = document.createElement('div');
      tabWs.id = `workspace_${tab.id}`;
      tabWs.className = `tab-workspace ${tab.id === state.activeTabId ? 'active' : ''}`;
      tabWs.style.display = (tab.id === state.activeTabId) ? 'flex' : 'none';
      tab.workspaceEl = tabWs;
      workspace.appendChild(tabWs);
    } else {
      tab.workspaceEl = tabWs;
    }

    tabWs.innerHTML = '';
    tabWs.style.flexDirection = 'row';
    state.maximizedPaneId = null;

    function makePane(idx) {
      if (!tab.panes[idx]) {
        const defaultTimeframes = ['1D', '240', '60', '15', '5', '1', '1W', '1M', '30', '45', '120', '180', '2D', '3D', '3M', '12M'];
        tab.panes[idx] = {
          id: `${tab.id}_p${idx + 1}`,
          symbol: tab.symbol || 'BINANCE:BTCUSDT',
          timeframe: defaultTimeframes[idx] || '1D',
          group: 'A',
          isMaximized: false,
          isInfoCollapsed: false,
          webview: null
        };
      }
      return createPaneElement(tab.panes[idx], idx);
    }

    function makeCol(children, flex = 1) {
      const col = document.createElement('div');
      col.className = 'layout-col-container';
      col.style.flex = `${flex} ${flex} 0%`;
      col.style.minWidth = '0';
      col.style.minHeight = '0';
      col.style.width = '100%';
      col.style.height = '100%';
      children.forEach(c => {
        if (!c.style.flex || c.style.flex === 'none') {
          c.style.flex = '1 1 0%';
        }
        c.style.minWidth = '0';
        c.style.minHeight = '0';
        c.style.width = '100%';
        c.style.height = '100%';
        col.appendChild(c);
      });
      return col;
    }

    function makeRow(children, flex = 1) {
      const row = document.createElement('div');
      row.className = 'layout-row-container';
      row.style.flex = `${flex} ${flex} 0%`;
      row.style.minWidth = '0';
      row.style.minHeight = '0';
      row.style.width = '100%';
      row.style.height = '100%';
      children.forEach(c => {
        if (!c.style.flex || c.style.flex === 'none') {
          c.style.flex = '1 1 0%';
        }
        c.style.minWidth = '0';
        c.style.minHeight = '0';
        c.style.width = '100%';
        c.style.height = '100%';
        row.appendChild(c);
      });
      return row;
    }

    function makeGrid(cols, rows, count, startIdx = 0) {
      const grid = document.createElement('div');
      grid.className = 'layout-grid-container';
      grid.style.flex = '1 1 0%';
      grid.style.minWidth = '0';
      grid.style.minHeight = '0';
      grid.style.width = '100%';
      grid.style.height = '100%';
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
      for (let i = 0; i < count; i++) {
        const p = makePane(startIdx + i);
        p.style.minWidth = '0';
        p.style.minHeight = '0';
        p.style.width = '100%';
        p.style.height = '100%';
        grid.appendChild(p);
      }
      return grid;
    }

    const layout = tab.layout || '1';
    const targetCount = LAYOUT_PANE_COUNTS[layout] || 1;

    // Clean up excess panes when switching to a layout with fewer charts
    if (Array.isArray(tab.panes) && tab.panes.length > targetCount) {
      const excessPanes = tab.panes.slice(targetCount);
      if (excessPanes.length > 0 && window.electronAPI && window.electronAPI.closeChartViews) {
        const excessIds = excessPanes.map(p => p.id);
        window.electronAPI.closeChartViews(excessIds).catch(() => {});
      }
      tab.panes = tab.panes.slice(0, targetCount);
    }

    // --- ROW 1: Single Chart ---
    if (layout === '1') {
      const pane = makePane(0);
      pane.style.flex = '1 1 0%';
      pane.style.width = '100%';
      pane.style.height = '100%';
      tabWs.appendChild(pane);
    } 
    // --- ROW 2: 2 Charts ---
    else if (layout === '2v') {
      const paneLeft = makePane(0);
      const paneRight = makePane(1);
      paneLeft.style.flex = 'none';
      paneLeft.style.width = `calc(${tab.splitRatio}% - 1px)`;
      paneLeft.style.height = '100%';
      paneRight.style.flex = 'none';
      paneRight.style.width = `calc(${100 - tab.splitRatio}% - 1px)`;
      paneRight.style.height = '100%';

      const splitter = createSplitter('vertical', (newPercent) => {
        tab.splitRatio = newPercent;
        paneLeft.style.width = `calc(${newPercent}% - 1px)`;
        paneRight.style.width = `calc(${100 - newPercent}% - 1px)`;
        saveAppSettings();
      });

      tabWs.appendChild(paneLeft);
      tabWs.appendChild(splitter);
      tabWs.appendChild(paneRight);
    } 
    else if (layout === '2h') {
      tabWs.style.flexDirection = 'column';
      const paneTop = makePane(0);
      const paneBottom = makePane(1);
      paneTop.style.flex = 'none';
      paneTop.style.height = `calc(${tab.splitRatio}% - 1px)`;
      paneTop.style.width = '100%';
      paneBottom.style.flex = 'none';
      paneBottom.style.height = `calc(${100 - tab.splitRatio}% - 1px)`;
      paneBottom.style.width = '100%';

      const splitter = createSplitter('horizontal', (newPercent) => {
        tab.splitRatio = newPercent;
        paneTop.style.height = `calc(${newPercent}% - 1px)`;
        paneBottom.style.height = `calc(${100 - newPercent}% - 1px)`;
        saveAppSettings();
      });

      tabWs.appendChild(paneTop);
      tabWs.appendChild(splitter);
      tabWs.appendChild(paneBottom);
    } 
    // --- ROW 3: 3 Charts ---
    else if (layout === '3v') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makePane(2)]));
    }
    else if (layout === '3h') {
      tabWs.appendChild(makeCol([makePane(0), makePane(1), makePane(2)]));
    }
    else if (layout === '3' || layout === '3-left') {
      tabWs.appendChild(makeRow([makePane(0), makeCol([makePane(1), makePane(2)])]));
    }
    else if (layout === '3-right') {
      tabWs.appendChild(makeRow([makeCol([makePane(0), makePane(1)]), makePane(2)]));
    }
    else if (layout === '3-top') {
      tabWs.appendChild(makeCol([makePane(0), makeRow([makePane(1), makePane(2)])]));
    }
    else if (layout === '3-bottom') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1)]), makePane(2)]));
    }
    // --- ROW 4: 4 Charts ---
    else if (layout === '4' || layout === '4-grid') {
      tabWs.appendChild(makeGrid(2, 2, 4));
    }
    else if (layout === '4h') {
      tabWs.appendChild(makeCol([makePane(0), makePane(1), makePane(2), makePane(3)]));
    }
    else if (layout === '4v') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makePane(2), makePane(3)]));
    }
    else if (layout === '4-left') {
      tabWs.appendChild(makeRow([makePane(0), makeCol([makePane(1), makePane(2), makePane(3)])]));
    }
    else if (layout === '4-right') {
      tabWs.appendChild(makeRow([makeCol([makePane(0), makePane(1), makePane(2)]), makePane(3)]));
    }
    else if (layout === '4-top') {
      tabWs.appendChild(makeCol([makePane(0), makeRow([makePane(1), makePane(2), makePane(3)])]));
    }
    else if (layout === '4-bottom') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1), makePane(2)]), makePane(3)]));
    }
    else if (layout === '4-cols-2-1') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makeCol([makePane(2), makePane(3)])]));
    }
    else if (layout === '4-cols-1-2') {
      tabWs.appendChild(makeRow([makeCol([makePane(0), makePane(1)]), makePane(2), makePane(3)]));
    }
    else if (layout === '4-rows-2-1') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1)]), makeCol([makePane(2), makePane(3)])]));
    }
    // --- ROW 5: 5 Charts ---
    else if (layout === '5-top') {
      tabWs.appendChild(makeCol([makePane(0), makeRow([makePane(1), makePane(2), makePane(3), makePane(4)])]));
    }
    else if (layout === '5v') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4)]));
    }
    else if (layout === '5h') {
      tabWs.appendChild(makeCol([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4)]));
    }
    else if (layout === '5-left') {
      tabWs.appendChild(makeRow([makePane(0), makeCol([makePane(1), makePane(2), makePane(3), makePane(4)])]));
    }
    else if (layout === '5-right') {
      tabWs.appendChild(makeRow([makeCol([makePane(0), makePane(1), makePane(2), makePane(3)]), makePane(4)]));
    }
    else if (layout === '5-grid-2-3') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1)]), makeRow([makePane(2), makePane(3), makePane(4)])]));
    }
    else if (layout === '5-grid-3-2') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1), makePane(2)]), makeRow([makePane(3), makePane(4)])]));
    }
    else if (layout === '5-bottom') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1), makePane(2), makePane(3)]), makePane(4)]));
    }
    else if (layout === '5-cols-2-3') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makeCol([makePane(2), makePane(3), makePane(4)])]));
    }
    else if (layout === '5-cols-3-2') {
      tabWs.appendChild(makeRow([makeCol([makePane(0), makePane(1), makePane(2)]), makePane(3), makePane(4)]));
    }
    // --- ROW 6: 6 Charts ---
    else if (layout === '6' || layout === '6-grid') {
      tabWs.appendChild(makeGrid(3, 2, 6));
    }
    else if (layout === '6v') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4), makePane(5)]));
    }
    else if (layout === '6h') {
      tabWs.appendChild(makeCol([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4), makePane(5)]));
    }
    else if (layout === '6-grid-2x3') {
      tabWs.appendChild(makeGrid(2, 3, 6));
    }
    else if (layout === '6-top-2-4') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1)]), makeRow([makePane(2), makePane(3), makePane(4), makePane(5)])]));
    }
    else if (layout === '6-top-4-2') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1), makePane(2), makePane(3)]), makeRow([makePane(4), makePane(5)])]));
    }
    // --- ROW 7: 7 Charts ---
    else if (layout === '7-grid-4-3') {
      tabWs.appendChild(makeCol([makeRow([makePane(0), makePane(1), makePane(2), makePane(3)]), makeRow([makePane(4), makePane(5), makePane(6)])]));
    }
    else if (layout === '7v') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4), makePane(5), makePane(6)]));
    }
    else if (layout === '7-left') {
      tabWs.appendChild(makeRow([makePane(0), makeCol([makePane(1), makePane(2), makePane(3), makePane(4), makePane(5), makePane(6)])]));
    }
    // --- ROW 8: 8 Charts ---
    else if (layout === '8-grid') {
      tabWs.appendChild(makeGrid(4, 2, 8));
    }
    else if (layout === '8-grid-2x4') {
      tabWs.appendChild(makeGrid(2, 4, 8));
    }
    else if (layout === '8v') {
      tabWs.appendChild(makeRow([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4), makePane(5), makePane(6), makePane(7)]));
    }
    else if (layout === '8h') {
      tabWs.appendChild(makeCol([makePane(0), makePane(1), makePane(2), makePane(3), makePane(4), makePane(5), makePane(6), makePane(7)]));
    }
    // --- ROW 9: 9 Charts ---
    else if (layout === '9-grid') {
      tabWs.appendChild(makeGrid(3, 3, 9));
    }
    // --- ROW 10: 10 Charts ---
    else if (layout === '10-grid') {
      tabWs.appendChild(makeGrid(5, 2, 10));
    }
    // --- ROW 12: 12 Charts ---
    else if (layout === '12-grid') {
      tabWs.appendChild(makeGrid(4, 3, 12));
    }
    // --- ROW 16: 16 Charts ---
    else if (layout === '16-grid') {
      tabWs.appendChild(makeGrid(4, 4, 16));
    }
    else if (layout === '16-grid-2x8') {
      tabWs.appendChild(makeGrid(8, 2, 16));
    }
    else if (layout === '16-grid-8x2') {
      tabWs.appendChild(makeGrid(2, 8, 16));
    }
    else {
      // Fallback: 2v
      tabWs.appendChild(makeRow([makePane(0), makePane(1)]));
    }

    if (typeof syncTauriChartBounds === 'function') {
      syncTauriChartBounds();
    }
  }

  // --- RENDER ACTIVE WORKSPACE ---
  function renderWorkspace() {
    const curTab = getActiveTab();
    if (!curTab) return;
    renderWorkspaceForTab(curTab);
    if (typeof syncTauriChartBounds === 'function') {
      syncTauriChartBounds();
    }
  }

  // --- TRADINGVIEW DESKTOP TAB BAR MANAGEMENT ---
  function renderTabsBar() {
    if (!appTabsWrapper) return;
    appTabsWrapper.innerHTML = '';

    const accList = ACCOUNT_IDS;

    state.tabs.forEach((tab) => {
      const tabEl = document.createElement('div');
      const isActive = (tab.id === state.activeTabId);
      tabEl.className = `tab-item ${isActive ? 'active' : ''}`;
      tabEl.setAttribute('data-tab-id', tab.id);

      const currentAcc = tab.accountId || 'acc_1';
      const accLabel = getAccountShortLabel(currentAcc);
      tabEl.title = `${tab.title} (${tab.symbol}) - اکانت [${accLabel}] - برای چرخش اکانت روی نشان کلیک کنید`;

      tabEl.innerHTML = `
        <span class="tab-acc-badge ${currentAcc}" title="اکانت [${accLabel}] - کلیک برای تغییر اکانت">[${accLabel}]</span>
        <span class="tab-title-text">${tab.title || 'Chart'}</span>
        <span class="tab-close-btn" title="Close Tab (Ctrl+W)">&times;</span>
      `;

      // Cycle account directly on click of account badge
      const accBadge = tabEl.querySelector('.tab-acc-badge');
      if (accBadge) {
        accBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          const curIdx = accList.indexOf(tab.accountId || 'acc_1');
          const nextAcc = accList[(curIdx + 1) % accList.length];
          tab.accountId = nextAcc;
          if (Array.isArray(tab.panes)) {
            tab.panes.forEach(p => { p.accountId = nextAcc; });
          }
          renderTabsBar();
          saveAppSettings();
          if (typeof syncTauriChartBounds === 'function') {
            syncTauriChartBounds();
          }
          showToast(`اکانت تب ${tab.title} به [${getAccountShortLabel(nextAcc)}] تغییر یافت`);
        });
      }

      tabEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close-btn') || e.target.classList.contains('tab-acc-badge')) return;
        switchTab(tab.id);
      });

      const closeBtn = tabEl.querySelector('.tab-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeTab(tab.id);
        });
      }

      tabEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const titleSpan = tabEl.querySelector('.tab-title-text');
        if (!titleSpan || titleSpan.querySelector('input')) return;

        const curTitle = tab.title || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'tab-inline-rename-input';
        input.value = curTitle;

        titleSpan.textContent = '';
        titleSpan.appendChild(input);
        input.focus();
        input.select();

        let finished = false;
        function finishRename(save) {
          if (finished) return;
          finished = true;
          const val = input.value.trim();
          if (save && val) {
            tab.title = val;
            titleSpan.textContent = tab.title;
            saveAppSettings();
          } else {
            titleSpan.textContent = tab.title;
          }
        }

        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            ke.preventDefault();
            finishRename(true);
          } else if (ke.key === 'Escape') {
            ke.preventDefault();
            finishRename(false);
          }
        });

        input.addEventListener('blur', () => {
          finishRename(true);
        });
      });

      appTabsWrapper.appendChild(tabEl);
    });
  }

  function switchTab(tabId) {
    const targetTab = state.tabs.find(t => t.id === tabId);
    if (!targetTab) return;

    state.activeTabId = tabId;

    // Render workspace DOM container for this tab if not yet created
    if (!targetTab.workspaceEl || !targetTab.workspaceEl.parentNode) {
      renderWorkspaceForTab(targetTab);
    }

    // Toggle visibility for all tab workspaces in DOM
    state.tabs.forEach(t => {
      if (t.workspaceEl) {
        const isActive = (t.id === tabId);
        t.workspaceEl.classList.toggle('active', isActive);
        t.workspaceEl.style.display = isActive ? 'flex' : 'none';
      }
    });

    // Update active tab buttons in tab strip
    document.querySelectorAll('#appTabsWrapper .tab-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-tab-id') === tabId);
    });

    // Update layout selector label and active option
    if (currentLayoutLabel) {
      currentLayoutLabel.textContent = getLayoutDisplayLabel(targetTab.layout);
    }
    document.querySelectorAll('.tv-layout-btn, .layout-option').forEach(opt => {
      opt.classList.toggle('active', opt.getAttribute('data-layout') === targetTab.layout);
    });

    if (inputGlobalSymbol) {
      inputGlobalSymbol.value = targetTab.symbol;
    }

    // Charts rebuilt for this tab may live in a profile that never received the last
    // legend toggle, so re-push the preference every time a tab becomes active.
    broadcastStudiesLegendState();

    renderWatchlist();
    saveAppSettings();

    // Sync bounds instantly (shows active tab webviews and hides background tab webviews with zero reload)
    if (typeof syncTauriChartBounds === 'function') {
      syncTauriChartBounds();
    }
  }

  function createNewTab(opts = {}) {
    const defaultSym = opts.symbol || state.globalSymbol || 'BINANCE:BTCUSDT';
    const { symbol: ticker } = parseSymbolAndBroker(defaultSym);
    const title = opts.title || ticker || 'New Tab';
    const current = getActiveTab();
    const autoAcc = opts.accountId || (current && current.accountId) || 'acc_1';
    const newTab = createTabObject(title, defaultSym, opts.layout || '2v', null, null, 50, 50, autoAcc);

    state.tabs.push(newTab);
    renderTabsBar();
    switchTab(newTab.id);
    showToast(`تب جدید با اکانت [${getAccountShortLabel(autoAcc)}] ایجاد شد: ${newTab.title}`);
  }

  function closeTab(tabId) {
    if (state.tabs.length <= 1) {
      showToast('Cannot close the last remaining tab');
      return;
    }

    const tabIndex = state.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const [removedTab] = state.tabs.splice(tabIndex, 1);
    if (removedTab && removedTab.workspaceEl && removedTab.workspaceEl.parentNode) {
      removedTab.workspaceEl.parentNode.removeChild(removedTab.workspaceEl);
    }

    // Clean up native child webviews for the closed tab
    if (removedTab && Array.isArray(removedTab.panes) && window.electronAPI && window.electronAPI.closeChartViews) {
      const paneIds = removedTab.panes.map(p => p.id);
      window.electronAPI.closeChartViews(paneIds).catch(() => {});
    }

    if (state.activeTabId === tabId) {
      const nextIndex = Math.max(0, Math.min(tabIndex, state.tabs.length - 1));
      const nextTab = state.tabs[nextIndex];
      renderTabsBar();
      switchTab(nextTab.id);
    } else {
      renderTabsBar();
      saveAppSettings();
    }

    showToast(`Closed tab: ${removedTab.title}`);
  }

  function updateActiveTabSymbolAndTitle(newSymbol) {
    const activeTab = getActiveTab();
    if (!activeTab || !newSymbol) return;
    activeTab.symbol = newSymbol;
    const { symbol: ticker } = parseSymbolAndBroker(newSymbol);
    activeTab.title = ticker;

    const activeTabEl = document.querySelector(`#appTabsWrapper .tab-item[data-tab-id="${activeTab.id}"] .tab-title-text`);
    if (activeTabEl) {
      activeTabEl.textContent = ticker;
    }
    saveAppSettings();
  }

  // --- CREATE SINGLE PANE ELEMENT WITH INFO OVERLAY BADGE ---
  function createPaneElement(paneData, index) {
    const pane = document.createElement('div');
    pane.className = 'chart-pane';
    pane.id = `container_${paneData.id}`;
    pane.style.flex = '1 1 0%';
    pane.style.minWidth = '0';
    pane.style.minHeight = '0';
    pane.style.width = '100%';
    pane.style.height = '100%';

    // Webview Container
    const webviewWrapper = document.createElement('div');
    webviewWrapper.className = 'pane-webview-wrapper';

    const isTauriEnv = !!(window.electronAPI && window.electronAPI.isTauri) || !!window.__TAURI__ || !!window.__TAURI_INTERNALS__;

    if (isTauriEnv) {
      const ph = document.createElement('div');
      ph.id = `wv_${paneData.id}`;
      ph.className = 'tauri-chart-placeholder';
      ph.style.cssText = 'width: 100%; height: 100%; background: #131722; display: flex; align-items: center; justify-content: center;';

      const tauriWebview = {
        id: paneData.id,
        send: function(channel, data) {
          if (window.electronAPI && window.electronAPI.evalInChart) {
            const json = JSON.stringify(data || {});
            window.electronAPI.evalInChart(paneData.id, `window.__tvDispatchMessage && window.__tvDispatchMessage('${channel}', ${json})`);
          }
        },
        executeJavaScript: function(code) {
          if (window.electronAPI && window.electronAPI.evalInChart) {
            return window.electronAPI.evalInChart(paneData.id, code);
          }
          return Promise.resolve();
        },
        reload: function() {
          if (window.electronAPI && window.electronAPI.evalInChart) {
            window.electronAPI.evalInChart(paneData.id, 'window.location.reload()');
          }
        },
        loadURL: function(url) {
          if (window.electronAPI && window.electronAPI.evalInChart) {
            window.electronAPI.evalInChart(paneData.id, `window.location.replace('${url}')`);
          }
        },
        addEventListener: function() {}
      };

      paneData.webview = tauriWebview;
      webviewWrapper.appendChild(ph);
    } else {
      const webview = document.createElement('webview');
      webview.id = `wv_${paneData.id}`;
      webview.setAttribute('partition', 'persist:tradingview');
      webview.setAttribute('allowpopups', 'true');
      webview.setAttribute('webpreferences', 'contextIsolation=false');

      if (chartPreloadPath) {
        webview.setAttribute('preload', chartPreloadPath);
      }

      const targetUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(paneData.symbol)}&interval=${encodeURIComponent(paneData.timeframe)}&theme=dark`;
      webview.src = targetUrl;
      paneData.webview = webview;

      // Attach IPC communication listeners from webview
      setupWebviewListeners(webview, paneData, index);
      webviewWrapper.appendChild(webview);
    }

    pane.appendChild(webviewWrapper);

    // Top-left Chart Info Overlay Badge (Symbol · Broker · Timeframe with eye toggle)
    const { symbol: ticker, broker } = parseSymbolAndBroker(paneData.symbol);
    const infoBadge = document.createElement('div');
    infoBadge.id = `info_badge_${paneData.id}`;
    infoBadge.className = `chart-info-overlay ${state.showChartInfo ? '' : 'hidden'} ${paneData.isInfoCollapsed ? 'collapsed' : ''}`;
    
    infoBadge.innerHTML = `
      <div class="info-badge-details">
        <span class="info-badge-symbol">${ticker}</span>
        ${broker ? `<span class="info-badge-broker">${broker}</span>` : '<span class="info-badge-broker" style="display:none"></span>'}
        <span class="info-badge-tf">${formatTimeframe(paneData.timeframe)}</span>
      </div>
      <button class="info-badge-toggle" title="Toggle this chart's info badge">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>
    `;

    const toggleBtn = infoBadge.querySelector('.info-badge-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        paneData.isInfoCollapsed = !paneData.isInfoCollapsed;
        infoBadge.classList.toggle('collapsed', paneData.isInfoCollapsed);
        saveAppSettings();
      });
    }

    pane.appendChild(infoBadge);

    return pane;
  }

  // --- RESIZABLE SPLITTER GENERATOR (Edge Split Screen Style) ---
  function createSplitter(type, onDrag) {
    const splitter = document.createElement('div');
    splitter.className = `splitter ${type}`;

    const handle = document.createElement('div');
    handle.className = 'splitter-handle';
    splitter.appendChild(handle);

    let isDragging = false;
    let startPos = 0;
    let containerSize = 0;

    splitter.addEventListener('mousedown', (e) => {
      isDragging = true;
      splitter.classList.add('dragging');
      dragShield.classList.add('active');

      const rect = workspace.getBoundingClientRect();
      startPos = type === 'vertical' ? e.clientX : e.clientY;
      containerSize = type === 'vertical' ? rect.width : rect.height;

      const onMouseMove = (moveEvent) => {
        if (!isDragging) return;
        const currentPos = type === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
        const offset = type === 'vertical' ? (currentPos - rect.left) : (currentPos - rect.top);
        let percent = (offset / containerSize) * 100;
        percent = Math.max(15, Math.min(85, percent));
        onDrag(percent);
      };

      const onMouseUp = () => {
        isDragging = false;
        splitter.classList.remove('dragging');
        dragShield.classList.remove('active');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        // Notify all webviews to resize their canvas
        state.panes.forEach(p => {
          if (p.webview) {
            try {
              p.webview.executeJavaScript(`
                window.dispatchEvent(new Event('resize'));
                window.dispatchEvent(new UIEvent('resize'));
                try { if (window._exposed_chartWidgetCollection) window._exposed_chartWidgetCollection._updateLayout(); } catch(e) {}
              `);
            } catch(e) {}
          }
        });

        saveAppSettings();
        if (typeof syncTauriChartBounds === 'function') {
          syncTauriChartBounds();
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    // Double click to reset split ratio to 50/50 (Edge feature)
    splitter.addEventListener('dblclick', () => {
      onDrag(50);
      saveAppSettings();
      if (typeof syncTauriChartBounds === 'function') {
        syncTauriChartBounds();
      }
      showToast('Split divider reset to 50/50');
    });

    return splitter;
  }

  // --- HANDLE INCOMING CHART IPC MESSAGES (SYMBOL, TIMEFRAME, TOOLS, DRAWINGS) ---
  function handleIncomingChartMessage(paneData, channel, data) {
    if (!paneData) return;

    if (channel === 'chart-symbol-detected') {
      const detectedSymbol = data.symbol;
      if (detectedSymbol && detectedSymbol !== paneData.symbol) {
        paneData.symbol = detectedSymbol;
        updatePaneInfoBadge(paneData.id, detectedSymbol, paneData.timeframe);
        saveAppSettings();

        // If symbol sync is enabled, sync to local panes & broadcast to other windows
        if (state.symbolSync) {
          state.globalSymbol = detectedSymbol;
          updateActiveTabSymbolAndTitle(detectedSymbol);
          if (inputGlobalSymbol) inputGlobalSymbol.value = detectedSymbol;
          renderWatchlist();

          const curTab = getActiveTab();
          const visiblePanes = getVisiblePanesForTab(curTab);
          visiblePanes.forEach(otherPane => {
            if (otherPane.id !== paneData.id) {
              updatePaneChart(otherPane, detectedSymbol, otherPane.timeframe);
            }
          });

          if (window.electronAPI && window.electronAPI.broadcastSync) {
            window.electronAPI.broadcastSync({
              type: 'symbol',
              sourceWindowId: state.windowId,
              symbol: detectedSymbol
            });
          }
        }
      }
    }
    else if (channel === 'chart-timeframe-detected') {
      const detectedTf = data.timeframe;
      if (detectedTf && detectedTf !== paneData.timeframe) {
        paneData.timeframe = detectedTf;
        updatePaneInfoBadge(paneData.id, paneData.symbol, detectedTf);
        saveAppSettings();
      }
    }
    else if (channel === 'chart-drawings-saved') {
      showToast('Analysis & drawings saved to cloud');
    }
    else if (channel === 'chart-drawing-tool-changed') {
      let newTool = data.tool || 'cursor';
      const reverseMap = {
        'GannBox': 'LineToolGannBox',
        'gann_box': 'LineToolGannBox',
        'GannSquare': 'LineToolGannSquare',
        'gann_square': 'LineToolGannSquare',
        'VerticalLine': 'LineToolVertLine',
        'HorizontalLine': 'LineToolHorzLine',
        'ParallelChannel': 'LineToolParallelChannel',
        'LineToolChannel': 'LineToolParallelChannel',
        'LineToolLongPosition': 'LineToolRiskRewardLong',
        'LineToolShortPosition': 'LineToolRiskRewardShort',
        'LineToolPositionForecast': 'LineToolPrediction',
        'LineToolRetracements': 'LineToolFibRetracement',
        'LineToolDisjointAngle': 'LineToolDisjointChannel',
        'LineToolEllipse': 'LineToolCircle'
      };
      if (reverseMap[newTool]) newTool = reverseMap[newTool];
      state.activeDrawingTool = newTool;
      updateFavoriteToolButtonsActive();
    }
  }

  // --- TAURI GLOBAL CHART IPC LISTENER ---
  if (window.electronAPI && window.electronAPI.onChartMessage) {
    window.electronAPI.onChartMessage((msg) => {
      if (!msg) return;
      const curTab = getActiveTab();
      const tabPanes = (curTab && curTab.panes) ? curTab.panes : state.panes;
      const targetPane = tabPanes.find(p => p.id === msg.paneId) || tabPanes[0];
      if (targetPane) {
        handleIncomingChartMessage(targetPane, msg.channel, msg.payload || {});
      }
    });
  }

  // --- TAURI SYNC CHART BOUNDS CONTROLLER ---
  let syncTauriTimer = null;
  function syncTauriChartBounds() {
    if (!window.electronAPI || !window.electronAPI.isTauri || !window.electronAPI.syncChartViews) return;

    if (syncTauriTimer) clearTimeout(syncTauriTimer);
    syncTauriTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        const curTab = getActiveTab();
        if (!curTab) return;

        const visiblePanes = getVisiblePanesForTab(curTab);
        const visibleIds = new Set(visiblePanes.map(p => p.id));
        const panesToSync = [];

        // 1. Visible panes of the active tab (visible: true with real client rects)
        visiblePanes.forEach(pane => {
          const paneEl = document.getElementById(`container_${pane.id}`);
          const pAcc = pane.accountId || curTab.accountId || 'acc_1';
          if (paneEl && paneEl.offsetParent !== null) {
            const rect = paneEl.getBoundingClientRect();
            if (rect.width > 20 && rect.height > 20) {
              panesToSync.push({
                id: pane.id,
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                symbol: pane.symbol || curTab.symbol || 'BINANCE:BTCUSDT',
                timeframe: pane.timeframe || '1D',
                visible: true,
                account_id: pAcc
              });
            }
          }
        });

        // 2. Inactive panes across active tab and background tabs (visible: false)
        // Keeps background webviews alive in memory without closing them
        state.tabs.forEach(tab => {
          if (Array.isArray(tab.panes)) {
            tab.panes.forEach(pane => {
              if (!visibleIds.has(pane.id)) {
                panesToSync.push({
                  id: pane.id,
                  x: 0,
                  y: 0,
                  width: 0,
                  height: 0,
                  symbol: pane.symbol || tab.symbol || 'BINANCE:BTCUSDT',
                  timeframe: pane.timeframe || '1D',
                  visible: false,
                  account_id: pane.accountId || tab.accountId || 'acc_1'
                });
              }
            });
          }
        });

        if (panesToSync.length > 0) {
          window.electronAPI.syncChartViews(panesToSync);
        }
      });
    }, 20);
  }
  window.syncTauriChartBounds = syncTauriChartBounds;

  // Prevent any browser viewport auto-scroll (locks tab strip and header in place)
  window.addEventListener('scroll', () => {
    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  });

  // --- OVERLAY MIRROR CONTROLLER ---------------------------------------------------
  // Native chart webviews always paint above the shell's HTML, so a dropdown or modal
  // opened by this page would end up hidden behind them. Instead of blanking every chart
  // for as long as a menu is open, the open overlay is mirrored into a transparent native
  // popup window and its pointer events are replayed back here.
  const OVERLAY_SELECTOR = [
    '.dropdown-menu.show',
    '.watchlist-menu-dropdown.show',
    '.symbol-autocomplete-dropdown.show',
    '.modal-backdrop.show',
    '.modal.show',
    '[class*="modal"].show'
  ].join(', ');

  let _mirrorOpen = false;
  let _mirrorPayload = '';
  let _mirrorQueued = false;
  let _mirrorUnavailable = false;
  let _lastOverlaysState = true;

  function openOverlays() {
    return Array.from(document.querySelectorAll(OVERLAY_SELECTOR))
      .filter(el => el.getClientRects().length > 0);
  }

  // Position of an element among its sibling elements, so it can be found again inside
  // the detached clone that is shipped to the popup.
  function elementPath(el) {
    const path = [];
    let node = el;
    while (node && node !== document.body) {
      const parent = node.parentNode;
      if (!parent) return null;
      path.push(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return path.reverse();
  }

  function buildMirrorMarkup(overlays) {
    overlays.forEach(el => {
      el.querySelectorAll('input, textarea').forEach(field => {
        if (field.value !== field.getAttribute('value')) field.setAttribute('value', field.value);
      });
    });

    const clone = document.body.cloneNode(true);
    overlays.forEach((el, index) => {
      const path = elementPath(el);
      if (!path) return;
      let node = clone;
      for (const step of path) {
        node = node && node.children[step];
        if (!node) break;
      }
      if (node) node.setAttribute('data-ov', String(index));
    });
    return clone.innerHTML;
  }

  function publishMirror() {
    const api = window.electronAPI;
    const overlays = openOverlays();

    if (overlays.length === 0) {
      if (_mirrorOpen) {
        _mirrorOpen = false;
        _mirrorPayload = '';
        api.overlayHide();
      }
      return;
    }

    if (!_mirrorOpen) {
      _mirrorOpen = true;
      _mirrorPayload = '';
      api.overlayShow().catch(() => {
        _mirrorOpen = false;
        _mirrorUnavailable = true;
      });
    }

    const payload = JSON.stringify({
      html: buildMirrorMarkup(overlays),
      htmlClass: document.documentElement.className,
      bodyClass: document.body.className,
      vw: window.innerWidth,
      vh: window.innerHeight
    });
    if (payload === _mirrorPayload) return;
    _mirrorPayload = payload;
    if (api.logToFile) api.logToFile(`mirror publish: ${overlays.map(el => el.id || el.className).join('|')} (${payload.length} bytes)`);
    api.overlayPublish(payload);
  }

  // Legacy path for the (rare) case where the popup window could not be created: fall
  // back to hiding the charts so menus stay reachable.
  function hideChartsForOverlays() {
    const shouldHide = openOverlays().length > 0;
    const newChartsVisible = !shouldHide;
    if (_lastOverlaysState !== newChartsVisible) {
      _lastOverlaysState = newChartsVisible;
      window.electronAPI.setChartsVisible(newChartsVisible);
      if (newChartsVisible) syncTauriChartBounds();
    }
  }

  function updateTauriOverlaysState(source) {
    const api = window.electronAPI;
    if (!api || !api.isTauri || !api.overlayShow) return;
    if (_mirrorUnavailable) hideChartsForOverlays();
    else publishMirror();
  }
  window.updateTauriOverlaysState = updateTauriOverlaysState;

  // A click in the popup never reaches this document, so replay it on whatever element
  // sits under those coordinates - the real handlers then run unchanged.
  window.__mirrorEvent = function (ev) {
    if (!ev || typeof ev.type !== 'string') return;
    // The popup page reloads lazily; let it re-ask for the current markup.
    if (ev.type === 'mirror-ready') {
      _mirrorPayload = '';
      if (_mirrorOpen) publishMirror();
      if (window.electronAPI.overlayRefocus) window.electronAPI.overlayRefocus();
      return;
    }
    if (typeof ev.x !== 'number') return;
    const target = document.elementFromPoint(ev.x, ev.y) || document.body;
    // A replayed click is untrusted, so the browser never moves the caret on its own.
    if (ev.type === 'click') {
      const field = target.closest && target.closest('input, textarea, select, [contenteditable="true"]');
      if (field && document.activeElement !== field) field.focus();
    }
    const init = {
      bubbles: true, cancelable: true, composed: true,
      clientX: ev.x, clientY: ev.y, screenX: ev.x, screenY: ev.y,
      button: ev.button || 0, buttons: ev.buttons || 0,
      ctrlKey: !!ev.ctrlKey, shiftKey: !!ev.shiftKey, altKey: !!ev.altKey, metaKey: !!ev.metaKey
    };
    let event;
    if (ev.type.indexOf('pointer') === 0) {
      event = new PointerEvent(ev.type, Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, init));
    } else if (ev.type === 'wheel') {
      event = new WheelEvent('wheel', Object.assign({ deltaX: ev.deltaX || 0, deltaY: ev.deltaY || 0 }, init));
    } else {
      event = new MouseEvent(ev.type, init);
    }
    target.dispatchEvent(event);
  };

  document.addEventListener('click', (e) => {
    if (window.electronAPI && window.electronAPI.logToFile) {
      window.electronAPI.logToFile(`document clicked on: <${e.target.tagName}> id="${e.target.id}" class="${e.target.className}"`);
    }
  });

  // Automatic observer for modals and dropdowns
  function requestMirrorUpdate() {
    if (_mirrorQueued) return;
    _mirrorQueued = true;
    requestAnimationFrame(() => {
      _mirrorQueued = false;
      updateTauriOverlaysState('mutation');
    });
  }

  try {
    const overlayObserver = new MutationObserver(requestMirrorUpdate);
    overlayObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'style', 'value'],
      childList: true,
      subtree: true
    });
  } catch(e) {}

  // Menus whose contents change without touching class/childList still stay in sync.
  setInterval(() => { if (_mirrorOpen) publishMirror(); }, 120);
  window.addEventListener('resize', () => { if (_mirrorOpen) { _mirrorPayload = ''; publishMirror(); } });

  // --- SETUP WEBVIEW EVENT LISTENERS ---
  function setupWebviewListeners(webview, paneData, index) {
    if (!webview || typeof webview.addEventListener !== 'function') return;

    webview.addEventListener('ipc-message', (event) => {
      const channel = event.channel;
      const data = event.args && event.args[0] ? event.args[0] : {};
      handleIncomingChartMessage(paneData, channel, data);
    });

    webview.addEventListener('dom-ready', () => {
      webview.send('init-pane', { 
        paneId: paneData.id, 
        linkGroup: paneData.group,
        hideDrawingToolbar: !state.showDrawingToolbar,
        cleanMode: state.cleanMode
      });

      // Synchronize active drawing tool to newly ready chart
      if (state.activeDrawingTool) {
        webview.send('set-drawing-tool', { tool: state.activeDrawingTool });
        webview.executeJavaScript(`
          if (window.__TVSync && typeof window.__TVSync.selectDrawingTool === 'function') {
            window.__TVSync.selectDrawingTool('${state.activeDrawingTool}');
          }
        `).catch(() => {});
      }
    });
  }

  // --- ROBUST WEBVIEW NAVIGATION (Updates every pane without fail) ---
  function updateWebviewChart(webview, symbol, timeframe) {
    if (!webview) return;
    const targetSymbol = symbol || 'BINANCE:BTCUSDT';
    const targetTf = timeframe || '1D';

    if (window.electronAPI && window.electronAPI.isTauri) {
      webview.executeJavaScript(`
        if (window.__TVSync && typeof window.__TVSync.setSymbol === 'function') {
          window.__TVSync.setSymbol('${targetSymbol}');
          if ('${targetTf}') window.__TVSync.setTimeframe('${targetTf}');
        }
      `).catch(() => {});
      return;
    }

    try {
      const currentUrlStr = webview.getURL() || webview.src || '';
      if (currentUrlStr && currentUrlStr.includes('tradingview.com/chart')) {
        const u = new URL(currentUrlStr);
        const curSymbol = u.searchParams.get('symbol');
        if (curSymbol && curSymbol.toUpperCase() === targetSymbol.toUpperCase()) {
          return; // Already viewing this exact symbol
        }
        u.searchParams.set('symbol', targetSymbol);
        if (targetTf) u.searchParams.set('interval', targetTf);
        u.searchParams.set('theme', 'dark');
        webview.src = u.toString();
        webview.loadURL(u.toString());
        return;
      }
    } catch(e) {}

    const targetUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(targetSymbol)}&interval=${encodeURIComponent(targetTf)}&theme=dark`;
    webview.src = targetUrl;
    webview.loadURL(targetUrl);
  }

  // --- APPLY GLOBAL SYMBOL (Syncs to all panes if symbolSync is on, or active pane if off) ---
  function applyGlobalSymbol(symbol) {
    if (!symbol) return;
    symbol = symbol.trim();
    if (!symbol) return;

    state.globalSymbol = symbol;
    updateActiveTabSymbolAndTitle(symbol);
    if (inputGlobalSymbol) inputGlobalSymbol.value = symbol;
    renderWatchlist();
    saveAppSettings();

    const curTab = getActiveTab();
    const visiblePanes = getVisiblePanesForTab(curTab);

    if (state.symbolSync) {
      // 1. Update every visible pane in the current window
      visiblePanes.forEach(pane => {
        updatePaneChart(pane, symbol, pane.timeframe);
      });

      // 2. Broadcast across all other open windows
      if (window.electronAPI && window.electronAPI.broadcastSync) {
        window.electronAPI.broadcastSync({
          type: 'symbol',
          sourceWindowId: state.windowId,
          symbol: symbol
        });
      }
    } else {
      // When Symbol Sync is OFF: update only the primary/first pane
      const primaryPane = visiblePanes[0] || (curTab && curTab.panes[0]);
      if (primaryPane) {
        updatePaneChart(primaryPane, symbol, primaryPane.timeframe);
      }
    }

    const { symbol: ticker } = parseSymbolAndBroker(symbol);
    showToast(`Symbol updated to ${ticker}`);
  }

  // --- DRAWINGS & ANALYSIS INSTANT SYNC ---
  function syncAllDrawings() {
    if (btnSyncDrawings) {
      btnSyncDrawings.classList.add('saving');
      const textSpan = btnSyncDrawings.querySelector('span');
      if (textSpan) textSpan.textContent = 'Saving and syncing...';
    }

    // 1. Tell all webviews to trigger cloud save
    state.panes.forEach(pane => {
      if (pane.webview) {
        try {
          pane.webview.send('sync-drawings');
        } catch(e) {}
      }
    });

    // 2. Wait 700ms for cloud save request to complete
    setTimeout(() => {
      if (btnSyncDrawings) {
        btnSyncDrawings.classList.remove('saving');
        const textSpan = btnSyncDrawings.querySelector('span');
        if (textSpan) textSpan.textContent = 'Sync (Ctrl+S)';
      }
      showToast('Analysis & drawings synchronized successfully');
    }, 700);
  }

  // --- EVENT LISTENERS ---

  // Layout Dropdown
  if (currentLayoutLabel) {
    currentLayoutLabel.textContent = getLayoutDisplayLabel(state.layout);
  }

  document.querySelectorAll('.tv-layout-btn, .layout-option').forEach(opt => {
    opt.classList.toggle('active', opt.getAttribute('data-layout') === state.layout);
  });

  if (btnLayoutDropdown && layoutMenu) {
    btnLayoutDropdown.addEventListener('click', (e) => {
      e.stopPropagation();
      layoutMenu.classList.toggle('show');
      updateTauriOverlaysState();
    });

    document.addEventListener('click', (e) => {
      if (!btnLayoutDropdown.contains(e.target) && !layoutMenu.contains(e.target)) {
        if (layoutMenu.classList.contains('show')) {
          layoutMenu.classList.remove('show');
          updateTauriOverlaysState('layout-click-outside');
        }
      }
    });

    document.querySelectorAll('.tv-layout-btn, .layout-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const selected = opt.getAttribute('data-layout');
        if (!selected) return;
        state.layout = selected;

        document.querySelectorAll('.tv-layout-btn, .layout-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');

        if (currentLayoutLabel) {
          currentLayoutLabel.textContent = getLayoutDisplayLabel(selected);
        }
        layoutMenu.classList.remove('show');
        updateTauriOverlaysState();
        saveAppSettings();
        renderWorkspace();
        showToast(`Layout changed to ${getLayoutDisplayLabel(selected)}`);
      });
    });
  }

  // Reset Split Ratio
  if (btnResetSplit) {
    btnResetSplit.addEventListener('click', () => {
      state.splitRatio = 50;
      state.splitRatioSub = 50;
      saveAppSettings();
      renderWorkspace();
      showToast('Split divider reset to 50/50');
    });
  }

  // Symbol Sync Toggle
  if (btnToggleSymbolSync) {
    btnToggleSymbolSync.classList.toggle('active', state.symbolSync);
    btnToggleSymbolSync.addEventListener('click', () => {
      state.symbolSync = !state.symbolSync;
      btnToggleSymbolSync.classList.toggle('active', state.symbolSync);
      saveAppSettings();

      if (state.symbolSync) {
        // Immediately sync all visible panes to the master symbol
        const targetSym = state.globalSymbol || (getActiveTab() && getActiveTab().symbol) || 'BINANCE:BTCUSDT';
        const curTab = getActiveTab();
        const panes = getVisiblePanesForTab(curTab);
        panes.forEach(p => {
          updatePaneChart(p, targetSym, p.timeframe);
        });
        showToast('Symbol Sync: ON (All charts synced)');
      } else {
        showToast('Symbol Sync: OFF (Independent charts)');
      }
    });
  }

  // --- SYMBOL SEARCH AUTOCOMPLETE WITH BROKER LIST & HOVER "+" BUTTON ---
  let searchDebounceTimer = null;
  let currentSearchResults = [];
  let selectedSearchIndex = -1;

  function setupSymbolAutocomplete() {
    if (!inputGlobalSymbol || !symbolAutocompleteList) return;

    if (state.globalSymbol) {
      inputGlobalSymbol.value = state.globalSymbol;
    }

    inputGlobalSymbol.addEventListener('input', () => {
      const query = inputGlobalSymbol.value.trim();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

      if (query.length === 0) {
        hideAutocompleteDropdown();
        return;
      }

      // Show immediate searching state
      symbolAutocompleteList.innerHTML = '<div style="padding: 10px 14px; color: #787b86; font-size: 11px; text-align: left;">Searching symbol & brokers...</div>';
      symbolAutocompleteList.classList.add('show');

      searchDebounceTimer = setTimeout(async () => {
        if (!window.electronAPI || !window.electronAPI.searchSymbols) {
          symbolAutocompleteList.innerHTML = '<div style="padding: 10px 14px; color: #ffa726; font-size: 11px; text-align: left;">Search service unavailable</div>';
          return;
        }
        try {
          const results = await window.electronAPI.searchSymbols(query);
          renderAutocompleteResults(results);
        } catch(err) {
          console.error('Autocomplete error:', err);
          symbolAutocompleteList.innerHTML = '<div style="padding: 10px 14px; color: #f23645; font-size: 11px; text-align: left;">Error connecting to TradingView</div>';
        }
      }, 150);
    });

    inputGlobalSymbol.addEventListener('keydown', (e) => {
      if (symbolAutocompleteList.classList.contains('show')) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          selectedSearchIndex = Math.min(selectedSearchIndex + 1, currentSearchResults.length - 1);
          highlightSearchItem(selectedSearchIndex);
          return;
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          selectedSearchIndex = Math.max(selectedSearchIndex - 1, 0);
          highlightSearchItem(selectedSearchIndex);
          return;
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedSearchIndex >= 0 && selectedSearchIndex < currentSearchResults.length) {
            selectSymbolItem(currentSearchResults[selectedSearchIndex]);
          } else if (currentSearchResults.length > 0) {
            selectSymbolItem(currentSearchResults[0]);
          } else {
            hideAutocompleteDropdown();
            applyGlobalSymbol(inputGlobalSymbol.value.trim());
          }
          return;
        } else if (e.key === 'Escape') {
          hideAutocompleteDropdown();
          return;
        }
      }

      if (e.key === 'Enter') {
        applyGlobalSymbol(inputGlobalSymbol.value.trim());
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!inputGlobalSymbol.contains(e.target) && !symbolAutocompleteList.contains(e.target)) {
        hideAutocompleteDropdown();
      }
    });
  }

  function renderAutocompleteResults(results) {
    if (results && !Array.isArray(results) && Array.isArray(results.symbols)) {
      results = results.symbols;
    }
    currentSearchResults = Array.isArray(results) ? results : [];
    selectedSearchIndex = -1;
    symbolAutocompleteList.innerHTML = '';

    if (currentSearchResults.length === 0) {
      symbolAutocompleteList.innerHTML = '<div style="padding: 10px 14px; color: #787b86; font-size: 11px; text-align: left;">No symbols found</div>';
      symbolAutocompleteList.classList.add('show');
      return;
    }

    currentSearchResults.forEach((item, idx) => {
      const cleanSymbol = stripHtmlTags(item.symbol);
      const cleanDesc = stripHtmlTags(item.description || item.symbol);
      const cleanExchange = stripHtmlTags(item.exchange || item.prefix || '');
      const fullTicker = item.fullTicker ? stripHtmlTags(item.fullTicker) : (cleanExchange ? `${cleanExchange}:${cleanSymbol}` : cleanSymbol);

      item.cleanSymbol = cleanSymbol;
      item.cleanTicker = fullTicker;

      const el = document.createElement('div');
      el.className = 'symbol-item';
      el.dataset.index = String(idx);

      const left = document.createElement('div');
      left.className = 'symbol-item-left';

      const tickerRow = document.createElement('div');
      tickerRow.className = 'symbol-ticker-row';

      const name = document.createElement('span');
      name.className = 'symbol-name';
      name.textContent = cleanSymbol;

      tickerRow.appendChild(name);

      const desc = document.createElement('span');
      desc.className = 'symbol-desc';
      desc.textContent = cleanDesc;

      left.appendChild(tickerRow);
      left.appendChild(desc);

      const right = document.createElement('div');
      right.className = 'symbol-item-right';

      if (cleanExchange) {
        const broker = document.createElement('span');
        broker.className = 'symbol-broker-pill';
        broker.textContent = cleanExchange;
        right.appendChild(broker);
      }

      if (item.type) {
        const type = document.createElement('span');
        type.className = 'symbol-type-pill';
        type.textContent = stripHtmlTags(item.type);
        right.appendChild(type);
      }

      // Hover "+" button to directly add this broker's symbol to watchlist
      const btnAdd = document.createElement('button');
      btnAdd.className = 'symbol-item-add-btn';
      btnAdd.title = `Add ${fullTicker} to Watchlist`;
      btnAdd.innerHTML = '+';
      btnAdd.addEventListener('click', (e) => {
        e.stopPropagation();
        addToWatchlist(fullTicker);
      });
      right.appendChild(btnAdd);

      el.appendChild(left);
      el.appendChild(right);

      el.addEventListener('click', () => {
        selectSymbolItem(item);
      });

      symbolAutocompleteList.appendChild(el);
    });

    symbolAutocompleteList.classList.add('show');
  }

  function highlightSearchItem(index) {
    const items = symbolAutocompleteList.querySelectorAll('.symbol-item');
    items.forEach((it, i) => {
      it.classList.toggle('selected', i === index);
      if (i === index) {
        it.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function selectSymbolItem(item) {
    if (!item) return;
    const ticker = item.cleanTicker || item.fullTicker || stripHtmlTags(item.symbol);
    inputGlobalSymbol.value = ticker;
    hideAutocompleteDropdown();
    applyGlobalSymbol(ticker);
  }

  function hideAutocompleteDropdown() {
    symbolAutocompleteList.classList.remove('show');
    symbolAutocompleteList.innerHTML = '';
    selectedSearchIndex = -1;
    currentSearchResults = [];
  }

  // Global Symbol Apply Button
  if (btnApplyGlobalSymbol) {
    btnApplyGlobalSymbol.addEventListener('click', () => {
      hideAutocompleteDropdown();
      applyGlobalSymbol(inputGlobalSymbol.value.trim());
    });
  }

  // Toggle Drawing Toolbar Button
  if (btnToggleDrawingToolbar) {
    btnToggleDrawingToolbar.classList.toggle('active', state.showDrawingToolbar);
    btnToggleDrawingToolbar.addEventListener('click', () => {
      state.showDrawingToolbar = !state.showDrawingToolbar;
      btnToggleDrawingToolbar.classList.toggle('active', state.showDrawingToolbar);
      saveAppSettings();

      state.panes.forEach((pane) => {
        if (pane.webview) {
          try {
            pane.webview.send('set-drawing-toolbar', { visible: state.showDrawingToolbar });
          } catch(e) {}

          pane.webview.executeJavaScript(`
            (function() {
              if (${state.showDrawingToolbar}) {
                document.body.classList.remove('hide-drawing-toolbar');
                document.documentElement.classList.remove('hide-drawing-toolbar');
              } else {
                document.body.classList.add('hide-drawing-toolbar');
                document.documentElement.classList.add('hide-drawing-toolbar');
              }
              if (window.__TVSync && typeof window.__TVSync.setDrawingToolbar === 'function') {
                window.__TVSync.setDrawingToolbar(${state.showDrawingToolbar});
              }
              if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') {
                window.__TVSync.ensureFullBleedLayout();
              }
              window.dispatchEvent(new Event('resize'));
              window.dispatchEvent(new UIEvent('resize'));
            })()
          `).catch(() => {});
        }
      });

      showToast(state.showDrawingToolbar ? 'Drawing toolbar shown' : 'Drawing toolbar hidden (Max space)');
    });
  }

  // Toggle Clean Max-Space Mode Button
  if (btnToggleCleanMode) {
    btnToggleCleanMode.classList.toggle('active', state.cleanMode);
    btnToggleCleanMode.addEventListener('click', () => {
      state.cleanMode = !state.cleanMode;
      btnToggleCleanMode.classList.toggle('active', state.cleanMode);
      saveAppSettings();

      state.panes.forEach(pane => {
        if (pane.webview) {
          try {
            pane.webview.send('set-clean-mode', { enabled: state.cleanMode });
          } catch(e) {}

          pane.webview.executeJavaScript(`
            (function() {
              if (${state.cleanMode}) {
                document.body.classList.add('clean-mode');
                document.documentElement.classList.add('clean-mode');
              } else {
                document.body.classList.remove('clean-mode');
                document.documentElement.classList.remove('clean-mode');
              }
              if (window.__TVSync && typeof window.__TVSync.ensureFullBleedLayout === 'function') {
                window.__TVSync.ensureFullBleedLayout();
              }
              window.dispatchEvent(new Event('resize'));
              window.dispatchEvent(new UIEvent('resize'));
              try { if (window._exposed_chartWidgetCollection) window._exposed_chartWidgetCollection._updateLayout(); } catch(e) {}
            })()
          `).catch(() => {});
        }
      });

      showToast(state.cleanMode ? 'Max space mode enabled' : 'Standard mode enabled');
    });
  }

  // Fullscreen
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.toggleFullscreen) {
        window.electronAPI.toggleFullscreen();
      } else {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen();
        } else {
          document.exitFullscreen();
        }
      }
    });
  }

  // Account Modal & Sign In Handlers
  const btnAccountLogin = document.getElementById('btnAccountLogin');
  const accountLoginText = document.getElementById('accountLoginText');
  const accountModal = document.getElementById('accountModal');
  const btnCloseAccount = document.getElementById('btnCloseAccount');
  const btnCloseAccountDone = document.getElementById('btnCloseAccountDone');
  const accountStatusVal = document.getElementById('accountStatusVal');
  const accountStatusDot = document.querySelector('.account-status-dot');
  const btnLaunchGoogleLogin = document.getElementById('btnLaunchGoogleLogin');
  const btnOpenExternalBrowser = document.getElementById('btnOpenExternalBrowser');
  const browserAuthWaitingArea = document.getElementById('browserAuthWaitingArea');
  const browserAuthStatusText = document.getElementById('browserAuthStatusText');
  const btnPasteSecretKey = document.getElementById('btnPasteSecretKey');
  const inputAuthToken = document.getElementById('inputAuthToken');
  const btnSubmitAuthToken = document.getElementById('btnSubmitAuthToken');
  const inputSessionCookie = document.getElementById('inputSessionCookie');
  const btnApplySessionCookie = document.getElementById('btnApplySessionCookie');
  const btnReloadCharts = document.getElementById('btnReloadCharts');

  let isWaitingForBrowserAuth = false;
  let clipboardMonitorTimer = null;

  async function checkClipboardForToken() {
    if (!isWaitingForBrowserAuth) return;
    if (!window.electronAPI || !window.electronAPI.readClipboardText) return;
    try {
      const clipText = await window.electronAPI.readClipboardText();
      if (clipText && typeof clipText === 'string') {
        const trimmed = clipText.trim();
        if (trimmed.includes('token=') || trimmed.includes('tradingview://') || (trimmed.length >= 32 && /^[a-zA-Z0-9_\-]+$/.test(trimmed))) {
          if (browserAuthStatusText) browserAuthStatusText.textContent = 'توکن شناسایی شد، در حال نهایی کردن ورود...';
          const res = await window.electronAPI.submitAuthToken(trimmed);
          if (res && res.success) {
            isWaitingForBrowserAuth = false;
            if (clipboardMonitorTimer) clearInterval(clipboardMonitorTimer);
            if (browserAuthWaitingArea) browserAuthWaitingArea.style.display = 'none';
            showToast('با موفقیت وارد حساب تریدینگ‌ویو شدید!');
            reloadAllWebviewPanes();
            refreshAccountStatus();
          }
        }
      }
    } catch(e) {}
  }

  // Auto-check clipboard whenever the application window gains focus
  window.addEventListener('focus', () => {
    if (isWaitingForBrowserAuth) {
      checkClipboardForToken();
    }
  });

  async function refreshAccountStatus() {
    if (!window.electronAPI || !window.electronAPI.checkLoginStatus) return;
    try {
      const res = await window.electronAPI.checkLoginStatus();
      if (res && res.loggedIn) {
        const nameStr = res.username ? ` (${res.username})` : ' (TradingView Session Active)';
        if (accountStatusVal) accountStatusVal.textContent = 'Logged In' + nameStr;
        if (accountStatusDot) accountStatusDot.classList.add('active');
        if (btnAccountLogin) btnAccountLogin.classList.add('logged-in');
        if (accountLoginText) accountLoginText.textContent = res.username || 'Account (Active)';
      } else {
        if (accountStatusVal) accountStatusVal.textContent = 'Not Logged In (Guest Mode)';
        if (accountStatusDot) accountStatusDot.classList.remove('active');
        if (btnAccountLogin) btnAccountLogin.classList.remove('logged-in');
        if (accountLoginText) accountLoginText.textContent = 'Sign In';
      }
    } catch(e) {}
  }

  function reloadAllWebviewPanes() {
    state.panes.forEach(pane => {
      if (pane.webview) {
        try { pane.webview.reload(); } catch(e) {}
      }
    });
    showToast('Charts reloaded with updated account session');
  }

  // Help Modal
  if (btnHelp && helpModal && btnCloseHelp) {
    btnHelp.addEventListener('click', () => {
      helpModal.classList.add('show');
      if (typeof updateTauriOverlaysState === 'function') updateTauriOverlaysState();
    });
    btnCloseHelp.addEventListener('click', () => {
      helpModal.classList.remove('show');
      if (typeof updateTauriOverlaysState === 'function') updateTauriOverlaysState();
    });
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.classList.remove('show');
        if (typeof updateTauriOverlaysState === 'function') updateTauriOverlaysState();
      }
    });
  }

  // Sync Drawings Button
  if (btnSyncDrawings) {
    btnSyncDrawings.addEventListener('click', () => {
      syncAllDrawings();
    });
  }

  // Add New Tab Button
  if (btnAddNewTab) {
    btnAddNewTab.addEventListener('click', () => {
      createNewTab();
    });
  }

  // Global Shortcuts: Ctrl+T (New Tab), Ctrl+W (Close Tab), Ctrl+Tab (Cycle Tabs), Ctrl+S (Sync), Ctrl+N (New Window), F11 (Fullscreen), Esc
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 't' || e.key === 'T')) {
      e.preventDefault();
      createNewTab();
    } else if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      closeTab(state.activeTabId);
    } else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      if (state.tabs.length > 1) {
        const curIdx = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (curIdx !== -1) {
          const nextIdx = e.shiftKey
            ? (curIdx - 1 + state.tabs.length) % state.tabs.length
            : (curIdx + 1) % state.tabs.length;
          switchTab(state.tabs[nextIdx].id);
        }
      }
    } else if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      syncAllDrawings();
    } else if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.openNewWindow) {
        window.electronAPI.openNewWindow({
          layout: state.layout,
          symbol: state.globalSymbol
        });
      }
    } else if (e.key === 'F11') {
      e.preventDefault();
      if (window.electronAPI && window.electronAPI.toggleFullscreen) {
        window.electronAPI.toggleFullscreen();
      }
    } else if (e.key === 'Escape') {
      if (helpModal) helpModal.classList.remove('show');
      if (accountModal) accountModal.classList.remove('show');
      closeCustomizeToolsModal();
    }
  });

  // Window resize handler for responsive multi-chart bounds
  window.addEventListener('resize', () => {
    if (typeof syncTauriChartBounds === 'function') {
      syncTauriChartBounds();
    }
  }, { passive: true });

  // Initialize Symbol Autocomplete, Master Tools, Watchlist, Tabs & Workspace
  setupSymbolAutocomplete();
  renderFavoriteDrawingsBar();
  setupCustomizeToolsModal();
  renderWatchlist();
  renderTabsBar();
  switchTab(state.activeTabId);

  // Initial bounds sync for Tauri
  setTimeout(() => {
    if (typeof syncTauriChartBounds === 'function') {
      syncTauriChartBounds();
    }
  }, 120);
})();
