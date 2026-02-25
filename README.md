# Block ⇄ Time — XRPL EVM

Convert between block numbers and dates on **XRPL EVM Mainnet** and **Testnet**. Subscribe for Slack notifications as a target block approaches.

![XRPL EVM](public/XRPLEVM_FullWhiteLogo.png)

## Features

- **Block → Time** — Enter a future block number, get the estimated date/time it will be reached.
- **Time → Block** — Enter a future date/time, get the estimated block number.
- **Multi-source estimation** — Cross-references Ethereum JSON-RPC, Tendermint RPC, and Cosmos API for high-confidence results.
- **Slack notifications** — Subscribe to a block watch and receive updates at 1 day, 6 hours, 1 hour, 15 min, and 5 min before the estimated time.
- **Calendar export** — One-click add to Google Calendar, Outlook, or download an `.ics` file.
- **Google OAuth** — Sign in to manage subscriptions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) |
| Language | TypeScript |
| Database | PostgreSQL + [Prisma](https://prisma.io) |
| Auth | [Auth.js v5](https://authjs.dev) (Google OAuth) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Deployment | Docker / [Railway](https://railway.app) |

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
| `AUTH_SECRET` | Generate with `npx auth secret` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `CRON_SECRET` | Protects the `/api/cron/notify` endpoint |
| `NEXT_PUBLIC_BASE_URL` | Public URL of the app (e.g. `https://blocktotime.app`) |

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
| `GET` | `/api/watch/[id]` | Get block watch status |
| `GET` | `/api/calendar/[id]` | Download `.ics` calendar event |
| `POST` | `/api/cron/notify` | Process pending notifications (cron, protected by `CRON_SECRET`) |

`network` is one of `XRPL_EVM_MAINNET` or `XRPL_EVM_TESTNET`.

## Production Deployment

### Docker

```bash
docker build -t block-to-time .
docker run -p 3000:3000 --env-file .env block-to-time
```

The Dockerfile uses a multi-stage build with Next.js standalone output for a minimal image.

### Railway

The project includes a `railway.toml` and is ready to deploy:

1. Connect your GitHub repo in Railway.
2. Add a PostgreSQL plugin.
3. Set the environment variables from `.env.example`.
4. Deploy — migrations run automatically on container start.

### Cron

Set up a recurring job to `POST /api/cron/notify` with the `Authorization: Bearer <CRON_SECRET>` header. Recommended interval: every 1–2 minutes.

On Railway, use a [cron service](https://docs.railway.app/reference/cron-jobs) or an external scheduler like [cron-job.org](https://cron-job.org).

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout (fonts, providers)
│   ├── page.tsx                # Home page
│   ├── globals.css             # XRPL EVM theme (Tailwind v4)
│   └── api/
│       ├── auth/[...nextauth]/ # Auth.js route handler
│       ├── estimate/           # Block → Time API
│       ├── time-to-block/      # Time → Block API
│       ├── subscribe/          # Create block watch
│       ├── watch/[id]/         # Get watch status
│       ├── calendar/[id]/      # .ics download
│       └── cron/notify/        # Notification processor
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
```

## License

MIT
