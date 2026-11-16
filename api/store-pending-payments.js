'use strict';

const { getPublisherRegistry, json } = require('../server/hq-publisher-proxy');

module.exports = async function handler(req, res) {
  const result = await getPublisherRegistry(req, null);
  if (result.allow) res.setHeader('Allow', result.allow);
  if (result.status !== 200) return json(res, result.status, result.body);

  const totals = result.body && result.body.storePendingFeeTotals;
  const amount = Number(totals && totals.amount);
  const obligations = Number(totals && totals.obligations);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(obligations) || obligations < 0) {
    return json(res, 503, { error: 'pending_store_fees_unavailable' });
  }
  return json(res, 200, { pendingAmount: amount, pendingObligations: obligations });
};
