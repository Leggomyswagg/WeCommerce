import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { createApiServer } from '../apps/api/src/server.js';
import { createWebServer } from '../apps/web/src/server.js';
import { createWorkspaceService } from '../apps/api/src/workspace-service.js';
import { FileWorkspaceStore, createConfiguredWorkspaceStore } from '../apps/api/src/workspace-storage.js';
import { taskPayloadHash } from '../apps/api/src/workspace-state.js';
import { createTaskWorker } from '../workers/index.js';
import { connectorStatus, runConnectorTask } from '../packages/connectors/registry.js';

const TOKEN = 'provider-free-test-founder-binding';
const PROFILE = { brandName: 'Example Goods', niche: 'Home & Kitchen', targetCountry: 'US', currency: 'USD', goal: 'Validate one product before launch.' };
const STATUS = () => ({ shopify: { configured: false, mode: 'provider_read', label: 'Shopify', capabilities: ['connector_sync'], limitation: 'Read only.' } });
const execFileAsync = promisify(execFile);

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wecommerce-workspace-'));
  const env = { WE_COMMERCE_AUTH_TOKEN: TOKEN, WE_COMMERCE_DATA_DIR: directory };
  const store = new FileWorkspaceStore({ directory });
  const service = createWorkspaceService({ env, store, connectorStatus: STATUS, ...options });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, env, store, service };
}

async function serverFor(t, service, env, create = createApiServer) {
  const server = create({ workspaceService: service, env }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function call(origin, { action, raw, token = TOKEN, method = action || raw !== undefined ? 'POST' : 'GET', headers = {} } = {}) {
  const response = await fetch(`${origin}/api/workspace`, {
    method,
    headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(action) } : {})
  });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text };
}

async function propose(service, kind = 'connector_sync', provider, params = {}) {
  provider ??= kind === 'onboarding_plan' ? null : 'shopify';
  await service.mutate({ action: 'save_profile', profile: PROFILE });
  const workspace = await service.mutate({ action: 'create_task', kind, provider, params });
  return workspace.tasks.at(-1);
}

async function approve(service, task) {
  return service.mutate({ action: 'approve_task', taskId: task.id });
}

function code(expected) { return error => error.code === expected; }

test('private workspace rejects missing, wrong, and absent server bindings without creating storage', async t => {
  const { service, env, directory } = await fixture(t);
  const origin = await serverFor(t, service, env);
  for (const token of [null, 'wrong-token']) {
    const response = await call(origin, { token });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'unauthorized');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    assert.doesNotMatch(response.text, /Example Goods/);
  }
  await assert.rejects(stat(join(directory, 'workspace.json')), error => error.code === 'ENOENT');
  const unbound = await serverFor(t, service, {});
  const response = await call(unbound);
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'authentication_unavailable');
});

