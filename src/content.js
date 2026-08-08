const { generateWithOpenRouter, fillPlaceholders } = require("./ai.js");
const { loadTemplates } = require("./config.js");

function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickByMode(list, mode, index = 0) {
  if (!list || !list.length) return null;
  if (mode === "sequential") return list[index % list.length];
  if (mode === "first") return list[0];
  return pickRandom(list);
}

function resolveTopic(config, override) {
  if (override) return override;
  const defaults = config.defaults || {};
  const topics = config.topics && config.topics.length ? config.topics : [defaults.topic || ""];
  const idx = Number(config._topicIndex || 0);
  return pickByMode(topics, config.topicMode || "random", idx) || defaults.topic || "";
}

function resolveImages(config, overrideUrls) {
  if (overrideUrls && overrideUrls.length) return overrideUrls;
  const images = config.images || [];
  if (!images.length) return [];
  if (config.imageMode === "all") return [...images];
  if (config.imageMode === "sequential") {
    const idx = Number(config._imageIndex || 0);
    return [images[idx % images.length]];
  }
  const one = pickRandom(images);
  return one ? [one] : [];
}

function resolveFromTemplate(config, vars) {
  const templates = loadTemplates();
  const templateCfg = config.template || {};
  const name = templateCfg.name || Object.keys(templates)[0];
  const pack = templates[name];
  if (!pack || !pack.variants || !pack.variants.length) {
    throw new Error(`Template "${name}" not found or empty. Edit templates.json`);
  }
  const variant = templateCfg.variant;
  let text;
  if (variant === "random" || variant == null || variant === "") {
    text = pickRandom(pack.variants);
  } else if (typeof variant === "number" || /^\d+$/.test(String(variant))) {
    text = pack.variants[Number(variant) % pack.variants.length];
  } else {
    text = pack.variants.find((v) => v.includes(variant)) || pickRandom(pack.variants);
  }
  return fillPlaceholders(text, vars);
}

const MAX_DESCRIPTION = 500;

/** Hard-limit caption for Repliz/Threads (max 500 chars) */
function clampDescription(text, max = MAX_DESCRIPTION) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  const base = lastBreak > max * 0.55 ? cut.slice(0, lastBreak + 1).trim() : cut.trim();
  return (base.length <= max ? base : base.slice(0, max - 1)).replace(/[,:;.\-\s]+$/, "") + "…";
}

async function buildDescription(config, env, options = {}) {
  const topic = resolveTopic(config, options.topic);
  const vars = {
    topic,
    detail: options.detail || config.productDetail || "",
    cta: options.cta || config.cta || "",
  };

  const mode = options.mode || config.contentMode || "template";
  const defaults = config.defaults || {};
  const aiCfg = config.ai || {};
  const maxLen = Number(defaults.maxDescriptionLength || MAX_DESCRIPTION);

  if (options.description) {
    return {
      description: clampDescription(fillPlaceholders(options.description, vars), maxLen),
      topic,
      mode: "manual",
    };
  }

  if (mode === "ai") {
    const userPrompt = fillPlaceholders(
      aiCfg.userPromptTemplate ||
        "Buat caption Threads. Topik: {{topic}}. Detail: {{detail}}. CTA: {{cta}}",
      vars
    );

    const attempts = Number(aiCfg.retries != null ? aiCfg.retries : 2);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const description = await generateWithOpenRouter({
          apiKey: env.openRouterKey,
          model: env.openRouterModel,
          systemPrompt: aiCfg.systemPrompt || "You are a Threads copywriter.",
          userPrompt:
            i === 0 || !lastErr || lastErr.message !== "AI_META_DUMP"
              ? userPrompt
              : `${userPrompt}\n\nULANGI. Jawab HANYA caption final berbahasa Indonesia. Jangan tulis constraint, count characters, drafting, atau penjelasan.`,
          temperature: (aiCfg.temperature != null ? aiCfg.temperature : 0.85) + i * 0.05,
          maxTokens: aiCfg.maxTokens != null ? aiCfg.maxTokens : 200,
        });
        return {
          description: clampDescription(description, maxLen),
          topic,
          mode: "ai",
        };
      } catch (err) {
        lastErr = err;
        // rate limit / server error: tunggu sebentar lalu coba lagi
        const status = err.response && err.response.status;
        if ((status === 429 || status >= 500) && i < attempts - 1) {
          await new Promise((r) => setTimeout(r, 10000));
        }
      }
    }

    // Fallback template if model keeps dumping reasoning
    if (aiCfg.fallbackTemplate !== false) {
      const description = resolveFromTemplate(config, vars);
      return {
        description: clampDescription(description, maxLen),
        topic,
        mode: "template-fallback",
        aiError: (lastErr && lastErr.message) || "AI_META_DUMP",
      };
    }
    throw lastErr || new Error("AI failed to generate caption");
  }

  // template
  const description = resolveFromTemplate(config, vars);
  return { description: clampDescription(description, maxLen), topic, mode: "template" };
}

module.exports = {
  resolveTopic,
  resolveImages,
  resolveFromTemplate,
  clampDescription,
  buildDescription,
};
