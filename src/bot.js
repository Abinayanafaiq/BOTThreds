import { loadConfig, loadEnv, saveConfig } from "./config.js";
import { createReplizClient, buildScheduleBody } from "./repliz.js";
import { buildDescription, resolveImages } from "./content.js";

/**
 * ISO schedule time: now + lead minutes (default from config)
 */
export function makeScheduleAt(config, scheduleAt) {
  if (scheduleAt) return new Date(scheduleAt).toISOString();
  const lead = Number(config.defaults?.scheduleLeadMinutes ?? 5);
  const d = new Date(Date.now() + lead * 60 * 1000);
  return d.toISOString();
}

/**
 * Create one post (immediate schedule via Repliz)
 */
export async function createPost(options = {}) {
  const env = loadEnv();
  const config = loadConfig();
  const client = createReplizClient(env);

  const { description, topic, mode } = await buildDescription(config, env, options);
  const mediaUrls = resolveImages(config, options.images);
  const type = options.type || config.defaults?.type || (mediaUrls.length ? "image" : "text");
  const scheduleAt = makeScheduleAt(config, options.scheduleAt);

  const body = buildScheduleBody({
    accountId: options.accountId || env.accountId,
    scheduleAt,
    type,
    title: options.title ?? config.defaults?.title ?? "",
    description,
    topic: options.topic ?? topic,
    mediaUrls,
    isAiGenerated: options.isAiGenerated ?? config.defaults?.isAiGenerated ?? mode === "ai",
    isDraft: options.isDraft ?? config.defaults?.isDraft ?? false,
    replies: options.replies || [],
  });

  const result = await client.schedulePost(body);

  // advance sequential image index
  if (config.imageMode === "sequential" && config.images?.length) {
    config._imageIndex = (Number(config._imageIndex || 0) + 1) % config.images.length;
    saveConfig(config);
  }

  return {
    ok: true,
    mode,
    topic: body.topic,
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
export async function processQueue({ limit = Infinity, dryRun = false } = {}) {
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

export function listSettings() {
  const config = loadConfig();
  return {
    contentMode: config.contentMode,
    topicMode: config.topicMode,
    topics: config.topics,
    imageMode: config.imageMode,
    images: config.images,
    template: config.template,
    cta: config.cta,
    schedule: config.schedule,
    queueLength: config.queue?.length || 0,
    defaults: config.defaults,
  };
}

export function updateSettings(patch) {
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
