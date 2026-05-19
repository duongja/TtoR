import type { JupiterClient, JupiterExecuteResponse, JupiterOrderRequest, JupiterOrderResponse } from "../types.js";

export class JupiterSwapClient implements JupiterClient {
  public constructor(
    private readonly options: {
      apiBaseUrl: string;
      apiKey: string;
    },
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  public async createOrder(request: JupiterOrderRequest): Promise<JupiterOrderResponse> {
    const url = new URL(`${this.options.apiBaseUrl}/swap/v2/order`);
    url.searchParams.set("inputMint", request.inputMint);
    url.searchParams.set("outputMint", request.outputMint);
    url.searchParams.set("amount", request.amount);
    url.searchParams.set("taker", request.taker);
    url.searchParams.set("slippageBps", String(request.slippageBps));

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: this.headers()
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Jupiter order failed with ${response.status}: ${JSON.stringify(body)}`);
    }

    const order = body as Partial<JupiterOrderResponse>;
    if (order.error || !order.requestId || !order.transaction || !order.outAmount) {
      throw new Error(`Jupiter order returned an unusable response: ${JSON.stringify(body)}`);
    }

    return order as JupiterOrderResponse;
  }

  public async executeSignedTransaction(params: {
    requestId: string;
    signedTransaction: string;
  }): Promise<JupiterExecuteResponse> {
    const response = await this.fetchImpl(`${this.options.apiBaseUrl}/swap/v2/execute`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(params)
    });

    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Jupiter execute failed with ${response.status}: ${JSON.stringify(body)}`);
    }

    return body as JupiterExecuteResponse;
  }

  private headers(): HeadersInit {
    return {
      "content-type": "application/json",
      "x-api-key": this.options.apiKey
    };
  }
}
