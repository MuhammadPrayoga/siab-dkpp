// ============================================================
// SIAB DKPP - Main Process (main.js)
// Electron Main Process: RSS fetching, article extraction, IPC
// ============================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const RSSParser = require('rss-parser');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const db = require('./database');

let mainWindow;

// ── Window Creation ──────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#020617',
    icon: path.join(__dirname, 'public/logo_dkpp.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: 1.0
    },
    titleBarStyle: 'default',
    title: 'SIAB DKPP'
  });

  mainWindow.loadFile('index.html');

  // Open DevTools when launched with --enable-logging
  if (process.argv.includes('--enable-logging')) {
    mainWindow.webContents.openDevTools();
  }

  console.log('[MAIN] Window created successfully');
}

app.whenReady().then(() => {
  db.initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── Google News RSS URL Builder ──────────────────────────────

function buildRssUrl(keyword, dateFrom, dateTo) {
  // Base query is locked to DKPP-related terms
  let query = '"DKPP RI" OR "DEWAN KEHORMATAN PENYELENGGARA PEMILU"';

  // Append optional additional keyword
  if (keyword && keyword.trim()) {
    query += ` "${keyword.trim()}"`;
  }

  // Append date filters (Google News RSS supports after: and before:)
  if (dateFrom) {
    query += ` after:${dateFrom}`;
  }
  if (dateTo) {
    query += ` before:${dateTo}`;
  }

  const encodedQuery = encodeURIComponent(query);
  const url = `https://news.google.com/rss/search?q=${encodedQuery}&hl=id&gl=ID&ceid=ID:id`;

  console.log('[MAIN] Built RSS URL:', url);
  return url;
}

// ── Extract Real Article URL from Google News RSS Item ───────

function extractArticleUrl(item) {
  // Google News RSS wraps article URLs in its description HTML
  // Pattern: <a href="REAL_URL">Title</a>
  if (item.content) {
    const match = item.content.match(/href="([^"]+)"/);
    if (match && match[1] && !match[1].includes('news.google.com')) {
      console.log('[MAIN] Extracted URL from content:', match[1]);
      return match[1];
    }
  }

  // Fallback: use the link field (may be Google redirect)
  console.log('[MAIN] Using fallback link:', item.link);
  return item.link;
}

// ── Fetch & Extract Clean Text from Article ──────────────────

async function extractArticleText(url, hiddenWindow, timeout = 25000) {
  return new Promise((resolve) => {
    console.log(`[MAIN] Fetching article via Browser: ${url}`);
    
    let resolved = false;
    let timeoutId;

    const cleanup = () => {
      hiddenWindow.webContents.removeAllListeners('did-stop-loading');
      hiddenWindow.webContents.removeAllListeners('did-fail-load');
    };

    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      cleanup();
      resolve(result);
    };

    timeoutId = setTimeout(() => {
      console.warn(`[MAIN] Timeout fetching: ${url}`);
      finish(null);
    }, timeout);

    hiddenWindow.webContents.on('did-fail-load', (e, code, desc, failedUrl, isMainFrame) => {
      if (isMainFrame) {
        console.warn(`[MAIN] Failed to load ${failedUrl}: ${desc}`);
        finish(null);
      }
    });

    hiddenWindow.webContents.on('did-stop-loading', async () => {
      const currentUrl = hiddenWindow.webContents.getURL();
      
      // If we are still on news.google.com/rss/articles, wait for JS redirect
      if (currentUrl.includes('news.google.com') && currentUrl.includes('/rss/articles/')) {
         return; 
      }

      // Reached actual article
      try {
        console.log(`[MAIN] Extracting HTML from: ${currentUrl}`);
        const html = await hiddenWindow.webContents.executeJavaScript('document.documentElement.outerHTML');
        
        const dom = new JSDOM(html, { url: currentUrl });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();

        if (article && article.textContent) {
          const cleanText = article.textContent
            .replace(/\t/g, ' ')
            .replace(/ {2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
          
          console.log(`[MAIN] Extracted ${cleanText.length} chars from article`);
          finish(cleanText);
        } else {
          console.warn(`[MAIN] Readability returned no content for: ${currentUrl}`);
          finish(null);
        }
      } catch (error) {
        console.error(`[MAIN] Failed to parse HTML from ${currentUrl}:`, error.message);
        finish(null);
      }
    });

    // Start loading the url
    hiddenWindow.loadURL(url);
  });
}

// ── Extract source name from RSS item ────────────────────────

function extractSource(item) {
  // RSS parser may expose <source> element
  if (item.source && item.source.name) {
    return item.source.name;
  }
  // Google News titles often end with " - SourceName"
  if (item.title) {
    const parts = item.title.split(' - ');
    if (parts.length > 1) {
      return parts[parts.length - 1].trim();
    }
  }
  return 'Sumber Tidak Diketahui';
}

// ── Format date for display ──────────────────────────────────

function formatDate(dateString) {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
}

// ── IPC Handler: Start Crawling ──────────────────────────────

ipcMain.handle('start-crawl', async (event, params) => {
  const { keyword, dateFrom, dateTo } = params;

  console.log('═══════════════════════════════════════════════');
  console.log('[MAIN] START CRAWL');
  console.log('[MAIN] Params:', JSON.stringify(params, null, 2));
  console.log('═══════════════════════════════════════════════');

  const rssUrl = buildRssUrl(keyword, dateFrom, dateTo);

  try {
    // ── Step 1: Fetch RSS Feed ──
    sendProgress('fetching-rss', 'Mengambil feed RSS dari Google News...', 0, 0);

    const parser = new RSSParser({
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SIAB-DKPP/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      }
    });

    let feed;
    try {
      feed = await parser.parseURL(rssUrl);
    } catch (rssError) {
      console.error('[MAIN] RSS fetch failed:', rssError.message);
      return {
        success: false,
        error: `Gagal mengambil RSS feed: ${rssError.message}. Pastikan koneksi internet aktif.`,
        articles: []
      };
    }

    console.log(`[MAIN] RSS feed fetched: ${feed.items.length} items found`);

    if (feed.items.length === 0) {
      return {
        success: true,
        articles: [],
        message: 'Tidak ada berita ditemukan untuk query ini.'
      };
    }

    // ── Step 2: Extract Each Article ──
    const articles = [];
    const maxResults = params.maxResults || 50;
    const totalItems = Math.min(feed.items.length, maxResults);

    // Create a hidden window to handle Google News JS redirects
    const hiddenWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    for (let i = 0; i < totalItems; i++) {
      const item = feed.items[i];
      const source = extractSource(item);

      // Remove source suffix from title
      let title = item.title || 'Tanpa Judul';
      if (title.endsWith(` - ${source}`)) {
        title = title.slice(0, -(` - ${source}`).length).trim();
      }

      sendProgress(
        'extracting',
        `Mengekstrak artikel ${i + 1}/${totalItems}: ${title.substring(0, 60)}...`,
        i + 1,
        totalItems
      );

      console.log(`[MAIN] ── Article ${i + 1}/${totalItems} ──`);
      console.log(`[MAIN] Title: ${title}`);

      const articleUrl = extractArticleUrl(item);
      const cleanText = await extractArticleText(articleUrl, hiddenWindow, params.timeout || 25000);
      const formattedDate = formatDate(item.pubDate || item.isoDate);

      const article = {
        index: i,
        title: title,
        source: source,
        link: articleUrl,
        date: formattedDate,
        rawDate: item.pubDate || item.isoDate || '',
        cleanText: cleanText || '[Gagal mengekstrak teks artikel]',
        hasText: !!cleanText
      };

      articles.push(article);

      // Rate limiting: small delay between requests
      if (i < totalItems - 1) {
        await new Promise(resolve => setTimeout(resolve, params.requestDelay || 800));
      }
    }

    // Cleanup hidden window
    if (!hiddenWindow.isDestroyed()) {
      hiddenWindow.destroy();
    }

    // ── Step 3: Return Results ──
    const successCount = articles.filter(a => a.hasText).length;
    console.log('═══════════════════════════════════════════════');
    console.log(`[MAIN] CRAWL COMPLETE`);
    console.log(`[MAIN] Total: ${articles.length}, Success: ${successCount}, Failed: ${articles.length - successCount}`);
    console.log('═══════════════════════════════════════════════');

    return {
      success: true,
      articles: articles,
      message: `${articles.length} berita ditemukan, ${successCount} berhasil diekstrak.`
    };

  } catch (error) {
    console.error('[MAIN] Unexpected crawl error:', error);
    return {
      success: false,
      error: `Terjadi kesalahan: ${error.message}`,
      articles: []
    };
  }
});

// ── Helper: Send progress to renderer ────────────────────────

function sendProgress(status, message, current, total) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('crawl-progress', {
      status,
      message,
      current,
      total
    });
  }
}

