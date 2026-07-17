import express from "express";
import { config } from "./config.js";
import { isAuthorized, sendMessage, sendTyping } from "./telegram.js";
import { classifyIntent } from "./parser.js";
import {
  createEvent,
  listEvents,
  updateEvent,
  deleteEvent,
} from "./calendar.js";
import { setPending, getPending, clearPending } from "./state.js";
import { formatCost } from "./pricing.js";
import { log } from "./logger.js";

// Append the OpenAI cost footer for a message that involved a classify call.
function withCost(text, parsed) {
  return parsed?._usage ? `${text}\n\n${formatCost(parsed._usage)}` : text;
}

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  log.info("HTTP request", { method: req.method, path: req.path });
  next();
});

app.get("/", (_req, res) => res.send("calendar-creator is running"));

app.post(`/telegram/webhook/${config.telegram.webhookSecret}`, async (req, res) => {
  res.sendStatus(200); // ack fast so Telegram doesn't retry

  const update = req.body;
  const message = update?.message;
  if (!message?.text) {
    log.info("Update ignored (no text)", { updateId: update?.update_id });
    return;
  }

  const chatId = message.chat.id;
  const fromId = message.from?.id;
  const username = message.from?.username;
  const text = message.text.trim();
  log.info("Message received", { fromId, username, chatId, text });

  if (!isAuthorized(update)) {
    log.warn("Unauthorized message rejected", { fromId, username });
    await sendMessage(chatId, "⛔ You are not authorized to use this bot.");
    return;
  }

  try {
    await handleMessage(chatId, text);
  } catch (err) {
    log.error("Failed to handle message", {
      fromId,
      text,
      error: err.message,
      stack: err.stack,
    });
    await sendMessage(chatId, "⚠️ Something went wrong. Please try again.");
  }
});

// --- Core routing -----------------------------------------------------------

async function handleMessage(chatId, text) {
  if (text === "/start" || text === "/help") {
    await sendMessage(chatId, helpText());
    return;
  }

  // If there's a pending confirmation, try to resolve it first.
  const pending = getPending(chatId);
  if (pending) {
    const resolved = await resolvePending(chatId, text, pending);
    if (resolved) return; // handled; otherwise fall through to a fresh command
  }

  await sendTyping(chatId);
  const parsed = await classifyIntent(text);
  log.info("Intent classified", {
    intent: parsed.intent,
    title: parsed.title,
    searchText: parsed.searchText,
  });

  switch (parsed.intent) {
    case "create":
      return handleCreate(chatId, parsed);
    case "list":
      return handleList(chatId, parsed);
    case "delete":
      return handleFind(chatId, parsed, "delete");
    case "edit":
      return handleFind(chatId, parsed, "edit");
    default:
      await sendMessage(
        chatId,
        parsed.clarification ||
          "🤔 I didn't get that. Try 'Dentist tomorrow 3pm', 'what's on today?', or 'cancel my dentist appointment'."
      );
  }
}

// --- Intent handlers --------------------------------------------------------

async function handleCreate(chatId, parsed) {
  const event = await createEvent(parsed);
  await sendMessage(chatId, withCost(formatCreated(parsed, event), parsed));
  log.info("Create done", { eventId: event.id });
}

async function handleList(chatId, parsed) {
  const events = await listEvents({
    rangeStart: parsed.rangeStart,
    rangeEnd: parsed.rangeEnd,
    q: parsed.searchText,
  });
  if (events.length === 0) {
    await sendMessage(chatId, withCost("📭 No events found for that period.", parsed));
    return;
  }
  const lines = events.map((ev, i) => `${i + 1}. *${ev.summary}* — ${fmtWhen(ev)}${ev.location ? ` @ ${ev.location}` : ""}`);
  await sendMessage(chatId, withCost(`📅 *Your events:*\n${lines.join("\n")}`, parsed));
}

// Shared find-then-confirm flow for delete and edit.
async function handleFind(chatId, parsed, op) {
  const events = await listEvents({
    rangeStart: parsed.rangeStart,
    rangeEnd: parsed.rangeEnd,
    q: parsed.searchText,
  });

  if (events.length === 0) {
    await sendMessage(
      chatId,
      withCost(
        `🔍 I couldn't find an event matching "${parsed.searchText || "that"}". Try being more specific.`,
        parsed
      )
    );
    return;
  }

  const changes = op === "edit" ? extractChanges(parsed) : null;

  if (events.length === 1) {
    const ev = events[0];
    setPending(chatId, { op, candidates: [ev], changes });
    const preview =
      op === "delete"
        ? `🗑 Delete this event?\n\n*${ev.summary}* — ${fmtWhen(ev)}`
        : `✏️ Update this event?\n\n*${ev.summary}* — ${fmtWhen(ev)}\n→ ${describeChanges(changes)}`;
    await sendMessage(chatId, withCost(`${preview}\n\n_Reply *yes* to confirm or *no* to cancel._`, parsed));
    return;
  }

  // Multiple matches — ask which one by number.
  setPending(chatId, { op, candidates: events, changes });
  const lines = events.map((ev, i) => `${i + 1}. *${ev.summary}* — ${fmtWhen(ev)}`);
  const verb = op === "delete" ? "delete" : "edit";
  await sendMessage(
    chatId,
    withCost(
      `❓ Found ${events.length} matches. Which one to ${verb}?\n${lines.join("\n")}\n\n_Reply with a number, or *no* to cancel._`,
      parsed
    )
  );
}

