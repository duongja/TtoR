# Trump X Ingestor

This service polls `@realDonaldTrump` on X using a persisted Playwright browser session, normalizes newly detected posts, stores them in SQLite, and exposes a small read API.

## Requirements

- Node.js `22+`
- An X account dedicated to monitoring
- Playwright browser binaries installed locally

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

## Runtime data

The service stores runtime state under `./data/`:

- `app.db`: SQLite database
- `browser-profile-chrome/` or `browser-profile-chromium/`: persisted Playwright session for the selected browser channel
- `artifacts/`: screenshots and HTML captures on parse/login failures

## Notes

- This is a polling scraper, not a push feed. Detection timing is bounded by the poll interval.
- X page structure changes can break parsing. When that happens, inspect artifacts under `data/artifacts/`.
- `npm run login` must be completed before headless polling can work reliably.
