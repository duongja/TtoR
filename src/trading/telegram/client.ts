export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<void>;
}

interface TelegramHttpClientOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

export class TelegramHttpClient implements TelegramClient {
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;

  public constructor(
    private readonly botToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
    options: TelegramHttpClientOptions = {}
  ) {
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
  }

  public async sendMessage(chatId: string, text: string): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: true
          })
        });

        if (response.ok) {
          return;
        }

        const error = new Error(`Telegram sendMessage failed with ${response.status}: ${await response.text()}`);
        if (!this.isRetryableStatus(response.status) || attempt === this.maxAttempts) {
          throw error;
        }
        lastError = error;
      } catch (error) {
        if (attempt === this.maxAttempts) {
          throw error;
        }
        lastError = error;
      }

      await this.sleep(this.retryDelayMs * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error("Telegram sendMessage failed");
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
