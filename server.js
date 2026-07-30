require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.role !== 'admin') return res.redirect('/');
  next();
}

app.use((req, res, next) => {
  res.locals.user = null;
  if (req.session.userId) {
    const user = db.getUserById(req.session.userId);
    res.locals.user = user;
  }
  res.locals.path = req.path;
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

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.getUserByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Invalid username or password' });
  }
  req.session.userId = user.id;
  req.session.role = user.role;
  res.redirect('/');
});

app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { error: null });
});

app.post('/register', (req, res) => {
  const { username, password, confirmPassword } = req.body;
  if (!username || !password) {
    return res.render('register', { error: 'All fields are required' });
  }
  if (password !== confirmPassword) {
    return res.render('register', { error: 'Passwords do not match' });
  }
  if (password.length < 4) {
    return res.render('register', { error: 'Password must be at least 4 characters' });
  }

  const existing = db.getUserByUsername(username);
  if (existing) {
    return res.render('register', { error: 'Username already taken' });
  }

  const hash = bcrypt.hashSync(password, 10);
  db.createUser(username, hash, 'player');
  res.redirect('/login');
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
  const now = new Date();
  const games = db.getGames();

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

app.post('/predict/:gameId', requireAuth, (req, res) => {
  const gameId = req.params.gameId;
  const { home_score, away_score } = req.body;

  const game = db.getGame(gameId);
  if (!game) return res.status(404).send('Game not found');
  if (game.status === 'finished') return res.status(400).send('Game already finished');

  const gameStart = new Date(game.start_time);
  const now = new Date();
  if (now >= gameStart) return res.status(400).send('Game already started');

  const home = parseInt(home_score);
  const away = parseInt(away_score);
  if (isNaN(home) || isNaN(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return res.status(400).send('Invalid scores');
  }

  db.upsertPrediction(gameId, req.session.userId, home, away);
  res.redirect('/');
});

app.get('/admin', requireAuth, requireAdmin, (req, res) => {
  const games = db.getGames().sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
  res.render('admin', { games, phasePoints: PHASE_POINTS, error: null });
});

app.post('/admin/game', requireAuth, requireAdmin, (req, res) => {
  const { phase, home_team, away_team, start_time } = req.body;

  const errors = [];
  if (!phase) errors.push('Phase is required');
  if (!home_team) errors.push('Home team is required');
  if (!away_team) errors.push('Away team is required');
  if (!start_time) errors.push('Start time is required');

  if (errors.length > 0) {
    const games = db.getGames().sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    return res.render('admin', { games, phasePoints: PHASE_POINTS, error: errors.join(', ') });
  }

  db.createGame(phase, home_team, away_team, start_time);
  res.redirect('/admin');
});

app.post('/admin/game/:gameId/result', requireAuth, requireAdmin, (req, res) => {
  const gameId = req.params.gameId;
  const { home_score, away_score } = req.body;

  const home = parseInt(home_score);
  const away = parseInt(away_score);
  if (isNaN(home) || isNaN(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return res.status(400).send('Invalid scores');
  }

  const game = db.getGame(gameId);
  if (!game) return res.status(404).send('Game not found');

  db.updateGameResult(gameId, home, away);

  const predictions = db.getGamePredictions(gameId);
  for (const pred of predictions) {
    const points = calculatePoints(pred.home_score, pred.away_score, home, away, game.phase);
    db.updatePredictionPoints(pred.id, points);
  }

  res.redirect('/admin');
});

app.post('/admin/game/:gameId/delete', requireAuth, requireAdmin, (req, res) => {
  db.deleteGame(req.params.gameId);
  res.redirect('/admin');
});

app.get('/rankings', requireAuth, (req, res) => {
  const rankings = db.getRankings();
  res.render('rankings', { rankings });
});

db.ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
