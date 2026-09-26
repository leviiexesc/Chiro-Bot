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

let isRunning = true;
let lastUpdateId = 0;
let botUsername = "ChiroBot";
let botConnected = false;

// ── Per-user language preference (in-memory) ──────────────────────────────────
// Key: Telegram user ID (number) → "en" | "km"
const userLang = new Map<number, "en" | "km">();

function getLang(userId?: number): "en" | "km" {
  if (!userId) return "en";
  return userLang.get(userId) ?? "en";
}

// ── Translation table ──────────────────────────────────────────────────────────
const T = {
  en: {
    // /start
    start: (name: string) => `⚡ *WELCOME TO CHIRO UI LICENSE BOT* ⚡

Hello, *${name}*\\! This bot lets you redeem purchase vouchers into high\\-security script keys\\.

*Available Commands:*
🔑 \`/redeem <CODE>\` — Redeem your purchase voucher
🆓 \`/free\` — Get a Free 24\\-Hour Key
🔍 \`/verify <KEY>\` — Check your key status
🔄 \`/resethwid <KEY>\` — Reset HWID _(4\\-day cooldown)_
🌐 \`/lang\` — Change language / ប្តូរភាសា
ℹ️ \`/help\` — How to use this bot

*Example:*
\`/redeem CHIRO\\-RA3H\\-RUEY\\-ESKF\`

_You can also paste your voucher code directly without typing /redeem\\!_`,

    // /help
    help: `📖 *CHIRO LICENSE BOT HELP*

1️⃣ *How do I buy a key?*
Purchase from our store\\. You will receive a code like \`CHIRO\\-XXXX\\-XXXX\\-XXXX\`\\.

2️⃣ *How do I redeem it?*
Send: \`/redeem YOUR\\-CODE\`
The bot will exchange it for a secure script key \\(\`CHIRO\\_xxxxxxxx\\.\\.\\.)\`\\.

3️⃣ *How do I run it in Roblox?*
Add this at the top of your executor:
\`\`\`lua
getgenv\\(\\)\\.Key = "CHIRO\\_YOUR\\_KEY"
\`\`\`

4️⃣ *Free Key?*
Type \`/free\` to generate a free 24\\-hour key\\.

5️⃣ *Changed PC / Device?*
Use \`/resethwid CHIRO\\_YOUR\\_KEY\`
⚠️ *Cooldown: 4 days between resets\\.*`,

    // /free
    free: `🆓 *CHIRO UI FREE 24\\-HOUR KEY*

Generate a free 24\\-hour key by completing 3 quick checkpoints:

👉 *Checkpoint Generator:*
https://chiro\\-license\\-center\\.onrender\\.com/free\\-key

1\\. Open the page above
2\\. Complete the steps \\(15s wait each\\)
3\\. Receive your free key instantly\\!`,

    // /lang
    lang_prompt: `🌐 *SELECT LANGUAGE / ជ្រើសរើសភាសា*

Please reply with a number:
1️⃣ \`/lang en\` — 🇺🇸 English
2️⃣ \`/lang km\` — 🇰🇭 ខ្មែរ \\(Khmer\\)`,
    lang_set_en: `✅ Language set to *English* 🇺🇸`,
    lang_set_km: `✅ បានប្ដូរភាសាទៅ *ខ្មែរ* 🇰🇭`,
    lang_invalid: `⚠️ Unknown language\\. Use \`/lang en\` or \`/lang km\``,

    // /resethwid
    resethwid_no_key: `⚠️ Please provide your script key\\.
Example: \`/resethwid CHIRO\\_7d672a9d2743ddd3b50c2710\``,
    resethwid_checking: `🔄 *Resetting your HWID\\.\\.\\.*`,
    resethwid_success: (key: string, nextDate: string) =>
      `✅ *HWID Reset Successful\\!*

Your key \`${key}\` has been unlinked from all devices\\.

📱 You can now activate it on your new device\\.
⏳ *Next reset available:* ${nextDate}`,
    resethwid_fail: (msg: string) => `❌ *HWID Reset Failed*\n\n${msg}`,
    resethwid_server_err: `❌ *Server Error*\n\nCould not reach the license server\\. Please try again later\\.`,

    // /verify
    verify_no_key: `⚠️ Please provide a key to verify\\.
Example: \`/verify CHIRO\\_7d672a9d2743ddd3b50c2710\``,
    verify_checking: `🔍 *Checking key status on server\\.\\.\\.*`,
    verify_valid: (prod: string, status: string, exp: string, devices: string) =>
      `✅ *LICENSE VALID*\n\n📦 *Product:* ${prod}\n🟢 *Status:* ${status}\n⏳ *Expires:* ${exp}\n📱 *Devices Bound:* ${devices}`,
    verify_fail: (msg: string) => `❌ *Key Verification Failed*\n\n${msg}`,

    // /redeem
    redeem_checking: `⏳ *Verifying and redeeming your voucher\\.\\.\\.*`,
    redeem_success: (prod: string, dur: string, slots: string, key: string) =>
      `🎉 *PURCHASE VOUCHER REDEEMED\\!*

📦 *Product:* ${prod}
⏳ *Duration:* ${dur}
📱 *Device Slots:* ${slots}

🔑 *Your High\\-Security Script Key:*
\`${key}\`
_\\(Tap key above to copy\\)_

📋 *How to execute in your script:*
\`\`\`lua
getgenv\\(\\)\\.Key = "${key}"
local Chiro = loadstring\\(game:HttpGet\\("https://raw.githubusercontent.com/leviiexesc/chiro\\_UI/main/chiro\\_lib.luau"\\)\\)\\(\\)
\`\`\`

⚠️ *Important:* Save your key\\! Your original purchase code has been consumed\\.`,
    redeem_fail: (msg: string) =>
      `❌ *Redeem Failed*\n\n${msg}\n\nPlease check your purchase code and try again or contact support\\.`,

    // unknown
    unknown: `❓ Unrecognized command\\. Send \`/redeem <CODE>\` to redeem your voucher, or \`/help\` for instructions\\.`,
  },

  km: {
    // /start
    start: (name: string) => `⚡ *សូមស្វាគមន៍មកកាន់ CHIRO UI LICENSE BOT* ⚡

សួស្ដី, *${name}*\\! Bot នេះអនុញ្ញាតឱ្យអ្នកដូររបៀបប្ដូរ voucher ទៅជា script key សុវត្ថិភាពខ្ពស់\\.

*ពាក្យបញ្ជាដែលមាន:*
🔑 \`/redeem <CODE>\` — ប្ដូរ voucher របស់អ្នក
🆓 \`/free\` — ទទួល Key ឥតគិតថ្លៃ 24 ម៉ោង
🔍 \`/verify <KEY>\` — ពិនិត្យស្ថានភាព key
🔄 \`/resethwid <KEY>\` — កំណត់ HWID ឡើងវិញ _(រង់ចាំ 4 ថ្ងៃ)_
🌐 \`/lang\` — ប្ដូរភាសា / Change language
ℹ️ \`/help\` — របៀបប្រើ bot

*ឧទាហរណ៍:*
\`/redeem CHIRO\\-RA3H\\-RUEY\\-ESKF\`

_អ្នកក៏អាចផ្ញើ voucher code ដោយផ្ទាល់ ដោយមិនចាំបាច់វាយ /redeem\\!_`,

    // /help
    help: `📖 *ជំនួយ CHIRO LICENSE BOT*

1️⃣ *តើខ្ញុំទិញ key យ៉ាងដូចម្ដេច?*
ទិញពីហាងផ្លូវការ\\. អ្នកនឹងទទួលបាន code ដូចជា \`CHIRO\\-XXXX\\-XXXX\\-XXXX\`\\.

2️⃣ *តើខ្ញុំប្ដូរ voucher យ៉ាងដូចម្ដេច?*
ផ្ញើ: \`/redeem YOUR\\-CODE\`
Bot នឹងប្ដូរ voucher ទៅជា script key \\(\`CHIRO\\_xxxxxxxx\\.\\.\\.\\)\`\\.

3️⃣ *តើខ្ញុំប្រើ key ក្នុង Roblox យ៉ាងដូចម្ដេច?*
បន្ថែមកូដនេះនៅកំពូល executor:
\`\`\`lua
getgenv\\(\\)\\.Key = "CHIRO\\_YOUR\\_KEY"
\`\`\`

4️⃣ *Key ឥតគិតថ្លៃ?*
វាយ \`/free\` ដើម្បីទទួលបាន key ឥតគិតថ្លៃ 24 ម៉ោង\\.

5️⃣ *ប្ដូរ PC / ឧបករណ៍ថ្មី?*
ប្រើ \`/resethwid CHIRO\\_YOUR\\_KEY\`
⚠️ *ត្រូវរង់ចាំ 4 ថ្ងៃ រវាងការ reset\\.*`,

    // /free
    free: `🆓 *CHIRO UI KEY ឥតគិតថ្លៃ 24 ម៉ោង*

ទទួលបាន key ឥតគិតថ្លៃ 24 ម៉ោង ដោយបំពេញ 3 ជំហានរហ័ស:

👉 *Checkpoint Generator:*
https://chiro\\-license\\-center\\.onrender\\.com/free\\-key

1\\. បើកទំព័រខាងលើ
2\\. បំពេញជំហានទាំង 3 \\(រង់ចាំ 15 វិនាទីនីមួយៗ\\)
3\\. ទទួលបាន key ភ្លាមៗ\\!`,

    // /lang
    lang_prompt: `🌐 *ជ្រើសរើសភាសា / SELECT LANGUAGE*

សូមឆ្លើយតបជាមួយលេខ:
1️⃣ \`/lang en\` — 🇺🇸 English
2️⃣ \`/lang km\` — 🇰🇭 ខ្មែរ \\(Khmer\\)`,
    lang_set_en: `✅ Language set to *English* 🇺🇸`,
    lang_set_km: `✅ បានប្ដូរភាសាទៅ *ខ្មែរ* 🇰🇭`,
    lang_invalid: `⚠️ ភាសាមិនត្រឹមត្រូវ\\. ប្រើ \`/lang en\` ឬ \`/lang km\``,

    // /resethwid
    resethwid_no_key: `⚠️ សូមផ្ដល់ script key របស់អ្នក\\.
ឧទាហរណ៍: \`/resethwid CHIRO\\_7d672a9d2743ddd3b50c2710\``,
    resethwid_checking: `🔄 *កំពុង Reset HWID\\.\\.\\.*`,
    resethwid_success: (key: string, nextDate: string) =>
      `✅ *Reset HWID បានជោគជ័យ\\!*

Key \`${key}\` ត្រូវបានដោះចំណងពីឧបករណ៍ទាំងអស់\\.

📱 អ្នកអាចប្ប activate លើឧបករណ៍ថ្មីឥឡូវ\\.
⏳ *Reset បន្ទាប់អាចធ្វើបាននៅ:* ${nextDate}`,
    resethwid_fail: (msg: string) => `❌ *Reset HWID បរាជ័យ*\n\n${msg}`,
    resethwid_server_err: `❌ *Server Error*\n\nមិនអាចភ្ជាប់ server\\. សូមព្យាយាមម្ដងទៀត\\.`,

    // /verify
    verify_no_key: `⚠️ សូមផ្ដល់ key ដើម្បីពិនិត្យ\\.
ឧទាហរណ៍: \`/verify CHIRO\\_7d672a9d2743ddd3b50c2710\``,
    verify_checking: `🔍 *កំពុងពិនិត្យ key \\.\\.\\.*`,
    verify_valid: (prod: string, status: string, exp: string, devices: string) =>
      `✅ *LICENSE ត្រឹមត្រូវ*\n\n📦 *ផលិតផល:* ${prod}\n🟢 *ស្ថានភាព:* ${status}\n⏳ *អស់សុពលភាព:* ${exp}\n📱 *ឧបករណ៍ចូលភ្ជាប់:* ${devices}`,
    verify_fail: (msg: string) => `❌ *ការពិនិត្យ Key បរាជ័យ*\n\n${msg}`,

    // /redeem
    redeem_checking: `⏳ *កំពុងផ្ទៀងផ្ទាត់ និងប្ដូរ voucher \\.\\.\\.*`,
    redeem_success: (prod: string, dur: string, slots: string, key: string) =>
      `🎉 *VOUCHER ត្រូវបានប្ដូរ\\!*

📦 *ផលិតផល:* ${prod}
⏳ *រយៈពេល:* ${dur}
📱 *ម៉ាស៊ីនដែលអាចប្ប activate:* ${slots}

🔑 *Script Key សុវត្ថិភាពរបស់អ្នក:*
\`${key}\`
_\\(ចុចលើ key ដើម្បី copy\\)_

📋 *របៀប execute ក្នុង Roblox:*
\`\`\`lua
getgenv\\(\\)\\.Key = "${key}"
local Chiro = loadstring\\(game:HttpGet\\("https://raw.githubusercontent.com/leviiexesc/chiro\\_UI/main/chiro\\_lib.luau"\\)\\)\\(\\)
\`\`\`

⚠️ *សំខាន់:* រក្សាទុក key\\! Voucher ដើមត្រូវបានប្រើរួចហើយ\\.`,
    redeem_fail: (msg: string) =>
      `❌ *ការប្ដូរ Voucher បរាជ័យ*\n\n${msg}\n\nសូមពិនិត្យ code ម្ដងទៀត ឬទំនាក់ទំនង support\\.`,

    // unknown
    unknown: `❓ ពាក្យបញ្ជាមិនត្រឹមត្រូវ\\. ផ្ញើ \`/redeem <CODE>\` ដើម្បីប្ដូរ voucher, ឬ \`/help\` សម្រាប់ការណែនាំ\\.`,
  },
};

