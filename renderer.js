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
  let summaries = {};
  let worker = null;
  let isCrawling = false;
  let progressCleanup = null;
  let pendingSummaries = 0;
  let currentHistoryId = null;

  // Default settings
  let settings = {
    maxResults: 50,
    aiModel: 'Xenova/distilbart-cnn-12-6',
    summaryLength: 'medium',
    theme: 'light'
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
    aiStatusBadge: document.getElementById('ai-status-badge'),
    aiStatusDot: document.getElementById('ai-status-dot'),
    aiStatusText: document.getElementById('ai-status-text'),

    // History page
    historyList: document.getElementById('history-list'),
    historyCount: document.getElementById('history-count'),
    historyEmptyState: document.getElementById('history-empty-state'),
    clearHistoryBtn: document.getElementById('clear-history-btn'),

    // Settings page
    settingMaxResults: document.getElementById('setting-max-results'),
    settingAiModel: document.getElementById('setting-ai-model'),
    settingSummaryLength: document.getElementById('setting-summary-length'),
    settingTheme: document.getElementById('setting-theme'),
    btnClearCache: document.getElementById('btn-clear-cache'),
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

  function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        settings = { ...settings, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.error('[RENDERER] Load settings error:', e);
    }
    
    // Update DOM inputs to match loaded settings
    if (DOM.settingMaxResults) DOM.settingMaxResults.value = settings.maxResults;
    if (DOM.settingAiModel) DOM.settingAiModel.value = settings.aiModel;
    if (DOM.settingSummaryLength) DOM.settingSummaryLength.value = settings.summaryLength;
    if (DOM.settingTheme) DOM.settingTheme.value = settings.theme;
    
    applyTheme();
  }

  function saveSettings() {
    settings = {
      maxResults: parseInt(DOM.settingMaxResults.value, 10),
      aiModel: DOM.settingAiModel.value,
      summaryLength: DOM.settingSummaryLength.value,
      theme: DOM.settingTheme.value,
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    applyTheme();

    // Trigger worker to preload new model
    if (worker) {
      worker.postMessage({ type: 'preload-model', model: settings.aiModel });
    }
  }

  function applyTheme() {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  // Attach change listeners to settings inputs
  [DOM.settingMaxResults, DOM.settingAiModel, DOM.settingSummaryLength, DOM.settingTheme].forEach(el => {
    if (el) el.addEventListener('change', saveSettings);
  });

  if (DOM.btnClearCache) {
    DOM.btnClearCache.addEventListener('click', () => {
      if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat dan cache? Tindakan ini tidak dapat dibatalkan.')) {
        clearAllHistory();
        renderHistoryPage();
        alert('Data riwayat dan cache berhasil dibersihkan.');
      }
    });
  }

  // ── Initialize Web Worker ────────────────────────────────────

  async function initWorker() {
    try {
      // Electron serves pages via file:// protocol, which blocks ES module workers.
      // Workaround: fetch worker.js as text, wrap in a Blob URL, load as module worker.
      const response = await fetch('worker.js');
      const code = await response.text();
      const blob = new Blob([code], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      worker = new Worker(blobUrl, { type: 'module' });

      worker.onmessage = (e) => {
        const data = e.data;
        console.log('[RENDERER] Worker message:', data.type, data.message || '');

        switch (data.type) {
          case 'status':
            updateModelStatus(data.message, 'loading');
            break;

          case 'model-progress':
            updateModelProgress(data.message, data.progress);
            break;

          case 'model-ready':
            updateModelStatus(data.message, 'ready');
            setTimeout(() => {
              DOM.modelSection.classList.add('hidden');
            }, 2000);
            break;

          case 'model-error':
            updateModelStatus(data.message, 'error');
            break;

          case 'summarizing':
            updateCellSummary(data.index, '⏳ Merangkum...', 'loading');
            break;

          case 'result':
            summaries[data.index] = data.summary;
            updateCellSummary(data.index, data.summary, 'done');
            pendingSummaries--;
            if (pendingSummaries <= 0) {
              onAllSummariesComplete();
            }
            break;

          case 'error':
            updateCellSummary(data.index, `⚠️ ${data.message}`, 'error');
            pendingSummaries--;
            if (pendingSummaries <= 0) {
              onAllSummariesComplete();
            }
            break;
        }
      };

      worker.onerror = (error) => {
        console.error('[RENDERER] Worker fatal error:', error);
        updateModelStatus(`Worker error: ${error.message}`, 'error');
      };

      console.log('[RENDERER] Web Worker initialized');
      
      // Tell worker to preload the currently selected model
      worker.postMessage({ type: 'preload-model', model: settings.aiModel });

    } catch (error) {
      console.error('[RENDERER] Failed to create Worker:', error);
      updateModelStatus(
        `Gagal menginisialisasi AI Worker: ${error.message}. Fitur rangkuman tidak tersedia.`,
        'error'
      );
    }
  }

  // ── Model Status Helpers ─────────────────────────────────────

  function updateModelStatus(message, state) {
    DOM.modelSection.classList.remove('hidden');
    DOM.modelStatusMessage.textContent = message;

    // Update header badge
    DOM.aiStatusBadge.classList.remove('hidden');
    DOM.aiStatusBadge.classList.add('flex');

    if (state === 'ready') {
      DOM.aiStatusDot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      DOM.aiStatusText.textContent = 'AI Siap';
      DOM.aiStatusText.className = 'text-emerald-400 dark:text-emerald-300';
    } else if (state === 'loading') {
      DOM.aiStatusDot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
      DOM.aiStatusText.textContent = 'Memuat AI...';
      DOM.aiStatusText.className = 'text-amber-500 dark:text-amber-400';
    } else if (state === 'error') {
      DOM.aiStatusDot.className = 'w-2 h-2 rounded-full bg-red-400';
      DOM.aiStatusText.textContent = 'AI Error';
      DOM.aiStatusText.className = 'text-red-500 dark:text-red-400';
    }
  }

  function updateModelProgress(message, progress) {
    DOM.modelSection.classList.remove('hidden');
    DOM.modelStatusMessage.textContent = message;
    DOM.modelProgressBar.style.width = `${Math.round(progress * 100)}%`;
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

  // ── All Summaries Complete Handler ───────────────────────────

  function onAllSummariesComplete() {
    console.log('[RENDERER] All summaries complete');
    if (currentHistoryId) {
      updateHistorySummaries(currentHistoryId, summaries);
    }
  }

  // ── Crawl Progress Handler ───────────────────────────────────

  function setupProgressListener() {
    if (progressCleanup) progressCleanup();

    progressCleanup = window.electronAPI.onCrawlProgress((data) => {
      DOM.progressSection.classList.remove('hidden');
      DOM.progressMessage.textContent = data.message;

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
    summaries = {};
    currentHistoryId = null;
    pendingSummaries = 0;

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
      maxResults: settings.maxResults
    };

    console.log('[RENDERER] Starting crawl with params:', params);

    try {
      const result = await window.electronAPI.startCrawl(params);

      console.log('[RENDERER] Crawl result:', result.success, result.articles?.length, 'articles');

      if (result.success) {
        articles = result.articles || [];

        if (articles.length === 0) {
          DOM.emptyState.classList.remove('hidden');
          DOM.progressSection.classList.add('hidden');
          showError(result.message || 'Tidak ada berita ditemukan untuk query ini.');
          return;
        }

        // Render table
        renderTable(articles);

        // Save to history (initial, without summaries)
        currentHistoryId = saveToHistory(params, articles);

        // Start AI summarization
        startSummarization(articles);

        // Update progress
        DOM.progressMessage.textContent = `✅ ${articles.length} artikel berhasil di-crawl. Memulai analisis AI...`;
        DOM.progressBar.style.width = '100%';

        // Hide progress after delay
        setTimeout(() => {
          DOM.progressSection.classList.add('hidden');
        }, 3000);

      } else {
        showError(result.error || 'Terjadi kesalahan yang tidak diketahui.');
      }

    } catch (error) {
      console.error('[RENDERER] Crawl error:', error);
      showError(`Koneksi ke main process gagal: ${error.message}`);
    } finally {
      isCrawling = false;
      setCrawlButtonLoading(false);
    }
  });

  // ── Render Results Table ─────────────────────────────────────

  function renderTable(articleList) {
    DOM.resultsSection.classList.remove('hidden');
    DOM.emptyState.classList.add('hidden');
    DOM.articleCount.textContent = `${articleList.length} artikel`;

    const tbody = DOM.resultsTableBody;
    tbody.innerHTML = '';

    articleList.forEach((article, i) => {
      const row = document.createElement('tr');
      row.className = `table-row-hover ${i % 2 === 0 ? 'bg-slate-50 dark:bg-slate-800/40' : 'bg-white dark:bg-slate-900/40'} animate-fade-in`;
      row.style.animationDelay = `${i * 0.04}s`;

      const statusBadge = article.hasText
        ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-500/20">OK</span>'
        : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-500/20">Gagal</span>';

      row.innerHTML = `
        <td class="px-4 py-3 text-xs text-slate-600 dark:text-slate-400 font-mono">${i + 1}</td>
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
            ${article.hasText ? '⏳ Menunggu rangkuman...' : '—'}
          </div>
        </td>
      `;

      tbody.appendChild(row);
    });
  }

  // ── Start AI Summarization ───────────────────────────────────

  function startSummarization(articleList) {
    if (!worker) {
      console.warn('[RENDERER] Worker not available, skipping summarization');
      articleList.forEach((a) => {
        updateCellSummary(a.index, '⚠️ AI Worker tidak tersedia', 'error');
      });
      return;
    }

    // Show model section
    DOM.modelSection.classList.remove('hidden');

    // Queue articles for summarization
    const articlesWithText = articleList.filter(a => a.hasText);
    pendingSummaries = articlesWithText.length;
    console.log(`[RENDERER] Queueing ${articlesWithText.length} articles for summarization`);

    if (articlesWithText.length === 0) return;

    articlesWithText.forEach((article) => {
      worker.postMessage({
        type: 'summarize',
        text: article.cleanText,
        index: article.index,
        model: settings.aiModel,
        summaryLength: settings.summaryLength
      });
    });
  }

  // ── CSV Download ─────────────────────────────────────────────

  DOM.downloadCsvBtn.addEventListener('click', () => {
    if (articles.length === 0) {
      console.warn('[RENDERER] No articles to download');
      return;
    }

    console.log('[RENDERER] Generating CSV...');

    // BOM for UTF-8 support in Excel
    const BOM = '\uFEFF';

    // CSV Header
    const headers = ['No', 'Judul', 'Sumber', 'Link', 'Tanggal', 'Status Ekstraksi', 'Teks Bersih', 'Rangkuman AI'];

    // CSV Rows
    const rows = articles.map((article, i) => {
      const summary = summaries[article.index] || '';
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
    link.download = `siab-dkpp_${getDateStamp()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    console.log('[RENDERER] CSV downloaded');
  });

  // ══════════════════════════════════════════════════════════════
  // HISTORY FUNCTIONS
  // ══════════════════════════════════════════════════════════════

  function saveToHistory(params, articleList) {
    try {
      const history = loadHistory();
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
          // NOTE: cleanText is NOT stored (too large for localStorage)
        })),
        summaries: {},
      };

      history.unshift(entry);
      if (history.length > MAX_HISTORY) history.pop();

      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      console.log('[RENDERER] History saved:', id);
      return id;

    } catch (error) {
      console.error('[RENDERER] Failed to save history:', error);
      return null;
    }
  }

  function updateHistorySummaries(historyId, summariesData) {
    try {
      const history = loadHistory();
      const entry = history.find(h => h.id === historyId);
      if (entry) {
        entry.summaries = { ...summariesData };
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        console.log('[RENDERER] History summaries updated for:', historyId);
      }
    } catch (error) {
      console.error('[RENDERER] Failed to update history summaries:', error);
    }
  }

  function loadHistory() {
    try {
      const data = localStorage.getItem(HISTORY_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  function deleteHistoryItem(id) {
    try {
      let history = loadHistory();
      history = history.filter(h => h.id !== id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
      console.error('[RENDERER] Failed to delete history item:', error);
    }
  }

  function clearAllHistory() {
    localStorage.removeItem(HISTORY_KEY);
  }

  // ── Render History Page ──────────────────────────────────────

  function renderHistoryPage() {
    const history = loadHistory();
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
        const summary = (entry.summaries && entry.summaries[a.index]) || '—';

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
                    <th class="px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase min-w-[180px]">Rangkuman AI</th>
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

  DOM.historyList.addEventListener('click', (e) => {
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
      deleteHistoryItem(id);
      renderHistoryPage();
    }
  });

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
  loadSettings(); // Apply initial settings and theme
  initWorker();

})();
