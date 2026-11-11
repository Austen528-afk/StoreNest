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

  const VIEW_TREND_SETTINGS = Object.freeze({
    customers: { title: "Customer Trends", description: "Repeat purchases from identified customers.", metric: "returning" },
    products: { title: "Product & Service Trends", description: "Unique product and service views over time.", metric: "product_views" },
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
      const completed = rows => rows.filter(row => row.status === "completed" && row.payment_status !== "refunded");
      const cancelled = rows => rows.filter(row => row.status === "cancelled");
      const currentCompleted = completed(snapshot.currentOrders);
      const previousCompleted = completed(snapshot.previousOrders);
      const currentCancelled = cancelled(snapshot.currentOrders);
      const previousCancelled = cancelled(snapshot.previousOrders);
      const currentAverage = currentCompleted.length ? currentCompleted.reduce((sum, row) => sum + row.subtotal, 0) / currentCompleted.length : null;
      const previousAverage = previousCompleted.length ? previousCompleted.reduce((sum, row) => sum + row.subtotal, 0) / previousCompleted.length : null;
      metrics = [
        summaryMetric("Orders placed", number(snapshot.ordersPlaced), metricChange(snapshot.ordersPlaced, snapshot.previousOrdersPlaced, "count"), "Includes orders later cancelled"),
        summaryMetric("Completed orders", number(currentCompleted.length), metricChange(currentCompleted.length, previousCompleted.length, "count"), "Refunded orders excluded"),
        summaryMetric("Cancelled orders", number(currentCancelled.length), metricChange(currentCancelled.length, previousCancelled.length, "count"), "Included in orders placed"),
        summaryMetric("Average order value", currentAverage == null ? "—" : money(currentAverage), metricChange(currentAverage, previousAverage, "count"), "Completed orders only")
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
    return metric === "conversion" ? Number(value).toFixed(1) + "%" : number(value);
  }

  function renderChart(snapshot) {
    const host = $("analyticsChart");
    if (!host) return;
    const metric = $("analyticsMetric")?.value || state.metric;
    state.metric = metric;
    const series = engine.buildSeries(snapshot, metric);
    const label = ({ orders: "Orders", visits: "Store visits", conversion: "Conversion", returning: "Returning customers", product_views: "Unique item views", bookings: "Booking requests" })[metric] || "Orders";
    const tracked = metric === "visits" || metric === "product_views"
      ? snapshot.eventTrackingAvailable
      : metric !== "conversion" || (snapshot.eventTrackingAvailable && snapshot.orderAttributionAvailable);
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
      const suffix = metric === "visits" ? " sessions" : metric === "orders" ? " orders" : metric === "product_views" ? " item views" : metric === "bookings" ? " booking requests" : "";
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

  function iconForInsight(type) {
    return ({ traffic_change: "↗", order_volume_change: "▤", product_view_order_rate: "◇", service_view_booking_rate: "▧", cancellation_rate: "!", returning_customer_decline: "↻", weekday_demand_pattern: "◷" })[type] || "✦";
  }

  function updateTrendHeading() {
    const settings = VIEW_TREND_SETTINGS[state.activeView];
    const title = $("analyticsTrendsTitle");
    const description = $("analyticsTrendsDescription");
    const back = $("analyticsBusinessBack");
    if (title) title.textContent = settings ? settings.title : "Performance Trends";
    if (description) description.textContent = settings ? settings.description : "Track your store's key metrics over time.";
    if (back) back.hidden = !settings;
  }

  function setAnalyticsView(view) {
    if (view && VIEW_TREND_SETTINGS[view]) {
      if (!state.activeView) state.defaultMetric = $("analyticsMetric")?.value || state.metric || "orders";
      state.activeView = view;
      state.metric = VIEW_TREND_SETTINGS[view].metric;
    } else {
      state.activeView = "";
      state.metric = state.defaultMetric || "orders";
    }
    const metricSelect = $("analyticsMetric");
    if (metricSelect) metricSelect.value = state.metric;
    updateTrendHeading();
    if (state.loaded) {
      const snapshot = currentSnapshot();
      renderSummary(snapshot, state.activeView);
      renderChart(snapshot);
    }
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
    renderSummary(snapshot, state.activeView);
    renderChart(snapshot);
    renderInsights(snapshot);
    updateTrendHeading();
    renderInsightDetail(snapshot);
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
      state.metric = "orders";
      state.defaultMetric = "orders";
      if ($("analyticsMetric")) $("analyticsMetric").value = "orders";
      updateTrendHeading();
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
    $("analyticsMetric")?.addEventListener("change", () => {
      state.metric = $("analyticsMetric").value;
      if (!state.activeView) state.defaultMetric = state.metric;
      if (state.loaded) renderChart(currentSnapshot());
    });
    $("analyticsViewAllInsights")?.addEventListener("click", () => { state.insightsExpanded = !state.insightsExpanded; if (state.loaded) renderInsights(currentSnapshot()); });
    $("analyticsRetry")?.addEventListener("click", () => { state.loaded = false; loadData(true); });
    $("analyticsRefresh")?.addEventListener("click", () => { state.loaded = false; loadData(true); });
    const exploreCards = $("analyticsExploreCards");
    if (exploreCards) {
      exploreCards.querySelectorAll("[data-analytics-view]").forEach(button => {
        button.addEventListener("click", event => {
          event.preventDefault();
          const selectedView = button.dataset.analyticsView;
          setAnalyticsView(state.activeView === selectedView ? "" : selectedView);
        });
      });
    }
    $("analyticsBusinessBack")?.addEventListener("click", event => { event.preventDefault(); setAnalyticsView(""); });
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
