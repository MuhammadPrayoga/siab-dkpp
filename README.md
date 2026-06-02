# SIAB DKPP (Sistem Informasi Agregator Berita — DKPP RI)

SIAB DKPP adalah aplikasi desktop berbasis **Electron** yang dirancang khusus untuk Dewan Kehormatan Penyelenggara Pemilu (DKPP) Republik Indonesia. Aplikasi ini berfungsi untuk melakukan pencarian (*crawling*) berita otomatis mengenai DKPP dari media daring, mengekstrak teks bersih dari artikel berita, dan menghasilkan rangkuman secara algoritmik (*Extractive Summarization*) tanpa memerlukan koneksi ke layanan AI eksternal.

Seluruh proses berjalan secara lokal di perangkat pengguna — tanpa API key, tanpa biaya server, dan tanpa pengiriman data ke pihak ketiga.

---

## 🌟 Fitur Utama

- **Pencarian Berita Otomatis (News Crawling)**:
  - Otomatis mencari berita terkait dengan query bawaan: `"DKPP RI" OR "DEWAN KEHORMATAN PENYELENGGARA PEMILU"`.
  - Mendukung penyaringan kata kunci tambahan dan rentang waktu (tanggal awal & akhir).
  - Mengambil feed RSS resmi dari Google News Indonesia.
- **Ekstraksi Konten Artikel (Stealth Crawler)**:
  - Membuka tautan berita menggunakan *Puppeteer StealthPlugin* via *System Chrome* untuk menembus proteksi Cloudflare dan anti-bot modern secara transparan.
  - Menggunakan `@mozilla/readability` dan `jsdom` untuk menyaring serta mengekstrak teks utama artikel dengan bersih (menghapus iklan, navigasi, header, dan footer).
  - Mengamankan proses *crawling* dengan menolak akses ke semua aset gambar dan media berat secara algoritmik demi kecepatan tinggi.
- **Rangkuman Algoritmik (Extractive Summarization)**:
  - Menggunakan algoritma *Term Frequency* dengan daftar 300+ *stopwords* Bahasa Indonesia.
  - Secara otomatis memilih 2 kalimat paling representatif dari setiap artikel berdasarkan skor frekuensi kata kunci.
  - Hasil rangkuman dibatasi maksimal **500 karakter** per artikel.
  - Tidak memerlukan model AI, koneksi internet tambahan, atau GPU.
- **Ekspor Data (CSV Export)**:
  - Mengunduh hasil pencarian dan rangkuman ke file CSV berformat UTF-8 (dengan BOM agar terbaca rapi di Microsoft Excel).
  - Menyimpan informasi: Judul, Sumber Media, Link, Tanggal Publikasi, Status Ekstraksi, Teks Bersih, dan Cuplikan Teks.
- **Riwayat Pencarian Persisten**:
  - Menyimpan riwayat pencarian dan cuplikan teks secara persisten menggunakan database berbasis file (Lowdb) di direktori `%APPDATA%`.
  - Dilengkapi fitur tinjauan detail, penghapusan item, dan pembersihan seluruh riwayat.
  - Batas riwayat tersimpan dapat dikonfigurasi (25 / 50 / 100 / 200 entri).
- **Stabilitas & Keamanan Tingkat Tinggi**:
  - **Filter Domain Ekstensif**: Otomatis mengecualikan situs-situs pemerintah (DKPP, KPU, Bawaslu) dan puluhan portal sosial media (X, Facebook, Tiktok, Telegram, dsb.) secara presisi dengan verifikasi *URL Hostname*.
  - **Proxy Rotasi (Rotating Proxies)**: Mendukung *input* ribuan IP Proxy. Sistem *crawler* akan merotasi IP target untuk menjaga anonimitas dan mencegah pemblokiran alamat IP lokal dari pengerukan berita skala masif.
  - **Browser Chunking (Memory Management)**: Sistem akan me-restart peramban *Chrome* secara berkala setelah kelipatan beberapa artikel (misalnya: per 20 artikel) guna menjaga kondisi RAM laptop/PC tetap prima meski melakukan *crawling* ribuan tautan sekaligus.
