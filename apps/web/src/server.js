import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { routeApi } from '../../api/src/router.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const port  = process.env.PORT || 3000;

let dashboardHtml;
try {
  dashboardHtml = readFileSync(join(__dir, '../../../public/index.html'), 'utf8');
} catch {
  dashboardHtml = '<html><body><h1>WeCommerce</h1><p>Dashboard not found — run from repo root.</p></body></html>';
}

export function createWebServer() {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/onboarding/plan')) {
      if (routeApi(req, res)) return;
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'web' }));
      return;
    }
    if (req.url === '/export') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        actions:   ['download_zip', 'push_to_github', 'deploy_now'],
        artifacts: ['source_code', 'assets', 'env_template', 'deployment_guide']
      }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(dashboardHtml);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createWebServer().listen(port, () => console.log(`web listening on :${port}`));
}
