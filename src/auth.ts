import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { Pool } from "pg";


export const auth = betterAuth({
    database: new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    }),
    emailAndPassword:{
        enabled: true,
    },
    plugins: [bearer()],
})

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;