// ─────────────────────────────────────────────────────────────────────────────

if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.trim() === "" || TELEGRAM_BOT_TOKEN.includes("your_")) {
  console.log("⚠️ NOTICE: TELEGRAM_BOT_TOKEN is not configured yet.");
  console.log("👉 Go to Render Dashboard -> 'Environment' tab -> Add/Edit TELEGRAM_BOT_TOKEN with your token from @BotFather.");
  console.log("🌐 Health server remains active on port 10000 so Render stays online.");
}

// Start lightweight HTTP health check server for Render Free Web Service
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "healthy",
        service: "Chiro Telegram Bot",
        bot: botConnected ? `@${botUsername}` : "Waiting for TELEGRAM_BOT_TOKEN",
        telegramConnected: botConnected,
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

  // ── Self-ping every 14 minutes to prevent Render Free Plan from sleeping ──
  const SELF_URL = process.env.RENDER_EXTERNAL_URL
    ? `${process.env.RENDER_EXTERNAL_URL}/health`
    : `http://localhost:${PORT}/health`;

  setInterval(async () => {
    try {
      const res = await fetch(SELF_URL);
      console.log(`💓 Self-ping → ${SELF_URL} [${res.status}]`);
    } catch (err) {
      console.warn("⚠️ Self-ping failed:", err);
    }
  }, 14 * 60 * 1000); // every 14 minutes
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

