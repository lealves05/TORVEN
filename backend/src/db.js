import pg from 'pg';

// numeric -> number, bigint -> number, date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1082, (v) => v);

const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/torven';

const isLocal = /@(localhost|127\.0\.0\.1|db)(:|\/)/.test(connectionString);
const ssl =
  process.env.DATABASE_SSL === 'false' || isLocal ? false : { rejectUnauthorized: false };

export const pool = new pg.Pool({
  connectionString,
  ssl,
  max: Number(process.env.DB_POOL_MAX || (process.env.VERCEL ? 3 : 8)),
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => console.error('[db] erro no pool', err.message));

export const q = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
