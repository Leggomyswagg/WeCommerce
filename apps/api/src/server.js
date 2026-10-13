import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { routeApi } from './router.js';

export function createApiServer() {
  return http.createServer((req, res) => {
    if (routeApi(req, res)) return;
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.API_PORT || 4000;
  createApiServer().listen(port, () => console.log(`api listening on :${port}`));
}
