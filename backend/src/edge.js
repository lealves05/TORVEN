// Entrada para Supabase Edge Functions (Deno). Gerada em bundle por scripts/build-edge.mjs.
import express from 'express';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { pool } from './db.js';

const FN = '/torven-api';

async function boot() {
  await migrate();
  // segredo do JWT guardado no próprio banco (Edge Functions não recebem variáveis pelo deploy)
  if (!process.env.JWT_SECRET) {
    await pool.query(`create table if not exists _secrets (key text primary key, value text not null)`);
    await pool.query('alter table _secrets enable row level security');
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(48)), (b) => b.toString(16).padStart(2, '0')).join('');
    await pool.query("insert into _secrets (key, value) values ('jwt_secret', $1) on conflict do nothing", [rand]);
    const { rows: [r] } = await pool.query("select value from _secrets where key = 'jwt_secret'");
    process.env.JWT_SECRET = r.value;
  }
}

let ready = null;
const server = express();
server.use(async (_req, res, next) => {
  try {
    ready ??= boot().catch((e) => { ready = null; throw e; });
    await ready;
    next();
  } catch (e) {
    console.error('[boot]', e);
    res.status(503).json({ error: 'Banco de dados indisponível. Tente novamente em instantes.' });
  }
});
server.use(FN, createApp());
server.listen(8000);
