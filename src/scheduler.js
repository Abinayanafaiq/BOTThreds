import cron from "node-cron";
import { loadConfig } from "./config.js";
import { createPost } from "./bot.js";

let task = null;

export function startScheduler() {
  const config = loadConfig();
  const { cron: expr, postsPerRun = 1, enabled } = config.schedule || {};

  if (!enabled) {
    console.log("[scheduler] disabled (set schedule.enabled=true in config.json)");
    return null;
  }
  if (!cron.validate(expr)) {
    throw new Error(`Invalid cron: ${expr}`);
  }
  if (task) task.stop();

  task = cron.schedule(expr, async () => {
    console.log(`[scheduler] run @ ${new Date().toISOString()}`);
    for (let i = 0; i < postsPerRun; i++) {
      try {
        const res = await createPost({});
        console.log("[scheduler] posted:", {
          topic: res.topic,
          scheduleAt: res.scheduleAt,
          mode: res.mode,
          preview: res.description.slice(0, 80),
        });
      } catch (err) {
        console.error("[scheduler] error:", err.response?.data || err.message);
      }
    }
  });

  console.log(`[scheduler] started cron="${expr}" postsPerRun=${postsPerRun}`);
  return task;
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
    console.log("[scheduler] stopped");
  }
}
