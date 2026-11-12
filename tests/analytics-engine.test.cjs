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

test("product view insight needs a useful sample and counts completed same-session purchases", () => {
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
  const refundedOrder = order("refunded-product-order", {
    status: "completed",
    payment_status: "refunded",
    analytics_session_id: "product-session-1"
  });
  const completedOrder = order("completed-product-order", {
    status: "completed",
    payment_status: "paid",
    analytics_session_id: "product-session-2"
  });
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: [cancelledOrder, refundedOrder, completedOrder],
    events: itemViews,
    items: [{ id: itemId, business_id: businessId, name: "Test item", is_available: true }],
    eventsAvailable: true,
    orderAttributionAvailable: true,
    period: "last7",
    now
  });
  assert.equal(snapshot.productViews.get(itemId).size, 20);
  assert.equal(snapshot.productOrderSessions.get(itemId).size, 1);
  assert.equal(snapshot.productPurchases.get(itemId), 1);
  const insight = engine.buildInsights(snapshot, {}, now).find(row => row.type === "product_view_order_rate");
  assert.ok(insight);
  assert.equal(insight.viewSessions, 20);
  assert.equal(insight.convertedSessions, 1);
  assert.match(insight.interpretation, /completed-purchase/);

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

test("order breakdown counts each order once per item and category even with multiple line items", () => {
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: [order("multi-line-order", { items: [
      { item_id: itemId, quantity: 1 },
      { item_id: itemId, quantity: 2 }
    ] })],
    items: [{ id: itemId, business_id: businessId, name: "Kota", category_id: "food" }],
    categories: [{ id: "food", business_id: businessId, name: "Food" }],
    period: "last7",
    now
  });
  assert.equal(snapshot.orderBreakdown.items[0].orders, 1);
  assert.equal(snapshot.orderBreakdown.items[0].units, 3);
  assert.equal(snapshot.orderBreakdown.categories[0].orders, 1);
});

test("customer demand links identified first and repeat purchases to items without counting guests", () => {
  const prior = order("prior-order", { customer_user_id: "returning-customer", created_at: monthIso(9, 20) });
  const current = [
    order("returning-order", { customer_user_id: "returning-customer", created_at: monthIso(10, 6), items: [{ item_id: itemId, quantity: 1 }] }),
    order("first-order", { customer_user_id: "new-customer", created_at: monthIso(10, 7), items: [{ item_id: itemId, quantity: 2 }, { item_id: "item-b", quantity: 1 }] }),
    order("repeat-order", { customer_user_id: "new-customer", created_at: monthIso(10, 8), items: [{ item_id: "item-b", quantity: 2 }] }),
    order("guest-order", { customer_user_id: null, created_at: monthIso(10, 9), items: [{ item_id: itemId, quantity: 1 }] }),
    order("refunded-order", { customer_user_id: "new-customer", payment_status: "refunded", created_at: monthIso(10, 9), items: [{ item_id: itemId, quantity: 1 }] })
  ];
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: current,
    customerHistory: [prior, ...current],
    items: [
      { id: itemId, business_id: businessId, name: "Kota", category_id: "food" },
      { id: "item-b", business_id: businessId, name: "Drink", category_id: "drinks" }
    ],
    categories: [
      { id: "food", business_id: businessId, name: "Food" },
      { id: "drinks", business_id: businessId, name: "Drinks" }
    ],
    period: "last7",
    now
  });
  const kota = snapshot.customerItemDemand.find(row => row.itemId === itemId);
  const drink = snapshot.customerItemDemand.find(row => row.itemId === "item-b");
  assert.deepEqual([kota.firstPurchaseOrders, kota.repeatPurchaseOrders], [1, 1]);
  assert.deepEqual([kota.firstPurchaseUnits, kota.repeatPurchaseUnits], [2, 1]);
  assert.deepEqual([drink.firstPurchaseOrders, drink.repeatPurchaseOrders], [1, 1]);
  assert.deepEqual([drink.firstPurchaseUnits, drink.repeatPurchaseUnits], [1, 2]);
});

