import http from 'node:http';
import { shopifyHealth } from '@hmo/shopify-connector';
import { stripeHealth } from '@hmo/stripe-connector';

const port = process.env.API_PORT || 4000;

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    const health = {
      ok: true,
      service: 'api',
      connectors: {
        shopify: shopifyHealth(),
        stripe: stripeHealth()
      }
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(health));
    return;
  }

  if (req.url === '/onboarding/plan') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      steps: [
        'Pick niche and hero product',
        'Connect Stripe keys',
        'Import supplier products',
        'Generate landing pages and ad assets'
      ]
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(port, () => console.log(`api listening on :${port}`));
