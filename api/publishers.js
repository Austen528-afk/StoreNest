'use strict';

const { getPublisherRegistry, json } = require('../server/hq-publisher-proxy');

module.exports = async function handler(req, res) {
  const rawProfileId = req.query && req.query.profileId;
  if (Array.isArray(rawProfileId)) return json(res, 400, { error: 'invalid_publisher_id' });
  const result = await getPublisherRegistry(req, rawProfileId || null);
  if (result.allow) res.setHeader('Allow', result.allow);
  return json(res, result.status, result.body);
};
