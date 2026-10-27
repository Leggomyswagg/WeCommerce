import { open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { assertState, initialWorkspaceState } from './workspace-state.js';
import { WorkspaceError, unavailable } from './workspace-errors.js';

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../.wecommerce/', import.meta.url));
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const LOCAL_HOST = hostname();
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || ['VERCEL', 'NOW_REGION', 'AWS_LAMBDA_FUNCTION_NAME', 'LAMBDA_TASK_ROOT', 'NETLIFY', 'FUNCTION_TARGET', 'K_SERVICE', 'FUNCTIONS_WORKER_RUNTIME'].some(key => Boolean(env[key])) || /lambda/iu.test(env.AWS_EXECUTION_ENV ?? '');
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

export class FileWorkspaceStore {
  constructor({ directory = DEFAULT_DATA_DIR, lockTimeoutMs = 5000 } = {}) {
    this.directory = resolve(directory);
    this.file = join(this.directory, 'workspace.json');
    this.lock = join(this.directory, 'workspace.lock');
    this.lockTimeoutMs = lockTimeoutMs;
    this.description = {
      type: 'file', durable: true, productionReady: false,
      description: 'Atomic local development storage. Production and serverless require PostgreSQL.'
    };
  }

  async recoverDeadLock() {
    // A separate guard prevents two processes from removing a replacement lock.
    // An interrupted recovery itself fails closed and needs local operator cleanup.
    const recoveryPath = `${this.lock}.recovery`;
    let guard;
    try { guard = await open(recoveryPath, 'wx', 0o600); } catch (error) {
      if (error.code === 'EEXIST') return;
      throw error;
    }
    try {
      let owner;
      try { owner = JSON.parse(await readFile(this.lock, 'utf8')); } catch { return; }
      if (owner.host === LOCAL_HOST && !processAlive(owner.pid)) await rm(this.lock, { force: true });
    } finally {
      await guard.close();
      await rm(recoveryPath, { force: true });
    }
  }

  async acquireLock() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + this.lockTimeoutMs;
    const nonce = randomUUID();
    while (Date.now() < deadline) {
      let handle;
      try {
        handle = await open(this.lock, 'wx', 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, host: LOCAL_HOST, nonce }));
        await handle.sync();
        return async () => {
          try {
            const owner = JSON.parse(await readFile(this.lock, 'utf8'));
            if (owner.nonce === nonce) await rm(this.lock, { force: true });
          } finally { await handle.close(); }
        };
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
          await rm(this.lock, { force: true }).catch(() => {});
          throw error;
        }
        if (error.code !== 'EEXIST') throw error;
        await this.recoverDeadLock();
        await delay(15);
      }
    }
    throw unavailable();
  }

  async readState() {
    try {
      const metadata = await stat(this.file);
      if (metadata.size > MAX_STATE_BYTES) throw unavailable();
      return assertState(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error) {
      if (error.code === 'ENOENT') return initialWorkspaceState();
      throw error;
    }
  }

  async writeState(state) {
    assertState(state);
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw unavailable();
    const temporary = join(this.directory, `.workspace-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(serialized);
      await handle.sync();
      await handle.close();
      handle = null;
      await rename(temporary, this.file);
      // Make the rename durable before releasing the transaction lock.
      const directory = await open(dirname(this.file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async transact(mutator) {
    let release;
    try {
      release = await this.acquireLock();
      const state = await this.readState();
      const result = await mutator(state);
      await this.writeState(state);
      return result;
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      throw unavailable();
    } finally {
      if (release) {
        try { await release(); } catch { throw unavailable(); }
      }
    }
  }

  async read() {
    return this.transact(state => structuredClone(state));
  }

  async close() {}
}

export const WORKSPACE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wecommerce_workspaces (
  id text PRIMARY KEY CHECK (id = 'founder'),
  state jsonb NOT NULL,
  revision bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

export class PostgresWorkspaceStore {
  constructor({ pool }) {
    if (!pool || typeof pool.connect !== 'function') throw unavailable();
    this.pool = pool;
    // pg emits idle-client errors independently of requests. Keep the process
    // alive; subsequent transactions still fail closed with a safe response.
    this.pool.on?.('error', () => {});
    this.description = {
      type: 'postgres', durable: true, productionReady: true,
      description: 'PostgreSQL transactions persist the single founder workspace and serialize task approvals and claims.'
    };
  }

  async transact(mutator) {
    let client;
    let began = false;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      began = true;
      await client.query('INSERT INTO wecommerce_workspaces (id, state) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING', ['founder', JSON.stringify(initialWorkspaceState())]);
      const selected = await client.query('SELECT state FROM wecommerce_workspaces WHERE id = $1 FOR UPDATE', ['founder']);
      if (selected.rows.length !== 1) throw unavailable();
      const state = assertState(structuredClone(selected.rows[0].state));
      const result = await mutator(state);
      assertState(state);
      const serialized = JSON.stringify(state);
      if (Buffer.byteLength(serialized) > MAX_STATE_BYTES) throw unavailable();
      await client.query('UPDATE wecommerce_workspaces SET state = $2::jsonb, revision = revision + 1, updated_at = now() WHERE id = $1', ['founder', serialized]);
      await client.query('COMMIT');
      began = false;
      return result;
    } catch (error) {
      if (client && began) await client.query('ROLLBACK').catch(() => {});
      if (error instanceof WorkspaceError) throw error;
      throw unavailable();
    } finally { client?.release(); }
  }

  async read() {
    return this.transact(state => structuredClone(state));
  }

  async close() { await this.pool.end(); }
}

export async function createConfiguredWorkspaceStore(env = process.env) {
  if (typeof env.DATABASE_URL === 'string' && env.DATABASE_URL.trim()) {
    try {
      const { Pool } = await import('pg');
      return new PostgresWorkspaceStore({ pool: new Pool({
        connectionString: env.DATABASE_URL, max: 5,
        connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 5000
      }) });
    } catch { throw unavailable(); }
  }
  if (isProductionRuntime(env)) throw unavailable();
  return new FileWorkspaceStore({ directory: env.WE_COMMERCE_DATA_DIR || DEFAULT_DATA_DIR });
}
