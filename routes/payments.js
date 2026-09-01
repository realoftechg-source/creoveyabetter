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
        badgeText: p.badge_text || '',
        tagline: p.tagline || '',
        price: Number(p.price),
        credits: p.credits,
        minutes: Number(p.minutes),
        description: p.description,
        features: p.features ? p.features.split('|').filter(Boolean) : [],
        isTrial: Boolean(p.is_trial),
        allowTopUp: Boolean(p.allow_top_up),
        isFeatured: Boolean(p.is_featured),
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

// Public: active top-up plans shown on the homepage/payment page.
router.get('/topup-plans', async (req, res, next) => {
  try {
    const plans = await db.all('SELECT * FROM topup_plans WHERE is_active = 1 ORDER BY sort_order, price');
    console.log('[payments/topup-plans] Found', plans.length, 'active top-up plans');
    res.json({
      ok: true,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        badgeText: p.badge_text || '',
        tagline: p.tagline || '',
        price: Number(p.price),
        credits: p.credits,
        minutes: Number(p.minutes),
        description: p.description,
        features: p.features ? p.features.split('|').filter(Boolean) : [],
        isFeatured: Boolean(p.is_featured),
      })),
    });
  } catch (err) { 
    console.error('[payments/topup-plans] Error:', err.message);
    next(err); 
  }
});

// Authenticated: submit a payment (plan + method + receipt upload).
router.post('/submit', requireLogin, upload.single('receipt'), async (req, res, next) => {
  try {
    console.log('[payments/submit] User', req.user.id, 'submitting payment');
    console.log('[payments/submit] Body:', { planId: req.body.planId, planType: req.body.planType, methodId: req.body.methodId });
    console.log('[payments/submit] File:', req.file ? { filename: req.file.filename, size: req.file.size } : 'NO FILE');

    const planId = parseInt(req.body.planId, 10);
    const planType = req.body.planType || 'activation';
    const methodId = parseInt(req.body.methodId, 10);

    if (!planId || !methodId) {
      console.warn('[payments/submit] Missing required fields');
      return res.status(400).json({ error: 'Plan ID and method ID are required.' });
    }

    let plan;
    if (planType === 'topup') {
      plan = await db.get('SELECT * FROM topup_plans WHERE id = ? AND is_active = 1', [planId]);
      if (!plan) {
        console.warn('[payments/submit] Topup plan', planId, 'not found or inactive');
        return res.status(400).json({ error: 'Invalid top-up plan selected.' });
      }
      if (!req.user.has_active_access) {
        console.warn('[payments/submit] User', req.user.id, 'lacks active access for topup');
        return res.status(400).json({ error: 'You must have an active account to purchase a top-up plan.' });
      }
    } else {
      plan = await db.get('SELECT * FROM credit_plans WHERE id = ? AND is_active = 1', [planId]);
      if (!plan) {
        console.warn('[payments/submit] Activation plan', planId, 'not found or inactive');
        return res.status(400).json({ error: 'Invalid plan selected.' });
      }
      if (plan.is_trial && req.user.is_trial_plan) {
        console.warn('[payments/submit] User', req.user.id, 'already on trial');
        return res.status(400).json({ error: 'You are already on the trial activation plan.' });
      }
    }

    const method = await db.get('SELECT * FROM payment_methods WHERE id = ? AND is_active = 1', [methodId]);
    if (!method) {
      console.warn('[payments/submit] Payment method', methodId, 'not found or inactive');
      return res.status(400).json({ error: 'Invalid payment method selected.' });
    }

    if (!req.file) {
      console.warn('[payments/submit] No receipt file uploaded');
      return res.status(400).json({ error: 'A payment receipt/screenshot is required.' });
    }

    const receiptPath = path.basename(req.file.path);
    const amount = Number(plan.price);

    if (planType === 'topup') {
      await db.run(
        `INSERT INTO payment_submissions (user_id, topup_plan_id, plan_type, method_id, amount, receipt_path, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, plan.id, 'topup', method.id, amount, receiptPath, 'pending']
      );
      console.log('[payments/submit] ✓ Created topup submission for user', req.user.id);
    } else {
      await db.run(
        `INSERT INTO payment_submissions (user_id, plan_id, plan_type, method_id, amount, receipt_path, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, plan.id, 'activation', method.id, amount, receiptPath, 'pending']
      );
      console.log('[payments/submit] ✓ Created activation submission for user', req.user.id);
    }

    await db.run(`INSERT INTO user_activity (user_id, action, details) VALUES (?, ?, ?)`, 
      [req.user.id, 'submitted_payment', JSON.stringify({ planId: plan.id, planType, amount, methodId: method.id })]
    );

    res.json({ ok: true, message: 'Payment submitted. An admin will review it shortly.' });
  } catch (err) { 
    console.error('[payments/submit] Error:', err.message, err.stack);
    next(err); 
  }
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
      `SELECT ps.*, COALESCE(cp.name, tp.name) AS plan_name FROM payment_submissions ps
       LEFT JOIN credit_plans cp ON cp.id = ps.plan_id
       LEFT JOIN topup_plans tp ON tp.id = ps.topup_plan_id
       WHERE ps.user_id = ? ORDER BY ps.created_at DESC`,
      [req.user.id]
    );
    res.json({ ok: true, submissions: rows });
  } catch (err) { next(err); }
});

module.exports = router;
