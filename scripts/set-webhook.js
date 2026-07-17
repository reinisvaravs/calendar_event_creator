// One-time helper to register your Render URL as the Telegram webhook.
// Usage: PUBLIC_URL=https://your-app.onrender.com npm run set-webhook
import { config } from "../src/config.js";

const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "");
if (!publicUrl) {
  console.error("Set PUBLIC_URL to your deployed base URL, e.g.");
  console.error("  PUBLIC_URL=https://your-app.onrender.com npm run set-webhook");
  process.exit(1);
}

const webhookUrl = `${publicUrl}/telegram/webhook/${config.telegram.webhookSecret}`;
const api = `https://api.telegram.org/bot${config.telegram.botToken}/setWebhook`;

const res = await fetch(api, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    allowed_updates: ["message"],
    drop_pending_updates: true,
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (data.ok) {
  console.log(`\n✅ Webhook set to: ${webhookUrl}`);
} else {
  console.error("\n❌ Failed to set webhook.");
  process.exit(1);
}
