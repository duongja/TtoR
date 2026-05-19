import { describe, expect, it, vi } from "vitest";

import { JupiterSwapClient } from "./client.js";

describe("JupiterSwapClient", () => {
  it("creates orders with the v2 GET order endpoint and API key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          requestId: "request-1",
          transaction: "transaction-1",
          inputMint: "input",
          outputMint: "output",
          inAmount: "100",
          outAmount: "200",
          priceImpactPct: "1"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new JupiterSwapClient(
      {
        apiBaseUrl: "https://api.jup.ag",
        apiKey: "jup-key"
      },
      fetchMock as unknown as typeof fetch
    );

    await client.createOrder({
      inputMint: "input",
      outputMint: "output",
      amount: "100",
      taker: "wallet",
      slippageBps: 500
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("/swap/v2/order?");
    expect(url.searchParams.get("inputMint")).toBe("input");
    expect(url.searchParams.get("outputMint")).toBe("output");
    expect(url.searchParams.get("amount")).toBe("100");
    expect(url.searchParams.get("taker")).toBe("wallet");
    expect(url.searchParams.get("slippageBps")).toBe("500");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({
      "x-api-key": "jup-key"
    });
  });
});
