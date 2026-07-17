// In-memory store for pending confirmations (delete/edit awaiting yes/no).
// Keyed by chatId. Entries expire so a stale "yes" can't fire an old action.
//
// Note: this lives in process memory, so a Render restart/sleep clears it.
// That's fine — a pending confirmation is only meant to last a few seconds,
// and if it's lost the user simply re-issues the command.

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const pending = new Map();

export function setPending(chatId, action) {
  pending.set(String(chatId), { action, expiresAt: Date.now() + TTL_MS });
}

export function getPending(chatId) {
  const entry = pending.get(String(chatId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    pending.delete(String(chatId));
    return null;
  }
  return entry.action;
}

export function clearPending(chatId) {
  pending.delete(String(chatId));
}
