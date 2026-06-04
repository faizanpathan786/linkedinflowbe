import nodemailer from 'nodemailer';

// Gmail SMTP transport. Sends from a Gmail account using an App Password
// (myaccount.google.com → Security → 2-Step Verification → App passwords).
// Unlike Resend's free tier, this delivers to any recipient (~500/day).
const SMTP_USER = process.env.SMTP_USER || 'linkedinflow22@gmail.com';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
// Gmail rewrites the From to the authenticated account, so keep it consistent.
const MAIL_FROM = process.env.MAIL_FROM || `LFlow <${SMTP_USER}>`;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
});

async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  if (!SMTP_USER || !SMTP_PASSWORD) {
    throw new Error('SMTP not configured: set SMTP_USER and SMTP_PASSWORD (Gmail App Password)');
  }
  await transporter.sendMail({
    from: MAIL_FROM,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}

export async function sendPostPublishedEmail(
  userEmail: string,
  userName: string,
  postContent: string,
  publishedAt: string
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const preview = postContent.length > 200 ? postContent.slice(0, 200) + '…' : postContent;
  const formattedDate = new Date(publishedAt).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  await sendEmail({
    to: userEmail,
    subject: '✨ Your LinkedIn Post Was Published – LFlow',
    html: `
      <div style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td align="center">

              <!-- Main Container -->
              <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.08);">

                <!-- Header -->
                <tr>
                  <td style="background:linear-gradient(135deg,#0a66c2,#0077b5);padding:25px;text-align:center;color:#fff;">
                    <h1 style="margin:0;font-size:24px;">LFlow</h1>
                    <p style="margin:5px 0 0;font-size:14px;opacity:0.8;">LinkedIn Post Automation</p>
                  </td>
                </tr>

                <!-- Hero Section -->
                <tr>
                  <td style="padding:30px;text-align:center;">
                    <h2 style="margin:0;color:#111;">Your Post is Live on LinkedIn ✓</h2>
                    <p style="color:#555;font-size:15px;">
                      Your content is now published and reaching your network.
                    </p>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding:0 30px 20px;">
                    <p style="color:#333;">Dear ${escapeHtml(userName)},</p>

                    <p style="color:#555;">
                      Your post was <strong>successfully published to LinkedIn</strong> on ${formattedDate}.
                    </p>

                    <!-- Post Preview -->
                    <div style="background:#f3f2ef;border-left:4px solid #0a66c2;padding:14px 16px;margin:16px 0;border-radius:4px;">
                      <p style="margin:0;color:#333;font-size:14px;white-space:pre-wrap;">${escapeHtml(preview)}</p>
                    </div>

                    <p style="color:#555;">
                      If you have any questions or need help managing your posts, feel free to reply to this email.
                    </p>
                  </td>
                </tr>

                <!-- CTA Button -->
                <tr>
                  <td align="center" style="padding:20px;">
                    <a href="${appUrl}/posts"
                       style="background:linear-gradient(135deg,#0a66c2,#0077b5);
                              color:#fff;
                              padding:14px 28px;
                              text-decoration:none;
                              border-radius:30px;
                              font-weight:bold;
                              display:inline-block;">
                      View Your Posts
                    </a>
                  </td>
                </tr>

                <!-- Divider -->
                <tr>
                  <td style="padding:20px;">
                    <hr style="border:none;border-top:1px solid #eee;">
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding:20px 30px;text-align:center;color:#777;font-size:13px;">
                    <p style="margin:0;"><strong>The LFlow Team</strong></p>
                    <p style="margin:5px 0;">
                      🌐 <a href="${appUrl}" style="color:#0a66c2;text-decoration:none;">${appUrl}</a>
                    </p>
                    <p style="margin-top:10px;font-size:11px;color:#aaa;">
                      © 2026 LFlow. All rights reserved.
                    </p>
                  </td>
                </tr>

              </table>

              <div style="height:20px;"></div>

            </td>
          </tr>
        </table>
      </div>
    `,
  });
}

export async function sendPostFailedEmail(
  userEmail: string,
  userName: string,
  postContent: string,
  reason?: string
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const preview = postContent.length > 200 ? postContent.slice(0, 200) + '…' : postContent;

  await sendEmail({
    to: userEmail,
    subject: '⚠️ Your LinkedIn Post Failed to Publish – LFlow',
    html: `
      <div style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.08);">
              <tr>
                <td style="background:linear-gradient(135deg,#c0392b,#e74c3c);padding:25px;text-align:center;color:#fff;">
                  <h1 style="margin:0;font-size:24px;">LFlow</h1>
                  <p style="margin:5px 0 0;font-size:14px;opacity:0.8;">LinkedIn Post Automation</p>
                </td>
              </tr>
              <tr>
                <td style="padding:30px;text-align:center;">
                  <h2 style="margin:0;color:#111;">Post Failed to Publish ✗</h2>
                  <p style="color:#555;font-size:15px;">There was an issue publishing your post to LinkedIn.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 30px 20px;">
                  <p style="color:#333;">Dear ${escapeHtml(userName)},</p>
                  <p style="color:#555;">Unfortunately, your post could not be published to LinkedIn.</p>
                  ${reason ? `<p style="color:#555;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ''}
                  <div style="background:#f3f2ef;border-left:4px solid #e74c3c;padding:14px 16px;margin:16px 0;border-radius:4px;">
                    <p style="margin:0;color:#333;font-size:14px;white-space:pre-wrap;">${escapeHtml(preview)}</p>
                  </div>
                  <p style="color:#555;">You can retry publishing from your posts dashboard.</p>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:20px;">
                  <a href="${appUrl}/posts"
                     style="background:linear-gradient(135deg,#0a66c2,#0077b5);color:#fff;padding:14px 28px;text-decoration:none;border-radius:30px;font-weight:bold;display:inline-block;">
                    Go to Posts
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 30px;text-align:center;color:#777;font-size:13px;">
                  <p style="margin:0;"><strong>The LFlow Team</strong></p>
                  <p style="margin-top:10px;font-size:11px;color:#aaa;">© 2026 LFlow. All rights reserved.</p>
                </td>
              </tr>
            </table>
            <div style="height:20px;"></div>
          </td></tr>
        </table>
      </div>
    `,
  });
}

export async function sendWeeklyDigestEmail(
  userEmail: string,
  userName: string,
  stats: {
    total: number;
    published: number;
    failed: number;
    scheduled: number;
    weekOf: string;
  }
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

  await sendEmail({
    to: userEmail,
    subject: `📊 Your Weekly LFlow Report – ${stats.weekOf}`,
    html: `
      <div style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.08);">
              <tr>
                <td style="background:linear-gradient(135deg,#0a66c2,#0077b5);padding:25px;text-align:center;color:#fff;">
                  <h1 style="margin:0;font-size:24px;">LFlow</h1>
                  <p style="margin:5px 0 0;font-size:14px;opacity:0.8;">Weekly Report – ${escapeHtml(stats.weekOf)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:30px;text-align:center;">
                  <h2 style="margin:0;color:#111;">Your Week in Review</h2>
                  <p style="color:#555;font-size:15px;">Here's how your LinkedIn content performed this week.</p>
                </td>
              </tr>
              <tr>
                <td style="padding:0 30px 20px;">
                  <p style="color:#333;">Hi ${escapeHtml(userName)},</p>
                  <table width="100%" cellpadding="12" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
                    <tr style="background:#f3f2ef;">
                      <td style="font-weight:bold;color:#333;border-radius:4px 0 0 4px;">Total Posts</td>
                      <td style="text-align:right;color:#0a66c2;font-weight:bold;font-size:18px;border-radius:0 4px 4px 0;">${stats.total}</td>
                    </tr>
                    <tr>
                      <td style="color:#27ae60;font-weight:bold;">✓ Published</td>
                      <td style="text-align:right;color:#27ae60;font-weight:bold;font-size:18px;">${stats.published}</td>
                    </tr>
                    <tr style="background:#f3f2ef;">
                      <td style="color:#e74c3c;font-weight:bold;">✗ Failed</td>
                      <td style="text-align:right;color:#e74c3c;font-weight:bold;font-size:18px;">${stats.failed}</td>
                    </tr>
                    <tr>
                      <td style="color:#f39c12;font-weight:bold;">⏰ Scheduled</td>
                      <td style="text-align:right;color:#f39c12;font-weight:bold;font-size:18px;">${stats.scheduled}</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td align="center" style="padding:20px;">
                  <a href="${appUrl}/posts"
                     style="background:linear-gradient(135deg,#0a66c2,#0077b5);color:#fff;padding:14px 28px;text-decoration:none;border-radius:30px;font-weight:bold;display:inline-block;">
                    View All Posts
                  </a>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 30px;text-align:center;color:#777;font-size:13px;">
                  <p style="margin:0;"><strong>The LFlow Team</strong></p>
                  <p style="margin-top:10px;font-size:11px;color:#aaa;">
                    You're receiving this because weekly reports are enabled.
                    <a href="${appUrl}/settings" style="color:#0a66c2;">Manage preferences</a>
                  </p>
                  <p style="font-size:11px;color:#aaa;">© 2026 LFlow. All rights reserved.</p>
                </td>
              </tr>
            </table>
            <div style="height:20px;"></div>
          </td></tr>
        </table>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  userEmail: string,
  userName: string,
  resetUrl: string
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

  await sendEmail({
    to: userEmail,
    subject: '🔐 Reset Your LFlow Password',
    html: `
      <div style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 25px rgba(0,0,0,0.08);">

              <!-- Header -->
              <tr>
                <td style="background:linear-gradient(135deg,#0a66c2,#0077b5);padding:25px;text-align:center;color:#fff;">
                  <h1 style="margin:0;font-size:24px;">LFlow</h1>
                  <p style="margin:5px 0 0;font-size:14px;opacity:0.8;">LinkedIn Post Automation</p>
                </td>
              </tr>

              <!-- Hero -->
              <tr>
                <td style="padding:30px;text-align:center;">
                  <h2 style="margin:0;color:#111;">Reset Your Password</h2>
                  <p style="color:#555;font-size:15px;">We received a request to reset your LFlow password.</p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:0 30px 20px;">
                  <p style="color:#333;">Hi ${escapeHtml(userName)},</p>
                  <p style="color:#555;">
                    Click the button below to choose a new password. This link expires in
                    <strong>1 hour</strong>.
                  </p>
                  <p style="color:#555;">
                    If you didn't request a password reset, you can safely ignore this email —
                    your password will not change.
                  </p>
                </td>
              </tr>

              <!-- CTA -->
              <tr>
                <td align="center" style="padding:20px;">
                  <a href="${resetUrl}"
                     style="background:linear-gradient(135deg,#0a66c2,#0077b5);
                            color:#fff;
                            padding:14px 28px;
                            text-decoration:none;
                            border-radius:30px;
                            font-weight:bold;
                            display:inline-block;">
                    Reset Password
                  </a>
                </td>
              </tr>

              <!-- Fallback link -->
              <tr>
                <td style="padding:0 30px 20px;">
                  <p style="color:#999;font-size:12px;">
                    If the button doesn't work, copy and paste this link into your browser:<br>
                    <a href="${resetUrl}" style="color:#0a66c2;word-break:break-all;">${resetUrl}</a>
                  </p>
                </td>
              </tr>

              <!-- Divider -->
              <tr><td style="padding:0 20px;"><hr style="border:none;border-top:1px solid #eee;"></td></tr>

              <!-- Footer -->
              <tr>
                <td style="padding:20px 30px;text-align:center;color:#777;font-size:13px;">
                  <p style="margin:0;"><strong>The LFlow Team</strong></p>
                  <p style="margin:5px 0;">
                    🌐 <a href="${appUrl}" style="color:#0a66c2;text-decoration:none;">${appUrl}</a>
                  </p>
                  <p style="margin-top:10px;font-size:11px;color:#aaa;">© 2026 LFlow. All rights reserved.</p>
                </td>
              </tr>

            </table>
            <div style="height:20px;"></div>
          </td></tr>
        </table>
      </div>
    `,
  });
}

export async function sendEarlyAccessNotificationEmail(signupEmail: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return;

  const now = new Date().toLocaleString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short',
    day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  await sendEmail({
    to: adminEmail,
    subject: `🎉 New Early Access Request — ${escapeHtml(signupEmail)}`,
    html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:40px 0;">
    <tr><td align="center">

      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a66c2 0%,#0d4f9e 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">LinkedinFlow</h1>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:0.5px;text-transform:uppercase;">Early Access Program</p>
          </td>
        </tr>

        <!-- Icon + Title -->
        <tr>
          <td style="padding:40px 40px 0;text-align:center;">
            <div style="display:inline-block;background:#e8f4fd;border-radius:50%;width:64px;height:64px;line-height:64px;font-size:28px;">🚀</div>
            <h2 style="margin:16px 0 8px;font-size:22px;font-weight:700;color:#0f1923;">New Signup!</h2>
            <p style="margin:0;font-size:15px;color:#6b7280;">Someone just requested early access to LinkedinFlow.</p>
          </td>
        </tr>

        <!-- Email Card -->
        <tr>
          <td style="padding:28px 40px;">
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;">
              <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;">Email Address</p>
              <p style="margin:0;font-size:18px;font-weight:600;color:#0a66c2;">${escapeHtml(signupEmail)}</p>
            </div>
          </td>
        </tr>

        <!-- Meta -->
        <tr>
          <td style="padding:0 40px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 24px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;">📅 Signed up at</td>
                      <td style="font-size:13px;color:#374151;font-weight:500;text-align:right;">${now}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:0 40px;"><hr style="border:none;border-top:1px solid #f1f5f9;margin:0;"></td></tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 40px;text-align:center;">
            <p style="margin:0;font-size:13px;color:#9ca3af;">
              This is an automated notification from <strong style="color:#0a66c2;">LinkedinFlow</strong>.<br>
              You're receiving this because you're the app admin.
            </p>
          </td>
        </tr>

      </table>

    </td></tr>
  </table>
</body>
</html>
    `,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
