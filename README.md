# Polymarket X Ingestor

This service polls `@polymarket` on X, normalizes newly detected posts, stores them, and exposes a small read API. Local development uses Playwright + SQLite. Vercel deployment uses X auth cookies + Postgres + Vercel Cron.

## Requirements

- Node.js `22+`
- An X account dedicated to monitoring
- Playwright browser binaries installed locally
- Postgres for Vercel deployment

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

Edit `.env` as needed. Defaults already match the v1 plan.

`BROWSER_CHANNEL=chrome` is the default because X login often behaves better in the locally installed Google Chrome than in Playwright's bundled Chromium.

## Commands

One-time interactive login:

```bash
npm run login
```

Use X's native username/email + password flow in that browser window. Do not use `Sign in with Google`, because Google commonly blocks OAuth from automation-controlled browsers.

Run one scrape cycle and print a summary:

```bash
npm run poll-once
```

Backfill posts from January 1, 2026 through the present:

```bash
npm run backfill
```

Use a custom cutoff by passing an ISO date:

```bash
npm run backfill -- 2026-01-01T00:00:00.000Z
```

Backfill scrolls the authenticated profile timeline and captures X `UserTweets` responses until it reaches the cutoff date or stops making progress. Stored posts are deduped by `post_id`.

Run the long-lived worker:

```bash
npm run worker
```

Run the worker and the read API together:

```bash
npm run serve
```

Run only the read API against the existing database:

```bash
npm run api
```

## API

- `GET /health`
- `GET /posts/latest`
- `GET /posts?since_detected_at=<ISO timestamp>`
- `GET /posts?since_created_at=<ISO timestamp>`
- `GET /meme-analyses?status=success&limit=50`
- `GET /meme-signals?min_score=70&limit=50`
- `GET /posts/<post_id>/meme-analysis`

On Vercel, the same endpoints are under `/api`:

- `GET /api/health`
- `GET /api/posts/latest`
- `GET /api/posts?since_detected_at=<ISO timestamp>`
- `GET /api/posts?since_created_at=<ISO timestamp>`
- `GET /api/meme-analyses?status=success&limit=50`
- `GET /api/meme-signals?min_score=70&limit=50`
- `GET /api/posts/<post_id>/meme-analysis`
- `GET /api/cron/poll`

## AI memecoin signal analysis

The optional AI layer analyzes saved Polymarket posts and produces search intelligence for possible existing memecoins. It does not launch coins, search token markets, verify contracts, or make trading recommendations.

Enable it with:

```bash
AI_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://share-ai.ckbdev.com
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=medium
OPENAI_DISABLE_RESPONSE_STORAGE=true
OPENAI_TIMEOUT_MS=30000
AI_MAX_POSTS_PER_POLL=1
MEME_SIGNAL_THRESHOLD=70
```

When enabled, each successful poll analyzes up to `AI_MAX_POSTS_PER_POLL` posts that do not yet have a meme signal analysis. AI failures are stored on the relevant post and do not fail the scraping poll. The recommended cron-safe profile is `gpt-5.4` with `medium` reasoning and one post per poll.

## Vercel Deployment

Vercel cannot run the local long-lived worker, persist `./data/app.db`, or reuse the local Chrome profile. The deployable path uses Vercel Cron to call `/api/cron/poll` once per minute and stores state in Postgres. Vercel's built-in once-per-minute cron requires a Pro or Enterprise plan; on Hobby, use an external scheduler to call `/api/cron/poll` with the same `Authorization` header.

Required Vercel env vars:

```bash
POSTGRES_URL=postgres://...
X_TARGET_HANDLE=polymarket
X_COOKIE_HEADER=<full Cookie request header from X>
X_USER_TWEETS_URL=<optional captured /UserTweets? URL>
CRON_SECRET=<optional random secret>
LOG_LEVEL=info
AI_ENABLED=true
OPENAI_API_KEY=<OpenAI API key>
OPENAI_BASE_URL=https://share-ai.ckbdev.com
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=medium
OPENAI_DISABLE_RESPONSE_STORAGE=true
OPENAI_TIMEOUT_MS=30000
AI_MAX_POSTS_PER_POLL=1
MEME_SIGNAL_THRESHOLD=70
```

To get `X_COOKIE_HEADER`, log into X in a normal browser with the monitoring account, open DevTools, inspect the network request containing `/UserTweets?`, and copy the full `Cookie` request header. As a fallback, you can set `X_AUTH_TOKEN` and `X_CSRF_TOKEN` from the `auth_token` and `ct0` cookies, but the full cookie header is more reliable. These cookies expire or can be invalidated by X, so monitoring health must be watched.

`X_USER_TWEETS_URL` is recommended because X does not always expose the GraphQL operation URL in static HTML. Capture it locally from a logged-in session by watching network requests to `https://x.com/polymarket` and copying the request URL containing `/UserTweets?`.

Deploy:

```bash
vercel
vercel env add POSTGRES_URL
vercel env add X_COOKIE_HEADER
vercel env add X_USER_TWEETS_URL
vercel env add CRON_SECRET
vercel --prod
```

Manual poll test after deployment:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<project>.vercel.app/api/cron/poll
```

## Telegram Solana Buy Bot

The optional Telegram trading layer is independent from the signal monitor. It only buys tokens explicitly supplied by the authorized Telegram user; it does not auto-buy from AI signals.

V1 supports exact-input Solana buys with a confirmation step:

```text
/buy <token_mint> <amount> <SOL|USDC|USDT>
/confirm <trade_id>
/cancel <trade_id>
/balance
/help
```

Required env vars:

```bash
TRADING_ENABLED=true
TELEGRAM_BOT_TOKEN=<telegram bot token>
TELEGRAM_WEBHOOK_SECRET=<random webhook secret>
TELEGRAM_ALLOWED_USER_IDS=<your numeric Telegram user id>
PUBLIC_BASE_URL=https://<project>.vercel.app
POSTGRES_URL=postgres://...
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_WALLET_SECRET_KEY=<base58 secret key or JSON number array>
JUPITER_API_KEY=<jupiter api key>
```

Recommended safety env vars:

```bash
DEFAULT_SLIPPAGE_BPS=500
MAX_SLIPPAGE_BPS=1000
MAX_PRICE_IMPACT_PCT=15
MIN_SOL_FEE_BALANCE=0.005
MIN_SOL_RESERVE=0.02
MAX_BUY_SOL=1
MAX_BUY_USDC=500
MAX_BUY_USDT=500
TRADE_INTENT_TTL_SECONDS=60
```

Set the Telegram webhook after deployment:

```bash
npm run telegram:set-webhook
```

Use a limited-balance hot wallet only. Do not use a primary wallet private key.

## Runtime data

The service stores runtime state under `./data/`:

- `app.db`: SQLite database
- `browser-profile-chrome/` or `browser-profile-chromium/`: persisted Playwright session for the selected browser channel
- `artifacts/`: screenshots and HTML captures on parse/login failures

## Notes

- This is a polling scraper, not a push feed. Detection timing is bounded by the poll interval.
- X page structure changes can break parsing. When that happens, inspect artifacts under `data/artifacts/`.
- `npm run login` must be completed before headless polling can work reliably.
