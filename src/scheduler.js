import cron from "node-cron";
import { loadConfig } from "./config.js";
import { createPost } from "./bot.js";
import { createLogger, ms } from "./logger.js";

const log = createLogger("scheduler");

let task = null;
let heartbeatTimer = null;
let startedAt = null;
let lastTickAt = null;
let lastRunAt = null;
let lastRunOk = null;
let lastError = null;
let runCount = 0;
let okCount = 0;
let errCount = 0;
let running = false;

// Estimate next fire for simple step crons like "*/20 * * * *"
function estimateNextCron(expr, from = new Date()) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [minPart] = parts;
  const base = new Date(from.getTime());
  base.setSeconds(0, 0);

  if (minPart.startsWith("*/")) {
    const step = Number(minPart.slice(2));
    if (!Number.isFinite(step) || step <= 0) return null;
    for (let i = 0; i < 60 * 24 + 2; i++) {
      const d = new Date(base.getTime() + i * 60 * 1000);
      if (d <= from) continue;
      if (d.getMinutes() % step === 0) return d;
    }
    return null;
  }

  if (/^\d+$/.test(minPart)) {
    const target = Number(minPart);
    for (let i = 1; i <= 60 * 24 + 2; i++) {
      const d = new Date(base.getTime() + i * 60 * 1000);
      if (d.getMinutes() === target) return d;
    }
  }
  return null;
}

function formatNext(expr) {
  const next = estimateNextCron(expr);
  if (!next) return { nextIso: null, nextIn: "unknown (complex cron)", nextLocal: null };
  const diff = next.getTime() - Date.now();
  return {
    nextIso: next.toISOString(),
    nextLocal: next.toLocaleString("id-ID", { hour12: false }),
    nextIn: ms(Math.max(0, diff)),
  };
}

function logHeartbeat(expr) {
  const uptime = startedAt ? ms(Date.now() - startedAt) : "?";
  const next = formatNext(expr);
  log.info("heartbeat (process alive)", {
    uptime,
    cron: expr,
    nextRun: next.nextLocal || next.nextIn,
    nextIn: next.nextIn,
    nextIso: next.nextIso,
    lastTick: lastTickAt,
    lastRun: lastRunAt,
    lastRunOk,
    lastError,
    runs: runCount,
    ok: okCount,
    err: errCount,
    busy: running,
    pid: process.pid,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
}

async function executeRun(postsPerRun, reason) {
  if (running) {
    log.warn("skip tick — previous run still in progress");
    return;
  }
  running = true;
  lastTickAt = new Date().toISOString();
  runCount += 1;
  const runId = runCount;
  const t0 = Date.now();

  log.info(`tick #${runId} (${reason})`, {
    postsPerRun,
    at: lastTickAt,
    local: new Date().toLocaleString("id-ID", { hour12: false }),
  });

  let runOk = true;
  for (let i = 0; i < postsPerRun; i++) {
    const n = i + 1;
    const tPost = Date.now();
    try {
      log.info(`post ${n}/${postsPerRun} start`);
      const res = await createPost({});
      okCount += 1;
      lastRunOk = true;
      lastError = null;
      log.info(`post ${n}/${postsPerRun} ok (${ms(Date.now() - tPost)})`, {
        topic: res.topic,
        scheduleAt: res.scheduleAt,
        mode: res.mode,
        type: res.type,
        medias: res.medias?.length || 0,
        preview: (res.description || "").slice(0, 100),
      });
    } catch (err) {
      runOk = false;
      errCount += 1;
      lastRunOk = false;
      lastError = err.response?.data
        ? JSON.stringify(err.response.data)
        : err.message;
      log.error(`post ${n}/${postsPerRun} failed (${ms(Date.now() - tPost)})`, {
        message: err.message,
        status: err.response?.status,
        data: err.response?.data || null,
      });
    }
  }

  lastRunAt = new Date().toISOString();
  running = false;
  log.info(`tick #${runId} done (${ms(Date.now() - t0)})`, {
    ok: runOk,
    totals: { runs: runCount, ok: okCount, err: errCount },
  });
}

export function startScheduler() {
  const config = loadConfig();
  const {
    cron: expr,
    postsPerRun = 1,
    enabled,
    runOnStart = false,
    heartbeatMinutes = 5,
  } = config.schedule || {};

  if (!enabled) {
    log.warn("disabled — set schedule.enabled=true in config.json");
    return null;
  }
  if (!expr) {
    throw new Error("schedule.cron is missing in config.json");
  }
  if (!cron.validate(expr)) {
    throw new Error(`Invalid cron: ${expr}`);
  }
  if (task) {
    log.info("restarting existing scheduler task");
    task.stop();
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  startedAt = Date.now();
  lastTickAt = null;
  lastRunAt = null;
  lastRunOk = null;
  lastError = null;
  runCount = 0;
  okCount = 0;
  errCount = 0;
  running = false;

  const next = formatNext(expr);
  log.info("starting", {
    cron: expr,
    postsPerRun,
    runOnStart,
    heartbeatMinutes,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    offsetMin: -new Date().getTimezoneOffset(),
    nowIso: new Date().toISOString(),
    nowLocal: new Date().toLocaleString("id-ID", { hour12: false }),
    nextRun: next.nextLocal,
    nextIn: next.nextIn,
    pid: process.pid,
    node: process.version,
    platform: process.platform,
  });

  if (!next.nextIso && !expr.includes("*/")) {
    log.warn("could not estimate next run for this cron expression — still scheduled by node-cron");
  }

  task = cron.schedule(expr, () => {
    executeRun(postsPerRun, "cron").catch((err) => {
      log.error("unhandled tick error", err.message);
      running = false;
    });
  });

  if (heartbeatMinutes > 0) {
    const every = heartbeatMinutes * 60 * 1000;
    heartbeatTimer = setInterval(() => logHeartbeat(expr), every);
    // first heartbeat shortly after start so user sees process is alive
    setTimeout(() => logHeartbeat(expr), 3000);
    log.info(`heartbeat every ${heartbeatMinutes}m (if missing, process was killed/frozen)`);
  }

  if (runOnStart) {
    log.info("runOnStart=true — posting now");
    executeRun(postsPerRun, "runOnStart").catch((err) => {
      log.error("runOnStart failed", err.message);
      running = false;
    });
  } else {
    log.info("waiting for first cron fire (no post at start)", {
      hint: "set schedule.runOnStart=true to post immediately, or use */1 * * * * to test",
    });
  }

  log.info(`started cron="${expr}" postsPerRun=${postsPerRun}`);
  return task;
}

export function stopScheduler() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (task) {
    task.stop();
    task = null;
    log.info("stopped", {
      uptime: startedAt ? ms(Date.now() - startedAt) : null,
      runs: runCount,
      ok: okCount,
      err: errCount,
    });
  }
}
