import assert from 'node:assert/strict';
import test from 'node:test';
import { PostgresWorkspaceStore, WORKSPACE_SCHEMA_SQL } from '../apps/api/src/workspace-storage.js';
import { setupWorkspaceSchema } from '../apps/api/src/workspace-schema.js';
import { createWorkspaceService } from '../apps/api/src/workspace-service.js';
import { WorkspaceError } from '../apps/api/src/workspace-errors.js';

// This protocol double checks transaction boundaries and rollback behavior.
// It does not replace an integration check against an operator-owned database.
class TransactionPool {
  constructor() { this.state = null; this.queries = []; this.released = 0; this.failUpdate = false; }
  async connect() {
    const pool = this;
    let state;
    return {
      async query(sql, values) {
        pool.queries.push({ sql, values });
        if (sql === 'BEGIN') state = structuredClone(pool.state);
        else if (sql.startsWith('INSERT')) state ??= JSON.parse(values[1]);
        else if (sql.startsWith('SELECT')) return { rows: [{ state: structuredClone(state) }] };
        else if (sql.startsWith('UPDATE')) {
          if (pool.failUpdate) throw new Error('secret connection URL or provider body');
          state = JSON.parse(values[1]);
        } else if (sql === 'COMMIT') pool.state = state;
        return { rows: [] };
      },
      release() { pool.released += 1; }
    };
  }
  async end() {}
}

test('PostgreSQL store locks the founder row and commits parameterized state changes atomically', async () => {
  const pool = new TransactionPool();
  const store = new PostgresWorkspaceStore({ pool });
  await store.transact(state => { state.profile = { brandName: "Quoted ' Brand" }; });
  assert.equal(pool.state.profile.brandName, "Quoted ' Brand");
  assert.equal(pool.queries[0].sql, 'BEGIN');
  assert.match(pool.queries.find(query => query.sql.startsWith('SELECT')).sql, /FOR UPDATE$/);
  assert.match(pool.queries.find(query => query.sql.startsWith('UPDATE')).sql, /\$2::jsonb/);
  assert.equal(pool.queries.at(-1).sql, 'COMMIT');
  assert.equal(pool.released, 1);
  assert.ok(pool.queries.every(query => !query.sql.includes("Quoted ' Brand")));
  assert.equal(pool.queries.some(query => /CREATE TABLE/.test(query.sql)), false);
});

test('PostgreSQL transaction rolls back domain errors and safely handles unavailable database writes', async () => {
  const pool = new TransactionPool();
  const store = new PostgresWorkspaceStore({ pool });
  await store.transact(state => { state.profile = { brandName: 'Before' }; });
  await assert.rejects(store.transact(state => {
    state.profile.brandName = 'Rolled back';
    throw new WorkspaceError(409, 'task_not_approved', 'Approve first.');
  }), error => error.code === 'task_not_approved');
  assert.equal(pool.state.profile.brandName, 'Before');
  assert.equal(pool.queries.at(-1).sql, 'ROLLBACK');
  pool.failUpdate = true;
  await assert.rejects(store.transact(state => { state.profile.brandName = 'Unavailable'; }), error => {
    assert.doesNotMatch(error.message, /secret connection URL/);
    return error.code === 'storage_unavailable';
  });
  assert.equal(pool.state.profile.brandName, 'Before');
  assert.equal(pool.queries.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.released, 3);
});

test('schema setup is explicit and database failure never falls back to local data', async () => {
  const queries = [];
  await setupWorkspaceSchema({ pool: { async query(sql) { queries.push(sql); } } });
  assert.deepEqual(queries, [WORKSPACE_SCHEMA_SQL]);
  assert.match(WORKSPACE_SCHEMA_SQL, /CHECK \(id = 'founder'\)/);
  const pool = { async connect() { throw new Error('private database address'); }, async end() {} };
  const service = createWorkspaceService({ env: { NODE_ENV: 'production', WE_COMMERCE_AUTH_TOKEN: 'test-binding' }, store: new PostgresWorkspaceStore({ pool }), connectorStatus: () => ({}) });
  await assert.rejects(service.workspace(), error => error.code === 'storage_unavailable' && !error.message.includes('private database address'));
});
