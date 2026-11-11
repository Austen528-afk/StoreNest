(function (root) {
  "use strict";

  const SESSION_KEY = "storenest:analytics-session:v1";
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const VERSION = "v1";
  const inFlight = new Set();
  let memorySession = null;

  function newUuid() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") return root.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (root.crypto && typeof root.crypto.getRandomValues === "function") root.crypto.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function currentSessionId() {
    const now = Date.now();
    let session = null;
    try { session = JSON.parse(root.sessionStorage.getItem(SESSION_KEY) || "null"); } catch (_) { session = memorySession; }
    if (!session || !session.id || !Number.isFinite(Number(session.lastSeen)) || now - Number(session.lastSeen) >= SESSION_IDLE_MS) {
      session = { id: newUuid(), lastSeen: now };
    } else {
      session.lastSeen = now;
    }
    memorySession = session;
    try { root.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* Keep a tab-local in-memory session when storage is unavailable. */ }
    return session.id;
  }

  function client() {
    try { if (typeof storefrontClient !== "undefined" && storefrontClient) return storefrontClient; } catch (_) { /* The storefront has not created its client yet. */ }
    return root.StoreNestBusinessClient || root.StoreNestAnalyticsClient || null;
  }

  function encodeHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async function stableEventId(value) {
    if (!root.crypto || !root.crypto.subtle || typeof root.TextEncoder !== "function") throw new Error("Secure event identifiers are unavailable.");
    const digest = await root.crypto.subtle.digest("SHA-256", new root.TextEncoder().encode(value));
    const bytes = new Uint8Array(digest).slice(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = encodeHex(bytes);
    return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
  }

  function markerKey(sessionId, businessId, eventType, itemId) {
    return ["storenest:analytics-recorded", VERSION, sessionId, businessId, eventType, itemId || "-"] .join(":");
  }

  async function record(businessId, eventType, itemId) {
    const business = String(businessId || "");
    const item = itemId ? String(itemId) : "";
    const validType = ["store_visit", "product_view", "cart_add", "checkout_start"].includes(eventType);
    if (!business || !validType || (["product_view", "cart_add"].includes(eventType) !== Boolean(item))) return null;

    const sessionId = currentSessionId();
    if (eventType !== "store_visit") await record(business, "store_visit");
    const marker = markerKey(sessionId, business, eventType, item);
    const requestKey = marker;
    try { if (root.sessionStorage.getItem(marker) === "1") return sessionId; } catch (_) { /* in-flight guard still prevents duplicate calls on this page */ }
    if (inFlight.has(requestKey)) return sessionId;

    const db = client();
    if (!db) return sessionId;
    inFlight.add(requestKey);
    try {
      const id = await stableEventId([business, sessionId, eventType, item || "-"] .join("|"));
      const { error } = await db.from("storefront_analytics_events").insert({
        id,
        business_id: business,
        event_type: eventType,
        session_id: sessionId,
        item_id: item || null
      });
      if (error && error.code !== "23505") throw error;
      try { root.sessionStorage.setItem(marker, "1"); } catch (_) { /* A database primary key still prevents duplicate rows. */ }
      return sessionId;
    } catch (error) {
      console.warn("StoreNest could not record a storefront analytics event:", error.message || error);
      return sessionId;
    } finally {
      inFlight.delete(requestKey);
    }
  }

  async function ensureVisit(businessId) {
    const sessionId = currentSessionId();
    await record(businessId, "store_visit");
    return sessionId;
  }

  root.StoreNestAnalyticsTracker = Object.freeze({
    visit: ensureVisit,
    productView: (businessId, itemId) => record(businessId, "product_view", itemId),
    cartAdd: (businessId, itemId) => record(businessId, "cart_add", itemId),
    checkoutStart: businessId => record(businessId, "checkout_start"),
    sessionId: currentSessionId
  });
})(typeof window !== "undefined" ? window : globalThis);
