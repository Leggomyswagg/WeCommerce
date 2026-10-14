import { ConnectorError, compactProducts, integer, providerJson, required, secureUrl, text } from './shared.js';

export const SHOPIFY_CATALOG_QUERY = `query WeCommerceCatalog($first: Int!) {
  shop { name }
  products(first: $first) {
    nodes { id title handle status variants(first: 10) {
      nodes { id title sku price inventoryQuantity }
      pageInfo { hasNextPage }
    } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const definitions = {
  shopify: { label: 'Shopify', keys: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'], capabilities: ['connector_sync'], limitation: 'Reads a bounded catalogue page. Requires Admin API product access; it does not create or publish products.' },
  woocommerce: { label: 'WooCommerce', keys: ['WOOCOMMERCE_STORE_URL', 'WOOCOMMERCE_CONSUMER_KEY', 'WOOCOMMERCE_CONSUMER_SECRET'], capabilities: ['connector_sync'], limitation: 'Reads catalogue pages with server-side REST credentials; it does not change the store.' },
  cj: { label: 'CJ Dropshipping', keys: ['CJ_ACCESS_TOKEN'], capabilities: ['connector_sync'], limitation: 'Reads supplier catalogue candidates. A catalogue result does not verify a store connection, ring size, stock, shipping price, settlement, or fulfillment.' },
  google_ads: { label: 'Google Ads', keys: ['GOOGLE_ADS_ACCESS_TOKEN', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID', 'GOOGLE_ADS_API_VERSION'], capabilities: ['connector_sync', 'ad_draft'], limitation: 'Reads campaigns or prepares a local brief. No campaign publication or ad spend.' },
  meta_ads: { label: 'Meta Ads', keys: ['META_ADS_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID', 'META_GRAPH_API_VERSION'], capabilities: ['connector_sync', 'ad_draft'], limitation: 'Reads campaigns with ads_read permission or prepares a local brief. No campaign publication or ad spend.' },
  tiktok_ads: { label: 'TikTok Ads', keys: ['TIKTOK_ADS_ACCESS_TOKEN', 'TIKTOK_ADVERTISER_ID'], capabilities: ['connector_sync', 'ad_draft'], limitation: 'Reads campaigns with advertiser access or prepares a local brief. No campaign publication or ad spend.' },
  alibaba: { label: 'Alibaba supplier reference', hosts: ['alibaba.com'], capabilities: ['supplier_reference'] },
  made_in_china: { label: 'Made-in-China supplier reference', hosts: ['made-in-china.com'], capabilities: ['supplier_reference'] },
  '1688': { label: '1688 supplier reference', hosts: ['1688.com'], capabilities: ['supplier_reference'] },
  temu: { label: 'Temu reference only', hosts: ['temu.com'], capabilities: ['supplier_reference'] },
  zendrop: { label: 'Zendrop sourcing reference', hosts: ['zendrop.com'], capabilities: ['supplier_reference'] },
  direct: { label: 'Direct supplier reference', hosts: null, capabilities: ['supplier_reference'] },
};

export function connectorStatus(env = process.env) {
  return Object.fromEntries(Object.entries(definitions).map(([id, entry]) => [id, {
    label: entry.label,
    configured: Boolean(entry.keys?.every(key => typeof env[key] === 'string' && env[key].trim())),
    mode: entry.keys ? 'provider_read' : 'reference_preparation',
    capabilities: entry.capabilities,
    limitation: entry.limitation || (id === 'temu'
      ? 'Reference preparation only. Ordinary Temu consumer terms restrict commercial/third-party use; this does not authorize reselling or customer fulfillment.'
      : 'Creates an unverified sourcing reference and quote questions. No authenticated marketplace API, supplier approval, order placement, or fulfillment integration.'),
  }]));
}

function result(summary, data, mode = 'provider_read') { return { summary, data, mode }; }

async function shopify(params, env, fetchImpl) {
  required(env, definitions.shopify.keys);
  const domain = env.SHOPIFY_STORE_DOMAIN.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) throw new ConnectorError('invalid_request');
  if (params.page !== undefined && params.page !== 1) throw new ConnectorError('invalid_request', 'Shopify reads the first bounded page; use the returned cursor in a future paginated integration.');
  const data = await providerJson(`https://${domain}/admin/api/2026-10/graphql.json`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN },
    body: JSON.stringify({ query: SHOPIFY_CATALOG_QUERY, variables: { first: integer(params.limit, 20) } }),
  }, fetchImpl);
  if (data.errors?.length || !data.data?.products?.pageInfo || typeof data.data.shop?.name !== 'string') throw new ConnectorError('provider_unavailable');
  const products = compactProducts(data.data.products.nodes, row => ({
    id: row.id, title: row.title, handle: row.handle, status: row.status,
    variants: row.variants?.nodes?.map(v => ({ id: v.id, title: v.title, sku: v.sku, price: v.price, inventoryQuantity: v.inventoryQuantity })),
    variantsPartial: row.variants?.pageInfo?.hasNextPage === true,
  }));
  return result(`Read ${products.length} Shopify products without changing the store.`, {
    storeName: data.data.shop.name, products, partial: data.data.products.pageInfo.hasNextPage === true,
    nextCursor: data.data.products.pageInfo.endCursor,
  });
}