// --- Pending confirmation resolution ---------------------------------------

// Returns true if the message was consumed as a confirmation/selection.
async function resolvePending(chatId, text, pending) {
  const t = text.toLowerCase().trim();

  if (isNo(t)) {
    clearPending(chatId);
    await sendMessage(chatId, "👍 Cancelled.");
    return true;
  }

  // Numeric selection (only meaningful with multiple candidates).
  if (/^\d+$/.test(t)) {
    const idx = parseInt(t, 10) - 1;
    if (idx < 0 || idx >= pending.candidates.length) {
      await sendMessage(chatId, `Please reply with a number between 1 and ${pending.candidates.length}, or *no* to cancel.`);
      return true;
    }
    clearPending(chatId);
    await executePending(chatId, pending.op, pending.candidates[idx], pending.changes);
    return true;
  }

  if (isYes(t)) {
    if (pending.candidates.length === 1) {
      clearPending(chatId);
      await executePending(chatId, pending.op, pending.candidates[0], pending.changes);
      return true;
    }
    await sendMessage(chatId, "There are several matches — reply with the number of the one you mean.");
    return true;
  }

  // Not a recognized confirmation — drop the pending action and treat this as
  // a brand-new command so the user never gets stuck.
  clearPending(chatId);
  return false;
}

async function executePending(chatId, op, event, changes) {
  if (op === "delete") {
    await deleteEvent(event.id);
    await sendMessage(chatId, `🗑 Deleted *${event.summary}*.`);
    log.info("Delete done", { eventId: event.id });
  } else if (op === "edit") {
    const updated = await updateEvent(event.id, changes);
    await sendMessage(
      chatId,
      `✏️ Updated *${updated.summary || event.summary}*.` +
        (updated.htmlLink ? `\n[Open in Google Calendar](${updated.htmlLink})` : "")
    );
    log.info("Edit done", { eventId: event.id });
  }
}

// --- Formatting helpers -----------------------------------------------------

function extractChanges(parsed) {
  return {
    title: parsed.title,
    description: parsed.description,
    location: parsed.location,
    allDay: parsed.allDay,
    start: parsed.start,
    end: parsed.end,
    timezone: parsed.timezone,
  };
}

function describeChanges(changes) {
  const parts = [];
  if (changes.title) parts.push(`title → ${changes.title}`);
  if (changes.start) parts.push(`time → ${prettyLocal(changes.start)}`);
  if (changes.location) parts.push(`location → ${changes.location}`);
  return parts.length ? parts.join(", ") : "(updated details)";
}

function helpText() {
  return (
    "👋 I manage your Google Calendar. Just talk to me:\n\n" +
    "*Create:* Dentist tomorrow at 3pm at Main St\n" +
    "*Read:* what's on today? / events next week\n" +
    "*Edit:* move my dentist appointment to 4pm\n" +
    "*Delete:* cancel my dentist appointment\n\n" +
    "For edits and deletes I'll ask you to confirm first."
  );
}

function formatCreated(parsed, event) {
  const when = parsed.allDay
    ? `${parsed.start} (all day)`
    : `${prettyLocal(parsed.start)} (${parsed.timezone})`;
  const lines = ["✅ *Event created*", `*${parsed.title}*`, `🕒 ${when}`];
  if (parsed.location) lines.push(`📍 ${parsed.location}`);
  if (event.htmlLink) lines.push(`[Open in Google Calendar](${event.htmlLink})`);
  return lines.join("\n");
}

// Format a stored RFC3339/date value for display in the default timezone.
function fmtWhen(ev) {
  if (ev.allDay) return `${ev.start} (all day)`;
  const d = new Date(ev.start);
  return d.toLocaleString("en-GB", {
    timeZone: config.defaultTimezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Format a 'YYYY-MM-DDTHH:mm:ss' local string cleanly.
function prettyLocal(iso) {
  const [date, time] = iso.split("T");
  return `${date} ${time ? time.slice(0, 5) : ""}`.trim();
}

function isYes(t) {
  return /^(y|yes|yeah|yep|yup|ok|okay|sure|confirm|do it|delete|go)$/.test(t);
}
function isNo(t) {
  return /^(n|no|nope|cancel|stop|nah|dont|don't)$/.test(t);
}

app.listen(config.port, () => {
  log.info("Server started", { port: config.port, tz: config.defaultTimezone });
});
