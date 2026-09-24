// Entrada serverless (Vercel). Todas as rotas caem aqui via vercel.json.
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';

const app = createApp();
let ready = null; // migra uma vez por instância "fria"

export default async function handler(req, res) {
  try {
    ready ??= migrate().catch((e) => { ready = null; throw e; });
    await ready;
  } catch (e) {
    console.error('[boot] migração falhou:', e.message);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Banco de dados indisponível. Tente novamente em instantes.' }));
  }
  return app(req, res);
}
