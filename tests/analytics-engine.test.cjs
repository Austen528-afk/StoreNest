"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("../analytics-engine.js");

const businessId = "business-a";
const otherBusinessId = "business-b";
const itemId = "item-a";
const now = new Date(2026, 10, 11, 12, 0, 0);
const iso = (day, hour = 12) => new Date(2026, 10, day, hour, 0, 0).toISOString();
const monthIso = (month, day) => new Date(2026, month, day, 12, 0, 0).toISOString();
const order = (id, overrides = {}) => ({
  id,
  business_id: businessId,
  created_at: iso(10),
  status: "completed",
  payment_status: "unpaid",
  subtotal: 100,
  customer_user_id: null,
  analytics_session_id: null,
  items: [{ item_id: itemId, quantity: 1 }],
  ...overrides
});
const visit = (sessionId, day = 10, overrides = {}) => ({
  business_id: businessId,
  event_type: "store_visit",
  session_id: sessionId,
  item_id: null,
  occurred_at: iso(day),
  ...overrides
});

test("date ranges include the selected local dates and compare equal-length prior periods", () => {
  const range = engine.dateRange("last7", {}, now);
  assert.equal(range.duration, 7);
  assert.equal(engine.dayKey(range.start), "2026-11-05");
  assert.equal(engine.dayKey(range.end), "2026-11-12");
  assert.equal(engine.dayKey(range.previousStart), "2026-10-29");
  assert.equal(engine.dayKey(range.previousEnd), "2026-11-05");

  const custom = engine.dateRange("custom", { start: "2026-11-02", end: "2026-11-04" }, now);
  assert.equal(custom.duration, 3);
  assert.equal(engine.dayKey(custom.end), "2026-11-05");
  assert.equal(engine.dateRange("custom", { start: "2026-11-05", end: "2026-11-04" }, now), null);
});

test("snapshot isolates businesses and counts unique tracked sessions and all submitted orders", () => {
  const events = Array.from({ length: 10 }, (_, index) => visit("session-" + index));
  events.push(visit("session-0", 10, { event_type: "product_view", item_id: itemId }));
  events.push(visit("foreign-session", 10, { business_id: otherBusinessId }));
  const orders = [
    order("order-1", { analytics_session_id: "session-0", customer_user_id: "customer-1" }),
    order("order-2", { status: "cancelled", analytics_session_id: "session-1" }),
    order("order-3", { status: "new", created_at: iso(8), analytics_session_id: null }),
    order("order-foreign", { business_id: otherBusinessId, analytics_session_id: "foreign-session" })
  ];
  const snapshot = engine.buildSnapshot({
    businessId,
    orders,
    events,
    eventsAvailable: true,
    orderAttributionAvailable: true,
    period: "last7",
    now
  });

  assert.equal(snapshot.visits, 10);
  assert.equal(snapshot.ordersPlaced, 3);
  assert.equal(snapshot.cancelledCount, 1);
  assert.equal(snapshot.conversion.value, 20);
  assert.equal(snapshot.conversion.visits, 10);
  assert.equal(snapshot.conversion.convertedSessions, 2);
  assert.ok(snapshot.orders.every(row => row.business_id === businessId));
  assert.ok(snapshot.events.every(row => row.business_id === businessId));
});

test("conversion requires enough tracked sessions and never invents a zero visit count", () => {
  const sparse = engine.buildSnapshot({
    businessId,
    orders: [],
    events: Array.from({ length: 9 }, (_, index) => visit("s-" + index)),
    eventsAvailable: true,
    orderAttributionAvailable: true,
    period: "last7",
    now
  });
  assert.equal(sparse.visits, 9);
  assert.equal(sparse.conversion.value, null);
  assert.equal(sparse.conversion.reason, "insufficient");

  const untracked = engine.buildSnapshot({ businessId, orders: [], events: [], eventsAvailable: false, period: "last7", now });
  assert.equal(untracked.visits, null);
  assert.equal(untracked.conversion.value, null);
  assert.ok(engine.buildSeries(untracked, "visits").every(point => point.value === null));

  const trackedEmpty = engine.buildSnapshot({ businessId, orders: [], events: [], eventsAvailable: true, period: "last7", now });
  assert.equal(trackedEmpty.visits, 0);
  assert.ok(engine.buildSeries(trackedEmpty, "visits").every(point => point.value === 0));
  assert.ok(engine.buildSeries(trackedEmpty, "conversion").every(point => point.value === null));
});

