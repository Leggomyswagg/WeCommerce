export default function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.status(200).json({
    service: 'we-commerce-api',
    ok: true,
    endpoints: ['/health', '/onboarding/plan']
  });
}