- **Pengaturan Sistem yang Lengkap**:
  - **Maks. Hasil Pencarian**: 10 / 25 / 50 / 100 artikel.
  - **Batas Waktu per Artikel**: 15 / 25 / 40 / 60 detik.
  - **Jeda antar Permintaan**: 500ms / 800ms / 1.5s / 3s (mencegah pemblokiran).
  - **Daftar Proxy HTTP/SOCKS5** & **Batas Chunk Browser**.
  - **Tema Aplikasi**: Mode Terang / Mode Gelap.
  - **Tentang Aplikasi**: Menampilkan versi, platform Electron, dan lokasi database.
- **Antarmuka Modern & Responsif**:
  - Desain formal bertema DKPP RI (Navy & Gold).
  - Konsol log *real-time* untuk memantau proses *crawling*.
  - Animasi transisi yang halus dan *progress bar* interaktif.

---

## 🛠️ Teknologi yang Digunakan

| Komponen | Teknologi |
|---|---|
| **Core Framework** | Electron (Desktop Application) |
| **UI/UX** | HTML5, Tailwind CSS (CDN), Google Fonts (Inter) |
| **Logic** | Vanilla JavaScript (Main Process, Preload, Renderer) |
| **RSS Parser** | `rss-parser` (Google News RSS Feed) |
| **Crawler Engine** | `puppeteer-core`, `puppeteer-extra-plugin-stealth` |
| **Article Parser** | `@mozilla/readability` & `jsdom` |
| **Summarization** | Extractive Summarization (Term Frequency Algorithm) |
| **Database** | `lowdb` (File-based JSON, persisten) |
| **HTTP Client** | `axios` |

---

## 📁 Struktur Proyek

```
siab-dkpp/
├── public/
│   ├── logo_dkpp.png      # Logo Resmi DKPP RI
│   └── icon.ico           # Ikon Aplikasi
├── index.html             # Antarmuka Utama (HTML & Styling)
├── main.js                # Electron Main Process (Crawling, IPC Handlers)
├── preload.js             # Electron Preload (Jembatan Aman IPC)
├── renderer.js            # Renderer Process (UI, Summarization, CSV, Riwayat)
├── database.js            # Modul Database (Lowdb - Penyimpanan Persisten)
├── package.json           # Dependensi & Script
└── README.md              # Dokumentasi Proyek
```

---

## 🚀 Panduan Instalasi & Penggunaan

### Prasyarat
Pastikan Anda sudah menginstal **Node.js** (versi 18 ke atas) di komputer Anda.

### Langkah-langkah

1. **Klon Repositori**
   ```bash
   git clone https://github.com/MuhammadPrayoga/siab-dkpp.git
   cd siab-dkpp
   ```

2. **Instal Dependensi**
   ```bash
   npm install
   ```

3. **Jalankan Aplikasi**
   - **Mode Pengembangan** (dengan Chrome DevTools):
     ```bash
     npm run dev
     ```
   - **Mode Produksi**:
     ```bash
     npm start
     ```

### Cara Penggunaan Aplikasi

1. Buka aplikasi dan atur preferensi di menu **Pengaturan** (Maks Hasil, Batas Waktu, Jeda Antar Request).
2. Di halaman utama, masukkan **kata kunci** tambahan (opsional) dan pilih **rentang waktu** berita (tanggal awal & akhir).
3. Klik tombol **"Mulai Crawling"** untuk memulai proses pengambilan berita secara otomatis.
4. Anda dapat memantau proses secara *real-time* melalui **Terminal Log**.
5. Setelah selesai, rangkuman berita akan ditampilkan. Klik **"Export CSV"** untuk mengunduh hasil dalam format `.csv` (kompatibel dengan Excel).
6. Akses tab **"Riwayat"** untuk melihat riwayat pencarian dan ekstraksi sebelumnya.

> [!NOTE]
> Tidak ada model AI yang perlu diunduh. Seluruh proses rangkuman dilakukan secara algoritmik dan berjalan instan tanpa koneksi internet tambahan setelah berita berhasil di-*crawl*.

---

## 📜 Lisensi

Proyek ini dilisensikan di bawah lisensi **MIT**. Hak Cipta &copy; 2026 SIAB DKPP.
