'use strict';

const { config } = require('../server/r2/storage.cjs');

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  let configured = false;
  try { config(process.env); configured = true; } catch {}
  const preview = process.env.VERCEL_ENV === 'preview'
    && process.env.VERCEL_GIT_COMMIT_REF === 'feat/r2-storage-integration';
  const production = process.env.VERCEL_ENV === 'production';
  const deliveryEnabled = configured && (
    preview || (production && process.env.R2_MEDIA_DELIVERY_ENABLED === 'true')
  );
  const defaultDelivery = deliveryEnabled && production
    && process.env.R2_MEDIA_DELIVERY_DEFAULT === 'true';
  const uploadEnabled = deliveryEnabled
    && process.env.R2_MEDIA_UPLOAD_ENABLED === 'true'
    && (!preview || process.env.R2_MEDIA_PREVIEW_UPLOAD_ENABLED === 'true')
    && (!production || defaultDelivery);

  return res.status(200).json({
    environment: preview ? 'preview' : production ? 'production' : 'disabled',
    deliveryEnabled,
    defaultDelivery,
    uploadEnabled
  });
};
