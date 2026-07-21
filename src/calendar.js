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

// --- Time helpers -----------------------------------------------------------

// Convert a wall-clock local datetime ('YYYY-MM-DDTHH:mm:ss') in a given IANA
// timezone into a UTC ISO instant. Uses the standard offset trick — accurate
// except for rare DST-boundary edge cases, which is fine for a personal bot.
function zonedToUtcISO(localIso, tz) {
  const asUTC = new Date(`${localIso}Z`);
  const tzTime = new Date(asUTC.toLocaleString("en-US", { timeZone: tz }));
  const utcTime = new Date(asUTC.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = utcTime.getTime() - tzTime.getTime();
  return new Date(asUTC.getTime() + offsetMs).toISOString();
}

function addOneDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Build a Google Calendar event resource from the parsed structure.
function toEventResource(parsed) {
  const base = {
    summary: parsed.title,
    description: parsed.description || undefined,
    location: parsed.location || undefined,
  };

  if (parsed.allDay) {
    const endDate =
      parsed.end && parsed.end !== parsed.start
        ? parsed.end
        : addOneDay(parsed.start);
    return { ...base, start: { date: parsed.start }, end: { date: endDate } };
  }

  return {
    ...base,
    start: { dateTime: parsed.start, timeZone: parsed.timezone },
    end: { dateTime: parsed.end, timeZone: parsed.timezone },
  };
}

// --- Create -----------------------------------------------------------------

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

// --- Read / search ----------------------------------------------------------

// List events in a local-time window. rangeStart/rangeEnd are
// 'YYYY-MM-DDTHH:mm:ss' local; q is an optional full-text filter.
export async function listEvents({ rangeStart, rangeEnd, q } = {}) {
  const tz = config.defaultTimezone;
  const timeMin = rangeStart
    ? zonedToUtcISO(rangeStart, tz)
    : new Date().toISOString();
  const timeMax = rangeEnd ? zonedToUtcISO(rangeEnd, tz) : undefined;

  log.info("Google Calendar list", { timeMin, timeMax, q: q || "" });
  const res = await calendar.events.list({
    calendarId: config.google.calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 25,
    q: q || undefined,
  });
  const items = (res.data.items || []).map(normalizeEvent);
  log.info("Google Calendar list ok", { count: items.length });
  return items;
}

function normalizeEvent(ev) {
  const allDay = Boolean(ev.start?.date);
  return {
    id: ev.id,
    summary: ev.summary || "(no title)",
    location: ev.location || "",
    allDay,
    start: ev.start?.dateTime || ev.start?.date || "",
    end: ev.end?.dateTime || ev.end?.date || "",
    htmlLink: ev.htmlLink,
  };
}

// --- Update -----------------------------------------------------------------

// Apply a patch. `changes` uses the same fields as the parser: any non-empty
// value is applied; empty strings mean "leave unchanged".
export async function updateEvent(eventId, changes) {
  const patch = {};
  if (changes.title) patch.summary = changes.title;
  if (changes.description) patch.description = changes.description;
  if (changes.location) patch.location = changes.location;

  if (changes.allDay && changes.start) {
    patch.start = { date: changes.start };
    patch.end = {
      date:
        changes.end && changes.end !== changes.start
          ? changes.end
          : addOneDay(changes.start),
    };
  } else if (changes.start) {
    patch.start = { dateTime: changes.start, timeZone: changes.timezone };
    if (changes.end)
      patch.end = { dateTime: changes.end, timeZone: changes.timezone };
  }

  log.info("Google Calendar patch", { eventId, fields: Object.keys(patch) });
  const res = await calendar.events.patch({
    calendarId: config.google.calendarId,
    eventId,
    requestBody: patch,
  });
  log.info("Google Calendar patch ok", { eventId });
  return res.data;
}

// --- Duplicate --------------------------------------------------------------

// Properties worth carrying over to a copy. Everything else (id, etag, links,
// organizer, recurrence, sequence…) is server-owned or instance-specific.
// Attendees are deliberately excluded: inserting them would email real people.
const COPYABLE_FIELDS = [
  "summary",
  "description",
  "location",
  "colorId",
  "reminders",
  "transparency",
  "visibility",
  "eventType",
  "extendedProperties",
  "guestsCanModify",
  "guestsCanInviteOthers",
  "guestsCanSeeOtherGuests",
];

// Add ms to a naive local 'YYYY-MM-DDTHH:mm:ss' string, staying naive.
function shiftLocal(localIso, ms) {
  const d = new Date(`${localIso}Z`);
  return new Date(d.getTime() + ms).toISOString().slice(0, 19);
}

function sourceDurationMs(src) {
  const s = src.start?.dateTime;
  const e = src.end?.dateTime;
  if (!s || !e) return 60 * 60 * 1000;
  return new Date(e).getTime() - new Date(s).getTime();
}

// Copy an existing event to a new date/time. `changes` uses parser fields;
// only non-empty values override what the source already has.
export async function duplicateEvent(eventId, changes) {
  const { data: src } = await calendar.events.get({
    calendarId: config.google.calendarId,
    eventId,
  });

  const resource = {};
  for (const field of COPYABLE_FIELDS) {
    if (src[field] !== undefined) resource[field] = src[field];
  }
  if (changes.title) resource.summary = changes.title;
  if (changes.description) resource.description = changes.description;
  if (changes.location) resource.location = changes.location;

  // A bare 'YYYY-MM-DD' start means all-day regardless of what the model said.
  const wantsAllDay =
    changes.allDay || (changes.start ? !changes.start.includes("T") : Boolean(src.start?.date));

  if (!changes.start) {
    // No new time given — keep the source's own timing.
    resource.start = src.start;
    resource.end = src.end;
  } else if (wantsAllDay) {
    resource.start = { date: changes.start };
    resource.end = {
      date:
        changes.end && changes.end !== changes.start
          ? changes.end
          : addOneDay(changes.start),
    };
  } else {
    const tz = changes.timezone || src.start?.timeZone || config.defaultTimezone;
    const end = changes.end || shiftLocal(changes.start, sourceDurationMs(src));
    resource.start = { dateTime: changes.start, timeZone: tz };
    resource.end = { dateTime: end, timeZone: tz };
  }

  log.info("Google Calendar duplicate", {
    sourceId: eventId,
    summary: resource.summary,
    copied: Object.keys(resource),
  });
  const res = await calendar.events.insert({
    calendarId: config.google.calendarId,
    requestBody: resource,
  });
  log.info("Google Calendar duplicate ok", { eventId: res.data.id });
  return res.data;
}

// --- Delete -----------------------------------------------------------------

export async function deleteEvent(eventId) {
  log.info("Google Calendar delete", { eventId });
  await calendar.events.delete({
    calendarId: config.google.calendarId,
    eventId,
  });
  log.info("Google Calendar delete ok", { eventId });
}
