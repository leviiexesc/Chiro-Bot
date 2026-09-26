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

function escapeHtml(str: string): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── HTML Translation table ────────────────────────────────────────────────────
const T = {
  en: {
    // /start
    start: (name: string) => `⚡ <b>WELCOME TO CHIRO UI LICENSE BOT</b> ⚡

Hello, <b>${escapeHtml(name)}</b>! This bot lets you redeem purchase vouchers into high-security script keys.

<b>Available Commands:</b>
🔑 <code>/redeem &lt;CODE&gt;</code> — Redeem your purchase voucher
🆓 <code>/free</code> — Get a Free 24-Hour Key
🔍 <code>/verify &lt;KEY&gt;</code> — Check your key status
🔄 <code>/resethwid &lt;KEY&gt;</code> — Reset HWID <i>(4-day cooldown)</i>
🌐 <code>/lang</code> — Change language / ប្តូរភាសា
ℹ️ <code>/help</code> — How to use this bot

<b>Example:</b>
<code>/redeem CHIRO-RA3H-RUEY-ESKF</code>

<i>You can also paste your voucher code directly without typing /redeem!</i>`,

    // /help
    help: `📖 <b>CHIRO LICENSE BOT HELP</b>

1️⃣ <b>How do I buy a key?</b>
Purchase from our store. You will receive a voucher code like <code>CHIRO-XXXX-XXXX-XXXX</code>.

2️⃣ <b>How do I redeem it?</b>
Send: <code>/redeem YOUR-CODE</code>
The bot will exchange it for a secure script key (<code>CHIRO_xxxxxxxx...</code>).

3️⃣ <b>How do I run it in Roblox?</b>
Add this at the top of your executor:
<pre><code class="language-lua">getgenv().Key = "CHIRO_YOUR_KEY"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

4️⃣ <b>Need a Free Key?</b>
Type <code>/free</code> to generate a free 24-hour key.

5️⃣ <b>Changed PC / Device?</b>
Use <code>/resethwid CHIRO_YOUR_KEY</code>
⚠️ <i>Cooldown: 4 days between resets.</i>`,

    // /free
    free: `🆓 <b>CHIRO UI FREE 24-HOUR KEY</b>

Generate a free 24-hour key by completing 3 quick checkpoints:

👉 <b>Checkpoint Generator:</b>
https://chiro-license-center.onrender.com/free-key

1. Open the page above
2. Complete the steps (15s wait each)
3. Receive your free key instantly!`,

    // /lang
    lang_prompt: `🌐 <b>SELECT LANGUAGE / ជ្រើសរើសភាសា</b>

Please reply with a command:
1️⃣ <code>/lang en</code> — 🇺🇸 English
2️⃣ <code>/lang km</code> — 🇰🇭 ខ្មែរ (Khmer)`,
    lang_set_en: `✅ Language set to <b>English</b> 🇺🇸`,
    lang_set_km: `✅ បានប្ដូរភាសាទៅ <b>ខ្មែរ</b> 🇰🇭`,
    lang_invalid: `⚠️ Unknown language. Use <code>/lang en</code> or <code>/lang km</code>`,

    // /resethwid
    resethwid_no_key: `⚠️ Please provide your script key.
Example: <code>/resethwid CHIRO_7d672a9d2743ddd3b50c2710</code>`,
    resethwid_checking: `🔄 <b>Resetting your HWID...</b>`,
    resethwid_success: (key: string, nextDate: string) =>
      `✅ <b>HWID Reset Successful!</b>

Your key <code>${escapeHtml(key)}</code> has been unlinked from all devices.

📱 You can now activate it on your new device.
⏳ <b>Next reset available:</b> ${escapeHtml(nextDate)}`,
    resethwid_fail: (msg: string) => `❌ <b>HWID Reset Failed</b>\n\n${escapeHtml(msg)}`,
    resethwid_server_err: `❌ <b>Server Error</b>\n\nCould not reach the license server. Please try again later.`,

    // /verify
    verify_no_key: `⚠️ Please provide a key to verify.
Example: <code>/verify CHIRO_7d672a9d2743ddd3b50c2710</code>`,
    verify_checking: `🔍 <b>Checking key status on server...</b>`,
    verify_valid: (prod: string, status: string, exp: string, devices: string) =>
      `✅ <b>LICENSE VALID</b>\n\n📦 <b>Product:</b> ${escapeHtml(prod)}\n🟢 <b>Status:</b> ${escapeHtml(status)}\n⏳ <b>Expires:</b> ${escapeHtml(exp)}\n📱 <b>Devices Bound:</b> ${escapeHtml(devices)}`,
    verify_fail: (msg: string) => `❌ <b>Key Verification Failed</b>\n\n${escapeHtml(msg)}`,

    // /redeem
    redeem_checking: `⏳ <b>Verifying and redeeming your voucher...</b>`,
    redeem_success: (prod: string, dur: string, slots: string, key: string) =>
      `🎉 <b>PURCHASE VOUCHER REDEEMED!</b>

📦 <b>Product:</b> ${escapeHtml(prod)}
⏳ <b>Duration:</b> ${escapeHtml(dur)}
📱 <b>Device Slots:</b> ${escapeHtml(slots)}

🔑 <b>Your High-Security Script Key:</b>
<code>${escapeHtml(key)}</code>
<i>(Tap key above to copy)</i>

📋 <b>How to execute in your script:</b>
<pre><code class="language-lua">getgenv().Key = "${escapeHtml(key)}"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

⚠️ <b>Important:</b> Save your key! Your original purchase code has been consumed.`,
    redeem_fail: (msg: string) =>
      `❌ <b>Redeem Failed</b>\n\n${escapeHtml(msg)}\n\nPlease check your purchase code and try again or contact support.`,

    // unknown
    unknown: `❓ Unrecognized command. Send <code>/redeem &lt;CODE&gt;</code> to redeem your voucher, or <code>/help</code> for instructions.`,
  },

  km: {
    // /start
    start: (name: string) => `⚡ <b>សូមស្វាគមន៍មកកាន់ CHIRO UI LICENSE BOT</b> ⚡

សួស្ដី, <b>${escapeHtml(name)}</b>! Bot នេះអនុញ្ញាតឱ្យអ្នកដូរ voucher ទៅជា script key សុវត្ថិភាពខ្ពស់។

<b>ពាក្យបញ្ជាដែលមាន:</b>
🔑 <code>/redeem &lt;CODE&gt;</code> — ប្ដូរ voucher របស់អ្នក
🆓 <code>/free</code> — ទទួល Key ឥតគិតថ្លៃ 24 ម៉ោង
🔍 <code>/verify &lt;KEY&gt;</code> — ពិនិត្យស្ថានភាព key
🔄 <code>/resethwid &lt;KEY&gt;</code> — កំណត់ HWID ឡើងវិញ <i>(រង់ចាំ 4 ថ្ងៃ)</i>
🌐 <code>/lang</code> — ប្ដូរភាសា / Change language
ℹ️ <code>/help</code> — របៀបប្រើ bot

<b>ឧទាហរណ៍:</b>
<code>/redeem CHIRO-RA3H-RUEY-ESKF</code>

<i>អ្នកក៏អាចផ្ញើ voucher code ដោយផ្ទាល់ ដោយមិនចាំបាច់វាយ /redeem!</i>`,

    // /help
    help: `📖 <b>ជំនួយ CHIRO LICENSE BOT</b>

1️⃣ <b>តើខ្ញុំទិញ key យ៉ាងដូចម្ដេច?</b>
ទិញពីហាងផ្លូវការ។ អ្នកនឹងទទួលបាន voucher code ដូចជា <code>CHIRO-XXXX-XXXX-XXXX</code>។

2️⃣ <b>តើខ្ញុំប្ដូរ voucher យ៉ាងដូចម្ដេច?</b>
ផ្ញើ: <code>/redeem YOUR-CODE</code>
Bot នឹងប្ដូរ voucher ទៅជា script key (<code>CHIRO_xxxxxxxx...</code>)។

3️⃣ <b>តើខ្ញុំប្រើ key ក្នុង Roblox យ៉ាងដូចម្ដេច?</b>
បន្ថែមកូដនេះនៅកំពូល executor របស់អ្នក:
<pre><code class="language-lua">getgenv().Key = "CHIRO_YOUR_KEY"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

4️⃣ <b>Key ឥតគិតថ្លៃ?</b>
វាយ <code>/free</code> ដើម្បីទទួលបាន key ឥតគិតថ្លៃ 24 ម៉ោង។

5️⃣ <b>ប្ដូរ PC / ឧបករណ៍ថ្មី?</b>
ប្រើ <code>/resethwid CHIRO_YOUR_KEY</code>
⚠️ <i>ត្រូវរង់ចាំ 4 ថ្ងៃ រវាងការ reset។</i>`,

    // /free
    free: `🆓 <b>CHIRO UI KEY ឥតគិតថ្លៃ 24 ម៉ោង</b>

ទទួលបាន key ឥតគិតថ្លៃ 24 ម៉ោង ដោយបំពេញ 3 ជំហានរហ័ស:

👉 <b>Checkpoint Generator:</b>
https://chiro-license-center.onrender.com/free-key

1. បើកទំព័រខាងលើ
2. បំពេញជំហានទាំង 3 (រង់ចាំ 15 វិនាទីនីមួយៗ)
3. ទទួលបាន key ភ្លាមៗ!`,

    // /lang
    lang_prompt: `🌐 <b>ជ្រើសរើសភាសា / SELECT LANGUAGE</b>

សូមឆ្លើយតបជាមួយពាក្យបញ្ជា:
1️⃣ <code>/lang en</code> — 🇺🇸 English
2️⃣ <code>/lang km</code> — 🇰🇭 ខ្មែរ (Khmer)`,
    lang_set_en: `✅ Language set to <b>English</b> 🇺🇸`,
    lang_set_km: `✅ បានប្ដូរភាសាទៅ <b>ខ្មែរ</b> 🇰🇭`,
    lang_invalid: `⚠️ ភាសាមិនត្រឹមត្រូវ។ ប្រើ <code>/lang en</code> ឬ <code>/lang km</code>`,

    // /resethwid
    resethwid_no_key: `⚠️ សូមផ្ដល់ script key របស់អ្នក។
ឧទាហរណ៍: <code>/resethwid CHIRO_7d672a9d2743ddd3b50c2710</code>`,
    resethwid_checking: `🔄 <b>កំពុង Reset HWID...</b>`,
    resethwid_success: (key: string, nextDate: string) =>
      `✅ <b>Reset HWID បានជោគជ័យ!</b>

Key <code>${escapeHtml(key)}</code> ត្រូវបានដោះចំណងពីឧបករណ៍ទាំងអស់។

📱 អ្នកអាចយកទៅប្រើលើឧបករណ៍ថ្មីបានហើយ។
⏳ <b>Reset បន្ទាប់អាចធ្វើបាននៅ:</b> ${escapeHtml(nextDate)}`,
    resethwid_fail: (msg: string) => `❌ <b>Reset HWID បរាជ័យ</b>\n\n${escapeHtml(msg)}`,
    resethwid_server_err: `❌ <b>Server Error</b>\n\nមិនអាចភ្ជាប់ server។ សូមព្យាយាមម្ដងទៀត។`,

    // /verify
    verify_no_key: `⚠️ សូមផ្ដល់ key ដើម្បីពិនិត្យ។
ឧទាហរណ៍: <code>/verify CHIRO_7d672a9d2743ddd3b50c2710</code>`,
    verify_checking: `🔍 <b>កំពុងពិនិត្យ key...</b>`,
    verify_valid: (prod: string, status: string, exp: string, devices: string) =>
      `✅ <b>LICENSE ត្រឹមត្រូវ</b>\n\n📦 <b>ផលិតផល:</b> ${escapeHtml(prod)}\n🟢 <b>ស្ថានភាព:</b> ${escapeHtml(status)}\n⏳ <b>អស់សុពលភាព:</b> ${escapeHtml(exp)}\n📱 <b>ឧបករណ៍ចូលភ្ជាប់:</b> ${escapeHtml(devices)}`,
    verify_fail: (msg: string) => `❌ <b>ការពិនិត្យ Key បរាជ័យ</b>\n\n${escapeHtml(msg)}`,

    // /redeem
    redeem_checking: `⏳ <b>កំពុងផ្ទៀងផ្ទាត់ និងប្ដូរ voucher...</b>`,
    redeem_success: (prod: string, dur: string, slots: string, key: string) =>
      `🎉 <b>VOUCHER ត្រូវបានប្ដូរ!</b>

📦 <b>ផលិតផល:</b> ${escapeHtml(prod)}
⏳ <b>រយៈពេល:</b> ${escapeHtml(dur)}
📱 <b>ចំនួនម៉ាស៊ីន:</b> ${escapeHtml(slots)}

🔑 <b>Script Key សុវត្ថិភាពរបស់អ្នក:</b>
<code>${escapeHtml(key)}</code>
<i>(ចុចលើ key ដើម្បី copy)</i>

📋 <b>របៀប execute ក្នុង Roblox:</b>
<pre><code class="language-lua">getgenv().Key = "${escapeHtml(key)}"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

⚠️ <b>សំខាន់:</b> រក្សាទុក key របស់អ្នក! Voucher ដើមត្រូវបានប្រើរួចហើយ។`,
    redeem_fail: (msg: string) =>
      `❌ <b>ការប្ដូរ Voucher បរាជ័យ</b>\n\n${escapeHtml(msg)}\n\nសូមពិនិត្យ code ម្ដងទៀត ឬទាក់ទង support។`,

    // unknown
    unknown: `❓ ពាក្យបញ្ជាមិនត្រឹមត្រូវ។ ផ្ញើ <code>/redeem &lt;CODE&gt;</code> ដើម្បីប្ដូរ voucher, ឬ <code>/help</code> សម្រាប់ការណែនាំ។`,
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
    const json = (await res.json()) as any;
    if (!json.ok) {
      console.error(`❌ Telegram API Error (${method}):`, json.description || json);
    }
    return json;
  } catch (err) {
    console.error(`❌ Telegram Network Error (${method}):`, err);
    return null;
  }
}

