import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorStatus, runConnectorTask } from '../packages/connectors/registry.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const sync = (provider, params = {}) => ({ kind: 'connector_sync', provider, params });
const neverFetch = () => { throw new Error('A local operation must not call a provider'); };

test('missing account configuration fails before any provider call, without pretending verification', async () => {
  const status = connectorStatus({});
  for (const provider of ['shopify', 'woocommerce', 'cj', 'google_ads', 'meta_ads', 'tiktok_ads']) {
    assert.equal(status[provider].configured, false);
    await assert.rejects(runConnectorTask(sync(provider), { env: {}, fetchImpl: neverFetch }), error => error.code === 'not_configured');
  }
  assert.equal(status.alibaba.configured, false);
  assert.equal(status.alibaba.mode, 'reference_preparation');
});

test('Shopify reads a bounded page, retains partial variants, and keeps its token server-side', async () => {
  const token = 'test-private-shopify-token';
  const result = await runConnectorTask(sync('shopify', { limit: 2 }), {
    env: { SHOPIFY_STORE_DOMAIN: 'fixture.myshopify.com', SHOPIFY_ACCESS_TOKEN: token },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://fixture.myshopify.com/admin/api/2026-10/graphql.json');
      assert.equal(options.headers['X-Shopify-Access-Token'], token);
      const body = JSON.parse(options.body);
      assert.equal(body.variables.first, 2);
      assert.ok(body.query.includes('variants(first: 10)'));
      assert.ok(!body.query.includes('mutation'));
      return json({ data: { shop: { name: 'Fixture shop' }, products: {
        nodes: [{ id: 'gid://shopify/Product/1', title: 'Ring', handle: 'ring', status: 'DRAFT', variants: {
          nodes: [{ id: 'gid://shopify/ProductVariant/1', title: 'US 7', sku: 'R7', price: '19.00', inventoryQuantity: 3 }], pageInfo: { hasNextPage: true } } }],
        pageInfo: { hasNextPage: true, endCursor: 'next-page' } } } });
    },
  });
  assert.equal(result.mode, 'provider_read');
  assert.equal(result.data.products[0].variantsPartial, true);
  assert.equal(result.data.partial, true);
  assert.ok(!JSON.stringify(result).includes(token));
});

test('Shopify rejects wrong domains, oversized limits, invalid page semantics and provider errors', async () => {
  const env = { SHOPIFY_STORE_DOMAIN: 'fixture.myshopify.com', SHOPIFY_ACCESS_TOKEN: 'private' };
  for (const task of [sync('shopify', { limit: 1000 }), sync('shopify', { page: 2 })]) {
    await assert.rejects(runConnectorTask(task, { env, fetchImpl: neverFetch }), e => e.code === 'invalid_request');
  }
  await assert.rejects(runConnectorTask(sync('shopify'), { env: { ...env, SHOPIFY_STORE_DOMAIN: 'unrelated.example' }, fetchImpl: neverFetch }), e => e.code === 'invalid_request');
  await assert.rejects(runConnectorTask(sync('shopify'), { env, fetchImpl: async () => json({ errors: [{ message: 'private secret detail' }] }) }), e => e.code === 'provider_unavailable' && !e.message.includes('private secret'));
});

test('WooCommerce authenticates the server request and reports a catalogue page without writes', async () => {
  const result = await runConnectorTask(sync('woocommerce', { page: 2, limit: 1 }), {
    env: { WOOCOMMERCE_STORE_URL: 'https://store.example', WOOCOMMERCE_CONSUMER_KEY: 'ck_private', WOOCOMMERCE_CONSUMER_SECRET: 'cs_private' },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, '/wp-json/wc/v3/products');
      assert.equal(new URL(url).searchParams.get('page'), '2');
      assert.ok(options.headers.Authorization.startsWith('Basic '));
      assert.equal(options.method, undefined);
      return json([{ id: 12, name: 'Ring', type: 'simple', price: '12.00', stock_status: 'instock', status: 'publish' }]);
    },
  });
  assert.equal(result.data.page, 2);
  assert.equal(result.data.products[0].id, '12');
  assert.ok(!JSON.stringify(result).includes('cs_private'));
});

test('CJ V2 response matches the documented content/productList envelope, without claiming fulfillment', async () => {
  const result = await runConnectorTask(sync('cj', { query: 'NFC ring', limit: 5 }), {
    env: { CJ_ACCESS_TOKEN: 'cj-private' },
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).pathname, '/api2.0/v1/product/listV2');
      assert.equal(new URL(url).searchParams.get('keyWord'), 'NFC ring');
      assert.equal(options.headers['CJ-Access-Token'], 'cj-private');
      return json({ code: 200, result: true, data: { content: [{ productList: [{ id: 'ring-1', nameEn: 'NFC ring', sku: 'R7', sellPrice: '8.00' }] }] } });
    },
  });
  assert.equal(result.data.verification, 'catalogue_only');
  assert.equal(result.data.products[0].supplierReportedPrice, '8.00');
  assert.ok(result.summary.includes('unverified'));
  const detail = await runConnectorTask(sync('cj', { productId: 'ring-1' }), {
    env: { CJ_ACCESS_TOKEN: 'private' }, fetchImpl: async url => {
      assert.equal(new URL(url).pathname, '/api2.0/v1/product/query');
      assert.equal(new URL(url).searchParams.get('pid'), 'ring-1');
      return json({ code: 200, result: true, data: { pid: 'ring-1', productNameEn: 'NFC ring', productSku: 'R7' } });
    },
  });
  assert.equal(detail.data.products[0].id, 'ring-1');
  await assert.rejects(runConnectorTask(sync('cj', { productId: 'ring-1' }), { env: { CJ_ACCESS_TOKEN: 'private' }, fetchImpl: async () => json({ code: 200, result: true, data: { pid: 'wrong', productNameEn: 'Wrong ring' } }) }), e => e.code === 'provider_unavailable');
  await assert.rejects(runConnectorTask(sync('cj'), { env: { CJ_ACCESS_TOKEN: 'private' }, fetchImpl: async () => json({ code: 200, result: true, data: { list: [] } }) }), e => e.code === 'provider_unavailable');
});