async function woocommerce(params, env, fetchImpl) {
  required(env, definitions.woocommerce.keys);
  const origin = secureUrl(env.WOOCOMMERCE_STORE_URL).origin;
  const url = new URL('/wp-json/wc/v3/products', origin);
  url.searchParams.set('per_page', integer(params.limit, 20));
  url.searchParams.set('page', integer(params.page, 1, 20));
  const credentials = Buffer.from(`${env.WOOCOMMERCE_CONSUMER_KEY}:${env.WOOCOMMERCE_CONSUMER_SECRET}`).toString('base64');
  const rows = await providerJson(url, { headers: { Authorization: `Basic ${credentials}` } }, fetchImpl);
  const products = compactProducts(rows, row => ({ id: row.id, title: row.name, type: row.type,
    status: row.status, price: row.price, stockStatus: row.stock_status, variationIds: row.variations }));
  return result(`Read ${products.length} WooCommerce products without changing the store.`, { products, page: integer(params.page, 1, 20), partial: products.length === integer(params.limit, 20) });
}

async function cj(params, env, fetchImpl) {
  required(env, definitions.cj.keys);
  if (params.productId !== undefined) {
    if (typeof params.productId !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(params.productId)) throw new ConnectorError('invalid_request');
    const url = new URL('https://developers.cjdropshipping.com/api2.0/v1/product/query');
    url.searchParams.set('pid', params.productId);
    const response = await providerJson(url, { headers: { 'CJ-Access-Token': env.CJ_ACCESS_TOKEN } }, fetchImpl);
    if (response.code !== 200 || response.result !== true || response.data?.pid !== params.productId) throw new ConnectorError('provider_unavailable');
    const products = compactProducts([response.data], row => ({ id: row.pid, title: row.productNameEn,
      supplierReportedPrice: row.sellPrice, sku: row.productSku, image: row.bigImage }));
    return result('Read the exact CJ product candidate; size mapping and fulfillment remain unverified.', { products, verification: 'catalogue_only' });
  }
  const url = new URL('https://developers.cjdropshipping.com/api2.0/v1/product/listV2');
  url.searchParams.set('page', integer(params.page, 1, 20));
  url.searchParams.set('size', integer(params.limit, 20));
  if (params.query) url.searchParams.set('keyWord', text(params.query, 100));
  const data = await providerJson(url, { headers: { 'CJ-Access-Token': env.CJ_ACCESS_TOKEN } }, fetchImpl);
  if (data.code !== 200 || data.result !== true || !Array.isArray(data.data?.content)) throw new ConnectorError('provider_unavailable');
  const rows = data.data.content.flatMap(group => {
    if (!Array.isArray(group.productList)) throw new ConnectorError('provider_unavailable');
    return group.productList;
  });
  const products = compactProducts(rows, row => ({ id: row.id, title: row.nameEn,
    supplierReportedPrice: row.sellPrice, sku: row.sku, image: row.bigImage }));
  return result(`Read ${products.length} CJ catalogue candidates; supplier connection and landed costs remain unverified.`, { products, verification: 'catalogue_only', page: integer(params.page, 1, 20) });
}

