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
    bookings: [],
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
      let insightStates = {};
      try {
        insightStates = await fetchInsightStates(client, state.businessId);
      } catch (error) {
        statesAvailable = false;
        console.warn("StoreNest Analytics could not load saved insight states:", error.message || error);
      }
      const from = minQueryDate(range, insightStates);
      const customerHistoryPromise = fetchRows(client, "storefront_orders", "id,business_id,customer_user_id,created_at,status,payment_status", state.businessId, "created_at", null);
      const itemPromise = fetchRows(client, "business_items", "id,business_id,name,item_type,price,is_available,view_count,created_at", state.businessId, "created_at", null);
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
      const [customerHistory, items, orderResult, eventResult, bookingResult] = await Promise.all([
        customerHistoryPromise, itemPromise, orderPromise, eventPromise, bookingPromise
      ]);
      if (request !== state.request) return;
      state.orders = orderResult.rows;
      state.customerHistory = customerHistory;
      state.items = items;
      state.events = eventResult.rows;
      state.eventsAvailable = eventResult.available;
      state.orderAttributionAvailable = orderResult.attribution;
      state.bookings = bookingResult.rows;
      state.bookingAttributionAvailable = bookingResult.attribution;
      state.insightStates = insightStates;
      state.statesAvailable = statesAvailable;
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

  function renderSummary(snapshot) {
    const list = $("analyticsSummary");
    if (!list) return;
    const conversion = snapshot.conversion.value;
    const returning = snapshot.customers.returningRate;
    const metrics = [
      { label: "Store Visits", value: snapshot.visits == null ? "Not yet tracked" : number(snapshot.visits), change: metricChange(snapshot.visits, snapshot.previousVisits, "count"), hint: snapshot.eventsAvailable ? "Unique storefront sessions" : "Visit tracking is not connected yet" },
      { label: "Orders", value: number(snapshot.ordersPlaced), change: metricChange(snapshot.ordersPlaced, snapshot.previousOrdersPlaced, "count"), hint: "Orders placed, including later cancellations" },
      { label: "Conversion", value: conversion == null ? "—" : conversion.toFixed(1) + "%", change: metricChange(conversion, snapshot.previousConversion.value, "rate"), hint: snapshot.conversion.reason === "untracked" || !snapshot.orderAttributionAvailable ? "Not yet tracked" : snapshot.conversion.reason === "insufficient" ? "Needs 10 tracked sessions" : "Tracked sessions that submitted an order" },
      { label: "Returning", value: returning == null ? "—" : returning.toFixed(1) + "%", change: metricChange(returning, snapshot.previousCustomers.returningRate, "rate"), hint: snapshot.customers.identifiedBuyers < 5 ? "Needs 5 identified purchasers" : "Identified purchasers with an earlier completed order" }
    ];
    list.innerHTML = metrics.map(metric => '<article class="analytics-summary-item"><span>' + escapeHtml(metric.label) + '</span><strong>' + escapeHtml(metric.value) + '</strong><small class="analytics-delta ' + metric.change.tone + '">' + escapeHtml(metric.change.label) + '</small><em>' + escapeHtml(metric.hint) + '</em></article>').join("");
  }

  function yValue(value, metric) {
    if (value == null) return "—";
    return metric === "conversion" ? Number(value).toFixed(1) + "%" : number(value);
  }

  function renderChart(snapshot) {
    const host = $("analyticsChart");
    if (!host) return;
    const metric = $("analyticsMetric")?.value || state.metric;
    state.metric = metric;
    const series = engine.buildSeries(snapshot, metric);
    const label = ({ orders: "Orders", visits: "Store visits", conversion: "Conversion", returning: "Returning customers" })[metric] || "Orders";
    const tracked = metric === "visits" ? snapshot.eventsAvailable : metric !== "conversion" || (snapshot.eventsAvailable && snapshot.orderAttributionAvailable);
    if (!tracked) {
      host.innerHTML = '<div class="analytics-chart-empty"><strong>Not yet tracked</strong><span>Storefront sessions and order attribution will appear after tracking is connected. No historical visits are being estimated.</span></div>';
      return;
    }
    const values = series.map(row => row.value).filter(value => value != null);
    if (!values.length) {
      host.innerHTML = '<div class="analytics-chart-empty"><strong>No recorded activity in this period</strong><span>The chart will fill as StoreNest records more ' + escapeHtml(label.toLowerCase()) + ' activity.</span></div>';
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
    const axisLabel = value => metric === "conversion" ? value.toFixed(0) + "%" : number(value);
    let svg = '<svg class="analytics-chart-svg" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(label) + ' over ' + escapeHtml(snapshot.range.label) + '"><title>' + escapeHtml(label) + ' over ' + escapeHtml(snapshot.range.label) + '</title>';
    for (let index = 0; index <= 4; index++) {
      const y = top + plotHeight * index / 4;
      const value = maxValue * (4 - index) / 4;
      svg += '<line class="analytics-gridline" x1="' + left + '" y1="' + y + '" x2="' + (width - right) + '" y2="' + y + '"></line><text class="analytics-axis-label" x="' + (left - 8) + '" y="' + (y + 4) + '" text-anchor="end">' + axisLabel(value) + '</text>';
    }
    if (path.trim()) svg += '<path class="analytics-chart-line" d="' + path.trim() + '"></path>';
    points.forEach(point => {
      if (point.y == null) return;
      const title = dateLabel(point.row.start) + " — " + yValue(point.row.value, metric) + (metric === "visits" ? " sessions" : metric === "orders" ? " orders" : "");
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

  function iconForInsight(type) {
    return ({ traffic_change: "↗", order_volume_change: "▤", product_view_order_rate: "◇", service_view_booking_rate: "▧", cancellation_rate: "!", returning_customer_decline: "↻", weekday_demand_pattern: "◷" })[type] || "✦";
  }

  function renderInsights(snapshot) {
    const host = $("smartInsightList");
    const viewAll = $("analyticsViewAllInsights");
    const insights = engine.buildInsights(snapshot, state.insightStates, new Date());
    state.generatedInsights = insights;
    if (!host) return;
    if (!insights.length) {
      host.innerHTML = '<div class="analytics-insights-empty"><strong>No insights yet</strong><span>StoreNest will highlight useful patterns as your business activity grows.</span></div>';
      if (viewAll) viewAll.hidden = true;
      return;
    }
    const displayed = state.insightsExpanded ? insights : insights.slice(0, 3);
    if (viewAll) {
      viewAll.hidden = insights.length <= 3;
      viewAll.textContent = state.insightsExpanded ? "Show less" : "View all";
      viewAll.setAttribute("aria-expanded", String(state.insightsExpanded));
    }
    host.innerHTML = displayed.map(insight => '<article class="analytics-insight-row"><span class="analytics-insight-icon" aria-hidden="true">' + iconForInsight(insight.type) + '</span><div class="analytics-insight-copy"><div class="analytics-insight-title">' + escapeHtml(insight.title) + '</div><p>' + escapeHtml(insight.explanation) + '</p><div class="analytics-insight-meta"><span class="analytics-status analytics-status-' + escapeHtml(insight.status) + '">' + escapeHtml(statusLabel(insight.status)) + '</span><span class="analytics-priority">' + escapeHtml(insight.priority) + ' priority</span></div></div><button type="button" class="analytics-explore-link" data-explore-insight="' + escapeHtml(insight.key) + '">Explore <span aria-hidden="true">→</span></button></article>').join("");
  }

  function statusLabel(status) {
    return ({ new: "New", viewed: "Viewed", action_taken: "Action taken", dismissed: "Dismissed" })[status] || "New";
  }

  function renderExplore(snapshot) {
    const detail = $("analyticsBusinessDetail");
    const cards = $("analyticsExploreCards");
    const title = $("analyticsBusinessDetailTitle");
    const body = $("analyticsBusinessDetailBody");
    const back = $("analyticsBusinessBack");
    if (!detail || !cards || !body) return;
    if (!state.activeView) {
      detail.hidden = true;
      cards.hidden = false;
      return;
    }
    detail.hidden = false;
    cards.hidden = true;
    const names = { customers: "Customers", products: "Products", orders: "Orders", operations: "Operations" };
    if (title) title.textContent = names[state.activeView] + " analytics";
    if (back) back.hidden = false;
    body.innerHTML = renderBusinessView(snapshot, state.activeView);
  }

  function statCard(label, value, note) {
    return '<article class="analytics-detail-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong>' + (note ? '<small>' + escapeHtml(note) + '</small>' : '') + '</article>';
  }

  function renderBusinessView(snapshot, view) {
    const periodLabel = escapeHtml(snapshot.range.label);
    if (view === "customers") {
      const buyers = snapshot.customers;
      const rate = buyers.returningRate == null ? "—" : buyers.returningRate.toFixed(1) + "%";
      return '<div class="analytics-detail-stats">' + statCard("Identified purchasers", number(buyers.identifiedBuyers), "Completed, non-refunded orders") + statCard("New purchasers", number(buyers.newBuyers), "No earlier completed order found") + statCard("Returning purchasers", number(buyers.returningBuyers), "Customer accounts with earlier purchases") + statCard("Returning share", rate, buyers.identifiedBuyers < 5 ? "Needs 5 identified purchasers" : "Among identified purchasers") + '</div><p class="analytics-detail-note">Guest checkouts without a linked customer account are excluded from customer retention calculations. Customer names and contact details are not shown in Analytics.</p><div class="analytics-mini-chart">' + renderCustomerDays(snapshot) + '</div>';
    }
    if (view === "products") {
      const rows = snapshot.items.map(item => {
        const id = String(item.id || "");
        const isService = String(item.item_type || "").toLowerCase() === "service";
        const viewers = snapshot.productViews.get(id);
        const views = viewers ? viewers.size : 0;
        const purchases = isService ? (snapshot.serviceBookingRequests.get(id) || 0) : (snapshot.productPurchases.get(id) || 0);
        const sameSession = (isService ? snapshot.serviceBookingSessions : snapshot.productOrderSessions).get(id) || new Set();
        const converted = viewers ? [...sameSession].filter(session => viewers.has(session)).length : 0;
        const attributionAvailable = isService ? snapshot.bookingAttributionAvailable : snapshot.orderAttributionAvailable;
        const rate = !attributionAvailable ? "Not tracked" : viewers && viewers.size >= 10 ? (converted / viewers.size * 100).toFixed(1) + "%" : "—";
        return { item, views, purchases, rate, isService };
      }).sort((a, b) => b.purchases - a.purchases || b.views - a.views || String(a.item.name).localeCompare(String(b.item.name)));
      const tracking = !snapshot.eventsAvailable
        ? "Storefront and item views are unique sessions, but tracking starts now; no earlier views are estimated."
        : rows.some(row => row.isService) && !snapshot.bookingAttributionAvailable
          ? "Product views are tracked. Same-session booking attribution for services is not connected yet."
          : "Views are unique sessions. Product demand uses completed units and same-session orders; service demand uses booking requests and same-session enquiries.";
      const content = rows.length ? '<div class="analytics-table-wrap"><table class="analytics-data-table"><thead><tr><th>Product or service</th><th>Views</th><th>Completed units / booking requests</th><th>View-to-order / booking rate</th></tr></thead><tbody>' + rows.map(row => '<tr><td><strong>' + escapeHtml(row.item.name || "Unnamed item") + '</strong><small>' + escapeHtml(row.item.item_type || "product") + (row.item.is_available ? " · Available" : " · Unavailable") + '</small></td><td>' + (snapshot.eventsAvailable ? number(row.views) : "Not tracked") + '</td><td>' + number(row.purchases) + '</td><td>' + escapeHtml(row.rate) + '</td></tr>').join("") + '</tbody></table></div>' : '<div class="analytics-chart-empty"><strong>No products or services yet</strong><span>Add catalogue items to see their recorded performance here.</span></div>';
      return '<p class="analytics-detail-note">' + escapeHtml(tracking) + '</p>' + content;
    }
    if (view === "orders") {
      const completed = snapshot.currentOrders.filter(row => row.status === "completed" && row.payment_status !== "refunded");
      const cancelled = snapshot.currentOrders.filter(row => row.status === "cancelled");
      const subtotal = completed.reduce((sum, row) => sum + row.subtotal, 0);
      const average = completed.length ? money(subtotal / completed.length) : "—";
      const completionRate = snapshot.ordersPlaced ? (completed.length / snapshot.ordersPlaced * 100).toFixed(1) + "%" : "—";
      return '<div class="analytics-detail-stats">' + statCard("Orders placed", number(snapshot.ordersPlaced), periodLabel) + statCard("Completed orders", number(completed.length), "Payment status stays separate") + statCard("Cancelled orders", number(cancelled.length), "Counted as orders placed") + statCard("Completed order average", average, "Uses recorded order subtotals") + '</div><div class="analytics-outcome-row"><div><span>Completed share</span><strong>' + escapeHtml(completionRate) + '</strong></div><div class="analytics-outcome-track"><span style="width:' + Math.max(0, Math.min(100, completed.length / Math.max(1, snapshot.ordersPlaced) * 100)) + '%"></span></div></div><p class="analytics-detail-note">Order values reflect recorded order rows. Analytics does not label unpaid orders as confirmed payments or treat pending orders as completed sales.</p>';
    }
    const completed = snapshot.currentOrders.filter(row => row.status === "completed").length;
    const cancelled = snapshot.currentOrders.filter(row => row.status === "cancelled").length;
    const bookingCounts = Object.fromEntries(["pending", "accepted", "declined", "completed"].map(status => [status, snapshot.bookings.filter(row => row.status === status && engine.localDate(row.created_at) >= snapshot.range.start && engine.localDate(row.created_at) < snapshot.range.end).length]));
    const bookingCount = Object.values(bookingCounts).reduce((sum, count) => sum + count, 0);
    return '<div class="analytics-detail-stats">' + statCard("Orders completed", number(completed), periodLabel) + statCard("Orders cancelled", number(cancelled), "Current order status") + statCard("Booking requests", number(bookingCount), periodLabel) + statCard("Pending bookings", number(bookingCounts.pending), "Awaiting a business response") + '</div>' + (bookingCount ? '<div class="analytics-status-bars">' + Object.entries(bookingCounts).map(([status, count]) => '<div><span>' + escapeHtml(status) + '</span><b>' + number(count) + '</b><i><em style="width:' + Math.min(100, bookingCount ? count / bookingCount * 100 : 0) + '%"></em></i></div>').join("") + '</div>' : '<div class="analytics-chart-empty"><strong>No booking requests in this period</strong><span>Booking counts will appear when customers send an enquiry.</span></div>') + '<p class="analytics-detail-note">StoreNest currently records the latest order and booking status, but not every status-change timestamp. Response and preparation times are therefore not estimated.</p>';
  }

  function renderCustomerDays(snapshot) {
    const series = engine.buildSeries(snapshot, "returning");
    if (!series.some(row => row.value > 0)) return '<div class="analytics-chart-empty"><strong>Not enough returning-customer history yet</strong><span>Repeat purchases will appear as linked customer accounts build up history.</span></div>';
    return '<div class="analytics-status-bars">' + series.map(row => '<div><span>' + escapeHtml(row.label) + '</span><b>' + number(row.value) + ' returning</b><i><em style="width:' + Math.min(100, row.value ? 100 : 0) + '%"></em></i></div>').join("") + '</div>';
  }

  async function saveInsightStatus(insight, nextStatus) {
    if (!state.statesAvailable || !root.StoreNestBusinessClient) {
      setStatusMessage("Insight status could not be saved. Refresh and try again when StoreNest is connected.", true);
      return false;
    }
    const existing = state.insightStates[insight.key] || {};
    const now = new Date().toISOString();
    const payload = {
      business_id: state.businessId,
      insight_key: insight.key,
      status: nextStatus,
      updated_at: now,
      acted_at: nextStatus === "action_taken" ? (existing.acted_at || now) : (existing.acted_at || null)
    };
    const { error } = await root.StoreNestBusinessClient.from("business_analytics_insight_states")
      .upsert(payload, { onConflict: "business_id,insight_key" });
    if (error) {
      console.error("Could not save StoreNest insight status:", error);
      setStatusMessage("Insight status could not be saved. Please try again.", true);
      return false;
    }
    state.insightStates[insight.key] = payload;
    setStatusMessage("Insight marked as " + statusLabel(nextStatus).toLowerCase() + ".", false);
    return true;
  }

  function renderInsightDetail(snapshot) {
    const host = $("analyticsInsightDetail");
    const insight = (state.generatedInsights || []).find(row => row.key === state.activeInsightKey);
    if (!host) return;
    if (!insight) { host.hidden = true; return; }
    host.hidden = false;
    const evidence = insight.evidence.map(row => '<div><dt>' + escapeHtml(row.label) + '</dt><dd>' + escapeHtml(row.value) + '</dd></div>').join("");
    const actedAt = state.insightStates[insight.key]?.acted_at || insight.actedAt;
    const follow = insight.status === "action_taken" && actedAt ? engine.followUp(snapshot, insight, actedAt, new Date()) : null;
    let followHtml = "";
    if (follow?.available) {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up comparison</h4><p>' + escapeHtml(follow.message) + '</p><div class="analytics-follow-up"><span>Before: ' + escapeHtml(follow.beforeLabel || String(follow.before)) + '</span><span>After: ' + escapeHtml(follow.afterLabel || String(follow.after)) + '</span><strong>' + escapeHtml(follow.change?.label || "Not comparable") + '</strong></div></section>';
    } else if (follow?.reason === "wait") {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up</h4><p>StoreNest will compare the next seven full days with the seven full days before this action after the measurement period ends. A later change is a comparison, not proof of cause.</p></section>';
    } else if (follow?.reason === "insufficient") {
      followHtml = '<section class="analytics-detail-block"><h4>Follow-up</h4><p>StoreNest needs at least 10 tracked ' + (insight.service ? "service-view" : "product-view") + ' sessions in both seven-day periods before it can compare this item’s view-to-' + (insight.service ? "booking" : "order") + ' rate. Before: ' + number(follow.beforeVisits) + ' sessions. After: ' + number(follow.afterVisits) + ' sessions.</p></section>';
    }
    host.innerHTML = '<div class="analytics-detail-heading"><div><span class="analytics-kicker">SMART INSIGHT · ' + escapeHtml(insight.priority) + ' priority</span><h3>' + escapeHtml(insight.title) + '</h3><p>' + escapeHtml(insight.explanation) + '</p></div><button type="button" class="analytics-back-button" data-close-insight>← Back to insights</button></div><div class="analytics-detail-grid"><section class="analytics-detail-block"><h4>Supporting evidence</h4><dl class="analytics-evidence-list">' + evidence + '</dl><small>Observed ' + escapeHtml(dateLabel(new Date(insight.detectedAt))) + ' · Period ' + escapeHtml(insight.observation.start) + ' to ' + escapeHtml(insight.observation.end) + '</small></section><section class="analytics-detail-block"><h4>What it could mean</h4><p>' + escapeHtml(insight.interpretation) + '</p></section><section class="analytics-detail-block"><h4>Suggested action</h4><p>' + escapeHtml(insight.recommendation) + '</p></section>' + followHtml + '</div><div class="analytics-insight-actions"><span class="analytics-status analytics-status-' + escapeHtml(insight.status) + '">' + escapeHtml(statusLabel(insight.status)) + '</span><button type="button" class="outline-button" data-insight-status="viewed">Mark viewed</button><button type="button" class="primary-button" data-insight-status="action_taken">I took action</button><button type="button" class="outline-button" data-insight-status="dismissed">Dismiss</button></div>';
  }

  function render(snapshot) {
    const content = $("analyticsContent");
    if (content) content.hidden = false;
    const range = snapshot.range;
    const rangeLabel = $("analyticsRangeLabel");
    if (rangeLabel && range) rangeLabel.textContent = dateLabel(range.start) + " – " + dateLabel(engine.addDays(range.end, -1));
    renderSummary(snapshot);
    renderChart(snapshot);
    renderInsights(snapshot);
    renderExplore(snapshot);
    renderInsightDetail(snapshot);
    const trackingNote = $("analyticsTrackingNote");
    const needsBookingAttribution = snapshot.items.some(item => String(item.item_type || "").toLowerCase() === "service");
    if (trackingNote) trackingNote.hidden = snapshot.eventsAvailable && snapshot.orderAttributionAvailable && (!needsBookingAttribution || snapshot.bookingAttributionAvailable);
    if (!snapshot.eventsAvailable) setStatusMessage("StoreNest is not recording storefront sessions yet. Visit-based figures and recommendations are shown as unavailable, not zero.", false);
    else if (!snapshot.orderAttributionAvailable) setStatusMessage("Visit tracking is available, but same-session order attribution is not connected yet.", false);
    else if (needsBookingAttribution && !snapshot.bookingAttributionAvailable) setStatusMessage("Product tracking is connected. Same-session service booking attribution is not connected yet.", false);
    else setStatusMessage("", false);
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
      state.activeView = "";
      state.insightsExpanded = false;
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
    $("analyticsMetric")?.addEventListener("change", () => { state.metric = $("analyticsMetric").value; if (state.loaded) renderChart(currentSnapshot()); });
    $("analyticsViewAllInsights")?.addEventListener("click", () => { state.insightsExpanded = !state.insightsExpanded; if (state.loaded) renderInsights(currentSnapshot()); });
    $("analyticsRetry")?.addEventListener("click", () => { state.loaded = false; loadData(true); });
    $("analyticsRefresh")?.addEventListener("click", () => { state.loaded = false; loadData(true); });
    $("analyticsExploreCards")?.addEventListener("click", event => {
      const button = event.target.closest("[data-analytics-view]");
      if (!button) return;
      state.activeView = button.dataset.analyticsView;
      if (state.loaded) renderExplore(currentSnapshot());
    });
    $("analyticsBusinessBack")?.addEventListener("click", () => { state.activeView = ""; if (state.loaded) renderExplore(currentSnapshot()); });
    $("analyticsInsightDetail")?.addEventListener("click", async event => {
      if (event.target.closest("[data-close-insight]")) {
        state.activeInsightKey = "";
        if (state.loaded) renderInsightDetail(currentSnapshot());
        return;
      }
      const action = event.target.closest("[data-insight-status]");
      if (!action) return;
      const insight = (state.generatedInsights || []).find(row => row.key === state.activeInsightKey);
      if (!insight) return;
      const saved = await saveInsightStatus(insight, action.dataset.insightStatus);
      if (saved && state.loaded) render(currentSnapshot());
    });
    $("smartInsightList")?.addEventListener("click", async event => {
      const button = event.target.closest("[data-explore-insight]");
      if (!button) return;
      state.activeInsightKey = button.dataset.exploreInsight;
      const insight = (state.generatedInsights || []).find(row => row.key === state.activeInsightKey);
      if (insight && insight.status === "new") await saveInsightStatus(insight, "viewed");
      if (state.loaded) render(currentSnapshot());
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
