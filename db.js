const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.db');
const BACKUP_DIR = path.join(__dirname, 'backups');

const LEAGUE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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

function generateUniqueCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += LEAGUE_CODE_CHARS[crypto.randomInt(LEAGUE_CODE_CHARS.length)];
    }
  } while (one('SELECT id FROM leagues WHERE code = ?', [code]));
  return code;
}

const ready = initSqlJs().then(SQL => {
  if (fs.existsSync(DB_PATH + '.tmp')) {
    fs.unlinkSync(DB_PATH + '.tmp');
  }
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
      CREATE TABLE leagues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        code TEXT NOT NULL UNIQUE,
        owner_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE TABLE league_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        league_id INTEGER NOT NULL REFERENCES leagues(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        joined_at TEXT NOT NULL,
        UNIQUE(league_id, user_id)
      );
      CREATE TABLE games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        league_id INTEGER NOT NULL REFERENCES leagues(id),
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

  // Migrate existing databases: ensure league tables exist and games has league_id
  exec(`
    CREATE TABLE IF NOT EXISTS leagues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT NOT NULL UNIQUE,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS league_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      league_id INTEGER NOT NULL REFERENCES leagues(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      joined_at TEXT NOT NULL,
      UNIQUE(league_id, user_id)
    );
  `);
  const gameColumns = all('PRAGMA table_info(games)');
  if (!gameColumns.some(c => c.name === 'league_id')) {
    exec('ALTER TABLE games ADD COLUMN league_id INTEGER');
  }
}).then(() => {
  startBackupInterval();
});

function save() {
  const data = db.export();
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, Buffer.from(data));
  fs.renameSync(tmpPath, DB_PATH);
}

