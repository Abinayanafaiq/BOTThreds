import axios from "axios";

/**
 * Generate caption via OpenRouter
 */
export async function generateWithOpenRouter({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  temperature = 0.85,
  maxTokens = 400,
}) {
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY missing. Set it in .env or use contentMode: template");
  }

  const { data } = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      max_tokens: maxTokens,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/repliz-threads-bot",
        "X-Title": "Repliz Threads Bot",
      },
      timeout: 90000,
    }
  );

  const raw = data?.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("OpenRouter returned empty content");
  return cleanCaption(raw);
}

const META_PATTERNS = [
  /the user wants/i,
  /constraints?:/i,
  /drafting ideas/i,
  /count characters/i,
  /including spaces/i,
  /let'?s count/i,
  /character count/i,
  /line \d+\s*:/i,
  /^hook\s*:/i,
  /^solution\s*:/i,
  /^target\s*:/i,
  /^tone\s*:/i,
  /^must mention/i,
  /^no (excessive|markdown)/i,
  /here'?s (a |the )?(final )?caption/i,
  /output only/i,
  /thinking process/i,
  /chain of thought/i,
  /max(imal)? \d+ karakter/i,
  /maksimal \d+ karakter/i,
  /total caption/i,
  /wajib:/i,
  /fakta wajib/i,
  /angle:/i,
  /produk:/i,
];

function isMetaLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (META_PATTERNS.some((re) => re.test(t))) return true;
  if (/^[-*•]\s*(max|must|include|tone|cta|target|hook|line)/i.test(t)) return true;
  if (/^\d+\.\s*(max|must|include|tone|hook|line|constraint)/i.test(t)) return true;
  // English planning sentences common in reasoning dumps
  if (
    /^(the |this |we |i |let'?s |need to |should |draft |final caption)/i.test(t) &&
    /(character|constraint|caption|mention|include|spaces|newlines)/i.test(t)
  ) {
    return true;
  }
  return false;
}

function looksLikeMetaDump(text) {
  const s = String(text || "");
  if (META_PATTERNS.some((re) => re.test(s))) return true;
  const lines = s.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  const metaCount = lines.filter(isMetaLine).length;
  if (metaCount >= 2) return true;
  if (metaCount >= 1 && metaCount / lines.length >= 0.35) return true;
  // Mostly English instructional content
  const eng = (s.match(/\b(the|and|with|for|must|should|character|caption)\b/gi) || []).length;
  const id = (s.match(/\b(yang|untuk|dari|bisa|murah|token|di)\b/gi) || []).length;
  if (eng > 12 && eng > id * 2) return true;
  return false;
}

/** Strip model reasoning / meta dump so only post-ready caption remains */
export function cleanCaption(text) {
  let s = String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<\/?think>/gi, "")
    .trim();

  // Prefer content after markers like "Caption:" / "Final:"
  const marker = s.match(/(?:^|\n)\s*(?:final\s*)?caption\s*:\s*\n?([\s\S]+)$/i);
  if (marker?.[1]) s = marker[1].trim();

  const lines = s.split("\n");
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (kept.length && kept[kept.length - 1] !== "") kept.push("");
      continue;
    }
    if (isMetaLine(t)) continue;
    kept.push(t);
  }
  s = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();

  // Take best paragraph candidate
  const parts = s
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !looksLikeMetaDump(p));

  if (parts.length) {
    // Prefer Indonesian promo-ish block with product keywords
    const scored = parts
      .map((p) => {
        let score = 0;
        if (/9inference|rp\s*1\.?000|1\s*jt|1\s*juta|token/i.test(p)) score += 5;
        if (/[a-zà-ÿ]/i.test(p) && !looksLikeMetaDump(p)) score += 2;
        if (p.length >= 40 && p.length <= 500) score += 2;
        if (/\b(the user|constraints|count characters)\b/i.test(p)) score -= 10;
        return { p, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) s = scored[0].p;
  }

  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'")) ||
    (s.startsWith("“") && s.endsWith("”"))
  ) {
    s = s.slice(1, -1).trim();
  }

  if (!s || s.length < 20 || looksLikeMetaDump(s)) {
    throw new Error("AI_META_DUMP");
  }
  return s;
}

export function fillPlaceholders(str, vars) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ""
  );
}
