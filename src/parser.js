import OpenAI from "openai";
import { config } from "./config.js";
import { log } from "./logger.js";

const client = new OpenAI({ apiKey: config.openai.apiKey });

// JSON schema for the structured event the model must return.
const eventSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    understood: {
      type: "boolean",
      description:
        "true if the message clearly describes a calendar event, false otherwise.",
    },
    clarification: {
      type: "string",
      description:
        "If understood is false, a short question asking the user for what's missing. Empty string otherwise.",
    },
    title: { type: "string", description: "Short event title." },
    description: {
      type: "string",
      description: "Any extra detail/notes. Empty string if none.",
    },
    location: {
      type: "string",
      description: "Location or address. Empty string if none.",
    },
    allDay: {
      type: "boolean",
      description: "true for an all-day event with no specific time.",
    },
    start: {
      type: "string",
      description:
        "Start. For timed events: ISO 8601 local datetime 'YYYY-MM-DDTHH:mm:ss' (no offset). For all-day: 'YYYY-MM-DD'.",
    },
    end: {
      type: "string",
      description:
        "End, same format as start. For timed events default to 1 hour after start if unspecified. For all-day this is the (exclusive) end date; use the same day if it's a single day.",
    },
    timezone: {
      type: "string",
      description:
        "IANA timezone, e.g. 'Europe/Riga'. Use the provided default unless the message clearly implies another.",
    },
  },
  required: [
    "understood",
    "clarification",
    "title",
    "description",
    "location",
    "allDay",
    "start",
    "end",
    "timezone",
  ],
};

export async function parseEvent(messageText) {
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
    "You extract a single calendar event from a user's free-form message.",
    `The current date and time is: ${nowLocal} (${config.defaultTimezone}).`,
    `The user's default timezone is ${config.defaultTimezone}.`,
    "Resolve relative dates like 'tomorrow', 'next Friday', 'in 2 hours' against the current time.",
    "Never invent details the user didn't provide; leave optional fields as empty strings.",
    "If the message is not a real event request (e.g. a greeting), set understood=false and put a short question in clarification.",
    "Output local datetimes WITHOUT timezone offsets; report the timezone separately in the timezone field.",
  ].join(" ");

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
      json_schema: {
        name: "calendar_event",
        strict: true,
        schema: eventSchema,
      },
    },
  });
  log.info("OpenAI response", {
    ms: Date.now() - started,
    tokens: completion.usage?.total_tokens,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no content.");
  return JSON.parse(content);
}
