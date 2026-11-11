"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
global.StoreNestAnalyticsEngine = require("../analytics-engine.js");
const engine = require("../customer-intelligence-engine.js");

const businessId = "business-a";
const otherBusinessId = "business-b";
const now = new Date(2026, 10, 11, 12, 0, 0);
const at = (day, hour = 12) => new Date(2026, 9, day, hour, 0, 0).toISOString();
const atMinute = (day, hour, minute) => new Date(2026, 9, day, hour, minute, 0).toISOString();

function order(id, values = {}) {
  return {
    id,
    business_id: businessId,
    created_at: at(20),
    status: "completed",
    payment_status: "unpaid",
    subtotal: 100,
    customer_user_id: null,
    customer_name: "Customer",
    contact_email: null,
    contact_phone: null,
    analytics_session_id: null,
    items: [],
    ...values
  };
}

function event(type, session, day = 20, values = {}) {
  return {
    business_id: businessId,
    event_type: type,
    session_id: session,
    item_id: null,
    occurred_at: at(day),
    ...values
  };
}

function build(values = {}) {
  return engine.buildModel({ businessId, period: "last30", now, ...values });
}

test("merges customer account and guest records that share an email or normalized South African phone", () => {
  const model = build({
    orders: [
      order("signed", { customer_user_id: "USER-1", contact_email: "Shopper@Example.com", contact_phone: "079 123 4567" }),
      order("guest", { customer_name: "Guest order", contact_email: "shopper@example.com", contact_phone: "+27 79 123 4567", created_at: at(24) })
    ]
  });

  assert.equal(model.customers.size, 1);
  assert.equal(model.current.identifiedBuyers, 1);
  assert.equal(model.current.returningCustomers, 1);
  assert.equal(model.current.returningRate, 100);
  assert.equal(model.topCustomers[0].orders, 2);
  assert.equal(model.customers.values().next().value.name, "Guest order");
});

test("repeat purchasing uses completed non-refunded orders while spend uses only recorded paid orders", () => {
  const model = build({
    orders: [
      order("unpaid-1", { customer_user_id: "buyer-1", subtotal: 200 }),
      order("unpaid-2", { customer_user_id: "buyer-1", subtotal: 300, created_at: at(23) }),
      order("paid", { customer_user_id: "buyer-1", payment_status: "paid", subtotal: 120, created_at: at(25) }),
      order("refunded", { customer_user_id: "buyer-1", payment_status: "refunded", subtotal: 900, created_at: at(26) }),
      order("cancelled", { customer_user_id: "buyer-1", status: "cancelled", payment_status: "paid", subtotal: 700, created_at: at(27) })
    ]
  });

  assert.equal(model.current.totalOrders, 3);
  assert.equal(model.current.returningCustomers, 1);
  assert.equal(model.current.averageSpend, 120);
  assert.equal(model.current.paidSpend, 120);
  assert.equal(model.current.paidOrderCount, 1);
  assert.equal(model.topCustomers[0].paidSpend, 120);
});

test("does not count anonymous orders as identified customers or customer spend", () => {
  const model = build({ orders: [order("anonymous", { subtotal: 80 })] });

  assert.equal(model.customers.size, 0);
  assert.equal(model.current.totalOrders, 1);
  assert.equal(model.current.identifiedBuyers, 0);
  assert.equal(model.current.averageSpend, null);
  assert.equal(model.topCustomers.length, 0);
});

test("isolates business records and counts visit sessions once in each chart bucket", () => {
  const model = build({
    orders: [order("ours", { customer_user_id: "buyer" }), order("theirs", { business_id: otherBusinessId, customer_user_id: "other" })],
    events: [
      event("store_visit", "session-a", 20),
      event("store_visit", "session-a", 20),
      event("store_visit", "session-b", 20),
      event("store_visit", "foreign-session", 20, { business_id: otherBusinessId })
    ]
  });
  const point = model.series.visits.find(row => row.label === "20 Oct");

  assert.equal(model.orders.length, 1);
  assert.equal(model.events.length, 3);
  assert.equal(point.value, 2);
});

test("preferences come from saved item choices and deduplicated view sessions", () => {
  const model = build({
    orders: [order("with-items", {
      customer_user_id: "buyer",
      items: [{ item_id: "item-1", quantity: 2, selection: { Size: "M", Colour: "Navy" } }]
    })],
    items: [{ id: "item-1", business_id: businessId, name: "Jacket", item_type: "product", category_id: "cat-1" }],
    categories: [{ id: "cat-1", business_id: businessId, name: "Fashion" }],
    events: [
      event("product_view", "view-session", 20, { item_id: "item-1" }),
      event("product_view", "view-session", 20, { item_id: "item-1" }),
      event("product_view", "another-session", 20, { item_id: "item-1" })
    ]
  });

  assert.equal(model.preferences.purchased[0].name, "Jacket");
  assert.equal(model.preferences.purchased[0].quantity, 2);
  assert.equal(model.preferences.viewed[0].sessions, 2);
  assert.ok(model.preferences.options.some(row => row.name === "Size: M"));
  assert.ok(model.preferences.options.some(row => row.name === "Colour: Navy"));
  assert.equal(model.categoryMap.get("cat-1"), "Fashion");
});

test("journey only counts stages when the same session reaches them in order", () => {
  const model = build({
    items: [{ id: "item-1", business_id: businessId, name: "Product", item_type: "product" }],
    events: [
      event("store_visit", "complete-session", 20, { occurred_at: atMinute(20, 9, 0) }),
      event("product_view", "complete-session", 20, { item_id: "item-1", occurred_at: atMinute(20, 9, 1) }),
      event("cart_add", "complete-session", 20, { item_id: "item-1", occurred_at: atMinute(20, 9, 2) }),
      event("checkout_start", "complete-session", 20, { occurred_at: atMinute(20, 9, 3) }),
      event("product_view", "out-of-order", 20, { item_id: "item-1", occurred_at: atMinute(20, 8, 0) }),
      event("store_visit", "out-of-order", 20, { occurred_at: atMinute(20, 9, 0) }),
      event("cart_add", "out-of-order", 20, { item_id: "item-1", occurred_at: atMinute(20, 9, 2) }),
      event("checkout_start", "out-of-order", 20, { occurred_at: atMinute(20, 9, 3) }),
      event("store_visit", "visit-only", 20, { occurred_at: atMinute(20, 11, 0) })
    ],
    orders: [order("placed", { customer_user_id: "buyer", analytics_session_id: "complete-session", created_at: atMinute(20, 9, 4) })]
  });

  assert.deepEqual(model.journey.funnel, { visits: 3, productViews: 1, cartAdds: 1, checkoutStarts: 1, ordersPlaced: 1, completedOrders: 1 });
});

test("custom ranges reject invalid dates and their end date is inclusive", () => {
  const valid = engine.dateRange("custom", { start: "2026-11-01", end: "2026-11-04" }, now);
  const invalid = engine.dateRange("custom", { start: "2026-11-05", end: "2026-11-04" }, now);

  assert.equal(valid.duration, 4);
  assert.equal(engine.dayKey(valid.end), "2026-11-05");
  assert.equal(invalid, null);
});

test("customer insight rules stay quiet below the minimum evidence threshold", () => {
  const orders = [
    order("one", { customer_user_id: "buyer-1" }),
    order("two", { customer_user_id: "buyer-2", created_at: at(22) })
  ];
  const model = build({ orders });

  assert.deepEqual(model.insights, []);
});
