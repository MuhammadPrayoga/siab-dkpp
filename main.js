// ============================================================
// SIAB DKPP - Main Process (main.js)
// Electron Main Process: RSS fetching, article extraction, IPC
// ============================================================

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const RSSParser = require('rss-parser');
// got-scraping is ESM-only; loaded via dynamic import() inside async functions
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const db = require('./database');
const GoogleNewsDecoder = require('google-news-decoder');
const googleNewsDecoder = new GoogleNewsDecoder();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// ── Blocked Domains ───────────────────────────────────────────
const BLOCKED_DOMAINS = [
  'dkpp.go.id',
  'bawaslu.go.id',
  'kpu.go.id',
  'instagram.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'linkedin.com',
  'threads.net',
  't.me',
  'wa.me',
  'whatsapp.com',
  'snackvideo.com',
  'pinterest.com',
  'reddit.com',
  'kaskus.co.id'
];

function isBlockedUrl(url) {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch (e) {
    // Fallback if URL is invalid
    return BLOCKED_DOMAINS.some(domain => url.toLowerCase().includes(domain));
  }
}

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
      sandbox: true,
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

  // Pengecualian:  // Daftar ekstensi / situs yang ingin diabaikan (Jangan terlalu banyak agar tidak merusak filter tanggal Google RSS)
  const excludedSites = [
    'dkpp.go.id', 'go.id', 'bawaslu.go.id', 'kpu.go.id'
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

// ── Fetch & Extract via got-scraping (Fast Path, Anti-Bot) ───

async function extractViaGotScraping(url, timeoutMs) {
  try {
    console.log(`[MAIN] ⚡ Fetching via got-scraping: ${url}`);
    const { gotScraping } = await import('got-scraping');

    const response = await gotScraping({
      url,
      headerGeneratorOptions: {
        browsers: [{ name: 'chrome', minVersion: 120 }],
        devices: ['desktop'],
        locales: ['id-ID'],
        operatingSystems: ['windows'],
      },
      timeout: { request: timeoutMs },
      followRedirect: true,
      maxRedirects: 5,
      responseType: 'text',
    });

    const html = response.body;
    if (!html || html.length < 500) {
      console.log(`[MAIN] ⚠ got-scraping HTML too short or empty for: ${url}`);
      return null;
    }

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    dom.window.close(); // Mencegah memory leak JSDOM

    if (article && article.textContent) {
      const cleanText = article.textContent
        .replace(/\t/g, ' ')
        .replace(/ {2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      // Deteksi anti-bot (teks terlalu pendek biasanya captcha/blocker)
      if (cleanText.length < 250) {
         console.log(`[MAIN] ⚠ got-scraping extracted text too short (possible bot protection) for: ${url}`);
         return null;
      }
      
      console.log(`[MAIN] ⚡ got-scraping success: Extracted ${cleanText.length} chars`);
      return cleanText;
    }
    return null;
  } catch (error) {
    console.log(`[MAIN] ⚠ got-scraping failed for ${url}: ${error.message}`);
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
      hiddenWindow.webContents.stop(); // Hentikan loading agar tidak membuang resource
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
        dom.window.close(); // Mencegah memory leak JSDOM

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
  // 1. Coba fast path (got-scraping) terlebih dahulu
  let result = await extractViaGotScraping(url, timeout);
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

    // Siapkan daftar task (artikel yang harus di-crawl)
    const tasks = [];
    for (let i = 0; i < feed.items.length && tasks.length < maxResults; i++) {
      const item = feed.items[i];
      const source = extractSource(item);
      const articleUrl = extractArticleUrl(item);

      // Pengecualian wajib: Abaikan website resmi DKPP RI
      if (articleUrl.toLowerCase().includes('dkpp.go.id')) {
        console.log(`[MAIN] Skipped official dkpp site: ${articleUrl}`);
        continue;
      }

      // Filter tanggal ketat karena Google News RSS sering bocor (tanggal di luar range)
      let itemDate = null;
      if (item.pubDate || item.isoDate) {
        itemDate = new Date(item.pubDate || item.isoDate);
      }

      if (itemDate && !isNaN(itemDate.getTime())) {
        if (params.dateFrom) {
           const fromDate = new Date(params.dateFrom);
           fromDate.setHours(0, 0, 0, 0);
           if (itemDate < fromDate) {
              console.log(`[MAIN] Skipped due to dateFrom: ${itemDate} < ${fromDate}`);
              continue;
           }
        }
        if (params.dateTo) {
           const toDate = new Date(params.dateTo);
           toDate.setHours(23, 59, 59, 999);
           if (itemDate > toDate) {
              console.log(`[MAIN] Skipped due to dateTo: ${itemDate} > ${toDate}`);
              continue;
           }
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
    const proxyListRaw = params.proxyList || ''

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

// ── Indonesian Stopwords (untuk extractive summarization) ────

const INDONESIAN_STOPWORDS = new Set([
  "ada", "adalah", "adanya", "adapun", "agak", "agaknya", "agar", "akan", "akankah", "akhir",
  "akhiri", "akhirnya", "aku", "akulah", "amat", "amatlah", "anda", "andalah", "antar", "antara",
  "antaranya", "apa", "apaan", "apabila", "apakah", "apalagi", "apatah", "artinya", "asal",
  "asalkan", "atas", "atau", "ataukah", "ataupun", "awal", "awalnya", "bagai", "bagaikan",
  "bagaimana", "bagaimanakah", "bagaimanapun", "bagi", "bagian", "bahkan", "bahwa", "bahwasanya",
  "baik", "bakal", "bakalan", "balik", "banyak", "bapak", "baru", "bawah", "beberapa", "begini",
  "beginian", "beginikah", "beginilah", "begitu", "begitukah", "begitulah", "begitupun", "bekerja",
  "belakang", "belakangan", "belum", "belumlah", "benar", "benarkah", "benarlah", "berada",
  "berakhir", "berakhirlah", "berakhirnya", "berapa", "berapakah", "berapalah", "berapapun",
  "berarti", "berawal", "berbagai", "berdatangan", "beri", "berikan", "berikut", "berikutnya",
  "berjumlah", "berkali-kali", "berkata", "berkat", "berkehendak", "berkeinginan", "berkenaan",
  "berlainan", "berlalu", "berlangsung", "berlebihan", "bermacam", "bermacam-macam", "bermaksud",
  "bermula", "bersama", "bersama-sama", "bersiap", "bersiap-siap", "bertanya", "bertanya-tanya",
  "berturut", "berturut-turut", "bertutur", "berujar", "berupa", "besar", "betul", "betulkah",
  "biasa", "biasanya", "bila", "bilakah", "bisa", "bisakah", "boleh", "bolehkah", "bolehlah",
  "buat", "bukan", "bukankah", "bukanlah", "bukannya", "bulan", "bung", "cara", "caranya",
  "cukup", "cukuplah", "cukupnya", "cuma", "dahulu", "dalam", "dan", "dapat", "dari", "daripada",
  "datang", "dekat", "demi", "demikian", "demikianlah", "dengan", "depan", "di", "dia", "diakhiri",
  "diakhirinya", "dialah", "diantara", "diantaranya", "diberi", "diberikan", "diberikannya",
  "dibuat", "dibuatnya", "didapat", "didatangkan", "digunakan", "diibaratkan", "diibaratkannya",
  "diingat", "diingatkan", "diinginkan", "dijawab", "dijelaskan", "dijelaskannya", "dikarenakan",
  "dikatakan", "dikatakannya", "dikerjakan", "diketahui", "diketahuinya", "dikira", "dilakukan",
  "dilalui", "dilihat", "dimaksud", "dimaksudkan", "dimaksudkannya", "dimaksudnya", "diminta",
  "dimintai", "dimisalkan", "dimulai", "dimulailah", "dimulainya", "dimungkinkan", "dini",
  "dipastikan", "diperbuat", "diperbuatnya", "dipergunakan", "diperkirakan", "diperlihatkan",
  "diperlukan", "diperlukannya", "dipersoalkan", "dipertanyakan", "dipunyai", "diri", "dirinya",
  "disampaikan", "disebut", "disebutkan", "disebutkannya", "disini", "disinilah", "ditambahkan",
  "ditandaskan", "ditanya", "ditanyai", "ditanyakan", "ditegaskan", "ditujukan", "ditunjuk",
  "ditunjuki", "ditunjukkan", "ditunjukkannya", "ditunjuknya", "dituturkan", "dituturkannya",
  "diucapkan", "diucapkannya", "diungkapkan", "dong", "dua", "dulu", "empat", "enggan", "enggankah",
  "engkau", "engkaukah", "engkaulah", "hal", "hampir", "hanya", "hanyakah", "hanyalah", "hari",
  "harus", "haruskah", "haruslah", "hebat", "hendak", "hendaklah", "hendaknya", "hingga", "ia",
  "ialah", "ibarat", "ibaratkan", "ibaratnya", "ibu", "ikut", "ingat", "ingat-ingat", "ingin",
  "inginkah", "inginkan", "ini", "inikah", "inilah", "itu", "itukah", "itulah", "jadi", "jadilah",
  "jadinya", "jangan", "jangankah", "janganlah", "janji", "jauh", "jawab", "jawaban", "jawabnya",
  "jelas", "jelaskan", "jelaslah", "jelasnya", "jika", "jikalau", "juga", "jumlah", "jumlahnya",
  "justru", "kala", "kalau", "kalaukah", "kalaupun", "kalian", "kami", "kamilah", "kamu", "kamulah",
  "kan", "kapan", "kapankah", "kapanpun", "karena", "karenanya", "kasus", "kata", "katakan",
  "katakanlah", "katanya", "ke", "keadaan", "kebetulan", "kecil", "kedua", "keduanya", "keinginan",
  "kelamaan", "kelihatan", "kelihatannya", "kelima", "keluar", "kembali", "kemudian", "kemungkinan",
  "kemungkinannya", "kenapa", "kepada", "kepadanya", "kesampaian", "keseluruhan", "keseluruhannya",
  "keterlaluan", "ketika", "khususnya", "kini", "kinilah", "kira", "kira-kira", "kiranya", "kita",
  "kitalah", "kok", "kurang", "lagi", "lagian", "lah", "lain", "lainnya", "lalu", "lama", "lamanya",
  "lanjut", "lanjutnya", "lebih", "lewat", "lima", "luar", "macam", "maka", "makanya", "makin",
  "malah", "malahan", "mampu", "mampukah", "mana", "manakala", "manalagi", "masa", "masalah",
  "masalahnya", "masih", "masihkah", "masing", "masing-masing", "mau", "maupun", "melainkan",
  "melakukan", "melalui", "melihat", "melihatnya", "memang", "memastikan", "memberi", "memberikan",
  "membuat", "memerlukan", "memihak", "meminta", "memintakan", "memisalkan", "memperbuat",
  "mempergunakan", "memperkirakan", "memperlihatkan", "mempersiapkan", "mempersoalkan", "mempertanyakan",
  "mempunyai", "memulai", "menandaskan", "menanti", "menanti-nanti", "menantikan", "menanya",
  "menanyai", "menanyakan", "mendapat", "mendapatkan", "mendatang", "mendatangi", "mendatangkan",
  "menegaskan", "mengakhiri", "mengapa", "mengatakan", "mengatakannya", "mengenai", "mengerjakan",
  "mengetahui", "menggunakan", "menghendaki", "mengibaratkan", "mengibaratkannya", "mengingat",
  "mengingatkan", "menginginkan", "mengira", "mengucapkan", "mengucapkannya", "mengungkapkan",
  "menjadi", "menjawab", "menjelaskan", "menuju", "menunjuk", "menunjuki", "menunjukkan", "menunjuknya",
  "menurut", "menuturkan", "menyampaikan", "menyangkut", "menyatakan", "menyebutkan", "menyeluruh",
  "menyiapkan", "merasa", "mereka", "merekalah", "merupakan", "meski", "meskipun", "meyakini",
  "meyakinkan", "minta", "mirip", "misal", "misalkan", "misalnya", "mula", "mulai", "mulailah",
  "mulanya", "mungkin", "mungkinkah", "nah", "naik", "namun", "nanti", "nantinya", "nyaris",
  "nyata", "nyatanya", "oleh", "olehnya", "pada", "padahal", "padanya", "pak", "paling", "panjang",
  "pantas", "pantaskah", "pantaslah", "para", "pasti", "pastilah", "penting", "pentingnya", "per",
  "percuma", "perlu", "perlukah", "perlunya", "pernah", "persoalan", "pertama", "pertama-tama",
  "pertanyaan", "pertanyakan", "pihak", "pihaknya", "pukul", "pula", "pun", "punya", "rasa",
  "rasanya", "rupa", "rupanya", "saat", "saatnya", "saja", "sajalah", "saling", "sama", "sama-sama",
  "sambil", "sampai", "sampai-sampai", "sampaikan", "sana", "sangat", "sangatlah", "satu", "saya",
  "sayalah", "se", "sebab", "sebabnya", "sebagai", "sebagaimana", "sebagainya", "sebagian",
  "sebaik", "sebaik-baiknya", "sebaiknya", "sebaliknya", "sebanyak", "sebegini", "sebegitu",
  "sebelum", "sebelumnya", "sebenarnya", "seberapa", "sebesar", "sebetulnya", "sebisanya", "sebuah",
  "sebut", "sebutlah", "sebutnya", "secara", "secukupnya", "sedang", "sedangkan", "sedemikian",
  "sedikit", "sedikitnya", "seenaknya", "segala", "segalanya", "segera", "seharusnya", "sehingga",
  "seingat", "sejak", "sejauh", "sejenak", "sejumlah", "sekadar", "sekadarnya", "sekali", "sekali-kali",
  "sekalian", "sekaligus", "sekalipun", "sekarang", "sekaranglah", "sekecil", "seketika", "sekiranya",
  "sekitar", "sekitarnya", "sekurang-kurangnya", "sekurangnya", "sela", "selain", "selaku", "selalu",
  "selama", "selama-lamanya", "selamanya", "selanjutnya", "seluruh", "seluruhnya", "semacam",
  "semakin", "semampu", "semampunya", "semasa", "semasih", "semata", "semata-mata", "semaunya",
  "sementara", "semisal", "semisalnya", "sempat", "semua", "semuanya", "semula", "sendiri",
  "sendirian", "sendirinya", "seolah", "seolah-olah", "seorang", "sepanjang", "sepantasnya",
  "sepantasnyalah", "seperlunya", "seperti", "sepertinya", "sepihak", "sering", "seringnya",
  "serta", "serupa", "sesaat", "sesama", "sesampai", "sesegera", "sesekali", "seseorang", "sesuatu",
  "sesuatunya", "sesudah", "sesudahnya", "setelah", "setempat", "setengah", "seterusnya", "setiap",
  "setiba", "setibanya", "setidak-tidaknya", "setidaknya", "setinggi", "seusai", "sewaktu", "siap",
  "siapa", "siapakah", "siapapun", "sini", "sinilah", "soal", "soalnya", "suatu", "sudah", "sudahkah",
  "sudahlah", "supaya", "tadi", "tadinya", "tahu", "tahun", "tak", "tambah", "tambahnya", "tampak",
  "tampaknya", "tandas", "tandasnya", "tanpa", "tanya", "tanyakan", "tanyanya", "tapi", "tegas",
  "tegasnya", "telah", "tempat", "tengah", "tentang", "tentu", "tentulah", "tentunya", "tepat",
  "terakhir", "terasa", "terbanyak", "terdahulu", "terdapat", "terdiri", "terhadap", "terhadapnya",
  "teringat", "teringat-ingat", "terjadi", "terjadilah", "terjadinya", "terkira", "terlalu",
  "terlebih", "terlihat", "termasuk", "ternyata", "tersampaikan", "tersebut", "tersebutlah",
  "tertentu", "tertuju", "terus", "terutama", "tetap", "tetapi", "tiap", "tiba", "tiba-tiba", "tidak",
  "tidakkah", "tidaklah", "tiga", "tinggi", "toh", "tunjuk", "turut", "tutur", "tuturnya", "ucap",
  "ucapnya", "ujar", "ujarnya", "umum", "umumnya", "ungkap", "ungkapnya", "untuk", "usah", "usai",
  "waduh", "wah", "wahai", "waktu", "waktunya", "walau", "walaupun", "wong", "yaitu", "yakin", "yakni", "yang"
]);

/**
 * Extractive Summarization Algorithm (Term Frequency based)
 * Dipindahkan dari renderer.js ke main process untuk mencegah UI freeze.
 * 1. Split text into sentences
 * 2. Calculate word frequencies (ignoring stopwords)
 * 3. Score sentences based on word frequencies
 * 4. Return top 2 sentences, joined, up to maxChars
 */
function generateExtractiveSummary(text, maxChars = 500) {
  if (!text || text.trim() === '') return '';

  // 1. Split into sentences (improved: melindungi singkatan & angka desimal dari pemecahan yang salah)
  const ABBR_RE = /\b(Dr|Prof|Mr|Mrs|Sdr|Sdri|Ir|Hj|H|KH|Rp|dll|dsb|dkk|yth|No|Jl|Kel|Kec|Kab|Prov|vs|vol|hal|hlm)\./gi;
  let processed = text.replace(ABBR_RE, '$1\u0000');
  processed = processed.replace(/(\d)\.(\d)/g, '$1\u0000$2');
  const rawSentences = processed.match(/[^.!?]+[.!?]+/g) || [processed];
  const sentences = rawSentences.map(s => s.replace(/\u0000/g, '.'));
  
  // If it's already very short, just return it
  if (text.length <= maxChars && sentences.length <= 2) {
    return text.trim();
  }

  // 2. Calculate word frequencies
  const wordFreq = {};
  const cleanSentences = sentences.map(s => s.trim()).filter(s => s.length > 10);
  
  if (cleanSentences.length === 0) return text.substring(0, maxChars) + '...';

  cleanSentences.forEach(sentence => {
    // Get words (alphanumeric only)
    const words = sentence.toLowerCase().match(/[a-z0-9]+/g) || [];
    words.forEach(word => {
      if (!INDONESIAN_STOPWORDS.has(word) && word.length > 2) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    });
  });

  // 3. Score sentences
  const sentenceScores = cleanSentences.map((sentence, originalIndex) => {
    const words = sentence.toLowerCase().match(/[a-z0-9]+/g) || [];
    let score = 0;
    words.forEach(word => {
      if (wordFreq[word]) {
        score += wordFreq[word];
      }
    });
    
    // Normalize score by length to avoid just picking the longest sentence
    // But give slight boost to first sentences as they usually contain intro
    const normalizedScore = words.length > 0 ? (score / words.length) : 0;
    const positionBoost = (cleanSentences.length - originalIndex) / cleanSentences.length; 
    
    return {
      text: sentence,
      score: normalizedScore + (positionBoost * 0.5),
      index: originalIndex
    };
  });

  // 4. Sort by score descending and take top 2
  sentenceScores.sort((a, b) => b.score - a.score);
  const topSentences = sentenceScores.slice(0, 2);

  // Sort back by original chronological order
  topSentences.sort((a, b) => a.index - b.index);

  // 5. Join and truncate if needed
  let summary = topSentences.map(s => s.text).join(' ');

  if (summary.length > maxChars) {
    summary = summary.substring(0, maxChars).trim() + '...';
  }

  return summary;
}

// ── IPC Handler: Generate Summary ────────────────────────────

ipcMain.handle('generate-summary', (_event, text) => {
  return generateExtractiveSummary(text, 500);
});

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

