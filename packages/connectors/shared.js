export class ConnectorError extends Error {
  constructor(code, message = 'The connector could not complete this request.') {
    super(message);
    this.code = code;
  }
}

export function required(env, names) {
  if (names.some(name => typeof env[name] !== 'string' || !env[name].trim())) {
    throw new ConnectorError('not_configured', 'Configure the server-side account bindings before running this connector.');
  }
}

export function integer(value, fallback, maximum = 50) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new ConnectorError('invalid_request');
  return value;
}

export function secureUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !url.hostname.includes('.') || /^(?:localhost|127\.|0\.|\[)/i.test(url.hostname) ||
        [...url.searchParams.keys()].some(key => /token|secret|password|api.?key|authorization/i.test(key))) {
      throw new Error();
    }
    return url;
  } catch {
    throw new ConnectorError('invalid_request', 'Use a public HTTPS product or destination URL without credentials.');
  }
}

export function text(value, maximum = 160, optional = false) {
  if (optional && (value === undefined || (typeof value === 'string' && !value.trim()))) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new ConnectorError('invalid_request');
  }
  return value.trim();
}

export async function providerJson(url, options, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok) throw new ConnectorError('provider_unavailable');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) {
        controller.abort();
        throw new ConnectorError('provider_unavailable');
      }
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ConnectorError('provider_unavailable', 'The provider response was unavailable or invalid. Check the account configuration and try again.');
  } finally {
    clearTimeout(timer);
  }
}

export function compactProducts(rows, getProduct) {
  if (!Array.isArray(rows) || rows.length > 100) throw new ConnectorError('provider_unavailable');
  return rows.map(row => {
    const value = getProduct(row);
    if (!value || (typeof value.id !== 'string' && typeof value.id !== 'number') ||
        typeof value.title !== 'string' || !value.title.trim()) throw new ConnectorError('provider_unavailable');
    return { ...value, id: String(value.id), title: value.title.slice(0, 300) };
  });
}
