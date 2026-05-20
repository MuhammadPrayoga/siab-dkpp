// ============================================================
// SIAB DKPP - Preload Script (preload.js)
// Secure bridge between Renderer and Main Process via IPC
// ============================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {

  /**
   * Start crawling news articles.
   * @param {Object} params - { keyword?: string, dateFrom?: string, dateTo?: string }
   * @returns {Promise<{ success: boolean, articles: Array, error?: string, message?: string }>}
   */
  startCrawl: (params) => {
    console.log('[PRELOAD] Invoking start-crawl with params:', params);
    return ipcRenderer.invoke('start-crawl', params);
  },

  /**
   * Listen for crawl progress updates from main process.
   * @param {Function} callback - Receives { status, message, current, total }
   * @returns {Function} cleanup - Call to remove the listener
   */
  onCrawlProgress: (callback) => {
    const handler = (_event, data) => {
      console.log('[PRELOAD] Progress:', data.message);
      callback(data);
    };
    ipcRenderer.on('crawl-progress', handler);

    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('crawl-progress', handler);
    };
  },

  // ── Database Operations (History) ────────────────────────────

  /** Get all history entries from persistent database */
  getHistory: () => ipcRenderer.invoke('db-get-history'),

  /** Save a new history entry to persistent database */
  saveHistory: (entry) => ipcRenderer.invoke('db-save-history', entry),

  /** Update snippets for a specific history entry */
  updateSnippets: (historyId, snippets) =>
    ipcRenderer.invoke('db-update-snippets', { historyId, snippets }),

  /** Delete a single history entry */
  deleteHistory: (historyId) => ipcRenderer.invoke('db-delete-history', historyId),

  /** Clear all history entries */
  clearHistory: () => ipcRenderer.invoke('db-clear-history'),

  // ── Database Operations (Settings) ───────────────────────────

  /** Get application settings from persistent database */
  getSettings: () => ipcRenderer.invoke('db-get-settings'),

  /** Save application settings to persistent database */
  saveSettings: (data) => ipcRenderer.invoke('db-save-settings', data),

  // ── App Info ─────────────────────────────────────────────────

  /** Get application info (version, Electron version, database path) */
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),

  // ── Migration ────────────────────────────────────────────────

  /** Migrate localStorage data to persistent database (one-time) */
  migrateLocalStorage: (data) => ipcRenderer.invoke('db-migrate-localstorage', data),
});

console.log('[PRELOAD] Context bridge exposed: window.electronAPI');
