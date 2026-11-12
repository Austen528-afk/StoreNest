(function (root) {
  "use strict";

  const engine = root.StoreNestAnalyticsEngine;
  const PAGE_SIZE = 1000;
  const state = {
    businessId: "",
    businessName: "",
    orders: [],
    customerHistory: [],
    events: [],
    items: [],
    categories: [],
    bookings: [],
    lifecycleEvents: [],
    lifecycleAvailable: false,
    lifecycleTrackingStartedAt: null,
    conversations: [],
    messages: [],
    messagesAvailable: false,
    ownerId: "",
    insightHistory: [],
    historyAvailable: false,
    historyOpen: false,
    historyStatus: "all",
    selectedItemId: "",
    productFilters: { query: "", category: "all", availability: "all", sort: "views" },
    bookingAttributionAvailable: false,
    insightStates: {},
    eventsAvailable: false,
    orderAttributionAvailable: false,
    statesAvailable: false,
    loading: false,
    error: "",
    loaded: false,
    request: 0,
    insightsExpanded: false,
    activeInsightKey: "",
    activeView: "",
    metric: "orders",
    defaultMetric: "orders",
    period: "last30",
    custom: { start: "", end: "" }
  };

  const $ = id => root.document && root.document.getElementById(id);
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const money = value => "R" + Number(value || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const number = value => Number(value || 0).toLocaleString("en-ZA", { maximumFractionDigits: 0 });
  const dateLabel = date => new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(date);

  function periodSelection() {
    const select = $("analyticsDateRange");
    return select ? select.value : state.period;
  }

  function rangeSelection() {
    return engine.dateRange(periodSelection(), {
      start: $("analyticsCustomStart")?.value || state.custom.start,
      end: $("analyticsCustomEnd")?.value || state.custom.end
    }, new Date());
  }

  function setStatusMessage(text, isError) {
    const message = $("analyticsStatusMessage");
    if (!message) return;
    message.textContent = text || "";
    message.hidden = !text;
    message.classList.toggle("is-error", Boolean(isError));
  }

  function pageState({ loading = state.loading, error = state.error } = {}) {
    const loadingEl = $("analyticsLoading");
    const errorEl = $("analyticsError");
    const content = $("analyticsContent");
    if (loadingEl) loadingEl.hidden = !loading;
    if (errorEl) errorEl.hidden = !error;
    if (content) content.hidden = loading || Boolean(error);
    if (errorEl) {
      const text = errorEl.querySelector("[data-error-copy]");
      if (text) text.textContent = error || "";
    }
  }

  async function fetchRows(client, table, columns, businessId, orderColumn, startAt) {
    const result = [];
    let offset = 0;
    while (true) {
      let query = client.from(table).select(columns).eq("business_id", businessId);
      if (startAt && orderColumn) query = query.gte(orderColumn, startAt.toISOString());
      if (orderColumn) query = query.order(orderColumn, { ascending: true });
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      result.push(...rows);
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return result;
  }

  function minQueryDate(range, statuses) {
    let earliest = range ? range.previousStart : new Date(Date.now() - 90 * 86400000);
    const last180Days = new Date();
    last180Days.setDate(last180Days.getDate() - 180);
    if (last180Days < earliest) earliest = last180Days;
    for (const row of Object.values(statuses || {})) {
      const actedAt = row && row.acted_at ? new Date(row.acted_at) : null;
      if (actedAt && !Number.isNaN(actedAt.getTime())) {
        actedAt.setDate(actedAt.getDate() - 7);
        if (actedAt < earliest) earliest = actedAt;
      }
    }
    return earliest;
  }

  async function fetchInsightStates(client, businessId) {
    const { data, error } = await client.from("business_analytics_insight_states")
      .select("insight_key,status,updated_at,acted_at")
      .eq("business_id", businessId);
    if (error) throw error;
    return Object.fromEntries((data || []).map(row => [row.insight_key, row]));
  }

  async function fetchInsightHistory(client, businessId) {
    const { data, error } = await client.from("business_analytics_insight_history")
      .select("id,business_id,observation_key,insight_key,insight_type,title,explanation,priority,status,evidence_snapshot,interpretation,recommendation,observation_start,observation_end,detected_at,updated_at,acted_at,action_note,follow_up_snapshot,metric,item_id,is_service")
      .eq("business_id", businessId)
      .order("detected_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data || [];
  }

  async function fetchLifecycleData(client, businessId, from) {
    try {
      const [events, configResult] = await Promise.all([
        fetchRows(client, "business_analytics_lifecycle_events", "business_id,entity_type,entity_id,from_status,to_status,changed_at,actor_id", businessId, "changed_at", from),
        client.from("business_analytics_tracking_config").select("lifecycle_tracking_started_at").eq("id", 1).limit(1)
      ]);
      if (configResult.error) throw configResult.error;
      const startedAt = configResult.data?.[0]?.lifecycle_tracking_started_at || null;
      return { events, available: Boolean(startedAt), startedAt };
    } catch (error) {
      console.info("StoreNest Analytics lifecycle tracking is not available yet:", error.message || error);
      return { events: [], available: false, startedAt: null };
    }
  }

  async function fetchMessageMetadata(client, businessId, from) {
    try {
      const authResult = await client.auth.getUser();
      const ownerId = authResult?.data?.user?.id || "";
      if (!ownerId) return { available: false, ownerId: "", conversations: [], messages: [] };
      const { data: conversations, error: conversationError } = await client.from("storefront_conversations")
        .select("id,business_id,customer_id,created_at")
        .eq("business_id", businessId);
      if (conversationError) throw conversationError;
      const rows = conversations || [];
      const messageRows = [];
      for (let start = 0; start < rows.length; start += 80) {
        const ids = rows.slice(start, start + 80).map(row => row.id);
        if (!ids.length) continue;
        let offset = 0;
        while (true) {
          const { data, error } = await client.from("storefront_messages")
            .select("conversation_id,sender_id,created_at")
            .in("conversation_id", ids)
            .gte("created_at", from.toISOString())
            .order("created_at", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);
          if (error) throw error;
          const batch = data || [];
          messageRows.push(...batch);
          if (batch.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }
      }
      return { available: true, ownerId, conversations: rows, messages: messageRows };
    } catch (error) {
      console.info("StoreNest Analytics message timing is not available yet:", error.message || error);
      return { available: false, ownerId: "", conversations: [], messages: [] };
    }
  }

  async function loadData(force) {
    if (!state.businessId || (state.loading && !force)) return;
    const client = root.StoreNestBusinessClient;
    if (!client) return;
    const request = ++state.request;
    state.loading = true;
    state.error = "";
    pageState({ loading: true, error: "" });
    const range = rangeSelection();
    if (!range) {
      state.loading = false;
      state.error = "Choose a valid start and end date.";
      pageState({ loading: false, error: state.error });
      return;
    }

    try {
      let statesAvailable = true;
      let historyAvailable = true;
      let insightStates = {};
      let insightHistory = [];
      try {
        insightStates = await fetchInsightStates(client, state.businessId);
      } catch (error) {
        statesAvailable = false;
        console.warn("StoreNest Analytics could not load saved insight states:", error.message || error);
      }
      try {
        insightHistory = await fetchInsightHistory(client, state.businessId);
      } catch (error) {
        historyAvailable = false;
        console.info("StoreNest Analytics insight history is not available yet:", error.message || error);
      }
      const historyStates = Object.fromEntries(insightHistory.map(row => [row.observation_key, { acted_at: row.acted_at }]));
      const from = minQueryDate(range, { ...insightStates, ...historyStates });
      const customerHistoryPromise = fetchRows(client, "storefront_orders", "id,business_id,customer_user_id,created_at,status,payment_status", state.businessId, "created_at", null);
      const itemPromise = fetchRows(client, "business_items", "*", state.businessId, "created_at", null);
      const categoryPromise = fetchRows(client, "business_categories", "id,business_id,name", state.businessId, "name", null);
      const orderPromise = (async () => {
        try {
          const rows = await fetchRows(client, "storefront_orders", "id,business_id,created_at,status,payment_status,subtotal,items,customer_user_id,analytics_session_id", state.businessId, "created_at", from);
          return { rows, attribution: true };
        } catch (error) {
          if (!/analytics_session_id|column/i.test(String(error.message || error))) throw error;
          const rows = await fetchRows(client, "storefront_orders", "id,business_id,created_at,status,payment_status,subtotal,items,customer_user_id", state.businessId, "created_at", from);
          return { rows, attribution: false };
        }
      })();
      const eventPromise = (async () => {
        try {
          const rows = await fetchRows(client, "storefront_analytics_events", "business_id,event_type,session_id,item_id,occurred_at", state.businessId, "occurred_at", from);
          return { rows, available: true };
        } catch (error) {
          console.warn("StoreNest Analytics visit tracking is not available yet:", error.message || error);
          return { rows: [], available: false };
        }
      })();
      const bookingPromise = (async () => {
        try {
          const rows = await fetchRows(client, "service_booking_requests", "id,business_id,item_id,status,created_at,updated_at,customer_user_id,analytics_session_id", state.businessId, "created_at", from);
          return { rows, attribution: true };
        } catch (error) {
          if (!/analytics_session_id|column/i.test(String(error.message || error))) throw error;
          const rows = await fetchRows(client, "service_booking_requests", "id,business_id,item_id,status,created_at,updated_at,customer_user_id", state.businessId, "created_at", from);
          return { rows, attribution: false };
        }
      })();
      const lifecyclePromise = fetchLifecycleData(client, state.businessId, from);
      const messagePromise = fetchMessageMetadata(client, state.businessId, from);
      const [customerHistory, items, categories, orderResult, eventResult, bookingResult, lifecycleResult, messageResult] = await Promise.all([
        customerHistoryPromise, itemPromise, categoryPromise, orderPromise, eventPromise, bookingPromise, lifecyclePromise, messagePromise
      ]);
      if (request !== state.request) return;
      state.orders = orderResult.rows;
      state.customerHistory = customerHistory;
      state.items = items;
      state.categories = categories;
      state.events = eventResult.rows;
      state.eventsAvailable = eventResult.available;
      state.orderAttributionAvailable = orderResult.attribution;
      state.bookings = bookingResult.rows;
      state.bookingAttributionAvailable = bookingResult.attribution;
      state.lifecycleEvents = lifecycleResult.events;
      state.lifecycleAvailable = lifecycleResult.available;
      state.lifecycleTrackingStartedAt = lifecycleResult.startedAt;
      state.ownerId = messageResult.ownerId;
      state.conversations = messageResult.conversations;
      state.messages = messageResult.messages;
      state.messagesAvailable = messageResult.available;
      state.insightStates = insightStates;
      state.statesAvailable = statesAvailable;
      state.insightHistory = insightHistory;
      state.historyAvailable = historyAvailable;
      state.loaded = true;
      state.error = "";
      state.loading = false;
      pageState({ loading: false, error: "" });
      render(currentSnapshot());
    } catch (error) {
      if (request !== state.request) return;
      state.loading = false;
      state.error = "Analytics could not load from this business’s StoreNest records. Please refresh and try again.";
      console.error("StoreNest Analytics query failed:", error);
      pageState({ loading: false, error: state.error });
    }
  }

  function currentSnapshot() {
    const selected = rangeSelection();
    return engine.buildSnapshot({
      businessId: state.businessId,
      orders: state.orders,
      customerHistory: state.customerHistory,
      events: state.events,
      eventsAvailable: state.eventsAvailable,
      orderAttributionAvailable: state.orderAttributionAvailable,
      items: state.items,
      bookings: state.bookings,
      categories: state.categories,
      lifecycleEvents: state.lifecycleEvents,
      lifecycleAvailable: state.lifecycleAvailable,
      lifecycleTrackingStartedAt: state.lifecycleTrackingStartedAt,
      ownerId: state.ownerId,
      conversations: state.conversations,
      messages: state.messages,
      messagesAvailable: state.messagesAvailable,
      bookingAttributionAvailable: state.bookingAttributionAvailable,
      period: periodSelection(),
      custom: { start: $("analyticsCustomStart")?.value, end: $("analyticsCustomEnd")?.value },
      now: new Date()
    });
  }

  function metricChange(current, previous, type) {
    if (current == null || previous == null) return { label: "Not enough data", tone: "neutral" };
    if (type === "rate") {
      const points = current - previous;
      if (Math.abs(points) < 0.05) return { label: "No change", tone: "neutral" };
      return { label: (points > 0 ? "+" : "") + points.toFixed(1) + " pp", tone: points > 0 ? "positive" : "negative" };
    }
    const change = engine.percentageChange(current, previous);
    if (change.value == null) return { label: change.label, tone: current > 0 ? "positive" : "neutral" };
    if (Math.abs(change.value) < 0.05) return { label: "No change", tone: "neutral" };
    return { label: change.label, tone: change.value > 0 ? "positive" : "negative" };
  }

  const VIEW_TREND_SETTINGS = Object.freeze({
    customers: { title: "Customer Trends", description: "Repeat purchases from identified customers.", metric: "returning" },
    products: { title: "Product or Service Trends", description: "Unique product and service views over time.", metric: "product_views" },
    orders: { title: "Order Trends", description: "Orders placed during the selected period.", metric: "orders" },
    operations: { title: "Operations Trends", description: "Booking requests received during the selected period.", metric: "bookings" }
  });

  function renderSummary(snapshot, view) {
    const list = $("analyticsSummary");
    if (!list) return;
    const summaryMetric = (label, value, change, hint) => ({ label, value, change, hint });
    let metrics;
    if (view === "customers") {
      const current = snapshot.customers;
      const previous = snapshot.previousCustomers;
      metrics = [
        summaryMetric("Identified purchasers", number(current.identifiedBuyers), metricChange(current.identifiedBuyers, previous.identifiedBuyers, "count"), "Completed orders linked to customer accounts"),
        summaryMetric("New purchasers", number(current.newBuyers), metricChange(current.newBuyers, previous.newBuyers, "count"), "First recorded completed purchase"),
        summaryMetric("Returning purchasers", number(current.returningBuyers), metricChange(current.returningBuyers, previous.returningBuyers, "count"), "Had an earlier completed purchase"),
        summaryMetric("Returning share", current.returningRate == null ? "—" : current.returningRate.toFixed(1) + "%", metricChange(current.returningRate, previous.returningRate, "rate"), current.identifiedBuyers < 5 ? "Needs 5 identified purchasers" : "Share of identified purchasers")
      ];
    } else if (view === "products") {
      const itemViews = snapshot.eventTrackingAvailable
        ? [...snapshot.productViews.values()].reduce((sum, sessions) => sum + sessions.size, 0)
        : null;
      const itemsWithViews = snapshot.eventTrackingAvailable
        ? snapshot.items.filter(item => (snapshot.productViews.get(String(item.id)) || new Set()).size > 0).length
        : null;
      const demand = snapshot.items.reduce((sum, item) => {
        const id = String(item.id || "");
        return sum + (String(item.item_type || "").toLowerCase() === "service"
          ? (snapshot.serviceBookingRequests.get(id) || 0)
          : (snapshot.productPurchases.get(id) || 0));
      }, 0);
      metrics = [
        summaryMetric("Products & services", number(snapshot.items.length), { label: "Current catalogue", tone: "neutral" }, "Items listed by this business"),
        summaryMetric("Items with views", itemsWithViews == null ? "Not tracked" : number(itemsWithViews), { label: "Selected period", tone: "neutral" }, "Items opened by storefront visitors"),
        summaryMetric("Unique item views", itemViews == null ? "Not tracked" : number(itemViews), { label: "Selected period", tone: "neutral" }, "Unique visitor sessions per item"),
        summaryMetric("Orders / requests", number(demand), { label: "Selected period", tone: "neutral" }, "Completed units and booking requests")
      ];
    } else if (view === "orders") {
      const completed = rows => rows.filter(row => row.status === "completed");
      const completedForValue = rows => rows.filter(row => row.status === "completed" && row.payment_status !== "refunded");
      const cancelled = rows => rows.filter(row => row.status === "cancelled");
      const currentCompleted = completed(snapshot.currentOrders);
      const previousCompleted = completed(snapshot.previousOrders);
      const currentCancelled = cancelled(snapshot.currentOrders);
      const previousCancelled = cancelled(snapshot.previousOrders);
      const currentValueOrders = completedForValue(snapshot.currentOrders);
      const previousValueOrders = completedForValue(snapshot.previousOrders);
      const currentAverage = currentValueOrders.length ? currentValueOrders.reduce((sum, row) => sum + row.subtotal, 0) / currentValueOrders.length : null;
      const previousAverage = previousValueOrders.length ? previousValueOrders.reduce((sum, row) => sum + row.subtotal, 0) / previousValueOrders.length : null;
      metrics = [
        summaryMetric("Orders placed", number(snapshot.ordersPlaced), metricChange(snapshot.ordersPlaced, snapshot.previousOrdersPlaced, "count"), "Includes orders later cancelled"),
        summaryMetric("Completed orders", number(currentCompleted.length), metricChange(currentCompleted.length, previousCompleted.length, "count"), "Current workflow status"),
        summaryMetric("Cancelled orders", number(currentCancelled.length), metricChange(currentCancelled.length, previousCancelled.length, "count"), "Included in orders placed"),
        summaryMetric("Average order value", currentAverage == null ? "—" : money(currentAverage), metricChange(currentAverage, previousAverage, "count"), "Completed, non-refunded orders")
      ];
    } else if (view === "operations") {
      const countStatus = (rows, status) => rows.filter(row => row.status === status).length;
      const bookingCount = (rows, status) => rows.filter(row => row.status === status).length;
      metrics = [
        summaryMetric("Orders completed", number(countStatus(snapshot.currentOrders, "completed")), metricChange(countStatus(snapshot.currentOrders, "completed"), countStatus(snapshot.previousOrders, "completed"), "count"), "Current recorded status"),
        summaryMetric("Orders cancelled", number(countStatus(snapshot.currentOrders, "cancelled")), metricChange(countStatus(snapshot.currentOrders, "cancelled"), countStatus(snapshot.previousOrders, "cancelled"), "count"), "Current recorded status"),
        summaryMetric("Booking requests", number(snapshot.currentBookings.length), { label: "Selected period", tone: "neutral" }, "Requests received during this period"),
        summaryMetric("Pending bookings", number(bookingCount(snapshot.currentBookings, "pending")), { label: "Current status", tone: "neutral" }, "Awaiting a business response")
      ];
    } else {
      const conversion = snapshot.conversion.value;
      const returning = snapshot.customers.returningRate;
      metrics = [
        summaryMetric("Store Visits", snapshot.visits == null ? "Not yet tracked" : number(snapshot.visits), metricChange(snapshot.visits, snapshot.previousVisits, "count"), snapshot.eventTrackingAvailable ? "Unique storefront sessions" : "Visit tracking is not connected yet"),
        summaryMetric("Orders", number(snapshot.ordersPlaced), metricChange(snapshot.ordersPlaced, snapshot.previousOrdersPlaced, "count"), "Orders placed, including later cancellations"),
        summaryMetric("Conversion", conversion == null ? "—" : conversion.toFixed(1) + "%", metricChange(conversion, snapshot.previousConversion.value, "rate"), snapshot.conversion.reason === "untracked" || !snapshot.orderAttributionAvailable ? "Not yet tracked" : snapshot.conversion.reason === "insufficient" ? "Needs 10 tracked sessions" : "Tracked sessions that submitted an order"),
        summaryMetric("Returning", returning == null ? "—" : returning.toFixed(1) + "%", metricChange(returning, snapshot.previousCustomers.returningRate, "rate"), snapshot.customers.identifiedBuyers < 5 ? "Needs 5 identified purchasers" : "Identified purchasers with an earlier completed order")
      ];
    }
    list.setAttribute("aria-label", view ? view[0].toUpperCase() + view.slice(1) + " performance summary" : "Performance summary");
    list.innerHTML = metrics.map(metric => '<article class="analytics-summary-item"><span>' + escapeHtml(metric.label) + '</span><strong>' + escapeHtml(metric.value) + '</strong><small class="analytics-delta ' + metric.change.tone + '">' + escapeHtml(metric.change.label) + '</small><em>' + escapeHtml(metric.hint) + '</em></article>').join("");
  }

  function yValue(value, metric) {
    if (value == null) return "—";
    if (metric === "conversion" || metric === "item_conversion") return Number(value).toFixed(1) + "%";
    if (metric.endsWith("_hours")) return Number(value).toFixed(1) + " h";
    return number(value);
  }

  function renderChart(snapshot) {
    const host = $("analyticsChart");
    if (!host) return;
    const metricSelect = $("analyticsMetric");
    const itemMetrics = ["item_purchases", "item_booking_requests", "item_cart_adds", "item_conversion"];
    if (metricSelect) {
      const serviceSelected = selectedItemType(snapshot, state.selectedItemId) === "service";
      for (const option of metricSelect.options) {
        if (itemMetrics.includes(option.value)) option.hidden = state.activeView !== "products" || !state.selectedItemId || (option.value === "item_purchases" && serviceSelected) || (option.value === "item_booking_requests" && !serviceSelected);
      }
      const selectedOption = Array.from(metricSelect.options).find(option => option.value === metricSelect.value);
      if (itemMetrics.includes(metricSelect.value) && (!state.selectedItemId || state.activeView !== "products" || selectedOption?.hidden)) {
        metricSelect.value = state.activeView === "products" ? (serviceSelected ? "item_booking_requests" : "product_views") : (state.defaultMetric || "orders");
      }
    }
    const metric = metricSelect?.value || state.metric;
    state.metric = metric;
    const selectedItem = state.activeView === "products" ? snapshot.itemPerformance.find(row => row.id === state.selectedItemId) : null;
    const series = engine.buildSeries(snapshot, metric, selectedItem?.id || "");
    const labels = { orders: "Orders", visits: "Store visits", conversion: "Conversion", returning: "Returning customers", product_views: selectedItem ? selectedItem.name + " views" : "Unique item views", bookings: "Booking requests", completed_orders: "Completed orders", cancelled_orders: "Cancelled orders", item_purchases: selectedItem?.type === "service" ? "Service requests" : "Completed item units", item_booking_requests: "Service booking requests", item_cart_adds: "Item cart adds", item_conversion: selectedItem?.type === "service" ? "View-to-request rate" : "View-to-purchase rate", order_acceptance_hours: "Order acceptance time", order_accepted_to_preparation_hours: "Acceptance to preparation time", order_preparation_hours: "Preparation time", order_collection_hours: "Ready to collection time", order_fulfilment_hours: "Order fulfilment time", booking_response_hours: "Booking response time", booking_completion_hours: "Booking completion time", message_response_hours: "Message response time" };
    const label = labels[metric] || "Orders";
    const lifecycleMetrics = ["completed_orders", "cancelled_orders", "order_acceptance_hours", "order_accepted_to_preparation_hours", "order_preparation_hours", "order_collection_hours", "order_fulfilment_hours", "booking_response_hours", "booking_completion_hours"];
    const tracked = metric === "visits" || metric === "product_views" || metric === "item_cart_adds"
      ? snapshot.eventTrackingAvailable
      : lifecycleMetrics.includes(metric)
        ? snapshot.lifecycleTrackingAvailable
        : metric === "message_response_hours"
          ? snapshot.messagesAvailable
          : metric === "item_conversion"
            ? snapshot.eventTrackingAvailable && (selectedItem?.type === "service" ? snapshot.bookingAttributionAvailable : snapshot.orderAttributionAvailable)
            : metric !== "conversion" || (snapshot.eventTrackingAvailable && snapshot.orderAttributionAvailable);
    if (!tracked) {
      const lifecycleMetric = metric === "completed_orders" || metric === "cancelled_orders";
      host.innerHTML = '<div class="analytics-chart-empty"><strong>' + (lifecycleMetric ? "Not previously tracked" : "Not yet tracked") + '</strong><span>' + (lifecycleMetric ? "Order status transition times begin when lifecycle tracking is installed. StoreNest will not estimate historical completion or cancellation dates." : "Storefront sessions and order attribution will appear after tracking is connected. No historical visits are being estimated.") + '</span></div>';
      return;
    }
    const values = series.map(row => row.value).filter(value => value != null);
    if (!values.length) {
      const lifecycleDay = snapshot.lifecycleTrackingStartedAt ? engine.localDate(snapshot.lifecycleTrackingStartedAt) : null;
      const predatesLifecycle = lifecycleMetrics.includes(metric) && snapshot.lifecycleTrackingAvailable && lifecycleDay && snapshot.range.end <= lifecycleDay;
      host.innerHTML = '<div class="analytics-chart-empty"><strong>' + (predatesLifecycle ? "Not previously tracked" : lifecycleMetrics.includes(metric) ? "No recorded timings in this period" : "No recorded activity in this period") + '</strong><span>' + (predatesLifecycle ? "This date range ends before lifecycle tracking began. StoreNest does not estimate old transitions." : 'The chart will fill as StoreNest records more ' + escapeHtml(label.toLowerCase()) + ' activity.') + '</span></div>';
      return;
    }
    const width = 760;
    const height = 270;
    const left = metric === "conversion" ? 58 : 48;
    const right = 16;
    const top = 18;
    const bottom = 38;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxValue = Math.max(1, ...values);
    const step = maxValue / 4;
    const points = series.map((row, index) => ({
      x: series.length < 2 ? left + plotWidth / 2 : left + index * plotWidth / (series.length - 1),
      y: row.value == null ? null : top + plotHeight - row.value / maxValue * plotHeight,
      row
    }));
    let path = "";
    let open = false;
    for (const point of points) {
      if (point.y == null) { open = false; continue; }
      path += (open ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1) + " ";
      open = true;
    }
    const axisLabel = value => metric === "conversion" || metric === "item_conversion" ? value.toFixed(0) + "%" : metric.endsWith("_hours") ? value.toFixed(1) + "h" : number(value);
    let svg = '<svg class="analytics-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(label) + ' over ' + escapeHtml(snapshot.range.label) + '"><title>' + escapeHtml(label) + ' over ' + escapeHtml(snapshot.range.label) + '</title>';
    for (let index = 0; index <= 4; index++) {
      const y = top + plotHeight * index / 4;
      const value = maxValue * (4 - index) / 4;
      svg += '<line class="analytics-gridline" x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '"></line><text class="analytics-axis-label" x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + axisLabel(value) + '</text>';
    }
    if (path.trim()) svg += '<path class="analytics-chart-line" d="' + path.trim() + '"></path>';
    points.forEach(point => {
      if (point.y == null) return;
      const suffix = metric === "visits" ? " sessions" : metric === "orders" || metric === "completed_orders" || metric === "cancelled_orders" ? " orders" : metric === "product_views" ? " item views" : metric === "bookings" || metric === "item_booking_requests" ? " booking requests" : metric === "item_cart_adds" ? " cart adds" : metric === "item_purchases" ? " units" : metric.endsWith("_hours") ? " hours" : metric === "item_conversion" ? "%" : "";
      const title = dateLabel(point.row.start) + " — " + yValue(point.row.value, metric) + suffix;
      svg += '<circle class="analytics-chart-point" cx="' + point.x + '" cy="' + point.y + '" r="4"><title>' + escapeHtml(title) + '</title></circle>';
    });
    const labelIndexes = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
    points.forEach((point, index) => {
      if (!labelIndexes.has(index)) return;
      const labelText = snapshot.period === "today" ? "Today" : new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" }).format(point.row.start);
      svg += '<text class="analytics-axis-label analytics-date-label" x="' + point.x + '" y="' + (height - 9) + '" text-anchor="middle">' + escapeHtml(labelText) + '</text>';
    });
    svg += '</svg>';
    host.innerHTML = svg;
  }

  function selectedItemType(snapshot, id) {
    return snapshot.itemPerformance.find(item => item.id === String(id))?.type || "";
  }

  function trackedCount(value) {
    return value == null ? "Not tracked" : number(value);
  }

  function tableEmpty(message, colspan) {
    return '<tr><td colspan="' + colspan + '" class="analytics-table-empty">' + escapeHtml(message) + '</td></tr>';
  }

  function itemVariantsText(item) {
    const raw = item?.raw || {};
    const groups = Array.isArray(raw.customization_options) ? raw.customization_options : [];
    const groupLabels = groups.map(group => {
      const options = Array.isArray(group?.options) ? group.options : [];
      const names = options.map(option => String(option?.name || "").trim()).filter(Boolean).slice(0, 6);
      return group?.name && names.length ? String(group.name) + ": " + names.join(", ") + (options.length > names.length ? " and more" : "") : "";
    }).filter(Boolean);
    for (const [key, label] of [["fashion_color_sets", "Colour sets"], ["decor_color_sets", "Options"]]) {
      if (Array.isArray(raw[key]) && raw[key].length) {
        const names = raw[key].map(row => String(row?.name || "").trim()).filter(Boolean).slice(0, 6);
        groupLabels.push(label + (names.length ? ": " + names.join(", ") : " (" + raw[key].length + ")"));
      }
    }
    return groupLabels.length ? groupLabels.join(" · ") : "No saved options or variants";
  }

  function renderProductDetail(snapshot) {
    const host = $("analyticsExploreDetail");
    if (!host) return;
    const categoryOptions = ['<option value="all">All categories</option>'].concat(snapshot.categories.map(row => '<option value="' + escapeHtml(row.id) + '" ' + (state.productFilters.category === String(row.id) ? "selected" : "") + '>' + escapeHtml(row.name) + '</option>')).join("");
    const query = state.productFilters.query.toLowerCase().trim();
    const rows = (snapshot.itemPerformance || []).filter(item => {
      if (query && !(item.name + " " + item.category + " " + item.type).toLowerCase().includes(query)) return false;
      if (state.productFilters.category !== "all" && item.categoryId !== state.productFilters.category) return false;
      if (state.productFilters.availability === "available" && !item.isAvailable) return false;
      if (state.productFilters.availability === "unavailable" && item.isAvailable) return false;
      return true;
    });
    const sorters = {
      views: (a, b) => (b.viewSessions || 0) - (a.viewSessions || 0),
      purchases: (a, b) => b.purchasedUnits - a.purchasedUnits,
      requests: (a, b) => b.bookingRequests - a.bookingRequests,
      conversion: (a, b) => (b.viewConversionRate || 0) - (a.viewConversionRate || 0),
      name: (a, b) => a.name.localeCompare(b.name)
    };
    rows.sort(sorters[state.productFilters.sort] || sorters.views);
    const body = rows.length ? rows.map(item => '<tr><td><button type="button" class="analytics-item-link" data-item-performance="' + escapeHtml(item.id) + '" data-item-type="' + escapeHtml(item.type) + '">' + escapeHtml(item.name) + '</button><small>' + (item.type === "service" ? "Service" : "Product") + '</small></td><td>' + escapeHtml(item.category) + '</td><td><span class="analytics-availability ' + (item.isAvailable ? "is-available" : "is-unavailable") + '">' + (item.isAvailable ? "Available now" : "Unavailable now") + '</span></td><td>' + escapeHtml(trackedCount(item.viewSessions)) + '</td><td>' + escapeHtml(trackedCount(item.cartAdds)) + '</td><td>' + escapeHtml(item.type === "service" ? number(item.bookingRequests) + " requests" : number(item.purchasedUnits) + " units") + '</td><td>' + escapeHtml(item.viewConversionRate == null ? (item.conversionAvailable ? "—" : "Not tracked") : item.viewConversionRate.toFixed(1) + "%") + '</td></tr>').join("") : tableEmpty(snapshot.items.length ? "No catalogue items match these filters." : "No products or services are listed for this business yet.", 7);
    const selected = snapshot.itemPerformance.find(row => row.id === state.selectedItemId) || null;
    const selectedHtml = selected ? '<section class="analytics-selected-item"><div><span class="analytics-kicker">ITEM PERFORMANCE</span><h5>' + escapeHtml(selected.name) + '</h5><p>' + escapeHtml(selected.type === "service" ? "Booking requests are enquiries; they are not counted as completed product purchases." : "Completed units are counted from completed, non-refunded orders.") + '</p></div><button type="button" class="analytics-back-button" data-clear-item>Close</button><dl><div><dt>Unique view sessions</dt><dd>' + escapeHtml(trackedCount(selected.viewSessions)) + '</dd></div><div><dt>' + (selected.type === "service" ? "Booking requests" : "Completed units") + '</dt><dd>' + escapeHtml(number(selected.type === "service" ? selected.bookingRequests : selected.purchasedUnits)) + '</dd></div><div><dt>Current availability</dt><dd>' + (selected.isAvailable ? "Available" : "Unavailable") + '</dd></div><div><dt>Category and type</dt><dd>' + escapeHtml(selected.category + " · " + (selected.type === "service" ? "Service" : "Product")) + '</dd></div><div><dt>Options or variants</dt><dd>' + escapeHtml(itemVariantsText(selected)) + '</dd></div>' + (selected.type === "service" ? '<div><dt>Request outcomes</dt><dd>' + escapeHtml("Pending " + selected.bookingOutcomes.pending + " · Accepted " + selected.bookingOutcomes.accepted + " · Declined " + selected.bookingOutcomes.declined + " · Completed " + selected.bookingOutcomes.completed) + '</dd></div>' : '') + '</dl><p class="analytics-detail-note">Availability is the current catalogue setting. StoreNest has not stored its past changes, so this page cannot say whether earlier views happened while an item was unavailable.</p></section>' : '';
    host.innerHTML = '<div class="analytics-explore-heading"><div><span class="analytics-kicker">EXPLORE · PRODUCTS & SERVICES</span><h5>Which items attract interest and lead to orders or requests?</h5><p>Compare item views, cart activity, completed product units and service enquiries. Booking requests are kept separate from purchases.</p></div><label><span class="sr-only">Search products and services</span><input id="analyticsProductSearch" type="search" value="' + escapeHtml(state.productFilters.query) + '" placeholder="Search items"></label></div><div class="analytics-filter-row"><label><span>Category</span><select id="analyticsProductCategory">' + categoryOptions + '</select></label><label><span>Availability</span><select id="analyticsProductAvailability"><option value="all">All</option><option value="available" ' + (state.productFilters.availability === "available" ? "selected" : "") + '>Available</option><option value="unavailable" ' + (state.productFilters.availability === "unavailable" ? "selected" : "") + '>Unavailable</option></select></label><label><span>Sort by</span><select id="analyticsProductSort"><option value="views" ' + (state.productFilters.sort === "views" ? "selected" : "") + '>Most viewed</option><option value="purchases" ' + (state.productFilters.sort === "purchases" ? "selected" : "") + '>Most purchased</option><option value="requests" ' + (state.productFilters.sort === "requests" ? "selected" : "") + '>Most requested</option><option value="conversion" ' + (state.productFilters.sort === "conversion" ? "selected" : "") + '>View conversion</option><option value="name" ' + (state.productFilters.sort === "name" ? "selected" : "") + '>Name</option></select></label></div><div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>Item</th><th>Category</th><th>Availability</th><th>Unique views</th><th>Cart adds</th><th>Purchases / requests</th><th>View conversion</th></tr></thead><tbody>' + body + '</tbody></table></div>' + selectedHtml + '<p class="analytics-detail-note">A view-to-order or view-to-request rate is shown only when the same visitor session can be reliably linked. An em dash means there were no view sessions to calculate from.</p>';
  }

  function statusTitle(status) {
    return ({ new: "Placed", accepted: "Accepted", preparing: "Being prepared", prepared: "Prepared", ready: "Ready for collection", completed: "Completed", cancelled: "Cancelled", pending: "Pending", declined: "Declined" })[status] || status;
  }

  function renderOrderDetail(snapshot) {
    const host = $("analyticsExploreDetail");
    if (!host) return;
    const statuses = ["new", "accepted", "preparing", "prepared", "ready", "completed", "cancelled"];
    const outcomes = statuses.map(status => '<div><dt>' + escapeHtml(statusTitle(status)) + '</dt><dd>' + number(snapshot.orderStatusCounts[status] || 0) + '</dd></div>').join("");
    const completion = snapshot.completionRate == null ? "—" : snapshot.completionRate.toFixed(1) + "%";
    const cancellation = snapshot.cancellationRate == null ? "—" : snapshot.cancellationRate.toFixed(1) + "%";
    const lifecycle = snapshot.lifecycleTrackingAvailable
      ? '<div class="analytics-stage-area"><h6>Order progression since tracking began</h6><div class="analytics-stage-row">' + ["new", "accepted", "preparing", "prepared", "ready", "completed", "cancelled"].map(status => '<div><span>' + escapeHtml(statusTitle(status)) + '</span><strong>' + number(snapshot.lifecycle.stageCounts[status] || 0) + '</strong></div>').join("") + '</div><small>Based on recorded status transitions from ' + escapeHtml(dateLabel(new Date(snapshot.lifecycleTrackingStartedAt))) + '. Older orders have no invented transition history. A cancelled order may have passed through more than one earlier stage.</small>' + (Object.keys(snapshot.lifecycle.cancellationsByPriorStatus).length ? '<p>Recorded cancellations by previous status: ' + Object.entries(snapshot.lifecycle.cancellationsByPriorStatus).map(([status, count]) => escapeHtml(statusTitle(status) + ' ' + count)).join(' · ') + '.</p>' : '') + '</div>'
      : '<div class="analytics-stage-area"><h6>Order progression</h6><p>Not previously tracked. Status history starts when lifecycle tracking is installed. Current order status counts above remain available.</p></div>';
    const patternParts = [snapshot.orderPatterns.weekday ? "Most active day: " + snapshot.orderPatterns.weekday.name + " (" + snapshot.orderPatterns.weekday.averagePerDay.toFixed(1) + " orders per observed day)" : "Day pattern: need more orders", snapshot.orderPatterns.hour ? "Busiest hour: " + snapshot.orderPatterns.hour.label + " (" + snapshot.orderPatterns.hour.orders + " orders)" : "Hour pattern: need more orders"];
    const breakdownRows = snapshot.orderBreakdown.items.slice(0, 6).map(row => '<tr><td>' + escapeHtml(row.name) + '</td><td>' + escapeHtml(row.category) + '</td><td>' + number(row.orders) + '</td><td>' + number(row.completedUnits) + '</td><td>' + number(row.cancelledOrders) + '</td></tr>').join("") || tableEmpty("No order items were recorded in this period.", 5);
    const categoryRows = snapshot.orderBreakdown.categories.slice(0, 5).map(row => '<tr><td>' + escapeHtml(row.category) + '</td><td>' + number(row.orders) + '</td><td>' + number(row.completedUnits) + '</td><td>' + number(row.cancelledOrders) + '</td></tr>').join("") || tableEmpty("No category-linked order items are available.", 4);
    host.innerHTML = '<div class="analytics-explore-heading"><div><span class="analytics-kicker">EXPLORE · ORDERS</span><h5>Where do orders progress, complete or drop off?</h5><p>Current statuses show where selected-period orders stand now. Completion and cancellation rates use all orders placed in the selected period.</p></div></div><div class="analytics-detail-stats"><div><span>Order completion rate</span><strong>' + escapeHtml(completion) + '</strong><small>' + number(snapshot.completedOrderCount) + ' completed of ' + number(snapshot.ordersPlaced) + ' placed</small></div><div><span>Cancellation rate</span><strong>' + escapeHtml(cancellation) + '</strong><small>' + number(snapshot.cancelledCount) + ' currently cancelled</small></div><div><span>Average order value</span><strong>' + escapeHtml(snapshot.averageOrderValue == null ? "—" : money(snapshot.averageOrderValue)) + '</strong><small>Completed, non-refunded orders</small></div><div><span>Peak ordering times</span><strong>' + escapeHtml(snapshot.orderPatterns.weekday?.name || "Not enough data") + '</strong><small>' + escapeHtml(patternParts[1]) + '</small></div></div><dl class="analytics-order-statuses">' + outcomes + '</dl>' + lifecycle + '<div class="analytics-order-breakdown"><div><h6>Outcomes by item</h6><div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>Item</th><th>Category</th><th>Orders</th><th>Completed units</th><th>Cancelled</th></tr></thead><tbody>' + breakdownRows + '</tbody></table></div></div><div><h6>Outcomes by category</h6><div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>Category</th><th>Orders</th><th>Completed units</th><th>Cancelled</th></tr></thead><tbody>' + categoryRows + '</tbody></table></div></div></div><p class="analytics-detail-note">The current order workflow supports placed, accepted, preparing, prepared, ready, completed and cancelled. There is no separate rejected status. Booking requests are reported separately in Operations.</p>';
  }

  function formatHours(value) {
    if (value == null) return "Not previously tracked";
    if (value < 1) return Math.round(value * 60) + " min";
    return value.toFixed(1) + " hours";
  }

  function renderOperationsDetail(snapshot) {
    const host = $("analyticsExploreDetail");
    if (!host) return;
    const bookingStatuses = ["pending", "accepted", "declined", "completed"].map(status => '<div><dt>' + escapeHtml(statusTitle(status)) + ' booking requests</dt><dd>' + number(snapshot.currentBookings.filter(row => row.status === status).length) + '</dd></div>').join("");
    const operationRows = snapshot.operations ? [
      ["New order to accepted", snapshot.operations.orderAcceptance.current],
      ["Accepted to preparation", snapshot.operations.acceptedToPreparation.current],
      ["Preparation duration", snapshot.operations.preparation.current],
      ["Ready to confirmed collection", snapshot.operations.collection.current],
      ["Order placed to completed", snapshot.operations.orderFulfilment.current],
      ["Booking response", snapshot.operations.bookingResponse.current],
      ["Accepted booking to completed", snapshot.operations.bookingCompletion.current]
    ].map(([label, sample]) => '<tr><td>' + escapeHtml(label) + '</td><td>' + escapeHtml(formatHours(sample.averageHours)) + '</td><td>' + (sample.medianHours == null ? "—" : escapeHtml(formatHours(sample.medianHours))) + '</td><td>' + number(sample.sampleSize) + '</td></tr>').join("") : tableEmpty("Not previously tracked. New transitions will be measured after lifecycle tracking is installed.", 4);
    const messageText = snapshot.messages.available
      ? '<div class="analytics-detail-stats"><div><span>Customer messages</span><strong>' + number(snapshot.messages.incomingMessages) + '</strong><small>Message text is not analyzed</small></div><div><span>Average business reply time</span><strong>' + escapeHtml(formatHours(snapshot.messages.averageResponseHours)) + '</strong><small>' + number(snapshot.messages.responseSampleSize) + ' measured replies</small></div><div><span>Identified conversations followed by an order</span><strong>' + (snapshot.messages.conversationsFollowedByOrder == null ? "—" : number(snapshot.messages.conversationsFollowedByOrder)) + '</strong><small>' + number(snapshot.messages.identifiedConversations) + ' identified conversations</small></div></div><p class="analytics-detail-note">Conversation-to-order counts match signed-in customer IDs and an order within seven days. This is an observed sequence, not proof that a message caused an order.</p>'
      : '<div class="analytics-stage-area"><h6>Customer message response</h6><p>Not tracked. Message timing is available only when the current owner can read the business conversation metadata.</p></div>';
    host.innerHTML = '<div class="analytics-explore-heading"><div><span class="analytics-kicker">EXPLORE · OPERATIONS</span><h5>How quickly does the business respond and fulfil?</h5><p>Response and fulfilment times use real status-change timestamps. Older transitions are never estimated from the latest record update.</p></div></div><div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>Measured step</th><th>Average time</th><th>Median time</th><th>Samples</th></tr></thead><tbody>' + operationRows + '</tbody></table></div><div class="analytics-stage-area"><h6>Booking request outcomes</h6><dl class="analytics-order-statuses">' + bookingStatuses + '</dl><p>Booking enquiries are not sales or confirmed payments.</p></div>' + messageText + '<p class="analytics-detail-note">' + (snapshot.lifecycleTrackingAvailable ? 'Lifecycle tracking started ' + escapeHtml(dateLabel(new Date(snapshot.lifecycleTrackingStartedAt))) + '.' : 'Lifecycle history is not yet installed for this deployment.') + ' Response times are shown only when both transition timestamps were recorded.</p>';
  }

  function renderCustomerContextDetail(snapshot) {
    const host = $("analyticsExploreDetail");
    if (!host) return;
    const completed = snapshot.currentOrders.filter(row => row.status === "completed" && row.payment_status !== "refunded");
    const identified = completed.filter(row => row.customer_user_id);
    const guests = completed.length - identified.length;
    const demandRows = (snapshot.customerItemDemand || []).slice(0, 8).map(row => '<tr><td>' + escapeHtml(row.name) + '</td><td>' + escapeHtml(row.category) + '</td><td>' + number(row.firstPurchaseOrders) + '</td><td>' + number(row.repeatPurchaseOrders) + '</td></tr>').join("") || tableEmpty("No identified-customer purchases were recorded in this period.", 4);
    host.innerHTML = '<div class="analytics-explore-heading"><div><span class="analytics-kicker">EXPLORE · CUSTOMER PERFORMANCE</span><h5>How does repeat customer activity connect to orders and product demand?</h5><p>This is a business-wide view only. Customer behaviour, preferences, journeys and retention detail remain in Customers.</p></div></div><div class="analytics-detail-stats"><div><span>Completed orders from identified customers</span><strong>' + number(identified.length) + '</strong><small>Signed-in customer accounts</small></div><div><span>Completed guest orders</span><strong>' + number(guests) + '</strong><small>Not treated as identified customers</small></div><div><span>Returning identified purchasers</span><strong>' + number(snapshot.customers.returningBuyers) + '</strong><small>' + (snapshot.customers.returningRate == null ? 'Needs 5 identified purchasers' : escapeHtml(snapshot.customers.returningRate.toFixed(1) + '% of identified purchasers')) + '</small></div><div><span>Orders placed</span><strong>' + number(snapshot.ordersPlaced) + '</strong><small>Includes later cancellations</small></div></div><div class="analytics-customer-demand"><h6>Items purchased by first-time or returning customers</h6><div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>Item</th><th>Category</th><th>First completed purchase</th><th>Repeat purchase</th></tr></thead><tbody>' + demandRows + '</tbody></table></div><p class="analytics-detail-note">Each identified customer’s first completed, non-refunded order is counted as a first purchase; later completed orders are repeat purchases. Guest orders are excluded. This connects purchasing patterns to product demand without duplicating customer behaviour detail.</p></div><p class="analytics-detail-note">Analytics links customer records to business performance using account IDs where available. Guest activity remains anonymous, and detailed customer analysis is in the Customers section.</p>';
  }

  function renderExploreDetail(snapshot) {
    const host = $("analyticsExploreDetail");
    if (!host) return;
    if (!state.activeView) { host.hidden = true; host.innerHTML = ""; return; }
    host.hidden = false;
    if (state.activeView === "products") renderProductDetail(snapshot);
    else if (state.activeView === "orders") renderOrderDetail(snapshot);
    else if (state.activeView === "operations") renderOperationsDetail(snapshot);
    else renderCustomerContextDetail(snapshot);
  }

  function iconForInsight(type) {
    return ({ traffic_change: "↗", order_volume_change: "▤", product_view_order_rate: "◇", service_view_booking_rate: "▧", cancellation_rate: "!", cancellation_stage_pattern: "!", cross_system_relationship: "⇄", returning_customer_decline: "↻", weekday_demand_pattern: "◷" })[type] || "✦";
  }

  function updateTrendHeading() {
    const settings = VIEW_TREND_SETTINGS[state.activeView];
    const title = $("analyticsTrendsTitle");
    const description = $("analyticsTrendsDescription");
    const back = $("analyticsBusinessBack");
    const selectedItem = state.activeView === "products" ? state.items.find(item => String(item.id) === state.selectedItemId) : null;
    if (title) title.textContent = selectedItem ? selectedItem.name + " Trends" : settings ? settings.title : "Performance Trends";
    if (description) description.textContent = selectedItem ? "Track views and order or booking activity for this item." : settings ? settings.description : "Track your store's key metrics over time.";
    if (back) back.hidden = !settings;
  }

  function setAnalyticsExploreMenuOpen(open, returnFocus) {
    const toggle = $("analyticsExploreToggle");
    const list = $("analyticsExploreList");
    if (!toggle || !list) return;
    toggle.setAttribute("aria-expanded", String(Boolean(open)));
    list.hidden = !open;
    if (returnFocus) toggle.focus();
  }

  function setAnalyticsView(view) {
    if (view && VIEW_TREND_SETTINGS[view]) {
      if (!state.activeView) state.defaultMetric = $("analyticsMetric")?.value || state.metric || "orders";
      if (view !== "products") state.selectedItemId = "";
      state.activeView = view;
      state.metric = VIEW_TREND_SETTINGS[view].metric;
    } else {
      state.activeView = "";
      state.selectedItemId = "";
      state.metric = state.defaultMetric || "orders";
    }
    const metricSelect = $("analyticsMetric");
    if (metricSelect) metricSelect.value = state.metric;
    updateTrendHeading();
    if (state.loaded) {
      const snapshot = currentSnapshot();
      renderSummary(snapshot, state.activeView);
      renderChart(snapshot);
      renderExploreDetail(snapshot);
    }
  }

  function observationKey(insight) {
    const start = insight?.observation?.start || insight?.observation_start || "";
    const end = insight?.observation?.end || insight?.observation_end || "";
    return String(insight?.key || insight?.insight_key || "") + ":" + start + ":" + end;
  }

  function historyStateFor(insight) {
    const key = observationKey(insight);
    return state.insightHistory.find(row => row.observation_key === key) || null;
  }

  async function persistInsightHistory(insights) {
    if (!state.historyAvailable || !root.StoreNestBusinessClient || !insights.length) return;
    state.persistingHistory = state.persistingHistory || new Map();
    for (const insight of insights) {
      const key = observationKey(insight);
      if (historyStateFor(insight) || state.persistingHistory.has(key)) continue;
      const businessId = state.businessId;
      const record = {
        business_id: businessId,
        observation_key: key,
        insight_key: insight.key,
        insight_type: insight.type,
        title: insight.title,
        explanation: insight.explanation,
        priority: insight.priority,
        status: "new",
        evidence_snapshot: insight.evidence,
        interpretation: insight.interpretation,
        recommendation: insight.recommendation,
        observation_start: insight.observation.start,
        observation_end: insight.observation.end,
        detected_at: insight.detectedAt,
        metric: insight.metric || null,
        item_id: insight.itemId || null,
        is_service: Boolean(insight.service)
      };
      try {
        const pending = root.StoreNestBusinessClient.from("business_analytics_insight_history")
          .upsert(record, { onConflict: "business_id,observation_key", ignoreDuplicates: true });
        state.persistingHistory.set(key, pending);
        const { error } = await pending;
        if (error) throw error;
        if (state.businessId === businessId) {
          state.insightHistory.unshift(record);
          state.insightHistory = state.insightHistory.slice(0, 100);
        }
      } catch (error) {
        if (state.businessId === businessId) state.historyAvailable = false;
        console.info("StoreNest Analytics could not save insight history:", error.message || error);
      } finally {
        if (state.persistingHistory.get(key)) state.persistingHistory.delete(key);
      }
    }
    if (state.historyOpen) renderInsightHistory();
  }

  function historyRowToInsight(row) {
    let evidence = row.evidence_snapshot || [];
    if (typeof evidence === "string") {
      try { evidence = JSON.parse(evidence); } catch (_) { evidence = []; }
    }
    return {
      key: row.insight_key,
      observationKey: row.observation_key,
      type: row.insight_type,
      title: row.title,
      priority: row.priority,
      status: row.status,
      explanation: row.explanation || "StoreNest recorded this finding for the selected period.",
      evidence: Array.isArray(evidence) ? evidence : [],
      interpretation: row.interpretation || "",
      recommendation: row.recommendation || "",
      observation: { start: row.observation_start, end: row.observation_end, period: "Historical" },
      detectedAt: row.detected_at,
      actedAt: row.acted_at,
      actionNote: row.action_note || "",
      metric: row.metric || "",
      itemId: row.item_id || "",
      service: Boolean(row.is_service)
    };
  }

  async function persistReadyFollowUps(snapshot) {
    if (!state.historyAvailable || !root.StoreNestBusinessClient || state.followUpSaving) return;
    state.followUpSaving = true;
    try {
      for (let index = 0; index < state.insightHistory.length; index++) {
        const row = state.insightHistory[index];
        if (row.status !== "action_taken" || !row.acted_at || row.follow_up_snapshot?.available) continue;
        const follow = engine.followUp(snapshot, historyRowToInsight(row), row.acted_at, new Date());
        if (follow.reason === "wait") continue;
        const { error } = await root.StoreNestBusinessClient.from("business_analytics_insight_history")
          .update({ follow_up_snapshot: follow, updated_at: new Date().toISOString() })
          .eq("business_id", state.businessId)
          .eq("observation_key", row.observation_key);
        if (error) {
          console.info("StoreNest Analytics follow-up could not be saved:", error.message || error);
          continue;
        }
        state.insightHistory[index] = { ...row, follow_up_snapshot: follow };
      }
    } finally {
      state.followUpSaving = false;
    }
  }

  function renderInsights(snapshot) {
    const host = $("smartInsightList");
    const historyToggle = $("analyticsHistoryToggle");
    if (host) host.hidden = state.historyOpen;
    if (historyToggle) historyToggle.textContent = state.historyOpen ? "Back to insights" : "History";
    const insights = engine.buildInsights(snapshot, {}, new Date());
    for (const insight of insights) {
      const saved = historyStateFor(insight) || state.insightStates[insight.key] || {};
      insight.status = saved.status || "new";
      insight.statusUpdatedAt = saved.updated_at || null;
      insight.actedAt = saved.acted_at || null;
      insight.actionNote = saved.action_note || "";
      insight.observationKey = observationKey(insight);
      if (insight.status === "dismissed" || insight.status === "resolved") insight.priorityScore -= 100;
      else if (insight.status === "action_taken") insight.priorityScore -= 14;
    }
    insights.sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));
    state.generatedInsights = insights;
    if (!host) return;
    const activeInsights = insights.filter(insight => insight.status !== "dismissed" && insight.status !== "resolved").slice(0, 3);
    if (!activeInsights.length) {
      host.innerHTML = '<div class="analytics-insights-empty"><strong>' + (insights.length ? "No active findings right now" : "No insights yet") + '</strong><span>' + (insights.length ? "Dismissed and resolved findings remain available in History." : "StoreNest will highlight useful patterns when connected activity provides enough evidence.") + '</span></div>';
      if (historyToggle) historyToggle.hidden = !state.insightHistory.length && !state.historyAvailable;
      persistInsightHistory(insights);
      return;
    }
    if (historyToggle) historyToggle.hidden = !state.insightHistory.length && !state.historyAvailable;
    host.innerHTML = activeInsights.map(insight => '<article class="analytics-insight-row"><span class="analytics-insight-icon" aria-hidden="true">' + iconForInsight(insight.type) + '</span><div class="analytics-insight-copy"><div class="analytics-insight-title">' + escapeHtml(insight.title) + '</div><p>' + escapeHtml(insight.explanation) + '</p><div class="analytics-insight-meta"><span class="analytics-status analytics-status-' + escapeHtml(insight.status) + '">' + escapeHtml(statusLabel(insight.status)) + '</span><span class="analytics-priority">' + escapeHtml(insight.priority) + ' priority</span></div></div><button type="button" class="analytics-explore-link" data-explore-insight="' + escapeHtml(insight.key) + '">Explore <span aria-hidden="true">→</span></button></article>').join("");
    persistInsightHistory(insights);
  }

  function renderInsightHistory() {
    const host = $("analyticsInsightHistory");
    const list = $("analyticsHistoryList");
    const count = $("analyticsHistoryCount");
    if (!host || !list) return;
    host.hidden = !state.historyOpen;
    const toggle = $("analyticsHistoryToggle");
    const insightList = $("smartInsightList");
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(state.historyOpen));
      toggle.textContent = state.historyOpen ? "Back to insights" : "History";
    }
    if (insightList) insightList.hidden = state.historyOpen;
    if (!state.historyOpen) return;
    if (!state.historyAvailable) {
      list.innerHTML = '<p class="analytics-history-empty">Insight history will be available after its StoreNest data update is installed.</p>';
      if (count) count.textContent = "";
      return;
    }
    const matching = state.historyStatus === "all" ? state.insightHistory : state.historyStatus === "active"
      ? state.insightHistory.filter(row => ["new", "viewed", "action_taken"].includes(row.status))
      : state.insightHistory.filter(row => row.status === state.historyStatus);
    if (count) count.textContent = matching.length + (matching.length === 1 ? " finding" : " findings");
    list.innerHTML = matching.length ? matching.map(row => '<article class="analytics-history-row"><button type="button" class="analytics-history-open" data-history-insight="' + escapeHtml(row.observation_key) + '"><span class="analytics-history-title">' + escapeHtml(row.title) + '</span><span class="analytics-history-meta">' + escapeHtml(statusLabel(row.status)) + ' · ' + escapeHtml(row.priority) + ' priority · ' + escapeHtml(dateLabel(new Date(row.detected_at))) + '</span></button><button type="button" class="analytics-history-status" data-history-status="' + escapeHtml(row.observation_key) + '" data-status-value="' + (row.status === "resolved" ? "new" : "resolved") + '" aria-label="' + (row.status === "resolved" ? "Reopen finding" : "Mark finding resolved") + '">' + (row.status === "resolved" ? "Reopen" : "Resolve") + '</button></article>').join("") : '<p class="analytics-history-empty">No findings match this filter.</p>';
  }

  function statusLabel(status) {
    return ({ new: "Active", viewed: "Viewed", action_taken: "Action taken", dismissed: "Dismissed", resolved: "Resolved" })[status] || "Active";
  }

  function relatedAnalysisTarget(insight) {
    const type = String(insight?.type || "");
    const metric = String(insight?.metric || "");
    if (insight?.itemId || metric === "product" || /product|service_view|availability_interest/.test(type)) {
      return { view: "products", metric: insight?.service ? "item_booking_requests" : "product_views", label: "Products & services" };
    }
    if (metric === "returning" || type === "returning_customer_decline") return { view: "customers", metric: "returning", label: "Customer performance" };
    if (metric === "operations" || metric.includes("hours") || metric === "message_response" || /operational|cancellation|message|unanswered/.test(type)) {
      const chartMetric = metric === "message_response" ? "message_response_hours" : metric.endsWith("_hours") ? metric : "order_fulfilment_hours";
      return { view: "operations", metric: chartMetric, label: "Operations" };
    }
    if (metric === "visits" || metric === "conversion" || metric === "orders" || /traffic|order_volume|conversion/.test(type)) {
      return { view: "orders", metric: metric === "visits" || metric === "conversion" ? metric : "orders", label: "Orders and traffic" };
    }
    return { view: "customers", metric: "returning", label: "Customer performance" };
  }

  async function saveInsightStatus(insight, nextStatus, actionNote) {
    if ((!state.statesAvailable && !state.historyAvailable) || !root.StoreNestBusinessClient) {
      setStatusMessage("Insight status could not be saved. Refresh and try again when StoreNest is connected.", true);
      return false;
    }
    const key = observationKey(insight);
    const pendingHistoryInsert = state.persistingHistory?.get(key);
    if (pendingHistoryInsert) await pendingHistoryInsert;
    const priorHistory = historyStateFor(insight);
    const existing = state.insightStates[insight.key] || {};
    const now = new Date().toISOString();
    const payload = {
      business_id: state.businessId,
      insight_key: insight.key,
      status: nextStatus,
      updated_at: now,
      acted_at: nextStatus === "action_taken" ? (priorHistory?.acted_at || existing.acted_at || now) : (priorHistory?.acted_at || existing.acted_at || null)
    };
    if (state.statesAvailable && nextStatus !== "resolved") {
      const { error } = await root.StoreNestBusinessClient.from("business_analytics_insight_states")
        .upsert(payload, { onConflict: "business_id,insight_key" });
      if (error) {
        console.error("Could not save StoreNest insight status:", error);
        if (!state.historyAvailable) { setStatusMessage("Insight status could not be saved. Please try again.", true); return false; }
      }
    }
    let historySaved = false;
    if (state.historyAvailable) {
      const historyPayload = {
        business_id: state.businessId,
        observation_key: key,
        insight_key: insight.key,
        insight_type: insight.type,
        title: insight.title,
        priority: insight.priority,
        status: nextStatus,
        updated_at: now,
        acted_at: nextStatus === "action_taken" ? (priorHistory?.acted_at || existing.acted_at || now) : (priorHistory?.acted_at || existing.acted_at || null),
        action_note: nextStatus === "action_taken" ? String(actionNote || "").slice(0, 1000) || null : (priorHistory?.action_note || null)
      };
      let historyQuery;
      if (priorHistory) {
        historyQuery = root.StoreNestBusinessClient.from("business_analytics_insight_history").update({
          status: historyPayload.status,
          updated_at: historyPayload.updated_at,
          acted_at: historyPayload.acted_at,
          action_note: historyPayload.action_note
        })
          .eq("business_id", state.businessId).eq("observation_key", key);
      } else {
        historyQuery = root.StoreNestBusinessClient.from("business_analytics_insight_history").insert({
          ...historyPayload,
          observation_key: key,
          insight_key: insight.key,
          insight_type: insight.type,
          title: insight.title,
          explanation: insight.explanation || "",
          priority: insight.priority,
          evidence_snapshot: insight.evidence || [],
          interpretation: insight.interpretation || "",
          recommendation: insight.recommendation || "",
          observation_start: insight.observation.start,
          observation_end: insight.observation.end,
          detected_at: insight.detectedAt,
          metric: insight.metric || null,
          item_id: insight.itemId || null,
          is_service: Boolean(insight.service)
        });
      }
      const { error } = await historyQuery;
      if (error) {
        console.error("Could not save StoreNest insight history status:", error);
        if (!state.statesAvailable) { setStatusMessage("Insight status could not be saved. Please try again.", true); return false; }
        state.historyAvailable = false;
      } else {
        const index = state.insightHistory.findIndex(row => row.observation_key === key);
        if (index >= 0) state.insightHistory[index] = { ...state.insightHistory[index], ...historyPayload };
        else state.insightHistory.unshift(historyPayload);
        historySaved = true;
      }
    }
    if (state.statesAvailable && nextStatus !== "resolved") state.insightStates[insight.key] = payload;
    if (!state.statesAvailable && !historySaved) return false;
    setStatusMessage("Insight marked as " + statusLabel(nextStatus).toLowerCase() + ".", false);
    return true;
  }

  function renderInsightDetail(snapshot) {
    const host = $("analyticsInsightDetail");
    const insight = state.activeHistoricalInsight || (state.generatedInsights || []).find(row => row.key === state.activeInsightKey);
    if (!host) return;
    if (!insight) { host.hidden = true; return; }
    host.hidden = false;
    const evidenceRows = Array.isArray(insight.evidence) ? insight.evidence : [];
    const evidence = evidenceRows.map(row => '<div><dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(row.value) + '</dd></div>').join("");
    const savedHistory = historyStateFor(insight);
    const actedAt = savedHistory?.acted_at || state.insightStates[insight.key]?.acted_at || insight.actedAt;
    const follow = insight.status === "action_taken" && actedAt ? engine.followUp(snapshot, insight, actedAt, new Date()) : null;
    let followHtml = "";
    if (follow?.available) {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up comparison</h4><p>' + escapeHtml(follow.message) + '</p><div class="analytics-follow-up"><span>Before: ' + escapeHtml(follow.beforeLabel || String(follow.before)) + '</span><span>After: ' + escapeHtml(follow.afterLabel || String(follow.after)) + '</span><strong>' + escapeHtml(follow.change?.label || "Not comparable") + '</strong></div></section>';
    } else if (follow?.reason === "wait") {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up</h4><p>StoreNest will compare the next seven full days with the seven full days before this action after the measurement period ends. A later change is a comparison, not proof of cause.</p></section>';
    } else if (follow?.reason === "insufficient") {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up</h4><p>StoreNest needs at least 10 tracked ' + (insight.service ? "service-view" : "product-view") + ' sessions in both seven-day periods before it can compare this item’s view-to-' + (insight.service ? "booking" : "order") + ' rate. Before: ' + number(follow.beforeVisits) + ' sessions. After: ' + number(follow.afterVisits) + ' sessions.</p></section>';
    } else if (insight.status === "action_taken") {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up</h4><p>' + escapeHtml(savedHistory?.follow_up_snapshot?.message || "StoreNest will show a comparison when this type of measurement is available in comparable periods.") + '</p></section>';
    }
    const start = insight.observation?.start || insight.observation_start || "";
    const end = insight.observation?.end || insight.observation_end || "";
    const detected = insight.detectedAt || insight.detected_at;
    const note = savedHistory?.action_note || insight.actionNote || "";
    const related = relatedAnalysisTarget(insight);
    host.innerHTML = '<div class="analytics-detail-heading"><div><span class="analytics-kicker">SMART INSIGHT · ' + escapeHtml(insight.priority) + ' priority</span><h3>' + escapeHtml(insight.title) + '</h3><p>' + escapeHtml(insight.explanation || "") + '</p></div><button type="button" class="analytics-back-button" data-close-insight>← Back to insights</button></div><div class="analytics-detail-grid"><section class="analytics-detail-block"><h4>Supporting evidence</h4><dl class="analytics-evidence-list">' + evidence + '</dl><small>Observed ' + escapeHtml(detected ? dateLabel(new Date(detected)) : "date unavailable") + ' · Period ' + escapeHtml(start) + ' to ' + escapeHtml(end) + '</small></section><section class="analytics-detail-block"><h4>What it could mean</h4><p>' + escapeHtml(insight.interpretation || "") + '</p></section><section class="analytics-detail-block"><h4>Suggested action</h4><p>' + escapeHtml(insight.recommendation || "") + '</p></section><section class="analytics-detail-block analytics-related-analysis"><h4>Related analysis</h4><button type="button" class="analytics-related-link" data-insight-related-view="' + escapeHtml(related.view) + '" data-insight-related-metric="' + escapeHtml(related.metric) + '" data-insight-item="' + escapeHtml(insight.itemId || "") + '">Open ' + escapeHtml(related.label) + ' analysis <span aria-hidden="true">→</span></button></section>' + followHtml + (note ? '<section class="analytics-detail-block"><h4>Action recorded</h4><p>' + escapeHtml(note) + '</p></section>' : '') + '</div><div class="analytics-insight-actions"><span class="analytics-status analytics-status-' + escapeHtml(insight.status) + '">' + escapeHtml(statusLabel(insight.status)) + '</span><label class="analytics-action-note-label"><span>Action note <small>(optional)</small></span><textarea id="analyticsActionNote" maxlength="1000" placeholder="What did you change?">' + escapeHtml(note) + '</textarea></label><button type="button" class="outline-button" data-insight-status="viewed">Mark viewed</button><button type="button" class="primary-button" data-insight-status="action_taken">I took action</button><button type="button" class="outline-button" data-insight-status="dismissed">Dismiss</button><button type="button" class="outline-button" data-insight-status="resolved">Resolve</button></div>';
  }

  function render(snapshot) {
    const content = $("analyticsContent");
    if (content) content.hidden = false;
    const range = snapshot.range;
    const rangeLabel = $("analyticsRangeLabel");
    if (rangeLabel && range) rangeLabel.textContent = dateLabel(range.start) + " – " + dateLabel(engine.addDays(range.end, -1));
    renderSummary(snapshot, state.activeView);
    renderChart(snapshot);
    renderExploreDetail(snapshot);
    renderInsights(snapshot);
    updateTrendHeading();
    renderInsightDetail(snapshot);
    renderInsightHistory();
    persistReadyFollowUps(snapshot);
  }

  function onBusinessReady(event) {
    const detail = event && event.detail || {};
    const id = String(detail.businessId || "");
    if (!id) {
      state.businessId = "";
      state.loaded = false;
      return;
    }
    const changed = state.businessId !== id;
    state.businessId = id;
    state.businessName = String(detail.businessName || "");
    if (changed) {
      state.request++;
      state.loading = false;
      state.loaded = false;
      state.activeInsightKey = "";
      state.activeHistoricalInsight = null;
      state.activeView = "";
        state.selectedItemId = "";
        state.productFilters = { query: "", category: "all", availability: "all", sort: "views" };
        state.historyStatus = "all";
        state.insightStates = {};
        state.statesAvailable = false;
        state.historyAvailable = false;
      state.metric = "orders";
      state.defaultMetric = "orders";
      if ($("analyticsMetric")) $("analyticsMetric").value = "orders";
      updateTrendHeading();
      state.insightsExpanded = false;
      state.historyOpen = false;
      state.insightHistory = [];
      state.persistingHistory = new Map();
      state.lifecycleEvents = [];
      state.lifecycleAvailable = false;
      state.conversations = [];
      state.messages = [];
      const section = root.document.querySelector('[data-section-view="analytics"]');
      if (section && !section.hidden) loadData(true);
    } else if (!state.loaded) openAnalytics();
  }

  function openAnalytics() {
    const section = root.document.querySelector('[data-section-view="analytics"]');
    if (!section || section.hidden) return;
    if (state.businessId && !state.loading && !state.loaded) loadData(true);
    if (state.loaded) render(currentSnapshot());
  }

  function init() {
    const section = $("analyticsDashboard");
    if (!section || section.dataset.initialized === "true") return;
    section.dataset.initialized = "true";
    const today = engine.localDate(new Date());
    if ($("analyticsCustomStart") && !$("analyticsCustomStart").value) $("analyticsCustomStart").value = engine.dayKey(engine.addDays(today, -29));
    if ($("analyticsCustomEnd") && !$("analyticsCustomEnd").value) $("analyticsCustomEnd").value = engine.dayKey(today);

    $("analyticsDateRange")?.addEventListener("change", () => {
      state.period = periodSelection();
      const customFields = $("analyticsCustomRange");
      if (customFields) customFields.hidden = state.period !== "custom";
      if (state.businessId) { state.loaded = false; loadData(true); }
    });
    [$("analyticsCustomStart"), $("analyticsCustomEnd")].filter(Boolean).forEach(input => input.addEventListener("change", () => {
      if (state.businessId) { state.loaded = false; loadData(true); }
    }));
    $("analyticsMetric")?.addEventListener("change", () => {
      state.metric = $("analyticsMetric").value;
      if (!state.activeView) state.defaultMetric = state.metric;
      if (state.loaded) renderChart(currentSnapshot());
    });
    $("analyticsHistoryToggle")?.addEventListener("click", () => { state.historyOpen = !state.historyOpen; renderInsightHistory(); });
    $("analyticsHistoryStatus")?.addEventListener("change", event => { state.historyStatus = event.target.value; renderInsightHistory(); });
    $("analyticsRetry")?.addEventListener("click", () => { state.loaded = false; loadData(true); });
    $("analyticsRefresh")?.addEventListener("click", () => { state.loaded = false; loadData(true); });
    $("analyticsDashboard")?.addEventListener("click", event => {
      const itemButton = event.target.closest("[data-item-performance]");
      if (itemButton) {
        state.selectedItemId = itemButton.dataset.itemPerformance;
        if (state.activeView === "products" && ["item_purchases", "item_booking_requests", "item_cart_adds", "item_conversion"].includes(state.metric) && itemButton.dataset.itemType) {
          state.metric = itemButton.dataset.itemType === "service" ? "item_booking_requests" : "product_views";
        }
        if ($("analyticsMetric")) $("analyticsMetric").value = state.metric;
        updateTrendHeading();
        renderChart(currentSnapshot());
        renderExploreDetail(currentSnapshot());
        return;
      }
      if (event.target.closest("[data-clear-item]")) {
        state.selectedItemId = "";
        if (["item_purchases", "item_booking_requests", "item_cart_adds", "item_conversion"].includes(state.metric)) state.metric = "product_views";
        if ($("analyticsMetric")) $("analyticsMetric").value = state.metric;
        updateTrendHeading();
        renderChart(currentSnapshot());
        renderExploreDetail(currentSnapshot());
        return;
      }
      const historyStatusButton = event.target.closest("[data-history-status]");
      if (historyStatusButton) {
        const row = state.insightHistory.find(item => item.observation_key === historyStatusButton.dataset.historyStatus);
        if (!row) return;
        const insight = historyRowToInsight(row);
        saveInsightStatus(insight, historyStatusButton.dataset.statusValue).then(saved => { if (saved) { renderInsightHistory(); renderInsights(currentSnapshot()); } });
        return;
      }
      const historyButton = event.target.closest("[data-history-insight]");
      if (historyButton) {
        const row = state.insightHistory.find(item => item.observation_key === historyButton.dataset.historyInsight);
        if (!row) return;
        state.activeHistoricalInsight = historyRowToInsight(row);
        state.activeInsightKey = row.insight_key;
        if (row.status === "new") saveInsightStatus(state.activeHistoricalInsight, "viewed").then(() => { state.activeHistoricalInsight = historyRowToInsight(state.insightHistory.find(item => item.observation_key === row.observation_key) || row); if (state.loaded) render(currentSnapshot()); });
        if (state.loaded) render(currentSnapshot());
        return;
      }
      const toggle = event.target.closest("#analyticsExploreToggle");
      if (toggle) {
        setAnalyticsExploreMenuOpen(toggle.getAttribute("aria-expanded") !== "true");
        return;
      }
      const option = event.target.closest("[data-analytics-view]");
      if (option) {
        event.preventDefault();
        const selectedView = option.dataset.analyticsView;
        setAnalyticsExploreMenuOpen(false, true);
        setAnalyticsView(state.activeView === selectedView ? "" : selectedView);
      }
    });
    root.document.addEventListener("click", event => {
      if (!event.target.closest("#analyticsExploreMenu")) setAnalyticsExploreMenuOpen(false);
    });
    root.document.addEventListener("keydown", event => {
      if (event.key === "Escape" && $("analyticsExploreToggle")?.getAttribute("aria-expanded") === "true") {
        setAnalyticsExploreMenuOpen(false, true);
      }
    });
    $("analyticsBusinessBack")?.addEventListener("click", event => { event.preventDefault(); setAnalyticsView(""); });
    $("analyticsInsightDetail")?.addEventListener("click", async event => {
      const related = event.target.closest("[data-insight-related-view]");
      if (related) {
        const view = related.dataset.insightRelatedView;
        const metric = related.dataset.insightRelatedMetric;
        state.activeInsightKey = "";
        state.activeHistoricalInsight = null;
        setAnalyticsView(view);
        if (related.dataset.insightItem) state.selectedItemId = related.dataset.insightItem;
        if (metric && $("analyticsMetric")?.querySelector('option[value="' + metric + '"]')) {
          state.metric = metric;
          $("analyticsMetric").value = metric;
        }
        if (state.loaded) {
          renderChart(currentSnapshot());
          renderExploreDetail(currentSnapshot());
          renderInsightDetail(currentSnapshot());
        }
        return;
      }
      if (event.target.closest("[data-close-insight]")) {
        state.activeInsightKey = "";
        state.activeHistoricalInsight = null;
        if (state.loaded) renderInsightDetail(currentSnapshot());
        return;
      }
      const action = event.target.closest("[data-insight-status]");
      if (!action) return;
      const insight = state.activeHistoricalInsight || (state.generatedInsights || []).find(row => row.key === state.activeInsightKey);
      if (!insight) return;
      const saved = await saveInsightStatus(insight, action.dataset.insightStatus, $("analyticsActionNote")?.value || "");
      if (saved && state.loaded) render(currentSnapshot());
    });
    $("smartInsightList")?.addEventListener("click", async event => {
      const button = event.target.closest("[data-explore-insight]");
      if (!button) return;
      state.activeInsightKey = button.dataset.exploreInsight;
      state.activeHistoricalInsight = null;
      const insight = (state.generatedInsights || []).find(row => row.key === state.activeInsightKey);
      if (insight && insight.status === "new") await saveInsightStatus(insight, "viewed");
      if (state.loaded) render(currentSnapshot());
    });
    $("analyticsExploreDetail")?.addEventListener("change", event => {
      const control = event.target;
      if (control.id === "analyticsProductSearch") state.productFilters.query = control.value;
      if (control.id === "analyticsProductCategory") state.productFilters.category = control.value;
      if (control.id === "analyticsProductAvailability") state.productFilters.availability = control.value;
      if (control.id === "analyticsProductSort") state.productFilters.sort = control.value;
      if (state.loaded) renderExploreDetail(currentSnapshot());
    });
    root.document.addEventListener("click", event => {
      const nav = event.target.closest('.side-link[data-section="analytics"]');
      if (nav) setTimeout(openAnalytics, 0);
    });
    root.addEventListener("storenest:owner-business-ready", onBusinessReady);
    const select = $("businessSelect");
    if (select && select.value) {
      const selected = select.options[select.selectedIndex];
      state.businessId = select.value;
      state.businessName = selected ? selected.textContent : "";
    }
    const currentBusiness = $("businessSelect")?.value;
    if (currentBusiness && !state.businessId) state.businessId = currentBusiness;
    if (state.businessId) openAnalytics();
  }

  root.StoreNestAnalyticsDashboard = Object.freeze({ init, load: loadData, getState: () => ({ ...state }) });
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
