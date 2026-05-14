import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      console.log(`📝 Running ${file}...`);
      try {
        await client.query(sql);
        console.log(`✅ ${file} completed`);
      } catch (error: any) {
        console.error(`❌ ${file} failed:`, error.message);
        if (!error.message.includes('already exists') && !error.message.includes('duplicate key')) {
          throw error;
        }
      }
    }

    console.log('✨ All migrations completed!');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