function createBackup() {
  if (!fs.existsSync(DB_PATH)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').slice(0, 19);
  const tmpPath = path.join(BACKUP_DIR, `data-${stamp}.db.tmp`);
  const backupPath = path.join(BACKUP_DIR, `data-${stamp}.db`);
  fs.copyFileSync(DB_PATH, tmpPath);
  fs.renameSync(tmpPath, backupPath);
  pruneBackups();
  return backupPath;
}

function pruneBackups() {
  const keep = parseInt(process.env.DB_BACKUP_KEEP, 10) || 24;
  let files;
  try {
    files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db'));
  } catch (e) {
    return;
  }
  files.sort().reverse();
  for (const f of files.slice(keep)) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
}

function startBackupInterval() {
  const minutes = parseInt(process.env.DB_BACKUP_INTERVAL_MINUTES, 10);
  const intervalMin = Number.isNaN(minutes) ? 60 : minutes;
  if (intervalMin <= 0) return;
  setTimeout(() => {
    try {
      createBackup();
    } catch (err) {
      console.error('Backup failed:', err);
    }
  }, 5000);
  setInterval(() => {
    try {
      createBackup();
    } catch (err) {
      console.error('Backup failed:', err);
    }
  }, intervalMin * 60 * 1000);
}

const dbInterface = {
  ready,
  createBackup,

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
    return { id, username, role: role || 'player', created_at: createdAt };
  },

  getAllUsers() {
    return all('SELECT * FROM users');
  },

  createLeague(ownerId, name) {
    const code = generateUniqueCode();
    const createdAt = new Date().toISOString();
    run('INSERT INTO leagues (name, code, owner_id, created_at) VALUES (?, ?, ?, ?)', [name, code, parseInt(ownerId), createdAt]);
    const id = one('SELECT last_insert_rowid() as id').id;
    run('INSERT INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)', [id, parseInt(ownerId), createdAt]);
    save();
    return { id, name, code, owner_id: parseInt(ownerId), created_at: createdAt };
  },

  getLeagueById(id) {
    return one('SELECT * FROM leagues WHERE id = ?', [parseInt(id)]);
  },

  getLeagueByCode(code) {
    return one('SELECT * FROM leagues WHERE code = ?', [String(code || '').trim().toUpperCase()]);
  },

  getLeaguesForUser(userId) {
    return all(`
      SELECT l.*,
        (SELECT COUNT(*) FROM league_members lm2 WHERE lm2.league_id = l.id) as member_count,
        u.username as owner_name
      FROM league_members lm
      JOIN leagues l ON l.id = lm.league_id
      JOIN users u ON u.id = l.owner_id
      WHERE lm.user_id = ?
      ORDER BY l.created_at DESC
    `, [parseInt(userId)]);
  },

  getLeagueMembers(leagueId) {
    return all(`
      SELECT u.id, u.username, lm.joined_at
      FROM league_members lm
      JOIN users u ON u.id = lm.user_id
      WHERE lm.league_id = ?
      ORDER BY lm.joined_at ASC
    `, [parseInt(leagueId)]);
  },

  isLeagueMember(userId, leagueId) {
    return !!one('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?', [parseInt(leagueId), parseInt(userId)]);
  },

  isLeagueOwner(userId, leagueId) {
    const league = one('SELECT owner_id FROM leagues WHERE id = ?', [parseInt(leagueId)]);
    return !!league && league.owner_id === parseInt(userId);
  },

  joinLeague(userId, leagueId) {
    const exists = one('SELECT id FROM league_members WHERE league_id = ? AND user_id = ?', [parseInt(leagueId), parseInt(userId)]);
    if (exists) return false;
    run('INSERT INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)', [parseInt(leagueId), parseInt(userId), new Date().toISOString()]);
    save();
    return true;
  },

  leaveLeague(userId, leagueId) {
    run('DELETE FROM league_members WHERE league_id = ? AND user_id = ?', [parseInt(leagueId), parseInt(userId)]);
    save();
  },

  deleteLeague(leagueId) {
    const gameIds = all('SELECT id FROM games WHERE league_id = ?', [parseInt(leagueId)]).map(g => g.id);
    for (const gid of gameIds) {
      run('DELETE FROM predictions WHERE game_id = ?', [gid]);
    }
    run('DELETE FROM games WHERE league_id = ?', [parseInt(leagueId)]);
    run('DELETE FROM league_members WHERE league_id = ?', [parseInt(leagueId)]);
    run('DELETE FROM leagues WHERE id = ?', [parseInt(leagueId)]);
    save();
  },

  getLeagueGames(leagueId) {
    return all('SELECT * FROM games WHERE league_id = ?', [parseInt(leagueId)]);
  },

  getGame(id) {
    return one('SELECT * FROM games WHERE id = ?', [parseInt(id)]);
  },

  createGame(leagueId, phase, homeTeam, awayTeam, startTime) {
    const createdAt = new Date().toISOString();
    run('INSERT INTO games (league_id, phase, home_team, away_team, start_time, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [parseInt(leagueId), phase, homeTeam, awayTeam, startTime, 'scheduled', createdAt]);
    const id = one('SELECT last_insert_rowid() as id').id;
    save();
    return { id, league_id: parseInt(leagueId), phase, home_team: homeTeam, away_team: awayTeam, start_time: startTime, home_score: null, away_score: null, status: 'scheduled', created_at: createdAt };
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

  getLeagueRankings(leagueId) {
    const rows = all(`
      SELECT
        u.id, u.username,
        COALESCE(SUM(p.points), 0) as total_points,
        COUNT(CASE WHEN p.points IS NOT NULL THEN 1 END) as predictions_scored,
        COUNT(p.id) as total_predictions
      FROM league_members lm
      JOIN users u ON u.id = lm.user_id
      LEFT JOIN predictions p ON p.user_id = lm.user_id
        AND p.game_id IN (SELECT id FROM games WHERE league_id = ?)
      WHERE lm.league_id = ?
      GROUP BY u.id
      ORDER BY total_points DESC, u.username ASC
    `, [parseInt(leagueId), parseInt(leagueId)]);
    return rows.map(r => ({
      ...r,
      total_points: Number(r.total_points),
      predictions_scored: Number(r.predictions_scored),
      total_predictions: Number(r.total_predictions)
    }));
  }
};

module.exports = dbInterface;
