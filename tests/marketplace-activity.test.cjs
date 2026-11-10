"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "marketplace-activity.js"), "utf8");
let clock = Date.parse("2026-11-10T12:00:00.000Z");

class ClockDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEnvironment() {
  const values = new Map();
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
  const window = { localStorage, addEventListener() {} };
  const document = { hidden: false, addEventListener() {} };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    window, document, module, console, Date: ClockDate, setTimeout, clearTimeout
  }, { filename: "marketplace-activity.js" });
  return { api: module.exports, values, window };
}

function ids(rows) {
  return plain(rows).map(row => Array.isArray(row) ? row[0] : row.id);
}

function pause() {
  return new Promise(resolve => setTimeout(resolve, 15));
}

function authClient(userStore, initialUserId) {
  let currentUserId = initialUserId || null;
  let listener = null;
  const cloneUser = user => user ? plain(user) : null;
  return {
    client: {
      auth: {
        onAuthStateChange(callback) {
          listener = callback;
          return { data: { subscription: { unsubscribe() {} } } };
        },
        async getSession() {
          const user = cloneUser(userStore.get(currentUserId));
          return { data: { session: user ? { user } : null }, error: null };
        },
        async getUser() {
          return { data: { user: cloneUser(userStore.get(currentUserId)) }, error: null };
        },
        async updateUser({ data }) {
          const user = userStore.get(currentUserId);
          const updated = {
            ...user,
            user_metadata: { ...(user.user_metadata || {}), ...plain(data) }
          };
          userStore.set(currentUserId, updated);
          return { data: { user: cloneUser(updated) }, error: null };
        }
      }
    },
    emit(event, userId) {
      currentUserId = userId || null;
      const user = cloneUser(userStore.get(currentUserId));
      if (listener) listener(event, user ? { user } : null);
    }
  };
}

test("categories sort by recency, pin state, and stable default order", () => {
  clock = Date.parse("2026-11-10T12:00:00.000Z");
  const api = createEnvironment().api;
  const categories = [
    ["food-drink", "Food"],
    ["electronics", "Electronics"],
    ["fashion", "Fashion"],
    ["groceries", "Groceries"],
    ["home-living", "Home"]
  ];

  assert.deepEqual(ids(api.sortCategories(categories)), ids(categories));
  api.recordCategory("fashion");
  api.recordCategory("electronics");
  assert.deepEqual(ids(api.sortCategories(categories)), [
    "electronics", "fashion", "food-drink", "groceries", "home-living"
  ]);

  api.toggleCategoryPin("food-drink");
  api.toggleCategoryPin("fashion");
  let ordered = ids(api.sortCategories(categories));
  assert.deepEqual(ordered.slice(0, 2), ["food-drink", "fashion"]);

  api.recordCategory("groceries");
  ordered = ids(api.sortCategories(categories));
  assert.deepEqual(ordered.slice(0, 2), ["food-drink", "fashion"]);
  assert.equal(ordered.indexOf("groceries") < ordered.indexOf("electronics"), true);

  api.toggleCategoryPin("fashion");
  ordered = ids(api.sortCategories(categories));
  assert.equal(ordered[0], "food-drink");
  assert.equal(ordered.indexOf("groceries") < ordered.indexOf("electronics"), true);
});

test("business visits reorder without duplicates and preserve pins through clearing", () => {
  clock = Date.parse("2026-11-10T12:00:00.000Z");
  const api = createEnvironment().api;
  const alpha = { slug: "alpha-store", name: "Alpha", category: "food-drink", location: "Town" };
  const beta = { slug: "beta-store", name: "Beta", category: "fashion", location: "Town" };
  const gamma = { slug: "gamma-store", name: "Gamma", category: "electronics", location: "Town" };

  api.recordBusiness(alpha);
  api.recordBusiness(beta);
  assert.deepEqual(plain(api.getBusinesses()).map(row => row.slug), ["beta-store", "alpha-store"]);
  api.recordBusiness(alpha);
  assert.deepEqual(plain(api.getBusinesses()).map(row => row.slug), ["alpha-store", "beta-store"]);
  assert.equal(api.getBusinesses().length, 2);

  api.toggleBusinessPin("alpha-store");
  const preservedVisit = api.getBusinesses().find(row => row.slug === "alpha-store").lastVisitedAt;
  api.clearBusinessHistory();
  assert.deepEqual(plain(api.getBusinesses()).map(row => row.slug), ["alpha-store"]);
  assert.equal(api.isBusinessPinned("alpha-store"), true);
  assert.equal(api.getBusinesses()[0].lastVisitedAt, preservedVisit);

  api.recordBusiness(gamma);
  api.toggleBusinessPin("alpha-store");
  const ordered = plain(api.getBusinesses()).map(row => row.slug);
  assert.deepEqual(ordered, ["gamma-store", "alpha-store"]);
  assert.equal(api.getBusinesses().some(row => row.slug === "beta-store"), false);

  api.toggleBusinessPin("gamma-store");
  api.removeBusinessVisit("gamma-store");
  assert.equal(api.isBusinessPinned("gamma-store"), true);
  assert.equal(api.getBusinesses().some(row => row.slug === "gamma-store"), true);
});

test("account preferences synchronize across devices and stay isolated by user", async () => {
  clock = Date.parse("2026-11-10T12:00:00.000Z");
  const userStore = new Map([
    ["user-a", { id: "user-a", user_metadata: { display_name: "A" } }],
    ["user-b", { id: "user-b", user_metadata: { display_name: "B" } }]
  ]);
  const deviceA = createEnvironment();
  const clientA = authClient(userStore, "user-a");
  await deviceA.api.connect(clientA.client);
  await deviceA.api.ready();

  deviceA.api.recordCategory("fashion");
  deviceA.api.recordBusiness({ slug: "a-store", name: "A Store" });
  deviceA.api.toggleBusinessPin("a-store");
  await deviceA.api.flush();
  assert.ok(userStore.get("user-a").user_metadata.storenest_marketplace_activity_v1);

  const deviceB = createEnvironment();
  const clientB = authClient(userStore, "user-a");
  await deviceB.api.connect(clientB.client);
  await deviceB.api.ready();
  assert.equal(deviceB.api.isCategoryPinned("fashion"), false);
  assert.equal(deviceB.api.isBusinessPinned("a-store"), true);
  assert.deepEqual(deviceB.plain(api.getBusinesses()).map(row => row.slug), ["a-store"]);

  deviceB.api.recordCategory("electronics");
  await deviceB.api.flush();
  await deviceA.api.refresh();
  assert.deepEqual(ids(deviceA.api.sortCategories([
    ["food-drink", "Food"], ["electronics", "Electronics"], ["fashion", "Fashion"]
  ])), ["electronics", "fashion", "food-drink"]);

  clientB.emit("SIGNED_OUT", null);
  await pause();
  clientB.emit("SIGNED_IN", "user-b");
  await pause();
  assert.equal(deviceB.api.isCategoryPinned("fashion"), false);
  assert.equal(deviceB.api.isBusinessPinned("a-store"), false);
  assert.equal(deviceB.api.getSnapshot().categories.electronics, undefined);

  deviceB.api.recordCategory("groceries");
  await deviceB.api.flush();
  clientB.emit("SIGNED_OUT", null);
  await pause();
  clientB.emit("SIGNED_IN", "user-a");
  await pause();
  assert.ok(deviceB.api.getSnapshot().categories.fashion);
  assert.ok(deviceB.api.getSnapshot().categories.electronics);
  assert.equal(deviceB.api.getSnapshot().categories.groceries, undefined);
});

