import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Generates the seed account's password straight into .env and writes the
// only secret-bearing request field to a temp file. Prints the file path and
// nothing else, so the password never reaches a terminal, a transcript, or a
// command line.
const envUrl = new URL('./.env', import.meta.url);
const EMAIL = 'shopreturn-seed@yopmail.com';

let password = process.env.SHOPRETURN_SEED_PASSWORD;
if (!password) {
  password = `Sd7!${randomBytes(12).toString('base64url')}`;
  const env = readFileSync(envUrl, 'utf8');
  appendFileSync(envUrl, `${env.endsWith('\n') ? '' : '\n'}SHOPRETURN_SEED_EMAIL=${EMAIL}\nSHOPRETURN_SEED_PASSWORD=${password}\n`);
}

const bodyPath = join(tmpdir(), 'shopreturn-seed-user.json');
writeFileSync(bodyPath, JSON.stringify({ password }));
console.log(bodyPath);
