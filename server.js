require('dotenv').config();

if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('SESSION_SECRET must be set to a random string of at least 32 characters in production.');
  process.exit(1);
}

const express = require('express');
const session = require('express-session');
const https = require('https');
const http = require('http');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csrf = require('csrf');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const HTTPS_ENABLED = !!(SSL_CERT_PATH && SSL_KEY_PATH);
const HTTP_REDIRECT_PORT = HTTPS_ENABLED ? (process.env.HTTP_REDIRECT_PORT || '') : '';

app.disable('x-powered-by');

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  fontSrc: ["'self'", 'https:', 'data:'],
  formAction: ["'self'"],
  frameAncestors: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
  upgradeInsecureRequests: []
};

if (process.env.ADSENSE_CLIENT) {
  cspDirectives.scriptSrc.push('https://pagead2.googlesyndication.com');
  cspDirectives.frameSrc = ["'self'", 'https://googleads.g.doubleclick.net', 'https://tpc.googlesyndication.com'];
  cspDirectives.imgSrc.push('https://*.google.com', 'https://*.gstatic.com', 'https://*.googlesyndication.com', 'https://*.ggpht.com');
  cspDirectives.connectSrc = ["'self'", 'https://pagead2.googlesyndication.com'];
}

app.use(helmet({
  contentSecurityPolicy: { directives: cspDirectives }
}));

if (process.env.TRUST_PROXY) {
  app.set('trust proxy', parseInt(process.env.TRUST_PROXY, 10) || 1);
}

const PHASE_POINTS = {
  'group': 10,
  'round_of_16': 20,
  'quarter': 40,
  'semi': 80,
  'final': 150,
  'third_place': 30
};

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-do-not-use-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: 'auto',
    sameSite: 'lax'
  }
}));

const tokens = new csrf();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts. Please try again later.'
});

app.use((req, res, next) => {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = tokens.secretSync();
  }
  res.locals.csrfToken = tokens.create(req.session.csrfSecret);
  next();
});

function verifyCsrf(req, res, next) {
  const token = req.body._csrf || req.get('X-CSRF-Token');
  if (!token || !tokens.verify(req.session.csrfSecret, token)) {
    return res.status(403).send('Invalid CSRF token');
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function loadLeague(req, res, next) {
  const league = db.getLeagueById(req.params.leagueId);
  if (!league) return res.status(404).send('League not found');
  res.locals.league = league;
  req.league = league;
  next();
}

function requireLeagueMember(req, res, next) {
  if (!db.isLeagueMember(req.session.userId, req.params.leagueId)) {
    return res.redirect('/leagues');
  }
  next();
}

function requireLeagueOwner(req, res, next) {
  if (!db.isLeagueOwner(req.session.userId, req.params.leagueId)) {
    return res.status(403).send('Only the league owner can do that');
  }
  next();
}

app.use((req, res, next) => {
  res.locals.user = null;
  if (req.session.userId) {
    const user = db.getUserById(req.session.userId);
    res.locals.user = user;
  }
  res.locals.path = req.path;
  res.locals.adsense = process.env.ADSENSE_CLIENT ? {
    client: process.env.ADSENSE_CLIENT,
    slot: process.env.ADSENSE_AD_SLOT || ''
  } : null;
  next();
});

function calculatePoints(homeScore, awayScore, actualHome, actualAway, phase) {
  const basePoints = PHASE_POINTS[phase] || 5;
  if (actualHome === null || actualAway === null) return null;

  const exactScore = homeScore === actualHome && awayScore === actualAway;
  const homeDiff = homeScore - awayScore;
  const actualDiff = actualHome - actualAway;
  const correctOutcome = (homeDiff > 0 && actualDiff > 0) ||
    (homeDiff < 0 && actualDiff < 0) ||
    (homeDiff === 0 && actualDiff === 0);

  if (exactScore) return basePoints;
  if (correctOutcome) return Math.floor(basePoints / 2);
  return 0;
}

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

app.post('/login', authLimiter, verifyCsrf, (req, res, next) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid username or password' });
  }
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.role = user.role;
    res.redirect('/leagues');
  });
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

