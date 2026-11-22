'use strict';

const { ApiError } = require('../server/r2/storage.cjs');
const { verifyOwner, sessionAuthorization } = require('../server/r2/auth.cjs');
const { MAX_BATCH_ITEMS, MAX_BATCH_BYTES, copySupabaseMediaBatch } = require('../server/r2/migration.cjs');

const REQUEST_KEYS = ['action', 'businessId', 'sessionToken', 'items'];
const ITEM_KEYS = ['sourceBucket', 'key', 'mime', 'expectedBytes'];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'feat/r2-storage-integration') {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
    return res.status(415).json({ error: 'JSON required.' });
  }

  let stage = 'request';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== REQUEST_KEYS.length
      || !REQUEST_KEYS.every(key => Object.hasOwn(body, key))
      || body.action !== 'copy'
      || !Array.isArray(body.items)
      || body.items.length < 1
      || body.items.length > MAX_BATCH_ITEMS) {
      throw new ApiError(400, 'Invalid migration request.');
    }

    let batchBytes = 0;
    for (const item of body.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).length !== ITEM_KEYS.length
        || !ITEM_KEYS.every(key => Object.hasOwn(item, key))) {
        throw new ApiError(400, 'Invalid migration item.');
      }
      if (!Number.isSafeInteger(item.expectedBytes) || item.expectedBytes < 1) {
        throw new ApiError(400, 'Invalid media size.');
      }
      batchBytes += item.expectedBytes;
      if (batchBytes > MAX_BATCH_BYTES) throw new ApiError(413, 'Copy no more than 20 MB per request.');
    }

    stage = 'supabase-authorization';
    const owner = await verifyOwner(sessionAuthorization(body.sessionToken), body.businessId);
    stage = 'media-copy';
    const result = await copySupabaseMediaBatch({
      env: process.env,
      owner,
      business: body.businessId,
      items: body.items
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 502;
    console.warn('R2 media migration request failed', { stage, status });
    return res.status(status).json({ error: error instanceof ApiError ? error.message : 'Media copy failed.' });
  }
};
