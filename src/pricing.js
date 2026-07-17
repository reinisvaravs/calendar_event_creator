import { log } from "./logger.js";

// OpenAI pricing in USD per 1,000,000 tokens (input / output).
// Update these if OpenAI changes prices or you switch models.
const PRICES = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1-nano": { in: 0.1, out: 0.4 },
};

const FALLBACK = PRICES["gpt-4o-mini"];

// Returns { cost, promptTokens, completionTokens, totalTokens }.
export function estimateCost(model, usage) {
  const rate = PRICES[model] || FALLBACK;
  if (!PRICES[model]) {
    log.warn("Unknown model for pricing, using gpt-4o-mini rate", { model });
  }
  const promptTokens = usage?.prompt_tokens || 0;
  const completionTokens = usage?.completion_tokens || 0;
  const cost =
    (promptTokens / 1e6) * rate.in + (completionTokens / 1e6) * rate.out;
  return {
    cost,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

// Human-readable footer for a Telegram message, e.g. "💸 $0.000185 · 685 tok".
export function formatCost({ cost, totalTokens }) {
  const cents = cost * 100;
  const centStr = cents < 0.1 ? `${(cents).toFixed(4)}¢` : `${cents.toFixed(2)}¢`;
  return `💸 $${cost.toFixed(6)} (~${centStr}) · ${totalTokens} tok`;
}
