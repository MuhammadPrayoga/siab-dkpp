// ============================================================
// SIAB DKPP - Main Process (main.js)
// Electron Main Process: RSS fetching, article extraction, IPC
// ============================================================

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const RSSParser = require('rss-parser');
const axios = require('axios');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const db = require('./database');

// ── Stealth Mode: User-Agent Rotation ────────────────────────
// Daftar User-Agent dari browser sungguhan agar tidak terdeteksi sebagai bot

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0'
];

function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Concurrent Crawling Config ───────────────────────────────
const CONCURRENT_WORKERS = 3; // Jumlah hidden window paralel
const MAX_RETRIES = 2;        // Percobaan ulang per artikel

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

function buildRssUrl(keyword, dateFrom, dateTo, defaultKeywords) {
  // Bangun query dasar dari kata kunci bawaan (bisa dikonfigurasi di Pengaturan)
  // Jika kosong, gunakan default hardcoded
  const rawKeywords = (defaultKeywords && defaultKeywords.trim())
    ? defaultKeywords
    : 'DKPP RI, DEWAN KEHORMATAN PENYELENGGARA PEMILU';

  // Pecah koma → bungkus tanda kutip → gabungkan dengan OR
  const keywordParts = rawKeywords
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0)
    .map(k => `"${k}"`);

  // Pengecualian: web pemerintah + semua platform media sosial
  const excludedSites = [
    'go.id',
    'facebook.com', 'linkedin.com', 'twitter.com', 'x.com',
    'instagram.com', 'tiktok.com', 'youtube.com', 'reddit.com',
    'threads.net', 'pinterest.com', 'quora.com', 'tumblr.com'
  ];
  const siteExclusions = excludedSites.map(s => `-site:${s}`).join(' ');

  let query = `(${keywordParts.join(' OR ')}) ${siteExclusions}`;

  // Append optional additional keyword from search form
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

// ── Fetch & Extract via Axios (Fast Path) ────────────────────

async function extractViaAxios(url, timeoutMs) {
  try {
    console.log(`[MAIN] ⚡ Fetching via Axios: ${url}`);
    const userAgent = getRandomUserAgent();
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: timeoutMs,
      maxRedirects: 5,
      responseType: 'text'
    });

    const html = response.data;
    if (!html || html.length < 500) {
      console.log(`[MAIN] ⚠ Axios HTML too short or empty for: ${url}`);
      return null;
    }

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.textContent) {
      const cleanText = article.textContent
        .replace(/\t/g, ' ')
        .replace(/ {2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      // Deteksi anti-bot (teks terlalu pendek biasanya captcha/blocker)
      if (cleanText.length < 250) {
         console.log(`[MAIN] ⚠ Axios extracted text too short (possible bot protection) for: ${url}`);
         return null;
      }
      
      console.log(`[MAIN] ⚡ Axios success: Extracted ${cleanText.length} chars`);
      return cleanText;
    }
    return null;
  } catch (error) {
    console.log(`[MAIN] ⚠ Axios failed for ${url}: ${error.message}`);
    return null;
  }
}

// ── Fetch & Extract Clean Text from Article ──────────────────

