(function () {
  "use strict";

  const CUSTOMER_TABLE = "storefront_conversations";
  const MESSAGE_TABLE = "storefront_messages";
  const isOwnerPage = Boolean(document.querySelector('[data-section-view="messages"]'));
  const customer = { root: null, client: null, user: null, profileName: "Customer", active: null, rows: [], businessById: new Map(), channel: null, authSubscription: null, timer: null, searchTimer: null, searchToken: 0, previousOverflow: "", pendingConversationId: null };
  const owner = { root: null, client: null, user: null, active: null, rows: [], business: null, businessId: null, channel: null, authSubscription: null, timer: null, loading: false, search: "", pendingConversationId: null };
  let notificationRegistrationPromise = null;
  let messageToastTimer = null;

  function byId(id) { return document.getElementById(id); }
  function make(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value != null) el.textContent = value;
    return el;
  }
  function initials(value) {
    const words = String(value || "StoreNest").trim().split(/\s+/).filter(Boolean);
    return (words.slice(0, 2).map(function (word) { return word[0]; }).join("") || "SN").toUpperCase();
  }
  function setAvatar(el, name, logo) {
    el.textContent = "";
    const safeLogo = /^https:\/\//i.test(String(logo || "")) ? String(logo) : "";
    if (safeLogo) {
      const img = document.createElement("img");
      img.src = safeLogo;
      img.alt = "";
      img.loading = "lazy";
      img.onerror = function () { img.remove(); el.textContent = initials(name); };
      el.appendChild(img);
    } else {
      el.textContent = initials(name);
    }
  }
  function timeLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
    }
    const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
    if (days < 7 && days >= 1) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date);
    return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
  }
  function messageTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  function textError(state, message) {
    const slot = state.refs && state.refs.error;
    if (!slot) return;
    slot.textContent = message || "";
    slot.hidden = !message;
  }
  function messageStatus(state, message, isError) {
    if (!state.refs || !state.refs.status) return;
    state.refs.status.textContent = message || "";
    state.refs.status.style.color = isError ? "#a83b34" : "#208b6e";
  }
  function conversationMarkup(mode) {
    const customerMode = mode === "customer";
    const title = customerMode ? "Messages" : "Inbox";
    const subtitle = customerMode ? "Your StoreNest conversations" : "Private conversations with your customers";
    const placeholder = customerMode ? "Search businesses" : "Search customers or messages";
    return '<section class="sn-message-app" data-mode="' + mode + '">' +
      '<aside class="sn-message-list-pane">' +
        '<header class="sn-message-list-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div>' +
          '<div class="sn-message-head-actions"><button class="sn-message-notifications" type="button" aria-label="Enable message notifications">Enable alerts</button>' +
          (customerMode ? '<button class="sn-message-close" type="button" aria-label="Close messages">×</button>' : '') + '</div>' +
        '</header>' +
        '<label class="sn-message-search-wrap"><span class="sn-message-search-icon" aria-hidden="true">⌕</span><input class="sn-message-search" type="search" autocomplete="off" placeholder="' + placeholder + '" aria-label="' + placeholder + '"></label>' +
        '<div class="sn-message-error" role="status" aria-live="polite" hidden></div>' +
        '<div class="sn-message-results" hidden></div>' +
        '<div class="sn-message-list-label"><span>' + (customerMode ? "Inbox" : "Conversations") + '</span><span class="sn-message-list-count"></span></div>' +
        '<div class="sn-message-list" role="list"></div>' +
      '</aside>' +
      '<main class="sn-message-main">' +
        '<div class="sn-message-empty"><div class="sn-message-empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.5 11.5a8 8 0 0 1-8 8 8.2 8.2 0 0 1-3.6-.83L4 20l1.32-4.27a7.96 7.96 0 1 1 15.18-4.23Z"/><path d="M8.2 11.5h.01M12.2 11.5h.01M16.2 11.5h.01"/></svg></div><h3>' + (customerMode ? "Your messages" : "Customer messages") + '</h3><p>' + (customerMode ? "Search for a business to start a private conversation, or select a chat from your inbox." : "Choose a customer conversation to read and reply. New messages appear here as they arrive.") + '</p></div>' +
        '<section class="sn-message-thread" hidden>' +
          '<header class="sn-message-thread-head"><button class="sn-message-back" type="button" aria-label="Back to conversations">‹</button><div class="sn-message-thread-identity"><span class="sn-message-avatar"></span><div style="min-width:0"><div class="sn-message-thread-name"></div><div class="sn-message-thread-subtitle"></div></div></div></header>' +
          '<div class="sn-message-thread-scroll" aria-live="polite"></div>' +
          '<div class="sn-message-composer-wrap"><div class="sn-message-auth-note" hidden></div><form class="sn-message-compose"><textarea rows="1" maxlength="2000" aria-label="Write a message" placeholder="Start a message"></textarea><button class="sn-message-send" type="submit" aria-label="Send message" disabled><svg viewBox="0 0 24 24"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg></button></form><div class="sn-message-compose-hint">Enter to send · Shift + Enter for a new line</div><div class="sn-message-status" role="status" aria-live="polite"></div></div>' +
        '</section>' +
      '</main>' +
    '</section>';
  }
  function attachRefs(state) {
    const root = state.root;
    state.refs = {
      app: root.querySelector(".sn-message-app"),
      list: root.querySelector(".sn-message-list"),
      listCount: root.querySelector(".sn-message-list-count"),
      search: root.querySelector(".sn-message-search"),
      results: root.querySelector(".sn-message-results"),
      error: root.querySelector(".sn-message-error"),
      empty: root.querySelector(".sn-message-empty"),
      thread: root.querySelector(".sn-message-thread"),
      threadName: root.querySelector(".sn-message-thread-name"),
      threadSubtitle: root.querySelector(".sn-message-thread-subtitle"),
      threadAvatar: root.querySelector(".sn-message-thread-identity .sn-message-avatar"),
      threadBody: root.querySelector(".sn-message-thread-scroll"),
      composeWrap: root.querySelector(".sn-message-composer-wrap"),
      compose: root.querySelector(".sn-message-compose"),
      textarea: root.querySelector(".sn-message-compose textarea"),
      send: root.querySelector(".sn-message-send"),
      authNote: root.querySelector(".sn-message-auth-note"),
      status: root.querySelector(".sn-message-status"),
      close: root.querySelector(".sn-message-close"),
      notifications: root.querySelector(".sn-message-notifications"),
      back: root.querySelector(".sn-message-back")
    };
  }
  function avatar(name, logo) {
    const el = make("span", "sn-message-avatar");
    setAvatar(el, name, logo);
    return el;
  }
  function renderList(state, mode) {
    const rows = state.rows || [];
    state.refs.list.replaceChildren();
    state.refs.listCount.textContent = rows.length ? String(rows.length) : "";
    if (!rows.length) {
      const empty = make("div", "sn-message-empty-list");
      const title = mode === "owner"
        ? (state.businessId ? "No messages yet" : "Choose a business")
        : (state.user ? "No conversations yet" : "Sign in to see your inbox");
      const detail = mode === "owner"
        ? (state.businessId ? "Customer messages to this storefront will appear here." : "Select a business from the dashboard header to view its messages.")
        : (state.user ? "Search for a business above to start a private chat." : "Your private conversations will be saved after you sign in.");
      const strong = make("strong", "", title);
      empty.appendChild(strong);
      empty.appendChild(document.createTextNode(detail));
      state.refs.list.appendChild(empty);
      return;
    }
    const filtered = mode === "owner" && state.search
      ? rows.filter(function (row) {
          return (String(row.customer_label || "") + " " + String(row.last_message_preview || "")).toLowerCase().includes(state.search.toLowerCase());
        })
      : rows;
    if (!filtered.length) {
      const empty = make("div", "sn-message-empty-list", "No conversations match that search.");
      state.refs.list.appendChild(empty);
      return;
    }
    filtered.forEach(function (row) {
      const name = mode === "owner" ? (row.customer_label || "Customer") : (row.business && row.business.name || "StoreNest business");
      const logo = mode === "owner" ? "" : (row.business && row.business.logo_url || "");
      const button = make("button", "sn-message-row" + (state.active && state.active.conversation && state.active.conversation.id === row.id ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.appendChild(avatar(name, logo));
      const body = make("span", "sn-message-row-body");
      const top = make("span", "sn-message-row-top");
      top.appendChild(make("span", "sn-message-row-name", name));
      top.appendChild(make("span", "sn-message-row-time", timeLabel(row.updated_at || row.last_message_at || row.created_at)));
      body.appendChild(top);
      const previewText = row.last_message_preview || "Start the conversation";
      body.appendChild(make("span", "sn-message-row-preview", (row.last_message_sender_id && state.user && row.last_message_sender_id === state.user.id ? "You: " : "") + previewText));
      button.appendChild(body);
      if (row.unread_count) button.appendChild(make("span", "sn-message-unread", row.unread_count > 99 ? "99+" : String(row.unread_count)));
      button.addEventListener("click", function () {
        const business = mode === "customer" ? (row.business || {}) : (state.business || {});
        openThread(state, mode, { conversation: row, business: business });
      });
      state.refs.list.appendChild(button);
    });
  }
  function showBusinessResults(results, query) {
    const box = customer.refs.results;
    box.replaceChildren();
    if (!query) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const label = make("div", "sn-message-results-label", "Businesses");
    box.appendChild(label);
    if (!results.length) {
      box.appendChild(make("div", "sn-message-empty-list", "No published businesses match that name."));
      return;
    }
    results.forEach(function (business) {
      const button = make("button", "sn-business-result");
      button.type = "button";
      button.appendChild(avatar(business.name, business.logo_url));
      const body = make("span", "sn-message-row-body");
      body.appendChild(make("span", "sn-message-row-name", business.name || "StoreNest business"));
      body.appendChild(make("span", "sn-message-row-preview", [business.category, business.location].filter(Boolean).join(" · ") || "Published StoreNest business"));
      button.appendChild(body);
      button.appendChild(make("span", "sn-message-row-time", "Message"));
      button.addEventListener("click", function () {
        const existing = customer.rows.find(function (row) { return row.business_id === business.id; });
        if (existing) openThread(customer, "customer", { conversation: existing, business: existing.business || business });
        else openThread(customer, "customer", { conversation: null, business: business });
      });
      box.appendChild(button);
    });
  }
  async function searchBusinesses(query) {
    const normalized = String(query || "").trim();
    const token = ++customer.searchToken;
    if (normalized.length < 2) {
      showBusinessResults([], normalized);
      if (normalized) {
        customer.refs.results.replaceChildren();
        customer.refs.results.hidden = false;
        customer.refs.results.appendChild(make("div", "sn-message-empty-list", "Type at least 2 characters to search."));
      }
      return;
    }
    try {
      if (!customer.client) customer.client = await window.StoreNestCustomerAuth.getClient();
      const result = await customer.client.from("businesses")
        .select("id,name,slug,category,location,logo_url")
        .eq("is_published", true)
        .ilike("name", "%" + normalized + "%")
        .order("name", { ascending: true })
        .limit(12);
      if (token !== customer.searchToken) return;
      if (result.error) throw result.error;
      showBusinessResults(result.data || [], normalized);
    } catch (error) {
      if (token !== customer.searchToken) return;
      showBusinessResults([], normalized);
      textError(customer, error.message || "Could not search businesses. Try again.");
    }
  }
  function publishCustomerUnreadCount(count) {
    const unreadCount = Math.max(0, Math.floor(Number(count) || 0));
    window.StoreNestCustomerUnreadCount = unreadCount;
    window.dispatchEvent(new CustomEvent("storenest:customer-unread-count", { detail: { count: unreadCount } }));
  }
  async function loadCustomerInbox() {
    if (!customer.client || !customer.user) {
      customer.rows = [];
      publishCustomerUnreadCount(0);
      renderList(customer, "customer");
      return;
    }
    const result = await customer.client.from(CUSTOMER_TABLE)
      .select("id,business_id,customer_id,customer_label,created_at,updated_at,last_message_at,last_message_preview,last_message_sender_id")
      .eq("customer_id", customer.user.id)
      .not("last_message_at", "is", null)
      .order("updated_at", { ascending: false });
    if (result.error) throw result.error;
    const rows = result.data || [];
    const ids = rows.map(function (row) { return row.business_id; }).filter(Boolean);
    const conversationIds = rows.map(function (row) { return row.id; }).filter(Boolean);
    const [businessResult, unreadResult] = await Promise.all([
      ids.length ? customer.client.from("businesses").select("id,name,slug,category,location,logo_url").in("id", ids) : Promise.resolve({ data: [], error: null }),
      conversationIds.length ? customer.client.from(MESSAGE_TABLE).select("conversation_id").in("conversation_id", conversationIds).is("read_at", null).neq("sender_id", customer.user.id) : Promise.resolve({ data: [], error: null })
    ]);
    if (businessResult.error) throw businessResult.error;
    if (unreadResult.error) throw unreadResult.error;
    customer.businessById = new Map((businessResult.data || []).map(function (business) { return [business.id, business]; }));
    const unread = new Map();
    (unreadResult.data || []).forEach(function (message) { unread.set(message.conversation_id, (unread.get(message.conversation_id) || 0) + 1); });
    customer.rows = rows.map(function (row) {
      const copy = Object.assign({}, row, { business: customer.businessById.get(row.business_id) || null, unread_count: unread.get(row.id) || 0 });
      return copy;
    });
    if (customer.active && customer.active.conversation) {
      const refreshed = customer.rows.find(function (row) { return row.id === customer.active.conversation.id; });
      if (refreshed) customer.active.conversation = refreshed;
    }
    publishCustomerUnreadCount(customer.rows.reduce(function (total, row) {
      return total + (Number(row.unread_count) || 0);
    }, 0));
    renderList(customer, "customer");
    openPendingConversation(customer, "customer");
  }
  async function loadOwnerConversations() {
    if (!owner.client || !owner.user) {
      owner.rows = [];
      renderList(owner, "owner");
      return;
    }
    if (!owner.businessId) {
      owner.rows = [];
      renderList(owner, "owner");
      return;
    }
    const result = await owner.client.from(CUSTOMER_TABLE)
      .select("id,business_id,customer_id,customer_label,created_at,updated_at,last_message_at,last_message_preview,last_message_sender_id")
      .eq("business_id", owner.businessId)
      .not("last_message_at", "is", null)
      .order("updated_at", { ascending: false });
    if (result.error) throw result.error;
    const rows = result.data || [];
    const ids = rows.map(function (row) { return row.id; }).filter(Boolean);
    const unreadResult = ids.length
      ? await owner.client.from(MESSAGE_TABLE).select("conversation_id").in("conversation_id", ids).is("read_at", null).neq("sender_id", owner.user.id)
      : { data: [], error: null };
    if (unreadResult.error) throw unreadResult.error;
    const unread = new Map();
    (unreadResult.data || []).forEach(function (message) { unread.set(message.conversation_id, (unread.get(message.conversation_id) || 0) + 1); });
    owner.rows = rows.map(function (row) { return Object.assign({}, row, { unread_count: unread.get(row.id) || 0 }); });
    if (owner.active && owner.active.conversation) {
      const refreshed = owner.rows.find(function (row) { return row.id === owner.active.conversation.id; });
      if (refreshed) owner.active.conversation = refreshed;
    }
    renderList(owner, "owner");
    openPendingConversation(owner, "owner");
  }
  async function refreshOwnerBadge() {
    if (!owner.client || !owner.user) return;
    const conversations = await owner.client.from(CUSTOMER_TABLE).select("id").not("last_message_at", "is", null);
    if (conversations.error) return;
    const ids = (conversations.data || []).map(function (row) { return row.id; });
    if (!ids.length) {
      setOwnerBadge(0);
      return;
    }
    const result = await owner.client.from(MESSAGE_TABLE).select("id", { count: "exact", head: true })
      .in("conversation_id", ids).is("read_at", null).neq("sender_id", owner.user.id);
    if (!result.error) setOwnerBadge(result.count || 0);
  }
  function setOwnerBadge(count) {
    document.querySelectorAll('[data-owner-nav-badge="messages"]').forEach(function (badge) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = count < 1;
    });
  }
  function ensureNotificationServiceWorker() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    if (!notificationRegistrationPromise) {
      notificationRegistrationPromise = navigator.serviceWorker.register("/sw.js").then(function (registration) {
        return registration.active ? registration : navigator.serviceWorker.ready;
      }).catch(function () { return null; });
    }
    return notificationRegistrationPromise;
  }
  function updateNotificationButton(button) {
    if (!button) return;
    if (!("Notification" in window)) {
      button.textContent = "Alerts unavailable";
      button.disabled = true;
      button.title = "This browser does not support notifications.";
      return;
    }
    const permission = Notification.permission;
    button.disabled = permission === "granted";
    button.textContent = permission === "granted" ? "Alerts on" : permission === "denied" ? "Alerts blocked" : "Enable alerts";
    button.title = permission === "denied" ? "Allow notifications for StoreNest in your browser settings." : permission === "granted" ? "StoreNest notifications are enabled on this device." : "Allow pop-up notifications for new messages and read receipts.";
  }
  async function enableMessageNotifications() {
    if (!("Notification" in window)) {
      showMessageToast("Notifications unavailable", "This browser does not support desktop notifications.");
      return;
    }
    if (Notification.permission === "denied") {
      showMessageToast("Notifications are blocked", "Allow notifications for StoreNest in your browser or device settings.");
      return;
    }
    try {
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      document.querySelectorAll(".sn-message-notifications").forEach(updateNotificationButton);
      if (permission === "granted") {
        await ensureNotificationServiceWorker();
        showMessageToast("Notifications enabled", "You’ll get pop-up alerts for new messages and when your message is viewed.");
      }
    } catch (error) {
      showMessageToast("Could not enable notifications", error.message || "Check your browser notification settings.");
    }
  }
  function showMessageToast(title, body, mode, conversationId) {
    let host = byId("storenestMessageToast");
    if (!host) {
      host = make("div", "sn-message-toast-host");
      host.id = "storenestMessageToast";
      host.setAttribute("aria-live", "polite");
      host.setAttribute("aria-atomic", "true");
      document.body.appendChild(host);
    }
    host.replaceChildren();
    const toast = make("button", "sn-message-toast");
    toast.type = "button";
    const copy = make("span", "sn-message-toast-copy");
    copy.appendChild(make("strong", "sn-message-toast-title", title));
    copy.appendChild(make("span", "sn-message-toast-body", String(body || "").slice(0, 180)));
    toast.appendChild(copy);
    toast.appendChild(make("span", "sn-message-toast-arrow", "›"));
    if (mode && conversationId) toast.addEventListener("click", function () { focusMessageConversation(mode, conversationId); });
    host.appendChild(toast);
    clearTimeout(messageToastTimer);
    messageToastTimer = setTimeout(function () { host.replaceChildren(); }, 7000);
  }
  function showDesktopMessageNotification(title, body, mode, conversationId, eventKey) {
    if (!("Notification" in window) || Notification.permission !== "granted") return Promise.resolve(false);
    const options = {
      body: String(body || "").slice(0, 180),
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "storenest-message-" + eventKey,
      renotify: true,
      data: { type: "storenest-message", mode: mode, conversationId: conversationId }
    };
    return ensureNotificationServiceWorker().then(function (registration) {
      if (registration && registration.showNotification) return registration.showNotification(title, options).then(function () { return true; });
      const notification = new Notification(title, options);
      notification.onclick = function () { window.focus(); focusMessageConversation(mode, conversationId); notification.close(); };
      return true;
    }).catch(function () { return false; });
  }
  function notificationConversationVisible(state, mode, conversationId) {
    if (document.visibilityState !== "visible" || !state.refs || !state.active || !state.active.conversation) return false;
    if (state.active.conversation.id !== conversationId || state.refs.thread.hidden) return false;
    if (mode === "customer") return Boolean(customer.root && !customer.root.hidden);
    const section = document.querySelector('[data-section-view="messages"]');
    return Boolean(section && !section.hidden);
  }
  function claimMessageNotification(userId, key) {
    const storageKey = "storenest:message-notifications:" + userId;
    const now = Date.now();
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      const recent = stored && typeof stored === "object" ? stored : {};
      if (now - Number(recent[key] || 0) < 30000) return false;
      Object.keys(recent).forEach(function (oldKey) {
        if (now - Number(recent[oldKey] || 0) >= 30000) delete recent[oldKey];
      });
      recent[key] = now;
      const keys = Object.keys(recent);
      while (keys.length > 30) delete recent[keys.shift()];
      localStorage.setItem(storageKey, JSON.stringify(recent));
    } catch (_) {}
    return true;
  }
  async function notificationConversation(state, mode, message) {
    let row = (state.rows || []).find(function (conversation) { return conversation.id === message.conversation_id; }) || null;
    if (!row && state.client) {
      const result = await state.client.from(CUSTOMER_TABLE)
        .select("id,business_id,customer_id,customer_label,created_at,updated_at,last_message_at,last_message_preview,last_message_sender_id")
        .eq("id", message.conversation_id).maybeSingle();
      if (!result.error) row = result.data;
    }
    if (mode === "owner") return { row: row, name: row && row.customer_label || "Customer" };
    let business = row && row.business || state.businessById.get(row && row.business_id);
    if (!business && row && row.business_id && state.client) {
      const result = await state.client.from("businesses").select("id,name,slug,category,location,logo_url").eq("id", row.business_id).maybeSingle();
      if (!result.error) business = result.data;
      if (business) state.businessById.set(business.id, business);
    }
    return { row: row, business: business, name: business && business.name || "StoreNest business" };
  }
  async function processMessageNotification(state, mode, payload) {
    const message = payload && payload.new;
    if (!state.user || !message || !message.id || !message.conversation_id) return;
    let kind = "";
    if (payload.eventType === "INSERT" && message.sender_id !== state.user.id) kind = "message";
    else if (payload.eventType === "UPDATE" && message.sender_id === state.user.id && message.read_at) kind = "viewed";
    if (!kind || notificationConversationVisible(state, mode, message.conversation_id)) return;
    if (document.visibilityState !== "visible" && (!("Notification" in window) || Notification.permission !== "granted")) return;
    const eventKey = kind === "viewed"
      ? "viewed:" + message.conversation_id + ":" + message.read_at
      : "message:" + message.id;
    if (!claimMessageNotification(state.user.id, eventKey)) return;
    const context = await notificationConversation(state, mode, message);
    const title = kind === "viewed" ? context.name + " viewed your message" : "New message from " + context.name;
    const body = kind === "viewed" ? "Your message was seen." : String(message.body || "You have a new message.").slice(0, 180);
    if (document.visibilityState === "visible") showMessageToast(title, body, mode, message.conversation_id);
    else await showDesktopMessageNotification(title, body, mode, message.conversation_id, eventKey);
  }
  function focusMessageConversation(mode, conversationId) {
    if (!conversationId) return;
    if (mode === "owner" && isOwnerPage) {
      owner.pendingConversationId = conversationId;
      const nav = document.querySelector('.side-link[data-section="messages"]');
      if (nav) nav.click();
      else openOwnerInbox().catch(function () {});
      return;
    }
    if (mode === "customer" && !isOwnerPage) {
      customer.pendingConversationId = conversationId;
      openCustomerCentre().catch(function (error) { console.error("StoreNest Chat Centre:", error); });
    }
  }
  function openPendingConversation(state, mode) {
    if (!state.pendingConversationId) return;
    const row = (state.rows || []).find(function (conversation) { return conversation.id === state.pendingConversationId; });
    if (!row) return;
    state.pendingConversationId = null;
    const business = mode === "customer" ? (row.business || {}) : (state.business || {});
    openThread(state, mode, { conversation: row, business: business });
  }
  function handleNotificationRoute() {
    const params = new URLSearchParams(location.search);
    const conversationId = params.get("storenestMessageConversation");
    const mode = params.get("storenestMessageMode");
    if (!conversationId) return;
    params.delete("storenestMessageConversation");
    params.delete("storenestMessageMode");
    const query = params.toString();
    history.replaceState(history.state, "", location.pathname + (query ? "?" + query : "") + location.hash);
    if (mode === "owner" && isOwnerPage) {
      owner.pendingConversationId = conversationId;
      const nav = document.querySelector('.side-link[data-section="messages"]');
      if (nav) nav.click();
      else openOwnerInbox().catch(function () {});
    } else if (mode !== "owner" && !isOwnerPage) {
      customer.pendingConversationId = conversationId;
      openCustomerCentre().catch(function () {});
    }
  }
  function listenForNotificationClicks() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", function (event) {
      const message = event.data;
      if (message && message.type === "storenest:open-message") focusMessageConversation(message.mode, message.conversationId);
    });
    ensureNotificationServiceWorker().catch(function () {});
  }
  async function loadBusiness(businessId) {
    if (!owner.client || !businessId) return null;
    const result = await owner.client.from("businesses").select("id,name,slug,logo_url").eq("id", businessId).maybeSingle();
    if (result.error) throw result.error;
    return result.data || null;
  }
  async function markIncomingRead(state, conversation, mode) {
    if (!state.client || !state.user || !conversation || !conversation.id) return;
    const result = await state.client.from(MESSAGE_TABLE).update({ read_at: new Date().toISOString() })
      .eq("conversation_id", conversation.id)
      .neq("sender_id", state.user.id)
      .is("read_at", null);
    if (result.error) console.warn("StoreNest message read receipt could not be saved:", result.error.message);
    if (mode === "owner") await refreshOwnerBadge();
    else if (mode === "customer") await loadCustomerInbox().catch(function (error) { textError(customer, error.message); });
  }
  async function loadThreadMessages(state, mode) {
    const active = state.active;
    if (!active || !active.conversation || !active.conversation.id || !state.client) {
      renderThreadMessages(state, [], mode);
      return;
    }
    const result = await state.client.from(MESSAGE_TABLE)
      .select("id,conversation_id,sender_id,body,created_at,read_at")
      .eq("conversation_id", active.conversation.id)
      .order("created_at", { ascending: true })
      .limit(300);
    if (result.error) {
      messageStatus(state, result.error.message || "Could not load this conversation.", true);
      return;
    }
    renderThreadMessages(state, result.data || [], mode);
    await markIncomingRead(state, active.conversation, mode);
  }
  function renderThreadMessages(state, messages, mode) {
    const body = state.refs.threadBody;
    body.replaceChildren();
    if (!messages.length) {
      body.appendChild(make("div", "sn-message-thread-placeholder", mode === "customer" ? "Send a message to start this conversation." : "This conversation has no messages yet."));
      return;
    }
    messages.forEach(function (message) {
      const mine = state.user && message.sender_id === state.user.id;
      const row = make("div", "sn-message-bubble-row" + (mine ? " is-mine" : ""));
      const bubble = make("div", "sn-message-bubble", message.body);
      row.appendChild(bubble);
      const meta = make("div", "sn-message-meta", messageTime(message.created_at));
      if (mine && message.read_at) meta.appendChild(make("span", "sn-message-seen", "Seen"));
      row.appendChild(meta);
      body.appendChild(row);
    });
    body.scrollTop = body.scrollHeight;
  }
  function openThread(state, mode, active) {
    state.active = active;
    textError(state, "");
    messageStatus(state, "", false);
    state.refs.empty.hidden = true;
    state.refs.thread.hidden = false;
    state.refs.app.classList.add("is-thread-open");
    const displayName = mode === "owner"
      ? (active.conversation.customer_label || "Customer")
      : (active.business && active.business.name || "StoreNest business");
    const subtitle = mode === "owner"
      ? (state.business && state.business.name || "StoreNest business")
      : (active.business && [active.business.category, active.business.location].filter(Boolean).join(" · ") || "Private business conversation");
    state.refs.threadName.textContent = displayName;
    state.refs.threadSubtitle.textContent = subtitle;
    setAvatar(state.refs.threadAvatar, displayName, mode === "customer" ? active.business && active.business.logo_url : "");
    const loggedIn = Boolean(state.user);
    state.refs.authNote.hidden = loggedIn;
    state.refs.composeWrap.hidden = false;
    state.refs.compose.hidden = !loggedIn;
    if (!loggedIn && mode === "customer") {
      state.refs.authNote.replaceChildren();
      state.refs.authNote.appendChild(document.createTextNode("Sign in to send and save private messages. "));
      const link = make("a", "", "Sign in");
      link.href = "/customer-account.html#login";
      state.refs.authNote.appendChild(link);
    }
    state.refs.textarea.value = "";
    state.refs.send.disabled = true;
    if (loggedIn) state.refs.textarea.focus({ preventScroll: true });
    loadThreadMessages(state, mode).catch(function (error) { messageStatus(state, error.message, true); });
  }
  async function sendMessage(state, mode, event) {
    event.preventDefault();
    if (!state.user || !state.client || !state.active) return;
    const body = String(state.refs.textarea.value || "").trim();
    if (!body) return;
    if (body.length > 2000) {
      messageStatus(state, "Messages can be up to 2,000 characters.", true);
      return;
    }
    state.refs.send.disabled = true;
    messageStatus(state, "Sending…", false);
    try {
      let conversation = state.active.conversation;
      if (!conversation || !conversation.id) {
        const insert = await state.client.from(CUSTOMER_TABLE).insert({
          business_id: state.active.business.id,
          customer_id: state.user.id,
          customer_label: state.profileName || "Customer"
        }).select("id,business_id,customer_id,customer_label,created_at,updated_at,last_message_at,last_message_preview,last_message_sender_id").single();
        if (insert.error && insert.error.code === "23505") {
          const existing = await state.client.from(CUSTOMER_TABLE).select("id,business_id,customer_id,customer_label,created_at,updated_at,last_message_at,last_message_preview,last_message_sender_id")
            .eq("business_id", state.active.business.id).eq("customer_id", state.user.id).single();
          if (existing.error) throw existing.error;
          conversation = existing.data;
        } else if (insert.error) {
          throw insert.error;
        } else {
          conversation = insert.data;
        }
        state.active.conversation = conversation;
      }
      const sent = await state.client.from(MESSAGE_TABLE).insert({
        conversation_id: conversation.id,
        sender_id: state.user.id,
        body: body
      });
      if (sent.error) throw sent.error;
      state.refs.textarea.value = "";
      state.refs.textarea.style.height = "auto";
      messageStatus(state, "", false);
      await Promise.all([
        mode === "customer" ? loadCustomerInbox() : loadOwnerConversations(),
        loadThreadMessages(state, mode)
      ]);
      state.refs.textarea.focus({ preventScroll: true });
    } catch (error) {
      messageStatus(state, error.message || "Message could not be sent. Please try again.", true);
      state.refs.send.disabled = !String(state.refs.textarea.value || "").trim();
    }
  }
  function bindShell(state, mode) {
    state.refs.search.addEventListener("input", function () {
      if (mode === "customer") {
        clearTimeout(state.searchTimer);
        const query = state.refs.search.value.trim();
        textError(state, "");
        state.searchTimer = setTimeout(function () { searchBusinesses(query); }, 240);
      } else {
        state.search = state.refs.search.value.trim();
        renderList(state, "owner");
      }
    });
    state.refs.compose.addEventListener("submit", function (event) { sendMessage(state, mode, event); });
    state.refs.textarea.addEventListener("input", function () {
      state.refs.textarea.style.height = "auto";
      state.refs.textarea.style.height = Math.min(state.refs.textarea.scrollHeight, 120) + "px";
      state.refs.send.disabled = !String(state.refs.textarea.value || "").trim() || !state.user;
    });
    state.refs.textarea.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        if (!state.refs.send.disabled) state.refs.compose.requestSubmit();
      }
    });
    if (state.refs.back) state.refs.back.addEventListener("click", function () { state.refs.app.classList.remove("is-thread-open"); });
    if (state.refs.close) state.refs.close.addEventListener("click", closeCustomerCentre);
    if (state.refs.notifications) {
      updateNotificationButton(state.refs.notifications);
      state.refs.notifications.addEventListener("click", function () { enableMessageNotifications(); });
    }
  }
  function makeCustomerShell() {
    if (customer.root) return;
    const overlay = make("div", "sn-chat-overlay");
    overlay.id = "storenestChatCentre";
    overlay.hidden = true;
    overlay.innerHTML = conversationMarkup("customer");
    document.body.appendChild(overlay);
    customer.root = overlay;
    attachRefs(customer);
    bindShell(customer, "customer");
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) closeCustomerCentre();
    });
  }
  async function openCustomerCentre() {
    makeCustomerShell();
    customer.previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    customer.root.hidden = false;
    customer.refs.app.classList.remove("is-thread-open");
    customer.refs.thread.hidden = true;
    customer.refs.empty.hidden = false;
    customer.refs.search.value = "";
    customer.refs.results.hidden = true;
    textError(customer, "");
    messageStatus(customer, "", false);
    customer.refs.list.replaceChildren(make("div", "sn-message-empty-list", "Loading your conversations…"));
    try {
      customer.client = await window.StoreNestCustomerAuth.getClient();
      const auth = await customer.client.auth.getUser();
      customer.user = auth.data && auth.data.user || null;
      customer.profileName = customer.user ? String(customer.user.user_metadata && (customer.user.user_metadata.full_name || customer.user.user_metadata.name) || "Customer").trim().slice(0, 100) : "Customer";
      if (customer.user) {
        try {
          const profile = await window.StoreNestCustomerAuth.getProfile(customer.user.id);
          if (profile && profile.profile_name) customer.profileName = profile.profile_name;
        } catch (_) {}
      }
      await loadCustomerInbox();
      ensureCustomerRealtime();
      openPendingConversation(customer, "customer");
      customer.refs.search.focus({ preventScroll: true });
    } catch (error) {
      textError(customer, error.message || "Messages are unavailable right now.");
      customer.refs.list.replaceChildren(make("div", "sn-message-empty-list", "Could not load your inbox. Check your connection and try again."));
    }
  }
  function closeCustomerCentre() {
    if (!customer.root) return;
    customer.root.hidden = true;
    document.body.style.overflow = customer.previousOverflow || "";
    customer.refs.app.classList.remove("is-thread-open");
  }
  function ensureCustomerRealtime() {
    if (!customer.client || !customer.user || customer.channel) return;
    customer.channel = customer.client.channel("storenest-customer-messages-" + customer.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: CUSTOMER_TABLE }, function (payload) {
        queueCustomerRefresh(payload);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: MESSAGE_TABLE }, function (payload) {
        processMessageNotification(customer, "customer", payload).catch(function () {});
        queueCustomerRefresh(payload);
      })
      .subscribe();
  }
  function queueCustomerRefresh(payload) {
    clearTimeout(customer.timer);
    customer.timer = setTimeout(function () {
      loadCustomerInbox().catch(function (error) { textError(customer, error.message); });
      const active = customer.active && customer.active.conversation;
      const changed = payload && payload.new && (payload.new.conversation_id || payload.new.id);
      const chatCentreVisible = customer.root && !customer.root.hidden;
      if (chatCentreVisible && active && active.id && (!changed || changed === active.id || (payload.new && payload.new.conversation_id === active.id))) {
        loadThreadMessages(customer, "customer").catch(function () {});
      }
    }, 120);
  }
  function currentOwnerBusinessId() {
    const select = byId("businessSelect");
    return select && select.value || owner.businessId || null;
  }
  async function attachOwnerClient(client) {
    if (!client || !isOwnerPage) return;
    owner.client = client;
    const auth = await client.auth.getUser();
    owner.user = auth.data && auth.data.user || null;
    if (owner.user) {
      owner.businessId = currentOwnerBusinessId();
      owner.business = await loadBusiness(owner.businessId).catch(function () { return null; });
      ensureOwnerRealtime();
      await refreshOwnerBadge();
      if (owner.refs && !byId("messagesSection")?.hidden) refreshOwnerInbox().catch(function (error) { textError(owner, error.message); });
    }
    if (!owner.authSubscription) {
      owner.authSubscription = client.auth.onAuthStateChange(function (event, session) {
        if (!session || !session.user) {
          owner.user = null;
          owner.active = null;
          owner.rows = [];
          if (owner.channel) client.removeChannel(owner.channel);
          owner.channel = null;
          setOwnerBadge(0);
          if (owner.refs) renderList(owner, "owner");
          return;
        }
        owner.user = session.user;
        ensureOwnerRealtime();
        refreshOwnerBadge().catch(function () {});
        if (owner.refs && byId("messagesSection") && !byId("messagesSection").hidden) refreshOwnerInbox().catch(function () {});
      });
    }
  }
  async function openOwnerInbox() {
    if (!owner.root) makeOwnerShell();
    owner.businessId = currentOwnerBusinessId();
    if (!owner.client && window.StoreNestBusinessClient) await attachOwnerClient(window.StoreNestBusinessClient);
    if (!owner.user) {
      owner.rows = [];
      renderList(owner, "owner");
      return;
    }
    owner.business = await loadBusiness(owner.businessId).catch(function () { return null; });
    await refreshOwnerInbox();
  }
  async function refreshOwnerInbox() {
    if (!owner.client || !owner.user || !owner.root) return;
    owner.businessId = currentOwnerBusinessId();
    owner.business = await loadBusiness(owner.businessId).catch(function () { return null; });
    try {
      await loadOwnerConversations();
      await refreshOwnerBadge();
      if (owner.active && owner.active.conversation && !owner.rows.some(function (row) { return row.id === owner.active.conversation.id; })) {
        owner.active = null;
        owner.refs.thread.hidden = true;
        owner.refs.empty.hidden = false;
        owner.refs.app.classList.remove("is-thread-open");
      }
    } catch (error) {
      textError(owner, error.message || "Could not load customer conversations.");
    }
  }
  function ensureOwnerRealtime() {
    if (!owner.client || !owner.user || owner.channel) return;
    owner.channel = owner.client.channel("storenest-owner-messages-" + owner.user.id)
      .on("postgres_changes", { event: "*", schema: "public", table: CUSTOMER_TABLE }, function () {
        queueOwnerRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: MESSAGE_TABLE }, function (payload) {
        processMessageNotification(owner, "owner", payload).catch(function () {});
        queueOwnerRefresh(payload);
      })
      .subscribe();
  }
  function queueOwnerRefresh(payload) {
    clearTimeout(owner.timer);
    owner.timer = setTimeout(function () {
      refreshOwnerBadge().catch(function () {});
      const messagesSection = document.querySelector('[data-section-view="messages"]');
      if (messagesSection && !messagesSection.hidden) {
        refreshOwnerInbox().catch(function (error) { textError(owner, error.message); });
        const active = owner.active && owner.active.conversation;
        const changed = payload && payload.new && (payload.new.conversation_id || payload.new.id);
        if (active && active.id && (!changed || changed === active.id || (payload.new && payload.new.conversation_id === active.id))) {
          loadThreadMessages(owner, "owner").catch(function () {});
        }
      }
    }, 140);
  }
  function makeOwnerShell() {
    if (owner.root) return;
    const target = byId("ownerMessageCentre");
    if (!target) return;
    target.replaceChildren();
    const shell = make("div", "sn-owner-message-centre");
    shell.innerHTML = conversationMarkup("owner");
    target.appendChild(shell);
    owner.root = shell;
    attachRefs(owner);
    bindShell(owner, "owner");
  }
  function startOwnerWatch() {
    if (!isOwnerPage) return;
    makeOwnerShell();
    if (window.StoreNestBusinessClient) attachOwnerClient(window.StoreNestBusinessClient).catch(function () {});
    window.addEventListener("storenest:business-client-ready", function (event) {
      attachOwnerClient(event.detail && event.detail.client || window.StoreNestBusinessClient).catch(function () {});
    });
    window.addEventListener("storenest:owner-messages-open", function () {
      openOwnerInbox().catch(function (error) { textError(owner, error.message); });
    });
    window.addEventListener("storenest:owner-business-ready", function (event) {
      const businessId = event.detail && event.detail.businessId || currentOwnerBusinessId();
      owner.businessId = businessId;
      if (owner.root) {
        owner.businessId = currentOwnerBusinessId();
        loadBusiness(owner.businessId).then(function (business) { owner.business = business; }).catch(function () {});
        const messagesSection = document.querySelector('[data-section-view="messages"]');
        if (messagesSection && !messagesSection.hidden) openOwnerInbox().catch(function (error) { textError(owner, error.message); });
      }
    });
  }
  function applyCustomerSession(user) {
    const previousId = customer.user && customer.user.id;
    const nextId = user && user.id;
    if (previousId !== nextId && customer.channel && customer.client) {
      customer.client.removeChannel(customer.channel);
      customer.channel = null;
    }
    customer.user = user || null;
    customer.profileName = customer.user
      ? String(customer.user.user_metadata && (customer.user.user_metadata.profile_name || customer.user.user_metadata.full_name || customer.user.user_metadata.name) || "Customer").trim().slice(0, 100)
      : "Customer";
    if (!customer.user) {
      customer.rows = [];
      publishCustomerUnreadCount(0);
      customer.active = null;
      if (customer.refs) renderList(customer, "customer");
      return;
    }
    const userId = customer.user.id;
    ensureCustomerRealtime();
    setTimeout(async function () {
      if (!customer.user || customer.user.id !== userId) return;
      try {
        const profile = await window.StoreNestCustomerAuth.getProfile(userId);
        if (profile && profile.profile_name && customer.user && customer.user.id === userId) customer.profileName = profile.profile_name;
      } catch (_) {}
      loadCustomerInbox().catch(function () {});
    }, 0);
  }
  async function startCustomerWatch() {
    if (isOwnerPage || !window.StoreNestCustomerAuth) return;
    makeCustomerShell();
    try {
      customer.client = await window.StoreNestCustomerAuth.getClient();
      if (!customer.authSubscription) {
        const listener = customer.client.auth.onAuthStateChange(function (_event, session) {
          setTimeout(function () { applyCustomerSession(session && session.user || null); }, 0);
        });
        customer.authSubscription = listener.data && listener.data.subscription || null;
      }
      const auth = await customer.client.auth.getUser();
      applyCustomerSession(auth.data && auth.data.user || null);
    } catch (error) {
      console.warn("StoreNest customer message notifications are unavailable:", error.message || error);
    }
  }
  function initCustomerEvents() {
    listenForNotificationClicks();
    if (!isOwnerPage) startCustomerWatch().catch(function () {});
    window.addEventListener("storenest:customer-identity-change", function () {
      if (customer.user) applyCustomerSession(customer.user);
    });
    window.addEventListener("storenest:open-chat-centre", function () {
      if (isOwnerPage) {
        const nav = document.querySelector('.side-link[data-section="messages"]');
        if (nav) nav.click();
        return;
      }
      openCustomerCentre().catch(function (error) { console.error("StoreNest Chat Centre:", error); });
    });
    window.addEventListener("focus", function () {
      if (customer.user) loadCustomerInbox().catch(function () {});
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && customer.root && !customer.root.hidden) closeCustomerCentre();
    });
  }
  function watchSearchPage() {
    if (!isOwnerPage) return;
    document.querySelectorAll('[data-owner-nav-badge="messages"]').forEach(function (badge) {
      badge.hidden = true;
    });
    startOwnerWatch();
  }

  function initializeMessagingCentre() {
    initCustomerEvents();
    watchSearchPage();
    handleNotificationRoute();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeMessagingCentre, { once: true });
  } else {
    initializeMessagingCentre();
  }
})();