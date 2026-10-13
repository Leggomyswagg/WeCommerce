import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { once } from 'node:events';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createApiServer } from '../apps/api/src/server.js';
import { createWebServer } from '../apps/web/src/server.js';
import healthHandler from '../api/health.js';
import planHandler from '../api/onboarding/plan.js';

async function call(server, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

for (const [name, create] of [['api', createApiServer], ['web', createWebServer]]) {
  test(`${name} serves the dashboard's API routes as JSON`, async t => {
    const server = create().listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    for (const path of ['/api/health', '/api/health?refresh=1']) {
      const response = await call(server, path);
      assert.equal(response.status, 200);
      assert.match(response.headers['content-type'], /application\/json/);
      assert.equal(JSON.parse(response.body).service, 'api');
      assert.equal(typeof JSON.parse(response.body).connectors.shopify.configured, 'boolean');
    }
    for (const path of ['/api/onboarding/plan', '/onboarding/plan']) {
      const response = await call(server, path);
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(response.body).steps.length, 4);
    }
    const post = await call(server, '/api/health', 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
    assert.equal((await call(server, '/api/health', 'HEAD')).body, '');
    assert.equal((await call(server, '/api/missing')).status, 404);
    if (name === 'web') assert.match((await call(server, '/')).body, /WeCommerce/);
  });
}

test('Vercel discovers runnable handlers at root api paths', () => {
  for (const [handler, field] of [[healthHandler, 'connectors'], [planHandler, 'steps']]) {
    let body;
    const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
    handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(body[field]);
  }
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.ok(config.rewrites.some(rule => rule.destination === '/api/onboarding/plan'));
});

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const healthScript = html.slice(html.indexOf('async function checkHealth()'), html.indexOf('  loadOnboarding();'));
for (const configured of [false, true]) {
  test(`health panel reports configured=${configured} without claiming verified connections`, async () => {
    const elements = { 'health-grid': {}, 'overall-status': { style: {} } };
    const context = {
      document: { getElementById: id => elements[id] },
      fetch: async () => ({ ok: true, json: async () => ({ ok: true, connectors: {
        shopify: { configured }, stripe: { configured }
      } }) })
    };
    await runInNewContext(healthScript + '\ncheckHealth();', context);
    assert.match(elements['health-grid'].innerHTML, configured ? /Configured/ : /Awaiting config/);
    assert.match(elements['overall-status'].textContent, configured ? /integrations configured/ : /need configuration/);
    assert.doesNotMatch(elements['overall-status'].textContent, /All systems operational/);
  });
}
