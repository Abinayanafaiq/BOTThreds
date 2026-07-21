import { generateWithOpenRouter, fillPlaceholders } from "./ai.js";
import { loadTemplates } from "./config.js";

function pickRandom(arr) {
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickByMode(list, mode, index = 0) {
  if (!list?.length) return null;
  if (mode === "sequential") return list[index % list.length];
  if (mode === "first") return list[0];
  return pickRandom(list);
}

export function resolveTopic(config, override) {
  if (override) return override;
  const topics = config.topics?.length ? config.topics : [config.defaults?.topic || ""];
  return pickByMode(topics, config.topicMode || "random") || config.defaults?.topic || "";
}

export function resolveImages(config, overrideUrls) {
  if (overrideUrls?.length) return overrideUrls;
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

export function resolveFromTemplate(config, vars) {
  const templates = loadTemplates();
  const name = config.template?.name || Object.keys(templates)[0];
  const pack = templates[name];
  if (!pack?.variants?.length) {
    throw new Error(`Template "${name}" not found or empty. Edit templates.json`);
  }
  let variant = config.template?.variant;
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
export function clampDescription(text, max = MAX_DESCRIPTION) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastBreak = Math.max(cut.lastIndexOf("\n"), cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  const base = lastBreak > max * 0.55 ? cut.slice(0, lastBreak + 1).trim() : cut.trim();
  return (base.length <= max ? base : base.slice(0, max - 1)).replace(/[,:;.\-\s]+$/, "") + "…";
}

export async function buildDescription(config, env, options = {}) {
  const topic = resolveTopic(config, options.topic);
  const vars = {
    topic,
    detail: options.detail || config.productDetail || "",
    cta: options.cta || config.cta || "",
  };

  const mode = options.mode || config.contentMode || "template";
  const maxLen = Number(config.defaults?.maxDescriptionLength || MAX_DESCRIPTION);

  if (options.description) {
    return {
      description: clampDescription(fillPlaceholders(options.description, vars), maxLen),
      topic,
      mode: "manual",
    };
  }

  if (mode === "ai") {
    const userPrompt = fillPlaceholders(
      config.ai?.userPromptTemplate ||
        "Buat caption Threads. Topik: {{topic}}. Detail: {{detail}}. CTA: {{cta}}",
      vars
    );

    const attempts = Number(config.ai?.retries ?? 2);
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        const description = await generateWithOpenRouter({
          apiKey: env.openRouterKey,
          model: env.openRouterModel,
          systemPrompt: config.ai?.systemPrompt || "You are a Threads copywriter.",
          userPrompt:
            i === 0
              ? userPrompt
              : `${userPrompt}\n\nULANGI. Jawab HANYA caption final berbahasa Indonesia. Jangan tulis constraint, count characters, drafting, atau penjelasan.`,
          temperature: (config.ai?.temperature ?? 0.85) + i * 0.05,
          maxTokens: config.ai?.maxTokens ?? 200,
        });
        return {
          description: clampDescription(description, maxLen),
          topic,
          mode: "ai",
        };
      } catch (err) {
        lastErr = err;
        if (err.message !== "AI_META_DUMP") break;
      }
    }

    // Fallback template if model keeps dumping reasoning
    if (config.ai?.fallbackTemplate !== false) {
      const description = resolveFromTemplate(config, vars);
      return {
        description: clampDescription(description, maxLen),
        topic,
        mode: "template-fallback",
        aiError: lastErr?.message || "AI_META_DUMP",
      };
    }
    throw lastErr || new Error("AI failed to generate caption");
  }

  // template
  const description = resolveFromTemplate(config, vars);
  return { description: clampDescription(description, maxLen), topic, mode: "template" };
}
