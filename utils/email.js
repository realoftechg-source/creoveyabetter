const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: Number(port) === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });
}

async function sendMail({ to, subject, text, html }) {
  const transport = getTransport();
  if (!transport) {
    console.log(`[email] SMTP not configured. Skipping email to ${to}`);
    return { skipped: true };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return { skipped: false, info };
}

async function sendWelcomeEmail(user) {
  if (!user || !user.email) return { skipped: true };
  return sendMail({
    to: user.email,
    subject: 'Welcome to Creoveya',
    text: `Hi ${user.username},\n\nWelcome to Creoveya. Your account has been created successfully.\n\nYou can now log in and activate your access plan.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10193a; line-height: 1.6;">
        <h2 style="margin-bottom: 12px; color: #0f2c66;">Welcome to Creoveya</h2>
        <p>Hi <strong>${user.username}</strong>,</p>
        <p>Your account has been created successfully.</p>
        <p>You can now log in to your dashboard and choose or upgrade your activation plan.</p>
        <p>Regards,<br/>The Creoveya Team</p>
      </div>
    `,
  });
}

async function sendApprovalEmail(user, plan) {
  if (!user || !user.email) return { skipped: true };
  const planName = plan?.name || 'Activation plan';
  return sendMail({
    to: user.email,
    subject: 'Your Creoveya payment has been approved',
    text: `Hi ${user.username},\n\nYour payment for ${planName} has been approved. Your account access has been activated and your balance has been updated.\n\nYou can now continue using the studio.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10193a; line-height: 1.6;">
        <h2 style="margin-bottom: 12px; color: #0f2c66;">Payment Approved</h2>
        <p>Hi <strong>${user.username}</strong>,</p>
        <p>Your payment for <strong>${planName}</strong> has been approved.</p>
        <p>Your account access, credits, and usage balance have been updated successfully.</p>
        <p>You can continue using Creoveya normally.</p>
        <p>Regards,<br/>The Creoveya Team</p>
      </div>
    `,
  });
}

async function sendTopUpEmail(user, plan) {
  if (!user || !user.email) return { skipped: true };
  const planName = plan?.name || 'Top-up plan';
  return sendMail({
    to: user.email,
    subject: 'Your Creoveya top-up has been added',
    text: `Hi ${user.username},\n\nYour ${planName} top-up has been approved and added to your account. Your credits and usage balance have been updated.`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #10193a; line-height: 1.6;">
        <h2 style="margin-bottom: 12px; color: #0f2c66;">Top-Up Added</h2>
        <p>Hi <strong>${user.username}</strong>,</p>
        <p>Your <strong>${planName}</strong> top-up has been approved and applied to your account.</p>
        <p>Your credits and streaming time have been updated.</p>
        <p>Regards,<br/>The Creoveya Team</p>
      </div>
    `,
  });
}

module.exports = { sendMail, sendWelcomeEmail, sendApprovalEmail, sendTopUpEmail };
