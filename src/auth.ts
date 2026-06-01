import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";

function normalizeOrigin(value: string | undefined): string | null {
    if (!value) return null;

    try {
        return new URL(value).origin;
    } catch {
        return null;
    }
}

const trustedOrigins = Array.from(
    new Set(
        [
            normalizeOrigin(process.env.FRONTEND_URL),
            normalizeOrigin(process.env.APP_URL),
            normalizeOrigin(process.env.BETTER_AUTH_URL),
            process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
            process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : null,
            process.env.VERCEL_PROJECT_PRODUCTION_URL
                ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
                : null,
            'https://linkedinflow.vercel.app',
            'https://linkedinflowbe.vercel.app',
            'http://localhost:3000',
            'http://localhost:4000',
        ].filter((origin): origin is string => Boolean(origin))
    )
);

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
    trustedOrigins,
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