test("product-view and booking chart series count activity within each day bucket", () => {
  const events = [
    visit("session-a", 10, { event_type: "product_view", item_id: "item-a" }),
    visit("session-a", 10, { event_type: "product_view", item_id: "item-a" }),
    visit("session-b", 10, { event_type: "product_view", item_id: "item-a" }),
    visit("session-a", 10, { event_type: "product_view", item_id: "item-b" })
  ];
  const bookings = [
    { id: "booking-1", business_id: businessId, item_id: "service-a", status: "pending", created_at: iso(10) },
    { id: "booking-2", business_id: businessId, item_id: "service-a", status: "accepted", created_at: iso(9) }
  ];
  const tracked = engine.buildSnapshot({ businessId, orders: [], events, bookings, eventsAvailable: true, period: "last7", now });
  assert.equal(engine.buildSeries(tracked, "product_views").reduce((sum, row) => sum + row.value, 0), 3);
  assert.equal(engine.buildSeries(tracked, "bookings").reduce((sum, row) => sum + row.value, 0), 2);

  const untracked = engine.buildSnapshot({ businessId, orders: [], events, bookings, eventsAvailable: false, period: "last7", now });
  assert.ok(engine.buildSeries(untracked, "product_views").every(row => row.value === null));
  assert.equal(engine.buildSeries(untracked, "bookings").reduce((sum, row) => sum + row.value, 0), 2);
});

test("returning customers use earlier completed non-refunded customer purchases and require a sample", () => {
  const recent = Array.from({ length: 5 }, (_, index) => order("current-" + index, {
    customer_user_id: "customer-" + index,
    created_at: iso(10)
  }));
  const older = [
    order("prior-0", { customer_user_id: "customer-0", created_at: iso(1), status: "completed" }),
    order("prior-1", { customer_user_id: "customer-1", created_at: iso(1), status: "completed" }),
    order("prior-refund", { customer_user_id: "customer-2", created_at: iso(1), status: "completed", payment_status: "refunded" }),
    order("prior-pending", { customer_user_id: "customer-3", created_at: iso(1), status: "new" })
  ];
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: recent,
    customerHistory: recent.concat(older),
    events: [],
    eventsAvailable: false,
    period: "last7",
    now
  });
  assert.equal(snapshot.customers.identifiedBuyers, 5);
  assert.equal(snapshot.customers.returningBuyers, 2);
  assert.equal(snapshot.customers.newBuyers, 3);
  assert.equal(snapshot.customers.returningRate, 40);

  const belowThreshold = engine.buildSnapshot({
    businessId,
    orders: recent.slice(0, 4),
    customerHistory: recent.slice(0, 4).concat(older),
    events: [],
    eventsAvailable: false,
    period: "last7",
    now
  });
  assert.equal(belowThreshold.customers.returningRate, null);
});

