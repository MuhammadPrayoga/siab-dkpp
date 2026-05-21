// ============================================================
// SIAB DKPP - Renderer Process (renderer.js)
// UI logic: form handling, table rendering, worker management,
// CSV download, progress display, tab navigation, history
// ============================================================

(function () {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────
  const HISTORY_KEY = 'siab-dkpp-history';
  const SETTINGS_KEY = 'siab-dkpp-settings';
  const MAX_HISTORY = 50;

  // ── State ────────────────────────────────────────────────────
  let articles = [];
  let snippets = {};
  let pendingSnippets = 0;
  let currentHistoryId = null;
  let isCrawling = false;
  let progressCleanup = null;

  let settings = {
    maxResults: 50,
    theme: 'light',
    timeout: 25000,
    requestDelay: 800,
    maxHistory: 100,
    trustedMediaOnly: false,
    defaultKeywords: 'DKPP RI, DEWAN KEHORMATAN PENYELENGGARA PEMILU',
    trustedMediaDomains: [
      'kompas.com', 'detik.com', 'antaranews.com', 'tribunnews.com',
      'cnnindonesia.com', 'cnbcindonesia.com', 'tempo.co', 'viva.co.id',
      'suara.com', 'liputan6.com', 'merdeka.com', 'republika.co.id',
      'idntimes.com', 'tvonenews.com'
    ]
  };

  // ── DOM References ───────────────────────────────────────────
  const DOM = {
    // Navigation
    navTabCrawl: document.getElementById('nav-tab-crawl'),
    navTabHistory: document.getElementById('nav-tab-history'),
    navTabSettings: document.getElementById('nav-tab-settings'),
    pageCrawl: document.getElementById('page-crawl'),
    pageHistory: document.getElementById('page-history'),
    pageSettings: document.getElementById('page-settings'),

    // Crawl page
    form: document.getElementById('crawl-form'),
    keywordInput: document.getElementById('keyword-input'),
    dateFrom: document.getElementById('date-from'),
    dateTo: document.getElementById('date-to'),
    crawlBtn: document.getElementById('crawl-btn'),
    crawlBtnIcon: document.getElementById('crawl-btn-icon'),
    crawlBtnSpinner: document.getElementById('crawl-btn-spinner'),
    crawlBtnText: document.getElementById('crawl-btn-text'),
    progressSection: document.getElementById('progress-section'),
    progressMessage: document.getElementById('progress-message'),
    progressCounter: document.getElementById('progress-counter'),
    progressBar: document.getElementById('progress-bar'),
    modelSection: document.getElementById('model-section'),
    modelStatusMessage: document.getElementById('model-status-message'),
    modelProgressBar: document.getElementById('model-progress-bar'),
    resultsSection: document.getElementById('results-section'),
    resultsTableBody: document.getElementById('results-table-body'),
    articleCount: document.getElementById('article-count'),
    downloadCsvBtn: document.getElementById('download-csv-btn'),
    emptyState: document.getElementById('empty-state'),
    errorSection: document.getElementById('error-section'),
    errorMessage: document.getElementById('error-message'),

    // History page
    historyList: document.getElementById('history-list'),
    historyCount: document.getElementById('history-count'),
    historyEmptyState: document.getElementById('history-empty-state'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),

    // Settings page
    settingMaxResults: document.getElementById('setting-max-results'),
    settingTheme: document.getElementById('setting-theme'),
    settingTimeout: document.getElementById('setting-timeout'),
    settingRequestDelay: document.getElementById('setting-request-delay'),
    settingMaxHistory: document.getElementById('setting-max-history'),
    settingTrustedMedia: document.getElementById('setting-trusted-media'),
    settingDefaultKeywords: document.getElementById('setting-default-keywords'),
    settingTrustedMediaDomains: document.getElementById('setting-trusted-media-domains'),
    btnClearCache: document.getElementById('btn-clear-cache'),

    // About section
    aboutVersion: document.getElementById('about-version'),
    aboutElectron: document.getElementById('about-electron'),
    aboutDbPath: document.getElementById('about-db-path'),

    // Log terminal elements
    logTerminal: document.getElementById('log-terminal'),
    btnCopyLogs: document.getElementById('btn-copy-logs'),
    btnClearLogs: document.getElementById('btn-clear-logs'),

    // Pagination elements
    paginationBar: document.getElementById('pagination-bar'),
    paginationPerPage: document.getElementById('pagination-per-page'),
    paginationPrev: document.getElementById('pagination-prev'),
    paginationNext: document.getElementById('pagination-next'),
    paginationInfo: document.getElementById('pagination-info'),
    paginationPageIndicator: document.getElementById('pagination-page-indicator'),
  };

  // ── Tab Navigation ──────────────────────────────────────────

  function switchTab(tabName) {
    DOM.navTabCrawl.classList.toggle('active', tabName === 'crawl');
    DOM.navTabHistory.classList.toggle('active', tabName === 'history');
    DOM.navTabSettings.classList.toggle('active', tabName === 'settings');
    DOM.pageCrawl.classList.toggle('hidden', tabName !== 'crawl');
    DOM.pageHistory.classList.toggle('hidden', tabName !== 'history');
    DOM.pageSettings.classList.toggle('hidden', tabName !== 'settings');

    if (tabName === 'history') {
      renderHistoryPage();
    }
  }

  DOM.navTabCrawl.addEventListener('click', () => switchTab('crawl'));
  DOM.navTabHistory.addEventListener('click', () => switchTab('history'));
  DOM.navTabSettings.addEventListener('click', () => switchTab('settings'));

  // ── Settings Management ──────────────────────────────────────

  async function loadSettings() {
    try {
      // ── One-time migration from localStorage to database ──
      const MIGRATION_FLAG = 'siab-dkpp-migrated-to-db';
      if (!localStorage.getItem(MIGRATION_FLAG)) {
        console.log('[RENDERER] Checking for localStorage data to migrate...');
        const oldHistory = localStorage.getItem(HISTORY_KEY);
        const oldSettings = localStorage.getItem(SETTINGS_KEY);
        
        if (oldHistory || oldSettings) {
          const historyData = oldHistory ? JSON.parse(oldHistory) : [];
          const settingsData = oldSettings ? JSON.parse(oldSettings) : {};
          
          await window.electronAPI.migrateLocalStorage({
            history: historyData,
            settings: settingsData
          });
          
          console.log('[RENDERER] localStorage data migrated to database successfully');
          // Clean up old localStorage data
          localStorage.removeItem(HISTORY_KEY);
          localStorage.removeItem(SETTINGS_KEY);
        }
        localStorage.setItem(MIGRATION_FLAG, 'true');
      }

      // ── Load settings from persistent database ──
      const result = await window.electronAPI.getSettings();
      if (result.success && result.data) {
        settings = { ...settings, ...result.data };
      }
    } catch (e) {
      console.error('[RENDERER] Load settings error:', e);
    }

    // Update DOM inputs to match loaded settings
    if (DOM.settingMaxResults) DOM.settingMaxResults.value = settings.maxResults;
    if (DOM.settingTheme) DOM.settingTheme.value = settings.theme;
    if (DOM.settingTimeout) DOM.settingTimeout.value = settings.timeout;
    if (DOM.settingRequestDelay) DOM.settingRequestDelay.value = settings.requestDelay;
    if (DOM.settingMaxHistory) DOM.settingMaxHistory.value = settings.maxHistory;
    if (DOM.settingTrustedMedia) DOM.settingTrustedMedia.checked = settings.trustedMediaOnly;
    if (DOM.settingDefaultKeywords) DOM.settingDefaultKeywords.value = settings.defaultKeywords || '';
    if (DOM.settingTrustedMediaDomains) {
      DOM.settingTrustedMediaDomains.value = (settings.trustedMediaDomains || []).join(', ');
    }
    
    applyTheme();
  }

  async function saveSettings() {
    settings = {
      maxResults: parseInt(DOM.settingMaxResults.value, 10),
      theme: DOM.settingTheme.value,
      timeout: parseInt(DOM.settingTimeout.value, 10),
      requestDelay: parseInt(DOM.settingRequestDelay.value, 10),
      maxHistory: parseInt(DOM.settingMaxHistory.value, 10),
      trustedMediaOnly: DOM.settingTrustedMedia.checked,
      defaultKeywords: (DOM.settingDefaultKeywords.value || '').trim(),
      trustedMediaDomains: (DOM.settingTrustedMediaDomains && DOM.settingTrustedMediaDomains.value || '')
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(d => d.length > 0)
    };

    // Save to persistent database via IPC
    try {
      await window.electronAPI.saveSettings(settings);
    } catch (e) {
      console.error('[RENDERER] Save settings error:', e);
    }

    applyTheme();
  }

  function applyTheme() {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // Attach change listeners to settings inputs
  [DOM.settingMaxResults, DOM.settingTheme, DOM.settingTimeout, DOM.settingRequestDelay, DOM.settingMaxHistory, DOM.settingTrustedMedia, DOM.settingDefaultKeywords, DOM.settingTrustedMediaDomains].forEach(el => {
    if (el) el.addEventListener('change', saveSettings);
  });

  // Save keywords on blur (when user clicks away) so they don't need to press Enter
  if (DOM.settingDefaultKeywords) {
    DOM.settingDefaultKeywords.addEventListener('blur', saveSettings);
  }

  // Simpan daftar domain media terpercaya saat pengguna klik di luar textarea
  if (DOM.settingTrustedMediaDomains) {
    DOM.settingTrustedMediaDomains.addEventListener('blur', saveSettings);
  }

  if (DOM.btnClearCache) {
    DOM.btnClearCache.addEventListener('click', async () => {
      if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat dan cache? Tindakan ini tidak dapat dibatalkan.')) {
        await clearAllHistory();
        await renderHistoryPage();
        alert('Data riwayat dan cache berhasil dibersihkan.');
        logSystem('Data riwayat pencarian dan cache berhasil dibersihkan.', 'success');
      }
    });
  }

  // ── System Log Console Management ────────────────────────────

  function logSystem(message, type = 'info') {
    if (!DOM.logTerminal) return;

    const time = new Date().toLocaleTimeString('id-ID');
    const entry = document.createElement('div');
    
    let colorClass = 'text-slate-300';
    let typeLabel = '[INFO]';
    
    if (type === 'success') {
      colorClass = 'text-emerald-400 font-semibold';
      typeLabel = '[SUCCESS]';
    } else if (type === 'error') {
      colorClass = 'text-red-400 font-semibold';
      typeLabel = '[ERROR]';
    } else if (type === 'warning') {
      colorClass = 'text-amber-400';
      typeLabel = '[WARN]';
    } else if (type === 'debug') {
      colorClass = 'text-cyan-400/80';
      typeLabel = '[DEBUG]';
    } else if (type === 'ai') {
      colorClass = 'text-purple-400';
      typeLabel = '[AI]';
    }

    entry.className = colorClass;
    entry.innerHTML = `<span class="text-slate-500">[${time}]</span> <span class="opacity-90">${typeLabel}</span> ${message}`;
    
    DOM.logTerminal.appendChild(entry);
    DOM.logTerminal.scrollTop = DOM.logTerminal.scrollHeight;
  }

  if (DOM.btnCopyLogs) {
    DOM.btnCopyLogs.addEventListener('click', () => {
      if (!DOM.logTerminal) return;
      const text = DOM.logTerminal.innerText;
      navigator.clipboard.writeText(text);
      
      const originalText = DOM.btnCopyLogs.textContent;
      DOM.btnCopyLogs.textContent = 'Tersalin!';
      DOM.btnCopyLogs.classList.add('text-emerald-600', 'dark:text-emerald-400');
      setTimeout(() => {
        DOM.btnCopyLogs.textContent = originalText;
        DOM.btnCopyLogs.classList.remove('text-emerald-600', 'dark:text-emerald-400');
      }, 1500);
    });
  }

  if (DOM.btnClearLogs) {
    DOM.btnClearLogs.addEventListener('click', () => {
      if (!DOM.logTerminal) return;
      DOM.logTerminal.innerHTML = '<div class="text-slate-500">[SYSTEM] Konsol log dibersihkan. Siap menerima perintah pencarian.</div>';
    });
  }



  // ── Table Cell Summary Update ────────────────────────────────

  function updateCellSummary(index, text, state) {
    const cell = document.getElementById(`summary-cell-${index}`);
    if (!cell) return;

    cell.textContent = text;

    // Style based on state
    cell.classList.remove('text-slate-500', 'text-slate-400', 'text-emerald-600', 'text-emerald-400', 'text-red-500', 'text-red-400');
    if (state === 'loading') {
      cell.classList.add('text-slate-500', 'dark:text-slate-400');
    } else if (state === 'done') {
      cell.classList.add('text-emerald-600', 'dark:text-emerald-400');
    } else if (state === 'error') {
      cell.classList.add('text-red-500', 'dark:text-red-400');
    }
  }

  // ── All Snippets Complete Handler ───────────────────────────

  async function onAllSnippetsComplete() {
    console.log('[RENDERER] All snippets complete');
    logSystem('Seluruh proses ekstraksi cuplikan berita selesai dilakukan!', 'success');
    if (currentHistoryId) {
      await updateHistorySnippets(currentHistoryId, snippets);
    }
  }

  // ── Crawl Progress Handler ───────────────────────────────────

  function setupProgressListener() {
    if (progressCleanup) progressCleanup();

    progressCleanup = window.electronAPI.onCrawlProgress((data) => {
      DOM.progressSection.classList.remove('hidden');
      DOM.progressMessage.textContent = data.message;
      logSystem(data.message, 'debug');

      if (data.total > 0) {
        const pct = Math.round((data.current / data.total) * 100);
        DOM.progressBar.style.width = `${pct}%`;
        DOM.progressCounter.textContent = `${data.current}/${data.total}`;
      }
    });
  }

  // ── Form Submission ──────────────────────────────────────────

  DOM.form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (isCrawling) return;

    isCrawling = true;

    // Reset state
    articles = [];
    snippets = {};
    currentHistoryId = null;
    pendingSnippets = 0;

    // UI: show loading
    setCrawlButtonLoading(true);
    hideError();
    DOM.emptyState.classList.add('hidden');
    DOM.resultsSection.classList.add('hidden');
    DOM.progressSection.classList.remove('hidden');
    DOM.progressBar.style.width = '0%';
    DOM.progressCounter.textContent = '';
    DOM.progressMessage.textContent = 'Memulai proses crawling...';

    // Setup progress listener
    setupProgressListener();

    // Collect params including maxResults from settings
    const params = {
      keyword: DOM.keywordInput.value.trim(),
      dateFrom: DOM.dateFrom.value || null,
      dateTo: DOM.dateTo.value || null,
      maxResults: settings.maxResults,
      timeout: settings.timeout,
      requestDelay: settings.requestDelay,
      trustedMediaOnly: settings.trustedMediaOnly,
      defaultKeywords: settings.defaultKeywords,
      trustedMediaDomains: settings.trustedMediaDomains || []
    };

    console.log('[RENDERER] Starting crawl with params:', params);
    logSystem(`Memulai crawling data untuk kata kunci: "${params.keyword || 'DKPP'}"...`, 'info');

    try {
      const result = await window.electronAPI.startCrawl(params);

      console.log('[RENDERER] Crawl result:', result.success, result.articles?.length, 'articles');

      if (result.success) {
        articles = result.articles || [];

        if (articles.length === 0) {
          DOM.emptyState.classList.remove('hidden');
          DOM.progressSection.classList.add('hidden');
          showError(result.message || 'Tidak ada berita ditemukan untuk query ini.');
          logSystem('Pencarian selesai, tetapi tidak ada artikel berita yang ditemukan untuk kata kunci ini.', 'warning');
          return;
        }

        // Render table (reset pagination & sort)
        currentPage = 1;
        currentSortColumn = null;
        currentSortDirection = 'asc';
        updateSortArrows();
        renderTable(articles);

        // Save to history (initial, without snippets)
        currentHistoryId = await saveToHistory(params, articles);

        // Start snippet extraction
        logSystem(`Berhasil menarik ${articles.length} berita. Memulai ekstraksi cuplikan teks...`, 'success');
        extractSnippets(articles);

        // Update progress
        DOM.progressMessage.textContent = `✅ ${articles.length} artikel berhasil di-crawl. Memulai ekstraksi cuplikan...`;
        DOM.progressBar.style.width = '100%';

        // Hide progress after delay
        setTimeout(() => {
          DOM.progressSection.classList.add('hidden');
        }, 3000);

      } else {
        showError(result.error || 'Terjadi kesalahan yang tidak diketahui.');
        logSystem(`Proses crawling gagal: ${result.error || 'Kesalahan tidak diketahui'}`, 'error');
      }

    } catch (error) {
      console.error('[RENDERER] Crawl error:', error);
      showError(`Koneksi ke main process gagal: ${error.message}`);
    } finally {
      isCrawling = false;
      setCrawlButtonLoading(false);
    }
  });

  // ── Render Results Table + Pagination + Sorting ──────────────

  // Sort state
  let currentSortColumn = null;
  let currentSortDirection = 'asc';

  // Pagination state
  let currentPage = 1;
  let perPage = 25;

  function sortArticles(articleList, column, direction) {
    const sorted = [...articleList];
    sorted.sort((a, b) => {
      let valA, valB;
      switch (column) {
        case 'title':
          valA = (a.title || '').toLowerCase();
          valB = (b.title || '').toLowerCase();
          break;
        case 'source':
          valA = (a.source || '').toLowerCase();
          valB = (b.source || '').toLowerCase();
          break;
        case 'date':
          valA = a.rawDate ? new Date(a.rawDate).getTime() : 0;
          valB = b.rawDate ? new Date(b.rawDate).getTime() : 0;
          break;
        case 'status':
          valA = a.hasText ? 1 : 0;
          valB = b.hasText ? 1 : 0;
          break;
        default:
          return 0;
      }
      if (valA < valB) return direction === 'asc' ? -1 : 1;
      if (valA > valB) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  function getDisplayArticles() {
    let list = [...articles];
    if (currentSortColumn) {
      list = sortArticles(list, currentSortColumn, currentSortDirection);
    }
    return list;
  }

  function updateSortArrows() {
    document.querySelectorAll('th[data-sort] .sort-arrow').forEach(arrow => {
      arrow.style.opacity = '0';
      arrow.textContent = '▲';
    });
    if (currentSortColumn) {
      const activeHeader = document.querySelector(`th[data-sort="${currentSortColumn}"] .sort-arrow`);
      if (activeHeader) {
        activeHeader.style.opacity = '1';
        activeHeader.textContent = currentSortDirection === 'asc' ? '▲' : '▼';
      }
    }
  }

  function refreshTableView() {
    const allSorted = getDisplayArticles();
    renderTable(allSorted);
    reapplySnippets();
  }

  function reapplySnippets() {
    for (const [key, value] of Object.entries(snippets)) {
      const cell = document.getElementById(`summary-cell-${key}`);
      if (cell && value) {
        cell.textContent = value;
      }
    }
  }

  // Attach click handlers to sortable headers
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.getAttribute('data-sort');
      if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortColumn = column;
        currentSortDirection = 'asc';
      }
      updateSortArrows();
      currentPage = 1;
      if (articles.length > 0) refreshTableView();
    });
  });

  // ── Pagination Controls ──────────────────────────────────────

  function updatePaginationUI(totalItems) {
    const totalPages = Math.max(1, Math.ceil(totalItems / perPage));
    if (currentPage > totalPages) currentPage = totalPages;

    const startItem = (currentPage - 1) * perPage + 1;
    const endItem = Math.min(currentPage * perPage, totalItems);

    DOM.paginationBar.classList.remove('hidden');
    DOM.paginationInfo.textContent = `Menampilkan ${startItem}–${endItem} dari ${totalItems} artikel`;
    DOM.paginationPageIndicator.textContent = `Hal ${currentPage} / ${totalPages}`;
    DOM.paginationPrev.disabled = currentPage <= 1;
    DOM.paginationNext.disabled = currentPage >= totalPages;
  }

  if (DOM.paginationPerPage) {
    DOM.paginationPerPage.addEventListener('change', () => {
      perPage = parseInt(DOM.paginationPerPage.value, 10);
      currentPage = 1;
      if (articles.length > 0) refreshTableView();
    });
  }

  if (DOM.paginationPrev) {
    DOM.paginationPrev.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        refreshTableView();
        DOM.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  if (DOM.paginationNext) {
    DOM.paginationNext.addEventListener('click', () => {
      const totalPages = Math.ceil(articles.length / perPage);
      if (currentPage < totalPages) {
        currentPage++;
        refreshTableView();
        DOM.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // ── Render Table (paginated) ─────────────────────────────────

  function renderTable(articleList) {
    DOM.resultsSection.classList.remove('hidden');
    DOM.emptyState.classList.add('hidden');
    DOM.articleCount.textContent = `${articleList.length} artikel`;

    // Paginate: slice only the current page
    const startIndex = (currentPage - 1) * perPage;
    const pageItems = articleList.slice(startIndex, startIndex + perPage);

    updatePaginationUI(articleList.length);

    const tbody = DOM.resultsTableBody;
    tbody.innerHTML = '';

    pageItems.forEach((article, i) => {
      const globalIndex = startIndex + i; // for display numbering
      const row = document.createElement('tr');
      row.className = `table-row-hover ${i % 2 === 0 ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-white dark:bg-slate-900/40'} animate-fade-in`;
      row.style.animationDelay = `${i * 0.04}s`;

      const statusBadge = article.hasText
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">OK</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">Gagal</span>';

      row.innerHTML = `
        <td class="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-mono">${globalIndex + 1}</td>
        <td class="px-4 py-3">
          <a href="${escapeHtml(article.link)}"
             target="_blank"
             rel="noopener noreferrer"
             class="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors line-clamp-2"
             title="${escapeHtml(article.title)}">
            ${escapeHtml(article.title)}
          </a>
        </td>
        <td class="px-4 py-3 text-xs text-slate-600 dark:text-slate-400">${escapeHtml(article.source)}</td>
        <td class="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">${escapeHtml(article.date)}</td>
        <td class="px-4 py-3">${statusBadge}</td>
        <td class="px-4 py-3">
          <div id="summary-cell-${article.index}" class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed line-clamp-3">
            ${article.hasText ? '⏳ Menunggu cuplikan...' : '—'}
          </div>
        </td>
      `;

      tbody.appendChild(row);
    });
  }

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

  // ── Snippet Extraction ───────────────────────────────────────

  function extractSnippets(articleList) {
    // Queue articles for snippet extraction
    const articlesWithText = articleList.filter(a => a.hasText);
    pendingSnippets = articlesWithText.length;
    console.log(`[RENDERER] Extracting snippets for ${articlesWithText.length} articles`);

    if (articlesWithText.length === 0) return;

    logSystem('Mengekstrak cuplikan teks...', 'info');
    articlesWithText.forEach((article) => {
      // Extractive summary max 500 chars
      let snippet = generateExtractiveSummary(article.cleanText, 500);
      
      snippets[article.index] = snippet;
      updateCellSummary(article.index, snippet, 'done');
      pendingSnippets--;
    });
    
    onAllSnippetsComplete();
  }

  // ── CSV Download ─────────────────────────────────────────────

  DOM.downloadCsvBtn.addEventListener('click', () => {
    if (articles.length === 0) {
      console.warn('[RENDERER] No articles to download');
      return;
    }

    console.log('[RENDERER] Generating CSV...');
    const filename = `siab-dkpp_${getDateStamp()}.csv`;
    logSystem(`Menyusun dan mengekspor ${articles.length} hasil analisis ke berkas CSV...`, 'info');

    // BOM for UTF-8 support in Excel
    const BOM = '\uFEFF';

    // CSV Header
    const headers = ['No', 'Judul', 'Sumber', 'Link', 'Tanggal', 'Status Ekstraksi', 'Teks Bersih', 'Cuplikan Teks'];

    // CSV Rows
    const rows = articles.map((article, i) => {
      const summary = snippets[article.index] || '';
      return [
        i + 1,
        csvEscape(article.title),
        csvEscape(article.source),
        csvEscape(article.link),
        csvEscape(article.date),
        article.hasText ? 'Berhasil' : 'Gagal',
        csvEscape(article.cleanText),
        csvEscape(summary),
      ];
    });

    // Build CSV string
    const csvContent = BOM
      + headers.map(csvEscape).join(',') + '\n'
      + rows.map(row => row.join(',')).join('\n');

    // Create Blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log('[RENDERER] CSV downloaded');
    logSystem(`Unduhan berhasil: berkas "${filename}" telah disimpan!`, 'success');
  });

  // ══════════════════════════════════════════════════════════════
  // HISTORY FUNCTIONS (Persistent Database via IPC)
  // ══════════════════════════════════════════════════════════════

  async function saveToHistory(params, articleList) {
    try {
      const id = Date.now().toString();

      const entry = {
        id,
        timestamp: new Date().toISOString(),
        keyword: params.keyword || '',
        dateFrom: params.dateFrom || null,
        dateTo: params.dateTo || null,
        articleCount: articleList.length,
        successCount: articleList.filter(a => a.hasText).length,
        articles: articleList.map(a => ({
          index: a.index,
          title: a.title,
          source: a.source,
          link: a.link,
          date: a.date,
          hasText: a.hasText,
          cleanText: a.cleanText || '', // Now stored! (no size limit with file-based DB)
        })),
        snippets: {},
      };

      await window.electronAPI.saveHistory(entry);
      console.log('[RENDERER] History saved to database:', id);
      return id;

    } catch (error) {
      console.error('[RENDERER] Failed to save history:', error);
      return null;
    }
  }

  async function updateHistorySnippets(historyId, snippetsData) {
    try {
      await window.electronAPI.updateSnippets(historyId, snippetsData);
      console.log('[RENDERER] History snippets updated for:', historyId);
    } catch (error) {
      console.error('[RENDERER] Failed to update history snippets:', error);
    }
  }

  async function loadHistory() {
    try {
      const result = await window.electronAPI.getHistory();
      return (result.success && result.data) ? result.data : [];
    } catch {
      return [];
    }
  }

  async function deleteHistoryItem(id) {
    try {
      await window.electronAPI.deleteHistory(id);
    } catch (error) {
      console.error('[RENDERER] Failed to delete history item:', error);
    }
  }

  async function clearAllHistory() {
    try {
      await window.electronAPI.clearHistory();
    } catch (error) {
      console.error('[RENDERER] Failed to clear history:', error);
    }
  }

  // ── Render History Page ──────────────────────────────────────

  async function renderHistoryPage() {
    const history = await loadHistory();
    DOM.historyCount.textContent = `${history.length} riwayat tersimpan`;

    if (history.length === 0) {
      DOM.historyList.innerHTML = '';
      DOM.historyEmptyState.classList.remove('hidden');
      DOM.clearHistoryBtn.classList.add('hidden');
      return;
    }

    DOM.historyEmptyState.classList.add('hidden');
    DOM.clearHistoryBtn.classList.remove('hidden');

    DOM.historyList.innerHTML = history.map((entry) => {
      const date = new Date(entry.timestamp);
      const dateStr = date.toLocaleDateString('id-ID', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });

      const keyword = entry.keyword
        ? `"${escapeHtml(entry.keyword)}"`
        : 'Tanpa keyword tambahan';

      const dateRange = (entry.dateFrom || entry.dateTo)
        ? ` · ${entry.dateFrom || '...'} s/d ${entry.dateTo || '...'}`
        : '';

      // Build articles detail table
      const articlesHtml = entry.articles.map((a, i) => {
        const status = a.hasText
          ? '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">OK</span>'
          : '<span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">Gagal</span>';
        const summary = (entry.snippets && entry.snippets[a.index]) || '—';

        return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 font-mono">${i + 1}</td>
            <td class="px-3 py-2">
              <a href="${escapeHtml(a.link)}" target="_blank" rel="noopener noreferrer"
                 class="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline line-clamp-2">
                ${escapeHtml(a.title)}
              </a>
            </td>
            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-400">${escapeHtml(a.source)}</td>
            <td class="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">${escapeHtml(a.date)}</td>
            <td class="px-3 py-2">${status}</td>
            <td class="px-3 py-2 text-xs text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-2">${escapeHtml(summary)}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 shadow-sm rounded-xl overflow-hidden animate-fade-in">
          <!-- Card Header -->
          <div class="flex items-center justify-between px-4 py-3.5">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <svg class="w-3.5 h-3.5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
                <p class="text-sm font-medium text-slate-800 dark:text-white">${dateStr}</p>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 ml-[22px]">
                ${keyword}${dateRange} ·
                <span class="text-slate-600 dark:text-slate-500">${entry.articleCount} artikel</span> ·
                <span class="text-emerald-600 dark:text-emerald-500/80">${entry.successCount} berhasil</span>
              </p>
            </div>
            <div class="flex items-center gap-1.5 ml-4 flex-shrink-0">
              <button data-action="toggle-detail" data-id="${entry.id}"
                class="px-3 py-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 bg-blue-50 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/15 border border-blue-200 dark:border-blue-500/20 rounded-lg transition-all">
                Detail
              </button>
              <button data-action="delete-item" data-id="${entry.id}"
                class="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all" title="Hapus">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Expandable Detail Table -->
          <div id="detail-${entry.id}" class="hidden border-t border-slate-200 dark:border-slate-800">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800/40">
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase w-8">#</th>
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase min-w-[180px]">Judul</th>
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase w-24">Sumber</th>
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase w-32">Tanggal</th>
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase w-14">Status</th>
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase min-w-[180px]">Cuplikan Teks</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-800/40">
                  ${articlesHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── History Event Delegation ──────────────────────────────────

  DOM.historyList.addEventListener('click', async (e) => {
    const toggleBtn = e.target.closest('[data-action="toggle-detail"]');
    const deleteBtn = e.target.closest('[data-action="delete-item"]');

    if (toggleBtn) {
      const id = toggleBtn.dataset.id;
      const detail = document.getElementById(`detail-${id}`);
      if (detail) {
        const isHidden = detail.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? 'Detail' : 'Tutup';
      }
    }

    if (deleteBtn) {
      const id = deleteBtn.dataset.id;
      await deleteHistoryItem(id);
      await renderHistoryPage();
    }
  });

  if (DOM.clearHistoryBtn) {
    DOM.clearHistoryBtn.addEventListener('click', async () => {
      if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat pencarian? Tindakan ini tidak dapat dibatalkan.')) {
        await clearAllHistory();
        await renderHistoryPage();
      }
    });
  }

  // ── UI Helpers ───────────────────────────────────────────────

  function setCrawlButtonLoading(loading) {
    DOM.crawlBtn.disabled = loading;
    DOM.crawlBtnIcon.classList.toggle('hidden', loading);
    DOM.crawlBtnSpinner.classList.toggle('hidden', !loading);
    DOM.crawlBtnText.textContent = loading ? 'Crawling...' : 'Mulai Crawling';
  }

  function showError(message) {
    DOM.errorSection.classList.remove('hidden');
    DOM.errorMessage.textContent = message;
    DOM.progressSection.classList.add('hidden');
  }

  function hideError() {
    DOM.errorSection.classList.add('hidden');
    DOM.errorMessage.textContent = '';
  }

  // ── Utility Functions ────────────────────────────────────────

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function csvEscape(value) {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    // Wrap in double quotes and escape internal double quotes
    return '"' + str.replace(/"/g, '""') + '"';
  }

  function getDateStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  }

  // ── Boot ─────────────────────────────────────────────────────

  console.log('[RENDERER] Renderer process loaded');

  // Async boot: load settings from database, then initialize worker
  async function loadAppInfo() {
    try {
      const info = await window.electronAPI.getAppInfo();
      if (info) {
        if (DOM.aboutVersion) DOM.aboutVersion.textContent = `v${info.version}`;
        if (DOM.aboutElectron) DOM.aboutElectron.textContent = `Electron v${info.electronVersion}`;
        if (DOM.aboutDbPath) DOM.aboutDbPath.textContent = info.dbPath;
      }
    } catch (e) {
      console.error('[RENDERER] Failed to load app info:', e);
    }
  }

  (async () => {
    await loadSettings();
    await renderHistoryPage();
    await loadAppInfo();
  })();

})();
