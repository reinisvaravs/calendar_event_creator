// Tiny structured logger. Every line is timestamped and level-tagged so Render's
// log viewer is easy to scan. Optional context object is appended as JSON.
function emit(level, msg, ctx) {
  const ts = new Date().toISOString();
  const base = `${ts} [${level}] ${msg}`;
  if (ctx && Object.keys(ctx).length > 0) {
    console.log(`${base} ${JSON.stringify(ctx)}`);
  } else {
    console.log(base);
  }
}

export const log = {
  info: (msg, ctx) => emit("INFO", msg, ctx),
  warn: (msg, ctx) => emit("WARN", msg, ctx),
  error: (msg, ctx) => emit("ERROR", msg, ctx),
};