async function ads(provider, params, env, fetchImpl) {
  required(env, definitions[provider].keys);
  const limit = integer(params.limit, 20);
  let rows;
  if (provider === 'google_ads') {
    if (!/^\d{6,20}$/.test(env.GOOGLE_ADS_CUSTOMER_ID) || !/^v\d{1,3}$/.test(env.GOOGLE_ADS_API_VERSION) ||
        (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID && !/^\d{6,20}$/.test(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID))) throw new ConnectorError('invalid_request');
    const headers = { Authorization: `Bearer ${env.GOOGLE_ADS_ACCESS_TOKEN}`, 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN, 'content-type': 'application/json' };
    if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers['login-customer-id'] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    const data = await providerJson(`https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`, {
      method: 'POST', headers, body: JSON.stringify({ query: `SELECT campaign.id, campaign.name, campaign.status FROM campaign ORDER BY campaign.id LIMIT ${limit}` }),
    }, fetchImpl);
    rows = compactProducts(data.results || [], row => ({ id: row.campaign?.id, title: row.campaign?.name, status: row.campaign?.status }));
  } else if (provider === 'meta_ads') {
    const account = env.META_AD_ACCOUNT_ID.replace(/^act_/, '');
    if (!/^\d{5,30}$/.test(account) || !/^v\d{1,3}\.\d+$/.test(env.META_GRAPH_API_VERSION)) throw new ConnectorError('invalid_request');
    const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/act_${account}/campaigns`);
    url.searchParams.set('fields', 'id,name,status'); url.searchParams.set('limit', limit);
    const data = await providerJson(url, { headers: { Authorization: `Bearer ${env.META_ADS_ACCESS_TOKEN}` } }, fetchImpl);
    rows = compactProducts(data.data, row => ({ id: row.id, title: row.name, status: row.status }));
  } else {
    if (!/^\d{5,30}$/.test(env.TIKTOK_ADVERTISER_ID)) throw new ConnectorError('invalid_request');
    const url = new URL('https://business-api.tiktok.com/open_api/v1.3/campaign/get/');
    url.searchParams.set('advertiser_id', env.TIKTOK_ADVERTISER_ID);
    url.searchParams.set('page', integer(params.page, 1, 20)); url.searchParams.set('page_size', limit);
    const data = await providerJson(url, { headers: { 'Access-Token': env.TIKTOK_ADS_ACCESS_TOKEN } }, fetchImpl);
    if (data.code !== 0) throw new ConnectorError('provider_unavailable');
    rows = compactProducts(data.data?.list, row => ({ id: row.campaign_id, title: row.campaign_name, status: row.operation_status }));
  }
  return result(`Read ${rows.length} ${definitions[provider].label} campaigns. No campaign was published or changed.`, { campaigns: rows, partial: rows.length === limit });
}

function reference(task) {
  const entry = definitions[task.provider];
  const url = secureUrl(task.params.url);
  if (entry.hosts && !entry.hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new ConnectorError('invalid_request');
  return result('Prepared an unverified supplier reference and quote checklist; no supplier was contacted or approved.', {
    provider: task.provider, url: url.href, title: text(task.params.title, 160, true), notes: text(task.params.notes, 1000, true),
    verification: 'unverified', fulfillment: 'not_connected',
    questions: ['Confirm exact chip/model and every size SKU.', 'Confirm single-order dropshipping, neutral packaging and order import.',
      'Quote sample, unit, shipping, tax/duty, handling, and size-exchange costs.', 'Confirm current size stock, dispatch time, tracking, defects and returns.'],
    restriction: task.provider === 'temu' ? 'Obtain explicit commercial/third-party permission before any customer fulfillment; ordinary consumer terms do not establish it.' : null,
  }, 'reference_preparation');
}

function adDraft(task) {
  const params = task.params;
  const url = secureUrl(params.destinationUrl);
  if (!Number.isFinite(params.budgetDaily) || params.budgetDaily <= 0 || params.budgetDaily > 10000 ||
      typeof params.currency !== 'string' || !/^[A-Z]{3}$/.test(params.currency)) throw new ConnectorError('invalid_request');
  return result('Prepared a local campaign brief. It has not been published and cannot spend money.', {
    provider: task.provider, headline: text(params.headline, 80), description: text(params.description, 500),
    destinationUrl: url.href, proposedDailyBudget: params.budgetDaily, currency: params.currency,
    publication: 'not_published',
    requiredBeforePublication: ['Verified advertiser account and billing.', 'Platform-specific targeting, creative assets, tracking, and policy review.', 'Separate approval of the exact final campaign payload and budget.'],
  }, 'local_draft');
}

export async function runConnectorTask(task, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!task || !task.params || typeof task.params !== 'object' || Array.isArray(task.params)) throw new ConnectorError('invalid_request');
  if (task.kind === 'onboarding_plan') {
    const profile = task.profileSnapshot;
    if (!profile?.brandName || !profile?.niche) throw new ConnectorError('invalid_request');
    return result(`Prepared the launch plan for ${profile.brandName}. This is local guidance, not an executed store launch.`, {
      profile, steps: ['Validate the chosen product and target market.', 'Read the connected store catalogue and confirm size/SKU mapping.',
        'Sample the actual supplier ring and confirm single-order fulfillment.', 'Calculate contribution margin from real quotes.',
        'Verify policies, payment, settlement and tracking before enabling purchases.', 'Review campaign drafts before any publication or spend.'],
    }, 'local_guidance');
  }
  const entry = definitions[task.provider];
  if (!entry?.capabilities.includes(task.kind)) throw new ConnectorError('unsupported_operation');
  if (task.kind === 'supplier_reference') return reference(task);
  if (task.kind === 'ad_draft') return adDraft(task);
  if (task.provider === 'shopify') return shopify(task.params, env, fetchImpl);
  if (task.provider === 'woocommerce') return woocommerce(task.params, env, fetchImpl);
  if (task.provider === 'cj') return cj(task.params, env, fetchImpl);
  return ads(task.provider, task.params, env, fetchImpl);
}
