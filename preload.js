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
  }
});

console.log('[PRELOAD] Context bridge exposed: window.electronAPI');