test('advertiser reads use configured account IDs and versions, return campaign fields, and never publish', async () => {
  const cases = [
    ['google_ads', { GOOGLE_ADS_ACCESS_TOKEN: 'g-secret', GOOGLE_ADS_DEVELOPER_TOKEN: 'd-secret', GOOGLE_ADS_CUSTOMER_ID: '1234567890', GOOGLE_ADS_API_VERSION: 'v22' }, { results: [{ campaign: { id: '1', name: 'Ring', status: 'PAUSED' } }] }],
    ['meta_ads', { META_ADS_ACCESS_TOKEN: 'm-secret', META_AD_ACCOUNT_ID: 'act_123456789', META_GRAPH_API_VERSION: 'v25.0' }, { data: [{ id: '2', name: 'Ring', status: 'PAUSED' }] }],
    ['tiktok_ads', { TIKTOK_ADS_ACCESS_TOKEN: 't-secret', TIKTOK_ADVERTISER_ID: '123456789' }, { code: 0, data: { list: [{ campaign_id: '3', campaign_name: 'Ring', operation_status: 'DISABLE' }] } }],
  ];
  for (const [provider, env, fixture] of cases) {
    const result = await runConnectorTask(sync(provider, { limit: 2 }), { env, fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.ok(!String(url).includes('secret'));
      if (provider === 'google_ads') { assert.ok(String(url).endsWith('/googleAds:search')); assert.ok(JSON.parse(options.body).query.startsWith('SELECT ')); }
      else assert.equal(options.method, undefined);
      return json(fixture);
    } });
    assert.equal(result.mode, 'provider_read');
    assert.equal(result.data.campaigns.length, 1);
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
});

test('provider failures are sanitized and malformed or oversized bodies cannot become success', async () => {
  const env = { WOOCOMMERCE_STORE_URL: 'https://store.example', WOOCOMMERCE_CONSUMER_KEY: 'ck', WOOCOMMERCE_CONSUMER_SECRET: 'cs' };
  for (const response of [new Response('credential leak', { status: 401 }), json({ error: 'credential leak' }), json([{ id: 1 }]), new Response('x'.repeat(2 * 1024 * 1024 + 1))]) {
    await assert.rejects(runConnectorTask(sync('woocommerce'), { env, fetchImpl: async () => response }), e => e.code === 'provider_unavailable' && !e.message.includes('credential leak'));
  }
});

test('supplier references enforce platform hosts and stay explicitly unverified without network calls', async () => {
  const result = await runConnectorTask({ kind: 'supplier_reference', provider: 'alibaba', params: { url: 'https://www.alibaba.com/product-detail/ring_123.html', title: 'Sample ring' } }, { env: {}, fetchImpl: neverFetch });
  assert.equal(result.mode, 'reference_preparation');
  assert.equal(result.data.verification, 'unverified');
  assert.equal(result.data.fulfillment, 'not_connected');
  for (const url of ['https://alibaba.com.evil.example/ring', 'https://user:pass@alibaba.com/ring', 'http://alibaba.com/ring', 'https://www.alibaba.com/ring?access_token=private']) {
    await assert.rejects(runConnectorTask({ kind: 'supplier_reference', provider: 'alibaba', params: { url } }, { fetchImpl: neverFetch }), e => e.code === 'invalid_request');
  }
  const temu = await runConnectorTask({ kind: 'supplier_reference', provider: 'temu', params: { url: 'https://www.temu.com/ring.html' } }, { fetchImpl: neverFetch });
  assert.ok(temu.data.restriction.includes('explicit commercial'));
});

test('campaign briefs and onboarding plans are local results, with no paid or provider execution', async () => {
  const task = { kind: 'ad_draft', provider: 'meta_ads', params: { headline: 'NFC sharing', description: 'Share a URL with a compatible phone.', destinationUrl: 'https://axonring.com/', budgetDaily: 10, currency: 'USD' } };
  const draft = await runConnectorTask(task, { env: {}, fetchImpl: neverFetch });
  assert.equal(draft.mode, 'local_draft'); assert.equal(draft.data.publication, 'not_published');
  await assert.rejects(runConnectorTask({ ...task, params: { ...task.params, budgetDaily: -1 } }), e => e.code === 'invalid_request');
  const guidance = await runConnectorTask({ kind: 'onboarding_plan', params: {}, profileSnapshot: { brandName: 'AxonRing', niche: 'Tech Accessories' } }, { fetchImpl: neverFetch });
  assert.equal(guidance.mode, 'local_guidance'); assert.equal(guidance.data.steps.length, 6);
  await assert.rejects(runConnectorTask({ kind: 'connector_sync', provider: 'alibaba', params: {} }, { fetchImpl: neverFetch }), e => e.code === 'unsupported_operation');
});