async function sendMessage(chatId: number | string, htmlText: string) {
  const result = await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });

  // If HTML parse fails, automatically retry as plain text so the user ALWAYS gets the response!
  if (!result || !result.ok) {
    console.warn(`⚠️ HTML parse failed on Telegram. Retrying as plain text...`);
    const plainText = htmlText.replace(/<[^>]*>/g, "");
    return await callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: plainText,
      disable_web_page_preview: true,
    });
  }

  return result;
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

  console.log(`📩 Incoming message from ${username} (${chatId}): "${rawText}" [Lang: ${lang}]`);

  // ── /start ────────────────────────────────────────────────────────────────
  if (rawText === "/start" || rawText.startsWith("/start ")) {
    await sendMessage(chatId, t.start(username));
    return;
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (rawText === "/help" || rawText.startsWith("/help ")) {
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
  if (rawText === "/free" || rawText.startsWith("/free ")) {
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
          ? "HWID Reset បរាជ័យ។ សូមពិនិត្យ key ម្ដងទៀត។"
          : "Failed to reset HWID. Check your key or try again later.");
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
        : lang === "km" ? "គ្មានកំណត់" : "Lifetime";
      const devices = `${d.license?.currentDevices || 0}/${d.license?.maxDevices || 1}`;
      await sendMessage(chatId, t.verify_valid(prodName, status, exp, devices));
    } else {
      const err = res?.error?.message || (lang === "km" ? "Key មិនត្រឹមត្រូវ។" : "Key not found or invalid.");
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
        : "Lifetime VIP";
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
        ? "Voucher មិនត្រឹមត្រូវ ឬត្រូវបានប្ដូររួចហើយ។"
        : "Invalid or already redeemed voucher code.");
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

    // IMPORTANT: Clear any existing webhook so getUpdates receives messages!
    const webhookRes = await callTelegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("📡 Telegram Webhook cleared:", webhookRes?.ok ? "OK" : webhookRes?.description);

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
      } else if (data && !data.ok) {
        console.warn("⚠️ getUpdates warning:", data.description);
        await new Promise((r) => setTimeout(r, 3000));
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
