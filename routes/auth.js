const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    isAdmin: Boolean(user.is_admin),
    hasActiveAccess: Boolean(user.has_active_access),
    isSuspended: Boolean(user.is_suspended),
    creditsBalance: user.credits_balance,
    secondsBalance: user.seconds_balance,
  };
}

router.post('/register', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const email = (req.body.email || '').trim();
    const password = req.body.password || '';

    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: 'That username is already taken.' });

    const hash = bcrypt.hashSync(password, 12);
    const result = await db.run(
      `INSERT INTO users (username, email, password_hash, has_active_access, credits_balance, seconds_balance)
       VALUES (?, ?, ?, 0, 0, 0) RETURNING id`,
      [username, email, hash]
    );

    req.session.userId = result.id;
    const user = await db.get('SELECT * FROM users WHERE id = ?', [result.id]);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const password = req.body.password || '';

    const user = await db.get('SELECT * FROM users WHERE username = ? AND is_deleted = 0', [username]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    if (user.is_suspended) {
      return res.status(403).json({ error: 'This account has been suspended. Contact support.' });
    }

    req.session.userId = user.id;
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/session', (req, res) => {
  res.json({ loggedIn: Boolean(req.user), user: publicUser(req.user) });
});

module.exports = router;
