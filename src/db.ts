import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Supabase requires SSL
  }
});

export default client;