for (const [name, create] of [['api', createApiServer], ['web', createWebServer]]) {
  test(`${name} serves authenticated workspace actions and preserves persisted founder intake`, async t => {
    const { service, env, directory } = await fixture(t);
    const origin = await serverFor(t, service, env, create);
    assert.equal((await call(origin)).body.profile, null);
    const saved = await call(origin, { action: { action: 'save_profile', profile: PROFILE } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.profile, PROFILE);
    assert.equal(saved.body.storage.type, 'file');
    assert.equal(saved.body.storage.productionReady, false);
    assert.equal((await call(origin, { method: 'HEAD' })).text, '');
    const second = createWorkspaceService({ env, store: new FileWorkspaceStore({ directory }), connectorStatus: STATUS });
    assert.deepEqual((await second.workspace()).profile, PROFILE);
    assert.equal((await stat(join(directory, 'workspace.json'))).mode & 0o777, 0o600);
  });
}

test('bounded JSON, supported actions, profile shape, and browser credentials are validated', async t => {
  const { service, env } = await fixture(t);
  const origin = await serverFor(t, service, env);
  for (const raw of ['{bad', '[]', 'null']) assert.equal((await call(origin, { raw })).status, 400);
  assert.equal((await call(origin, { raw: 'x'.repeat(17000) })).status, 413);
  assert.equal((await call(origin, { action: { action: 'save_profile', profile: PROFILE }, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(origin, { method: 'DELETE' })).status, 405);
  assert.equal((await call(origin, { action: { action: 'unknown' } })).status, 400);
  assert.equal((await call(origin, { action: { action: 'save_profile', profile: { ...PROFILE, email: 'no@example.invalid' } } })).status, 400);
  await propose(service);
  for (const params of [{ accessToken: 'browser-secret' }, { limit: 51 }, { limit: 1.2 }, { query: 'not-supported-for-shopify' }]) {
    const response = await call(origin, { action: { action: 'create_task', kind: 'connector_sync', provider: 'shopify', params } });
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.text, /browser-secret/);
  }
  const result = await call(origin, { action: { action: 'create_task', kind: 'supplier_reference', provider: 'direct', params: { url: 'https://supplier.example/product?api_key=browser-secret' } } });
  assert.equal(result.status, 400);
  assert.equal((await service.workspace()).tasks.length, 1);
});

test('HTTP Explain/Approve/Execute reaches the real read adapter with an injected provider transport', async t => {
  const { store, env } = await fixture(t);
  let providerReads = 0;
  const configuredEnv = { ...env, SHOPIFY_STORE_DOMAIN: 'fixture.myshopify.com', SHOPIFY_ACCESS_TOKEN: 'fixture-provider-binding' };
  const service = createWorkspaceService({
    store, env: configuredEnv, connectorStatus, runConnectorTask,
    fetchImpl: async (url, options) => {
      providerReads += 1;
      assert.match(String(url), /^https:\/\/fixture\.myshopify\.com\/admin\/api\//);
      assert.match(JSON.parse(options.body).query, /^query WeCommerceCatalog/);
      assert.doesNotMatch(JSON.parse(options.body).query, /mutation/i);
      return new Response(JSON.stringify({ data: { shop: { name: 'Fixture Shop' }, products: {
        nodes: [{ id: 'gid://shopify/Product/1', title: 'Fixture Product', handle: 'fixture', status: 'ACTIVE', variants: {
          nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'Default', sku: 'FIXTURE', price: '25.00', inventoryQuantity: 4 }], pageInfo: { hasNextPage: false }
        } }], pageInfo: { hasNextPage: false, endCursor: null }
      } } }), { status: 200 });
    }
  });
  const origin = await serverFor(t, service, configuredEnv);
  assert.equal((await call(origin)).body.connectors.shopify.configured, true);
  assert.equal(providerReads, 0);
  await call(origin, { action: { action: 'save_profile', profile: PROFILE } });
  const proposed = await call(origin, { action: { action: 'create_task', kind: 'connector_sync', provider: 'shopify', params: { limit: 1 } } });
  const task = proposed.body.tasks[0];
  assert.equal(task.status, 'proposed');
  assert.equal((await call(origin, { action: { action: 'execute_task', taskId: task.id } })).status, 409);
  await call(origin, { action: { action: 'approve_task', taskId: task.id } });
  assert.equal((await call(origin, { action: { action: 'execute_task', taskId: task.id, params: { limit: 2 } } })).status, 400);
  const completed = await call(origin, { action: { action: 'execute_task', taskId: task.id } });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.tasks[0].status, 'succeeded');
  assert.equal(completed.body.tasks[0].result.mode, 'provider_read');
  assert.equal(completed.body.tasks[0].result.data.products[0].title, 'Fixture Product');
  const repeated = await call(origin, { action: { action: 'execute_task', taskId: task.id } });
  assert.deepEqual(repeated.body.tasks[0], completed.body.tasks[0]);
  assert.equal(providerReads, 1);
  assert.doesNotMatch(completed.text, /fixture-provider-binding/);
});

test('real adapter blocks unconfigured provider reads and prepares references without network access', async t => {
  const { store, env } = await fixture(t);
  const service = createWorkspaceService({ store, env, connectorStatus, runConnectorTask, fetchImpl: async () => { throw new Error('No network should be used'); } });
  const read = await propose(service);
  await approve(service, read);
  assert.equal((await service.mutate({ action: 'execute_task', taskId: read.id })).tasks[0].result.code, 'not_configured');
  const reference = await propose(service, 'supplier_reference', 'alibaba', { url: 'https://www.alibaba.com/product-detail/fixture.html', notes: 'Check a sample.\nConfirm fulfillment terms.' });
  await approve(service, reference);
  const completed = await service.mutate({ action: 'execute_task', taskId: reference.id });
  assert.equal(completed.tasks[1].status, 'succeeded');
  assert.equal(completed.tasks[1].result.mode, 'reference_preparation');
  assert.equal(completed.tasks[1].result.data.verification, 'unverified');
  assert.equal(completed.tasks[1].result.data.fulfillment, 'not_connected');
});