test("product view insight needs a useful sample and counts same-session submitted orders", () => {
  const itemViews = Array.from({ length: 20 }, (_, index) => ({
    business_id: businessId,
    event_type: "product_view",
    session_id: "product-session-" + index,
    item_id: itemId,
    occurred_at: iso(10)
  }));
  const cancelledOrder = order("cancelled-product-order", {
    status: "cancelled",
    analytics_session_id: "product-session-0"
  });
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: [cancelledOrder],
    events: itemViews,
    items: [{ id: itemId, business_id: businessId, name: "Test item", is_available: true }],
    eventsAvailable: true,
    orderAttributionAvailable: true,
    period: "last7",
    now
  });
  assert.equal(snapshot.productViews.get(itemId).size, 20);
  assert.equal(snapshot.productOrderSessions.get(itemId).size, 1);
  assert.equal(snapshot.productPurchases.get(itemId), undefined);
  const insight = engine.buildInsights(snapshot, {}, now).find(row => row.type === "product_view_order_rate");
  assert.ok(insight);
  assert.equal(insight.viewSessions, 20);
  assert.equal(insight.convertedSessions, 1);

  const fourteenViews = engine.buildSnapshot({
    businessId,
    orders: [],
    events: itemViews.slice(0, 14),
    items: [{ id: itemId, business_id: businessId, name: "Test item" }],
    eventsAvailable: true,
    orderAttributionAvailable: true,
    period: "last7",
    now
  });
  assert.equal(engine.buildInsights(fourteenViews, {}, now).some(row => row.type === "product_view_order_rate"), false);
});

test("service analytics use booking requests instead of sales and need session attribution", () => {
  const serviceId = "service-a";
  const serviceViews = Array.from({ length: 20 }, (_, index) => ({
    business_id: businessId,
    event_type: "product_view",
    session_id: "service-session-" + index,
    item_id: serviceId,
    occurred_at: iso(10)
  }));
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: [],
    bookings: [{
      id: "booking-1",
      business_id: businessId,
      item_id: serviceId,
      status: "declined",
      created_at: iso(10),
      analytics_session_id: "service-session-0"
    }],
    events: serviceViews,
    items: [{ id: serviceId, business_id: businessId, name: "Catering", item_type: "service", is_available: true }],
    eventsAvailable: true,
    orderAttributionAvailable: true,
    bookingAttributionAvailable: true,
    period: "last7",
    now
  });
  assert.equal(snapshot.serviceBookingRequests.get(serviceId), 1);
  assert.equal(snapshot.serviceBookingSessions.get(serviceId).size, 1);
  const insight = engine.buildInsights(snapshot, {}, now).find(row => row.type === "service_view_booking_rate");
  assert.ok(insight);
  assert.equal(insight.convertedSessions, 1);
  assert.match(insight.explanation, /booking request/);

  const withoutAttribution = engine.buildSnapshot({
    businessId,
    orders: [],
    bookings: [{ id: "booking-2", business_id: businessId, item_id: serviceId, status: "pending", created_at: iso(10) }],
    events: serviceViews,
    items: [{ id: serviceId, business_id: businessId, item_type: "service" }],
    eventsAvailable: true,
    bookingAttributionAvailable: false,
    period: "last7",
    now
  });
  assert.equal(engine.buildInsights(withoutAttribution, {}, now).some(row => row.type === "service_view_booking_rate"), false);
});

test("insight follow-up uses complete days and labels changes as comparisons, not causes", () => {
  const actionDate = new Date(2026, 10, 1, 15, 0, 0);
  const events = [];
  for (let day = 25; day <= 31; day++) events.push(visit("before-" + day, day, { occurred_at: monthIso(9, day) }));
  for (let day = 2; day <= 8; day++) events.push(visit("after-" + day, day, { occurred_at: monthIso(10, day) }));
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: [],
    events,
    eventsAvailable: true,
    orderAttributionAvailable: true,
    period: "custom",
    custom: { start: "2026-10-25", end: "2026-11-15" },
    now: new Date(2026, 10, 30, 12, 0, 0)
  });
  const insight = { metric: "visits" };
  const waiting = engine.followUp(snapshot, insight, actionDate, new Date(2026, 10, 7, 12, 0, 0));
  assert.equal(waiting.reason, "wait");

  const result = engine.followUp(snapshot, insight, actionDate, new Date(2026, 10, 9, 12, 0, 0));
  assert.equal(result.available, true);
  assert.equal(result.before, 7);
  assert.equal(result.after, 7);
  assert.match(result.message, /does not prove/);
});
