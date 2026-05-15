import { load } from "cheerio";

import { ScraperError } from "../errors.js";
import type { MediaAsset, NormalizedPost } from "../types.js";
import { collapseWhitespace, unique } from "../utils.js";

interface StatusReference {
  handle: string;
  postId: string;
}

function parseStatusReference(href: string | undefined): StatusReference | null {
  if (!href) {
    return null;
  }

  const match = href.match(/\/([^/]+)\/status\/(\d+)/i);
  if (!match) {
    return null;
  }

  return {
    handle: match[1],
    postId: match[2]
  };
}

function sortPosts(posts: NormalizedPost[]): NormalizedPost[] {
  return [...posts].sort((left, right) => {
    const leftDate = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightDate = right.createdAt ? Date.parse(right.createdAt) : 0;

    if (leftDate !== rightDate) {
      return rightDate - leftDate;
    }

    return right.postId.localeCompare(left.postId);
  });
}

function extractMediaUrls(card: any): MediaAsset[] {
  const assets: MediaAsset[] = [];

  card
    .find("img[src], video[src], video[poster], source[src]")
    .each((_index: number, element: any) => {
      const tagName = element.tagName.toLowerCase();
      const src = element.attribs.src ?? element.attribs.poster ?? null;

      if (!src) {
        return;
      }

      if (
        src.startsWith("blob:") ||
        src.includes("profile_images") ||
        src.includes("emoji") ||
        src.includes("/card_img/")
      ) {
        return;
      }

      assets.push({
        kind: tagName === "img" ? "image" : "video",
        url: src,
        alt: element.attribs.alt ?? null
      });
    });

  return unique(assets.map((asset) => JSON.stringify(asset))).map((asset) => JSON.parse(asset) as MediaAsset);
}

function extractDisplayName(root: ReturnType<typeof load>, card: any): string | null {
  const candidates = card
    .find("[data-testid='User-Name'] span")
    .toArray()
    .map((element: any) => collapseWhitespace(root(element).text()))
    .filter((value: string) => value.length > 0 && !value.startsWith("@"));

  return candidates[0] ?? null;
}

function extractText(card: any): { text: string; lang: string | null } {
  const tweetText = card.find("[data-testid='tweetText']").first();
  if (tweetText.length > 0) {
    return {
      text: collapseWhitespace(tweetText.text()),
      lang: tweetText.attr("lang") ?? null
    };
  }

  const langMatches = card.find("[lang]");
  const bestLangNode = Array.from({ length: langMatches.length }, (_unused, index) => {
    const node = langMatches.eq(index);
    return {
      text: collapseWhitespace(node.text()),
      lang: node.attr("lang") ?? null
    };
  })
    .filter((node: { text: string }) => node.text.length > 0)
    .sort((left: { text: string }, right: { text: string }) => right.text.length - left.text.length)[0];

  if (bestLangNode) {
    return {
      text: bestLangNode.text,
      lang: bestLangNode.lang
    };
  }

  return { text: "", lang: null };
}

function extractPostCards(html: string): { root: ReturnType<typeof load>; cards: any[] } {
  const root = load(html);
  const articleNodes = root("article").toArray();

  if (articleNodes.length > 0) {
    return { root, cards: articleNodes };
  }

  const cards = unique(
    root("a[href*='/status/']")
      .toArray()
      .map((anchor) => root(anchor).closest("[data-testid='cellInnerDiv']").get(0))
      .filter((card): card is NonNullable<typeof card> => card !== undefined)
      .map((card) => root.html(card) ?? "")
  ).map((htmlChunk) => {
    const match = root("[data-testid='cellInnerDiv']")
      .toArray()
      .find((candidate) => (root.html(candidate) ?? "") === htmlChunk);

    return match;
  }).filter((card): card is NonNullable<typeof card> => card !== undefined);

  return { root, cards };
}

export function parseTimelineHtml(
  html: string,
  options: { expectedHandle?: string; detectedAt?: string } = {}
): NormalizedPost[] {
  const { root, cards } = extractPostCards(html);
  const detectedAt = options.detectedAt ?? new Date().toISOString();
  const posts = new Map<string, NormalizedPost>();

  for (const element of cards) {
    const card = root(element);
    const statusReferences = unique(
      card
        .find("a[href*='/status/']")
        .toArray()
        .map((anchor) => parseStatusReference(root(anchor).attr("href")))
        .filter((value): value is StatusReference => value !== null)
        .map((value) => JSON.stringify(value))
    ).map((value) => JSON.parse(value) as StatusReference);

    if (statusReferences.length === 0) {
      continue;
    }

    const primaryReference =
      statusReferences.find(
        (reference) =>
          options.expectedHandle &&
          reference.handle.toLowerCase() === options.expectedHandle.toLowerCase()
      ) ?? statusReferences[0];

    if (!primaryReference) {
      continue;
    }

    const otherReferences = statusReferences.filter(
      (reference) => reference.postId !== primaryReference.postId
    );
    const { text, lang } = extractText(card);
    const media = extractMediaUrls(card);
    const rawHtml = root.html(element) ?? "";
    const articleText = collapseWhitespace(card.text());

    posts.set(primaryReference.postId, {
      postId: primaryReference.postId,
      authorHandle: primaryReference.handle,
      authorDisplayName: extractDisplayName(root, card),
      createdAt: card.find("time").attr("datetime") ?? null,
      detectedAt,
      text,
      lang,
      conversationId: primaryReference.postId,
      replyToPostId:
        articleText.toLowerCase().includes("replying to") && otherReferences.length > 0
          ? otherReferences[0].postId
          : null,
      quotedPostId:
        otherReferences.length > 0
          ? otherReferences[otherReferences.length - 1].postId
          : null,
      isRepost: articleText.toLowerCase().includes("reposted"),
      media,
      rawPayload: {
        source: "dom",
        statusReferences,
        html: rawHtml
      }
    });
  }

  const parsedPosts = sortPosts([...posts.values()]);

  if (parsedPosts.length === 0) {
    throw new ScraperError("PARSE_FAILED", "No post candidates were found in timeline HTML");
  }

  return parsedPosts;
}
