import server from './server';
import client from './db';

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
