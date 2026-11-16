(function () {
  "use strict";

  const CUSTOMER_TABLE = "storefront_conversations";
  const MESSAGE_TABLE = "storefront_messages";
  const isOwnerPage = Boolean(document.querySelector('[data-section-view="messages"]'));
  const isPublisherPage = Boolean(document.getElementById("publisherMessageCentre"));
  const isHqPage = Boolean(document.getElementById("hqMessageCentre"));
  const customer = { root: null, client: null, user: null, profileName: "Customer", active: null, rows: [], businessById: new Map(), channel: null, authSubscription: null, timer: null, unreadPollTimer: null, searchTimer: null, searchToken: 0, previousOverflow: "", pendingConversationId: null, currentRole: "customer", contacts: [] };
  const owner = { root: null, client: null, user: null, active: null, rows: [], business: null, businessId: null, channel: null, authSubscription: null, timer: null, loading: false, search: "", pendingConversationId: null, currentRole: "business_owner", contacts: [] };
  const publisher = { root: null, client: null, user: null, active: null, rows: [], business: null, businessId: null, channel: null, authSubscription: null, timer: null, search: "", currentRole: "publisher", contacts: [] };
  const hq = { root: null, client: null, user: null, active: null, rows: [], business: null, businessId: null, channel: null, authSubscription: null, timer: null, search: "", currentRole: "hq", contacts: [] };
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
    const title = mode === "publisher" ? "Publisher Messages" : mode === "hq" ? "StoreNest HQ Messages" : customerMode ? "Messages" : "Inbox";
    const subtitle = mode === "publisher" ? "Conversations with your referred businesses and StoreNest HQ" : mode === "hq" ? "Private one-to-one conversations with StoreNest users" : customerMode ? "Your StoreNest conversations" : "Messages with customers, your Publisher, and StoreNest HQ";
    const placeholder = mode === "customer" ? "Search businesses" : mode === "hq" ? "Search people by name" : mode === "publisher" ? "Search conversations or referrals" : "Search conversations";
    return '<section class="sn-message-app" data-mode="' + mode + '">' +
      '<aside class="sn-message-list-pane">' +
        '<header class="sn-message-list-head"><div><h2>' + title + '</h2><p>' + subtitle + '</p></div>' +
          '<div class="sn-message-head-actions"><button class="sn-message-notifications" type="button" aria-label="Enable message notifications">Enable alerts</button>' +
          (customerMode ? '<button class="sn-message-close" type="button" aria-label="Close messages">×</button>' : '') + '</div>' +
        '</header>' +
        '<label class="sn-message-search-wrap"><span class="sn-message-search-icon" aria-hidden="true">⌕</span><input class="sn-message-search" type="search" autocomplete="off" placeholder="' + placeholder + '" aria-label="' + placeholder + '"></label>' +
        '<div class="sn-message-error" role="status" aria-live="polite" hidden></div>' +
        '<div class="sn-message-contact-results" hidden></div>' +
        '<div class="sn-message-results" hidden></div>' +
        '<div class="sn-message-list-label"><span>' + (mode === "hq" ? "Accounts & conversations" : customerMode ? "Inbox" : mode === "publisher" ? "Accounts & conversations" : "Conversations") + '</span><span class="sn-message-list-count"></span></div>' +
        '<div class="sn-message-list" role="list"></div>' +
      '</aside>' +
      '<main class="sn-message-main">' +
        '<div class="sn-message-empty"><div class="sn-message-empty-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20.5 11.5a8 8 0 0 1-8 8 8.2 8.2 0 0 1-3.6-.83L4 20l1.32-4.27a7.96 7.96 0 1 1 15.18-4.23Z"/><path d="M8.2 11.5h.01M12.2 11.5h.01M16.2 11.5h.01"/></svg></div><h3>' + (mode === "publisher" ? "Publisher messages" : mode === "hq" ? "HQ messages" : customerMode ? "Your messages" : "Customer conversations") + '</h3><p>' + (customerMode ? "Search for a business to start a private conversation, or select a chat from your inbox." : mode === "publisher" ? "Choose a message from one of your referred businesses or StoreNest HQ." : mode === "hq" ? "Search for a registered StoreNest user to start a private conversation." : "Choose a conversation to read and reply. New messages appear here as they arrive.") + '</p></div>' +
        '<section class="sn-message-thread" hidden>' +
          '<header class="sn-message-thread-head"><button class="sn-message-back" type="button" aria-label="Back to conversations">‹</button><div class="sn-message-thread-identity"><span class="sn-message-avatar"></span><div style="min-width:0"><div class="sn-message-thread-name"></div><div class="sn-message-thread-subtitle"></div></div></div></header>' +
          '<div class="sn-message-listing-context" hidden></div>' +
          '<div class="sn-message-request-actions" hidden></div>' +
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
      contacts: root.querySelector(".sn-message-contact-results"),
      error: root.querySelector(".sn-message-error"),
      empty: root.querySelector(".sn-message-empty"),
      thread: root.querySelector(".sn-message-thread"),
      threadName: root.querySelector(".sn-message-thread-name"),
      threadSubtitle: root.querySelector(".sn-message-thread-subtitle"),
      listingContext: root.querySelector(".sn-message-listing-context"),
      threadAvatar: root.querySelector(".sn-message-thread-identity .sn-message-avatar"),
      threadBody: root.querySelector(".sn-message-thread-scroll"),
      composeWrap: root.querySelector(".sn-message-composer-wrap"),
      compose: root.querySelector(".sn-message-compose"),
      textarea: root.querySelector(".sn-message-compose textarea"),
      composeHint: root.querySelector(".sn-message-compose-hint"),
      send: root.querySelector(".sn-message-send"),
      authNote: root.querySelector(".sn-message-auth-note"),
      status: root.querySelector(".sn-message-status"),
      close: root.querySelector(".sn-message-close"),
      notifications: root.querySelector(".sn-message-notifications"),
      back: root.querySelector(".sn-message-back"),
      requestActions: root.querySelector(".sn-message-request-actions")
    };
  }
  function avatar(name, logo) {
    const el = make("span", "sn-message-avatar");
    setAvatar(el, name, logo);
    return el;
  }
  function renderPublisherDirectory(state) {
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const query = String(state.search || "").trim().toLowerCase();
    const contacts = [{ role: "hq", displayName: "StoreNest HQ" }].concat(Array.isArray(state.contacts) ? state.contacts : []);
    const uniqueContacts = [];
    const seenContacts = new Set();

    contacts.forEach(function (contact) {
      const role = contact.contact_role || contact.role || "hq";
      const userId = contact.contact_user_id || contact.userId || null;
      const businessId = contact.business_id || contact.businessId || null;
      const key = role === "hq" ? "hq" : String(userId || contact.contact_display_name || contact.displayName || role) + "|" + role + "|" + String(businessId || "");
      if (seenContacts.has(key)) return;
      seenContacts.add(key);

      const existingConversation = rows.some(function (row) {
        if (role === "hq") return row.partner_role === "hq";
        return Boolean(userId)
          && row.partner_user_id === userId
          && row.partner_role === role
          && (role !== "business_owner" || (row.business_id || null) === businessId);
      });
      if (existingConversation) return;

      const name = contact.contact_display_name || contact.displayName || roleLabel(role);
      const businessName = contact.business_name || contact.businessName || "";
      const detail = [roleLabel(role), businessName].filter(Boolean).join(" · ");
      if (query && !(name + " " + role + " " + detail).toLowerCase().includes(query)) return;
      uniqueContacts.push({ contact: contact, role: role, userId: userId, businessId: businessId, name: name, detail: detail, businessName: businessName });
    });

    const filteredRows = rows.filter(function (row) {
      return !query || (String(row.partner_display_name || "") + " " + roleLabel(row.partner_role) + " " + String(row.last_message_preview || "")).toLowerCase().includes(query);
    });

    const list = state.refs.list;
    list.replaceChildren();
    const total = uniqueContacts.length + filteredRows.length;
    state.refs.listCount.textContent = total ? String(total) : "";

    if (!total) {
      const empty = make("div", "sn-message-empty-list");
      empty.appendChild(make("strong", "", state.user ? "No conversations yet" : "Sign in to see your messages"));
      empty.appendChild(document.createTextNode(query
        ? "No accounts or conversations match this search."
        : "Messages from your referred businesses and StoreNest HQ will appear here."));
      list.appendChild(empty);
      return;
    }

    uniqueContacts.forEach(function (entry) {
      const contact = entry.contact;
      const button = make("button", "sn-business-result sn-message-contact-result");
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.appendChild(avatar(entry.name, contact.partner_logo_url || ""));
      const body = make("span", "sn-message-row-body");
      body.appendChild(make("span", "sn-message-row-name", entry.name));
      body.appendChild(make("span", "sn-message-row-preview", entry.detail));
      button.appendChild(body);
      button.appendChild(make("span", "sn-message-row-time", "Message"));
      button.addEventListener("click", function () {
        const target = {
          userId: entry.userId,
          role: entry.role,
          businessId: entry.role === "business_owner" ? entry.businessId : null,
          displayName: entry.name,
          businessName: entry.businessName || null,
          myRole: "publisher",
          myBusinessId: null
        };
        const business = entry.role === "business_owner"
          ? { id: target.businessId, name: target.businessName || entry.name }
          : null;
        openThread(state, "publisher", { conversation: null, business: business, target: target });
      });
      list.appendChild(button);
    });

    filteredRows.forEach(function (row) {
      const name = row.partner_display_name || row.customer_label || (row.business && row.business.name) || "StoreNest account";
      const button = make("button", "sn-message-row" + (state.active && state.active.conversation && state.active.conversation.id === row.id ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.appendChild(avatar(name, row.partner_logo_url || (row.business && row.business.logo_url) || ""));
      const body = make("span", "sn-message-row-body");
      const top = make("span", "sn-message-row-top");
      top.appendChild(make("span", "sn-message-row-name", name));
      top.appendChild(make("span", "sn-message-row-time", timeLabel(row.updated_at || row.last_message_at || row.created_at)));
      body.appendChild(top);
      body.appendChild(make("span", "sn-message-row-preview", (row.last_message_sender_id && state.user && row.last_message_sender_id === state.user.id ? "You: " : "") + (row.last_message_preview || "Start the conversation")));
      if (row.request_status === "pending") body.appendChild(make("span", "sn-message-row-request", row.request_for_me ? "Message request" : "Request sent"));
      button.appendChild(body);
      if (row.unread_count) button.appendChild(make("span", "sn-message-unread", row.unread_count > 99 ? "99+" : String(row.unread_count)));
      button.addEventListener("click", function () {
        openThread(state, "publisher", { conversation: row, business: row.business || state.business || null });
      });
      list.appendChild(button);
    });
  }


  function renderHqDirectory(state) {
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const query = String(state.search || "").trim().toLowerCase();
    const contacts = Array.isArray(state.contacts) ? state.contacts : [];
    const uniqueContacts = [];
    const seenContacts = new Set();

    contacts.forEach(function (contact) {
      const role = contact.contact_role || contact.role || "customer";
      const userId = contact.contact_user_id || contact.userId || null;
      const businessId = contact.business_id || contact.businessId || null;
      const key = String(userId || contact.contact_display_name || contact.displayName || role) + "|" + role + "|" + String(businessId || "");
      if (seenContacts.has(key)) return;
      seenContacts.add(key);

      const existingConversation = rows.some(function (row) {
        return Boolean(userId)
          && row.partner_user_id === userId
          && row.partner_role === role
          && (role !== "business_owner" || !businessId || (row.business_id || null) === businessId);
      });
      if (existingConversation) return;

      const name = contact.contact_display_name || contact.displayName || roleLabel(role);
      const businessName = contact.business_name || contact.businessName || "";
      const detail = [roleLabel(role), businessName].filter(Boolean).join(" · ");
      if (query && !(name + " " + role + " " + detail).toLowerCase().includes(query)) return;
      uniqueContacts.push({
        contact: contact,
        role: role,
        userId: userId,
        businessId: businessId,
        name: name,
        detail: detail,
        businessName: businessName
      });
    });

    const filteredRows = rows.filter(function (row) {
      return !query || (String(row.partner_display_name || "") + " " + roleLabel(row.partner_role) + " " + String(row.last_message_preview || "")).toLowerCase().includes(query);
    });

    const list = state.refs.list;
    list.replaceChildren();
    const total = uniqueContacts.length + filteredRows.length;
    state.refs.listCount.textContent = total ? String(total) : "";

    if (!total) {
      const empty = make("div", "sn-message-empty-list");
      empty.appendChild(make("strong", "", state.user ? "No accounts or conversations" : "Sign in to see your messages"));
      empty.appendChild(document.createTextNode(query
        ? "No registered accounts or conversations match this search."
        : "Search for a registered StoreNest user or continue a conversation."));
      list.appendChild(empty);
      return;
    }

    uniqueContacts.forEach(function (entry) {
      const button = make("button", "sn-business-result sn-message-contact-result");
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.appendChild(avatar(entry.name, entry.contact.partner_logo_url || ""));
      const body = make("span", "sn-message-row-body");
      body.appendChild(make("span", "sn-message-row-name", entry.name));
      body.appendChild(make("span", "sn-message-row-preview", entry.detail));
      button.appendChild(body);
      button.appendChild(make("span", "sn-message-row-time", "Message"));
      button.addEventListener("click", function () {
        const target = {
          userId: entry.userId,
          role: entry.role,
          businessId: entry.role === "business_owner" ? entry.businessId : null,
          displayName: entry.name,
          businessName: entry.businessName || null,
          myRole: "hq",
          myBusinessId: null
        };
        const business = entry.role === "business_owner"
          ? { id: target.businessId, name: target.businessName || entry.name }
          : null;
        openThread(state, "hq", { conversation: null, business: business, target: target });
      });
      list.appendChild(button);
    });

    filteredRows.forEach(function (row) {
      const name = row.partner_display_name || row.customer_label || (row.business && row.business.name) || "StoreNest account";
      const button = make("button", "sn-message-row" + (state.active && state.active.conversation && state.active.conversation.id === row.id ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.appendChild(avatar(name, row.partner_logo_url || (row.business && row.business.logo_url) || ""));
      const body = make("span", "sn-message-row-body");
      const top = make("span", "sn-message-row-top");
      top.appendChild(make("span", "sn-message-row-name", name));
      top.appendChild(make("span", "sn-message-row-time", timeLabel(row.updated_at || row.last_message_at || row.created_at)));
      body.appendChild(top);
      body.appendChild(make("span", "sn-message-row-preview", (row.last_message_sender_id && state.user && row.last_message_sender_id === state.user.id ? "You: " : "") + (row.last_message_preview || "Start the conversation")));
      if (row.request_status === "pending") body.appendChild(make("span", "sn-message-row-request", row.request_for_me ? "Message request" : "Request sent"));
      button.appendChild(body);
      if (row.unread_count) button.appendChild(make("span", "sn-message-unread", row.unread_count > 99 ? "99+" : String(row.unread_count)));
      button.addEventListener("click", function () {
        openThread(state, "hq", { conversation: row, business: row.business || null });
      });
      list.appendChild(button);
    });
  }


  function renderList(state, mode) {
    if (mode === "publisher") {
      renderPublisherDirectory(state);
      return;
    }
    if (mode === "hq") {
      renderHqDirectory(state);
      return;
    }
    const rows = state.rows || [];



    state.refs.list.replaceChildren();
    state.refs.listCount.textContent = rows.length ? String(rows.length) : "";
    if (!rows.length) {
      const empty = make("div", "sn-message-empty-list");
      const title = mode === "owner" && !state.businessId ? "No conversations yet" : (state.user ? "No conversations yet" : "Sign in to see your inbox");
      const detail = mode === "customer"
        ? (state.user ? "Search for a published business above, or contact StoreNest HQ." : "Your private conversations will be saved after you sign in.")
        : mode === "owner"
          ? "Messages from customers, your referring Publisher, and StoreNest HQ will appear here."
          : mode === "publisher"
            ? "Messages from referred Business Owners and StoreNest HQ will appear here."
            : mode === "hq"
              ? "Search for a registered Customer, Business Owner, or Publisher to start a conversation."
              : "Your private conversations will appear here.";
      empty.appendChild(make("strong", "", title));
      empty.appendChild(document.createTextNode(detail));
      state.refs.list.appendChild(empty);
      return;
    }
    const filtered = state.search
      ? rows.filter(function (row) {
          return (String(row.partner_display_name || "") + " " + String(row.partner_role || "") + " " + String(row.last_message_preview || "")).toLowerCase().includes(state.search.toLowerCase());
        })
      : rows;
    if (!filtered.length) {
      state.refs.list.appendChild(make("div", "sn-message-empty-list", "No conversations match that search."));
      return;
    }
    filtered.forEach(function (row) {
      const name = row.partner_display_name || row.customer_label || (row.business && row.business.name) || "StoreNest account";
      const button = make("button", "sn-message-row" + (state.active && state.active.conversation && state.active.conversation.id === row.id ? " is-active" : ""));
      button.type = "button";
      button.setAttribute("role", "listitem");
      button.appendChild(avatar(name, row.partner_logo_url || (row.business && row.business.logo_url) || ""));
      const body = make("span", "sn-message-row-body");
      const top = make("span", "sn-message-row-top");
      top.appendChild(make("span", "sn-message-row-name", name));
      top.appendChild(make("span", "sn-message-row-time", timeLabel(row.updated_at || row.last_message_at || row.created_at)));
      body.appendChild(top);
      body.appendChild(make("span", "sn-message-row-preview", (row.last_message_sender_id && state.user && row.last_message_sender_id === state.user.id ? "You: " : "") + (row.last_message_preview || "Start the conversation")));
      if (row.request_status === "pending") body.appendChild(make("span", "sn-message-row-request", row.request_for_me ? "Message request" : "Request sent"));
      button.appendChild(body);
      if (row.unread_count) button.appendChild(make("span", "sn-message-unread", row.unread_count > 99 ? "99+" : String(row.unread_count)));
      button.addEventListener("click", function () {
        openThread(state, mode, { conversation: row, business: row.business || state.business || null });
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
        openBusinessConversation({ businessId: business.id });
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
        .select("id,owner_id,name,slug,category,location,logo_url")
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
  function roleLabel(role) {
    return ({ customer: "Customer", business_owner: "Business Owner", publisher: "Publisher", hq: "StoreNest HQ" })[role] || "StoreNest account";
  }
  function normalizeListingContext(value) {
    if (!value || typeof value !== "object") return null;
    const clean = function (input, limit) {
      return String(input || "").replace(/\s+/g, " ").trim().slice(0, limit);
    };
    const name = clean(value.name, 120);
    if (!name) return null;
    const type = value.type === "Service" ? "Service" : value.type === "Product" ? "Product" : "Listing";
    return {
      listingId: clean(value.listingId, 80),
      type: type,
      name: name,
      businessName: clean(value.businessName, 100),
      price: clean(value.price, 100),
      details: clean(value.details, 500)
    };
  }
  function listingContextMessage(value) {
    const context = normalizeListingContext(value);
    if (!context) return "";
    const lines = ["StoreNest listing reference:", context.type + ": " + context.name];
    if (context.businessName) lines.push("Business: " + context.businessName);
    if (context.price) lines.push("Price shown: " + context.price);
    if (context.details) lines.push("Details: " + context.details);
    if (context.listingId) lines.push("Listing reference ID: " + context.listingId);
    return lines.join("\n").slice(0, 1100);
  }
  function redirectToBusinessMessageSignIn(businessId, listingContext) {
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set("storenest_message_business", businessId);
    if (listingContext) returnUrl.searchParams.set("storenest_message_listing", JSON.stringify(listingContext));
    else returnUrl.searchParams.delete("storenest_message_listing");
    const accountUrl = new URL("/customer-account.html", window.location.origin);
    accountUrl.searchParams.set("mode", "signin");
    accountUrl.searchParams.set("storenest_return", returnUrl.pathname + returnUrl.search + returnUrl.hash);
    window.location.assign(accountUrl.toString());
  }
  async function openBusinessConversation(intent) {
    const businessId = String(intent && (intent.businessId || (intent.business && intent.business.id)) || "").trim();
    const listingContext = normalizeListingContext(intent && intent.listingContext);
    if (!businessId) throw new Error("This StoreNest business link is unavailable.");
    if (!window.StoreNestCustomerAuth) throw new Error("StoreNest messaging is unavailable right now.");
    customer.client = customer.client || await window.StoreNestCustomerAuth.getClient();
    const auth = await customer.client.auth.getUser();
    customer.user = auth.data && auth.data.user || null;
    if (!customer.user) {
      redirectToBusinessMessageSignIn(businessId, listingContext);
      return;
    }
    await openCustomerCentre();
    const result = await customer.client.from("businesses")
      .select("id,owner_id,name,slug,logo_url,category,location,is_published")
      .eq("id", businessId)
      .eq("is_published", true)
      .maybeSingle();
    if (result.error) throw result.error;
    const business = result.data;
    if (!business || !business.owner_id) throw new Error("This StoreNest business is unavailable.");
    if (business.owner_id === customer.user.id) {
      textError(customer, "You cannot start a customer conversation with your own business.");
      return;
    }
    const existing = customer.rows.find(function (row) {
      return row.business_id === business.id && row.partner_role === "business_owner";
    });
    openThread(customer, "customer", {
      conversation: existing || null,
      business: business,
      target: existing ? null : {
        userId: business.owner_id,
        role: "business_owner",
        businessId: business.id,
        businessName: business.name || "StoreNest business",
        displayName: business.name || "StoreNest business",
        myRole: "customer"
      },
      listingContext: listingContext
    });
  }
  function showBusinessMessageError(error) {
    const message = error && error.message || "Could not open this business conversation.";
    if (customer.root && !customer.root.hidden) {
      textError(customer, message);
      return;
    }
    openCustomerCentre().then(function () { textError(customer, message); }).catch(function () {
      console.error("StoreNest Chat Centre:", message);
    });
  }
  function handleBusinessMessageRoute() {
    const params = new URLSearchParams(window.location.search);
    const businessId = params.get("storenest_message_business");
    if (!businessId) return;
    let listingContext = null;
    try {
      listingContext = JSON.parse(params.get("storenest_message_listing") || "null");
    } catch (_) {}
    params.delete("storenest_message_business");
    params.delete("storenest_message_listing");
    const query = params.toString();
    window.history.replaceState(window.history.state, "", window.location.pathname + (query ? "?" + query : "") + window.location.hash);
    openBusinessConversation({ businessId: businessId, listingContext: listingContext }).catch(showBusinessMessageError);
  }
  function renderMessageContacts(state, mode, contacts) {
    state.contacts = Array.isArray(contacts) ? contacts : [];
    const box = state.refs && state.refs.contacts;
    if (!box) return;
    if (mode === "publisher" || mode === "hq") {
      box.replaceChildren();
      box.hidden = true;
      renderList(state, mode);
      return;
    }
    box.replaceChildren();
    box.hidden = false;
    const heading = make("div", "sn-message-results-label", mode === "customer" ? "Contact StoreNest" : mode === "hq" ? "Registered accounts" : "Start a conversation");
    box.appendChild(heading);

    function addContact(contact) {
      const name = contact.contact_display_name || contact.displayName || roleLabel(contact.contact_role || contact.role);
      const role = contact.contact_role || contact.role || "hq";
      const button = make("button", "sn-business-result sn-message-contact-result");
      button.type = "button";
      button.appendChild(avatar(name, contact.partner_logo_url || ""));
      const body = make("span", "sn-message-row-body");
      body.appendChild(make("span", "sn-message-row-name", name));
      const detail = [roleLabel(role), contact.business_name].filter(Boolean).join(" · ");
      body.appendChild(make("span", "sn-message-row-preview", detail));
      button.appendChild(body);
      button.appendChild(make("span", "sn-message-row-time", "Message"));
      button.addEventListener("click", function () {
        const target = {
          userId: contact.contact_user_id || contact.userId || null,
          role: role,
          businessId: role === "business_owner" ? (contact.business_id || contact.businessId || null) : null,
          displayName: name,
          businessName: contact.business_name || null,
          myRole: mode === "customer" ? "customer" : mode === "owner" ? "business_owner" : mode === "publisher" ? "publisher" : "hq",
          myBusinessId: mode === "owner" ? (contact.business_id || state.businessId || null) : null
        };
        const business = role === "business_owner" ? {
          id: target.businessId, name: target.businessName || name
        } : (target.businessId ? { id: target.businessId, name: target.businessName || "" } : null);
        openThread(state, mode, { conversation: null, business: business, target: target });
      });
      box.appendChild(button);
    }

    if (mode !== "hq" && mode !== "customer") {
      addContact({ role: "hq", displayName: "StoreNest HQ" });
    } else if (mode === "customer") {
      addContact({ role: "hq", displayName: "StoreNest HQ" });
    }
    const filtered = state.search && mode !== "hq"
      ? state.contacts.filter(function (contact) {
          return (String(contact.contact_display_name || "") + " " + String(contact.contact_role || "") + " " + String(contact.business_name || "")).toLowerCase().includes(state.search.toLowerCase());
        })
      : state.contacts;
    if (filtered.length) {
      filtered.forEach(addContact);
    } else if (mode === "hq" && state.search.length >= 2) {
      box.appendChild(make("div", "sn-message-empty-list", "No registered accounts match this search."));
    } else if (mode !== "customer" && mode !== "hq") {
      box.appendChild(make("div", "sn-message-empty-list", "No contextual contacts are available yet."));
    }
  }

  async function loadMessageContacts(state, mode, query) {
    if (!state.client || !state.user) {
      renderMessageContacts(state, mode, []);
      return;
    }
    try {
      if (mode === "owner" || mode === "publisher") {
        const result = await state.client.rpc("get_my_message_contacts");
        if (result.error) throw result.error;
        let contacts = Array.isArray(result.data) ? result.data : [];
        if (mode === "owner" && state.businessId) {
          contacts = contacts.filter(function (contact) {
            return !contact.business_id || contact.business_id === state.businessId;
          });
        }
        if (mode === "publisher") contacts = contacts.filter(function (contact) { return contact.contact_role === "business_owner"; });
        renderMessageContacts(state, mode, contacts);
      } else if (mode === "hq") {
        const term = String(query || "").trim();
        if (term.length < 2) {
          renderMessageContacts(state, mode, []);
          return;
        }
        const result = await state.client.rpc("get_platform_admin_message_contacts", { p_search: term, p_role: null });
        if (result.error) throw result.error;
        renderMessageContacts(state, mode, Array.isArray(result.data) ? result.data : []);
      } else {
        renderMessageContacts(state, mode, []);
      }
    } catch (error) {
      renderMessageContacts(state, mode, []);
      textError(state, error.message || "Message contacts could not be loaded.");
    }
  }

  function publishCustomerUnreadCount(count) {
    const unreadCount = Math.max(0, Math.floor(Number(count) || 0));
    window.StoreNestCustomerUnreadCount = unreadCount;
    window.dispatchEvent(new CustomEvent("storenest:customer-unread-count", { detail: { count: unreadCount } }));
  }
  async function refreshCustomerUnreadCount() {
    if (!customer.client || !customer.user) {
      publishCustomerUnreadCount(0);
      return 0;
    }
    const userId = customer.user.id;
    const result = await customer.client.from(MESSAGE_TABLE)
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_id", userId);
    if (result.error) {
      console.warn("StoreNest customer unread-message count could not be loaded:", result.error.message || result.error);
      throw result.error;
    }
    if (!customer.user || customer.user.id !== userId) return null;
    const count = Number(result.count) || 0;
    publishCustomerUnreadCount(count);
    return count;
  }
  function mapInboxRows(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      return Object.assign({}, row, {
        id: row.conversation_id,
        unread_count: Number(row.unread_count) || 0,
        business: row.partner_role === "business_owner" ? { name: row.partner_display_name || "StoreNest business", logo_url: row.partner_logo_url || "" } : null
      });
    });
  }
  async function loadCustomerInbox() {
    if (!customer.client || !customer.user) {
      customer.rows = [];
      publishCustomerUnreadCount(0);
      renderList(customer, "customer");
      return;
    }
    const result = await customer.client.rpc("get_my_message_inbox");
    if (result.error) throw result.error;
    customer.rows = mapInboxRows(result.data);
    if (customer.active && customer.active.conversation) {
      const refreshed = customer.rows.find(function (row) { return row.id === customer.active.conversation.id; });
      if (refreshed) {
        customer.active.conversation = refreshed;
        updateRequestControls(customer, "customer");
      }
    }
    renderList(customer, "customer");
    publishCustomerUnreadCount(customer.rows.reduce(function (sum, row) { return sum + row.unread_count; }, 0));
    openPendingConversation(customer, "customer");
  }
  async function loadOwnerConversations() {
    if (!owner.client || !owner.user) {
      owner.rows = [];
      renderList(owner, "owner");
      return;
    }
    const result = await owner.client.rpc("get_my_message_inbox");
    if (result.error) throw result.error;
    let rows = mapInboxRows(result.data);
    if (owner.businessId) rows = rows.filter(function (row) { return row.business_id === owner.businessId; });
    owner.rows = rows;
    if (owner.active && owner.active.conversation) {
      const refreshed = owner.rows.find(function (row) { return row.id === owner.active.conversation.id; });
      if (refreshed) {
        owner.active.conversation = refreshed;
        updateRequestControls(owner, "owner");
      }
    }
    renderList(owner, "owner");
  }
  async function refreshOwnerBadge() {
    if (!owner.client || !owner.user) {
      setOwnerBadge(0);
      return;
    }
    const result = await owner.client.rpc("get_my_message_inbox");
    if (result.error) throw result.error;
    const rows = mapInboxRows(result.data).filter(function (row) { return !owner.businessId || row.business_id === owner.businessId; });
    setOwnerBadge(rows.reduce(function (sum, row) { return sum + row.unread_count; }, 0));
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
    else if (mode === "publisher" || mode === "hq") await loadRoleInbox(state, mode).catch(function (error) { textError(state, error.message); });
  }
  async function loadThreadMessages(state, mode) {
    const active = state.active;
    if (!active || !active.conversation || !active.conversation.id || !state.client) {
      renderThreadMessages(state, [], mode);
      return;
    }
    const result = await state.client.from(MESSAGE_TABLE)
      .select("id,conversation_id,sender_id,sender_role,sender_display_name,body,created_at,read_at")
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
      const sender = make("div", "sn-message-sender", (message.sender_display_name || (mine ? "You" : (state.active?.conversation?.partner_display_name || "StoreNest account"))) + " · " + roleLabel(message.sender_role || "customer"));
      sender.title = roleLabel(message.sender_role || "customer");
      row.appendChild(sender);
      const bubble = make("div", "sn-message-bubble", message.body);
      row.appendChild(bubble);
      const meta = make("div", "sn-message-meta", messageTime(message.created_at));
      if (mine && message.read_at) meta.appendChild(make("span", "sn-message-seen", "Seen"));
      row.appendChild(meta);
      body.appendChild(row);
    });
    body.scrollTop = body.scrollHeight;
  }
  function updateRequestControls(state, mode) {
    const box = state.refs && state.refs.requestActions;
    const active = state.active;
    const conversation = active && active.conversation;
    if (!box) return;
    box.replaceChildren();
    if (!conversation || !conversation.id) {
      box.hidden = true;
      state.refs.compose.hidden = !state.user;
      state.refs.textarea.disabled = !state.user;
      return;
    }
    const blocked = conversation.blocked_by_me || conversation.blocked_by_partner;
    const pending = conversation.request_status === "pending";
    const waitingForReply = pending && !conversation.request_for_me;
    if (blocked) {
      box.hidden = false;
      box.appendChild(make("span", "sn-message-request-note", conversation.blocked_by_me ? "You blocked this account. Messaging is disabled." : "This account blocked you. Messaging is disabled."));
    } else if (conversation.request_for_me) {
      box.hidden = false;
      box.appendChild(make("span", "sn-message-request-note", "This person sent you a message request."));
      [["accept", "Accept"], ["decline", "Decline"], ["block", "Block"]].forEach(function (entry) {
        const button = make("button", "sn-message-request-action " + entry[0], entry[1]);
        button.type = "button";
        button.addEventListener("click", function () { answerMessageRequest(state, mode, entry[0]); });
        box.appendChild(button);
      });
    } else if (waitingForReply) {
      box.hidden = false;
      box.appendChild(make("span", "sn-message-request-note", "Message request sent. You can reply after it is accepted."));
    } else {
      box.hidden = true;
    }
    state.refs.compose.hidden = !state.user || blocked || pending;
    state.refs.textarea.disabled = !state.user || blocked || pending;
    state.refs.send.disabled = state.refs.compose.hidden || !String(state.refs.textarea.value || "").trim();
  }

  async function answerMessageRequest(state, mode, action) {
    const conversation = state.active && state.active.conversation;
    if (!conversation || !conversation.id) return;
    const buttons = state.refs.requestActions.querySelectorAll("button");
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      const result = await state.client.rpc("update_storefront_message_request", {
        p_conversation_id: conversation.id,
        p_action: action
      });
      if (result.error) throw result.error;
      await refreshInboxFor(state, mode);
      const refreshed = state.rows.find(function (row) { return row.id === conversation.id; });
      if (refreshed) {
        state.active.conversation = refreshed;
        updateRequestControls(state, mode);
        await loadThreadMessages(state, mode);
      }
      if (action === "accept") messageStatus(state, "Message request accepted.", false);
      else if (action === "decline") messageStatus(state, "Message request declined.", false);
      else messageStatus(state, "This account is blocked.", false);
    } catch (error) {
      messageStatus(state, error.message || "The message request could not be updated.", true);
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function renderListingContext(state, value) {
    const box = state.refs && state.refs.listingContext;
    if (!box) return;
    box.replaceChildren();
    const context = normalizeListingContext(value);
    if (!context) {
      box.hidden = true;
      return;
    }
    box.appendChild(make("span", "sn-message-context-label", "Listing enquiry"));
    box.appendChild(make("strong", "sn-message-context-name", context.type + " · " + context.name));
    const details = [context.price, context.details].filter(Boolean).join(" · ");
    if (details) box.appendChild(make("span", "sn-message-context-details", details));
    box.hidden = false;
  }
  function openThread(state, mode, active) {
    state.active = active;
    state.active.listingContext = normalizeListingContext(active && active.listingContext);
    textError(state, "");
    messageStatus(state, "", false);
    state.refs.empty.hidden = true;
    state.refs.thread.hidden = false;
    state.refs.app.classList.add("is-thread-open");
    const conversation = active.conversation || {};
    const target = active.target || {};
    const displayName = conversation.partner_display_name || target.displayName || (active.business && active.business.name) || "StoreNest account";
    const partnerRole = conversation.partner_role || target.role || "business_owner";
    const subtitle = [roleLabel(partnerRole), target.businessName || (mode === "owner" && state.business && conversation.business_id ? state.business.name : null)].filter(Boolean).join(" · ");
    state.refs.threadName.textContent = displayName;
    state.refs.threadSubtitle.textContent = subtitle || "Private StoreNest conversation";
    setAvatar(state.refs.threadAvatar, displayName, mode === "customer" ? active.business && active.business.logo_url : "");
    const loggedIn = Boolean(state.user);
    state.refs.authNote.hidden = loggedIn;
    state.refs.composeWrap.hidden = false;
    if (!loggedIn && mode === "customer") {
      state.refs.authNote.replaceChildren();
      state.refs.authNote.appendChild(document.createTextNode("Sign in to send and save private messages. "));
      const link = make("a", "", "Sign in");
      link.href = "/customer-account.html#login";
      state.refs.authNote.appendChild(link);
    }
    const listingMessage = listingContextMessage(state.active.listingContext);
    renderListingContext(state, state.active.listingContext);
    state.refs.textarea.value = "";
    state.refs.textarea.maxLength = listingMessage ? Math.max(1, 2000 - listingMessage.length - 2) : 2000;
    state.refs.textarea.placeholder = listingMessage ? "Ask about this listing" : "Start a message";
    state.refs.composeHint.textContent = listingMessage
      ? "Listing details will be included · Enter to send · Shift + Enter for a new line"
      : "Enter to send · Shift + Enter for a new line";
    state.refs.send.disabled = true;
    updateRequestControls(state, mode);
    if (loggedIn) state.refs.textarea.focus({ preventScroll: true });
    loadThreadMessages(state, mode).catch(function (error) { messageStatus(state, error.message, true); });
    if (mode === "owner" && loggedIn && conversation.id) {
      refreshActiveConversation(state, mode, conversation.id).catch(function () {});
    }
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
    const current = state.active.conversation;
    const listingReference = state.active.messageContextIncluded ? "" : listingContextMessage(state.active.listingContext);
    const outgoingBody = listingReference ? body + "\n\n" + listingReference : body;
    if (outgoingBody.length > 2000) {
      messageStatus(state, "Shorten your message so the listing details fit.", true);
      return;
    }
    if (current && (current.request_status === "pending" || current.blocked_by_me || current.blocked_by_partner || current.request_status === "declined")) {
      updateRequestControls(state, mode);
      return;
    }
    state.refs.send.disabled = true;
    messageStatus(state, "Sending…", false);
    try {
      if (!current || !current.id) {
        const target = state.active.target;
        if (!target) throw new Error("Choose a registered StoreNest contact first.");
        const result = await state.client.rpc("start_storefront_conversation", {
          p_recipient_user_id: target.userId || null,
          p_sender_role: target.myRole || state.currentRole || (mode === "owner" ? "business_owner" : mode),
          p_recipient_role: target.role,
          p_sender_business_id: target.myBusinessId || (mode === "owner" ? state.businessId : null),
          p_recipient_business_id: target.businessId || null,
          p_initial_message: outgoingBody
        });
        if (result.error) throw result.error;
        const started = Array.isArray(result.data) ? result.data[0] : result.data;
        if (!started || !started.conversation_id) throw new Error("StoreNest did not return the new conversation.");
        if (started.request_status === "pending" && started.created === false) {
          await refreshInboxFor(state, mode);
          const pending = state.rows.find(function (row) { return row.id === started.conversation_id; });
          if (pending) {
            state.active.conversation = pending;
            state.active.target = null;
            updateRequestControls(state, mode);
            await loadThreadMessages(state, mode);
          }
          messageStatus(state, "This conversation has a pending request. Accept it before sending a reply.", false);
          return;
        }
        state.refs.textarea.value = "";
        state.refs.textarea.style.height = "auto";
        state.active.conversation = {
          id: started.conversation_id,
          request_status: started.request_status,
          requester_user_id: state.user.id,
          request_for_me: false,
          partner_display_name: target.displayName,
          partner_role: target.role,
          business_id: target.businessId || target.myBusinessId || state.businessId || null,
          last_message_sender_id: state.user.id
        };
        state.active.target = null;
      } else {
        const sent = await state.client.from(MESSAGE_TABLE).insert({
          conversation_id: current.id,
          sender_id: state.user.id,
          body: outgoingBody
        });
        if (sent.error) throw sent.error;
        state.refs.textarea.value = "";
        state.refs.textarea.style.height = "auto";
      }
      if (listingReference) {
        state.active.messageContextIncluded = true;
        state.refs.textarea.maxLength = 2000;
        state.refs.composeHint.textContent = "Enter to send · Shift + Enter for a new line";
      }
      messageStatus(state, "", false);
      await refreshInboxFor(state, mode);
      const refreshed = state.rows.find(function (row) { return row.id === state.active.conversation.id; });
      if (refreshed) state.active.conversation = refreshed;
      updateRequestControls(state, mode);
      await loadThreadMessages(state, mode);
      state.refs.textarea.focus({ preventScroll: true });
    } catch (error) {
      const errorText = String(error && error.message || "");
      if (mode === "owner" && current && current.id && /wait for the recipient to accept this message request/i.test(errorText)) {
        try {
          const refreshed = await refreshActiveConversation(state, mode, current.id);
          if (refreshed && refreshed.request_status === "pending") {
            messageStatus(state, "", false);
            return;
          }
        } catch (_) {}
      }
      messageStatus(state, errorText || "Message could not be sent. Please try again.", true);
      state.refs.send.disabled = !String(state.refs.textarea.value || "").trim();
    }
  }
  function bindShell(state, mode) {
    state.refs.search.addEventListener("input", function () {
      const query = state.refs.search.value.trim();
      state.search = query;
      if (mode === "customer") {
        clearTimeout(state.searchTimer);
        textError(state, "");
        state.searchTimer = setTimeout(function () { searchBusinesses(query); }, 240);
      } else if (mode === "hq") {
        renderList(state, mode);
        clearTimeout(state.searchTimer);
        state.searchTimer = setTimeout(function () { loadMessageContacts(state, mode, query); }, 260);
      } else {
        renderList(state, mode);
        if (mode !== "publisher") renderMessageContacts(state, mode, state.contacts || []);
      }
    });
    state.refs.compose.addEventListener("submit", function (event) { sendMessage(state, mode, event); });
    state.refs.textarea.addEventListener("input", function () {
      state.refs.textarea.style.height = "auto";
      state.refs.textarea.style.height = Math.min(state.refs.textarea.scrollHeight, 120) + "px";
      state.refs.send.disabled = !String(state.refs.textarea.value || "").trim() || !state.user || state.refs.compose.hidden;
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
    renderMessageContacts(customer, "customer", []);
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
      renderMessageContacts(customer, "customer", []);
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
      .on("postgres_changes", { event: "*", schema: "public", table: "message_user_blocks" }, function (payload) {
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
      await loadMessageContacts(owner, "owner", "");
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
    await loadMessageContacts(owner, "owner", "");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "message_user_blocks" }, function () {
        queueOwnerRefresh();
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
        loadMessageContacts(owner, "owner", "").catch(function () {});
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
      if (new URLSearchParams(window.location.search).has("message_publisher")) {
        setTimeout(function () { startPublisherContactFromLink().catch(function () {}); }, 0);
      }
      return;
    }
    const userId = customer.user.id;
    ensureCustomerRealtime();
    if (!customer.unreadPollTimer) {
      customer.unreadPollTimer = setInterval(function () {
        if (customer.user && document.visibilityState === "visible") {
          refreshCustomerUnreadCount().catch(function () {});
        }
      }, 20000);
    }
    setTimeout(async function () {
      if (!customer.user || customer.user.id !== userId) return;
      try {
        const profile = await window.StoreNestCustomerAuth.getProfile(userId);
        if (profile && profile.profile_name && customer.user && customer.user.id === userId) customer.profileName = profile.profile_name;
      } catch (_) {}
      loadCustomerInbox().catch(function () {});
      startPublisherContactFromLink().catch(function () {});
    }, 0);
  }
  async function startCustomerWatch() {
    if (isOwnerPage || isPublisherPage || isHqPage || !window.StoreNestCustomerAuth) return;
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
    if (!isOwnerPage && !isPublisherPage && !isHqPage) startCustomerWatch().catch(function () {});
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
    window.addEventListener("storenest:message-business", function (event) {
      openBusinessConversation(event.detail || {}).catch(showBusinessMessageError);
    });
    window.addEventListener("focus", function () {
      if (customer.user) loadCustomerInbox().catch(function () {});
    });
    document.addEventListener("visibilitychange", function () {
      if (customer.user && document.visibilityState === "visible") loadCustomerInbox().catch(function () {});
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

  async function loadRoleInbox(state, mode) {
    if (!state.client || !state.user) {
      state.rows = [];
      renderList(state, mode);
      setRoleUnreadBadge(mode, 0);
      return;
    }
    const result = await state.client.rpc("get_my_message_inbox");
    if (result.error) throw result.error;
    state.rows = mapInboxRows(result.data);
    if (state.active && state.active.conversation) {
      const refreshed = state.rows.find(function (row) { return row.id === state.active.conversation.id; });
      if (refreshed) {
        state.active.conversation = refreshed;
        updateRequestControls(state, mode);
      }
    }
    renderList(state, mode);
    const unread = state.rows.reduce(function (sum, row) { return sum + row.unread_count; }, 0);
    setRoleUnreadBadge(mode, unread);
    openPendingConversation(state, mode);
  }

  function setRoleUnreadBadge(mode, count) {
    const badge = document.querySelector('[data-message-unread="' + mode + '"]');
    if (!badge) return;
    const value = Math.max(0, Number(count) || 0);
    badge.textContent = value > 99 ? "99+" : String(value);
    badge.hidden = value === 0;
    badge.setAttribute("aria-label", value + " unread messages");
  }

  function refreshInboxFor(state, mode) {
    if (mode === "customer") return loadCustomerInbox();
    if (mode === "owner") return refreshOwnerInbox();
    return loadRoleInbox(state, mode);
  }

  async function refreshActiveConversation(state, mode, conversationId) {
    if (!conversationId) return null;
    await refreshInboxFor(state, mode);
    const active = state.active;
    if (!active || !active.conversation || active.conversation.id !== conversationId) return null;
    const refreshed = (state.rows || []).find(function (row) { return row.id === conversationId; });
    if (!refreshed) return null;
    active.conversation = refreshed;
    updateRequestControls(state, mode);
    return refreshed;
  }

  function ensureRoleRealtime(state, mode) {
    if (!state.client || !state.user || state.channel) return;
    const userId = state.user.id;
    const queue = function () {
      clearTimeout(state.timer);
      state.timer = setTimeout(function () {
        loadRoleInbox(state, mode).catch(function (error) { textError(state, error.message || "Inbox could not be refreshed."); });
        const active = state.active && state.active.conversation;
        if (active && active.id && state.refs && !state.refs.app.hidden) {
          loadThreadMessages(state, mode).catch(function () {});
        }
      }, 120);
    };
    state.channel = state.client.channel("storenest-" + mode + "-messages-" + userId)
      .on("postgres_changes", { event: "*", schema: "public", table: CUSTOMER_TABLE }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: MESSAGE_TABLE }, queue)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_user_blocks" }, queue)
      .subscribe();
  }

  async function prepareEmbeddedInbox(state, mode, rootId, client, user) {
    const target = byId(rootId);
    if (!target) return;
    if (!state.root) {
      target.replaceChildren();
      target.innerHTML = conversationMarkup(mode);
      state.root = target;
      attachRefs(state);
      bindShell(state, mode);
    }
    state.client = client || state.client;
    state.user = user || null;
    if (!state.user) {
      state.rows = [];
      state.contacts = [];
      renderList(state, mode);
      renderMessageContacts(state, mode, []);
      setRoleUnreadBadge(mode, 0);
      return;
    }
    ensureRoleRealtime(state, mode);
    await Promise.all([
      loadRoleInbox(state, mode),
      loadMessageContacts(state, mode, "")
    ]);
  }

  async function initializePublisherMessaging() {
    if (!isPublisherPage || !window.StoreNestCustomerAuth) return;
    try {
      const client = await window.StoreNestCustomerAuth.getClient();
      const auth = await client.auth.getUser();
      await prepareEmbeddedInbox(publisher, "publisher", "publisherMessageCentre", client, auth.data && auth.data.user || null);
      if (!publisher.authSubscription) {
        const listener = client.auth.onAuthStateChange(function (_event, session) {
          setTimeout(function () {
            publisher.user = session && session.user || null;
            if (!publisher.user && publisher.channel) {
              client.removeChannel(publisher.channel);
              publisher.channel = null;
            }
            prepareEmbeddedInbox(publisher, "publisher", "publisherMessageCentre", client, publisher.user).catch(function () {});
          }, 0);
        });
        publisher.authSubscription = listener.data && listener.data.subscription || null;
      }
      window.addEventListener("focus", function () { if (publisher.user) loadRoleInbox(publisher, "publisher").catch(function () {}); });
      document.addEventListener("visibilitychange", function () {
        if (publisher.user && document.visibilityState === "visible") loadRoleInbox(publisher, "publisher").catch(function () {});
      });
    } catch (error) {
      console.warn("Publisher messages could not initialize:", error.message || error);
    }
  }

  function initializeHqMessaging() {
    if (!isHqPage) return;
    const target = byId("hqMessageCentre");
    if (target && !hq.root) {
      target.innerHTML = conversationMarkup("hq");
      hq.root = target;
      attachRefs(hq);
      bindShell(hq, "hq");
      renderList(hq, "hq");
      renderMessageContacts(hq, "hq", []);
    }
    window.addEventListener("storenest:hq-admin-ready", function (event) {
      const detail = event.detail || {};
      hq.client = detail.client || null;
      hq.user = detail.user || null;
      if (hq.user) {
        ensureRoleRealtime(hq, "hq");
        Promise.all([loadRoleInbox(hq, "hq"), loadMessageContacts(hq, "hq", hq.search || "")]).catch(function (error) {
          textError(hq, error.message || "HQ messages could not be loaded.");
        });
      }
    });
    window.addEventListener("storenest:hq-admin-signed-out", function () {
      if (hq.client && hq.channel) hq.client.removeChannel(hq.channel);
      hq.channel = null;
      hq.user = null;
      hq.rows = [];
      renderList(hq, "hq");
      renderMessageContacts(hq, "hq", []);
      setRoleUnreadBadge("hq", 0);
    });
    window.addEventListener("focus", function () { if (hq.user) loadRoleInbox(hq, "hq").catch(function () {}); });
    document.addEventListener("visibilitychange", function () {
      if (hq.user && document.visibilityState === "visible") loadRoleInbox(hq, "hq").catch(function () {});
    });
  }

  async function startPublisherContactFromLink() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("message_publisher");
    if (!code || !customer.client) return;
    if (!customer.user) {
      openCustomerCentre().then(function () {
        textError(customer, "Sign in to message this Publisher. The sign-in link will return you here.");
        const link = make("a", "sn-message-signin-link", "Sign in to message " + (code ? "this Publisher" : "this account"));
        link.href = "/customer-account.html?message_publisher=" + encodeURIComponent(code);
        customer.refs.contacts.appendChild(link);
      }).catch(function () {});
      return;
    }
    try {
      const result = await customer.client.rpc("get_public_publisher_message_contact", { p_referral_code: code });
      if (result.error) throw result.error;
      const contact = Array.isArray(result.data) ? result.data[0] : result.data;
      if (!contact || !contact.contact_user_id) throw new Error("This Publisher profile is unavailable.");
      await openCustomerCentre();
      const existing = customer.rows.find(function (row) { return row.partner_user_id === contact.contact_user_id; });
      openThread(customer, "customer", existing
        ? { conversation: existing, business: null }
        : { conversation: null, business: null, target: {
            userId: contact.contact_user_id, role: "publisher", displayName: contact.contact_display_name || "Publisher", myRole: "customer"
          } });
      params.delete("message_publisher");
      const next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
      window.history.replaceState(null, "", next);
    } catch (error) {
      openCustomerCentre().then(function () { textError(customer, error.message || "This Publisher contact link is unavailable."); }).catch(function () {});
    }
  }

  function initializeMessagingCentre() {
    initCustomerEvents();
    watchSearchPage();
    initializePublisherMessaging().catch(function () {});
    initializeHqMessaging();
    handleNotificationRoute();
    handleBusinessMessageRoute();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeMessagingCentre, { once: true });
  } else {
    initializeMessagingCentre();
  }
})();