app.post('/register', authLimiter, verifyCsrf, (req, res) => {
  const username = (req.body.username || '').trim();
  const { password, confirmPassword } = req.body;
  if (!username || !password) {
    return res.render('register', { error: 'All fields are required' });
  }
  if (username.length < 3 || username.length > 30) {
    return res.render('register', { error: 'Username must be between 3 and 30 characters' });
  }
  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match' });
  }
  if (password.length < 8) {
    return res.render('register', { error: 'Password must be at least 8 characters' });
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return res.render('register', { error: 'Password must include uppercase, lowercase, and a number' });
  }

  const existing = db.getUserByUsername(username);
  if (existing) {
    return res.render('register', { error: 'Username already taken' });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.createUser(username, hash, 'player');
  res.redirect('/login');
});
app.post('/logout', verifyCsrf, (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
  res.redirect('/leagues');
});

app.get('/privacy', (req, res) => {
  res.render('privacy');
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/leagues', requireAuth, (req, res) => {
  const leagues = db.getLeaguesForUser(req.session.userId);
  res.render('leagues', { leagues, error: null });
});

app.post('/leagues', requireAuth, verifyCsrf, (req, res) => {
  const name = (req.body.name || '').trim();
  const leagues = db.getLeaguesForUser(req.session.userId);
  if (!name) {
    return res.render('leagues', { leagues, error: 'League name is required' });
  }
  if (name.length > 60) {
    return res.render('leagues', { leagues, error: 'League name must be 60 characters or fewer' });
  }
  const league = db.createLeague(req.session.userId, name);
  res.redirect(`/leagues/${league.id}`);
});

app.post('/leagues/join', requireAuth, verifyCsrf, (req, res) => {
  const { code } = req.body;
  const leagues = db.getLeaguesForUser(req.session.userId);
  const league = db.getLeagueByCode(code);
  if (!league) {
    return res.render('leagues', { leagues, error: 'League not found. Check the code and try again.' });
  }
  if (!db.joinLeague(req.session.userId, league.id)) {
    return res.render('leagues', { leagues, error: `You are already a member of ${league.name}` });
  }
  res.redirect(`/leagues/${league.id}`);
});

app.get('/leagues/:leagueId', requireAuth, loadLeague, requireLeagueMember, (req, res) => {
  const members = db.getLeagueMembers(req.params.leagueId);
  const isOwner = db.isLeagueOwner(req.session.userId, req.params.leagueId);
  res.render('league', { members, isOwner });
});

app.post('/leagues/:leagueId/leave', requireAuth, loadLeague, requireLeagueMember, verifyCsrf, (req, res) => {
  if (db.isLeagueOwner(req.session.userId, req.params.leagueId)) {
    return res.status(400).send('The owner cannot leave. Delete the league instead.');
  }
  db.leaveLeague(req.session.userId, req.params.leagueId);
  res.redirect('/leagues');
});

app.post('/leagues/:leagueId/delete', requireAuth, loadLeague, requireLeagueOwner, verifyCsrf, (req, res) => {
  db.deleteLeague(req.params.leagueId);
  res.redirect('/leagues');
});

app.get('/leagues/:leagueId/admin', requireAuth, loadLeague, requireLeagueOwner, (req, res) => {
  const games = db.getLeagueGames(req.params.leagueId).sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
  res.render('admin', { games, phasePoints: PHASE_POINTS, error: null });
});

app.post('/leagues/:leagueId/games', requireAuth, loadLeague, requireLeagueOwner, verifyCsrf, (req, res) => {
  const phase = (req.body.phase || '').trim();
  const home_team = (req.body.home_team || '').trim();
  const away_team = (req.body.away_team || '').trim();
  const start_time = (req.body.start_time || '').trim();

  const errors = [];
  if (!phase) errors.push('Phase is required');
  if (!Object.prototype.hasOwnProperty.call(PHASE_POINTS, phase)) errors.push('Invalid phase');
  if (!home_team) errors.push('Home team is required');
  else if (home_team.length > 40) errors.push('Home team must be 40 characters or fewer');
  if (!away_team) errors.push('Away team is required');
  else if (away_team.length > 40) errors.push('Away team must be 40 characters or fewer');
  if (!start_time) errors.push('Start time is required');
  else if (Number.isNaN(new Date(start_time).getTime())) errors.push('Start time must be a valid date');

  if (errors.length > 0) {
    const games = db.getLeagueGames(req.params.leagueId).sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    return res.render('admin', { games, phasePoints: PHASE_POINTS, error: errors.join(', ') });
  }

  db.createGame(req.params.leagueId, phase, home_team, away_team, start_time);
  res.redirect(`/leagues/${req.params.leagueId}/admin`);
});

