import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTimelineHtml } from "./parseTimelineHtml.js";

const fixturePath = resolve(process.cwd(), "tests/fixtures/timeline.html");

describe("parseTimelineHtml", () => {
  it("parses a mixed timeline fixture into normalized posts", () => {
    const html = readFileSync(fixturePath, "utf8");
    const posts = parseTimelineHtml(html, {
      expectedHandle: "realDonaldTrump",
      detectedAt: "2026-05-15T10:00:00.000Z"
    });

    expect(posts).toHaveLength(3);
    expect(posts[0]).toMatchObject({
      postId: "333333333333333333",
      authorHandle: "realDonaldTrump",
      text: "MAKE AMERICA SAFE AGAIN.",
      createdAt: "2026-05-15T10:00:00.000Z",
      media: []
    });
    expect(posts[1]).toMatchObject({
      postId: "222222222222222222",
      quotedPostId: "111111111111111111",
      isRepost: false
    });
    expect(posts[2]).toMatchObject({
      postId: "111111111111111111",
      isRepost: true
    });
  });

  it("throws when no post candidates are present", () => {
    expect(() => parseTimelineHtml("<html><body>No timeline here</body></html>")).toThrow(
      "No post candidates were found in timeline HTML"
    );
  });

  it("keeps extraction scoped to each card instead of reusing the first matching article", () => {
    const html = `
      <html>
        <body>
          <section>
            <article data-testid="tweet">
              <div data-testid="User-Name">
                <span>Donald J. Trump</span>
                <span>@realDonaldTrump</span>
              </div>
              <a href="/realDonaldTrump/status/111">one</a>
              <time datetime="2026-05-15T09:58:00.000Z"></time>
              <div data-testid="tweetText" lang="en">First post</div>
              <img src="https://pbs.twimg.com/media/first.jpg" alt="first" />
            </article>
          </section>
          <section>
            <article data-testid="tweet">
              <div data-testid="User-Name">
                <span>Donald J. Trump</span>
                <span>@realDonaldTrump</span>
              </div>
              <a href="/realDonaldTrump/status/222">two</a>
              <time datetime="2026-05-15T09:59:00.000Z"></time>
              <div data-testid="tweetText" lang="en">Second post</div>
              <img src="https://pbs.twimg.com/media/second.jpg" alt="second" />
              <img src="blob:https://x.com/not-real" alt="blob" />
            </article>
          </section>
        </body>
      </html>
    `;

    const posts = parseTimelineHtml(html, {
      expectedHandle: "realDonaldTrump",
      detectedAt: "2026-05-15T10:00:00.000Z"
    });

    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      postId: "222",
      text: "Second post",
      media: [
        {
          kind: "image",
          url: "https://pbs.twimg.com/media/second.jpg",
          alt: "second"
        }
      ]
    });
    expect(posts[1]).toMatchObject({
      postId: "111",
      text: "First post",
      media: [
        {
          kind: "image",
          url: "https://pbs.twimg.com/media/first.jpg",
          alt: "first"
        }
      ]
    });
  });
});
