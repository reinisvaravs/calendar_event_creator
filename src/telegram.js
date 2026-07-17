import { config } from "./config.js";

const API_BASE = `https://api.telegram.org/bot${config.telegram.botToken}`;

// Send a plain-text (Markdown) message back to a chat.
export async function sendMessage(chatId, text) {
  const res = await fetch(`${API_BASE}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }
  return res.ok;
}

// Send a "typing…" action so the user knows we're working.
export async function sendTyping(chatId) {
  try {
    await fetch(`${API_BASE}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {
    // Non-critical, ignore.
  }
}

// Only the configured Telegram user is allowed to create events.
export function isAuthorized(update) {
  const fromId = update?.message?.from?.id;
  return String(fromId) === String(config.telegram.allowedUserId);
}