app.get('/leagues/:leagueId/games', requireAuth, loadLeague, requireLeagueMember, (req, res) => {
  const now = new Date();
  const games = db.getLeagueGames(req.params.leagueId);

  const upcoming = [];
  const started = [];

  for (const game of games) {
    const gameStart = new Date(game.start_time);
    const isStarted = gameStart <= now || game.status === 'finished';

    const myPrediction = db.getPrediction(game.id, req.session.userId);
    let allPredictions = [];
    if (isStarted) {
      allPredictions = db.getGamePredictions(game.id);
    }

    const gameData = { ...game, myPrediction, allPredictions };

    if (isStarted) {
      started.push(gameData);
    } else {
      upcoming.push(gameData);
    }
  }

  upcoming.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  started.sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

  res.render('dashboard', { upcoming, started, phasePoints: PHASE_POINTS });
});

app.post('/leagues/:leagueId/games/:gameId/result', requireAuth, loadLeague, requireLeagueOwner, verifyCsrf, (req, res) => {
  const { gameId } = req.params;
  const { home_score, away_score } = req.body;

  if (!/^\d{1,5}$/.test(String(home_score)) || !/^\d{1,5}$/.test(String(away_score))) {
    return res.status(400).send('Invalid scores');
  }
  const home = parseInt(home_score);
  const away = parseInt(away_score);

  const game = db.getGame(gameId);
  if (!game || game.league_id !== parseInt(req.params.leagueId)) return res.status(404).send('Game not found');

  db.updateGameResult(gameId, home, away);

  const predictions = db.getGamePredictions(gameId);
  for (const pred of predictions) {
    const points = calculatePoints(pred.home_score, pred.away_score, home, away, game.phase);
    db.updatePredictionPoints(pred.id, points);
  }

  res.redirect(`/leagues/${req.params.leagueId}/admin`);
});

app.post('/leagues/:leagueId/games/:gameId/delete', requireAuth, loadLeague, requireLeagueOwner, verifyCsrf, (req, res) => {
  const { gameId } = req.params;
  const game = db.getGame(gameId);
  if (!game || game.league_id !== parseInt(req.params.leagueId)) return res.status(404).send('Game not found');
  db.deleteGame(gameId);
  res.redirect(`/leagues/${req.params.leagueId}/admin`);
});

app.post('/leagues/:leagueId/games/:gameId/predict', requireAuth, loadLeague, requireLeagueMember, verifyCsrf, (req, res) => {
  const { gameId } = req.params;
  const { home_score, away_score } = req.body;

  const game = db.getGame(gameId);
  if (!game || game.league_id !== parseInt(req.params.leagueId)) return res.status(404).send('Game not found');
  if (game.status === 'finished') return res.status(400).send('Game already finished');

  const gameStart = new Date(game.start_time);
  const now = new Date();
  if (now >= gameStart) return res.status(400).send('Game already started');

  if (!/^\d{1,5}$/.test(String(home_score)) || !/^\d{1,5}$/.test(String(away_score))) {
    return res.status(400).send('Invalid scores');
  }
  const home = parseInt(home_score);
  const away = parseInt(away_score);

  db.upsertPrediction(gameId, req.session.userId, home, away);
  res.redirect(`/leagues/${req.params.leagueId}/games`);
});

app.get('/leagues/:leagueId/rankings', requireAuth, loadLeague, requireLeagueMember, (req, res) => {
  const rankings = db.getLeagueRankings(req.params.leagueId);
  res.render('rankings', { rankings });
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('Internal server error');
});

db.ready.then(() => {
  if (HTTPS_ENABLED) {
    const sslOptions = {
      cert: fs.readFileSync(SSL_CERT_PATH),
      key: fs.readFileSync(SSL_KEY_PATH)
    };
    https.createServer(sslOptions, app).listen(PORT, () => {
      console.log(`Server running at https://localhost:${PORT}`);
    });
    if (HTTP_REDIRECT_PORT) {
      http.createServer((req, res) => {
        const publicHost = process.env.PUBLIC_HTTPS_HOST || (req.headers.host || 'localhost').split(':')[0];
        const httpsPort = process.env.PUBLIC_HTTPS_PORT || String(PORT);
        const portSuffix = (httpsPort === '443' || httpsPort === '') ? '' : `:${httpsPort}`;
        res.writeHead(301, { Location: `https://${publicHost}${portSuffix}${req.url}` });
        res.end();
      }).listen(parseInt(HTTP_REDIRECT_PORT, 10), () => {
        console.log(`HTTP to HTTPS redirect running on port ${HTTP_REDIRECT_PORT}`);
      });
    }
  } else {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  }
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
