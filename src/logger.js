const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function stamp() {
  const d = new Date();
  return d.toISOString();
}

function localStamp() {
  try {
    return new Date().toLocaleString("id-ID", { hour12: false });
  } catch {
    return new Date().toString();
  }
}

function fmt(scope, level, msg, extra) {
  const base = `[${stamp()}] [${level.toUpperCase()}] [${scope}] ${msg}`;
  if (extra === undefined) return base;
  if (typeof extra === "string") return `${base} ${extra}`;
  try {
    return `${base} ${JSON.stringify(extra)}`;
  } catch {
    return `${base} ${String(extra)}`;
  }
}

export function createLogger(scope = "app") {
  const log = (level, msg, extra) => {
    if (LEVELS[level] < currentLevel()) return;
    const line = fmt(scope, level, msg, extra);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (msg, extra) => log("debug", msg, extra),
    info: (msg, extra) => log("info", msg, extra),
    warn: (msg, extra) => log("warn", msg, extra),
    error: (msg, extra) => log("error", msg, extra),
    stamp,
    localStamp,
  };
}

export function ms(msVal) {
  if (msVal < 1000) return `${msVal}ms`;
  const s = Math.round(msVal / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}
