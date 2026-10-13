import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const name of ['api', 'web']) {
  test(`Vercel ${name} root builds the dashboard and exposes functional API handlers`, async () => {
    const root = new URL('../', import.meta.url);
    const app = new URL(`apps/${name}/`, root);
    const result = spawnSync(process.execPath, [new URL('../scripts/build-vercel-app.mjs', import.meta.url).pathname, name], { cwd: app, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(new URL('public/index.html', app), 'utf8'), readFileSync(new URL('public/index.html', root), 'utf8'));
    const config = JSON.parse(readFileSync(new URL('vercel.json', app), 'utf8'));
    assert.equal(config.outputDirectory, 'public');
    for (const [file, field] of [['api/index.js', 'endpoints'], ['api/health.js', 'connectors'], ['api/onboarding/plan.js', 'steps']]) {
      const { default: handler } = await import(new URL(file, app));
      let body;
      const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
      handler({ method: 'GET' }, res);
      assert.equal(res.statusCode, 200);
      assert.ok(body[field]);
    }
  });
}
