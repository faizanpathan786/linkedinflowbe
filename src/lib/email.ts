import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

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

  const response = await resend.emails.send({
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
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

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }
}

export async function sendPostFailedEmail(
  userEmail: string,
  userName: string,
  postContent: string,
  reason?: string
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const preview = postContent.length > 200 ? postContent.slice(0, 200) + '…' : postContent;

  const response = await resend.emails.send({
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
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

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }
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

  const response = await resend.emails.send({
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
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

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }
}

export async function sendPasswordResetEmail(
  userEmail: string,
  userName: string,
  resetUrl: string
): Promise<void> {
  const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';

  const response = await resend.emails.send({
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
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

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }
}

export async function sendEarlyAccessNotificationEmail(signupEmail: string): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return;

  const response = await resend.emails.send({
    from: process.env.RESEND_FROM || 'onboarding@resend.dev',
    to: adminEmail,
    subject: `New Early Access Signup: ${signupEmail}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f4f6f8;border-radius:12px;">
        <h2 style="margin:0 0 12px;color:#0a66c2;">New Early Access Signup</h2>
        <p style="margin:0;color:#333;font-size:16px;">
          <strong>${escapeHtml(signupEmail)}</strong> just joined the early access list.
        </p>
        <p style="margin:16px 0 0;color:#777;font-size:13px;">${new Date().toUTCString()}</p>
      </div>
    `,
  });

  if (response.error) {
    throw new Error(`Resend error: ${response.error.message}`);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
