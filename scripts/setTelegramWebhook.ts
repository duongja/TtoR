import "dotenv/config";

import { loadTradingConfig, requireTradingConfig } from "../src/trading/config.js";

function normalizeBaseUrl(value: string): string {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/$/, "");
  }

  return `https://${value.replace(/\/$/, "")}`;
}

async function main(): Promise<void> {
  const config = loadTradingConfig();
  requireTradingConfig(config);

  if (!config.publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required to set Telegram webhook");
  }

  const webhookUrl = `${normalizeBaseUrl(config.publicBaseUrl)}/api/telegram/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/setWebhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: config.telegramWebhookSecret,
      allowed_updates: ["message"]
    })
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) {
    throw new Error(`Telegram setWebhook failed with ${response.status}: ${JSON.stringify(body)}`);
  }

  console.log(JSON.stringify({ ok: true, webhookUrl, result: body }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
