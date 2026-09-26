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
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name?: string;
      username?: string;
    };
    message?: {
      message_id: number;
      chat: {
        id: number;
      };
    };
    data?: string;
  };
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = (process.env.API_BASE || "https://chiro-license-center.onrender.com/api/v1/client").replace(/\/$/, "");
const PORT = Number(process.env.PORT) || 10000;

let isRunning = true;
let lastUpdateId = 0;
let botUsername = "ChiroBot";
let botConnected = false;

// ── Per-user memory (in-memory) ───────────────────────────────────────────────
const userLang = new Map<number, "en" | "km">();
const userState = new Map<number, "waiting_redeem" | "waiting_resethwid" | "waiting_verify">();

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

// ── Phone Touch Menu Keyboards ────────────────────────────────────────────────
function getReplyKeyboard(lang: "en" | "km") {
  if (lang === "km") {
    return {
      keyboard: [
        [{ text: "🔑 ប្ដូរ Key" }, { text: "🆓 Key ឥតគិតថ្លៃ" }],
        [{ text: "🔄 Reset HWID" }, { text: "🔍 ពិនិត្យ Key" }],
        [{ text: "🌐 ភាសា / Language" }, { text: "ℹ️ ជំនួយ" }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };
  }
  return {
    keyboard: [
      [{ text: "🔑 Redeem Key" }, { text: "🆓 Free 24h Key" }],
      [{ text: "🔄 Reset HWID" }, { text: "🔍 Verify Key" }],
      [{ text: "🌐 ភាសា / Language" }, { text: "ℹ️ Help" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

const inlineLangKeyboard = {
  inline_keyboard: [
    [
      { text: "🇺🇸 English", callback_data: "lang_en" },
      { text: "🇰🇭 ខ្មែរ (Khmer)", callback_data: "lang_km" },
    ],
  ],
};

// ── HTML Translation table ────────────────────────────────────────────────────
const T = {
  en: {
    start: (name: string) => `⚡ <b>WELCOME TO CHIRO UI LICENSE BOT</b> ⚡

Hello, <b>${escapeHtml(name)}</b>! Tap any button below on your phone to get started:

🔑 <b>Redeem Key</b> — Turn purchase voucher into script key
🆓 <b>Free Key</b> — Generate a free 24-hour key
🔄 <b>Reset HWID</b> — Move key to new device (4-day cooldown)
🔍 <b>Verify Key</b> — Check your key status
🌐 <b>Language</b> — Switch between English and ខ្មែរ`,

    help: `📖 <b>CHIRO LICENSE BOT HELP</b>

1️⃣ <b>How to get a key?</b>
Purchase from our store to receive a voucher code (<code>CHIRO-XXXX-XXXX-XXXX</code>), or tap <b>🆓 Free 24h Key</b>!

2️⃣ <b>How to redeem?</b>
Tap <b>🔑 Redeem Key</b> and send your voucher code. The bot will exchange it for a high-security script key (<code>CHIRO_xxxxxxxx...</code>).

3️⃣ <b>How to execute in Roblox?</b>
Put this at the top of your executor:
<pre><code class="language-lua">getgenv().Key = "CHIRO_YOUR_KEY"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

4️⃣ <b>Changed PC or device?</b>
Tap <b>🔄 Reset HWID</b>. <i>(Available once every 4 days)</i>.`,

    free: `🆓 <b>CHIRO UI FREE 24-HOUR KEY</b>

Generate a free 24-hour key by completing 3 quick checkpoints:

👉 <b>Open Checkpoint Page:</b>
https://chiro-license-center.onrender.com/free-key

1. Open link above
2. Complete 3 steps (15s wait each)
3. Copy your free key!`,

    lang_prompt: `🌐 <b>Select your preferred language:</b>`,
    lang_set_en: `✅ Language set to <b>English</b> 🇺🇸`,
    lang_set_km: `✅ បានប្ដូរភាសាទៅ <b>ខ្មែរ</b> 🇰🇭`,

    prompt_redeem: `🔑 <b>Please send your purchase voucher code:</b>\n<i>Example: CHIRO-RA3H-RUEY-ESKF</i>`,
    prompt_resethwid: `🔄 <b>Please send your script key to reset HWID:</b>\n<i>Example: CHIRO_7d672a9d2743ddd3b50c2710</i>`,
    prompt_verify: `🔍 <b>Please send your script key to verify:</b>\n<i>Example: CHIRO_7d672a9d2743ddd3b50c2710</i>`,

    resethwid_checking: `🔄 <b>Resetting your HWID...</b>`,
    resethwid_success: (key: string, nextDate: string) =>
      `✅ <b>HWID Reset Successful!</b>

Your key <code>${escapeHtml(key)}</code> has been unlinked from all devices.

📱 You can now activate it on your new device.
⏳ <b>Next reset available:</b> ${escapeHtml(nextDate)}`,
    resethwid_fail: (msg: string) => `❌ <b>HWID Reset Failed</b>\n\n${escapeHtml(msg)}`,
    resethwid_server_err: `❌ <b>Server Error</b>\n\nCould not reach license server. Please try again.`,

    verify_checking: `🔍 <b>Checking key status on server...</b>`,
    verify_valid: (prod: string, status: string, exp: string, devices: string) =>
      `✅ <b>LICENSE VALID</b>\n\n📦 <b>Product:</b> ${escapeHtml(prod)}\n🟢 <b>Status:</b> ${escapeHtml(status)}\n⏳ <b>Expires:</b> ${escapeHtml(exp)}\n📱 <b>Devices:</b> ${escapeHtml(devices)}`,
    verify_fail: (msg: string) => `❌ <b>Key Verification Failed</b>\n\n${escapeHtml(msg)}`,

    redeem_checking: `⏳ <b>Verifying and redeeming your voucher...</b>`,
    redeem_success: (prod: string, dur: string, slots: string, key: string) =>
      `🎉 <b>PURCHASE VOUCHER REDEEMED!</b>

📦 <b>Product:</b> ${escapeHtml(prod)}
⏳ <b>Duration:</b> ${escapeHtml(dur)}
📱 <b>Device Slots:</b> ${escapeHtml(slots)}

🔑 <b>Your Script Key:</b>
<code>${escapeHtml(key)}</code>
<i>(Tap key above to copy)</i>

📋 <b>How to execute:</b>
<pre><code class="language-lua">getgenv().Key = "${escapeHtml(key)}"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

⚠️ <b>Save this key!</b> Your voucher code has been consumed.`,
    redeem_fail: (msg: string) =>
      `❌ <b>Redeem Failed</b>\n\n${escapeHtml(msg)}\n\nPlease check your purchase code and try again.`,

    unknown: `❓ Please select an option from the menu buttons below, or send your voucher code directly!`,
  },

  km: {
    start: (name: string) => `⚡ <b>សូមស្វាគមន៍មកកាន់ CHIRO UI LICENSE BOT</b> ⚡

សួស្ដី, <b>${escapeHtml(name)}</b>! ចុចប៊ូតុងខាងក្រោមលើទូរស័ព្ទដើម្បីចាប់ផ្ដើម:

🔑 <b>ប្ដូរ Key</b> — ប្ដូរ voucher ទៅជា script key សុវត្ថិភាព
🆓 <b>Key ឥតគិតថ្លៃ</b> — ទទួល key ឥតគិតថ្លៃ 24 ម៉ោង
🔄 <b>Reset HWID</b> — ដោះចំណងឧបករណ៍ (រង់ចាំ 4 ថ្ងៃ)
🔍 <b>ពិនិត្យ Key</b> — ពិនិត្យស្ថានភាព key របស់អ្នក
🌐 <b>ភាសា</b> — ប្ដូររវាងភាសា ខ្មែរ និង English`,

    help: `📖 <b>ជំនួយ CHIRO LICENSE BOT</b>

1️⃣ <b>តើត្រូវទិញ key យ៉ាងណា?</b>
ទិញពីហាងផ្លូវការដើម្បីទទួល voucher code (<code>CHIRO-XXXX-XXXX-XXXX</code>) ឬចុច <b>🆓 Key ឥតគិតថ្លៃ</b>!

2️⃣ <b>តើត្រូវប្ដូរ voucher យ៉ាងណា?</b>
ចុច <b>🔑 ប្ដូរ Key</b> រួចផ្ញើ voucher code របស់អ្នក។ Bot នឹងប្ដូរទៅជា script key (<code>CHIRO_xxxxxxxx...</code>)។

3️⃣ <b>តើត្រូវ execute ក្នុង Roblox យ៉ាងណា?</b>
ដាក់កូដនេះនៅកំពូល executor របស់អ្នក:
<pre><code class="language-lua">getgenv().Key = "CHIRO_YOUR_KEY"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

4️⃣ <b>ប្ដូរទូរស័ព្ទ ឬកុំព្យូទ័រថ្មី?</b>
ចុច <b>🔄 Reset HWID</b> <i>(អាចធ្វើបាន 4 ថ្ងៃម្ដង)</i>។`,

    free: `🆓 <b>CHIRO UI KEY ឥតគិតថ្លៃ 24 ម៉ោង</b>

ទទួលបាន key ឥតគិតថ្លៃ 24 ម៉ោង ដោយបំពេញ 3 ជំហានរហ័ស:

👉 <b>បើកទំព័រ Checkpoint:</b>
https://chiro-license-center.onrender.com/free-key

1. បើក link ខាងលើ
2. បំពេញ 3 ជំហាន (រង់ចាំ 15 វិនាទីនីមួយៗ)
3. Copy key យកទៅប្រើភ្លាមៗ!`,

    lang_prompt: `🌐 <b>សូមជ្រើសរើសភាសាដែលអ្នកចង់ប្រើ:</b>`,
    lang_set_en: `✅ Language set to <b>English</b> 🇺🇸`,
    lang_set_km: `✅ បានប្ដូរភាសាទៅ <b>ខ្មែរ</b> 🇰🇭`,

    prompt_redeem: `🔑 <b>សូមផ្ញើ voucher code របស់អ្នក:</b>\n<i>ឧទាហរណ៍: CHIRO-RA3H-RUEY-ESKF</i>`,
    prompt_resethwid: `🔄 <b>សូមផ្ញើ script key របស់អ្នកដើម្បី Reset HWID:</b>\n<i>ឧទាហរណ៍: CHIRO_7d672a9d2743ddd3b50c2710</i>`,
    prompt_verify: `🔍 <b>សូមផ្ញើ script key របស់អ្នកដើម្បីពិនិត្យ:</b>\n<i>ឧទាហរណ៍: CHIRO_7d672a9d2743ddd3b50c2710</i>`,

    resethwid_checking: `🔄 <b>កំពុង Reset HWID...</b>`,
    resethwid_success: (key: string, nextDate: string) =>
      `✅ <b>Reset HWID បានជោគជ័យ!</b>

Key <code>${escapeHtml(key)}</code> ត្រូវបានដោះចេញពីឧបករណ៍ទាំងអស់។

📱 អ្នកអាចយកទៅ activate លើឧបករណ៍ថ្មីបានហើយ។
⏳ <b>Reset បន្ទាប់អាចធ្វើបាននៅ:</b> ${escapeHtml(nextDate)}`,
    resethwid_fail: (msg: string) => `❌ <b>Reset HWID បរាជ័យ</b>\n\n${escapeHtml(msg)}`,
    resethwid_server_err: `❌ <b>Server Error</b>\n\nមិនអាចភ្ជាប់ server បានទេ។ សូមព្យាយាមម្ដងទៀត។`,

    verify_checking: `🔍 <b>កំពុងពិនិត្យ key...</b>`,
    verify_valid: (prod: string, status: string, exp: string, devices: string) =>
      `✅ <b>LICENSE ត្រឹមត្រូវ</b>\n\n📦 <b>ផលិតផល:</b> ${escapeHtml(prod)}\n🟢 <b>ស្ថានភាព:</b> ${escapeHtml(status)}\n⏳ <b>ផុតកំណត់:</b> ${escapeHtml(exp)}\n📱 <b>ឧបករណ៍:</b> ${escapeHtml(devices)}`,
    verify_fail: (msg: string) => `❌ <b>ការពិនិត្យ Key បរាជ័យ</b>\n\n${escapeHtml(msg)}`,

    redeem_checking: `⏳ <b>កំពុងផ្ទៀងផ្ទាត់ និងប្ដូរ voucher...</b>`,
    redeem_success: (prod: string, dur: string, slots: string, key: string) =>
      `🎉 <b>VOUCHER ត្រូវបានប្ដូរ!</b>

📦 <b>ផលិតផល:</b> ${escapeHtml(prod)}
⏳ <b>រយៈពេល:</b> ${escapeHtml(dur)}
📱 <b>ចំនួនម៉ាស៊ីន:</b> ${escapeHtml(slots)}

🔑 <b>Script Key របស់អ្នក:</b>
<code>${escapeHtml(key)}</code>
<i>(ចុចលើ key ដើម្បី copy)</i>

📋 <b>របៀប execute ក្នុង Roblox:</b>
<pre><code class="language-lua">getgenv().Key = "${escapeHtml(key)}"
local Chiro = loadstring(game:HttpGet("https://raw.githubusercontent.com/leviiexesc/chiro_UI/main/chiro_lib.luau"))()</code></pre>

⚠️ <b>សំខាន់:</b> រក្សាទុក key របស់អ្នក! Voucher ដើមត្រូវបានប្រើរួចហើយ។`,
    redeem_fail: (msg: string) =>
      `❌ <b>ការប្ដូរ Voucher បរាជ័យ</b>\n\n${escapeHtml(msg)}\n\nសូមពិនិត្យ code ម្ដងទៀត។`,

    unknown: `❓ សូមចុចលើប៊ូតុង menu ខាងក្រោម ឬផ្ញើ voucher code ដោយផ្ទាល់!`,
  },
};

// ── Health Check Server ───────────────────────────────────────────────────────
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
  }, 14 * 60 * 1000);
});

// ── Telegram API Helpers ──────────────────────────────────────────────────────
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

async function sendMessage(
  chatId: number | string,
  htmlText: string,
  replyMarkup?: Record<string, unknown>
) {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  const result = await callTelegramApi("sendMessage", payload);

  if (!result || !result.ok) {
    console.warn(`⚠️ HTML parse failed on Telegram. Retrying as plain text...`);
    const plainText = htmlText.replace(/<[^>]*>/g, "");
    payload.text = plainText;
    delete payload.parse_mode;
    return await callTelegramApi("sendMessage", payload);
  }
  return result;
}

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return await callTelegramApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

// ── Backend API Helpers ───────────────────────────────────────────────────────
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

// ── Handle Callback Queries (Inline Language Buttons) ─────────────────────────
async function handleCallbackQuery(cb: NonNullable<TelegramUpdate["callback_query"]>) {
  const userId = cb.from.id;
  const chatId = cb.message?.chat.id;
  const data = cb.data;

  if (data === "lang_en") {
    userLang.set(userId, "en");
    await answerCallbackQuery(cb.id, "Language set to English 🇺🇸");
    if (chatId) {
      await sendMessage(chatId, T.en.lang_set_en, getReplyKeyboard("en"));
    }
    return;
  }

  if (data === "lang_km") {
    userLang.set(userId, "km");
    await answerCallbackQuery(cb.id, "បានប្ដូរភាសាទៅ ខ្មែរ 🇰🇭");
    if (chatId) {
      await sendMessage(chatId, T.km.lang_set_km, getReplyKeyboard("km"));
    }
    return;
  }

  await answerCallbackQuery(cb.id);
}

// ── Handle Incoming Messages ──────────────────────────────────────────────────
async function handleMessage(msg: NonNullable<TelegramUpdate["message"]>) {
  const chatId = msg.chat.id;
  const rawText = (msg.text || "").trim();
  const from = msg.from;
  const userId = from?.id;
  const username = from?.username ? `@${from.username}` : from?.first_name || "User";
  const lang = getLang(userId);
  const t = T[lang];
  const keyboard = getReplyKeyboard(lang);

  console.log(`📩 [${username}]: "${rawText}" [Lang: ${lang}]`);

  // 1. /start
  if (rawText === "/start" || rawText.startsWith("/start ")) {
    if (userId) userState.delete(userId);
    await sendMessage(chatId, t.start(username), keyboard);
    return;
  }

  // 2. /help or button ℹ️ Help / ℹ️ ជំនួយ
  if (rawText === "/help" || rawText === "ℹ️ Help" || rawText === "ℹ️ ជំនួយ") {
    if (userId) userState.delete(userId);
    await sendMessage(chatId, t.help, keyboard);
    return;
  }

  // 3. /free or button 🆓 Free 24h Key / 🆓 Key ឥតគិតថ្លៃ
  if (rawText === "/free" || rawText === "🆓 Free 24h Key" || rawText === "🆓 Key ឥតគិតថ្លៃ") {
    if (userId) userState.delete(userId);
    await sendMessage(chatId, t.free, keyboard);
    return;
  }

  // 4. /lang or button 🌐 ភាសា / Language
  if (rawText.startsWith("/lang") || rawText === "🌐 ភាសា / Language") {
    if (userId) userState.delete(userId);
    const arg = rawText.replace("/lang", "").trim().toLowerCase();
    if (arg === "en") {
      if (userId) userLang.set(userId, "en");
      await sendMessage(chatId, T.en.lang_set_en, getReplyKeyboard("en"));
      return;
    }
    if (arg === "km") {
      if (userId) userLang.set(userId, "km");
      await sendMessage(chatId, T.km.lang_set_km, getReplyKeyboard("km"));
      return;
    }
    // Show inline picker buttons
    await sendMessage(chatId, t.lang_prompt, inlineLangKeyboard);
    return;
  }

  // 5. Button tap: 🔑 Redeem Key / 🔑 ប្ដូរ Key
  if (rawText === "🔑 Redeem Key" || rawText === "🔑 ប្ដូរ Key") {
    if (userId) userState.set(userId, "waiting_redeem");
    await sendMessage(chatId, t.prompt_redeem, keyboard);
    return;
  }

  // 6. Button tap: 🔄 Reset HWID
  if (rawText === "🔄 Reset HWID") {
    if (userId) userState.set(userId, "waiting_resethwid");
    await sendMessage(chatId, t.prompt_resethwid, keyboard);
    return;
  }

  // 7. Button tap: 🔍 Verify Key / 🔍 ពិនិត្យ Key
  if (rawText === "🔍 Verify Key" || rawText === "🔍 ពិនិត្យ Key") {
    if (userId) userState.set(userId, "waiting_verify");
    await sendMessage(chatId, t.prompt_verify, keyboard);
    return;
  }

  // Check state if user previously pressed a button
  const pendingState = userId ? userState.get(userId) : undefined;

  // ── Handle /resethwid or pending state ──────────────────────────────────────
  let keyToReset = "";
  if (rawText.startsWith("/resethwid")) {
    keyToReset = rawText.replace("/resethwid", "").trim();
  } else if (pendingState === "waiting_resethwid") {
    keyToReset = rawText;
    if (userId) userState.delete(userId);
  }

  if (keyToReset) {
    await sendMessage(chatId, t.resethwid_checking, keyboard);
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
        await sendMessage(chatId, t.resethwid_success(keyToReset, nextReset), keyboard);
      } else {
        const errMsg = data?.error?.message || (lang === "km"
          ? "HWID Reset បរាជ័យ។ សូមពិនិត្យ key ម្ដងទៀត។"
          : "Failed to reset HWID. Check your key or try again later.");
        await sendMessage(chatId, t.resethwid_fail(errMsg), keyboard);
      }
    } catch {
      await sendMessage(chatId, t.resethwid_server_err, keyboard);
    }
    return;
  }

  // ── Handle /verify or pending state ─────────────────────────────────────────
  let keyToVerify = "";
  if (rawText.startsWith("/verify")) {
    keyToVerify = rawText.replace("/verify", "").trim();
  } else if (pendingState === "waiting_verify") {
    keyToVerify = rawText;
    if (userId) userState.delete(userId);
  }

  if (keyToVerify) {
    await sendMessage(chatId, t.verify_checking, keyboard);
    const res = await verifyKeyApi(keyToVerify);

    if (res && res.success && res.data) {
      const d = res.data;
      const status = d.status || "ACTIVE";
      const prodName = d.product?.name || "Chiro UI";
      const exp = d.license?.expiresAt
        ? new Date(d.license.expiresAt).toLocaleDateString(lang === "km" ? "km-KH" : "en-GB")
        : lang === "km" ? "គ្មានកំណត់" : "Lifetime";
      const devices = `${d.license?.currentDevices || 0}/${d.license?.maxDevices || 1}`;
      await sendMessage(chatId, t.verify_valid(prodName, status, exp, devices), keyboard);
    } else {
      const err = res?.error?.message || (lang === "km" ? "Key មិនត្រឹមត្រូវ។" : "Key not found or invalid.");
      await sendMessage(chatId, t.verify_fail(err), keyboard);
    }
    return;
  }

  // ── Handle /redeem or voucher paste or pending state ────────────────────────
  let codeToRedeem = "";
  if (rawText.startsWith("/redeem")) {
    codeToRedeem = rawText.replace("/redeem", "").trim();
  } else if (rawText.toUpperCase().startsWith("CHIRO-") && rawText.length >= 10) {
    codeToRedeem = rawText;
  } else if (pendingState === "waiting_redeem") {
    codeToRedeem = rawText;
    if (userId) userState.delete(userId);
  }

  if (codeToRedeem) {
    await sendMessage(chatId, t.redeem_checking, keyboard);
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
        ),
        keyboard
      );
    } else {
      const errMsg = result?.error?.message || (lang === "km"
        ? "Voucher មិនត្រឹមត្រូវ ឬត្រូវបានប្ដូររួចហើយ។"
        : "Invalid or already redeemed voucher code.");
      await sendMessage(chatId, t.redeem_fail(errMsg), keyboard);
    }
    return;
  }

  // Fallback
  await sendMessage(chatId, t.unknown, keyboard);
}

