import { shopifyHealth } from '@hmo/shopify-connector';
import { stripeHealth } from '@hmo/stripe-connector';

export default function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.status(200).json({
    ok: true,
    service: 'api',
    connectors: {
      shopify: shopifyHealth(),
      stripe: stripeHealth()
    }
  });
}
