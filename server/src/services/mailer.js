import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';

const APP_URL = process.env.APP_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const FROM = process.env.MAIL_FROM || 'Campus Auction <alerts@campus-auction.local>';
const RECENT_LIMIT = 10;
const TIMEOUTS = { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 };
const OUTBOX_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'outbox');
const recentByUser = new Map();
const emailsById = new Map();
let nextEmailId = 1;
let transportPromise = null;

// Real SMTP when SMTP_HOST is set (e.g. Gmail with an app password); otherwise an Ethereal test inbox,
// which accepts mail without delivering it and gives a preview link for each message.
function getTransport() {
  if (!transportPromise) {
    transportPromise = (async () => {
      if (process.env.SMTP_HOST) {
        const transport = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
          ...TIMEOUTS,
        });
        return { transport, mode: 'smtp' };
      }
      const account = await nodemailer.createTestAccount();
      const transport = nodemailer.createTransport({
        host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
        ...TIMEOUTS,
      });
      return { transport, mode: 'ethereal' };
    })().catch((err) => {
      transportPromise = null;
      throw err;
    });
  }
  return transportPromise;
}

const escapeHtml = (text) => String(text).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]);
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

function closesIn(endsAt) {
  const mins = Math.max(0, Math.round((endsAt - Date.now()) / 60000));
  if (mins < 60) return `${mins} minutes`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} hours`;
  return `${Math.round(mins / 1440)} days`;
}

function matchEmail({ name, label, auction }) {
  const link = `${APP_URL}/auctions/${auction.id}`;
  const subject = `New match for "${label}": ${auction.title}`;
  const text = `Hi ${name},\n\nA new item matches your saved search "${label}":\n\n${auction.title}\nStarts at ${rupees(auction.startPrice)}, closes in ${closesIn(auction.endsAt)}.\n\nView and bid: ${link}\n\nYou get this email because email alerts are on for this saved search. Turn them off on the Wanted page.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7fb;font-family:Segoe UI,Arial,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e8ef;border-radius:16px;overflow:hidden">
      <tr><td style="padding:20px 28px;border-bottom:1px solid #e7e8ef">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;text-align:center;border-radius:8px;background:#4f46e5;color:#fff;font-weight:800;font-size:12px">CA</span>
        <span style="font-weight:700;font-size:15px;margin-left:8px;vertical-align:middle">Campus Auction</span>
      </td></tr>
      <tr><td style="padding:28px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b45309">New match for your saved search</p>
        <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#1e1b4b">${escapeHtml(auction.title)}</h1>
        <p style="margin:0 0 18px;font-size:15px;color:#374151">Hi ${escapeHtml(name)}, an item matching <strong>"${escapeHtml(label)}"</strong> was just listed.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f8fc;border-radius:12px;margin-bottom:22px">
          <tr>
            <td style="padding:14px 16px"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Starts at</div>
              <div style="font-size:20px;font-weight:800;color:#4f46e5">${rupees(auction.startPrice)}</div></td>
            <td style="padding:14px 16px"><div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Closes in</div>
              <div style="font-size:20px;font-weight:800;color:#b45309">${closesIn(auction.endsAt)}</div></td>
          </tr>
        </table>
        <a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:10px">View and bid</a>
      </td></tr>
      <tr><td style="padding:16px 28px;background:#fafbfc;border-top:1px solid #e7e8ef;font-size:12px;color:#6b7280">
        You get this because email alerts are on for "${escapeHtml(label)}". Turn them off any time on the Wanted page.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, text, html };
}

function remember(userId, entry, html) {
  emailsById.set(entry.id, { userId, html });
  recentByUser.set(userId, [entry, ...(recentByUser.get(userId) ?? [])].slice(0, RECENT_LIMIT));
}

// If no mail server is reachable (e.g. a campus network blocking SMTP), the email is kept in an outbox
// so it can still be previewed in the app; nothing is lost silently.
async function sendMatchEmail(job) {
  const { subject, text, html } = matchEmail(job);
  const entry = { id: nextEmailId++, subject, to: job.to, auctionId: job.auction.id, previewUrl: null, mode: 'outbox', sentAt: Date.now(), note: null };
  try {
    const { transport, mode } = await getTransport();
    const info = await transport.sendMail({ from: FROM, to: job.to, subject, text, html });
    entry.mode = mode;
    entry.previewUrl = mode === 'ethereal' ? nodemailer.getTestMessageUrl(info) || null : null;
    console.log(`Email alert sent to ${job.to} (${mode})${entry.previewUrl ? `: ${entry.previewUrl}` : ''}`);
  } catch (err) {
    entry.note = 'Mail server unreachable, saved to outbox';
    fs.mkdirSync(OUTBOX_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUTBOX_DIR, `email-${entry.id}.html`), html);
    console.error(`Email alert to ${job.to} not delivered (${err.message}); saved to outbox as email-${entry.id}.html`);
  }
  remember(job.userId, entry, html);
}

export function sendMatchEmails(jobs) {
  for (const job of jobs) {
    sendMatchEmail(job).catch((err) => console.error(`Email alert to ${job.to} failed:`, err.message));
  }
}

export function recentEmails(userId) {
  return recentByUser.get(userId) ?? [];
}

export function emailHtml(userId, id) {
  const email = emailsById.get(id);
  return email && email.userId === userId ? email.html : null;
}
