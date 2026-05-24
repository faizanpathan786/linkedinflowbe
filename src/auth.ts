import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";

export const auth = betterAuth({
    database: new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    }),
    emailAndPassword: {
        enabled: true,
        sendResetPassword: async ({ user, token }: { user: { email: string; name: string }; token: string }) => {
            try {
                const { sendPasswordResetEmail } = await import('./lib/email');
                const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
                await sendPasswordResetEmail(user.email, user.name, resetUrl);
                console.log(`[auth] Password reset email sent to ${user.email}`);
            } catch (err: any) {
                console.error(`[auth] Failed to send password reset email to ${user.email}:`, err.message);
                throw err;
            }
        },
    },
    plugins: [bearer()],
    trustedOrigins: [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        'http://localhost:3000',
        'http://localhost:4000',
        'https://linkedinflow.vercel.app',
        'https://linkedinflowbe.vercel.app',
    ],
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
