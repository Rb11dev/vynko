// `npm run setup` - creates .env with a fresh random SESSION_SECRET (never overwrites).
import fs from 'node:fs';
import crypto from 'node:crypto';

if (fs.existsSync('.env')) {
  console.log('.env already exists - leaving it untouched.');
} else {
  const secret = crypto.randomBytes(32).toString('hex');
  const text = fs.readFileSync('.env.example', 'utf8').replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`);
  fs.writeFileSync('.env', text, { mode: 0o600 });
  console.log('Created .env with a new random SESSION_SECRET.');
}
console.log('Next: npm run dev   (then open http://localhost:3000)');
