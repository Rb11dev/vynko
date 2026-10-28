// `npm run db:migrate` - creates/updates the SQLite database without starting the server.
import fs from 'node:fs';
import { openDb } from '../server/db.mjs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const file = process.env.DATABASE_PATH || './data/vynko.db';
const db = openDb(file);
const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
console.log(`Database ready at ${file}. Applied migrations: ${rows.map((r) => r.version).join(', ')}`);
db.close();
