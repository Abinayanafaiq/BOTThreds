const { loadConfig, loadEnv, saveConfig } = require("./config.js");
const { createReplizClient, buildScheduleBody } = require("./repliz.js");
const { buildDescription, resolveImages } = require("./content.js");
const { createLogger, ms } = require("./logger.js");

const log = createLogger("bot");

/** First non-null/non-undefined value (replacement for the ?? operator) */
function coalesce() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/**
 * ISO schedule time: now + lead minutes (default from config)
 */
function makeScheduleAt(config, scheduleAt) {
  if (scheduleAt) return new Date(scheduleAt).toISOString();
  const defaults = config.defaults || {};
  const lead = Number(coalesce(defaults.scheduleLeadMinutes, 5));
  const d = new Date(Date.now() + lead * 60 * 1000);
  return d.toISOString();
}

/**
 * Create one post (immediate schedule via Repliz)
 */
async function createPost(options = {}) {
  const t0 = Date.now();
  log.debug("createPost start", {
    mode: options.mode,
    topic: options.topic,
    type: options.type,
    hasDescription: Boolean(options.description),
    images: options.images ? options.images.length : 0,
  });

  const env = loadEnv();
  const config = loadConfig();
  const defaults = config.defaults || {};
  const client = createReplizClient(env);

  log.debug("building description...", {
    contentMode: options.mode || config.contentMode,
    hasOpenRouter: Boolean(env.openRouterKey),
  });
  const descT0 = Date.now();
  const { description, topic, mode } = await buildDescription(config, env, options);
  log.debug("description ready", {
    mode,
    topic,
    chars: description ? description.length : 0,
    duration: ms(Date.now() - descT0),
  });

  const mediaUrls = resolveImages(config, options.images);
  const type = options.type || defaults.type || (mediaUrls.length ? "image" : "text");
  const scheduleAt = makeScheduleAt(config, options.scheduleAt);

  const body = buildScheduleBody({
    accountId: options.accountId || env.accountId,
    scheduleAt,
    type,
    title: coalesce(options.title, defaults.title, ""),
    description,
    topic: coalesce(options.topic, config.threadsTopic, topic),
    mediaUrls,
    isAiGenerated: coalesce(options.isAiGenerated, defaults.isAiGenerated, mode === "ai"),
    isDraft: coalesce(options.isDraft, defaults.isDraft, false),
    replies: options.replies || [],
  });

  log.info("calling Repliz /schedule", {
    type: body.type,
    topic: body.topic,
    scheduleAt: body.scheduleAt,
    medias: body.medias ? body.medias.length : 0,
    descChars: body.description ? body.description.length : 0,
    isDraft: body.isDraft,
  });

  const apiT0 = Date.now();
  let result;
  try {
    result = await client.schedulePost(body);
  } catch (err) {
    log.error("Repliz API error", {
      duration: ms(Date.now() - apiT0),
      status: err.response && err.response.status,
      data: err.response && err.response.data,
      message: err.message,
    });
    throw err;
  }
  log.info("Repliz OK", {
    duration: ms(Date.now() - apiT0),
    total: ms(Date.now() - t0),
    resultId: result
      ? result.id || (result.data && result.data.id) || result.scheduleId || undefined
      : undefined,
  });
  log.debug("Repliz raw result", result);

  // advance sequential image/topic index
  let dirty = false;
  if (config.imageMode === "sequential" && config.images && config.images.length) {
    config._imageIndex = (Number(config._imageIndex || 0) + 1) % config.images.length;
    dirty = true;
  }
  if (config.topicMode === "sequential" && config.topics && config.topics.length) {
    config._topicIndex = (Number(config._topicIndex || 0) + 1) % config.topics.length;
    dirty = true;
  }
  if (dirty) saveConfig(config);

  return {
    ok: true,
    mode,
    topic: body.topic,
    angle: topic,
    type: body.type,
    scheduleAt: body.scheduleAt,
    description: body.description,
    medias: body.medias.map((m) => m.url),
    result,
  };
}

/**
 * Process queue items from config.queue (one-shot jobs)
 * Queue item: { description?, topic?, images?, type?, scheduleAt?, mode?, cta?, detail? }
 */
async function processQueue({ limit = Infinity, dryRun = false } = {}) {
  const config = loadConfig();
  const queue = Array.isArray(config.queue) ? [...config.queue] : [];
  if (!queue.length) return { processed: 0, remaining: 0, items: [] };

  const take = queue.splice(0, Math.min(limit, queue.length));
  const items = [];

  for (const item of take) {
    if (dryRun) {
      items.push({ dryRun: true, item });
      continue;
    }
    try {
      const res = await createPost(item);
      items.push(res);
    } catch (err) {
      items.push({ ok: false, error: err.message, item });
    }
  }

  if (!dryRun) {
    const fresh = loadConfig();
    fresh.queue = queue;
    saveConfig(fresh);
  }

  return { processed: items.length, remaining: queue.length, items };
}

function listSettings() {
  const config = loadConfig();
  return {
    contentMode: config.contentMode,
    threadsTopic: config.threadsTopic,
    topicMode: config.topicMode,
    topics: config.topics,
    imageMode: config.imageMode,
    images: config.images,
    template: config.template,
    cta: config.cta,
    schedule: config.schedule,
    queueLength: (config.queue && config.queue.length) || 0,
    defaults: config.defaults,
  };
}

function updateSettings(patch) {
  const config = loadConfig();
  const next = deepMerge(config, patch);
  saveConfig(next);
  return next;
}

function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (b && typeof b === "object") {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      out[k] =
        v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object"
          ? deepMerge(a[k], v)
          : v;
    }
    return out;
  }
  return b;
}

module.exports = { makeScheduleAt, createPost, processQueue, listSettings, updateSettings };
