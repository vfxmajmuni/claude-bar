# 🤖 Claude Bar

An elegant, transparent floating widget for macOS that automatically tracks and displays your Claude.ai usage limits in real-time. 

## ✨ Features
- **Always on top:** A sleek, borderless, semi-transparent widget that seamlessly integrates with macOS.
- **Auto-polling:** Automatically syncs your Claude session limit data every 30 seconds.
- **Smart Color Indicators:** Colors transition from green (ok) to yellow (warning) and a blinking red (critical) when you have less than 15 minutes left.
- **Session Persistence:** Remembers your Claude authentication. You only need to log in once!

## 🚀 How it works under the hood
The app runs on **Electron** and is split into two windows:
1. **The Widget (`floatWin`):** The visible UI written in Vanilla HTML/CSS/JS. It stays always on top and displays the current usage.
2. **The Scraper (`scraperWin`):** A hidden window that securely navigates to your `claude.ai/settings/usage` page, handles SPA (Single Page Application) navigation quirks, and programmatically reads the usage progress bars without requiring any API keys. 

Authentication cookies are saved locally (`claude-cookies.json`) so your session persists even after restarting the app.

## 📦 Installation for Users
Download the latest `.dmg` installer from the Releases tab, open it, and drag "Claude Bar" to your Applications folder.
*Note: Upon the first launch, right-click the app and select "Open" to bypass the macOS unidentified developer warning.*

## 💻 Development
To run this project locally:
```bash
npm install
npm start
