const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy your Neon connection string into .env as DATABASE_URL.');
}

const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Neon (and most managed Postgres) require SSL. Local/self-hosted
  // Postgres during development usually doesn't have it configured, so
  // we skip it automatically when the host is localhost.
  ssl: isLocalDb ? false : { require: true },
});

pool.on('error', (err) => {
  console.error('[db] Unexpected Postgres pool error:', err);
});

/** Converts `?` placeholders (used throughout the route files) into Postgres's $1, $2... */
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return res.rows;
}

async function get(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return res.rows[0] || null;
}

/**
 * Runs an INSERT/UPDATE/DELETE. For inserts where the caller needs the new
 * row's id, append `RETURNING id` to the SQL — result.id will then be set.
 */
async function run(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return { changes: res.rowCount, id: res.rows[0]?.id };
}

// ---------------------------------------------------------------------------
// Schema (idempotent — safe to run on every boot)
// ---------------------------------------------------------------------------
// See README "Credit & Usage Model" for why credits_balance and
// seconds_balance are tracked as two separate, always-together-updated
// numbers, and why platform_settings.credits_per_minute is the single
// global conversion rate used everywhere.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_suspended INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  has_active_access INTEGER NOT NULL DEFAULT 0,
  credits_balance INTEGER NOT NULL DEFAULT 0,
  seconds_balance INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS credit_plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  credits INTEGER NOT NULL,
  minutes NUMERIC NOT NULL,
  description TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id SERIAL PRIMARY KEY,
  method_type TEXT NOT NULL CHECK(method_type IN ('bank','crypto')),
  label TEXT DEFAULT '',
  bank_name TEXT DEFAULT '',
  account_name TEXT DEFAULT '',
  account_number TEXT DEFAULT '',
  routing_swift TEXT DEFAULT '',
  crypto_currency TEXT DEFAULT '',
  wallet_address TEXT DEFAULT '',
  network_note TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_submissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES credit_plans(id) ON DELETE SET NULL,
  method_id INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL,
  amount NUMERIC NOT NULL,
  receipt_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  admin_note TEXT DEFAULT '',
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  decart_api_key_override TEXT DEFAULT '',
  support_telegram_username TEXT DEFAULT '',
  credits_per_minute NUMERIC NOT NULL DEFAULT 50,
  site_name TEXT NOT NULL DEFAULT 'Creoveya'
);

CREATE TABLE IF NOT EXISTS looks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT DEFAULT '',
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stream_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'live' CHECK(status IN ('live','ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  seconds_used INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  end_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

async function initDb() {
  await pool.query(SCHEMA_SQL);

  const settingsRow = await get('SELECT * FROM platform_settings WHERE id = 1');
  if (!settingsRow) {
    await run(`INSERT INTO platform_settings (id, decart_api_key_override, support_telegram_username, credits_per_minute, site_name)
                VALUES (1, '', '', 50, 'Creoveya')`);
  }

  const planCount = (await get('SELECT COUNT(*) AS c FROM credit_plans')).c;
  if (Number(planCount) === 0) {
    await run(`INSERT INTO credit_plans (name, price, credits, minutes, description, is_active, sort_order)
                VALUES (?, ?, ?, ?, ?, 1, ?)`, ['Starter', 20, 300, 6, 'Great for trying out AI live transformation.', 1]);
    await run(`INSERT INTO credit_plans (name, price, credits, minutes, description, is_active, sort_order)
                VALUES (?, ?, ?, ?, ?, 1, ?)`, ['Creator', 75, 5000, 25, 'For regular streamers who need more runtime.', 2]);
  }

  const adminCount = (await get('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1')).c;
  if (Number(adminCount) === 0) {
    const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
    const password = process.env.INITIAL_ADMIN_PASSWORD || 'change-this-immediately';
    const hash = bcrypt.hashSync(password, 12);
    await run(`INSERT INTO users (username, email, password_hash, is_admin, has_active_access, credits_balance, seconds_balance)
                VALUES (?, '', ?, 1, 1, 0, 0)`, [username, hash]);
    console.log(`[seed] Created initial admin user "${username}". Log in and change this password immediately.`);
  }
}

module.exports = { pool, get, all, run, initDb };
