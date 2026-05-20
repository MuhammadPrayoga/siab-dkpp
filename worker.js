// ============================================================
// SIAB DKPP - Web Worker (worker.js)
// AI Summarization using @xenova/transformers (Transformers.js)
// Runs in a separate Web Worker thread to keep UI responsive
// ============================================================

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Configure Transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';
env.backends.onnx.wasm.numThreads = 1;

let summarizer = null;
let isLoading = false;
let currentModelName = null;

// ── Model Initialization ─────────────────────────────────────

async function initModel(modelName = 'Xenova/distilbart-cnn-12-6') {
  if (summarizer && currentModelName === modelName) return summarizer;

  if (isLoading) {
    // Another call is already loading the model; wait
    while (isLoading && !summarizer) {
      await new Promise(r => setTimeout(r, 200));
    }
    // If the model name changed during load, we should technically wait and reload, 
    // but for simplicity, we return the loaded one.
    return summarizer;
  }

  isLoading = true;

  try {
    self.postMessage({
      type: 'status',
      message: `Memuat model AI (${modelName})... Pengunduhan pertama membutuhkan beberapa menit.`
    });

    summarizer = await pipeline('summarization', modelName, {
      progress_callback: (data) => {
        if (data.status === 'progress' && data.progress !== undefined) {
          self.postMessage({
            type: 'model-progress',
            message: `Mengunduh: ${data.file || 'model'} (${Math.round(data.progress)}%)`,
            progress: data.progress / 100
          });
        } else if (data.status === 'ready') {
          self.postMessage({
            type: 'status',
            message: 'Model AI siap digunakan!'
          });
        }
      }
    });

    console.log(`[WORKER] Summarization model ${modelName} loaded successfully`);
    currentModelName = modelName;

    self.postMessage({
      type: 'model-ready',
      message: 'Model AI berhasil dimuat dan siap merangkum!'
    });

    return summarizer;

  } catch (error) {
    console.error('[WORKER] Failed to load model:', error);

    self.postMessage({
      type: 'model-error',
      message: `Gagal memuat model AI: ${error.message}. Pastikan koneksi internet stabil.`
    });

    isLoading = false;
    throw error;
  } finally {
    isLoading = false;
  }
}

// ── Message Handler ──────────────────────────────────────────

self.onmessage = async function (e) {
  const { type, text, index, model, summaryLength } = e.data;

  if (type === 'summarize') {
    console.log(`[WORKER] Received summarization request for article ${index}`);

    try {
      const activeModel = await initModel(model);

      if (!activeModel) {
        self.postMessage({
          type: 'error',
          index,
          message: 'Model AI belum tersedia.'
        });
        return;
      }

      // Truncate text to avoid exceeding model's token limit
      // distilbart-cnn-12-6 has a max input of ~1024 tokens (~4000 chars)
      const MAX_INPUT_CHARS = 3500;
      let inputText = text;
      if (inputText.length > MAX_INPUT_CHARS) {
        inputText = inputText.substring(0, MAX_INPUT_CHARS);
        console.log(`[WORKER] Truncated article ${index} to ${MAX_INPUT_CHARS} chars`);
      }

      // Skip very short texts
      if (inputText.length < 50) {
        self.postMessage({
          type: 'result',
          index,
          summary: '[Teks terlalu pendek untuk dirangkum]'
        });
        return;
      }

      self.postMessage({
        type: 'summarizing',
        index,
        message: `Merangkum artikel ${index + 1}...`
      });

      let maxTokens = 150;
      let minLen = 25;
      if (summaryLength === 'short') { maxTokens = 60; minLen = 15; }
      else if (summaryLength === 'long') { maxTokens = 250; minLen = 50; }

      const result = await activeModel(inputText, {
        max_new_tokens: maxTokens,
        min_length: minLen,
        do_sample: false
      });

      const summary = result[0]?.summary_text || '[Tidak ada rangkuman]';
      console.log(`[WORKER] Article ${index} summarized: ${summary.substring(0, 80)}...`);

      self.postMessage({
        type: 'result',
        index,
        summary: summary
      });

    } catch (error) {
      console.error(`[WORKER] Summarization error for article ${index}:`, error);

      self.postMessage({
        type: 'error',
        index,
        message: `Gagal merangkum: ${error.message}`
      });
    }
  }

  if (type === 'preload-model') {
    // Allow renderer to trigger model loading before articles arrive
    try {
      await initModel(model);
    } catch (error) {
      console.error('[WORKER] Preload model error:', error);
    }
  }
};

console.log('[WORKER] Web Worker initialized and ready');
