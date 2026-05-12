export function shopifyHealth() {
  return {
    configured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_ACCESS_TOKEN),
    connector: 'shopify'
  };
}
