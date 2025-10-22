/* Dev cron runner: periodically calls lexidraw cron endpoints, exits on Ctrl+C */
const base = process.env.LEXIDRAW_DEV_BASE || "http://localhost:3025";
const secret = process.env.CRON_SECRET || "";
const enabled = (process.env.DEV_CRONS_ENABLED || "true") === "true";
const intervalMs = Number(process.env.DEV_CRON_INTERVAL_MS || "60000");
const paths = (
  process.env.DEV_CRON_PATHS || "/api/crons/process-thumbnail-jobs"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!enabled) {
  console.log("[dev-crons] disabled (DEV_CRONS_ENABLED=false)");
  process.exit(0);
}
if (!secret) {
  console.log("[dev-crons] missing CRON_SECRET – not running");
  process.exit(0);
}

const tick = async () => {
  for (const p of paths) {
    try {
      const res = await fetch(base + p, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const text = await res.text();
      const ts = new Date().toISOString();
      console.log(`[dev-crons] ${ts} ${p} -> ${res.status} ${text}`);
    } catch (e) {
      console.error(`[dev-crons] ${p} error`, e);
    }
  }
};

const timer = setInterval(tick, intervalMs);
process.on("SIGINT", () => {
  clearInterval(timer);
  console.log("[dev-crons] stopped (SIGINT)");
  process.exit(0);
});
process.on("SIGTERM", () => {
  clearInterval(timer);
  console.log("[dev-crons] stopped (SIGTERM)");
  process.exit(0);
});

setTimeout(() => {
  void tick();
}, 4000);
