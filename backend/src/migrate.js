import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

/** Lista de migrações: embutida no build da Edge Function ou lida da pasta. */
function listMigrations() {
  const embedded = globalThis.__TORVEN_MIGRATIONS__;
  if (embedded) return embedded;
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`create table if not exists _migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    await client.query('alter table _migrations enable row level security');
    const { rows } = await client.query('select name from _migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const { name: file, sql } of listMigrations()) {
      if (done.has(file)) continue;
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

if (import.meta.url.startsWith('file:') && process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate()
    .then(() => { console.log('[migrate] ok'); return pool.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
