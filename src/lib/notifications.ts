import { Pool } from 'pg';
import { sendPostPublishedEmail, sendPostFailedEmail } from './email';

export interface NotificationPrefs {
  emailNotifications: boolean;
  pushNotifications: boolean;
  postSuccess: boolean;
  postFailure: boolean;
  batchComplete: boolean;
  weeklyReport: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  emailNotifications: true,
  pushNotifications: false,
  postSuccess: true,
  postFailure: true,
  batchComplete: true,
  weeklyReport: false,
};

export function mergePrefs(stored: any): NotificationPrefs {
  return { ...DEFAULT_PREFS, ...(stored ?? {}) };
}

export async function notifyPostSuccess(
  pool: Pool,
  userId: string,
  postContent: string,
  publishedAt: Date
): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT name, email, notification_preferences FROM public."user" WHERE id = $1`,
      [userId]
    );
    if (!rows.length) return;
    const { name, email, notification_preferences } = rows[0];
    const prefs = mergePrefs(notification_preferences);
    if (!prefs.emailNotifications || !prefs.postSuccess) return;
    await sendPostPublishedEmail(email, name, postContent, publishedAt.toISOString());
  } finally {
    client.release();
  }
}

export async function notifyPostFailure(
  pool: Pool,
  userId: string,
  postContent: string,
  reason?: string
): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT name, email, notification_preferences FROM public."user" WHERE id = $1`,
      [userId]
    );
    if (!rows.length) return;
    const { name, email, notification_preferences } = rows[0];
    const prefs = mergePrefs(notification_preferences);
    if (!prefs.emailNotifications || !prefs.postFailure) return;
    await sendPostFailedEmail(email, name, postContent, reason);
  } finally {
    client.release();
  }
}
