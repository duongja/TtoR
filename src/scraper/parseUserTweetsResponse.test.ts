import { describe, expect, it } from "vitest";

import { parseUserTweetsResponse } from "./parseUserTweetsResponse.js";

function tweetResult(id: string, fullText: string, mediaType = "photo") {
  return {
    __typename: "Tweet",
    rest_id: id,
    core: {
      user_results: {
        result: {
          core: {
            name: "Donald J. Trump",
            screen_name: "realDonaldTrump"
          }
        }
      }
    },
    legacy: {
      conversation_id_str: id,
      created_at: "Mon Mar 02 16:20:05 +0000 2026",
      entities: {},
      extended_entities: {
        media: [
          {
            type: mediaType,
            media_url_https: "https://pbs.twimg.com/media/example.jpg",
            ext_alt_text: "example",
            video_info:
              mediaType === "video"
                ? {
                    variants: [
                      {
                        content_type: "application/x-mpegURL",
                        url: "https://video.twimg.com/example.m3u8"
                      },
                      {
                        bitrate: 256000,
                        content_type: "video/mp4",
                        url: "https://video.twimg.com/low.mp4"
                      },
                      {
                        bitrate: 832000,
                        content_type: "video/mp4",
                        url: "https://video.twimg.com/high.mp4"
                      }
                    ]
                  }
                : undefined
          }
        ]
      },
      full_text: fullText,
      id_str: id,
      lang: "en",
      user_id_str: "25073877"
    }
  };
}

describe("parseUserTweetsResponse", () => {
  it("extracts normalized posts from UserTweets timeline entries", () => {
    const payload = {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  {
                    entries: [
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: tweetResult("2028505632123326484", "https://t.co/uAxTGrJisv", "video")
                            }
                          }
                        }
                      },
                      {
                        content: {
                          itemContent: {
                            tweet_results: {
                              result: tweetResult("2017417980594827718", "Last night I saw MELANIA.")
                            }
                          }
                        }
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      }
    };

    const posts = parseUserTweetsResponse(payload, {
      expectedHandle: "realDonaldTrump",
      detectedAt: "2026-05-15T13:00:00.000Z"
    });

    expect(posts).toHaveLength(2);
    expect(posts[0]).toMatchObject({
      postId: "2028505632123326484",
      authorHandle: "realDonaldTrump",
      authorDisplayName: "Donald J. Trump",
      text: "https://t.co/uAxTGrJisv",
      lang: "en",
      media: [
        {
          kind: "video",
          url: "https://video.twimg.com/high.mp4",
          alt: "example"
        }
      ],
      rawPayload: {
        source: "network"
      }
    });
    expect(posts[1]).toMatchObject({
      postId: "2017417980594827718",
      text: "Last night I saw MELANIA.",
      media: [
        {
          kind: "image",
          url: "https://pbs.twimg.com/media/example.jpg",
          alt: "example"
        }
      ]
    });
  });

  it("ignores tweets from other handles", () => {
    const other = tweetResult("1", "Not Trump");
    other.core.user_results.result.core.screen_name = "someoneElse";

    expect(
      parseUserTweetsResponse(
        {
          data: {
            entries: [
              {
                itemContent: {
                  tweet_results: {
                    result: other
                  }
                }
              }
            ]
          }
        },
        {
          expectedHandle: "realDonaldTrump"
        }
      )
    ).toHaveLength(0);
  });

  it("extracts posts from SearchTimeline payloads", () => {
    const payload = {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  entries: [
                    {
                      content: {
                        itemContent: {
                          tweet_results: {
                            result: tweetResult("2028505632123326484", "Search result post")
                          }
                        }
                      }
                    }
                  ]
                }
              ]
            }
          }
        }
      }
    };

    expect(
      parseUserTweetsResponse(payload, {
        expectedHandle: "realDonaldTrump"
      })
    ).toMatchObject([
      {
        postId: "2028505632123326484",
        text: "Search result post"
      }
    ]);
  });
});