async function sendMessage(chatId: number | string, text: string, parseMode: "MarkdownV2" | "HTML" = "MarkdownV2") {
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
      body: JSON.stringify({ code, telegramId, telegramUsername }),
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
      body: JSON.stringify({ key, hwid: "TELEGRAM_VERIFY_CHECK" }),
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
  const userId = from?.id;
  const username = from?.username ? `@${from.username}` : from?.first_name || "User";
  const lang = getLang(userId);
  const t = T[lang];

  // ── /start ────────────────────────────────────────────────────────────────
  if (rawText === "/start") {
    await sendMessage(chatId, t.start(username));
    return;
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (rawText === "/help") {
    await sendMessage(chatId, t.help);
    return;
  }

  // ── /lang [en|km] ─────────────────────────────────────────────────────────
  if (rawText.startsWith("/lang")) {
    const arg = rawText.replace("/lang", "").trim().toLowerCase();
    if (!arg) {
      await sendMessage(chatId, t.lang_prompt);
      return;
    }
    if (arg === "en") {
      if (userId) userLang.set(userId, "en");
      await sendMessage(chatId, T.en.lang_set_en);
      return;
    }
    if (arg === "km") {
      if (userId) userLang.set(userId, "km");
      await sendMessage(chatId, T.km.lang_set_km);
      return;
    }
    await sendMessage(chatId, t.lang_invalid);
    return;
  }

  // ── /free ─────────────────────────────────────────────────────────────────
  if (rawText === "/free") {
    await sendMessage(chatId, t.free);
    return;
  }

  // ── /resethwid <KEY> ──────────────────────────────────────────────────────
  if (rawText.startsWith("/resethwid")) {
    const keyToReset = rawText.replace("/resethwid", "").trim();
    if (!keyToReset) {
      await sendMessage(chatId, t.resethwid_no_key);
      return;
    }

    await sendMessage(chatId, t.resethwid_checking);

    try {
      const res = await fetch(`${API_BASE}/reset-hwid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: keyToReset }),
      });
      const data = (await res.json()) as any;

      if (data && data.success) {
        const nextReset = data.data?.nextResetAvailable
          ? new Date(data.data.nextResetAvailable).toLocaleDateString(
              lang === "km" ? "km-KH" : "en-GB",
              { day: "2-digit", month: "short", year: "numeric" }
            )
          : lang === "km" ? "4 ថ្ងៃ ពីឥឡូវ" : "4 days from now";
        await sendMessage(chatId, t.resethwid_success(keyToReset, nextReset));
      } else {
        const errMsg = data?.error?.message || (lang === "km"
          ? "HWID Reset បរាជ័យ\\. សូមពិនិត្យ key ម្ដងទៀត\\."
          : "Failed to reset HWID\\. Check your key or try again later\\.");
        await sendMessage(chatId, t.resethwid_fail(errMsg));
      }
    } catch {
      await sendMessage(chatId, t.resethwid_server_err);
    }
    return;
  }

  // ── /verify <KEY> ─────────────────────────────────────────────────────────
  if (rawText.startsWith("/verify")) {
    const keyToTest = rawText.replace("/verify", "").trim();
    if (!keyToTest) {
      await sendMessage(chatId, t.verify_no_key);
      return;
    }

    await sendMessage(chatId, t.verify_checking);
    const res = await verifyKeyApi(keyToTest);

    if (res && res.success && res.data) {
      const d = res.data;
      const status = d.status || "ACTIVE";
      const prodName = d.product?.name || "Chiro UI";
      const exp = d.license?.expiresAt
        ? new Date(d.license.expiresAt).toLocaleDateString(lang === "km" ? "km-KH" : "en-GB")
        : lang === "km" ? "អស់កំណត់" : "Lifetime";
      const devices = `${d.license?.currentDevices || 0}/${d.license?.maxDevices || 1}`;
      await sendMessage(chatId, t.verify_valid(prodName, status, exp, devices));
    } else {
      const err = res?.error?.message || (lang === "km" ? "Key មិនត្រឹមត្រូវ\\." : "Key not found or invalid\\.");
      await sendMessage(chatId, t.verify_fail(err));
    }
    return;
  }

  // ── /redeem <CODE> or direct voucher paste ────────────────────────────────
  let codeToRedeem = "";
  if (rawText.startsWith("/redeem")) {
    codeToRedeem = rawText.replace("/redeem", "").trim();
  } else if (rawText.toUpperCase().startsWith("CHIRO-") && rawText.length >= 10) {
    codeToRedeem = rawText.trim();
  }

  if (codeToRedeem) {
    await sendMessage(chatId, t.redeem_checking);
    const result = await redeemVoucherApi(codeToRedeem, from?.id, from?.username);

    if (result && result.success && result.data) {
      const data = result.data;
      const durationStr = data.durationDays
        ? `${data.durationDays} ${lang === "km" ? "ថ្ងៃ" : "Days"}`
        : lang === "km" ? "Lifetime VIP" : "Lifetime VIP";
      await sendMessage(
        chatId,
        t.redeem_success(
          data.product?.name || "Chiro UI",
          durationStr,
          String(data.maxDevices || 1),
          data.key
        )
      );
    } else {
      const errMsg = result?.error?.message || (lang === "km"
        ? "Voucher មិនត្រឹមត្រូវ ឬត្រូវបានប្ដូររួចហើយ\\."
        : "Invalid or already redeemed voucher code\\.");
      await sendMessage(chatId, t.redeem_fail(errMsg));
    }
    return;
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  await sendMessage(chatId, t.unknown);
}

async function startPolling() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.trim() === "" || TELEGRAM_BOT_TOKEN.includes("your_")) {
    console.log("ℹ️ Telegram polling is idle. Set TELEGRAM_BOT_TOKEN in Render Dashboard -> Environment to activate the bot.");
    return;
  }

  while (isRunning) {
    const me = await callTelegramApi("getMe");
    if (!me || !me.ok) {
      console.warn("⚠️ Telegram Bot: Invalid bot token or unable to reach Telegram API. Retrying in 30s...");
      console.warn("👉 Check your TELEGRAM_BOT_TOKEN in Render Dashboard -> 'Environment' tab.");
      await new Promise((r) => setTimeout(r, 30000));
      continue;
    }

    botUsername = me.result?.username || "ChiroBot";
    botConnected = true;
    console.log(`
  🤖 ========================================================
  ⚡ CHIRO TELEGRAM REDEEM BOT ACTIVE
  👤 Bot Username: @${botUsername}
  🔗 API Base: ${API_BASE}
  🌐 Languages: English 🇺🇸 | ខ្មែរ 🇰🇭
  ========================================================
  `);
    break;
  }

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
