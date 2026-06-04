// Load environment variables as early as possible so modules that read
// process.env (like `src/db.ts`) get the correct values.
import 'dotenv/config';

import server from './server';
import client from './db';
import { startScheduler } from './services/scheduler';

const port = Number(process.env.PORT) || 3000;

server.listen(
  {
    port,
    host: '0.0.0.0',
  },
  (err, address) => {
    if (err) {
      server.log.error(err);
      process.exit(1);
    }

    server.log.info(`Server running on ${address}`);
    // This entrypoint only runs on the persistent server (Render / local), not
    // on Vercel serverless (which uses api/index.ts). A long-running process can
    // run node-cron reliably, so start the in-process scheduler here — it polls
    // for due posts every minute, avoiding dependence on an external cron ping.
    startScheduler(server);
  },
);

async function connectDB() {
  try {
    await client.connect();
    console.log('Connected to Supabase PostgreSQL!');

  } catch (err) {
    console.error('Connection error:', err);
  }
}

connectDB();
