"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const publisherScript = fs.readFileSync(path.join(__dirname, "..", "publisher.js"), "utf8");

function makeElement() {
  const handlers = {};
  const attributes = new Map();
  const element = {
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(type, handler) { handlers[type] = handler; },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    reportValidity() { return true; },
    focus() {},
    click() { handlers.click?.({ currentTarget: element, preventDefault() {} }); },
    handlers,
    attributes
  };
  return element;
}

function makeClient(user, profile) {
  const calls = { signOut: 0, authListeners: 0 };
  const client = {
    calls,
    auth: {
      async getUser() { return { data: { user }, error: null }; },
      onAuthStateChange() { calls.authListeners += 1; },
      async signOut() { calls.signOut += 1; return { error: null }; }
    },
    from(table) {
      const query = {
        selected: false,
        userId: null,
        select() { this.selected = true; return this; },
        eq(_field, value) { this.userId = value; return this; },
        async maybeSingle() {
          return { data: table === "publisher_profiles" && this.userId === user?.id ? profile : null, error: null };
        },
        update() { return this; },
        async single() { return { data: profile, error: null }; }
      };
      return query;
    }
  };
  return client;
}

async function bootPublisher({ customerUser = null, businessUser = null, hasBusinessClient = false } = {}) {
  const elements = new Map();
  const views = ["loading", "choice", "login", "new-account", "verify", "forgot", "password-reset", "publisher-register", "blocked", "dashboard"]
    .map((view) => Object.assign(makeElement(), { dataset: { view }, hidden: view !== "loading" }));
  const signOutButton = makeElement();
  const customerClient = makeClient(customerUser, customerUser ? {
    id: "publisher-a",
    user_id: customerUser.id,
    display_name: "Publisher A",
    status: "active",
    referral_code: "PUBA123456",
    created_at: "2026-11-13T00:00:00Z"
  } : null);
  const businessClient = hasBusinessClient ? makeClient(businessUser, businessUser ? {
    id: "publisher-b",
    user_id: businessUser.id,
    display_name: "Publisher B",
    status: "active",
    referral_code: "PUBB123456",
    created_at: "2026-11-13T00:00:00Z"
  } : null) : null;
  let businessGetterCalls = 0;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === "[data-view]") return views;
      if (selector === "[data-signout]") return [signOutButton];
      return [];
    }
  };
  const window = {
    StoreNestCustomerAuth: {
      async getClient() { return customerClient; },
      async getBusinessClient() { businessGetterCalls += 1; return businessClient; }
    },
    StoreNestBusinessClient: hasBusinessClient ? businessClient : undefined,
    scrollTo() {},
    setTimeout,
    location: { search: "", hash: "", pathname: "/publisher.html", assign() {} },
    history: { pushState() {}, replaceState() {} },
    addEventListener() {}
  };
  vm.runInNewContext(publisherScript, { document, window, console, URLSearchParams, Intl, Date, Promise, Set, Map });
  await new Promise((resolve) => setImmediate(resolve));
  return { customerClient, businessClient, businessGetterCalls, signOutButton };
}

test("Publisher entry does not eagerly create a second StoreNest auth client", async () => {
  const state = await bootPublisher();
  assert.equal(state.businessGetterCalls, 0);
  assert.equal(state.customerClient.calls.authListeners, 1);
});

test("Publisher sign out clears only matching StoreNest sessions", async () => {
  const userA = { id: "customer-user", email: "customer@example.com", user_metadata: { full_name: "Customer User" } };
  const userB = { id: "business-user", email: "business@example.com", user_metadata: { full_name: "Business User" } };
  const state = await bootPublisher({ customerUser: userA, businessUser: userB, hasBusinessClient: true });

  assert.equal(state.customerClient.calls.authListeners, 1);
  assert.equal(state.businessClient.calls.authListeners, 1);
  await state.signOutButton.handlers.click({ currentTarget: state.signOutButton, preventDefault() {} });

  assert.equal(state.customerClient.calls.signOut, 1);
  assert.equal(state.businessClient.calls.signOut, 0);
});

test("Publisher sign out clears duplicate sessions for the same StoreNest user", async () => {
  const user = { id: "same-user", email: "publisher@example.com", user_metadata: { full_name: "Publisher User" } };
  const state = await bootPublisher({ customerUser: user, businessUser: user, hasBusinessClient: true });
  await state.signOutButton.handlers.click({ currentTarget: state.signOutButton, preventDefault() {} });

  assert.equal(state.customerClient.calls.signOut, 1);
  assert.equal(state.businessClient.calls.signOut, 1);
});
