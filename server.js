require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const db = require('./db'); // exposes .pool, used below for the session store too
const { loadUser, requireLogin, requireAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  // Sessions live in the same Neon database, in their own "session" table
  // (auto-created by connect-pg-simple on first run).
  store: new pgSession({ pool: db.pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
  },
}));

app.use(loadUser);

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/auth', require('./routes/auth'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/studio', require('./routes/studio'));
app.use('/api/admin', requireLogin, require('./routes/admin'));

// Current logged-in user's own profile/balance snapshot (used by the
// dashboard header, profile menu, and usage widgets across the site).
app.get('/api/me', requireLogin, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.id,
      username: req.user.username,
      isAdmin: Boolean(req.user.is_admin),
      hasActiveAccess: Boolean(req.user.has_active_access),
      isSuspended: Boolean(req.user.is_suspended),
      creditsBalance: req.user.credits_balance,
      secondsBalance: req.user.seconds_balance,
    },
  });
});

// ---------------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

// Guard the dashboard/studio HTML shells themselves (the API underneath
// is independently protected too, but this stops a logged-out or
// unpaid visitor from even loading the page shell). HTML routes redirect
// rather than return JSON, since a browser navigation expects a page.
function pageGuard({ needsAccess } = {}) {
  return (req, res, next) => {
    if (!req.user) return res.redirect('/login.html');
    if (req.user.is_suspended) return res.redirect('/login.html?suspended=1');
    if (needsAccess && !req.user.is_admin && !req.user.has_active_access) return res.redirect('/payment');
    next();
  };
}

app.get(['/dashboard', '/dashboard/*'], pageGuard({ needsAccess: true }), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get(['/studio', '/studio/*'], pageGuard({ needsAccess: true }), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'studio.html'));
});
app.get(['/admin_dashboard', '/admin_dashboard/'], (req, res) => {
  if (!req.user) return res.redirect('/login.html');
  if (!req.user.is_admin) return res.status(403).sendFile(path.join(__dirname, 'public', '404.html'));
  res.sendFile(path.join(__dirname, 'admin_assets', 'index.html'));
});
app.get('/admin_dashboard/admin.js', (req, res) => {
  if (!req.user || !req.user.is_admin) return res.status(403).end();
  res.type('application/javascript').sendFile(path.join(__dirname, 'admin_assets', 'admin.js'));
});
app.get('/payment', pageGuard(), (req, res) => {
  if (req.user.has_active_access) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});
app.get('/payment-topup.html', pageGuard(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment-topup.html'));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

// Centralized error handler — any route that calls next(err) (e.g. a
// dropped Neon connection) lands here instead of crashing the process.
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong on our end. Please try again.' });
});

async function start() {
  await db.initDb();
  app.listen(PORT, () => {
    console.log(`Creoveya AI Live Studio running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
