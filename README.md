# SIAB DKPP (Sistem Informasi Analisis Berita - DKPP RI)

SIAB DKPP adalah aplikasi desktop berbasis **Electron** yang dirancang khusus untuk Dewan Kehormatan Penyelenggara Pemilu (DKPP) Republik Indonesia. Aplikasi ini berfungsi untuk melakukan pencarian (crawling) berita otomatis mengenai DKPP dari media online, mengekstrak teks bersih dari artikel berita, dan melakukan perangkuman berbasis AI (NLP) secara lokal di perangkat pengguna.

Aplikasi ini berjalan sepenuhnya secara *client-side* untuk pemrosesan AI, sehingga menjaga privasi data, menekan biaya server, dan tidak memerlukan API key eksternal.

---

## 🌟 Fitur Utama

- **Pencarian Berita Cerdas (News Crawling)**:
  - Otomatis mencari berita terkait dengan query bawaan: `"DKPP RI" OR "DEWAN KEHORMATAN PENYELENGGARA PEMILU"`.
  - Mendukung penyaringan kata kunci tambahan (keyword) dan rentang waktu (tanggal awal & akhir).
  - Mengambil daftar feed RSS resmi dari Google News.
- **Ekstraksi Konten Artikel Tanpa Gangguan (Clean Extraction)**:
  - Membuka tautan artikel berita di latar belakang menggunakan off-screen browser window untuk menyelesaikan pengalihan (JavaScript redirect).
  - Menggunakan modul `@mozilla/readability` dan `jsdom` untuk menyaring dan mengekstrak teks utama artikel dengan bersih (menghapus iklan, menu navigasi, header, dan footer).
- **Perangkuman AI Lokal (On-Device AI Summarization)**:
  - Mengintegrasikan Hugging Face **Transformers.js** (`@xenova/transformers`) yang berjalan di thread terpisah (**Web Worker**) agar antarmuka aplikasi tetap responsif.
  - Proses inferensi AI dilakukan 100% lokal pada komputer Anda tanpa mengirim teks artikel ke server pihak ketiga.
  - Pilihan model AI fleksibel:
    - `Xenova/distilbart-cnn-12-6` (Default - Cepat & Efisien)
    - `Xenova/bart-large-cnn` (Akurasi Tinggi)
    - `Xenova/indobert-base-uncased` (Fokus Bahasa Indonesia)
  - Pengaturan panjang rangkuman yang dapat disesuaikan: Singkat (±2 Kalimat), Sedang (±1 Paragraf), atau Mendetail (Panjang).
- **Ekspor Data Mudah (CSV Export)**:
  - Mengunduh hasil pencarian dan analisis rangkuman langsung ke file CSV berformat UTF-8 (dengan dukungan BOM agar terbaca rapi di Microsoft Excel).
  - Menyimpan informasi: Judul, Sumber Media, Link, Tanggal Publikasi, Status Ekstraksi, Teks Bersih Artikel, dan Rangkuman AI.
- **Riwayat Analisis (History Logs)**:
  - Menyimpan metadata hasil pencarian dan rangkuman AI secara lokal di browser (`localStorage`).
  - Dilengkapi fitur tinjauan detail untuk setiap sesi pencarian terdahulu, penghapusan item tertentu, serta pembersihan cache riwayat secara menyeluruh.
- **Antarmuka Modern & Responsif**:
  - Tema Tampilan Fleksibel (Mode Terang/Light Mode dan Mode Gelap/Dark Mode).
  - Animasi transisi yang halus, indikator kemajuan (progress bar) interaktif untuk penarikan RSS maupun proses pengunduhan model AI.

---

## 🛠️ Teknologi yang Digunakan

- **Core Framework**: Electron (Desktop Application)
- **UI/UX**: HTML5, Vanilla CSS, Tailwind CSS (via CDN), Google Fonts (Inter)
- **Logic**: Vanilla JavaScript (Main Process, Preload Script, Renderer Process)
- **RSS Parser**: `rss-parser` (Mengurai feed RSS Google News)
- **Article Parser**: `@mozilla/readability` & `jsdom` (Pembersih konten web)
- **AI/NLP Engine**: `@xenova/transformers` (Inference AI lokal menggunakan ONNX Runtime)

---

## 📁 Struktur Proyek

```
siab-dkpp/
├── public/
│   └── logo_dkpp.png      # Logo Resmi DKPP RI
├── index.html             # Struktur Antarmuka Utama (HTML & Styling)
├── main.js                # Electron Main Process (Crawling & Browser Hidden Handler)
├── preload.js             # Electron Preload (Jembatan Aman IPC)
├── renderer.js            # Renderer Process (Logika UI, Ekspor CSV, & Riwayat)
├── worker.js              # Web Worker (Inisialisasi & Inferensi Model AI lokal)
├── package.json           # Dependensi Proyek & Script Perintah
└── README.md              # Dokumentasi Proyek
```

---

## 🚀 Panduan Instalasi & Penggunaan

### Prasyarat
Pastikan Anda sudah menginstal **Node.js** (versi 18 ke atas direkomendasikan) di komputer Anda.

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
   - **Mode Pengembangan (dengan Chrome DevTools)**:
     ```bash
     npm run dev
     ```
   - **Mode Produksi (Aplikasi Biasa)**:
     ```bash
     npm start
     ```

> [!NOTE]
> Saat pertama kali Anda melakukan pencarian berita, aplikasi akan mengunduh model AI pilihan Anda dari server Hugging Face ke dalam cache browser lokal. Proses ini membutuhkan waktu beberapa menit tergantung koneksi internet Anda. Setelah terunduh, pencarian selanjutnya akan berjalan jauh lebih cepat dan dapat dilakukan secara luring (offline) untuk bagian perangkuman AI-nya.

---

## 📜 Lisensi

Proyek ini dilisensikan di bawah lisensi **MIT**. Hak Cipta &copy; 2026 SIAB DKPP.
