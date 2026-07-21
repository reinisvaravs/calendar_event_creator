import OpenAI from "openai";
import { config } from "./config.js";
import { log } from "./logger.js";
import { estimateCost } from "./pricing.js";

const client = new OpenAI({ apiKey: config.openai.apiKey });

// One schema covers all intents. Fields not relevant to a given intent are
// returned as empty strings / defaults.
const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["create", "list", "delete", "edit", "duplicate", "unknown"],
      description:
        "create = add a new event; list = show/read events; delete = cancel an event; edit = change an existing event; duplicate = copy an existing event to another date/time; unknown = not a calendar request.",
    },
    clarification: {
      type: "string",
      description:
        "If intent is unknown, a short question asking what the user wants. Empty otherwise.",
    },

    // Event details. For 'create' these describe the new event. For 'edit'
    // these are the NEW values to apply — leave a field empty to keep it.
    title: { type: "string" },
    description: { type: "string" },
    location: { type: "string" },
    allDay: { type: "boolean" },
    start: {
      type: "string",
      description:
        "Timed: 'YYYY-MM-DDTHH:mm:ss' local (no offset). All-day: 'YYYY-MM-DD'. Empty if not applicable.",
    },
    end: {
      type: "string",
      description:
        "Same format as start. For timed events default to 1h after start. Empty if not applicable.",
    },
    timezone: {
      type: "string",
      description: "IANA timezone, e.g. 'Europe/Riga'. Use the default unless implied.",
    },

    // Search window, used by list / delete / edit to locate events.
    searchText: {
      type: "string",
      description:
        "Keywords identifying the target event(s), e.g. 'dentist'. Empty for plain listing.",
    },
    rangeStart: {
      type: "string",
      description:
        "Start of the search/list window as 'YYYY-MM-DDTHH:mm:ss' local. Empty = from now.",
    },
    rangeEnd: {
      type: "string",
      description:
        "End of the search/list window as 'YYYY-MM-DDTHH:mm:ss' local. Empty = open-ended.",
    },
  },
  required: [
    "intent",
    "clarification",
    "title",
    "description",
    "location",
    "allDay",
    "start",
    "end",
    "timezone",
    "searchText",
    "rangeStart",
    "rangeEnd",
  ],
};

export async function classifyIntent(messageText) {
  const now = new Date();
  const nowLocal = now.toLocaleString("en-US", {
    timeZone: config.defaultTimezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const system = [
    "You are a calendar assistant. Classify the user's message into one intent and extract fields.",
    `Current date/time: ${nowLocal} (${config.defaultTimezone}).`,
    `Default timezone: ${config.defaultTimezone}.`,
    "Resolve relative dates ('tomorrow', 'next Friday', 'in 2 hours') against the current time.",
    "",
    "Intents:",
    "- create: user wants to add an event. Fill title/start/end/location/allDay/timezone.",
    "- list: user wants to see events. Fill rangeStart/rangeEnd for the window (e.g. 'today' = today 00:00:00 to 23:59:59). searchText optional.",
    "- delete: user wants to cancel an event. Fill searchText plus rangeStart/rangeEnd to locate it.",
    "- edit: user wants to change an event. Fill searchText + rangeStart/rangeEnd to find it, and put the NEW values in title/start/end/location (leave unchanged fields empty). When changing time, provide BOTH start and end.",
    "- duplicate: user wants a copy of an existing event at another date/time ('duplicate this', 'same event again on X', 'repeat it next week'). Fill searchText + rangeStart/rangeEnd to find the SOURCE event, and put the NEW date/time in start/end. Only fill title/location/description if the copy should differ from the source.",
    "- unknown: greetings or anything not calendar-related. Put a short prompt in clarification.",
    "",
    "When the user quotes an event back to you (title, date, time, place) and asks for it again on another date, that is duplicate, not create. Use the quoted title/date as searchText/rangeStart-rangeEnd for the source.",
    "",
    "Always output local datetimes WITHOUT timezone offsets; report the zone in timezone.",
    "Never invent details the user didn't give; leave optional fields empty.",
  ].join("\n");

  log.info("OpenAI request", { model: config.openai.model, chars: messageText.length });
  const started = Date.now();
  const completion = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: messageText },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "calendar_intent", strict: true, schema },
    },
  });
  const usage = estimateCost(config.openai.model, completion.usage);
  log.info("OpenAI response", {
    ms: Date.now() - started,
    tokens: usage.totalTokens,
    costUSD: usage.cost,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content.");
  const parsed = JSON.parse(content);
  parsed._usage = usage; // { cost, totalTokens, ... } for cost reporting
  return parsed;
}