async function extractArticleText(url, hiddenWindow, timeout = 25000) {
  return new Promise((resolve) => {
    console.log(`[MAIN] Fetching article via Browser: ${url}`);
    
    let resolved = false;
    let timeoutId;

    // Stealth: Set User-Agent acak agar terlihat seperti browser sungguhan
    const userAgent = getRandomUserAgent();
    hiddenWindow.webContents.setUserAgent(userAgent);

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

// ── Retry Logic: Coba ulang jika gagal ───────────────────────

async function extractWithRetry(url, hiddenWindow, timeout = 25000) {
  // 1. Coba fast path (Axios) terlebih dahulu
  let result = await extractViaAxios(url, timeout);
  if (result) return result;

  console.log(`[MAIN] 🌐 Fallback: Fetching via Browser for: ${url}`);

  // 2. Jika gagal, coba fallback browser dengan retry
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    result = await extractArticleText(url, hiddenWindow, timeout);
    
    if (result) {
      if (attempt > 1) {
        console.log(`[MAIN] ✓ Berhasil pada percobaan ke-${attempt}: ${url}`);
      }
      return result;
    }

    if (attempt <= MAX_RETRIES) {
      const delay = attempt * 1500; // Delay bertambah: 1.5s, 3s
      console.log(`[MAIN] ✗ Percobaan ke-${attempt} gagal, retry dalam ${delay}ms: ${url}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.warn(`[MAIN] ✗ Semua percobaan gagal untuk: ${url}`);
  return null;
}

// ── Worker Pool: Buat & kelola hidden windows ────────────────

function createHiddenWindow() {
  return new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  });
}

function destroyHiddenWindows(windows) {
  for (const win of windows) {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }
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
  const { keyword, dateFrom, dateTo, defaultKeywords } = params;

  console.log('═══════════════════════════════════════════════');
  console.log('[MAIN] START CRAWL');
  console.log('[MAIN] Params:', JSON.stringify(params, null, 2));
  console.log('═══════════════════════════════════════════════');

  const rssUrl = buildRssUrl(keyword, dateFrom, dateTo, defaultKeywords);

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

    // ── Step 2: Extract Each Article (Concurrent + Retry) ──
    const articles = [];
    const maxResults = params.maxResults || 50;

    // ── Daftar Putih Media (Whitelist) ──
    const TRUSTED_MEDIA = [
      'kompas.com', 'detik.com', 'antaranews.com', 'tribunnews.com',
      'cnnindonesia.com', 'cnbcindonesia.com', 'tempo.co', 'viva.co.id',
      'suara.com', 'liputan6.com', 'merdeka.com', 'republika.co.id',
      'idntimes.com', 'tvonenews.com'
    ];

    // Siapkan daftar task (artikel yang harus di-crawl) dengan memfilter media terpercaya jika aktif
    const tasks = [];
    for (let i = 0; i < feed.items.length && tasks.length < maxResults; i++) {
      const item = feed.items[i];
      const source = extractSource(item);
      const articleUrl = extractArticleUrl(item);

      if (params.trustedMediaOnly) {
        let isTrusted = false;
        const lowerUrl = articleUrl.toLowerCase();
        for (const domain of TRUSTED_MEDIA) {
          if (lowerUrl.includes(domain)) {
            isTrusted = true;
            break;
          }
        }
        if (!isTrusted) {
          console.log(`[MAIN] Skipped untrusted source: ${source}`);
          continue; // Lewati item ini
        }
      }

      let title = item.title || 'Tanpa Judul';
      if (title.endsWith(` - ${source}`)) {
        title = title.slice(0, -(` - ${source}`).length).trim();
      }
      tasks.push({ index: tasks.length, item, source, title, articleUrl });
    }

    const filteredTotalItems = tasks.length;
    
    // Jika setelah difilter ternyata kosong
    if (filteredTotalItems === 0) {
      return {
        success: true,
        articles: [],
        message: 'Tidak ada berita dari media nasional yang ditemukan.'
      };
    }

    // Buat pool hidden windows untuk crawling paralel
    const workerCount = Math.min(CONCURRENT_WORKERS, filteredTotalItems);
    const hiddenWindows = [];
    for (let w = 0; w < workerCount; w++) {
      hiddenWindows.push(createHiddenWindow());
    }
    console.log(`[MAIN] Created ${workerCount} concurrent workers for ${filteredTotalItems} tasks`);

    // Worker function: ambil task dari antrian, proses, ulangi
    let taskCursor = 0;
    let completedCount = 0;

    async function worker(hiddenWindow, workerId) {
      while (taskCursor < tasks.length) {
        const taskIndex = taskCursor++;
        const task = tasks[taskIndex];

        sendProgress(
          'extracting',
          `Mengekstrak artikel ${taskIndex + 1}/${filteredTotalItems}: ${task.title.substring(0, 60)}...`,
          ++completedCount,
          filteredTotalItems
        );

        console.log(`[MAIN] ── Article ${taskIndex + 1}/${filteredTotalItems} [Worker ${workerId}] ──`);
        console.log(`[MAIN] Title: ${task.title}`);

        const cleanText = await extractWithRetry(task.articleUrl, hiddenWindow, params.timeout || 25000);
        const formattedDate = formatDate(task.item.pubDate || task.item.isoDate);

        const article = {
          index: task.index,
          title: task.title,
          source: task.source,
          link: task.articleUrl,
          date: formattedDate,
          rawDate: task.item.pubDate || task.item.isoDate || '',
          cleanText: cleanText || '[Gagal mengekstrak teks artikel]',
          hasText: !!cleanText
        };

        articles.push(article);

        // Rate limiting antar request per worker
        if (taskCursor < tasks.length) {
          await new Promise(resolve => setTimeout(resolve, params.requestDelay || 500));
        }
      }
    }

    // Jalankan semua worker secara paralel
    const workerPromises = hiddenWindows.map((win, i) => worker(win, i + 1));
    await Promise.all(workerPromises);

    // Urutkan kembali artikel berdasarkan index asli
    articles.sort((a, b) => a.index - b.index);

    // Cleanup semua hidden windows
    destroyHiddenWindows(hiddenWindows);

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

