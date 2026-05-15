import type { MediaAsset, NormalizedPost } from "../types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }

  const child = value[key];
  return isRecord(child) ? child : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseTwitterDate(value: unknown): string | null {
  const raw = getString(value);
  if (!raw) {
    return null;
  }

  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function unwrapTweetResult(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) {
    return null;
  }

  if (getRecord(result, "legacy")) {
    return result;
  }

  const tweet = getRecord(result, "tweet");
  if (tweet) {
    return unwrapTweetResult(tweet);
  }

  const innerResult = getRecord(result, "result");
  if (innerResult) {
    return unwrapTweetResult(innerResult);
  }

  return null;
}

function extractTweetResults(value: unknown): Record<string, unknown>[] {
  const tweets: Record<string, unknown>[] = [];

  function visit(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    const itemContent = getRecord(node, "itemContent");
    const tweetResults = getRecord(itemContent, "tweet_results");
    const tweet = unwrapTweetResult(tweetResults?.result);
    if (tweet) {
      tweets.push(tweet);
    }

    for (const value of Object.values(node)) {
      visit(value);
    }
  }

  visit(value);
  return tweets;
}

function extractUser(tweet: Record<string, unknown>): {
  handle: string | null;
  displayName: string | null;
} {
  const userResult = getRecord(getRecord(getRecord(tweet, "core"), "user_results"), "result");
  const core = getRecord(userResult, "core");
  const legacy = getRecord(userResult, "legacy");

  return {
    handle: getString(core?.screen_name) ?? getString(legacy?.screen_name),
    displayName: getString(core?.name) ?? getString(legacy?.name)
  };
}

function extractMedia(legacy: Record<string, unknown>): MediaAsset[] {
  const extendedEntities = getRecord(legacy, "extended_entities");
  const entities = getRecord(legacy, "entities");
  const media = Array.isArray(extendedEntities?.media)
    ? extendedEntities.media
    : Array.isArray(entities?.media)
      ? entities.media
      : [];

  const seen = new Set<string>();
  const assets: MediaAsset[] = [];

  for (const item of media) {
    if (!isRecord(item)) {
      continue;
    }

    const type = getString(item.type);
    const imageUrl = getString(item.media_url_https);
    const variants = getRecord(item, "video_info")?.variants;
    const bestVideo = Array.isArray(variants)
      ? variants
          .filter(isRecord)
          .filter((variant) => getString(variant.content_type) === "video/mp4")
          .sort((left, right) => Number(right.bitrate ?? 0) - Number(left.bitrate ?? 0))[0]
      : null;
    const url = getString(bestVideo?.url) ?? imageUrl;

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    assets.push({
      kind: type === "video" || type === "animated_gif" ? "video" : "image",
      url,
      alt: getString(item.ext_alt_text)
    });
  }

  return assets;
}

function quotedPostId(tweet: Record<string, unknown>): string | null {
  const quoted = unwrapTweetResult(getRecord(tweet, "quoted_status_result")?.result);
  if (!quoted) {
    return null;
  }

  return getString(quoted.rest_id) ?? getString(getRecord(quoted, "legacy")?.id_str);
}

function normalizeTweet(
  tweet: Record<string, unknown>,
  options: { expectedHandle?: string; detectedAt: string }
): NormalizedPost | null {
  const legacy = getRecord(tweet, "legacy");
  if (!legacy) {
    return null;
  }

  const user = extractUser(tweet);
  if (!user.handle) {
    return null;
  }

  if (options.expectedHandle && user.handle.toLowerCase() !== options.expectedHandle.toLowerCase()) {
    return null;
  }

  const postId = getString(tweet.rest_id) ?? getString(legacy.id_str);
  if (!postId) {
    return null;
  }

  const fullText = getString(legacy.full_text) ?? "";

  return {
    postId,
    authorHandle: user.handle,
    authorDisplayName: user.displayName,
    createdAt: parseTwitterDate(legacy.created_at),
    detectedAt: options.detectedAt,
    text: fullText,
    lang: getString(legacy.lang),
    conversationId: getString(legacy.conversation_id_str),
    replyToPostId: getString(legacy.in_reply_to_status_id_str),
    quotedPostId: quotedPostId(tweet),
    isRepost: Boolean(getRecord(legacy, "retweeted_status_result")),
    media: extractMedia(legacy),
    rawPayload: {
      source: "network",
      tweet
    }
  };
}

export function parseUserTweetsResponse(
  payload: unknown,
  options: { expectedHandle?: string; detectedAt?: string } = {}
): NormalizedPost[] {
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const posts = new Map<string, NormalizedPost>();

  for (const tweet of extractTweetResults(payload)) {
    const post = normalizeTweet(tweet, {
      expectedHandle: options.expectedHandle,
      detectedAt
    });

    if (post) {
      posts.set(post.postId, post);
    }
  }

  return [...posts.values()].sort((left, right) => {
    const leftDate = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightDate = right.createdAt ? Date.parse(right.createdAt) : 0;

    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return right.postId.localeCompare(left.postId);
  });
}
