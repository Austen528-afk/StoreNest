'use strict';

const SUPABASE_URL = process.env.STORENEST_SUPABASE_URL || 'https://cypbjzbagezdelmemuhb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.STORENEST_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_8W8zyYtggQMWoFlnxrzoVA_BUKjQ9va';
const REGISTRY_FUNCTION_URL = new URL('/functions/v1/hq-publisher-registry', SUPABASE_URL);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.end(JSON.stringify(payload));
}

function sameOriginRequest(req) {
  const origin = req.headers && req.headers.origin;
  const host = req.headers && req.headers.host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch (_) {
    return false;
  }
}

async function requireAdministrator(req) {
  if (!sameOriginRequest(req)) {
    return { status: 403, body: { error: 'forbidden' } };
  }

  const authorization = req.headers && req.headers.authorization;
  const match = typeof authorization === 'string' && authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) return { status: 401, body: { error: 'unauthorized' } };

  const userToken = match[1];
  const authResponse = await fetch(new URL('/auth/v1/user', SUPABASE_URL), {
    method: 'GET',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + userToken,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  if (!authResponse.ok) return { status: 401, body: { error: 'unauthorized' } };
  const user = await authResponse.json().catch(() => null);
  if (!user || typeof user.id !== 'string') return { status: 401, body: { error: 'unauthorized' } };

  const adminCheck = await fetch(new URL('/rest/v1/rpc/get_platform_admin_publisher_referrals', SUPABASE_URL), {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + userToken,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  });
  if (!adminCheck.ok) {
    if (adminCheck.status >= 500) return { status: 503, body: { error: 'admin_verification_unavailable' } };
    return { status: 403, body: { error: 'forbidden' } };
  }
  const adminRows = await adminCheck.json().catch(() => null);
  if (!Array.isArray(adminRows)) return { status: 403, body: { error: 'forbidden' } };
  return null;
}

async function getPublisherRegistry(req, profileId) {
  if (req.method !== 'GET') return { status: 405, body: { error: 'method_not_allowed' }, allow: 'GET' };
  if (profileId && !UUID_PATTERN.test(profileId)) return { status: 400, body: { error: 'invalid_publisher_id' } };

  try {
    const authorizationError = await requireAdministrator(req);
    if (authorizationError) return authorizationError;
  } catch (_) {
    return { status: 503, body: { error: 'admin_verification_unavailable' } };
  }

  const proxySecret = process.env.STORENEST_HQ_PUBLISHERS_PROXY_SECRET;
  if (!proxySecret) return { status: 503, body: { error: 'publisher_source_unavailable' } };

  const registryUrl = new URL(REGISTRY_FUNCTION_URL.toString());
  if (profileId) registryUrl.searchParams.set('id', profileId);

  try {
    const response = await fetch(registryUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-storenest-hq-secret': proxySecret,
      },
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== 'object') {
      if (response.status === 404) return { status: 404, body: { error: 'publisher_not_found' } };
      return { status: 502, body: { error: 'publisher_source_unavailable' } };
    }
    return { status: 200, body: payload };
  } catch (_) {
    return { status: 502, body: { error: 'publisher_source_unavailable' } };
  }
}

module.exports = { getPublisherRegistry, json };
