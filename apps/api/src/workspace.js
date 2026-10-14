import { createHash, timingSafeEqual } from 'node:crypto';
import { assertFounderBinding, createWorkspaceService } from './workspace-service.js';
import { WorkspaceError, invalid } from './workspace-errors.js';
import { isObject } from './workspace-state.js';

const MAX_BODY_BYTES = 16 * 1024;

function authenticate(req, env) {
  assertFounderBinding(env);
  const header = req.headers?.authorization;
  const token = typeof header === 'string' ? /^Bearer ([^\s]+)$/u.exec(header)?.[1] : undefined;
  const expected = createHash('sha256').update(env.WE_COMMERCE_AUTH_TOKEN).digest();
  const received = createHash('sha256').update(token ?? '').digest();
  if (!token || !timingSafeEqual(expected, received)) {
    throw new WorkspaceError(401, 'unauthorized', 'Authenticate with the founder workspace token.');
  }
}

function parseJson(raw) {
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new WorkspaceError(413, 'body_too_large', 'The JSON request is too large.');
  let value;
  try { value = JSON.parse(raw); } catch { throw invalid('The request body must contain valid JSON.'); }
  if (!isObject(value)) throw invalid('The request body must be a JSON object.');
  return value;
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;.*)?$/iu.test(req.headers?.['content-type'] ?? '')) {
    throw new WorkspaceError(415, 'unsupported_media_type', 'Use application/json for workspace actions.');
  }
  if (Number(req.headers?.['content-length']) > MAX_BODY_BYTES) {
    req.resume?.();
    throw new WorkspaceError(413, 'body_too_large', 'The JSON request is too large.');
  }
  // Vercel may already parse the request. Re-parse a bounded JSON representation
  // so the same validation applies to raw Node requests and function wrappers.
  if (req.body !== undefined) {
    if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString('utf8'));
    if (typeof req.body === 'string') return parseJson(req.body);
    let serialized;
    try { serialized = JSON.stringify(req.body); } catch { throw invalid('The JSON body is invalid.'); }
    if (typeof serialized !== 'string') throw invalid('The JSON body is invalid.');
    return parseJson(serialized);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted);
    };
    const fail = error => { cleanup(); req.once('error', () => {}); req.resume(); reject(error); };
    const onData = chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) return fail(new WorkspaceError(413, 'body_too_large', 'The JSON request is too large.'));
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => {
      cleanup();
      try { resolve(parseJson(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); }
    };
    const onError = () => fail(invalid('The request body could not be read.'));
    const onAborted = () => fail(invalid('The request body was interrupted.'));
    const timer = setTimeout(() => fail(new WorkspaceError(408, 'request_timeout', 'The JSON request body timed out.')), 10000);
    req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onAborted);
  });
}

export function createWorkspaceHandler({ service, env = process.env, ...options } = {}) {
  const workspaceService = service ?? createWorkspaceService({ env, ...options });
  return async function workspaceHandler(req, res) {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('vary', 'Authorization');
    try {
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) {
        res.setHeader('allow', 'GET, HEAD, POST');
        throw new WorkspaceError(405, 'method_not_allowed', 'The workspace supports GET, HEAD, and POST.');
      }
      authenticate(req, env);
      const body = req.method === 'POST' ? await workspaceService.mutate(await readJson(req), { idempotencyKey: req.headers?.['idempotency-key'] }) : await workspaceService.workspace();
      res.statusCode = 200;
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body));
    } catch (error) {
      const safe = error instanceof WorkspaceError ? error : new WorkspaceError(500, 'workspace_unavailable', 'The workspace request could not be completed.');
      res.statusCode = safe.status;
      if (safe.status === 401) res.setHeader('www-authenticate', 'Bearer');
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: safe.message, code: safe.code }));
    }
  };
}

export const workspaceHandler = createWorkspaceHandler();
