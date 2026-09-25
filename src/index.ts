import dotenv from "dotenv";
import http from "http";

dotenv.config();

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      first_name?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = (process.env.API_BASE || "https://chiro-license-center.onrender.com/api/v1/client").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 10000;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN is not set in environment or .env file!");
  console.error("1. Open Telegram and search for @BotFather");
  console.error("2. Send /newbot and follow instructions to get an HTTP API Token");
  console.error("3. Set TELEGRAM_BOT_TOKEN=your_token in .env");
  process.exit(1);
}

let isRunning = true;
let lastUpdateId = 0;
let botUsername = "ChiroBot";

// Start lightweight HTTP health check server for Render Free Web Service
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        service: "Chiro Telegram Bot",
        bot: `@${botUsername}`,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      })
    );
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

healthServer.listen(PORT, () => {
  console.log(`🌐 Health server listening on port ${PORT}`);
});

async function callTelegramApi(method: string, payload: Record<string, unknown> = {}) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as any;
  } catch (err) {
    console.error(`❌ Telegram API Error (${method}):`, err);
    return null;
  }
}

async function sendMessage(chatId: number | string, text: string, parseMode: "Markdown" | "HTML" = "Markdown") {
  return await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  });
}

// Redeem purchase voucher code via Chiro License Center API
async function redeemVoucherApi(code: string, telegramId?: number, telegramUsername?: string) {
  try {
    const res = await fetch(`${API_BASE}/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        telegramId,
        telegramUsername,
      }),
    });
    return (await res.json()) as any;
  } catch (err: any) {
    return { success: false, error: { message: err?.message || "Failed to reach license server." } };
  }
}

// Verify key status via Chiro License Center API
async function verifyKeyApi(key: string) {
  try {
    const res = await fetch(`${API_BASE}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key,
        hwid: "TELEGRAM_VERIFY_CHECK",
      }),
    });
    return (await res.json()) as any;
  } catch (err: any) {
    return { success: false, error: { message: err?.message || "Failed to reach license server." } };
  }
}