test("traffic and order changes are linked only when both periods have minimum evidence", () => {
  const events = [];
  for (let index = 0; index < 30; index++) events.push({ ...visit("prior-visit-" + index), occurred_at: monthIso(9, 29 + Math.floor(index / 5)) });
  for (let index = 0; index < 40; index++) events.push({ ...visit("current-visit-" + index), occurred_at: monthIso(10, 5 + Math.floor(index / 6)) });
  const orders = [
    ...Array.from({ length: 5 }, (_, index) => order("prior-order-" + index, { created_at: monthIso(9, 29 + index) })),
    ...Array.from({ length: 10 }, (_, index) => order("current-order-" + index, { created_at: monthIso(10, 5 + index % 7) }))
  ];
  const snapshot = engine.buildSnapshot({ businessId, orders, events, eventsAvailable: true, orderAttributionAvailable: false, period: "last7", now });
  const insight = engine.buildInsights(snapshot, {}, now).find(row => row.key === "traffic-order-coincidence");
  assert.ok(insight);
  assert.match(insight.interpretation, /not proof/);

  const tooFewSessions = engine.buildSnapshot({ businessId, orders, events: events.slice(0, 15).concat(events.slice(30)), eventsAvailable: true, orderAttributionAvailable: false, period: "last7", now });
  assert.equal(engine.buildInsights(tooFewSessions, {}, now).some(row => row.key === "traffic-order-coincidence"), false);
});

test("cross-system insight links comparable order growth with slower acceptance only after both tracking windows", () => {
  const orders = [];
  const lifecycleEvents = [];
  const addOrder = (id, date, acceptanceHours) => {
    orders.push(order(id, { created_at: date.toISOString(), status: "new" }));
    lifecycleEvents.push({ business_id: businessId, entity_type: "order", entity_id: id, from_status: null, to_status: "new", changed_at: date.toISOString() });
    lifecycleEvents.push({ business_id: businessId, entity_type: "order", entity_id: id, from_status: "new", to_status: "accepted", changed_at: new Date(date.getTime() + acceptanceHours * 3600000).toISOString() });
  };
  for (let index = 0; index < 5; index++) addOrder("previous-" + index, new Date(2026, 9, 30, 10 + index), 1);
  for (let index = 0; index < 10; index++) addOrder("current-" + index, new Date(2026, 10, 6, 10 + index), 2);
  const snapshot = engine.buildSnapshot({
    businessId,
    orders,
    lifecycleEvents,
    lifecycleAvailable: true,
    lifecycleTrackingStartedAt: "2026-10-01T00:00:00.000Z",
    period: "last7",
    now
  });
  assert.equal(snapshot.demandOperations.comparable, true);
  assert.equal(snapshot.demandOperations.currentOrders, 10);
  assert.equal(snapshot.demandOperations.previousOrders, 5);
  assert.equal(snapshot.demandOperations.currentAcceptance.sampleSize, 10);
  const insight = engine.buildInsights(snapshot, {}, now).find(row => row.type === "cross_system_relationship");
  assert.ok(insight);
  assert.match(insight.interpretation, /not proof/);
  assert.ok(insight.priorityBreakdown.evidence > 0);

  const notYetComparable = engine.buildSnapshot({
    businessId,
    orders,
    lifecycleEvents,
    lifecycleAvailable: true,
    lifecycleTrackingStartedAt: "2026-11-01T00:00:00.000Z",
    period: "last7",
    now
  });
  assert.equal(notYetComparable.demandOperations.comparable, false);
  assert.equal(engine.buildInsights(notYetComparable, {}, now).some(row => row.type === "cross_system_relationship"), false);
});

test("cancellation-stage insight counts distinct orders and does not claim a cause", () => {
  const lifecycleEvents = Array.from({ length: 3 }, (_, index) => ({
    business_id: businessId,
    entity_type: "order",
    entity_id: "cancelled-" + index,
    from_status: "accepted",
    to_status: "cancelled",
    changed_at: iso(10)
  }));
  lifecycleEvents.push({ ...lifecycleEvents[0] });
  const snapshot = engine.buildSnapshot({
    businessId,
    orders: lifecycleEvents.slice(0, 3).map((row, index) => order("cancelled-" + index, { status: "cancelled" })),
    lifecycleEvents,
    lifecycleAvailable: true,
    lifecycleTrackingStartedAt: "2026-10-01T00:00:00.000Z",
    period: "last7",
    now
  });
  assert.equal(snapshot.lifecycle.cancellationsByPriorStatus.accepted, 3);
  const insight = engine.buildInsights(snapshot, {}, now).find(row => row.type === "cancellation_stage_pattern");
  assert.ok(insight);
  assert.match(insight.title, /acceptance/);
  assert.match(insight.interpretation, /cannot establish why/);
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
