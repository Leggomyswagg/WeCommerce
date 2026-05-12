import http from 'node:http';

const port = process.env.PORT || 3000;

const html = `<!doctype html>
<html><head><title>HybridMentorOps</title></head>
<body>
<h1>HybridMentorOps Founder Dashboard</h1>
<p>Web scaffold is running.</p>
<ul>
<li>/health</li>
<li>/export</li>
</ul>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'web' }));
    return;
  }
  if (req.url === '/export') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      actions: ['download_zip', 'push_to_github', 'deploy_now'],
      artifacts: ['source_code', 'assets', 'env_template', 'deployment_guide']
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});

server.listen(port, () => console.log(`web listening on :${port}`));
