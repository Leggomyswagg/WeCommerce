import { fileURLToPath } from 'node:url';
import { WORKSPACE_SCHEMA_SQL } from './workspace-storage.js';

export async function setupWorkspaceSchema({ env = process.env, pool } = {}) {
  let ownedPool;
  if (!pool) {
    if (!env.DATABASE_URL) throw new Error('Database configuration is required.');
    const { Pool } = await import('pg');
    ownedPool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
    pool = ownedPool;
  }
  try { await pool.query(WORKSPACE_SCHEMA_SQL); }
  finally { if (ownedPool) await ownedPool.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await setupWorkspaceSchema();
    console.log('Workspace database schema is ready. No provider operations were performed.');
  } catch {
    console.error('Workspace schema setup failed. Verify DATABASE_URL and database permissions.');
    process.exitCode = 1;
  }
}
