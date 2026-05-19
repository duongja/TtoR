import { errorJson, json } from "../../src/http.js";
import { createTelegramTradingRuntime, isAuthorizedTelegramWebhook } from "../../src/trading/deployment.js";
import type { TelegramUpdate } from "../../src/trading/types.js";

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let runtime: ReturnType<typeof createTelegramTradingRuntime> | null = null;

  try {
    runtime = createTelegramTradingRuntime();
    if (!isAuthorizedTelegramWebhook(request, runtime.tradingConfig.telegramWebhookSecret)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const update = (await request.json()) as TelegramUpdate;
    await runtime.service.handleUpdate(update);
    return json({ ok: true });
  } catch (error) {
    return errorJson(error);
  } finally {
    await runtime?.repository.close();
  }
}