test('niche margins use supplied estimates, handle losses and decimals, and preserve evidence gaps', async t => {
  const { service } = await fixture(t);
  const response = await service.mutate({ action: 'score_niches', observations: [
    { niche: 'Positive', retailPrice: 100, productCost: 30, shippingCost: 10, fees: 5, acquisitionCost: 15 },
    { niche: 'Loss', retailPrice: 10.1, productCost: 5.05, shippingCost: 3.05, fees: 2, acquisitionCost: 1 },
    { niche: 'Incomplete', retailPrice: 30, productCost: 10 }
  ] });
  assert.equal(response.scores[0].contributionMargin, 40);
  assert.equal(response.scores[0].marginPercent, 40);
  assert.equal(response.scores[1].contributionMargin, -1);
  assert.equal(response.scores[2].totalCosts, null);
  assert.equal(response.scores[2].contributionMargin, null);
  assert.deepEqual(response.scores[2].missingInputs, ['shippingCost', 'fees', 'acquisitionCost']);
  assert.deepEqual(response.scores[0].missingEvidence, ['demand', 'supplier_reliability']);
  assert.deepEqual((await service.workspace()).niches, response.scores);
  for (const retailPrice of [0, -1, 3.333, Infinity]) {
    await assert.rejects(service.mutate({ action: 'score_niches', observations: [{ niche: 'Invalid', retailPrice }] }), code('invalid_request'));
  }
});

test('a proposed task cannot execute, approval binds its frozen profile, and terminal execution is idempotent', async t => {
  const { service } = await fixture(t);
  const task = await propose(service, 'onboarding_plan', undefined);
  await assert.rejects(service.mutate({ action: 'execute_task', taskId: task.id }), code('task_not_approved'));
  assert.equal(task.explanation.requiresApproval, true);
  assert.equal(task.payloadHash.length, 64);
  await approve(service, task);
  const approvedAt = (await approve(service, task)).tasks[0].approvedAt;
  await service.mutate({ action: 'save_profile', profile: { ...PROFILE, brandName: 'Changed Brand' } });
  const completed = await service.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(completed.tasks[0].status, 'succeeded');
  assert.equal(completed.tasks[0].result.mode, 'local_guidance');
  assert.equal(completed.tasks[0].result.data.profile.brandName, PROFILE.brandName);
  assert.equal(completed.tasks[0].approvedAt, approvedAt);
  assert.deepEqual((await service.mutate({ action: 'execute_task', taskId: task.id })).tasks[0], completed.tasks[0]);
  await assert.rejects(approve(service, task), code('task_not_proposed'));
});

test('approval digest survives database JSON key ordering and detects stored payload changes', async t => {
  const { service, store } = await fixture(t, { runConnectorTask: async () => { throw new Error('Must not run'); } });
  const task = await propose(service, 'connector_sync', 'cj', { limit: 10, page: 2, query: 'sample' });
  const reordered = { ...task, params: { query: 'sample', page: 2, limit: 10 }, profileSnapshot: Object.fromEntries(Object.entries(PROFILE).reverse()) };
  assert.equal(taskPayloadHash(reordered), task.payloadHash);
  await approve(service, task);
  await store.transact(state => { state.tasks[0].params.limit = 11; });
  await assert.rejects(service.mutate({ action: 'execute_task', taskId: task.id }), code('approval_mismatch'));
});

test('concurrent services atomically claim an approved task once', async t => {
  let runs = 0;
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const runner = async () => {
    runs += 1; started();
    await new Promise(resolve => { release = resolve; });
    return { summary: 'Read the test catalogue.', mode: 'provider_read', data: { products: [], optional: undefined } };
  };
  const { service, env, directory } = await fixture(t, { runConnectorTask: runner });
  const second = createWorkspaceService({ env, store: new FileWorkspaceStore({ directory }), connectorStatus: STATUS, runConnectorTask: runner });
  const task = await propose(service);
  await approve(service, task);
  const first = service.mutate({ action: 'execute_task', taskId: task.id });
  await startedPromise;
  await assert.rejects(second.mutate({ action: 'execute_task', taskId: task.id }), code('task_running'));
  release();
  const completed = await first;
  assert.equal(runs, 1);
  assert.equal(completed.tasks[0].status, 'succeeded');
  await second.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(runs, 1);
  assert.equal(Object.hasOwn(completed.tasks[0], 'claimToken'), false);
  assert.equal(Object.hasOwn(completed.tasks[0], 'leaseExpiresAt'), false);
});

