# Guess the Score

A football match score prediction game built with Node.js, Express, and EJS.

## Features

- **User authentication** — register and login with session-based auth
- **Leagues** — create a league, share its invite code, and join any league by code
- **Score predictions** — predict match scores before kickoff
- **Points system** — earn points based on match phase and prediction accuracy
- **Live rankings** — see how players rank by total points within each league
- **League management** — league owners add matches, enter results, and delete games

### Scoring

| Phase | Exact Score | Correct Outcome |
|-------|-------------|----------------|
| Group stage | 10 pts | 5 pts |
| Round of 16 | 20 pts | 10 pts |
| Quarter-final | 40 pts | 20 pts |
| Semi-final | 80 pts | 40 pts |
| Third place | 30 pts | 15 pts |
| Final | 150 pts | 75 pts |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or newer)

### Setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Create a `.env` file from the template:

```bash
cp .env.example .env
```

3. Generate a strong random secret for `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and paste it into your `.env` file.

### Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000).

For development with auto-restart on file changes:

```bash
npm run dev
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_SECRET` | Yes | — | Secret key for signing session cookies (generate a random hex string) |
| `PORT` | No | `3000` | Port the server listens on |
| `NODE_ENV` | No | `development` | Set to `production` for production mode |
| `SSL_CERT_PATH` | No | — | Path to an SSL certificate. When set along with `SSL_KEY_PATH`, the app serves HTTPS directly |
| `SSL_KEY_PATH` | No | — | Path to the SSL private key |
| `HTTP_REDIRECT_PORT` | No | — | When HTTPS is enabled, redirect HTTP traffic to HTTPS on this port (e.g. `80`) |
| `PUBLIC_HTTPS_HOST` | No | request Host | Public hostname used by the HTTP→HTTPS redirect (set when behind a proxy/domain) |
| `PUBLIC_HTTPS_PORT` | No | HTTPS `PORT` | Public HTTPS port used by the HTTP→HTTPS redirect (defaults to `443`, so omitted) |
| `TRUST_PROXY` | No | — | Number of reverse proxy hops to trust (e.g. `1` behind nginx). Enables correct `req.secure` / client IPs |
| `DB_BACKUP_INTERVAL_MINUTES` | No | `60` | How often `data.db` is snapshotted into `backups/` (set `0` to disable) |
| `DB_BACKUP_KEEP` | No | `24` | How many backup files to keep; oldest are pruned |
| `ADSENSE_CLIENT` | No | — | Google AdSense publisher ID (`ca-pub-...`). When set, ad units and the GDPR cookie-consent banner are enabled and the CSP is relaxed for AdSense domains |
| `ADSENSE_AD_SLOT` | No | — | Google AdSense ad-unit slot ID for the in-content ad units |

### Advertising & cookie consent

When `ADSENSE_CLIENT` is set, the app shows responsive in-content ad units on the games, league, and rankings pages, and a GDPR cookie-consent banner (Accept/Decline) on every page for EEA visitors. Consent is stored in a `gs_consent` cookie; ads load only after the user accepts, and decline keeps the site ad-free. A verification `<meta name="google-adsense-account">` tag is added to all pages. Without `ADSENSE_CLIENT`, no ad code, banner, or CSP changes are applied.

### Backups

The app snapshots `data.db` into `backups/data-<timestamp>.db` every hour (configurable via `DB_BACKUP_INTERVAL_MINUTES`), including one shortly after startup. Old backups are pruned to the newest `DB_BACKUP_KEEP` (default 24). The `backups/` directory is gitignored — copy it (or use your own cron job) to durable storage.

### HTTPS

Two supported deployment options:

**Option A — Reverse proxy (recommended for production).** Run nginx, Caddy, or Cloudflare in front of the app and let it terminate TLS. The app stays on plain HTTP internally:

```nginx
# nginx example
server {
    listen 80;
    server_name example.com;
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    server_name example.com;
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `TRUST_PROXY=1` in `.env` so the app trusts the forwarded `X-Forwarded-Proto` header and marks session cookies as `Secure`.

**Option B — Direct HTTPS.** Point the app at your certificate and key, and optionally redirect HTTP to HTTPS:

```bash
SSL_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem \
SSL_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem \
HTTP_REDIRECT_PORT=80 \
npm start
```

For local testing, generate a self-signed cert with:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost"
```

### Default Admin (Development Only)

The old global admin panel was removed. There is no global admin user or role — every league is managed by its owner. A default `admin` user is **no longer seeded** on startup.

## Security

- **Secrets** — the session secret comes from `SESSION_SECRET` in the environment (never hard-coded).
- **HTTPS** — session cookies are marked `Secure` automatically when the request arrives over HTTPS (`secure: 'auto'`), including through a trusted reverse proxy.
- **CSRF** — all mutating routes require a per-session CSRF token (`_csrf` hidden field), included on every form. Logout is a `POST` to prevent logout-CSRF.
- **Rate limiting** — `/login` and `/register` are limited to 20 attempts per 15 minutes per IP.
- **Password policy** — passwords must be at least 8 characters and include uppercase, lowercase, and a number.
- **Security headers** — set by `helmet` (CSP, HSTS, X-Frame-Options, etc.); the `X-Powered-By` header is disabled.
- **Sessions** — `httpOnly`, `SameSite=Lax` cookies; the session secret is configurable per deployment.

## Usage

1. **Create or join a league** — on the home page (`/leagues`), create a league or join one with an invite code. Each league has its own games, members, and rankings.
2. **League owner** — add matches from the league's **Manage** page. After each match, enter the final score to automatically calculate points for all predictions. Owners can also delete games and delete the league.
3. **Players** — join leagues by invite code, then submit score predictions before kickoff. You can belong to multiple leagues, and each league is scored independently.
4. **Rankings** — each league has its own leaderboard at `/leagues/<id>/rankings`, limited to its members.

## Tech Stack

- **Backend:** Node.js, Express
- **Templating:** EJS
- **Auth:** express-session, bcryptjs
- **Database:** SQLite (via `sql.js`) — stored in `data.db`
