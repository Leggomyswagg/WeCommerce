export function stripeHealth() {
  return {
    configured: Boolean(process.env.STRIPE_SECRET_KEY),
    connector: 'stripe'
  };
}
