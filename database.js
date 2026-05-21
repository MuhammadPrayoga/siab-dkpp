// ============================================================
// SIAB DKPP - Database Module (database.js)
// Persistent file-based storage using Lowdb
// Stores history, settings, and article data on disk
// ============================================================

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Lowdb v1 (CommonJS compatible)
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

let db = null;

// ── Initialize Database ──────────────────────────────────────

function initDatabase() {
  // Store database in the app's user data directory
  // Windows: %APPDATA%/siab-dkpp/
  const dbDir = path.join(app.getPath('userData'));
  
  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'database.json');
  console.log(`[DB] Database path: ${dbPath}`);

  const adapter = new FileSync(dbPath);
  db = low(adapter);

  // Set default structure
  db.defaults({
    history: [],
    settings: {
      maxResults: 50,
      theme: 'light',
      timeout: 25000,
      requestDelay: 800,
      maxHistory: 100,
      trustedMediaOnly: false,
      defaultKeywords: 'DKPP RI, DEWAN KEHORMATAN PENYELENGGARA PEMILU'
    }
  }).write();

  console.log(`[DB] Database initialized at: ${dbPath}`);
  return db;
}

// ── History Operations ───────────────────────────────────────

function getHistory() {
  if (!db) throw new Error('Database not initialized');
  return db.get('history').value();
}

function addHistoryEntry(entry) {
  if (!db) throw new Error('Database not initialized');
  const currentSettings = db.get('settings').value();
  const MAX_HISTORY = (currentSettings && currentSettings.maxHistory) || 100;

  // Add to the beginning (newest first)
  const history = db.get('history');
  history.unshift(entry).write();

  // Trim oldest entries if exceeding max
  const current = history.value();
  if (current.length > MAX_HISTORY) {
    db.set('history', current.slice(0, MAX_HISTORY)).write();
  }

  console.log(`[DB] History entry added: ${entry.id}`);
  return entry.id;
}

function updateHistorySnippets(historyId, snippetsData) {
  if (!db) throw new Error('Database not initialized');

  const entry = db.get('history').find({ id: historyId }).value();
  if (entry) {
    db.get('history')
      .find({ id: historyId })
      .assign({ snippets: { ...snippetsData } })
      .write();
    console.log(`[DB] Snippets updated for history: ${historyId}`);
    return true;
  }
  return false;
}

function deleteHistoryEntry(historyId) {
  if (!db) throw new Error('Database not initialized');

  db.get('history')
    .remove({ id: historyId })
    .write();
  console.log(`[DB] History entry deleted: ${historyId}`);
}

function clearAllHistory() {
  if (!db) throw new Error('Database not initialized');

  db.set('history', []).write();
  console.log('[DB] All history cleared');
}

// ── Settings Operations ──────────────────────────────────────

function getSettings() {
  if (!db) throw new Error('Database not initialized');
  return db.get('settings').value();
}

function saveSettings(data) {
  if (!db) throw new Error('Database not initialized');

  const current = db.get('settings').value();
  const merged = { ...current, ...data };
  db.set('settings', merged).write();
  console.log('[DB] Settings saved');
  return merged;
}

// ── Migration: Import from localStorage data ─────────────────

function importFromLocalStorage(historyData, settingsData) {
  if (!db) throw new Error('Database not initialized');

  // Import history if provided and current database is empty
  if (historyData && Array.isArray(historyData)) {
    const currentHistory = db.get('history').value();
    if (currentHistory.length === 0 && historyData.length > 0) {
      db.set('history', historyData).write();
      console.log(`[DB] Migrated ${historyData.length} history entries from localStorage`);
    }
  }

  // Import settings if provided
  if (settingsData && typeof settingsData === 'object') {
    const current = db.get('settings').value();
    const merged = { ...current, ...settingsData };
    db.set('settings', merged).write();
    console.log('[DB] Migrated settings from localStorage');
  }
}

// ── Exports ──────────────────────────────────────────────────

module.exports = {
  initDatabase,
  getHistory,
  addHistoryEntry,
  updateHistorySnippets,
  deleteHistoryEntry,
  clearAllHistory,
  getSettings,
  saveSettings,
  importFromLocalStorage
};