async function handleMessage(msg: NonNullable<TelegramUpdate["message"]>) {
  const chatId = msg.chat.id;
  const rawText = (msg.text || "").trim();
  const from = msg.from;
  const username = from?.username ? `@${from.username}` : from?.first_name || "User";

  // 1. /start
  if (rawText === "/start") {
    const welcome = `⚡ *WELCOME TO CHIRO UI LICENSE BOT* ⚡

Hello, *${username}*! This bot allows you to redeem your store purchase voucher codes into high-security execution keys.

*Available Commands:*
🔑 \`/redeem <CODE>\` — Redeem your purchase voucher
🆓 \`/free\` — Get link for a Free 24-Hour Key
🔍 \`/verify <KEY>\` — Check status of a script key
ℹ️ \`/help\` — How to use and execute

*Example:*
\`/redeem CHIRO-RA3H-RUEY-ESKF\`

_You can also directly send your purchase code here without typing /redeem!_`;
    await sendMessage(chatId, welcome);
    return;
  }

  // 2. /help
  if (rawText === "/help") {
    const help = `📖 *CHIRO LICENSE BOT HELP*

1️⃣ *How do I buy a key?*
Purchase a license from our official store or community channel. You will receive a purchase code like \`CHIRO-XXXX-XXXX-XXXX\`.

2️⃣ *How do I redeem it?*
Send:
\`/redeem YOUR-CODE\`
The bot will verify the voucher and grant you a cryptographically secure script key (\`CHIRO_xxxxxxxx...\`).

3️⃣ *How do I run it in Roblox?*
Add this at the very top of your script executor:
\`\`\`lua
getgenv().Key = "CHIRO_YOUR_REDEEMED_KEY"
\`\`\`

4️⃣ *Need a Free Key?*
Type \`/free\` to access our free key generator checkpoint!`;
    await sendMessage(chatId, help);
    return;
  }

  // 3. /free
  if (rawText === "/free") {
    const freeMsg = `🆓 *CHIRO UI FREE 24-HOUR KEY*

You can generate a free 24-hour key by completing 3 quick checkpoints:

👉 *Checkpoint Generator:*
https://chiro-license-center.onrender.com/free-key

1. Open the page above
2. Complete the steps (15s wait each)
3. Receive your free license key instantly!`;
    await sendMessage(chatId, freeMsg);
    return;
  }

  // 4. /verify <KEY>
  if (rawText.startsWith("/verify")) {
    const keyToTest = rawText.replace("/verify", "").trim();
    if (!keyToTest) {
      await sendMessage(chatId, "⚠️ Please provide a key to verify.\nExample: `/verify CHIRO_7d672a9d2743ddd3b50c2710`");
      return;
    }

    await sendMessage(chatId, "🔍 *Checking key status on server...*");
    const res = await verifyKeyApi(keyToTest);

    if (res && res.success && res.data) {
      const d = res.data;
      const status = d.status || "ACTIVE";
      const prodName = d.product?.name || "Chiro UI";
      const exp = d.license?.expiresAt ? new Date(d.license.expiresAt).toLocaleDateString() : "Lifetime";
      const devices = `${d.license?.currentDevices || 0}/${d.license?.maxDevices || 1}`;

      await sendMessage(
        chatId,
        `✅ *LICENSE VALID*\n\n📦 *Product:* ${prodName}\n🟢 *Status:* ${status}\n⏳ *Expires:* ${exp}\n📱 *Devices Bound:* ${devices}`
      );
    } else {
      const err = res?.error?.message || "Key not found or invalid.";
      await sendMessage(chatId, `❌ *Key Verification Failed*\n\n${err}`);
    }
    return;
  }

  // 5. /redeem <CODE> or direct voucher paste
  let codeToRedeem = "";
  if (rawText.startsWith("/redeem")) {
    codeToRedeem = rawText.replace("/redeem", "").trim();
  } else if (rawText.toUpperCase().startsWith("CHIRO-") && rawText.length >= 10) {
    // Direct paste of purchase code
    codeToRedeem = rawText.trim();
  }

  if (codeToRedeem) {
    await sendMessage(chatId, "⏳ *Verifying and redeeming your voucher...*");

    const result = await redeemVoucherApi(codeToRedeem, from?.id, from?.username);

    if (result && result.success && result.data) {
      const data = result.data;
      const durationStr = data.durationDays ? `${data.durationDays} Days` : "Lifetime VIP";
      const reply = `🎉 *PURCHASE VOUCHER REDEEMED!*

📦 *Product:* ${data.product?.name || "Chiro UI"}
⏳ *Duration:* ${durationStr}
📱 *Device Slots:* ${data.maxDevices || 1}

🔑 *Your High-Security Script Key:*
\`${data.key}\`
_(Tap key above to copy)_

📋 *How to execute in your script:*
\`\`\`lua
getgenv().Key = "${data.key}"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()
\`\`\`

⚠️ *Important:* Save your key! Your original purchase code has been consumed.`;

      await sendMessage(chatId, reply);
    } else {
      const errMsg = result?.error?.message || "Invalid or already redeemed voucher code.";
      await sendMessage(
        chatId,
        `❌ *Redeem Failed*\n\n${errMsg}\n\nPlease check your purchase code and try again or contact support.`
      );
    }
    return;
  }

  // Unrecognized message
  await sendMessage(
    chatId,
    `❓ Unrecognized command. Send \`/redeem <CODE>\` to redeem your purchase voucher, or \`/help\` for instructions.`
  );
}

async function startPolling() {
  // Test connection to Bot API
  const me = await callTelegramApi("getMe");
  if (!me || !me.ok) {
    console.error("❌ Telegram Bot: Invalid bot token or unable to reach Telegram API.");
    process.exit(1);
  }

  botUsername = me.result?.username || "ChiroBot";
  console.log(`
  🤖 ========================================================
  ⚡ CHIRO TELEGRAM REDEEM BOT ACTIVE
  👤 Bot Username: @${botUsername}
  🔗 API Base: ${API_BASE}
  ========================================================
  `);

  while (isRunning) {
    try {
      const data = await callTelegramApi("getUpdates", {
        offset: lastUpdateId + 1,
        timeout: 25,
        allowed_updates: ["message"],
      });

      if (data && data.ok && Array.isArray(data.result)) {
        for (const update of data.result as TelegramUpdate[]) {
          lastUpdateId = update.update_id;
          if (update.message && update.message.text) {
            await handleMessage(update.message);
          }
        }
      }
    } catch (loopErr) {
      console.error("⚠️ Telegram polling error:", loopErr);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Graceful shutdown
const shutdown = () => {
  console.log("\n🛑 Stopping Telegram Bot...");
  isRunning = false;
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startPolling();
