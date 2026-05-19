import { describe, expect, it } from "vitest";

import { isAuthorizedTelegramWebhook } from "./deployment.js";

describe("isAuthorizedTelegramWebhook", () => {
  it("requires the Telegram secret token header to match", () => {
    expect(isAuthorizedTelegramWebhook(new Request("https://example.com"), "secret")).toBe(false);
    expect(
      isAuthorizedTelegramWebhook(
        new Request("https://example.com", {
          headers: {
            "x-telegram-bot-api-secret-token": "wrong"
          }
        }),
        "secret"
      )
    ).toBe(false);
    expect(
      isAuthorizedTelegramWebhook(
        new Request("https://example.com", {
          headers: {
            "x-telegram-bot-api-secret-token": "secret"
          }
        }),
        "secret"
      )
    ).toBe(true);
  });
});
