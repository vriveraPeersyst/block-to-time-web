# Block ⇄ Time — XRPL EVM

Convert between block numbers and dates on **XRPL EVM Mainnet** and **Testnet**. Subscribe for Slack notifications as a target block approaches, with optional custom titles to label each watch.

![XRPL EVM](public/XRPLEVM_FullWhiteLogo.png)

## Features

- **Block → Time** — Enter a future block number, get the estimated date/time it will be reached.
- **Time → Block** — Enter a future date/time, get the estimated block number.
- **Multi-source estimation** — Cross-references Ethereum JSON-RPC, Tendermint RPC, and Cosmos API for high-confidence results.
- **Slack notifications** — Subscribe to a block watch and receive updates at 1 day, 6 hours, 1 hour, 15 min, and 5 min before the estimated time. A final "Block reached!" notification is sent when the target is hit.
- **Titled watches** — Give each watch an optional title (e.g. "Mainnet upgrade", "Token launch") for easy identification.
- **Active / Completed tabs** — Tracking dashboard separates in-progress watches from completed ones.
- **Calendar export** — One-click add to Google Calendar, Outlook, or download an `.ics` file.
- **Google OAuth** — Sign in to manage subscriptions. Form state is preserved across the OAuth redirect.
- **Saved webhooks** — Previously-used Slack webhook URLs are saved locally for quick reuse.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) |
| Language | TypeScript |
| Database | PostgreSQL + [Prisma](https://prisma.io) |
| Auth | [Auth.js v5](https://authjs.dev) (Google OAuth) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) (oklch design tokens) |
| Frontend | [Vercel](https://vercel.com) |
| Cron worker | [Railway](https://railway.app) (Node.js service with direct DB access) |

## Architecture

```
                    ┌─────────────┐
  Users ──────────▶ │   Vercel    │ ◀──── Next.js frontend + API routes
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  PostgreSQL  │ ◀──── Railway-hosted database
                    └──────┬──────┘
                           ▲
                           │
                    ┌──────┴──────┐
                    │ Cron Worker │ ◀──── Railway Node.js service (60s loop)
                    └─────────────┘       Reads notifications from DB,
                                          estimates blocks, sends Slack
```

The **cron worker** (`cron/notify.ts`) runs as a persistent Railway service that loops every 60 seconds. It connects directly to PostgreSQL via Prisma — no HTTP round-trip through Vercel.

## Getting Started

### Prerequisites

- Node.js ≥ 20
- PostgreSQL database
- Google OAuth credentials ([console.cloud.google.com](https://console.cloud.google.com/apis/credentials))

### Install

```bash
git clone https://github.com/<your-org>/block-to-time.git
cd block-to-time
npm install
```

### Configure

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Generate with `openssl rand -base64 32` |
| `AUTH_URL` | Public URL of the app (must match OAuth redirect URI) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `CRON_SECRET` | Protects the `/api/cron/notify` endpoint |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the app (used for calendar links) |

### Database

```bash
npx prisma migrate deploy   # apply migrations
npx prisma generate          # generate client
```

### Run

```bash
npm run dev       # http://localhost:3000
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/estimate?block=<n>&network=<net>` | Estimate when a block will be reached |
| `GET` | `/api/time-to-block?time=<iso>&network=<net>` | Estimate the block at a given time |
| `POST` | `/api/subscribe` | Create a block watch with Slack notifications (auth required) |
| `GET` | `/api/watches` | List authenticated user's block watches |
| `GET` | `/api/watch/[id]` | Get block watch status |
| `DELETE` | `/api/watch/[id]` | Cancel a block watch (auth required) |
| `GET` | `/api/calendar/[id]` | Download `.ics` calendar event |
| `GET/POST` | `/api/cron/notify` | Process pending notifications (protected by `CRON_SECRET`) |

`network` is one of `XRPL_EVM_MAINNET` or `XRPL_EVM_TESTNET`.

## Production Deployment

### Vercel (frontend)

1. Import the repo on [vercel.com](https://vercel.com).
2. Set environment variables: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `NEXT_PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CRON_SECRET`.
3. Deploy — the Next.js standalone build is used automatically.

### Railway (database + cron worker)

1. Create a project on [railway.app](https://railway.app).
2. Add a **PostgreSQL** plugin — use its connection string as `DATABASE_URL`.
3. Add a **service** from your GitHub repo.
4. Set the config file path to `/railway-cron.toml`.
5. Set environment variables on the cron service:
   - `DATABASE_URL` — the Railway PostgreSQL internal URL
   - `NEXT_PUBLIC_BASE_URL` — your Vercel app URL (for calendar links in Slack messages)
6. Deploy — the worker builds with `Dockerfile.cron` and runs as a persistent process.

### Docker (standalone)

```bash
# Main app
docker build -t block-to-time .
docker run -p 3000:3000 --env-file .env block-to-time

# Cron worker
docker build -f Dockerfile.cron -t block-to-time-cron .
docker run --env-file .env block-to-time-cron
```

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (fonts, providers)
│   ├── page.tsx                # Home page
│   ├── globals.css             # XRPL EVM theme (Tailwind v4, oklch tokens)
│   └── api/
│       ├── auth/[...nextauth]/ # Auth.js route handler
│       ├── estimate/           # Block → Time API
│       ├── time-to-block/      # Time → Block API
│       ├── subscribe/          # Create block watch
│       ├── watches/            # List user's watches
│       ├── watch/[id]/         # Get/cancel watch
│       ├── calendar/[id]/      # .ics download
│       └── cron/notify/        # Notification processor (Vercel fallback)
├── components/
│   ├── BlockEstimator.tsx      # Main UI component
│   └── Providers.tsx           # Session provider wrapper
└── lib/
    ├── auth.ts                 # Auth.js config
    ├── api-auth.ts             # API auth helper
    ├── block-estimator.ts      # Multi-source block estimation engine
    ├── calendar.ts             # Calendar link generation
    ├── networks.ts             # XRPL EVM network configs & RPC URLs
    ├── prisma.ts               # Prisma client singleton
    └── slack.ts                # Slack notification formatting

cron/
└── notify.ts                   # Standalone cron worker (direct DB access)

prisma/
├── schema.prisma               # Database schema
└── migrations/                 # Migration history
```

## License

MIT
