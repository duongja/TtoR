import { describe, expect, it } from "vitest";

import { Repository } from "./storage.js";
import type { NormalizedPost } from "./types.js";

function createPost(postId: string, detectedAt: string): NormalizedPost {
  return {
    postId,
    authorHandle: "realDonaldTrump",
    authorDisplayName: "Donald J. Trump",
    createdAt: detectedAt,
    detectedAt,
    text: `Post ${postId}`,
    lang: "en",
    conversationId: postId,
    replyToPostId: null,
    quotedPostId: null,
    isRepost: false,
    media: [],
    rawPayload: {
      id: postId
    }
  };
}

describe("Repository", () => {
  it("deduplicates posts while recording poll runs", () => {
    const repository = Repository.open(":memory:");

    const first = repository.recordPollRun({
      startedAt: "2026-05-15T10:00:00.000Z",
      finishedAt: "2026-05-15T10:00:05.000Z",
      status: "success",
      posts: [createPost("2", "2026-05-15T10:00:00.000Z"), createPost("1", "2026-05-15T09:59:00.000Z")]
    });

    const second = repository.recordPollRun({
      startedAt: "2026-05-15T10:01:00.000Z",
      finishedAt: "2026-05-15T10:01:05.000Z",
      status: "success",
      posts: [createPost("2", "2026-05-15T10:00:00.000Z")]
    });

    expect(first).toMatchObject({
      newPostsCount: 2,
      latestPostId: "2"
    });
    expect(second).toMatchObject({
      newPostsCount: 0,
      latestPostId: "2"
    });
    expect(repository.getLatestPost()?.postId).toBe("2");
    expect(repository.getPostsSinceDetectedAt("2026-05-15T09:58:00.000Z")).toHaveLength(2);
    expect(repository.getPostsSinceCreatedAt("2026-05-15T10:00:00.000Z").map((post) => post.postId)).toEqual(["2"]);

    repository.close();
  });

  it("returns latest post by created_at instead of initial detection order", () => {
    const repository = Repository.open(":memory:");

    repository.recordPollRun({
      startedAt: "2026-05-15T10:00:00.000Z",
      finishedAt: "2026-05-15T10:00:05.000Z",
      status: "success",
      posts: [createPost("old", "2026-01-01T00:00:00.000Z")]
    });
    repository.recordPollRun({
      startedAt: "2026-05-15T10:01:00.000Z",
      finishedAt: "2026-05-15T10:01:05.000Z",
      status: "success",
      posts: [createPost("new", "2026-05-15T00:00:00.000Z")]
    });

    expect(repository.getLatestPost()?.postId).toBe("new");

    repository.close();
  });
});
