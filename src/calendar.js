import { google } from "googleapis";
import { config } from "./config.js";
import { log } from "./logger.js";

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: config.google.serviceAccount.client_email,
    private_key: config.google.serviceAccount.private_key,
  },
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
});

const calendar = google.calendar({ version: "v3", auth });

// Build a Google Calendar event resource from the parsed structure.
function toEventResource(parsed) {
  const base = {
    summary: parsed.title,
    description: parsed.description || undefined,
    location: parsed.location || undefined,
  };

  if (parsed.allDay) {
    // All-day events use `date`. Google treats `end.date` as exclusive,
    // so bump a single-day event's end by one day.
    const endDate =
      parsed.end && parsed.end !== parsed.start
        ? parsed.end
        : addOneDay(parsed.start);
    return {
      ...base,
      start: { date: parsed.start },
      end: { date: endDate },
    };
  }

  return {
    ...base,
    start: { dateTime: parsed.start, timeZone: parsed.timezone },
    end: { dateTime: parsed.end, timeZone: parsed.timezone },
  };
}

function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function createEvent(parsed) {
  const resource = toEventResource(parsed);
  log.info("Google Calendar insert", {
    calendarId: config.google.calendarId,
    summary: resource.summary,
  });
  const started = Date.now();
  try {
    const res = await calendar.events.insert({
      calendarId: config.google.calendarId,
      requestBody: resource,
    });
    log.info("Google Calendar insert ok", {
      ms: Date.now() - started,
      eventId: res.data.id,
    });
    return res.data; // includes htmlLink
  } catch (err) {
    log.error("Google Calendar insert failed", {
      ms: Date.now() - started,
      code: err.code,
      message: err.errors?.[0]?.message || err.message,
    });
    throw err;
  }
}
