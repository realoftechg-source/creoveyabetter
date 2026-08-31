const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

const RECEIPTS_DIR = path.join(__dirname, '..', 'uploads', 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, RECEIPTS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${req.user.id}_${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG, PNG, or WEBP receipts are allowed.'), ok);
  },
});

// Public: active plans shown on the payment page.
router.get('/plans', async (req, res, next) => {
  try {
    const settings = await db.get('SELECT credits_per_minute FROM platform_settings WHERE id = 1');
    const plans = await db.all('SELECT * FROM credit_plans WHERE is_active = 1 ORDER BY sort_order, price');
    res.json({
      ok: true,
      creditsPerMinute: Number(settings.credits_per_minute),
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        credits: p.credits,
        minutes: Number(p.minutes),
        description: p.description,
        isTrial: Boolean(p.is_trial),
        allowTopUp: Boolean(p.allow_top_up),
      })),
    });
  } catch (err) { next(err); }
});

// Public: active payment methods shown on the payment page.
router.get('/methods', async (req, res, next) => {
  try {
    const methods = await db.all('SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort_order, id');
    res.json({
      ok: true,
      methods: methods.map((m) => ({
        id: m.id,
        type: m.method_type,
        label: m.label,
        bankName: m.bank_name,
        accountName: m.account_name,
        accountNumber: m.account_number,
        routingSwift: m.routing_swift,
        cryptoCurrency: m.crypto_currency,
        walletAddress: m.wallet_address,
        networkNote: m.network_note,
      })),
    });
  } catch (err) { next(err); }
});

// Authenticated: submit a payment (plan + method + receipt upload).
router.post('/submit', requireLogin, upload.single('receipt'), async (req, res, next) => {
  try {
    const planId = parseInt(req.body.planId, 10);
    const methodId = parseInt(req.body.methodId, 10);

    const plan = await db.get('SELECT * FROM credit_plans WHERE id = ? AND is_active = 1', [planId]);
    if (!plan) return res.status(400).json({ error: 'Invalid plan selected.' });

    const method = await db.get('SELECT * FROM payment_methods WHERE id = ? AND is_active = 1', [methodId]);
    if (!method) return res.status(400).json({ error: 'Invalid payment method selected.' });

    if (!req.file) return res.status(400).json({ error: 'A payment receipt/screenshot is required.' });

    await db.run(
      `INSERT INTO payment_submissions (user_id, plan_id, method_id, amount, receipt_path, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [req.user.id, plan.id, method.id, plan.price, path.basename(req.file.path)]
    );

    res.json({ ok: true, message: 'Payment submitted. An admin will review it shortly.' });
  } catch (err) { next(err); }
});

// Authenticated: serves a receipt image, but only to the user who
// submitted it (admin access to any receipt is handled separately in
// routes/admin.js). Receipts are never served as plain static files.
router.get('/receipt/:submissionId', requireLogin, async (req, res, next) => {
  try {
    const submission = await db.get('SELECT * FROM payment_submissions WHERE id = ?', [req.params.submissionId]);
    if (!submission || submission.user_id !== req.user.id) return res.status(404).end();
    const filePath = path.join(RECEIPTS_DIR, submission.receipt_path);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

// Authenticated: a user's own submission history + current balances.
router.get('/my-submissions', requireLogin, async (req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT ps.*, cp.name AS plan_name FROM payment_submissions ps
       LEFT JOIN credit_plans cp ON cp.id = ps.plan_id
       WHERE ps.user_id = ? ORDER BY ps.created_at DESC`,
      [req.user.id]
    );
    res.json({ ok: true, submissions: rows });
  } catch (err) { next(err); }
});

module.exports = router;
