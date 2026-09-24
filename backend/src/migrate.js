import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`create table if not exists _migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    await client.query('alter table _migrations enable row level security');
    const { rows } = await client.query('select name from _migrations');
    const done = new Set(rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('insert into _migrations(name) values ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[migrate] aplicada ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${e.message}`);
      }
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => { console.log('[migrate] ok'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
