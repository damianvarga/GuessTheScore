# Guess the Score

A football match score prediction game built with Node.js, Express, and EJS.

## Features

- **User authentication** — register and login with session-based auth
- **Score predictions** — predict match scores before kickoff
- **Points system** — earn points based on match phase and prediction accuracy
- **Live rankings** — see how players rank by total points
- **Admin panel** — create matches, enter results, delete games

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

### Default Admin (Development Only)

When `NODE_ENV` is **not** set to `production`, a default admin is auto-created:

- Username: `admin`
- Password: `admin123`

**Do not use these credentials in production.** In production, register a user and manually promote them to admin, or remove the dev seeding logic from `db.js`.

## Usage

1. **Admin** — create matches in the admin panel (`/admin`). After each match, enter the final score to automatically calculate points for all predictions.
2. **Players** — register an account, browse upcoming matches, and submit score predictions before kickoff.
3. **Rankings** — view the leaderboard at `/rankings`.

## Tech Stack

- **Backend:** Node.js, Express
- **Templating:** EJS
- **Auth:** express-session, bcryptjs
- **Database:** SQLite (via `sql.js`) — stored in `data.db`
