'use strict';

const { createHash, createHmac } = require('node:crypto');
const https = require('node:https');
const { ApiError, UUID, config } = require('./storage.cjs');
const { BASE } = require('./auth.cjs');

const SOURCE_BUCKETS = new Set(['storenest-product-media', 'storenest-brand-media']);
const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_ITEMS = 4;
const MAX_BATCH_BYTES = 20 * 1024 * 1024;
const MIME_EXTENSIONS = {
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/png': new Set(['png']),
  'image/webp': new Set(['webp']),
  'image/gif': new Set(['gif']),
  'video/mp4': new Set(['mp4']),
  'video/webm': new Set(['webm'])
};

const sha256 = value => createHash('sha256').update(value).digest('hex');
const hmac = (key, value, encoding) => createHmac('sha256', key).update(value).digest(encoding);

function safeSegment(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && value !== '.'
    && value !== '..'
    && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function validateItem({ owner, business, sourceBucket, key, mime, expectedBytes }) {
  if (!SOURCE_BUCKETS.has(sourceBucket)) throw new ApiError(400, 'Unsupported source bucket.');
  if (!UUID.test(owner || '') || !UUID.test(business || '')) throw new ApiError(400, 'Invalid owner or business.');
  if (typeof key !== 'string' || key.length > 1500) throw new ApiError(400, 'Invalid source object key.');
  const parts = key.split('/');
  if (parts.length < 3 || parts.length > 12 || !parts.every(safeSegment)) throw new ApiError(400, 'Invalid source object key.');
  if (parts[0].toLowerCase() !== owner.toLowerCase() || parts[1].toLowerCase() !== business.toLowerCase()) {
    throw new ApiError(403, 'Source object is outside this business.');
  }
  if (typeof mime !== 'string' || !Object.hasOwn(MIME_EXTENSIONS, mime.toLowerCase())) {
    throw new ApiError(415, 'Unsupported media type.');
  }
  const extension = parts[parts.length - 1].split('.').pop().toLowerCase();
  if (!MIME_EXTENSIONS[mime.toLowerCase()].has(extension)) throw new ApiError(415, 'Media type does not match its file name.');
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_OBJECT_BYTES) {
    throw new ApiError(413, 'Media file is empty or exceeds the 20 MB migration limit.');
  }
  return {
    sourceBucket,
    key: parts.join('/'),
    mime: mime.toLowerCase(),
    expectedBytes
  };
}

function destinationKey(sourceBucket, key) {
  return 'r2-supabase-migration/' + sourceBucket + '/' + key;
}

function validDestinationKey(key) {
  if (typeof key !== 'string') return false;
  const parts = key.split('/');
  return parts.length >= 5
    && parts.length <= 14
    && parts[0] === 'r2-supabase-migration'
    && SOURCE_BUCKETS.has(parts[1])
    && UUID.test(parts[2] || '')
    && UUID.test(parts[3] || '')
    && parts.slice(4).every(safeSegment);
}

function encodedSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character =>
    '%' + character.charCodeAt(0).toString(16).toUpperCase()
  );
}

function signRequest(cfg, method, key, body, mime, now = new Date()) {
  if (!['PUT', 'GET'].includes(method) || !validDestinationKey(key)) {
    throw new ApiError(400, 'Invalid migration storage operation.');
  }
  const payload = method === 'PUT' ? body : Buffer.alloc(0);
  if (method === 'PUT' && (!Buffer.isBuffer(payload) || !payload.length || payload.length > MAX_OBJECT_BYTES)) {
    throw new ApiError(413, 'Invalid migration payload.');
  }

  const host = cfg.account + '.r2.cloudflarestorage.com';
  const uri = '/' + cfg.bucket + '/' + key.split('/').map(encodedSegment).join('/');
  const timestamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = timestamp.slice(0, 8);
  const scope = day + '/auto/s3/aws4_request';
  const payloadHash = sha256(payload);
  const headers = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': timestamp
  };
  if (method === 'PUT') {
    headers['cache-control'] = 'public, max-age=3600';
    headers['content-type'] = mime;
    headers['if-none-match'] = '*';
  }

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map(name => name + ':' + headers[name] + '\n').join('');
  const canonicalRequest = [method, uri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', timestamp, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac('AWS4' + cfg.secret, day), 'auto'), 's3'), 'aws4_request');
  headers.authorization = 'AWS4-HMAC-SHA256 Credential=' + cfg.access + '/' + scope
    + ', SignedHeaders=' + signedHeaders + ', Signature=' + hmac(signingKey, stringToSign, 'hex');

  return {
    url: 'https://' + host + uri,
    options: {
      method,
      headers,
      redirect: 'error',
      ...(method === 'PUT' ? { body } : {}),
      signal: AbortSignal.timeout(45000)
    }
  };
}

