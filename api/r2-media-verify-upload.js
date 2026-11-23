'use strict';

const { ApiError } = require('../server/r2/storage.cjs');
const { verifyOwner, sessionAuthorization } = require('../server/r2/auth.cjs');
const { verifyUploadedMedia } = require('../server/r2/migration.cjs');

const REQUEST_KEYS = [
  'businessId', 'sessionToken', 'sourceBucket', 'key', 'mime', 'expectedBytes', 'expectedSha256'
];

function isSameOrigin(req) {
  const origin = req.headers.origin;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0].trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const branchPreview = process.env.VERCEL_ENV === 'preview'
    && process.env.VERCEL_GIT_COMMIT_REF === 'feat/r2-storage-integration'
    && process.env.R2_MEDIA_UPLOAD_ENABLED === 'true'
    && process.env.R2_MEDIA_PREVIEW_UPLOAD_ENABLED === 'true';
  const productionEnabled = process.env.VERCEL_ENV === 'production'
    && process.env.R2_MEDIA_DELIVERY_ENABLED === 'true'
    && process.env.R2_MEDIA_DELIVERY_DEFAULT === 'true'
    && process.env.R2_MEDIA_UPLOAD_ENABLED === 'true';
  if (!branchPreview && !productionEnabled) return res.status(404).json({ error: 'Not found.' });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!isSameOrigin(req)) return res.status(403).json({ error: 'Same-origin request required.' });
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return res.status(415).json({ error: 'JSON required.' });
  }

  let stage = 'request';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== REQUEST_KEYS.length
      || !REQUEST_KEYS.every(key => Object.hasOwn(body, key))) {
      throw new ApiError(400, 'Invalid R2 media verification request.');
    }
    stage = 'owner-authorization';
    const owner = await verifyOwner(sessionAuthorization(body.sessionToken), body.businessId);
    stage = 'media-verification';
    const result = await verifyUploadedMedia({
      env: process.env,
      owner,
      business: body.businessId,
      item: body
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 502;
    console.warn('R2 uploaded media verification failed', { stage, status });
    return res.status(status).json({
      error: error instanceof ApiError ? error.message : 'R2 media verification failed.'
    });
  }
};