// ── Polling Loop ──────────────────────────────────────────────────────────────
async function startPolling() {
  if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.trim() === "" || TELEGRAM_BOT_TOKEN.includes("your_")) {
    console.log("ℹ️ Telegram polling is idle. Set TELEGRAM_BOT_TOKEN in Render Dashboard -> Environment.");
    return;
  }

  while (isRunning) {
    const me = await callTelegramApi("getMe");
    if (!me || !me.ok) {
      console.warn("⚠️ Telegram Bot: Invalid bot token or unable to reach Telegram API. Retrying in 30s...");
      await new Promise((r) => setTimeout(r, 30000));
      continue;
    }

    botUsername = me.result?.username || "ChiroBot";
    botConnected = true;

    // Clear webhook so getUpdates receives messages
    const webhookRes = await callTelegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("📡 Telegram Webhook cleared:", webhookRes?.ok ? "OK" : webhookRes?.description);

    // Register native Telegram [/] Menu commands
    await callTelegramApi("setMyCommands", {
      commands: [
        { command: "start", description: "Open Main Menu / បើកម៉ឺនុយ" },
        { command: "redeem", description: "Redeem Voucher / ប្ដូរ Key" },
        { command: "free", description: "Free 24h Key / Key ឥតគិតថ្លៃ" },
        { command: "verify", description: "Verify Key / ពិនិត្យ Key" },
        { command: "resethwid", description: "Reset HWID (4-day cooldown)" },
        { command: "lang", description: "Language / ប្តូរភាសា" },
        { command: "help", description: "Help / ជំនួយ" },
      ],
    });
    console.log("📋 Telegram [/] Menu commands registered.");

    console.log(`
  🤖 ========================================================
  ⚡ CHIRO TELEGRAM REDEEM BOT ACTIVE
  👤 Bot Username: @${botUsername}
  🔗 API Base: ${API_BASE}
  📱 Phone Menu: Touch Buttons + Telegram [/] Menu
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
        allowed_updates: ["message", "callback_query"],
      });

      if (data && data.ok && Array.isArray(data.result)) {
        for (const update of data.result as TelegramUpdate[]) {
          lastUpdateId = update.update_id;

          if (update.callback_query) {
            await handleCallbackQuery(update.callback_query);
          } else if (update.message && update.message.text) {
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
