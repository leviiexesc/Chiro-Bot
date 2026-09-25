# 🤖 Chiro-Bot — Telegram License Redeem Bot

Official Telegram Bot for **Chiro UI License Center**. Allows customers to redeem store purchase voucher codes (e.g. `CHIRO-RA3H-RUEY-ESKF`) into cryptographically secure, high-entropy script execution keys (e.g. `CHIRO_7d672a9d2743ddd3b50c2710`).

---

## ⚡ How It Works

```
1. Customer buys on your store ───> Receives purchase code: CHIRO-RA3H-RUEY-ESKF
                                                │
                                                ▼
2. Customer sends code to Bot  ───> Types: /redeem CHIRO-RA3H-RUEY-ESKF
                                                │
                                                ▼
3. Bot consumes voucher        ───> Delivers secure 96-bit script key:
                                    CHIRO_7d672a9d2743ddd3b50c2710
```

---

## 🎮 Bot Commands

| Command | Description |
|---|---|
| `/start` | Welcome message and commands guide |
| `/redeem <CODE>` | Redeem a purchase voucher code for a high-security script key |
| `CHIRO-XXXX-XXXX-XXXX` | Direct paste: automatically redeems the code without typing `/redeem` |
| `/verify <KEY>` | Check license status, expiration, and bound HWID devices |
| `/free` | Link to the 24-Hour Free Key Generator checkpoint page |
| `/help` | Detailed instructions and FAQ |

---

## 🚀 Setup & Installation

### 1. Create a Telegram Bot
1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot`.
3. Choose a name (e.g. `Chiro License Bot`) and a username (e.g. `MyChiroLicenseBot`).
4. Copy the HTTP API token provided by BotFather.

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
API_BASE=https://chiro-license-center.onrender.com/api/v1/client
```

### 3. Run Locally
```bash
# Install dependencies
npm install

# Run in development mode (hot-reload)
npm run dev

# Or build and run in production mode
npm run build
npm start
```

---

## 🌐 1-Click Deployment (Render — Singapore)

This repository includes a `render.yaml` blueprint configured for **Singapore (`singapore`)**:

1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** $\rightarrow$ **Blueprint**.
3. Connect `leviiexesc/Chiro-Bot`.
4. Enter your `TELEGRAM_BOT_TOKEN` in the environment settings.
5. Deploy! The bot will run 24/7 as a background worker.

---

## 🔒 Security
- **Anti-Brute Force:** Execution keys are generated with 96 bits of cryptographic entropy (`CHIRO_` + 24 random hex characters), making them mathematically impossible to guess.
- **Single-Use Vouchers:** Once redeemed, the purchase code is permanently consumed.
- **HWID Binding:** Keys are locked to the user's hardware device on first script run.

---

## 📜 License
MIT License. Developed for Chiro UI Security Systems.