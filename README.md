# MultiChart-TradingView 🚀
### Professional Multi-Window & Multi-Chart TradingView Desktop Terminal
### ترمینال پیشرفته دسکتاپ چند پنجره‌ای و چند چارته تریدینگ‌ویو با همگام‌سازی سراسری

[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg)](https://github.com/XUtility/MultiChart-TradingView/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%7C%2011-0078D6.svg)](https://github.com/XUtility/MultiChart-TradingView/releases)
[![License](https://img.shields.io/badge/license-Proprietary-red.svg)](LICENSE)
[![Download Portable](https://img.shields.io/badge/Download-Portable%20v1.0.0-success?style=for-the-badge&logo=windows)](https://github.com/XUtility/MultiChart-TradingView/releases/latest)

---

## 🌐 English Documentation

### 📌 Overview
**MultiChart-TradingView** is an elite standalone Windows desktop terminal engineered for active traders, technical analysts, and financial institutions. It unlocks advanced multi-chart layouts, cross-monitor multi-window workflows, and zero-latency crosshair/symbol synchronization — **without requiring paid subscription layout locks or browser extensions**.

### ✨ Key Features
* 🖥️ **Multi-Window & Multi-Monitor Workspace (`Ctrl+N`):**
  * Spawn unlimited independent desktop windows.
  * Drag and organize charts freely across 2, 3, or more physical monitors.
  * Pop out any chart pane into its own independent window with a single click (`⧉`).
* 🎯 **Zero-Latency Crosshair & Time Synchronization:**
  * Real-time crosshair synchronization across all charts, split panes, and windows across all monitors.
  * Sub-millisecond timestamp matching ensures perfect candle alignment across different timeframes (e.g. 1M, 5M, 1H, 1D).
* 🔀 **Dynamic Split-Screen Layouts (Edge Split-Screen Engine):**
  * **1 Chart (Single View):** Focused candlestick analysis.
  * **2 Vertical (Side-by-Side):** Smooth draggable vertical divider.
  * **2 Horizontal (Top / Bottom):** Stacked comparative views.
  * **3 Charts (Triple View):** 1 primary dominant chart + 2 sub-charts.
  * **4 Grid (2x2):** Multi-timeframe quadrant monitoring.
  * **6 Grid (3x2):** Full market overview.
  * **Smooth Draggable Splitters:** Resize panes on the fly; double-click the splitter to instantly snap back to a 50/50 ratio.
* 🛠️ **Floating & Customizable Master Drawing Bar:**
  * Shared floating toolbar providing instant access to your favorite drawing tools (Trend Line, Fibonacci, Horizontal Ray, Arrow Up/Down, Brush, Text, Long/Short Position).
  * Customize which tools appear to keep your workspace clean and decluttered.
* 🔍 **Live Symbol Search & Watchlist:**
  * Built-in ticker search with direct exchange/broker autocomplete (Binance, Forex, OANDA, Bybit, KuCoin, etc.).
  * Persistent saved watchlist with instant switching.
* 🔄 **In-App Updates:**
  * The Update button in the master bar checks the newest GitHub release, downloads the package that matches this platform, verifies it against the published SHA-256 checksum and hands it to the installer.
  * Nothing is executed before the checksum matches, and no download starts without a click.
* 🔐 **Seamless Account & Cloud Sync:**
  * Direct Google OAuth login (bypasses browser security locks) and one-click official browser authorization.
  * Automatic session preservation: line drawings, indicators, templates, and chart settings persist seamlessly across all charts.
  * Manual Drawing Cloud Save shortcut (`Ctrl+S`).
* ⚡ **Clean & Distraction-Free:**
  * Eliminates sidebars, promotional banners, and bottom clutter to dedicate 100% of screen real estate to candlesticks.

### ⌨️ Keyboard Shortcuts
| Shortcut | Action |
| :--- | :--- |
| `Ctrl + N` | Open New Independent Desktop Window |
| `Ctrl + S` | Force Save Drawings to Cloud Account |
| `F11` | Toggle Fullscreen Mode |
| `Double-Click Splitter` | Reset Split Ratio to 50/50 |
| `Enter` (in search) | Apply Symbol to All Connected Charts |

### ⚡ Performance & Specifications
| Feature | ⚡ MultiChart-TradingView Native Terminal |
| :--- | :--- |
| **Download Size (ZIP)** | **~3.2 MB** (Portable) |
| **Installed / Extracted Size** | **~8.2 MB** (Single .exe) |
| **RAM Usage per Chart** | **~40 - 60 MB** (Native WebView2) |
| **Startup Speed** | Instant (< 0.5s) |
| **Architecture** | Rust + Tauri Native Windows WebView2 |

### 📥 Download & Installation
1. Go to the [Releases](https://github.com/XUtility/MultiChart-TradingView/releases) page.
2. Download `MultiChart-TradingView-Tauri-v1.0.0-Portable.zip` (~3.2 MB).
3. Extract the ZIP archive anywhere on your PC.
4. Run `MultiChart-TradingView.exe` (or `run-tauri.bat`).
*No installation, admin rights, or extra software required.*

---

## 🇮🇷 راهنمای فارسی (Persian Documentation)

### 📌 معرفی نرم‌افزار
**MultiChart-TradingView** یک ترمینال دسکتاپ مستقل و فوق‌سریع برای ویندوز است که به صورت اختصاصی برای تریدرها و تحلیل‌گران بازارهای مالی (کریپتو، فارکس و سهام) توسعه یافته است. این برنامه امکان چیدمان همزمان چندین چارت، استفاده از چند مانیتور و هماهنگ‌سازی همزمان خط ماوس و نمادها را **بدون نیاز به خرید اشتراک‌های دلاری تریدینگ‌ویو و بدون نیاز به نصب هرگونه اکستنشن** فراهم می‌سازد.

### 🌟 قابلیت‌های برجسته
* 🖥️ **پشتیبانی کامل از چند مانیتور و چند پنجره مستقل (`Ctrl+N`):**
  * امکان باز کردن بی‌نهایت پنجره مستقل در ویندوز.
  * چینش آسان چارت‌ها روی مانیتور ۱، مانیتور ۲ و مانیتورهای جانبی.
  * دکمه پاپ‌اوت (⧉) روی هر چارت برای انتقال آنی همان چارت به یک پنجره مستقل جدید.
* 🎯 **سینک سراسری و بلادرنگ خط نشانگر (Crosshair Sync):**
  * حرکت ماوس در هر چارت یا هر پنجره، خط عمودی و زمان دقیق متناظر را روی تمامی چارت‌ها و تایم‌فریم‌های دیگر به نمایش درمی‌آورد.
  * بررسی تایم‌فریم‌های مختلف (مثلاً ۱ دقیقه، ۱۵ دقیقه و ۴ ساعته) به صورت همزمان با هماهنگی میلی‌ثانیه‌ای.
* 🔀 **چیدمان‌های متنوع اسپیلیت‌اسکرین (Split Layouts):**
  * **۱ چارت (تک چارت):** تمرکز کامل روی روند قیمتی.
  * **۲ چارت عمودی (کنار هم):** مقایسه دو دارایی یا دو تایم‌فریم.
  * **۲ چارت افقی (بالا و پایین):** چیدمان افقی بهینه.
  * **۳ چارت (Triple View):** یک چارت اصلی بزرگ و دو چارت فرعی در کنار.
  * **۴ چارت (گرید ۲×۲):** استاندارد ۴ چارت همزمان.
  * **۶ چارت (گرید ۳×۲):** مانیتورینگ پیشرفته بازار.
  * **خطوط تقسیم متحرک:** تغییر اندازه آسان با کشیدن ماوس + بازگشت فوری به ۵۰/۵۰ با دابل کلیک.
* 🛠️ **نوار ابزارهای پرکاربرد و شناور (Customizable Drawing Bar):**
  * نوار ابزار مشترک و بهینه بالای صفحه شامل خط روند، فیبوناچی، پیکان بالا/پایین، براش، باکس و پوزیشن‌های معاملاتی.
  * امکان شخصی‌سازی و فعال/غیرفعال کردن هر ابزار به دلخواه کاربر.
* 🔍 **جستجوی زنده نمادها با تفکیک بروکر و صرافی:**
  * جستجوی سریع انواع نمادها با نام صرافی و بروکر (بایننس، آلپاری، فارکس دات کام، اوآندا و...).
  * واچ‌لیست اختصاصی با قابلیت ذخیره و جابجایی فوق‌العاده سریع.
* 🔐 **ورود آسان به حساب و ذخیره ابری تحلیل‌ها:**
  * پشتیبانی از ورود مستقیم با حساب گوگل و همچنین اتصال ایمن از طریق مرورگر.
  * سینک سراسری ابزارها، اندیکاتورها و چارت‌ها در تمام پنجره‌ها.
  * کلید میانبر `Ctrl+S` برای ذخیره سریع رسم‌ها در فضای ابری اکانت تریدینگ‌ویو شما.
* ⚡ **محیط کاملاً تمیز و بدون تبلیغات:**
  * حذف کامل سایدبارهای اضافی، تبلیغات و بنرهای مزاحم برای استفاده حداکثری از فضای مانیتور.

### ⌨️ کلیدهای میانبر
| میانبر | عملکرد |
| :--- | :--- |
| `Ctrl + N` | باز کردن پنجره ویندوزی جدید |
| `Ctrl + S` | ذخیره تحلیل‌ها و رسم‌ها در اکانت ابری تریدینگ‌ویو |
| `F11` | حالت تمام‌صفحه (Fullscreen) |
| `دابل‌کلیک روی خط تقسیم` | بازگرداندن تقسیم چارت‌ها به نسبت برابر ۵۰/۵۰ |
| `Enter` (در کادر جستجو) | اعمال نماد روی چارت‌های همگام‌شده |

### 🚀 نحوه دانلود و اجرا
1. به صفحه [Releases](https://github.com/XUtility/MultiChart-TradingView/releases) مراجعه کنید.
2. فایل فشرده پرتابل `MultiChart-TradingView-Tauri-v1.0.0-Portable.zip` با **حجم کم‌نظیر تنها ۳.۲ مگابایت** را دانلود کنید.
3. فایل زیپ را در هر پوشه‌ای استخراج (Extract) کنید.
4. روی فایل `MultiChart-TradingView.exe` (یا `run-tauri.bat`) دابل کلیک کنید تا برنامه فوراً اجرا شود.
*بدون نیاز به نصب، بدون نیاز به دسترسی ادمین و بدون پیش‌نیاز اضافی.*

---

## 📜 License & Copyright
**Copyright (c) 2026 XUtility. All rights reserved.**

This software is **Proprietary**. You are authorized to download, execute, and use the binary releases of this software for personal and professional trading purposes. Decompilation, reverse engineering, redistribution, or unauthorized modification of the code is strictly prohibited. For inquiries, please refer to the [LICENSE](LICENSE) file or contact the repository maintainers.
