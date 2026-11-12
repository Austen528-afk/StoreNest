(function (root) {
  "use strict";
  const ACTIVE_ORDER_STATUSES = Object.freeze(["new", "accepted", "preparing", "prepared", "ready"]);
  const ORDER_LABELS = Object.freeze({ new: "awaiting acceptance", accepted: "accepted", preparing: "being prepared", prepared: "prepared", ready: "ready for collection", completed: "collected", cancelled: "cancelled", refunded: "refunded" });
  const BOOKING_LABELS = Object.freeze({ pending: "awaiting a response", accepted: "accepted", declined: "declined", completed: "completed" });
  const state = { client: null, userId: "", business: null, businessId: "", counts: {}, metrics: null, activities: [], attention: [], chat: [], loading: false, error: false, sequence: 0, debounce: 0, timer: 0, historyOffset: 0, historyDone: false, historyLoading: false, lastUpdated: "" };
  const byId = id => root.document && root.document.getElementById(id);
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const countOf = value => Math.max(0, Math.floor(Number(value) || 0));
  const isActiveOrder = status => ACTIVE_ORDER_STATUSES.includes(String(status || "").toLowerCase());
  const isRecordedPaid = order => String(order && order.payment_status || "").toLowerCase() === "paid"
    && !["cancelled", "refunded"].includes(String(order && order.status || "").toLowerCase());
  function saDayRange(input) {
    const now = input instanceof Date ? input : new Date(input || Date.now());
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const date = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const start = new Date(date.year + "-" + date.month + "-" + date.day + "T00:00:00+02:00");
    return { start, end: new Date(start.getTime() + 86400000), day: date.year + "-" + date.month + "-" + date.day };
  }
  function inRange(value, range) {
    const time = new Date(value || "").getTime();
    return Number.isFinite(time) && time >= range.start.getTime() && time < range.end.getTime();
  }
  function sumRecordedPaidSales(orders, range) {
    return (Array.isArray(orders) ? orders : []).filter(order => isRecordedPaid(order) && inRange(order.created_at, range))
      .reduce((sum, order) => sum + Math.max(0, Number(order && order.subtotal) || 0), 0);
  }
  function canAccessBusiness(userId, business) {
    return Boolean(userId && business && String(business.owner_id || "") === String(userId) && business.id && business.is_published !== undefined);
  }
  function buildAttentionItems(input) {
    const data = input || {}, counts = data.counts || {}, items = [];
    const add = (key, priority, title, detail, target, count) => items.push({ key, priority, title, detail, target, count: count || 0 });
    if (!data.business) {
      add("create-business", 1, "Create your first business", "Set up a business profile to start using StoreNest.", "createBusiness");
      return items;
    }
    if (!String(data.business.name || "").trim() || !String(data.business.category || "").trim())
      add("profile", 1, "Complete your business profile", "Add your business name and category to continue setup.", "setup");
    if (countOf(counts.newOrders)) add("new-orders", 2, "New orders need acceptance", countOf(counts.newOrders) + (countOf(counts.newOrders) === 1 ? " order is" : " orders are") + " waiting for your response.", "orders", counts.newOrders);
    if (countOf(counts.pendingBookings)) add("pending-bookings", 3, "Booking requests need a response", countOf(counts.pendingBookings) + (countOf(counts.pendingBookings) === 1 ? " request is" : " requests are") + " pending.", "bookings", counts.pendingBookings);
    if (countOf(counts.acceptedOrders)) add("accepted-orders", 4, "Accepted orders need preparation", countOf(counts.acceptedOrders) + (countOf(counts.acceptedOrders) === 1 ? " order is" : " orders are") + " waiting for preparation to start.", "orders", counts.acceptedOrders);
    if (countOf(counts.preparedOrders)) add("prepared-orders", 5, "Prepared orders need the next step", countOf(counts.preparedOrders) + (countOf(counts.preparedOrders) === 1 ? " order is" : " orders are") + " ready to be marked ready for collection.", "orders", counts.preparedOrders);
    if (countOf(counts.readyOrders)) add("ready-orders", 6, "Orders are ready for collection", countOf(counts.readyOrders) + (countOf(counts.readyOrders) === 1 ? " order is" : " orders are") + " awaiting collection confirmation.", "orders", counts.readyOrders);
    if (countOf(counts.unreadMessages)) add("unread-messages", 7, "Customer messages need attention", countOf(counts.unreadMessages) + (countOf(counts.unreadMessages) === 1 ? " unread customer message." : " unread customer messages."), "messages", counts.unreadMessages);
    const complete = Boolean(String(data.business.name || "").trim() && String(data.business.category || "").trim());
    if (complete && countOf(data.catalogCount) === 0) add("catalog", 8, "Add your first product or service", "Your catalogue is empty, so customers have nothing to browse yet.", "items");
    else if (complete && !data.business.is_published) add("draft", 9, "Your storefront is still a draft", "Review your storefront and publish it when you are ready.", "storefront");
    (Array.isArray(data.insights) ? data.insights : []).filter(row => row && row.status === "new" && row.priority === "high").slice(0, 2)
      .forEach((insight, index) => add("insight-" + index, 10, String(insight.title || "A high-priority finding is ready"), String(insight.explanation || insight.recommendation || "Review the evidence in Analytics."), "analytics"));
    return items.sort((a, b) => a.priority - b.priority).slice(0, 6);
  }
  function shortId(value) { return String(value || "").replace(/-/g, "").slice(0, 8).toUpperCase(); }
  function createActivityFeed(data, businessId, limit) {
    const input = data || {}, events = [];
    const belongs = row => !businessId || String(row && row.business_id || "") === String(businessId);
    (Array.isArray(input.orders) ? input.orders : []).filter(belongs).forEach(order => {
      if (order.created_at) events.push({ key: "order-created-" + order.id, type: "order", target: "orders", recordId: order.id, at: order.created_at, label: "New order #" + shortId(order.id) + " received", detail: "Order request" });
    });
    (Array.isArray(input.bookings) ? input.bookings : []).filter(belongs).forEach(booking => {
      if (booking.created_at) events.push({ key: "booking-created-" + booking.id, type: "booking", target: "bookings", recordId: booking.id, at: booking.created_at, label: "Booking request from " + (booking.customer_name || "a customer"), detail: booking.event_date ? "Requested for " + booking.event_date : "Service request" });
    });
    (Array.isArray(input.messages) ? input.messages : []).filter(belongs).forEach(message => {
      if (message.sender_is_owner) return;
      const conversation = Array.isArray(message.conversation) ? message.conversation[0] : message.conversation;
      if (message.created_at) events.push({ key: "message-" + message.id, type: "message", target: "messages", recordId: message.conversation_id, at: message.created_at, label: "Customer message from " + (conversation && conversation.customer_label || "a customer"), detail: String(message.body || "").slice(0, 92) });
    });
    (Array.isArray(input.lifecycleEvents) ? input.lifecycleEvents : []).filter(belongs).forEach(event => {
      if (!event.changed_at || !event.from_status) return;
      const order = event.entity_type === "order", labels = order ? ORDER_LABELS : BOOKING_LABELS;
      const from = labels[event.from_status] || event.from_status, to = labels[event.to_status] || event.to_status;
      events.push({ key: "lifecycle-" + event.id, type: order ? "order" : "booking", target: order ? "orders" : "bookings", recordId: event.entity_id, at: event.changed_at,
        label: (order ? "Order #" + shortId(event.entity_id) : "Booking request") + " moved from " + from + " to " + to, detail: "Status updated" });
    });
    return events.filter(event => Number.isFinite(new Date(event.at).getTime()))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, Number.isFinite(Number(limit)) ? Number(limit) : 5);
  }
  function metricTarget(key) { return ({ orders: "orders", bookings: "bookings", messages: "messages", sales: "payments" })[key] || "overview"; }
  function resolveOverviewNavigation(target, recordId, conversationId) {
    if (target === "createBusiness") return [{ name: "storenest:owner-overview-create-business", detail: {} }];
    if (target === "orders" && recordId) return [
      { name: "storenest:owner-overview-open-target", detail: { target: "orders", recordId: String(recordId) } },
      { name: "storenest:owner-open-order", detail: { orderId: String(recordId) } }
    ];
    if (target === "bookings" && recordId) return [
      { name: "storenest:owner-overview-open-target", detail: { target: "bookings", recordId: String(recordId) } },
      { name: "storenest:owner-open-booking", detail: { bookingId: String(recordId) } }
    ];
    if (target === "messages" && conversationId) return [{ name: "storenest:owner-open-message-conversation", detail: { conversationId: String(conversationId) } }];
    return [{ name: "storenest:owner-overview-open-target", detail: { target: target, recordId: recordId ? String(recordId) : null } }];
  }
  function assistantReply(question, context) {
    const q = String(question || "").toLowerCase(), d = context || {}, c = d.counts || {};
    if (!d.hasBusiness) {
      if (/\b(how do i|how can i|how to|where do i|set up|setup|storefront)\b/.test(q))
        return { text: "Start by creating or selecting a business, then complete its profile, add products or services, review the storefront and publish it when ready. I can guide you through StoreNest pages, but there is no selected business for live activity questions yet.", action: "createBusiness" };
      return { text: "Create or select a business before I can answer questions about its activity. I can still help explain how to use StoreNest.", action: "createBusiness" };
    }
    const sales = d.salesUnavailable ? "Paid sales could not be loaded right now." :
      "Today's order records show " + money(d.todaySales || 0) + " marked paid across " + countOf(d.paidOrdersToday) + " order" + (countOf(d.paidOrdersToday) === 1 ? "" : "s") + ". Unpaid orders and unprocessed card payments are excluded.";
    if (/\b(today|activity|happened)\b/.test(q))
      return { text: "For " + (d.businessName || "this business") + " today: " + countOf(d.ordersToday) + " order" + (countOf(d.ordersToday) === 1 ? "" : "s") + " placed, " + countOf(c.pendingBookings) + " booking request" + (countOf(c.pendingBookings) === 1 ? "" : "s") + " awaiting a response, and " + countOf(c.unreadMessages) + " unread customer message" + (countOf(c.unreadMessages) === 1 ? "" : "s") + ". " + sales, action: null };
    if (/\b(sale|sales|payment|paid|revenue|money)\b/.test(q)) return { text: sales + " Payments & Earnings uses recorded order payment statuses; provider settlement and fees are not connected.", action: "payments" };
    if (/\b(order|orders|collection|prepare)\b/.test(q)) return { text: "There are " + countOf(c.activeOrders) + " active order" + (countOf(c.activeOrders) === 1 ? "" : "s") + ", including " + countOf(c.newOrders) + " awaiting acceptance and " + countOf(c.readyOrders) + " ready for collection.", action: "orders" };
    if (/\b(booking|bookings|reservation)\b/.test(q)) return { text: "There are " + countOf(c.pendingBookings) + " booking request" + (countOf(c.pendingBookings) === 1 ? "" : "s") + " awaiting your response. Booking requests are not confirmed reservations until you respond.", action: "bookings" };
    if (/\b(message|messages|customer|customers|behaviour|behavior)\b/.test(q)) return { text: "There are " + countOf(c.unreadMessages) + " unread customer message" + (countOf(c.unreadMessages) === 1 ? "" : "s") + ". Customer behaviour and purchasing patterns are available in Customers when StoreNest has enough recorded data.", action: "customers" };
    if (/\b(performance|analytics|trend|insight)\b/.test(q)) return { text: "For " + (d.businessName || "this business") + ", " + countOf(c.activeOrders) + " orders are active and " + countOf(c.pendingBookings) + " booking requests await a response. " + sales + " Open Analytics for longer-term trends and recorded findings.", action: "analytics" };
    if (/\b(set up|setup|storefront|publish|catalogue|catalog|product|service)\b/.test(q)) return { text: "To set up a storefront, complete the business name and category, add products or services, review the storefront design, then publish it when ready.", action: countOf(d.catalogCount) ? "storefront" : "items" };
    if (/\b(change|edit|cancel|delete|refund|accept|decline|update|mark paid|price)\b/.test(q)) return { text: "I can explain where to do that, but this guide is read-only and has not changed any business records. Use the relevant StoreNest page to review and confirm the action.", action: q.includes("order") ? "orders" : q.includes("booking") ? "bookings" : "settings" };
    return { text: "I can answer read-only questions about this business's current orders, bookings, unread customer messages and paid order records, or explain where to find StoreNest tools. This guided help is not connected to an AI service yet.", action: null };
  }
  function money(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", minimumFractionDigits: 2 }).format(amount) : "Unavailable";
  }
  function ownerCanRead(userId, business, businessId) {
    return canAccessBusiness(userId, business) && String(business.id) === String(businessId);
  }
  function currentBusinessId() { const select = byId("businessSelect"); return select ? String(select.value || "") : ""; }
  function text(id, value) { const node = byId(id); if (node) node.textContent = String(value == null ? "" : value); }
  function dateLabel(date) { return new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", dateStyle: "medium" }).format(date); }
  function timeLabel(value) {
    const date = new Date(value), now = new Date();
    if (!Number.isFinite(date.getTime())) return "";
    const today = saDayRange(now).day === saDayRange(date).day;
    const options = today
      ? { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" }
      : { timeZone: "Africa/Johannesburg", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return new Intl.DateTimeFormat("en-ZA", options).format(date);
  }
  async function countQuery(client, table, businessId, column, value) {
    return client.from(table).select("id", { count: "exact", head: true }).eq("business_id", businessId).eq(column, value);
  }
  async function fetchPaidToday(client, businessId, range) {
    let total = 0, count = 0, offset = 0, pageSize = 500;
    try {
      for (;;) {
        const result = await client.from("storefront_orders").select("id,subtotal,status,payment_status,created_at")
          .eq("business_id", businessId).eq("payment_status", "paid").neq("status", "cancelled").neq("status", "refunded")
          .gte("created_at", range.start.toISOString()).lt("created_at", range.end.toISOString())
          .order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);
        if (result.error) throw result.error;
        const rows = result.data || [];
        total += sumRecordedPaidSales(rows, range);
        count += rows.filter(isRecordedPaid).length;
        if (rows.length < pageSize) break;
        offset += pageSize;
      }
      return { total, count, unavailable: false };
    } catch (error) {
      console.warn("Overview paid sales are unavailable:", error);
      return { total: null, count: null, unavailable: true };
    }
  }
  async function fetchOverviewData(client, business, userId) {
    const businessId = String(business.id), day = saDayRange(new Date());
    const [active, fresh, accepted, prepared, ready, bookings, unread, catalog, ordersToday, orders, bookingRows, messageRows, lifecycle, insights, paidToday] = await Promise.all([
      client.from("storefront_orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).in("status", ACTIVE_ORDER_STATUSES),
      countQuery(client, "storefront_orders", businessId, "status", "new"),
      countQuery(client, "storefront_orders", businessId, "status", "accepted"),
      countQuery(client, "storefront_orders", businessId, "status", "prepared"),
      countQuery(client, "storefront_orders", businessId, "status", "ready"),
      client.from("service_booking_requests").select("id", { count: "exact", head: true }).eq("business_id", businessId).eq("status", "pending"),
      client.from("storefront_messages").select("id,conversation:storefront_conversations!inner(business_id)", { count: "exact", head: true })
        .eq("conversation.business_id", businessId).is("read_at", null).neq("sender_id", userId),
      client.from("business_items").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      client.from("storefront_orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", day.start.toISOString()).lt("created_at", day.end.toISOString()),
      client.from("storefront_orders").select("id,business_id,status,payment_status,subtotal,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(15),
      client.from("service_booking_requests").select("id,business_id,status,customer_name,event_date,created_at,updated_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(15),
      client.from("storefront_messages").select("id,conversation_id,sender_id,body,created_at,conversation:storefront_conversations!inner(business_id,customer_label)")
        .eq("conversation.business_id", businessId).neq("sender_id", userId).order("created_at", { ascending: false }).limit(15),
      client.from("business_analytics_lifecycle_events").select("id,business_id,entity_type,entity_id,from_status,to_status,changed_at").eq("business_id", businessId).order("changed_at", { ascending: false }).limit(60),
      client.from("business_analytics_insight_history").select("title,explanation,recommendation,priority,status,detected_at").eq("business_id", businessId).eq("priority", "high").eq("status", "new").neq("insight_type", "unanswered_messages").order("detected_at", { ascending: false }).limit(2),
      fetchPaidToday(client, businessId, day)
    ]);
    [active,fresh,accepted,prepared,ready,bookings,unread,catalog,ordersToday,orders,bookingRows,messageRows,lifecycle,insights].forEach(result => { if (result.error) throw result.error; });
    const counts = { activeOrders: active.count || 0, newOrders: fresh.count || 0, acceptedOrders: accepted.count || 0, preparedOrders: prepared.count || 0, readyOrders: ready.count || 0, pendingBookings: bookings.count || 0, unreadMessages: unread.count || 0 };
    const messages = (messageRows.data || []).map(row => {
      const conversation = Array.isArray(row.conversation) ? row.conversation[0] : row.conversation;
      return Object.assign({}, row, { business_id: conversation && conversation.business_id, conversation, sender_is_owner: String(row.sender_id) === String(userId) });
    });
    const activityData = { orders: orders.data || [], bookings: bookingRows.data || [], messages, lifecycleEvents: lifecycle.data || [] };
    return { business, counts, catalogCount: catalog.count || 0, ordersToday: ordersToday.count || 0, paidOrdersToday: paidToday.count, todaySales: paidToday.total,
      salesUnavailable: paidToday.unavailable, insights: insights.data || [], activities: createActivityFeed(activityData, businessId, 5), activityData, dayLabel: dateLabel(new Date()) };
  }
  function setLoading(value) {
    state.loading = value;
    const button = byId("pageRefreshButton");
    if (button) { button.disabled = value; button.setAttribute("aria-busy", String(value)); button.title = value ? "Refreshing this business…" : "Refresh this business Overview"; button.setAttribute("aria-label", button.title); }
    const icon = button && button.querySelector("svg"); if (icon) icon.classList.toggle("is-spinning", value);
    if (!state.error) text("overviewDataStatus", value ? "Refreshing this business…" : state.lastUpdated ? "Updated " + state.lastUpdated : "Live business records");
    renderAttention();
  }
  function clearMetrics(note) {
    ["overviewActiveOrders","overviewPendingBookings","overviewUnreadMessages","overviewTodaySales"].forEach(id => text(id, "—"));
    ["overviewOrdersNote","overviewBookingsNote","overviewMessagesNote","overviewSalesNote"].forEach(id => text(id, note || "Select a business to view activity."));
  }
  function renderAttention() {
    const list = byId("overviewAttentionList"), empty = byId("overviewAttentionEmpty");
    if (!list || !empty) return;
    list.replaceChildren();
    if (!state.attention.length) {
      empty.hidden = false;
      empty.textContent = state.loading ? "Checking for outstanding work…" : state.error ? "Could not check outstanding work. Refresh to try again." : "You’re all caught up.";
      return;
    }
    empty.hidden = true;
    state.attention.forEach(item => {
      const button = root.document.createElement("button"); button.type = "button"; button.className = "overview-attention-item";
      button.dataset.overviewTarget = item.target; button.setAttribute("aria-label", item.title + ". " + item.detail);
      const icon = root.document.createElement("span"); icon.className = "overview-attention-icon"; icon.setAttribute("aria-hidden", "true");
      icon.textContent = item.target === "orders" ? "▣" : item.target === "bookings" ? "▦" : item.target === "messages" ? "✉" : item.target === "analytics" ? "↗" : "→";
      const copy = root.document.createElement("span"); copy.className = "overview-attention-copy";
      const title = root.document.createElement("strong"); title.textContent = item.title;
      const detail = root.document.createElement("small"); detail.textContent = item.detail;
      copy.append(title, detail); button.append(icon, copy);
      const arrow = root.document.createElement("span"); arrow.className = "overview-attention-arrow"; arrow.textContent = "›"; button.appendChild(arrow);
      list.appendChild(button);
    });
  }
  function renderMetrics() {
    if (!state.metrics) return;
    text("overviewActiveOrders", state.metrics.counts.activeOrders);
    text("overviewPendingBookings", state.metrics.counts.pendingBookings);
    text("overviewUnreadMessages", state.metrics.counts.unreadMessages);
    text("overviewTodaySales", state.metrics.salesUnavailable ? "—" : money(state.metrics.todaySales));
    text("overviewOrdersNote", state.metrics.counts.activeOrders + " currently in progress");
    text("overviewBookingsNote", state.metrics.counts.pendingBookings + " awaiting a response");
    text("overviewMessagesNote", state.metrics.counts.unreadMessages + " unread customer message" + (state.metrics.counts.unreadMessages === 1 ? "" : "s"));
    text("overviewSalesNote", state.metrics.salesUnavailable ? "Paid sales unavailable right now." : state.metrics.paidOrdersToday + " paid order record" + (state.metrics.paidOrdersToday === 1 ? "" : "s") + " · orders placed " + state.metrics.dayLabel);
  }
  function timeLabel(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    const today = saDayRange(new Date()).day === saDayRange(date).day;
    const options = today
      ? { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" }
      : { timeZone: "Africa/Johannesburg", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    return new Intl.DateTimeFormat("en-ZA", options).format(date);
  }
  function activityNode(event) {
    const li = root.document.createElement("li"), button = root.document.createElement("button");
    button.type = "button"; button.className = "overview-activity-row"; button.dataset.overviewActivityTarget = event.target;
    if (event.recordId) button.dataset.recordId = event.recordId;
    if (event.target === "messages" && event.recordId) button.dataset.conversationId = event.recordId;
    const icon = root.document.createElement("span"); icon.className = "overview-activity-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = event.type === "order" ? "▣" : event.type === "booking" ? "▦" : "✉";
    const copy = root.document.createElement("span"); copy.className = "overview-activity-copy";
    const title = root.document.createElement("strong"); title.textContent = event.label;
    const detail = root.document.createElement("small"); detail.textContent = event.detail || "";
    copy.append(title, detail);
    const time = root.document.createElement("time"); time.dateTime = new Date(event.at).toISOString(); time.textContent = timeLabel(event.at);
    button.append(icon, copy, time); li.appendChild(button); return li;
  }
  function renderActivity() {
    const list = byId("overviewActivityList"), empty = byId("overviewActivityEmpty");
    if (!list || !empty) return;
    list.replaceChildren();
    const rows = state.activities || [];
    empty.hidden = rows.length > 0; list.hidden = rows.length === 0;
    rows.forEach(event => list.appendChild(activityNode(event)));
  }
  function renderChat() {
    const thread = byId("overviewAssistantThread"), suggestions = byId("overviewAssistantSuggestions"), intro = byId("overviewAssistantIntro");
    if (!thread || !suggestions) return;
    thread.replaceChildren();
    if (!state.chat.length) {
      if (intro) intro.hidden = false;
      thread.hidden = true; suggestions.hidden = false; return;
    }
    if (intro) intro.hidden = true;
    thread.hidden = false; suggestions.hidden = true;
    state.chat.forEach(message => {
      const wrap = root.document.createElement("div"); wrap.className = "overview-chat-message is-" + message.role;
      const bubble = root.document.createElement("p"); bubble.textContent = message.text; wrap.appendChild(bubble);
      if (message.action) {
        const action = root.document.createElement("button"); action.type = "button"; action.className = "overview-chat-action";
        action.dataset.overviewTarget = message.action; action.textContent = "Open " + (message.action === "items" ? "Products & Services" : message.action === "payments" ? "Payments & Earnings" : message.action.charAt(0).toUpperCase() + message.action.slice(1));
        wrap.appendChild(action);
      }
      thread.appendChild(wrap);
    });
    thread.scrollTop = thread.scrollHeight;
  }
  function routeTo(target, recordId, conversationId) {
    if (target !== "createBusiness" && !state.businessId) return;
    resolveOverviewNavigation(target, recordId, conversationId).forEach(action => root.dispatchEvent(new CustomEvent(action.name, {
      detail: Object.assign({ businessId: state.businessId || null }, action.detail)
    })));
  }
  function renderHistory(data) {
    const list = byId("overviewActivityHistoryList");
    if (!list) return;
    createActivityFeed(data, state.businessId, 100).forEach(event => list.appendChild(activityNode(event)));
  }
  async function loadHistoryPage(reset) {
    if (!state.client || !state.businessId || state.historyLoading || (!reset && state.historyDone)) return;
    if (reset) { state.historyOffset = 0; state.historyDone = false; const list = byId("overviewActivityHistoryList"); if (list) list.replaceChildren(); }
    const client = state.client, businessId = state.businessId, userId = state.userId, offset = state.historyOffset, limit = 20;
    const button = byId("overviewActivityLoadOlder");
    state.historyLoading = true;
    if (button) { button.disabled = true; button.textContent = "Loading…"; }
    try {
      const results = await Promise.all([
        client.from("storefront_orders").select("id,business_id,status,payment_status,subtotal,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).range(offset, offset + limit - 1),
        client.from("service_booking_requests").select("id,business_id,status,customer_name,event_date,created_at,updated_at").eq("business_id", businessId).order("created_at", { ascending: false }).range(offset, offset + limit - 1),
        client.from("storefront_messages").select("id,conversation_id,sender_id,body,created_at,conversation:storefront_conversations!inner(business_id,customer_label)").eq("conversation.business_id", businessId).neq("sender_id", userId).order("created_at", { ascending: false }).range(offset, offset + limit - 1),
        client.from("business_analytics_lifecycle_events").select("id,business_id,entity_type,entity_id,from_status,to_status,changed_at").eq("business_id", businessId).order("changed_at", { ascending: false }).range(offset, offset + limit - 1)
      ]);
      results.forEach(result => { if (result.error) throw result.error; });
      if (String(state.businessId) !== businessId) return;
      const messages = (results[2].data || []).map(row => {
        const conversation = Array.isArray(row.conversation) ? row.conversation[0] : row.conversation;
        return Object.assign({}, row, { business_id: conversation && conversation.business_id, conversation, sender_is_owner: String(row.sender_id) === String(userId) });
      });
      const data = { orders: results[0].data || [], bookings: results[1].data || [], messages, lifecycleEvents: results[3].data || [] };
      renderHistory(data);
      state.historyOffset += limit;
      state.historyDone = results.every(result => (result.data || []).length < limit);
      const list = byId("overviewActivityHistoryList"), empty = byId("overviewActivityHistoryEmpty");
      if (empty) empty.hidden = Boolean(list && list.children.length);
      if (button) { button.hidden = state.historyDone; button.disabled = false; button.textContent = "Load older activity"; }
    } catch (error) {
      console.error("Overview history could not load:", error);
      text("overviewActivityHistoryStatus", "Could not load activity. Try again.");
      if (button) { button.disabled = false; button.textContent = "Retry"; }
    } finally { state.historyLoading = false; }
  }
  function openHistory() {
    const dialog = byId("overviewActivityDialog");
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
    loadHistoryPage(true);
  }
  function closeHistory() {
    const dialog = byId("overviewActivityDialog");
    if (dialog && dialog.open && typeof dialog.close === "function") dialog.close();
    else if (dialog) dialog.removeAttribute("open");
  }
  function ask(question) {
    const value = String(question || "").trim();
    if (!value) return;
    if (value.length > 400) { text("overviewAssistantStatus", "Please keep your question under 400 characters."); return; }
    if (state.businessId && (!state.business || !ownerCanRead(state.userId, state.business, state.businessId))) {
      text("overviewAssistantStatus", "Still checking access to the selected business. Please try again.");
      return;
    }
    const reply = assistantReply(value, {
      hasBusiness: Boolean(state.business && ownerCanRead(state.userId, state.business, state.businessId)),
      businessName: state.business && state.business.name, counts: state.counts, catalogCount: state.metrics && state.metrics.catalogCount,
      ordersToday: state.metrics && state.metrics.ordersToday, todaySales: state.metrics && state.metrics.todaySales,
      paidOrdersToday: state.metrics && state.metrics.paidOrdersToday, salesUnavailable: Boolean(state.metrics && state.metrics.salesUnavailable) || state.error
    });
    state.chat.push({ role: "user", text: value }, { role: "assistant", text: reply.text, action: reply.action });
    if (state.chat.length > 30) state.chat.splice(0, state.chat.length - 30);
    renderChat();
    text("overviewAssistantStatus", "Read-only guided answer from StoreNest records. No AI service or server-side chat history is connected.");
    const input = byId("overviewAssistantInput"); if (input) { input.value = ""; input.focus(); }
  }
  function setError(message) {
    state.error = true; text("overviewDataStatus", message || "Could not refresh business activity. Try again.");
    const node = byId("overviewDataStatus"); if (node) node.classList.add("is-error");
    renderAttention();
  }
  function renderNoBusiness() {
    state.sequence++; state.businessId = ""; state.business = null; state.userId = ""; state.metrics = null; state.counts = {}; state.activities = []; state.attention = []; state.chat = []; state.error = false; state.loading = false; state.lastUpdated = "";
    const button = byId("pageRefreshButton"); if (button) { button.disabled = false; button.setAttribute("aria-busy", "false"); }
    const icon = button && button.querySelector("svg"); if (icon) icon.classList.remove("is-spinning");
    clearMetrics("Create a business to see current activity.");
    state.attention = buildAttentionItems({ business: null });
    renderAttention(); renderActivity(); renderChat(); text("overviewDataStatus", "Create a business to get started.");
  }
  async function refresh() {
    const businessId = currentBusinessId(), client = root.StoreNestBusinessClient || state.client;
    if (!businessId) { renderNoBusiness(); return; }
    if (!client) { setError("StoreNest business data is not connected. Refresh to try again."); return; }
    const sequence = ++state.sequence; state.client = client; state.businessId = businessId; state.error = false; state.loading = true; setLoading(true);
    try {
      const auth = await client.auth.getUser(), user = auth && auth.data && auth.data.user;
      if (auth && auth.error) throw auth.error;
      if (!user) throw new Error("Sign in again to view this business.");
      const response = await client.from("businesses").select("id,owner_id,name,category,is_published,description,location").eq("id", businessId).maybeSingle();
      if (response.error) throw response.error;
      if (!response.data || !canAccessBusiness(user.id, response.data)) throw new Error("This business is not available to the signed-in owner.");
      if (sequence !== state.sequence || businessId !== currentBusinessId()) return;
      state.userId = user.id; state.business = response.data;
      const metrics = await fetchOverviewData(client, state.business, user.id);
      if (sequence !== state.sequence || businessId !== currentBusinessId()) return;
      state.metrics = metrics; state.counts = metrics.counts; state.activities = metrics.activities;
      state.attention = buildAttentionItems({ business: state.business, counts: metrics.counts, catalogCount: metrics.catalogCount, insights: metrics.insights });
      state.lastUpdated = new Intl.DateTimeFormat("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit" }).format(new Date());
      state.error = false; renderMetrics(); renderAttention(); renderActivity(); renderChat();
      text("overviewDataStatus", "Updated " + state.lastUpdated);
      const status = byId("overviewDataStatus"); if (status) status.classList.remove("is-error");
    } catch (error) {
      if (sequence !== state.sequence) return;
      console.error("StoreNest Overview refresh failed:", error);
      setError("Could not refresh business activity. Try again.");
      if (!state.metrics) clearMetrics("Could not load this business yet.");
    } finally {
      if (sequence === state.sequence) { state.loading = false; setLoading(false); }
    }
  }
  function scheduleRefresh() { clearTimeout(state.debounce); state.debounce = setTimeout(() => refresh(), 200); }
  function onBusinessReady(event) {
    const id = String(event && event.detail && event.detail.businessId || currentBusinessId());
    if (!id) { renderNoBusiness(); return; }
    if (id !== state.businessId) {
      state.sequence++; state.businessId = id; state.business = null; state.userId = ""; state.metrics = null; state.counts = {}; state.activities = []; state.attention = []; state.chat = [];
      clearMetrics("Loading selected business…"); renderAttention(); renderActivity(); renderChat();
    }
    scheduleRefresh();
  }
  function onDataChange(event) {
    const detail = event && event.detail || {};
    if (!root.document.querySelector('[data-section-view="overview"]:not([hidden])')) return;
    if (!detail.businessId || String(detail.businessId) === String(currentBusinessId())) scheduleRefresh();
  }
  function init() {
    const section = root.document.querySelector('[data-section-view="overview"]');
    if (!section || section.dataset.overviewInitialized === "true") return;
    section.dataset.overviewInitialized = "true";
    root.addEventListener("storenest:owner-business-ready", onBusinessReady);
    root.addEventListener("storenest:owner-overview-refresh", refresh);
    root.addEventListener("storenest:owner-orders-updated", onDataChange);
    root.addEventListener("storenest:owner-bookings-updated", onDataChange);
    root.addEventListener("storenest:owner-messages-updated", onDataChange);
    root.addEventListener("storenest:owner-section-changed", event => {
      const detail = event && event.detail || {};
      if (detail.section === "overview" && (!detail.businessId || String(detail.businessId) === String(currentBusinessId()))) scheduleRefresh();
    });
    root.addEventListener("visibilitychange", () => { if (!root.document.hidden) scheduleRefresh(); });
    root.document.addEventListener("click", event => {
      const target = event.target.closest("[data-overview-target]");
      if (target) { routeTo(target.dataset.overviewTarget); return; }
      const metric = event.target.closest("[data-overview-metric]");
      if (metric) { routeTo(metricTarget(metric.dataset.overviewMetric)); return; }
      const row = event.target.closest("[data-overview-activity-target]");
      if (row) { routeTo(row.dataset.overviewActivityTarget, row.dataset.recordId, row.dataset.conversationId); return; }
      if (event.target.closest("#overviewActivityViewAll")) { openHistory(); return; }
      if (event.target.closest("#overviewActivityLoadOlder")) { loadHistoryPage(false); return; }
      const suggestion = event.target.closest("[data-assistant-question]");
      if (suggestion) { ask(suggestion.dataset.assistantQuestion); return; }
      if (event.target.closest("[data-overview-dialog-close]")) closeHistory();
    });
    const form = byId("overviewAssistantForm");
    if (form) form.addEventListener("submit", event => { event.preventDefault(); ask(byId("overviewAssistantInput").value); });
    const dialog = byId("overviewActivityDialog");
    if (dialog) dialog.addEventListener("click", event => { if (event.target === dialog) closeHistory(); });
    const select = byId("businessSelect");
    if (select) select.addEventListener("change", scheduleRefresh);
    state.timer = setInterval(() => {
      if (!root.document.hidden && root.document.querySelector('[data-section-view="overview"]:not([hidden])')) scheduleRefresh();
    }, 180000);
    if (currentBusinessId()) scheduleRefresh(); else renderNoBusiness();
  }
  function setLoading(value) {
    state.loading = value;
    const button = byId("pageRefreshButton");
    if (button) { button.disabled = value; button.setAttribute("aria-busy", String(value)); button.title = value ? "Refreshing this business…" : "Refresh this business Overview"; }
    const icon = button && button.querySelector("svg"); if (icon) icon.classList.toggle("is-spinning", value);
    if (!state.error) text("overviewDataStatus", value ? "Refreshing this business…" : state.lastUpdated ? "Updated " + state.lastUpdated : "Live business records");
    renderAttention();
  }
  function openForTest() {}
  root.StoreNestOverviewDashboard = Object.freeze({
    ACTIVE_ORDER_STATUSES, isActiveOrder, isRecordedPaid, sumRecordedPaidSales, saDayRange, canAccessBusiness, buildAttentionItems, createActivityFeed, formatActivityTime: timeLabel,
    metricTarget, resolveOverviewNavigation, assistantReply, getLoadMessage: input => input && input.loading ? "Refreshing this business…" : input && input.error ? "Could not refresh business activity. Try again." : input && input.empty ? "No recent recorded activity yet." : "Live business records",
    init, refresh, getState: () => ({ businessId: state.businessId, counts: Object.assign({}, state.counts), loading: state.loading, error: state.error, activityCount: state.activities.length })
  });
  if (typeof module !== "undefined" && module.exports) module.exports = root.StoreNestOverviewDashboard;
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
