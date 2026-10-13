import { shopifyHealth } from '../../../packages/connectors/shopify/index.js';
import { stripeHealth } from '../../../packages/connectors/stripe/index.js';

function sendJson(req, res, body) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  res.statusCode = 200;
  res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
}

export function healthHandler(req, res) {
  sendJson(req, res, {
    ok: true,
    service: 'api',
    connectors: { shopify: shopifyHealth(), stripe: stripeHealth() }
  });
}

export function planHandler(req, res) {
  sendJson(req, res, {
    steps: [
      'Pick niche and hero product',
      'Connect Stripe keys',
      'Import supplier products',
      'Generate landing pages and ad assets'
    ]
  });
}

export function indexHandler(req, res) {
  sendJson(req, res, {
    service: 'we-commerce-api',
    ok: true,
    endpoints: ['/api/health', '/api/onboarding/plan']
  });
}

export function routeApi(req, res) {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const handler = {
    '/api': indexHandler,
    '/api/health': healthHandler,
    '/health': healthHandler,
    '/api/onboarding/plan': planHandler,
    '/onboarding/plan': planHandler
  }[pathname];
  if (!handler) return false;
  handler(req, res);
  return true;
}