test('proposal idempotency keys bind the exact payload and survive restarts', async t => {
  const { service, env, directory } = await fixture(t);
  await service.mutate({ action: 'save_profile', profile: PROFILE });
  const proposal = { action: 'create_task', kind: 'connector_sync', provider: 'shopify', params: {} };
  await service.mutate(proposal, { idempotencyKey: '__proto__' });
  const second = createWorkspaceService({ env, store: new FileWorkspaceStore({ directory }), connectorStatus: STATUS });
  assert.equal((await second.mutate(proposal, { idempotencyKey: '__proto__' })).tasks.length, 1);
  await assert.rejects(second.mutate({ ...proposal, params: { limit: 2 } }, { idempotencyKey: '__proto__' }), code('idempotency_conflict'));
});

test('missing credentials are a persisted blocked outcome; provider error bodies and unsafe results stay private', async t => {
  let runs = 0;
  const { service } = await fixture(t, { runConnectorTask: async () => { runs += 1; throw Object.assign(new Error('private-provider-body accessToken=secret'), { code: 'not_configured' }); } });
  const task = await propose(service);
  await approve(service, task);
  const blocked = await service.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(blocked.tasks[0].status, 'blocked');
  assert.equal(blocked.tasks[0].result.code, 'not_configured');
  assert.doesNotMatch(JSON.stringify(blocked), /private-provider-body|accessToken=secret/);
  await service.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(runs, 1);
  const unsafe = createWorkspaceService({ env: { WE_COMMERCE_AUTH_TOKEN: TOKEN }, store: (await fixture(t)).store, connectorStatus: STATUS,
    runConnectorTask: async () => ({ summary: 'Read.', mode: 'provider_read', data: { accessToken: 'provider-secret' } }) });
  const unsafeTask = await propose(unsafe);
  await approve(unsafe, unsafeTask);
  const failed = await unsafe.mutate({ action: 'execute_task', taskId: unsafeTask.id });
  assert.equal(failed.tasks[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(failed), /provider-secret/);
});

test('stale and timed-out executions are uncertain and cannot replay or become late successes', async t => {
  let runs = 0;
  let release;
  const { service, store } = await fixture(t, { taskTimeoutMs: 20, runConnectorTask: () => {
    runs += 1;
    return new Promise(resolve => { release = resolve; });
  } });
  const task = await propose(service);
  await approve(service, task);
  const timedOut = await service.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(timedOut.tasks[0].status, 'blocked');
  assert.equal(timedOut.tasks[0].result.mode, 'uncertain');
  release({ summary: 'Late result.', mode: 'provider_read', data: {} });
  await service.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(runs, 1);
  await store.transact(state => {
    state.tasks[0].status = 'running'; state.tasks[0].result = null;
    state.tasks[0].claimToken = 'abandoned-claim'; state.tasks[0].leaseExpiresAt = '2000-01-01T00:00:00.000Z';
  });
  const stale = await service.workspace();
  assert.equal(stale.tasks[0].result.code, 'reconciliation_required');
  assert.equal(stale.tasks[0].status, 'blocked');
  await service.mutate({ action: 'execute_task', taskId: task.id });
  assert.equal(runs, 1);
});

test('lesson prerequisites validate exercises, persist completion, and unlock only local ad drafts', async t => {
  const { service } = await fixture(t);
  const initial = await service.workspace();
  assert.equal(initial.curriculum.lessons[0].status, 'locked');
  await service.mutate({ action: 'save_profile', profile: PROFILE });
  await assert.rejects(service.mutate({ action: 'complete_lesson', lessonId: 'supplier_checks', exercise: { evidenceNeeded: ['demand', 'supplier_reliability'] } }), code('lesson_locked'));
  const draft = { action: 'create_task', kind: 'ad_draft', provider: 'google_ads', params: { headline: 'Example', description: 'Review this draft.\nNo publication.', destinationUrl: 'https://store.example/product', budgetDaily: 10, currency: 'USD' } };
  await assert.rejects(service.mutate(draft), code('control_locked'));
  await assert.rejects(service.mutate({ action: 'complete_lesson', lessonId: 'margin_basics', exercise: { retailPrice: 100, totalCosts: 70, margin: 40 } }), code('invalid_request'));
  await service.mutate({ action: 'complete_lesson', lessonId: 'margin_basics', exercise: { retailPrice: 100, totalCosts: 70, margin: 30 } });
  await service.mutate({ action: 'complete_lesson', lessonId: 'supplier_checks', exercise: { evidenceNeeded: ['supplier_reliability', 'demand'] } });
  const completed = await service.mutate({ action: 'complete_lesson', lessonId: 'approval_safety', exercise: { acknowledgement: 'approve_exact_payload' } });
  assert.equal(completed.curriculum.completedCount, 3);
  assert.ok(completed.curriculum.unlockedControls.includes('ad_draft'));
  assert.match(completed.curriculum.lessons[2].completionOutcome, /does not establish professional proficiency/);
  const repeated = await service.mutate({ action: 'complete_lesson', lessonId: 'approval_safety' });
  assert.deepEqual(repeated.curriculum, completed.curriculum);
  assert.equal((await service.mutate(draft)).tasks[0].status, 'proposed');
});

test('worker drains only approved tasks through the shared atomic execution path', async t => {
  let runs = 0;
  const { service } = await fixture(t, { runConnectorTask: async () => { runs += 1; return { summary: 'Prepared an unverified reference.', mode: 'reference_preparation', data: { verification: 'unverified' } }; } });
  const proposed = await propose(service);
  const approved = await propose(service, 'supplier_reference', 'alibaba', { url: 'https://www.alibaba.com/product-detail/example.html' });
  await approve(service, approved);
  const outcomes = [];
  const worker = createTaskWorker({ service, onOutcome: value => outcomes.push(value) });
  assert.equal(await worker.drainOnce(), 1);
  assert.equal(await worker.drainOnce(), 0);
  assert.equal(runs, 1);
  assert.equal(outcomes[0].mode, 'reference_preparation');
  const workspace = await service.workspace();
  assert.equal(workspace.tasks.find(task => task.id === proposed.id).status, 'proposed');
  assert.equal(workspace.tasks.find(task => task.id === approved.id).status, 'succeeded');
});

test('concurrent worker processes execute approved local guidance only once and store its real result', async t => {
  const { service, directory, env } = await fixture(t);
  const task = await propose(service, 'onboarding_plan', undefined);
  await approve(service, task);
  const executions = await Promise.all([1, 2].map(() => execFileAsync(process.execPath, [new URL('../workers/index.js', import.meta.url).pathname, '--once'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, ...env, NODE_ENV: 'development', VERCEL: '', AWS_LAMBDA_FUNCTION_NAME: '', AWS_EXECUTION_ENV: '', DATABASE_URL: '' }, timeout: 5000
  })));
  const processed = executions.map(execution => Number(/Approved queue processed: (\d+) task/.exec(execution.stdout)?.[1]));
  assert.equal(processed.reduce((sum, count) => sum + count, 0), 1);
  assert.doesNotMatch(executions.map(execution => execution.stdout + execution.stderr).join(''), /Example Goods|provider-free-test-founder-binding/);
  const persisted = JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8'));
  assert.equal(persisted.tasks[0].status, 'succeeded');
  assert.equal(persisted.tasks[0].result.mode, 'local_guidance');
  assert.equal(persisted.tasks[0].result.data.profile.brandName, PROFILE.brandName);
});

