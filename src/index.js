import express from "express";
import { config } from "./config.js";
import { isAuthorized, sendMessage, sendTyping } from "./telegram.js";
import { parseEvent } from "./parser.js";
import { createEvent } from "./calendar.js";
import { log } from "./logger.js";

const app = express();
app.use(express.json());

// Log every incoming HTTP request.
app.use((req, _res, next) => {
  log.info("HTTP request", { method: req.method, path: req.path });
  next();
});

// Health check (Render pings this).
app.get("/", (_req, res) => res.send("calendar-creator is running"));

// Telegram webhook. The secret is part of the path so random traffic can't hit it.
app.post(`/telegram/webhook/${config.telegram.webhookSecret}`, async (req, res) => {
  // Always ack fast so Telegram doesn't retry.
  res.sendStatus(200);

  const update = req.body;
  const message = update?.message;

  if (!message?.text) {
    log.info("Update ignored (no text)", { updateId: update?.update_id });
    return;
  }

  const chatId = message.chat.id;
  const fromId = message.from?.id;
  const username = message.from?.username;
  log.info("Message received", {
    fromId,
    username,
    chatId,
    text: message.text,
  });

  if (!isAuthorized(update)) {
    log.warn("Unauthorized message rejected", { fromId, username });
    await sendMessage(chatId, "⛔ You are not authorized to use this bot.");
    return;
  }

  const text = message.text.trim();

  if (text === "/start" || text === "/help") {
    log.info("Command handled", { command: text, fromId });
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

    log.info("Parsing message with OpenAI", { text });
    const parsed = await parseEvent(text);
    log.info("OpenAI parse result", {
      understood: parsed.understood,
      title: parsed.title,
      start: parsed.start,
      end: parsed.end,
      allDay: parsed.allDay,
      timezone: parsed.timezone,
    });

    if (!parsed.understood) {
      log.info("Message not understood as an event", { text });
      await sendMessage(
        chatId,
        parsed.clarification ||
          "🤔 I couldn't find event details in that. Try e.g. 'Dentist tomorrow at 3pm'."
      );
      return;
    }

    log.info("Creating calendar event", {
      title: parsed.title,
      start: parsed.start,
    });
    const event = await createEvent(parsed);
    log.info("Calendar event created", {
      eventId: event.id,
      htmlLink: event.htmlLink,
    });

    await sendMessage(chatId, formatConfirmation(parsed, event));
    log.info("Confirmation sent", { chatId, eventId: event.id });
  } catch (err) {
    log.error("Failed to handle message", {
      fromId,
      text,
      error: err.message,
      stack: err.stack,
    });
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
  log.info("Server started", { port: config.port, tz: config.defaultTimezone });
});
