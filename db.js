const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.db');

let db;

function all(sql, params) {
  const stmt = db.prepare(sql);
  if (params != null) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function one(sql, params) {
  const rows = all(sql, params);
  return rows[0] || null;
}

function run(sql, params) {
  const stmt = db.prepare(sql);
  if (params != null) stmt.bind(params);
  const result = stmt.step();
  stmt.free();
  return result;
}

function exec(sql) {
  db.exec(sql);
}

const ready = initSqlJs().then(SQL => {
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
    exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player',
        created_at TEXT NOT NULL
      );
      CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase TEXT NOT NULL,
        home_team TEXT NOT NULL,
        away_team TEXT NOT NULL,
        start_time TEXT NOT NULL,
        home_score INTEGER,
        away_score INTEGER,
        status TEXT NOT NULL DEFAULT 'scheduled',
        created_at TEXT NOT NULL
      );
      CREATE TABLE predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL REFERENCES games(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        home_score INTEGER NOT NULL,
        away_score INTEGER NOT NULL,
        points INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE(game_id, user_id)
      );
    `);
  }

  if (process.env.NODE_ENV !== 'production') {
    const admin = one('SELECT * FROM users WHERE username = ?', ['admin']);
    if (!admin) {
      const hash = bcrypt.hashSync('admin123', 10);
      run('INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)', ['admin', hash, 'admin', new Date().toISOString()]);
      save();
      console.log('Default admin user created (dev only)');
    }
  }
});

function save() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

const dbInterface = {
  ready,

  getUserByUsername(username) {
    return one('SELECT * FROM users WHERE username = ?', [username]);
  },

  getUserById(id) {
    return one('SELECT * FROM users WHERE id = ?', [id]);
  },

  createUser(username, password, role) {
    const createdAt = new Date().toISOString();
    run('INSERT INTO users (username, password, role, created_at) VALUES (?, ?, ?, ?)', [username, password, role || 'player', createdAt]);
    const id = one('SELECT last_insert_rowid() as id').id;
    save();
    return { id, username, password, role: role || 'player', created_at: createdAt };
  },

  getAllUsers() {
    return all('SELECT * FROM users');
  },

  getGames() {
    return all('SELECT * FROM games');
  },

  getGame(id) {
    return one('SELECT * FROM games WHERE id = ?', [parseInt(id)]);
  },

  createGame(phase, homeTeam, awayTeam, startTime) {
    const createdAt = new Date().toISOString();
    run('INSERT INTO games (phase, home_team, away_team, start_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', [phase, homeTeam, awayTeam, startTime, 'scheduled', createdAt]);
    const id = one('SELECT last_insert_rowid() as id').id;
    save();
    return { id, phase, home_team: homeTeam, away_team: awayTeam, start_time: startTime, home_score: null, away_score: null, status: 'scheduled', created_at: createdAt };
  },

  updateGameResult(id, homeScore, awayScore) {
    run('UPDATE games SET home_score = ?, away_score = ?, status = ? WHERE id = ?', [parseInt(homeScore), parseInt(awayScore), 'finished', parseInt(id)]);
    save();
    return one('SELECT * FROM games WHERE id = ?', [parseInt(id)]);
  },

  deleteGame(id) {
    run('DELETE FROM predictions WHERE game_id = ?', [parseInt(id)]);
    run('DELETE FROM games WHERE id = ?', [parseInt(id)]);
    save();
  },

  getPrediction(gameId, userId) {
    return one('SELECT * FROM predictions WHERE game_id = ? AND user_id = ?', [parseInt(gameId), parseInt(userId)]);
  },

  getGamePredictions(gameId) {
    return all('SELECT p.*, u.username FROM predictions p LEFT JOIN users u ON p.user_id = u.id WHERE p.game_id = ?', [parseInt(gameId)]);
  },

  upsertPrediction(gameId, userId, homeScore, awayScore) {
    const existing = one('SELECT * FROM predictions WHERE game_id = ? AND user_id = ?', [parseInt(gameId), parseInt(userId)]);
    if (existing) {
      run('UPDATE predictions SET home_score = ?, away_score = ?, points = ? WHERE id = ?', [parseInt(homeScore), parseInt(awayScore), null, existing.id]);
      save();
      return { ...existing, home_score: parseInt(homeScore), away_score: parseInt(awayScore), points: null };
    }
    const createdAt = new Date().toISOString();
    run('INSERT INTO predictions (game_id, user_id, home_score, away_score, created_at) VALUES (?, ?, ?, ?, ?)', [parseInt(gameId), parseInt(userId), parseInt(homeScore), parseInt(awayScore), createdAt]);
    const id = one('SELECT last_insert_rowid() as id').id;
    save();
    return { id, game_id: parseInt(gameId), user_id: parseInt(userId), home_score: parseInt(homeScore), away_score: parseInt(awayScore), points: null, created_at: createdAt };
  },

  updatePredictionPoints(id, points) {
    run('UPDATE predictions SET points = ? WHERE id = ?', [points, parseInt(id)]);
    save();
    return one('SELECT * FROM predictions WHERE id = ?', [parseInt(id)]);
  },

  getRankings() {
    const rows = all(`
      SELECT
        u.id, u.username,
        COALESCE(SUM(p.points), 0) as total_points,
        COUNT(CASE WHEN p.points IS NOT NULL THEN 1 END) as predictions_scored,
        COUNT(p.id) as total_predictions
      FROM users u
      LEFT JOIN predictions p ON u.id = p.user_id
      GROUP BY u.id
      ORDER BY total_points DESC, u.username ASC
    `);
    return rows.map(r => ({
      ...r,
      total_points: Number(r.total_points),
      predictions_scored: Number(r.predictions_scored),
      total_predictions: Number(r.total_predictions)
    }));
  }
};

module.exports = dbInterface;