function nativeRequest(url, options, maxResponseBytes) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method,
      headers: options.headers,
      signal: options.signal
    }, response => {
      const chunks = [];
      let length = 0;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      response.on('error', fail);
      response.on('data', chunk => {
        length += chunk.length;
        if (length > maxResponseBytes) {
          const error = new Error('Response limit exceeded.');
          fail(error);
          response.destroy(error);
          request.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          settled = true;
          resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), {
            status: response.statusCode || 502,
            headers
          }));
        } catch (error) {
          fail(error);
        }
      });
    });

    request.on('error', error => reject(error));
    request.setTimeout(45000, () => request.destroy(new Error('R2 request timed out.')));
    request.end(options.body);
  });
}

async function r2Request(cfg, method, key, body, mime) {
  const signed = signRequest(cfg, method, key, body, mime);
  const maxResponse = method === 'GET' ? MAX_OBJECT_BYTES : 65536;
  try {
    return await nativeRequest(signed.url, signed.options, maxResponse);
  } catch {
    throw new ApiError(502, 'Cloudflare R2 request failed.');
  }
}

async function readBounded(response, maxBytes) {
  if (!response.body) throw new ApiError(502, 'Media response was empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new ApiError(413, 'Media file exceeds the 20 MB migration limit.');
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  return Buffer.concat(chunks, length);
}

async function readSupabaseSource(sourceBucket, key, mime, expectedBytes, fetcher = fetch) {
  const url = BASE + '/storage/v1/object/public/' + encodedSegment(sourceBucket) + '/'
    + key.split('/').map(encodedSegment).join('/');
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(45000)
    });
  } catch {
    throw new ApiError(502, 'Supabase source request failed.');
  }
  if (response.status === 404) throw new ApiError(409, 'Source file is unavailable; rescan the media list.');
  if (!response.ok) throw new ApiError(502, 'Supabase source read failed. HTTP ' + response.status + '.');

  const responseMime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (responseMime && responseMime !== mime) throw new ApiError(409, 'Source media type changed; rescan the media list.');
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 0 && contentLength !== expectedBytes) {
    throw new ApiError(409, 'Source file size changed; rescan the media list.');
  }

  const bytes = await readBounded(response, MAX_OBJECT_BYTES);
  if (bytes.length !== expectedBytes) throw new ApiError(409, 'Source file size changed; rescan the media list.');
  return bytes;
}

async function verifyDestination(cfg, target, mime, expectedBytes, expectedHash) {
  const response = await r2Request(cfg, 'GET', target, undefined, mime);
  if (response.status === 404) throw new ApiError(502, 'R2 object was not found after upload.');
  if (!response.ok) throw new ApiError(502, 'R2 verification read failed. HTTP ' + response.status + '.');
  const responseMime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (responseMime !== mime || bytes.length !== expectedBytes || sha256(bytes) !== expectedHash) {
    throw new ApiError(409, 'An R2 object at this migration key does not match the source.');
  }
  return { bytes: bytes.length, sha256: expectedHash, verified: true };
}

async function copyOne(cfg, owner, business, item, fetcher) {
  const source = validateItem({ owner, business, ...item });
  const sourceBytes = await readSupabaseSource(source.sourceBucket, source.key, source.mime, source.expectedBytes, fetcher);
  const sourceHash = sha256(sourceBytes);
  const target = destinationKey(source.sourceBucket, source.key);
  const uploaded = await r2Request(cfg, 'PUT', target, sourceBytes, source.mime);

  if ([409, 412].includes(uploaded.status)) {
    const verified = await verifyDestination(cfg, target, source.mime, source.expectedBytes, sourceHash);
    return { sourceBucket: source.sourceBucket, key: source.key, ...verified, alreadyPresent: true };
  }
  if (!uploaded.ok) throw new ApiError(502, 'R2 upload failed. HTTP ' + uploaded.status + '.');

  const verified = await verifyDestination(cfg, target, source.mime, source.expectedBytes, sourceHash);
  return { sourceBucket: source.sourceBucket, key: source.key, ...verified, alreadyPresent: false };
}

async function copySupabaseMediaBatch({ env, owner, business, items, fetcher = fetch }) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BATCH_ITEMS) {
    throw new ApiError(400, 'Copy one to four media files per request.');
  }
  const prepared = items.map(item => validateItem({ owner, business, ...item }));
  const totalBytes = prepared.reduce((sum, item) => sum + item.expectedBytes, 0);
  if (totalBytes > MAX_BATCH_BYTES) throw new ApiError(413, 'Copy no more than 20 MB per request.');

  const cfg = config(env);
  const results = [];
  for (const item of prepared) {
    try {
      results.push(await copyOne(cfg, owner, business, item, fetcher));
    } catch (error) {
      results.push({
        sourceBucket: item.sourceBucket,
        key: item.key,
        verified: false,
        error: error instanceof ApiError ? error.message : 'Copy could not be verified.'
      });
      break;
    }
  }
  return { results, complete: results.length === prepared.length && results.every(result => result.verified) };
}

module.exports = {
  MAX_OBJECT_BYTES,
  MAX_BATCH_ITEMS,
  MAX_BATCH_BYTES,
  copySupabaseMediaBatch
};
