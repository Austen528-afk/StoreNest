'use strict';

const { ApiError } = require('../server/r2/storage.cjs');
const { createMigrationMediaUrl } = require('../server/r2/migration.cjs');

const ALLOWED_BUCKETS = new Set(['storenest-product-media', 'storenest-brand-media']);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (process.env.VERCEL_ENV !== 'preview'
    || process.env.VERCEL_GIT_COMMIT_REF !== 'feat/r2-storage-integration') {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const requestUrl = new URL(req.url || '/', 'https://storenest.invalid');
    const buckets = requestUrl.searchParams.getAll('bucket');
    const keys = requestUrl.searchParams.getAll('key');
    const parameterNames = [...requestUrl.searchParams.keys()];
    if (parameterNames.length !== 2 || buckets.length !== 1 || keys.length !== 1
      || !ALLOWED_BUCKETS.has(buckets[0])) {
      throw new ApiError(400, 'Invalid migrated media reference.');
    }

    const location = createMigrationMediaUrl(process.env, buckets[0], keys[0]);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Location', location);
    return res.status(307).end();
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502;
    const message = error instanceof ApiError ? error.message : 'Media URL could not be generated.';
    return res.status(status).json({ error: message });
  }
};
