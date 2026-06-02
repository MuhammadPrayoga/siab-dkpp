# 📖 Dokumentasi Teknis — SIAB DKPP

**Sistem Informasi Agregator Berita — Dewan Kehormatan Penyelenggara Pemilu RI**

> Versi: 1.0.0 | Terakhir diperbarui: 2 Juni 2026

---

## Daftar Isi

1. [Ringkasan Proyek](#1-ringkasan-proyek)
2. [Arsitektur Sistem](#2-arsitektur-sistem)
3. [Struktur Direktori](#3-struktur-direktori)
4. [Modul & Penjelasan File](#4-modul--penjelasan-file)
5. [Alur Kerja Crawling (Data Flow)](#5-alur-kerja-crawling-data-flow)
6. [Sistem Keamanan & Anti-Deteksi](#6-sistem-keamanan--anti-deteksi)
7. [Algoritma Rangkuman (Extractive Summarization)](#7-algoritma-rangkuman-extractive-summarization)
8. [Database & Penyimpanan](#8-database--penyimpanan)
9. [Konfigurasi & Pengaturan](#9-konfigurasi--pengaturan)
10. [IPC API Reference](#10-ipc-api-reference)
11. [Dependensi](#11-dependensi)
12. [Panduan Pengembang](#12-panduan-pengembang)
13. [Troubleshooting](#13-troubleshooting)
14. [Catatan Rilis](#14-catatan-rilis)

---

## 1. Ringkasan Proyek

SIAB DKPP adalah aplikasi desktop berbasis **Electron** yang dirancang khusus untuk Dewan Kehormatan Penyelenggara Pemilu (DKPP) Republik Indonesia. Aplikasi ini berfungsi sebagai alat pemantauan media (*media monitoring tool*) yang mampu:

- **Mengambil berita otomatis** dari Google News Indonesia melalui RSS Feed.
- **Mengekstrak teks bersih** dari halaman artikel berita menggunakan teknik *stealth crawling*.
- **Merangkum berita secara algoritmik** menggunakan metode *Extractive Summarization* berbasis *Term Frequency* dengan dukungan 300+ *stopwords* Bahasa Indonesia.
- **Menyimpan riwayat** secara persisten di disk lokal pengguna.
- **Mengekspor data** ke format CSV yang kompatibel dengan Microsoft Excel.

Seluruh proses berjalan **100% lokal** — tanpa API key, tanpa biaya server cloud, dan tanpa pengiriman data ke pihak ketiga.

---

## 2. Arsitektur Sistem

SIAB DKPP menggunakan arsitektur multi-proses bawaan Electron:

```
┌─────────────────────────────────────────────────────────────────┐
│                        ELECTRON APP                             │
│                                                                 │
│  ┌──────────────┐    IPC Bridge     ┌─────────────────────────┐ │
│  │ Main Process │◄────────────────►│   Renderer Process       │ │
│  │  (main.js)   │   (preload.js)    │   (renderer.js)          │ │
│  │              │                   │                           │ │
│  │ • RSS Fetch  │                   │ • Antarmuka Pengguna (UI) │ │
│  │ • Crawling   │                   │ • Tabel Hasil             │ │
│  │ • Extraction │                   │ • Ekspor CSV              │ │
│  │ • Summary    │                   │ • Riwayat Pencarian       │ │
│  │ • Database   │                   │ • Pengaturan              │ │
│  └──────┬───────┘                   └─────────────────────────┘ │
│         │                                                       │
│  ┌──────▼───────┐    ┌──────────────────┐                       │
│  │ database.js  │    │ Puppeteer Chrome  │                       │
│  │ (Lowdb JSON) │    │ (Stealth Plugin)  │                       │
│  └──────────────┘    └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

### Penjelasan Proses

| Proses | File | Tanggung Jawab |
|---|---|---|
| **Main Process** | `main.js` | Logika inti: RSS fetching, crawling berita, ekstraksi teks, rangkuman, manajemen database, dan komunikasi IPC. |
| **Renderer Process** | `renderer.js` | Antarmuka pengguna: menampilkan hasil, mengelola tab, riwayat, pengaturan, dan ekspor CSV. |
| **Preload Script** | `preload.js` | Jembatan aman (secure bridge) antara Renderer dan Main Process melalui `contextBridge`. |
| **Database Module** | `database.js` | Lapisan abstraksi database menggunakan Lowdb untuk penyimpanan persisten berbasis file JSON. |

---

## 3. Struktur Direktori

```
siab-dkpp/
├── public/
│   ├── logo_dkpp.png          # Logo resmi DKPP RI (digunakan sebagai ikon window)
│   ├── icon.ico               # Ikon aplikasi format Windows ICO
│   └── output.css             # File CSS hasil kompilasi Tailwind CSS
├── src/
│   └── input.css              # File input Tailwind CSS (source)
├── index.html                 # Halaman utama aplikasi (UI layout + styling)
├── main.js                    # Electron Main Process (828 baris)
├── preload.js                 # Electron Preload Script (81 baris)
├── renderer.js                # Renderer Process / UI Logic (42.260 bytes)
├── database.js                # Modul Database Lowdb (164 baris)
├── package.json               # Konfigurasi proyek & dependensi
├── tailwind.config.js         # Konfigurasi Tailwind CSS
├── README.md                  # Dokumentasi ringkas proyek
└── DOCUMENTATION.md           # Dokumentasi teknis lengkap (file ini)
```

---

## 4. Modul & Penjelasan File

### 4.1. `main.js` — Main Process

File terbesar dan terpenting dalam proyek. Bertanggung jawab atas seluruh logika backend:

| Bagian | Baris | Fungsi |
|---|---|---|
| **Imports & Setup** | 1–17 | Memuat semua dependensi: Electron, Puppeteer Stealth, RSS Parser, JSDOM, Readability, Lowdb. |
| **BLOCKED_DOMAINS** | 19–52 | Daftar domain yang diblokir (sosmed, situs pemerintah) dan fungsi `isBlockedUrl()` yang memverifikasi hostname secara presisi menggunakan `new URL()`. |
| **User-Agent Rotation** | 54–70 | Pool 8 User-Agent dari browser sungguhan (Chrome, Firefox, Safari, Edge) yang dipilih secara acak untuk setiap request. |
| **Window Creation** | 78–120 | Inisialisasi jendela utama Electron dengan konfigurasi keamanan (`contextIsolation`, `sandbox`). |
| **buildRssUrl()** | 122–164 | Membangun URL RSS Google News dengan query dinamis, filter tanggal (`after:` / `before:`), dan pengecualian situs (`-site:`). |
| **extractArticleUrl()** | 166–182 | Mengekstrak URL asli artikel dari item RSS Google News (yang biasanya dibungkus dalam redirect). |
| **extractViaGotScraping()** | 184–237 | **Fast Path**: Mengambil HTML artikel menggunakan `got-scraping` (HTTP client anti-bot) tanpa membuka browser. Lebih cepat dan hemat memori. |
| **extractArticleText()** | 239–318 | **Fallback Path**: Membuka artikel di hidden Electron window jika fast path gagal (untuk situs dengan proteksi JavaScript berat). |
| **extractWithRetry()** | 320–349 | Logika retry: mencoba fast path → fallback browser → retry hingga `MAX_RETRIES` kali dengan delay bertambah (1.5s, 3s). |
| **Worker Pool** | 351–370 | Fungsi `createHiddenWindow()` dan `destroyHiddenWindows()` untuk mengelola pool browser tersembunyi. |
| **IPC: start-crawl** | 407–537 | Handler utama crawling: parsing RSS → filter tanggal → chunking → ekstraksi paralel → return hasil. |
| **Extractive Summarization** | 552–731 | Algoritma rangkuman dengan 300+ stopwords Bahasa Indonesia dan scoring berbasis Term Frequency. |
| **IPC: Database Ops** | 748–828 | Handler database: get/save/delete history, get/save settings, migrasi dari localStorage. |

### 4.2. `preload.js` — Secure IPC Bridge

Menjembatani komunikasi antara Renderer Process (yang berjalan di sandbox) dengan Main Process. Mengekspos API berikut ke `window.electronAPI`:

| API | Fungsi |
|---|---|
| `startCrawl(params)` | Memulai proses crawling dengan parameter pencarian. |
| `onCrawlProgress(callback)` | Listener untuk update progres crawling secara real-time. |
| `getHistory()` | Mengambil seluruh riwayat pencarian dari database. |
| `saveHistory(entry)` | Menyimpan entri riwayat baru. |
| `updateSnippets(historyId, snippets)` | Memperbarui cuplikan teks untuk entri riwayat tertentu. |
| `deleteHistory(historyId)` | Menghapus satu entri riwayat. |
| `clearHistory()` | Menghapus seluruh riwayat. |
| `getSettings()` | Mengambil pengaturan aplikasi. |
| `saveSettings(data)` | Menyimpan pengaturan aplikasi. |
| `getAppInfo()` | Mendapatkan info aplikasi (versi, path database). |
| `generateSummary(text)` | Menjalankan algoritma rangkuman di main process. |
| `migrateLocalStorage(data)` | Migrasi data dari localStorage ke database persisten (satu kali). |

### 4.3. `database.js` — Persistent Storage

Modul database menggunakan **Lowdb v1** (CommonJS) dengan adapter `FileSync` untuk penyimpanan sinkron berbasis file JSON.

**Lokasi Database**: `%APPDATA%/siab-dkpp/database.json`

**Struktur Default:**
```json
{
  "history": [],
  "settings": {
    "maxResults": 50,
    "theme": "light",
    "timeout": 25000,
    "requestDelay": 800,
    "maxHistory": 100,
    "defaultKeywords": "DKPP RI, DEWAN KEHORMATAN PENYELENGGARA PEMILU",
    "proxyList": "",
    "chunkSize": 20
  }
}
```

**Operasi yang Tersedia:**

| Fungsi | Deskripsi |
|---|---|
| `initDatabase()` | Inisialisasi database, membuat file jika belum ada. |
| `getHistory()` | Mengambil seluruh array riwayat. |
| `addHistoryEntry(entry)` | Menambah entri baru ke awal array (terbaru di atas). Otomatis memotong entri lama jika melebihi `maxHistory`. |
| `updateHistorySnippets(id, data)` | Memperbarui field `snippets` pada entri tertentu. |
| `deleteHistoryEntry(id)` | Menghapus entri berdasarkan ID. |
| `clearAllHistory()` | Mengosongkan seluruh riwayat. |
| `getSettings()` | Mengambil objek pengaturan. |
| `saveSettings(data)` | Menggabungkan (*merge*) pengaturan baru dengan yang lama. |
| `importFromLocalStorage(history, settings)` | Migrasi satu kali dari localStorage browser ke database file. |

### 4.4. `index.html` — Antarmuka Pengguna

File HTML utama yang memuat seluruh layout UI aplikasi. Menggunakan **Tailwind CSS** untuk styling dan **Flatpickr** untuk date picker. Terdiri dari beberapa tab:

| Tab | Fungsi |
|---|---|
| **Pencarian** | Form input kata kunci, pemilih tanggal, tombol mulai crawling, tabel hasil, dan konsol log real-time. |
| **Riwayat** | Daftar riwayat pencarian sebelumnya dengan detail dan opsi hapus. |
| **Pengaturan** | Konfigurasi sistem: maks hasil, timeout, delay, tema, proxy, chunk size, dan kata kunci default. |

### 4.5. `renderer.js` — UI Logic

Logika sisi klien yang menangani:

- Manajemen tab dan navigasi antar halaman.
- Rendering tabel hasil crawling dengan status per artikel.
- Pembuatan file CSV dengan encoding UTF-8 BOM.
- Pengelolaan riwayat pencarian (tampil, hapus, detail).
- Validasi tanggal menggunakan Flatpickr (cross-linking `minDate` / `maxDate`).
- Menampilkan progress bar dan konsol log secara real-time.
- Penerapan tema Terang/Gelap.

---

## 5. Alur Kerja Crawling (Data Flow)

Berikut adalah alur lengkap saat pengguna menekan tombol **"Mulai Crawling"**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  PENGGUNA menekan tombol "Mulai Crawling"                           │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. RENDERER → IPC → MAIN: startCrawl(params)                      │
│     params: { keyword, dateFrom, dateTo, maxResults, timeout,       │
│               requestDelay, defaultKeywords, proxyList, chunkSize } │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. MAIN: buildRssUrl()                                             │
│     • Bangun query: ("DKPP RI" OR "DEWAN KEHORMATAN...")            │
│     • Tambahkan -site:dkpp.go.id -site:bawaslu.go.id dll            │
│     • Tambahkan after:YYYY-MM-DD before:YYYY-MM-DD                  │
│     • Encode → URL RSS Google News Indonesia                        │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. MAIN: Fetch RSS Feed via rss-parser                             │
│     • Timeout: 15 detik                                             │
│     • Parse XML → Array of RSS Items                                │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. MAIN: Filter & Validasi Items                                   │
│     • Cek isBlockedUrl() → tolak domain terblokir                   │
│     • Filter tanggal ketat (dateFrom ≤ pubDate ≤ dateTo)            │
│     • Batasi jumlah sesuai maxResults                               │
│     • Decode URL Google News → URL asli artikel                     │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  5. MAIN: Chunked Extraction (Browser Chunking)                     │
│     ┌───────────────────────────────────────┐                       │
│     │  Untuk setiap chunk (default: 20):    │                       │
│     │  • Luncurkan Chrome + Stealth Plugin  │                       │
│     │  • Rotasi proxy (jika tersedia)       │                       │
│     │  • Untuk setiap artikel dalam chunk:  │                       │
│     │    ├─ Coba got-scraping (Fast Path)   │                       │
│     │    ├─ Jika gagal → Puppeteer browser  │                       │
│     │    ├─ Parse HTML via Readability      │                       │
│     │    └─ Retry hingga MAX_RETRIES kali   │                       │
│     │  • Tutup Chrome (bebaskan RAM)        │                       │
│     └───────────────────────────────────────┘                       │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  6. MAIN → IPC → RENDERER: Return articles[]                       │
│     Setiap artikel berisi:                                          │
│     { title, source, url, date, hasText, cleanText, snippet }       │
└────────────────────────┬────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  7. RENDERER: Tampilkan hasil di tabel                              │
│     • Jalankan generateSummary() untuk setiap artikel               │
│     • Simpan ke riwayat database                                    │
│     • Aktifkan tombol "Export CSV"                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Sistem Keamanan & Anti-Deteksi

SIAB DKPP dilengkapi beberapa lapisan teknik anti-deteksi agar proses crawling tidak diblokir oleh situs berita:

### 6.1. Puppeteer Stealth Plugin

Library `puppeteer-extra-plugin-stealth` secara otomatis menyembunyikan jejak otomasi browser dengan:
- Menghapus properti `navigator.webdriver`.
- Memalsukan plugin browser dan bahasa.
- Mengemulasi interaksi pengguna asli.
- Memanipulasi fingerprint Chrome DevTools Protocol.

### 6.2. User-Agent Rotation

Setiap request menggunakan User-Agent acak dari pool 8 browser sungguhan:
- Chrome 123, 124, 125 (Windows & Mac)
- Firefox 128 (Windows & Linux)
- Safari 17.5 (Mac)
- Edge 123 (Windows)

### 6.3. Domain Filtering (Blocked Domains)

Fungsi `isBlockedUrl()` menggunakan parsing `new URL()` untuk verifikasi hostname yang aman:

```javascript
// ✅ Benar: Verifikasi via hostname
const hostname = new URL(url).hostname.toLowerCase();
BLOCKED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
```

**Domain yang diblokir:**

| Kategori | Domain |
|---|---|
| **Situs Pemerintah** | `dkpp.go.id`, `bawaslu.go.id`, `kpu.go.id` |
| **Media Sosial** | `instagram.com`, `twitter.com`, `x.com`, `facebook.com`, `tiktok.com` |
| **Video & Streaming** | `youtube.com`, `youtu.be`, `snackvideo.com` |
| **Messaging** | `t.me`, `wa.me`, `whatsapp.com` |
| **Forum & Lainnya** | `linkedin.com`, `threads.net`, `pinterest.com`, `reddit.com`, `kaskus.co.id` |

### 6.4. Google RSS Site Exclusion

Selain filter di sisi aplikasi, query RSS juga menyertakan operator `-site:` untuk mengecualikan domain langsung dari hasil pencarian Google:

```
-site:dkpp.go.id -site:go.id -site:bawaslu.go.id -site:kpu.go.id
```

### 6.5. Resource Blocking

Saat menggunakan Puppeteer, aplikasi memblokir request ke resource berat (gambar, font, media) untuk mempercepat loading halaman dan menghemat bandwidth.

### 6.6. Proxy Rotation

Jika daftar proxy dikonfigurasi, sistem akan merotasi IP proxy untuk setiap chunk browser baru, mencegah pemblokiran IP.

---

## 7. Algoritma Rangkuman (Extractive Summarization)

### Metode

Menggunakan **Extractive Summarization** berbasis **Term Frequency (TF)** — bukan AI generatif. Algoritma ini memilih kalimat-kalimat terpenting dari teks asli tanpa menghasilkan teks baru.

### Langkah-Langkah

1. **Pemecahan Kalimat** — Teks dipecah menggunakan regex `[.!?]` dengan perlindungan terhadap singkatan umum (Dr., Prof., Rp., dll.) dan angka desimal.

2. **Penghitungan Frekuensi Kata** — Setiap kata dihitung frekuensinya, dengan mengabaikan:
   - Kata di bawah 3 karakter.
   - 300+ *stopwords* Bahasa Indonesia (ada, adalah, akan, atas, atau, ...).

3. **Skor Kalimat** — Setiap kalimat diberi skor berdasarkan:
   - Jumlah kata penting yang dikandung (frekuensi tinggi = skor tinggi).
   - Normalisasi berdasarkan panjang kalimat (mencegah bias ke kalimat panjang).
   - *Position boost*: Kalimat di awal mendapat bonus karena biasanya berisi intro/lead.

4. **Seleksi Top-2** — Dua kalimat dengan skor tertinggi dipilih, lalu diurutkan kembali sesuai posisi aslinya dalam teks.

5. **Pembatasan** — Hasil ringkasan dibatasi maksimal **500 karakter**.

### Keunggulan
- **Cepat**: Berjalan dalam hitungan milidetik, tanpa model AI.
- **Offline**: Tidak memerlukan koneksi internet atau GPU.
- **Akurat**: Menggunakan kalimat asli dari artikel, bukan teks buatan.

---

## 8. Database & Penyimpanan

### Lokasi File

```
Windows: %APPDATA%/siab-dkpp/database.json
```

### Skema History Entry

```json
{
  "id": "uuid-string",
  "timestamp": "2026-06-02T08:00:00Z",
  "keyword": "korupsi",
  "dateFrom": "2026-05-01",
  "dateTo": "2026-05-31",
  "totalArticles": 25,
  "successCount": 20,
  "articles": [
    {
      "title": "Judul Artikel",
      "source": "Kompas.com",
      "url": "https://...",
      "date": "2 Juni 2026, 08:00",
      "hasText": true,
      "snippet": "Cuplikan teks 200 karakter pertama..."
    }
  ],
  "snippets": {
    "summaries": ["Rangkuman kalimat 1.", "Rangkuman kalimat 2."]
  }
}
```

### Batas Riwayat

Jumlah entri riwayat dibatasi sesuai pengaturan `maxHistory`. Jika melebihi batas, entri terlama otomatis dihapus. Opsi yang tersedia: **25 / 50 / 100 / 200** entri.

---

## 9. Konfigurasi & Pengaturan

Semua pengaturan disimpan di database dan dapat diubah melalui tab **Pengaturan** di antarmuka.

| Parameter | Default | Opsi | Penjelasan |
|---|---|---|---|
| **Maks. Hasil** | `50` | 10 / 25 / 50 / 100 | Jumlah maksimum artikel yang dicari per sesi crawling. |
| **Timeout** | `25000` ms | 15s / 25s / 40s / 60s | Batas waktu menunggu per artikel sebelum dianggap gagal. Semakin tinggi = semakin sabar menunggu situs lambat, tapi crawling lebih lama secara keseluruhan. |
| **Request Delay** | `800` ms | 500ms / 800ms / 1.5s / 3s | Jeda antar permintaan ke situs berita. Semakin tinggi = lebih aman dari pemblokiran, tapi crawling lebih lambat. |
| **Maks. Riwayat** | `100` | 25 / 50 / 100 / 200 | Jumlah entri riwayat yang disimpan di database. |
| **Tema** | `light` | Terang / Gelap | Tampilan antarmuka pengguna. |
| **Kata Kunci Default** | `DKPP RI, DEWAN KEHORMATAN PENYELENGGARA PEMILU` | Teks bebas | Kata kunci yang selalu disertakan di setiap pencarian. Dipisahkan koma, digabungkan dengan operator OR. |
| **Daftar Proxy** | *(kosong)* | Teks multi-baris | Daftar alamat proxy HTTP/SOCKS5 (satu per baris). Sistem akan merotasi proxy per chunk. Format: `http://ip:port` atau `socks5://ip:port`. |
| **Chunk Size** | `20` | Angka | Jumlah artikel per chunk. Chrome akan di-restart setiap kelipatan angka ini untuk mencegah kebocoran memori. |

### Rekomendasi Konfigurasi

| Skenario | Timeout | Delay | Chunk |
|---|---|---|---|
| **Crawling ringan** (10–25 artikel, internet cepat) | 15s | 500ms | 20 |
| **Crawling standar** (50 artikel, penggunaan harian) | 25s | 800ms | 20 |
| **Crawling berat** (100 artikel, tanpa proxy) | 30s | 1.5s–3s | 15 |
| **Crawling dengan proxy** (100 artikel) | 30s | 800ms | 20 |

---

## 10. IPC API Reference

Komunikasi antara Renderer Process dan Main Process menggunakan Electron IPC melalui `preload.js`.

### Crawling

| Channel | Arah | Parameter | Return |
|---|---|---|---|
| `start-crawl` | Renderer → Main | `{ keyword, dateFrom, dateTo, maxResults, timeout, requestDelay, defaultKeywords, proxyList, chunkSize }` | `{ success, articles[], message?, error? }` |
| `crawl-progress` | Main → Renderer | — | `{ status, message, current, total }` |

**Status progres yang mungkin:**
- `fetching-rss` — Sedang mengambil feed RSS.
- `extracting` — Sedang mengekstrak artikel.
- `done` — Selesai.

### Database — History

| Channel | Arah | Parameter | Return |
|---|---|---|---|
| `db-get-history` | Renderer → Main | — | `{ success, data: historyEntry[] }` |
| `db-save-history` | Renderer → Main | `entry` | `{ success, id }` |
| `db-update-snippets` | Renderer → Main | `{ historyId, snippets }` | `{ success }` |
| `db-delete-history` | Renderer → Main | `historyId` | `{ success }` |
| `db-clear-history` | Renderer → Main | — | `{ success }` |

### Database — Settings

| Channel | Arah | Parameter | Return |
|---|---|---|---|
| `db-get-settings` | Renderer → Main | — | `{ success, data: settingsObj }` |
| `db-save-settings` | Renderer → Main | `settingsData` | `{ success, data: mergedSettings }` |

### Lainnya

| Channel | Arah | Parameter | Return |
|---|---|---|---|
| `get-app-info` | Renderer → Main | — | `{ version, electronVersion, dbPath }` |
| `generate-summary` | Renderer → Main | `text` (string) | `summary` (string) |
| `db-migrate-localstorage` | Renderer → Main | `{ history, settings }` | `{ success }` |

---

## 11. Dependensi

### Dependencies (Production)

| Package | Versi | Fungsi |
|---|---|---|
| `@mozilla/readability` | ^0.5.0 | Mengekstrak konten utama artikel dari HTML (menghapus iklan, navigasi, dsb). |
| `flatpickr` | ^4.6.13 | Komponen date picker yang elegan untuk pemilihan rentang tanggal. |
| `google-news-decoder` | ^1.0.1 | Mendekode URL redirect Google News menjadi URL asli artikel. |
| `jsdom` | ^24.1.0 | Implementasi DOM di Node.js untuk parsing HTML di main process. |
| `lowdb` | ^1.0.0 | Database JSON berbasis file untuk penyimpanan persisten lokal. |
| `puppeteer-core` | ^22.15.0 | Inti Puppeteer untuk mengontrol browser Chrome tanpa bundled Chromium. |
| `puppeteer-extra` | ^3.3.6 | Wrapper Puppeteer yang mendukung plugin (seperti Stealth). |
| `puppeteer-extra-plugin-stealth` | ^2.11.2 | Plugin anti-deteksi yang menyembunyikan jejak otomasi browser. |
| `rss-parser` | ^3.13.0 | Parser RSS/Atom feed untuk membaca Google News RSS. |

### DevDependencies

| Package | Versi | Fungsi |
|---|---|---|
| `electron` | ^30.1.0 | Framework desktop application berbasis Chromium + Node.js. |
| `tailwindcss` | ^3.4.0 | Utility-first CSS framework untuk styling antarmuka. |

---

## 12. Panduan Pengembang

### Prasyarat

- **Node.js** versi 18 atau lebih baru.
- **Google Chrome** terinstal di sistem (digunakan oleh Puppeteer untuk crawling).
- **Git** untuk version control.

### Instalasi

```bash
git clone https://github.com/MuhammadPrayoga/siab-dkpp.git
cd siab-dkpp
npm install
```

### Menjalankan Aplikasi

```bash
# Mode pengembangan (dengan Chrome DevTools terbuka)
npm run dev

# Mode produksi
npm start
```

### Build CSS (Tailwind)

```bash
# Kompilasi sekali
npm run build:css

# Watch mode (otomatis kompilasi saat file berubah)
npm run watch:css
```

### Menambahkan Domain Blokir Baru

1. Buka `main.js`.
2. Tambahkan domain ke array `BLOCKED_DOMAINS` (baris ~20).
3. *(Opsional)* Tambahkan juga ke array `excludedSites` di fungsi `buildRssUrl()` (baris ~139) agar Google RSS juga mengecualikannya.

### Menambahkan Stopword Baru

1. Buka `main.js`.
2. Cari `INDONESIAN_STOPWORDS` (baris ~554).
3. Tambahkan kata baru ke dalam `Set`.

---

## 13. Troubleshooting

### Tidak Ada Berita yang Ditemukan

| Kemungkinan Penyebab | Solusi |
|---|---|
| Rentang tanggal terlalu sempit. | Perlebar rentang tanggal pencarian. |
| Kata kunci terlalu spesifik. | Gunakan kata kunci yang lebih umum. |
| Google News tidak memiliki berita di rentang tersebut. | Coba tanpa filter tanggal untuk memastikan ada berita. |
| Koneksi internet terputus. | Periksa koneksi internet Anda. |

### Semua Artikel Gagal Diekstrak (Status: Gagal)

| Kemungkinan Penyebab | Solusi |
|---|---|
| IP Anda diblokir oleh situs berita. | Tambahkan daftar proxy di Pengaturan. |
| Timeout terlalu rendah. | Naikkan timeout ke 40s atau 60s. |
| Delay terlalu rendah (situs mendeteksi bot). | Naikkan delay ke 1.5s atau 3s. |
| Chrome tidak terinstal di sistem. | Instal Google Chrome. Puppeteer memerlukan Chrome untuk bekerja. |

### Aplikasi Menjadi Lambat / Hang

| Kemungkinan Penyebab | Solusi |
|---|---|
| Terlalu banyak artikel dalam satu sesi. | Kurangi chunk size (misal: 10–15). |
| Kebocoran memori dari Chrome yang berjalan lama. | Chunk size sudah menangani ini secara otomatis. Jika masih bermasalah, kurangi chunk size. |
| RAM komputer tidak cukup. | Tutup aplikasi lain yang berat. Minimal disarankan 4GB RAM. |

### Ringkasan Menampilkan Tanda "-"

| Kemungkinan Penyebab | Solusi |
|---|---|
| Teks artikel gagal diekstrak (kosong). | Periksa kolom Status. Jika "Gagal", berarti situs menolak akses. |
| Teks terlalu pendek untuk dirangkum. | Ini normal untuk artikel yang sangat singkat. |

### Tanggal "Sampai" Bisa Dipilih Sebelum "Dari"

Masalah ini sudah diperbaiki. Pastikan Anda menggunakan versi terbaru. Sistem Flatpickr sekarang melakukan cross-linking: `minDate` pada date picker "Sampai" otomatis berubah mengikuti tanggal "Dari", dan sebaliknya.

---

## 14. Catatan Rilis

### v1.0.0 — 2 Juni 2026

**Fitur Utama:**
- ✅ Crawling berita otomatis dari Google News Indonesia via RSS.
- ✅ Ekstraksi teks bersih menggunakan Readability + JSDOM.
- ✅ Stealth crawling dengan Puppeteer + StealthPlugin.
- ✅ Dual extraction: `got-scraping` (fast path) + Puppeteer browser (fallback).
- ✅ Retry logic dengan exponential backoff.
- ✅ Extractive summarization dengan 300+ stopwords Bahasa Indonesia.
- ✅ Ekspor CSV (UTF-8 BOM untuk kompatibilitas Excel).
- ✅ Database persisten menggunakan Lowdb.
- ✅ Riwayat pencarian dengan detail dan opsi hapus.
- ✅ Pengaturan lengkap (tema, timeout, delay, proxy, chunk size).
- ✅ Proxy rotation untuk crawling skala besar.
- ✅ Browser chunking untuk manajemen memori otomatis.
- ✅ Filter domain presisi (situs pemerintah + sosial media).
- ✅ Validasi tanggal cross-linking (Flatpickr).
- ✅ Antarmuka modern dengan tema Terang/Gelap.
- ✅ User-Agent rotation (8 browser profiles).

---

> **Hak Cipta © 2026 SIAB DKPP — Dewan Kehormatan Penyelenggara Pemilu Republik Indonesia**
> Dilisensikan di bawah lisensi MIT.
