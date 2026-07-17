import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name, fallback) {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : fallback;
}

// Google service account credentials can be provided either as raw JSON
// or base64-encoded JSON (easier to paste into Render's env UI).
function loadServiceAccount() {
  const raw = required("GOOGLE_SERVICE_ACCOUNT_JSON");
  let text = raw;
  if (!raw.trimStart().startsWith("{")) {
    // Assume base64
    text = Buffer.from(raw, "base64").toString("utf8");
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64-encoded JSON)."
    );
  }
}

export const config = {
  port: parseInt(optional("PORT", "3000"), 10),

  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    allowedUserId: required("TELEGRAM_ALLOWED_USER_ID"),
    // Secret embedded in the webhook path so random traffic can't hit it.
    webhookSecret: required("TELEGRAM_WEBHOOK_SECRET"),
  },

  openai: {
    apiKey: required("OPENAI_API_KEY"),
    model: optional("OPENAI_MODEL", "gpt-4o-mini"),
  },

  google: {
    serviceAccount: loadServiceAccount(),
    calendarId: required("GOOGLE_CALENDAR_ID"),
  },

  defaultTimezone: optional("DEFAULT_TIMEZONE", "UTC"),
};
