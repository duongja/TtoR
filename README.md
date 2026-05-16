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

On Vercel, the same endpoints are under `/api`:

- `GET /api/health`
- `GET /api/posts/latest`
- `GET /api/posts?since_detected_at=<ISO timestamp>`
- `GET /api/posts?since_created_at=<ISO timestamp>`
- `GET /api/cron/poll`

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

## Runtime data

The service stores runtime state under `./data/`:

- `app.db`: SQLite database
- `browser-profile-chrome/` or `browser-profile-chromium/`: persisted Playwright session for the selected browser channel
- `artifacts/`: screenshots and HTML captures on parse/login failures

## Notes

- This is a polling scraper, not a push feed. Detection timing is bounded by the poll interval.
- X page structure changes can break parsing. When that happens, inspect artifacts under `data/artifacts/`.
- `npm run login` must be completed before headless polling can work reliably.
