// DEV ONLY — never loaded in production.
// Implements the small slice of the @neondatabase/serverless API that this app
// uses (tagged template + .query + .transaction), backed by a plain `pg` pool,
// so the admin can run against a local Postgres without a Neon account.
// Activated by LOCAL_PG=1, which swaps this in via a webpack alias in
// next.config.mjs. See README "Lokal udvikling".
import pg from 'pg';

// Match Neon's HTTP driver: numeric/int8 come back as strings.
const pools = new Map();

function poolFor(connectionString) {
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 4 });
    pools.set(connectionString, pool);
  }
  return pool;
}

export function neon(connectionString) {
  const pool = poolFor(connectionString);

  const run = async (text, params) => {
    const res = await pool.query(text, params);
    return res.rows;
  };

  // sql`select * from x where id = ${id}` → parameterized query
  const tagged = (strings, ...values) => {
    if (!Array.isArray(strings)) throw new Error('dev-pg-driver: expected a template literal');
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
    return run(text, values);
  };

  tagged.query = (text, params = []) => run(text, params);
  tagged.unsafe = (text) => run(text, []);
  tagged.transaction = async (queries) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const list = typeof queries === 'function' ? queries({ unsafe: (t) => ({ __sql: t }) }) : queries;
      const out = [];
      for (const q of list) out.push((await client.query(q.__sql ?? q)).rows);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  };
  return tagged;
}

export default { neon };