console.log('[MAIN] Main process initialized');

// ── IPC Handler: App Info ────────────────────────────────────

ipcMain.handle('get-app-info', async () => {
  const dbDir = app.getPath('userData');
  const dbPath = path.join(dbDir, 'database.json');
  const pkg = require('./package.json');
  return {
    version: pkg.version,
    electronVersion: process.versions.electron,
    dbPath: dbPath
  };
});

// ── IPC Handlers: Database Operations ────────────────────────

ipcMain.handle('db-get-history', async () => {
  try {
    return { success: true, data: db.getHistory() };
  } catch (error) {
    console.error('[MAIN] db-get-history error:', error);
    return { success: false, error: error.message, data: [] };
  }
});

ipcMain.handle('db-save-history', async (_event, entry) => {
  try {
    const id = db.addHistoryEntry(entry);
    return { success: true, id };
  } catch (error) {
    console.error('[MAIN] db-save-history error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-update-snippets', async (_event, { historyId, snippets }) => {
  try {
    db.updateHistorySnippets(historyId, snippets);
    return { success: true };
  } catch (error) {
    console.error('[MAIN] db-update-snippets error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-delete-history', async (_event, historyId) => {
  try {
    db.deleteHistoryEntry(historyId);
    return { success: true };
  } catch (error) {
    console.error('[MAIN] db-delete-history error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-clear-history', async () => {
  try {
    db.clearAllHistory();
    return { success: true };
  } catch (error) {
    console.error('[MAIN] db-clear-history error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-get-settings', async () => {
  try {
    return { success: true, data: db.getSettings() };
  } catch (error) {
    console.error('[MAIN] db-get-settings error:', error);
    return { success: false, error: error.message, data: {} };
  }
});

ipcMain.handle('db-save-settings', async (_event, settingsData) => {
  try {
    const merged = db.saveSettings(settingsData);
    return { success: true, data: merged };
  } catch (error) {
    console.error('[MAIN] db-save-settings error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('db-migrate-localstorage', async (_event, { history, settings }) => {
  try {
    db.importFromLocalStorage(history, settings);
    return { success: true };
  } catch (error) {
    console.error('[MAIN] db-migrate-localstorage error:', error);
    return { success: false, error: error.message };
  }
});