test('production and serverless refuse local or memory storage even when a local path is configured', async t => {
  const { directory, store } = await fixture(t);
  for (const runtime of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { AWS_LAMBDA_FUNCTION_NAME: 'example' }]) {
    const env = { ...runtime, WE_COMMERCE_AUTH_TOKEN: TOKEN, WE_COMMERCE_DATA_DIR: directory };
    await assert.rejects(createConfiguredWorkspaceStore(env), code('storage_unavailable'));
    const service = createWorkspaceService({ env, store, connectorStatus: STATUS });
    await assert.rejects(service.workspace(), code('storage_unavailable'));
  }
});

test('corrupt persisted state fails closed instead of replacing founder data', async t => {
  const { directory, service } = await fixture(t);
  await writeFile(join(directory, 'workspace.json'), '{broken', { mode: 0o600 });
  await assert.rejects(service.workspace(), code('storage_unavailable'));
  assert.equal(await readFile(join(directory, 'workspace.json'), 'utf8'), '{broken');
});

test('every Vercel deployment root exposes the private workspace handler with fail-closed authentication', async () => {
  for (const path of ['../api/workspace.js', '../apps/api/api/workspace.js', '../apps/web/api/workspace.js']) {
    const { default: handler } = await import(new URL(path, import.meta.url));
    const headers = {};
    let body;
    const res = { setHeader(name, value) { headers[name] = value; }, end(value) { body = JSON.parse(value); } };
    await handler({ method: 'GET', headers: {} }, res);
    assert.ok([401, 503].includes(res.statusCode));
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(Object.hasOwn(body, 'tasks'), false);
  }
});
