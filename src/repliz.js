import axios from "axios";

const BASE_URL = "https://api.repliz.com/public";

export function createReplizClient({ accessKey, secretKey }) {
  const client = axios.create({
    baseURL: BASE_URL,
    auth: { username: accessKey, password: secretKey },
    headers: { "Content-Type": "application/json" },
    timeout: 60000,
  });

  /**
   * Schedule a post via Repliz public API
   * @param {object} body - full request body
   */
  async function schedulePost(body) {
    const { data } = await client.post("/schedule", body);
    return data;
  }

  return { schedulePost, client };
}

/**
 * Build Repliz request body for Threads image/text post
 */
export function buildScheduleBody({
  accountId,
  scheduleAt,
  type = "image",
  title = "",
  description,
  topic = "",
  mediaUrls = [],
  isAiGenerated = false,
  isDraft = false,
  replies = [],
}) {
  const medias = mediaUrls.map((url) => ({
    alt: "",
    customThumbnail: false,
    type: type === "video" || type === "reel" ? "video" : "image",
    thumbnail: url,
    url,
  }));

  // text posts need empty medias; image/album need at least one
  const finalType =
    type === "text" || mediaUrls.length === 0
      ? "text"
      : mediaUrls.length > 1
        ? "album"
        : type === "image"
          ? "image"
          : type;

  return {
    title: title || "",
    description: description || "",
    topic: topic || "",
    type: finalType,
    medias: finalType === "text" ? [] : medias,
    meta: { title: "", description: "", url: "" },
    additionalInfo: {
      isAiGenerated: Boolean(isAiGenerated),
      isDraft: Boolean(isDraft),
      collaborators: [],
      mentions: [],
      music: { id: "", artist: "", name: "", thumbnail: "" },
      products: [],
      tags: [],
      link: "",
      targetCountries: [],
    },
    replies: Array.isArray(replies) ? replies : [],
    accountId,
    scheduleAt,
  };
}
