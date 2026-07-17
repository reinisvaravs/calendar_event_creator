import express from "express";
import { config } from "./config.js";
import { isAuthorized, sendMessage, sendTyping } from "./telegram.js";
import { parseEvent } from "./parser.js";
import { createEvent } from "./calendar.js";

const app = express();
app.use(express.json());

// Health check (Render pings this).
app.get("/", (_req, res) => res.send("calendar-creator is running"));

// Telegram webhook. The secret is part of the path so random traffic can't hit it.
app.post(`/telegram/webhook/${config.telegram.webhookSecret}`, async (req, res) => {
  // Always ack fast so Telegram doesn't retry.
  res.sendStatus(200);

  const update = req.body;
  const message = update?.message;
  if (!message?.text) return;

  const chatId = message.chat.id;

  if (!isAuthorized(update)) {
    console.warn(`Unauthorized message from user id ${message.from?.id}`);
    await sendMessage(chatId, "⛔ You are not authorized to use this bot.");
    return;
  }

  const text = message.text.trim();

  if (text === "/start" || text === "/help") {
    await sendMessage(
      chatId,
      "👋 Send me event details in plain language and I'll add it to your Google Calendar.\n\n" +
        "_Examples:_\n" +
        "• Dentist tomorrow at 3pm\n" +
        "• Lunch with Sam Friday 12:30 at Cafe Roma\n" +
        "• Mom's birthday next Saturday (all day)"
    );
    return;
  }

  try {
    await sendTyping(chatId);
    const parsed = await parseEvent(text);

    if (!parsed.understood) {
      await sendMessage(
        chatId,
        parsed.clarification ||
          "🤔 I couldn't find event details in that. Try e.g. 'Dentist tomorrow at 3pm'."
      );
      return;
    }

    const event = await createEvent(parsed);
    await sendMessage(chatId, formatConfirmation(parsed, event));
  } catch (err) {
    console.error("Failed to handle message:", err);
    await sendMessage(
      chatId,
      "⚠️ Something went wrong creating that event. Please try again."
    );
  }
});

function formatConfirmation(parsed, event) {
  const when = parsed.allDay
    ? `${parsed.start} (all day)`
    : `${prettyDateTime(parsed.start)} (${parsed.timezone})`;

  const lines = [
    "✅ *Event created*",
    `*${parsed.title}*`,
    `🕒 ${when}`,
  ];
  if (parsed.location) lines.push(`📍 ${parsed.location}`);
  if (event.htmlLink) lines.push(`[Open in Google Calendar](${event.htmlLink})`);
  return lines.join("\n");
}

function prettyDateTime(iso) {
  // iso is 'YYYY-MM-DDTHH:mm:ss' local time — display it as-is, cleaned up.
  const [date, time] = iso.split("T");
  return `${date} ${time ? time.slice(0, 5) : ""}`.trim();
}

app.listen(config.port, () => {
  console.log(`calendar-creator listening on port ${config.port}`);
});
