"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPostPublishedEmail = sendPostPublishedEmail;
const resend_1 = require("resend");
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
function sendPostPublishedEmail(userEmail, userName, postContent, publishedAt) {
    return __awaiter(this, void 0, void 0, function* () {
        const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
        const preview = postContent.length > 200 ? postContent.slice(0, 200) + '…' : postContent;
        const formattedDate = new Date(publishedAt).toLocaleString('en-US', {
            dateStyle: 'medium',
            timeStyle: 'short',
        });
        const response = yield resend.emails.send({
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
    });
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
