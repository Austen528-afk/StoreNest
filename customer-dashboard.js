(function () {
  "use strict";

  const engine = window.StoreNestCustomerEngine;
  const $ = id => document.getElementById(id);
  const PAGE_SIZE = 500;
  const state = {
    client: null,
    businessId: "",
    businessName: "",
    model: null,
    period: "last30",
    metric: "purchases",
    eventsAvailable: true,
    eventWarning: "",
    detailView: "",
    previousDetail: "",
    selectedCustomerKey: "",
    search: "",
    sortBy: "orders",
    sortDirection: -1,
    requestId: 0,
    authSubscription: null
  };

  if (!engine || !$('customerDashboard')) return;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function formatMoney(value) {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    return "R" + new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 1 }).format(Number(value) || 0);
  }

  function formatDate(value, options) {
    const date = value instanceof Date ? value : new Date(value || "");
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-ZA", options || { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function formatPercent(value) {
    return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(1) + "%";
  }

  function element(id) { return $(id); }

  function setText(id, value) {
    const node = element(id);
    if (node) node.textContent = value == null ? "" : String(value);
  }

  function setHidden(id, hidden) {
    const node = element(id);
    if (node) node.hidden = Boolean(hidden);
  }

  function setNotice(text, isError) {
    const node = element(isError ? "customerError" : "customerStatus");
    const other = element(isError ? "customerStatus" : "customerError");
    if (other) other.hidden = true;
    if (!node) return;
    node.textContent = text || "";
    node.hidden = !text;
  }

  function selectedRange() {
    const period = element("customerDateRange")?.value || state.period || "last30";
    const custom = { start: element("customerCustomStart")?.value || "", end: element("customerCustomEnd")?.value || "" };
    return { period, custom, range: engine.dateRange(period, custom) };
  }

  function rangeLabel(range) {
    if (!range) return "";
    return formatDate(range.start) + " – " + formatDate(engine.addDays(range.end, -1));
  }

  async function fetchRows(client, table, columns, businessId, dateColumn, startAt, endAt) {
    const result = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = client.from(table).select(columns).eq("business_id", businessId);
      if (startAt && dateColumn) query = query.gte(dateColumn, startAt.toISOString());
      if (endAt && dateColumn) query = query.lt(dateColumn, endAt.toISOString());
      if (dateColumn) query = query.order(dateColumn, { ascending: true });
      const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      result.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return result;
  }

  function showLoading(show) {
    setHidden("customerLoading", !show);
    if (show) {
      setHidden("customerError", true);
      if (!state.model) {
        setHidden("customerMain", true);
        setHidden("customerDetailPanel", true);
      }
    }
  }

  function resetSummary() {
    ["customerTotal", "customerReturning", "customerAverageSpend", "customerRepeatRate"].forEach(id => setText(id, "—"));
    ["customerTotalNote", "customerReturningNote", "customerAverageSpendNote", "customerRepeatRateNote"].forEach(id => setText(id, ""));
    setText("customerChart", "");
    setText("customerInsightsList", "");
    setText("customerTopBody", "");
    setText("customerTableCount", "");
  }

  async function refresh() {
    const selected = selectedRange();
    state.period = selected.period;
    if (!state.businessId) {
      showLoading(false);
      resetSummary();
      setNotice("Choose a business to view its customer activity.", false);
      return;
    }
    if (!selected.range) {
      showLoading(false);
      setNotice("Choose a valid start and end date. The end date must be today or earlier.", true);
      return;
    }
    if (!state.client && window.StoreNestBusinessClient) state.client = window.StoreNestBusinessClient;
    if (!state.client) {
      showLoading(false);
      setNotice("The StoreNest account connection is not ready. Refresh the dashboard in a moment.", true);
      return;
    }
    const requestId = ++state.requestId;
    state.model = null;
    showLoading(true);
    setNotice("", false);
    setText("customerRangeLabel", rangeLabel(selected.range));
    try {
      const [orders, bookings, items, categories] = await Promise.all([
        fetchRows(state.client, "storefront_orders", "id,business_id,customer_user_id,customer_name,contact_email,contact_phone,created_at,updated_at,status,payment_status,subtotal,items,analytics_session_id", state.businessId, "created_at"),
        fetchRows(state.client, "service_booking_requests", "id,business_id,item_id,customer_user_id,customer_name,contact_email,contact_phone,created_at,updated_at,status,analytics_session_id", state.businessId, "created_at"),
        fetchRows(state.client, "business_items", "id,business_id,name,item_type,category_id", state.businessId, "created_at"),
        fetchRows(state.client, "business_categories", "id,business_id,name", state.businessId, "created_at")
      ]);
      if (requestId !== state.requestId) return;
      let events = [];
      let eventsAvailable = true;
      let eventWarning = "";
      try {
        events = await fetchRows(state.client, "storefront_analytics_events", "business_id,event_type,session_id,item_id,occurred_at", state.businessId, "occurred_at", selected.range.previousStart, selected.range.end);
      } catch (error) {
        eventsAvailable = false;
        eventWarning = "Storefront visit and product activity could not be loaded. Order and booking information is still available.";
        console.warn("StoreNest customer activity could not load storefront events:", error.message || error);
      }
      if (requestId !== state.requestId) return;
      state.eventsAvailable = eventsAvailable;
      state.eventWarning = eventWarning;
      state.model = engine.buildModel({
        businessId: state.businessId,
        orders,
        bookings,
        items,
        categories,
        events,
        eventsAvailable,
        period: selected.period,
        custom: selected.custom
      });
      showLoading(false);
      setNotice(eventWarning, false);
      render();
    } catch (error) {
      if (requestId !== state.requestId) return;
      state.model = null;
      showLoading(false);
      setHidden("customerMain", true);
      setHidden("customerDetailPanel", true);
      setNotice("Customer information could not be loaded for this business. Please refresh and try again.", true);
      console.error("StoreNest customer dashboard failed to load:", error);
    }
  }

  function enoughToCompare(currentCount, previousCount, minimum) {
    return Number(currentCount) >= minimum && Number(previousCount) >= minimum;
  }

  function countComparison(current, previous, reliable) {
    if (!reliable) return "Not enough history to compare";
    const difference = current - previous;
    if (!difference) return "No change vs previous period";
    return (difference > 0 ? "+" : "") + difference + " vs previous period";
  }

  function percentageComparison(current, previous, reliable, suffix) {
    if (!reliable || current == null || previous == null) return "Not enough history to compare";
    const difference = current - previous;
    if (!difference) return "No change vs previous period";
    return (difference > 0 ? "+" : "") + difference.toFixed(1) + (suffix || " pp") + " vs previous period";
  }

  function comparisonClass(node, current, previous, reliable) {
    if (!node) return;
    node.classList.remove("positive", "negative");
    if (!reliable || current == null || previous == null || current === previous) return;
    node.classList.add(current > previous ? "positive" : "negative");
  }

  function renderSummary(model) {
    const current = model.current, previous = model.previous;
    setText("customerTotal", formatNumber(model.customers.size));
    setText("customerTotalNote", model.customers.size ? "All time · from orders and booking requests" : "No identifiable customer records yet");
    setText("customerReturning", formatNumber(current.returningCustomers));
    const countReliable = enoughToCompare(current.identifiedBuyers, previous.identifiedBuyers, 5);
    const returningNote = current.identifiedBuyers
      ? current.returningCustomers + " of " + current.identifiedBuyers + " identified purchasers · " + countComparison(current.returningCustomers, previous.returningCustomers, countReliable)
      : "No identified purchasers in the selected period";
    setText("customerReturningNote", returningNote);
    comparisonClass(element("customerReturningNote"), current.returningCustomers, previous.returningCustomers, countReliable);

    setText("customerAverageSpend", current.averageSpend == null ? "—" : formatMoney(current.averageSpend));
    const spendReliable = current.paidOrderCount >= 3 && previous.paidOrderCount >= 3;
    const spendNote = current.paidOrderCount
      ? "Paid customer orders only · " + current.paidOrderCount + " orders · " + percentageComparison(current.averageSpend, previous.averageSpend, spendReliable, "%")
      : "No paid customer orders recorded in this period";
    setText("customerAverageSpendNote", spendNote);
    comparisonClass(element("customerAverageSpendNote"), current.averageSpend, previous.averageSpend, spendReliable);

    setText("customerRepeatRate", formatPercent(current.returningRate));
    const repeatReliable = enoughToCompare(current.identifiedBuyers, previous.identifiedBuyers, 5);
    const repeatNote = current.returningRate == null
      ? "No identified completed purchasers to measure"
      : current.returningCustomers + " of " + current.identifiedBuyers + " purchasers · " + percentageComparison(current.returningRate, previous.returningRate, repeatReliable, " pp");
    setText("customerRepeatRateNote", repeatNote);
    comparisonClass(element("customerRepeatRateNote"), current.returningRate, previous.returningRate, repeatReliable);
  }

  function metricData(model, metric) {
    if (metric === "visits") return model.series.visits;
    if (metric === "repeatRate") return model.series.repeatRate;
    return model.series.purchases;
  }

  function chartValueLabel(value, metric) {
    if (value == null) return "Not available";
    return metric === "repeatRate" ? Number(value).toFixed(1) + "%" : formatNumber(value);
  }

  function renderChart(target, rows, metric, emptyMessage, ariaLabel) {
    if (!target) return;
    const values = (rows || []).map(row => row.value).filter(value => value != null && Number.isFinite(value));
    if (!values.length || !values.some(value => value > 0)) {
      target.innerHTML = '<div class="customer-empty"><strong>' + escapeHtml(emptyMessage || "Not enough customer activity yet") + '</strong><p>StoreNest shows activity only after it has been recorded for this business.</p></div>';
      return;
    }
    const width = 760, height = 225, left = 43, right = 10, top = 12, bottom = 31;
    const chartWidth = width - left - right, chartHeight = height - top - bottom;
    const maximum = metric === "repeatRate" ? 100 : Math.max(4, Math.ceil(Math.max(...values) * 1.18));
    const tickCount = 4;
    const xAt = index => rows.length <= 1 ? left + chartWidth / 2 : left + (index / (rows.length - 1)) * chartWidth;
    const yAt = value => top + chartHeight - (Number(value) / maximum) * chartHeight;
    let grid = "", labels = "", line = "", area = "", points = "";
    for (let tick = 0; tick <= tickCount; tick++) {
      const value = maximum * tick / tickCount;
      const y = yAt(value);
      grid += '<line class="chart-grid" x1="' + left + '" y1="' + y.toFixed(1) + '" x2="' + (width - right) + '" y2="' + y.toFixed(1) + '"></line>';
      labels += '<text class="chart-axis-label" x="' + (left - 8) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end">' + escapeHtml(metric === "repeatRate" ? Math.round(value) + "%" : Math.round(value)) + '</text>';
    }
    const pointRows = rows.map((row, index) => row.value == null ? null : { x: xAt(index), y: yAt(row.value), row }).filter(Boolean);
    line = pointRows.map((point, index) => (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1)).join(" ");
    if (pointRows.length > 1) {
      area = '<path class="chart-area" d="' + line + ' L ' + pointRows[pointRows.length - 1].x.toFixed(1) + ' ' + (top + chartHeight) + ' L ' + pointRows[0].x.toFixed(1) + ' ' + (top + chartHeight) + ' Z"></path>';
    }
    const labelStep = Math.max(1, Math.ceil(rows.length / 7));
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], x = xAt(index);
      if (index % labelStep === 0 || index === rows.length - 1) {
        labels += '<text class="chart-axis-label" x="' + x.toFixed(1) + '" y="' + (height - 8) + '" text-anchor="middle">' + escapeHtml(row.label) + '</text>';
      }
      if (row.value != null) {
        const y = yAt(row.value);
        points += '<circle class="chart-point" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.4"><title>' + escapeHtml(row.label + ": " + chartValueLabel(row.value, metric)) + '</title></circle>';
      }
    }
    target.innerHTML = '<svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escapeHtml(ariaLabel || "Customer activity over time") + '" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="customerChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#29bd70" stop-opacity=".2"></stop><stop offset="1" stop-color="#29bd70" stop-opacity=".015"></stop></linearGradient></defs>' + grid + labels + area + '<path class="chart-line" d="' + line + '"></path>' + points + '</svg>';
  }

  function currentEventRows(model) {
    return model.events.filter(row => engine.within(row.occurred_at, model.range.start, model.range.end));
  }

  function uniqueSessionCount(rows, eventType) {
    return new Set(rows.filter(row => row.event_type === eventType && row.session_id).map(row => row.session_id)).size;
  }

  function uniqueProductViewPairs(rows) {
    return new Set(rows.filter(row => row.event_type === "product_view" && row.session_id && row.item_id).map(row => row.session_id + "\u0000" + row.item_id)).size;
  }

  function renderMainChart(model) {
    const rows = metricData(model, state.metric);
    const metricLabels = { purchases: "Purchases", visits: "Visits", repeatRate: "Repeat purchase rate" };
    let empty = "No completed purchases recorded in this period.";
    let note = "Completed, non-refunded orders by order date. Unpaid orders count as completed orders, not confirmed payment.";
    if (state.metric === "visits") {
      empty = state.eventsAvailable ? "No visit sessions were recorded in this period." : "Storefront visit tracking is unavailable.";
      note = state.eventsAvailable ? "Visits count unique recorded storefront sessions. Older activity is not backfilled." : state.eventWarning;
    } else if (state.metric === "repeatRate") {
      empty = "Not enough identified purchasers to show a repeat rate.";
      note = "For each time bucket, the rate is identified purchasers with a prior completed order. Anonymous visits are excluded.";
    }
    renderChart(element("customerChart"), rows, state.metric, empty, metricLabels[state.metric] + " over time");
    setText("customerChartNote", note);
  }

  function initials(name) {
    const words = String(name || "Customer").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map(word => word[0]).join("").toUpperCase() || "C";
  }

  function visibleCustomers(model) {
    const query = state.search.trim().toLowerCase();
    let rows = model.topCustomers.filter(row => !query || row.name.toLowerCase().includes(query) || row.status.toLowerCase().includes(query));
    const key = state.sortBy;
    rows.sort((a, b) => {
      let difference = 0;
      if (key === "name") difference = a.name.localeCompare(b.name);
      else if (key === "lastPurchase") difference = (Date.parse(a.lastPurchase) || 0) - (Date.parse(b.lastPurchase) || 0);
      else difference = (Number(a[key]) || 0) - (Number(b[key]) || 0);
      return difference * state.sortDirection;
    });
    return rows;
  }

  function renderCustomerRows(model, body, countNode, limit) {
    if (!body) return;
    const rows = visibleCustomers(model);
    if (countNode) countNode.textContent = rows.length + (rows.length === 1 ? " customer" : " customers");
    if (!rows.length) {
      body.innerHTML = '<tr><td class="customer-table-empty" colspan="6">' + escapeHtml(state.search ? "No customers match this search." : "No identified customers have completed an order in this period.") + '</td></tr>';
      return;
    }
    body.innerHTML = rows.slice(0, limit || rows.length).map(row => '<tr>' +
      '<td><button type="button" class="customer-customer-button" data-customer-detail="' + escapeHtml(row.key) + '"><span class="customer-avatar-small" aria-hidden="true">' + escapeHtml(initials(row.name)) + '</span><span>' + escapeHtml(row.name) + '</span></button></td>' +
      '<td>' + formatNumber(row.orders) + '</td>' +
      '<td>' + formatMoney(row.paidSpend) + '</td>' +
      '<td>' + escapeHtml(formatDate(row.lastPurchase)) + '</td>' +
      '<td><span class="customer-pill">' + escapeHtml(row.status) + '</span></td>' +
      '<td><button type="button" class="customer-link-button" data-customer-detail="' + escapeHtml(row.key) + '" aria-label="Open ' + escapeHtml(row.name) + ' details">···</button></td>' +
      '</tr>').join("");
  }

  function iconForInsight(type) {
    return ({ retention: "⟳", timing: "▦", spend: "R", interest: "↗" })[type] || "✦";
  }

  function renderInsightItems(insights, container, showEvidence) {
    if (!container) return;
    if (!insights.length) {
      container.innerHTML = '<div class="customer-empty"><strong>No customer insights yet</strong><p>StoreNest will show a pattern when enough real customer activity supports it. Anonymous visits and unpaid totals are not used to invent findings.</p></div>';
      return;
    }
    container.innerHTML = insights.map(insight => {
      const evidence = showEvidence ? '<div class="customer-insight-evidence">' + escapeHtml((insight.evidence || []).map(item => item.label + ": " + item.value).join(" · ")) + '</div>' : "";
      return '<article class="customer-insight"><span class="customer-insight-icon" aria-hidden="true">' + escapeHtml(iconForInsight(insight.type)) + '</span><div class="customer-insight-copy"><strong>' + escapeHtml(insight.title) + '</strong><p>' + escapeHtml(insight.explanation) + '</p>' + evidence + '</div><button type="button" class="customer-insight-action" data-customer-view="' + escapeHtml(insight.view) + '">Explore ↗</button></article>';
    }).join("");
  }

  function render() {
    const model = state.model;
    if (!model || !model.valid) return;
    setHidden("customerMain", Boolean(state.detailView));
    setHidden("customerDetailPanel", !state.detailView);
    setHidden("customerLoading", true);
    setText("customerRangeLabel", rangeLabel(model.range));
    renderSummary(model);
    renderMainChart(model);
    renderInsightItems(model.insights, element("customerInsightsList"), false);
    renderCustomerRows(model, element("customerTopBody"), element("customerTableCount"), 5);
    if (element("customerTopSearch") && element("customerTopSearch").value !== state.search) element("customerTopSearch").value = state.search;
    if (state.detailView) renderDetailView(model, state.detailView);
  }

  function statCard(label, value, note) {
    return '<article class="customer-detail-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(note) + '</small></article>';
  }

  function detailHeader(title, description) {
    return '<header class="customer-detail-header"><div class="customer-detail-title"><h4>' + escapeHtml(title) + '</h4><p>' + escapeHtml(description) + '</p></div><button type="button" class="customer-back-button" data-customer-action="back">← Back</button></header>';
  }

  function detailBlock(title, body) {
    return '<section class="customer-detail-block"><h5>' + escapeHtml(title) + '</h5>' + body + '</section>';
  }

  function listRows(rows, labelKey, valueKey, formatter) {
    if (!rows.length) return '<div class="customer-empty"><strong>No recorded activity yet</strong><p>These results will appear when StoreNest has enough activity from this business.</p></div>';
    return '<div class="customer-progress-list">' + rows.slice(0, 12).map(row => {
      const value = Number(row[valueKey]) || 0;
      const maximum = Math.max(1, ...rows.map(item => Number(item[valueKey]) || 0));
      const width = Math.max(0, Math.min(100, value / maximum * 100));
      return '<div class="customer-progress-row"><span class="customer-progress-label">' + escapeHtml(row[labelKey]) + '</span><span class="customer-progress-track" aria-hidden="true"><i style="width:' + width.toFixed(1) + '%"></i></span><span class="customer-progress-value">' + escapeHtml(formatter ? formatter(value) : formatNumber(value)) + '</span></div>';
    }).join("") + '</div>';
  }

  function newCustomerSeries(model) {
    return engine.createBuckets(model.range).map(bucket => ({
      ...bucket,
      value: [...model.customers.values()].filter(group => engine.within(group.first_seen, bucket.start, bucket.end)).length
    }));
  }

  function renderOverviewDetail(model) {
    const total = model.customers.size;
    const current = model.current;
    const series = newCustomerSeries(model);
    let html = detailHeader("Customer Overview", "Identified customers connected to this business through real orders and booking requests.");
    html += '<div class="customer-detail-grid">' +
      statCard("All identified customers", formatNumber(total), "All-time unique account IDs and contact details") +
      statCard("New customers", formatNumber(current.newCustomers), "First recorded business interaction in this period") +
      statCard("Active purchasers", formatNumber(current.identifiedBuyers), "Identified customers with completed orders in this period") +
      statCard("Returning purchasers", formatNumber(current.returningCustomers), "More than one completed order by the end of this period") +
      '</div>';
    html += detailBlock("Customer growth", '<div id="customerDetailChart" class="customer-chart"></div><p>Growth is based on the first recorded order or booking request for each identifiable customer. Storefront visits without an account or contact detail are not included.</p>');
    html += detailBlock("How customers are counted", '<p>StoreNest merges records that share the same account ID, normalized email address or phone number. Records without any of these identifiers are excluded from customer totals.</p>');
    element("customerDetailPanel").innerHTML = html;
    renderChart(element("customerDetailChart"), series, "purchases", "No new identified customers in this period.", "New identified customers over time");
  }

  function renderBehaviourDetail(model) {
    const rows = currentEventRows(model);
    const visits = state.eventsAvailable ? uniqueSessionCount(rows, "store_visit") : null;
    const productViews = state.eventsAvailable ? uniqueSessionCount(rows, "product_view") : null;
    const cartAdds = state.eventsAvailable ? uniqueSessionCount(rows, "cart_add") : null;
    const checkouts = state.eventsAvailable ? uniqueSessionCount(rows, "checkout_start") : null;
    const journey = model.journey.funnel;
    let html = detailHeader("Customer Behaviour", "Recorded storefront browsing and buying activity for the selected period.");
    html += '<div class="customer-detail-grid">' +
      statCard("Storefront visits", visits == null ? "—" : formatNumber(visits), visits == null ? "Tracking unavailable" : "Unique recorded sessions") +
      statCard("Product and service views", productViews == null ? "—" : formatNumber(productViews), state.eventsAvailable ? uniqueProductViewPairs(rows) + " unique item and session pairs" : "Tracking unavailable") +
      statCard("Cart sessions", cartAdds == null ? "—" : formatNumber(cartAdds), "Sessions with at least one recorded cart addition") +
      statCard("Checkout sessions", checkouts == null ? "—" : formatNumber(checkouts), "Sessions with a recorded checkout start") +
      '</div>';
    html += detailBlock("Purchases and service requests", '<div class="customer-analysis-list">' +
      '<div class="customer-analysis-item"><strong>Completed orders</strong><span>' + formatNumber(model.current.totalOrders) + ' completed, non-refunded orders were created in the selected period.</span></div>' +
      '<div class="customer-analysis-item"><strong>Booking requests</strong><span>' + formatNumber(model.bookings.filter(row => engine.within(row.created_at, model.range.start, model.range.end)).length) + ' booking requests were recorded in the selected period.</span></div>' +
      '</div>');
    html += detailBlock("What these records can tell you", '<p>Visits and product views are stored as anonymous session activity. They cannot be assigned to an identified customer unless StoreNest records a compatible account link. The customer total therefore uses order and booking records, not visitor counts.</p>');
    element("customerDetailPanel").innerHTML = html;
  }

  function categoryPurchases(model) {
    const totals = new Map();
    for (const order of model.orders.filter(row => engine.qualifyingPurchase(row) && engine.within(row.created_at, model.range.start, model.range.end))) {
      for (const line of order.items) {
        const item = model.itemMap.get(String(line.item_id || line.itemId || line.id || ""));
        if (!item) continue;
        const category = model.categoryMap.get(item.category_id) || "Uncategorised";
        totals.set(category, (totals.get(category) || 0) + Math.max(1, Number(line.quantity) || 1));
      }
    }
    return [...totals].map(([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units);
  }

  function renderPreferencesDetail(model) {
    const prefs = model.preferences;
    const categories = categoryPurchases(model);
    const purchased = prefs.purchased.map(row => ({ name: row.name, value: row.quantity + " units" }));
    const viewed = prefs.viewed.map(row => ({ name: row.name, value: row.sessions + " sessions" }));
    const options = prefs.options.map(row => ({ name: row.name, value: row.count + " selections" }));
    let html = detailHeader("Customer Preferences", "Products, services and options customers actually viewed or selected.");
    html += '<div class="customer-detail-grid">' +
      statCard("Recorded item views", formatNumber(prefs.viewed.reduce((sum, row) => sum + row.sessions, 0)), "Unique item and session pairs") +
      statCard("Purchased items", formatNumber(prefs.purchased.length), "Items on completed, non-refunded orders") +
      statCard("Recorded option choices", formatNumber(prefs.options.reduce((sum, row) => sum + row.count, 0)), "Selections saved with completed orders") +
      '</div>';
    html += detailBlock("Most purchased", purchased.length ? '<div class="customer-analysis-list">' + purchased.slice(0, 12).map(row => '<div class="customer-analysis-item"><strong>' + escapeHtml(row.name) + '</strong><span>' + escapeHtml(row.value) + '</span></div>').join("") + '</div>' : '<div class="customer-empty"><strong>No completed item purchases in this period</strong><p>Purchased item details come from the product selections saved on completed orders.</p></div>');
    html += detailBlock("Product and service interest", viewed.length ? '<div class="customer-analysis-list">' + viewed.slice(0, 12).map(row => '<div class="customer-analysis-item"><strong>' + escapeHtml(row.name) + '</strong><span>' + escapeHtml(row.value) + '</span></div>').join("") + '</div>' : '<div class="customer-empty"><strong>No recorded product views yet</strong><p>Views are anonymous sessions and are shown only when the event was recorded.</p></div>');
    html += detailBlock("Popular categories and selected options", '<div class="customer-analysis-list">' +
      (categories.length ? '<div class="customer-analysis-item"><strong>Purchase categories</strong><span>' + escapeHtml(categories.slice(0, 8).map(row => row.name + " · " + row.units + " units").join("; ")) + '</span></div>' : '<div class="customer-analysis-item"><strong>Purchase categories</strong><span>No category can be linked to order items in this period.</span></div>') +
      (options.length ? '<div class="customer-analysis-item"><strong>Selected options</strong><span>' + escapeHtml(options.slice(0, 8).map(row => row.name + " · " + row.value).join("; ")) + '</span></div>' : '<div class="customer-analysis-item"><strong>Selected options</strong><span>No option selections were recorded with completed orders in this period.</span></div>') +
      '</div>');
    element("customerDetailPanel").innerHTML = html;
  }

  function habitRows(model, mode) {
    const orders = model.current.rangeOrders;
    if (mode === "day") {
      const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const counts = names.map(name => ({ name, value: 0 }));
      orders.forEach(row => { const date = new Date(row.created_at); if (!Number.isNaN(date.getTime())) counts[date.getDay()].value++; });
      return counts;
    }
    const labels = ["Overnight · 00–05", "Morning · 06–11", "Afternoon · 12–17", "Evening · 18–23"];
    const counts = labels.map(name => ({ name, value: 0 }));
    orders.forEach(row => {
      const date = new Date(row.created_at);
      if (Number.isNaN(date.getTime())) return;
      const bucket = Math.floor(date.getHours() / 6);
      counts[bucket].value++;
    });
    return counts;
  }

  function renderHabitsDetail(model) {
    const intervals = engine.purchaseIntervals(model);
    const dayRows = habitRows(model, "day");
    const timeRows = habitRows(model, "time");
    const paidAverage = model.current.averageSpend;
    let html = detailHeader("Purchase Habits", "When customers place completed orders, how often identified buyers return, and what recorded paid orders average.");
    html += '<div class="customer-detail-grid">' +
      statCard("Completed orders", formatNumber(model.current.totalOrders), "Order creation dates in selected period") +
      statCard("Average paid spend", formatMoney(paidAverage), model.current.paidOrderCount + " identified customer orders marked paid") +
      statCard("Median repeat interval", intervals ? formatNumber(intervals.medianDays) + " days" : "—", intervals ? "Across " + intervals.intervals + " observed intervals" : "Need at least one identified repeat purchase") +
      '</div>';
    html += detailBlock("Orders by day", listRows(dayRows, "name", "value"));
    html += detailBlock("Orders by time of day", listRows(timeRows, "name", "value"));
    html += detailBlock("Reading the totals", '<p>Timing uses the order creation timestamp in the business owner’s local time zone. Average spend uses only completed customer orders whose payment status is recorded as paid. Pay-on-collection orders marked unpaid are not counted as money collected.</p>');
    element("customerDetailPanel").innerHTML = html;
  }

  function renderJourneyRows(rows) {
    const maximum = Math.max(1, ...rows.map(row => Number(row.count) || 0));
    return '<div class="customer-progress-list">' + rows.map(row => {
      const width = Math.max(0, Math.min(100, row.count / maximum * 100));
      return '<div class="customer-progress-row"><span class="customer-progress-label">' + escapeHtml(row.label) + '</span><span class="customer-progress-track" aria-hidden="true"><i style="width:' + width.toFixed(1) + '%"></i></span><span class="customer-progress-value">' + escapeHtml(row.count == null ? "—" : formatNumber(row.count)) + '</span></div>';
    }).join("") + '</div>';
  }

  function renderJourneyDetail(model) {
    const journey = model.journey;
    let html = detailHeader("Customer Journey", "Movement between recorded storefront activity and an order or booking request.");
    if (!journey.trackingAvailable) {
      html += '<div class="customer-detail-block"><div class="customer-empty"><strong>Storefront tracking is unavailable</strong><p>Order and booking records can still be viewed, but StoreNest cannot build a session journey until activity events can be read.</p></div></div>';
      element("customerDetailPanel").innerHTML = html;
      return;
    }
    const f = journey.funnel;
    const steps = [
      { label: "Storefront visit", count: f.visits },
      { label: "Product or service view", count: f.productViews },
      { label: "Add to cart", count: f.cartAdds },
      { label: "Checkout started", count: f.checkoutStarts },
      { label: "Order placed", count: f.ordersPlaced },
      { label: "Currently completed", count: f.completedOrders }
    ];
    const service = journey.service;
    const serviceRows = [
      { label: "Storefront visit", count: service.visits },
      { label: "Service view", count: service.serviceViews },
      { label: "Linked booking request", count: service.linkedBookingSessions }
    ];
    html += detailBlock("Product purchase journey", renderJourneyRows(steps) + '<p>Each count is a distinct session that reached the step after the previous recorded step. StoreNest does not record a separate status-change timestamp, so the final completed-order count is based on the order’s current status and completion timing is not measured.</p>');
    html += detailBlock("Service enquiry journey", renderJourneyRows(serviceRows) + '<p>' + formatNumber(service.bookingRequests) + ' booking requests were recorded in this period; ' + formatNumber(service.linkedBookingSessions) + ' have a session that can be linked to storefront activity. Unlinked requests are not assigned to a visit.</p>');
    html += detailBlock("Data coverage", '<p>StoreNest records storefront visits, product or service views, cart additions, checkout starts, order sessions and booking requests. No historical events are reconstructed. Anonymous activity cannot be linked to a named customer.</p>');
    element("customerDetailPanel").innerHTML = html;
  }

  function allTimePurchaserMetrics(model) {
    let buyers = 0, returning = 0;
    for (const group of model.customers.values()) {
      const count = group.orders.filter(row => engine.qualifyingPurchase(row)).length;
      if (count) buyers++;
      if (count > 1) returning++;
    }
    return { buyers, returning, rate: buyers ? returning / buyers * 100 : null };
  }

  function renderRetentionDetail(model) {
    const allTime = allTimePurchaserMetrics(model);
    const intervals = engine.purchaseIntervals(model);
    const cohorts = engine.cohortRetention(model);
    let html = detailHeader("Customer Retention", "Repeat purchasing patterns and how long returning customers usually take between orders.");
    html += '<div class="customer-detail-grid">' +
      statCard("All-time repeat buyers", formatNumber(allTime.returning), "Identified customers with more than one completed order") +
      statCard("All-time repeat rate", formatPercent(allTime.rate), allTime.returning + " of " + allTime.buyers + " identified purchasers") +
      statCard("Median repeat interval", intervals ? formatNumber(intervals.medianDays) + " days" : "—", intervals ? intervals.intervals + " observed order intervals" : "Not enough repeat history") +
      '</div>';
    const mature = cohorts.filter(row => row.mature && row.customers >= 5);
    let cohortBody;
    if (!mature.length) cohortBody = '<div class="customer-empty"><strong>Not enough history for cohort retention</strong><p>A cohort needs at least five identified purchasers and a full 30 days of history before StoreNest reports a 30-day repeat rate.</p></div>';
    else cohortBody = '<div class="customer-table-wrap"><table class="customer-table"><thead><tr><th>Cohort</th><th>Customers</th><th>Repeat within 30 days</th><th>Rate</th></tr></thead><tbody>' + mature.map(row => '<tr><td>' + escapeHtml(row.key) + '</td><td>' + formatNumber(row.customers) + '</td><td>' + formatNumber(row.repeatedWithin30Days) + '</td><td>' + formatPercent(row.repeatRate) + '</td></tr>').join("") + '</tbody></table></div>';
    html += detailBlock("30-day repeat purchasing by first purchase month", cohortBody);
    html += detailBlock("How to interpret retention", '<p>A customer is classified as returning after a second completed, non-refunded order. StoreNest does not mark a customer as lost based only on time since their last purchase. Cohort rates are shown only when both the cohort size and history are sufficient.</p>');
    element("customerDetailPanel").innerHTML = html;
  }

  function renderInsightsDetail(model) {
    let html = detailHeader("Customer Insights", "Evidence-based findings for the selected business and date range.");
    html += '<div class="customer-panel customer-insights-panel"><div id="customerAllInsights" class="customer-insights-list"></div></div>';
    element("customerDetailPanel").innerHTML = html;
    renderInsightItems(model.insights, element("customerAllInsights"), true);
  }

  function renderTopCustomersDetail(model) {
    let html = detailHeader("Top Customers", "Search and sort identified purchasers from the selected period. Paid spend includes only orders marked paid.");
    html += '<div class="customer-panel customer-top-panel"><div class="customer-table-tools"><label class="customer-search"><span aria-hidden="true">⌕</span><input id="customerAllSearch" type="search" placeholder="Search customers…" autocomplete="off" aria-label="Search all customers" value="' + escapeHtml(state.search) + '"></label><span id="customerAllCount" class="customer-table-count"></span></div><div class="customer-table-wrap"><table class="customer-table"><thead><tr><th><button type="button" data-customer-sort="name">Customer</button></th><th><button type="button" data-customer-sort="orders">Orders</button></th><th><button type="button" data-customer-sort="paidSpend" title="Only orders marked paid are included">Total Spent</button></th><th><button type="button" data-customer-sort="lastPurchase">Last Purchase</button></th><th>Status</th><th></th></tr></thead><tbody id="customerAllBody"></tbody></table></div><p class="customer-data-note">Names come from order or booking records. Account contact details are used only in memory to group duplicates and are not displayed here.</p></div>';
    element("customerDetailPanel").innerHTML = html;
    renderCustomerRows(model, element("customerAllBody"), element("customerAllCount"));
  }

  function orderLineText(model, order) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return "Item details were not saved for this order.";
    return items.map(line => {
      const item = model.itemMap.get(String(line.item_id || line.itemId || line.id || ""));
      const name = line.name || line.item_name || line.product_name || line.title || item && item.name || "Product or service";
      const quantity = Math.max(1, Number(line.quantity) || 1);
      return quantity + " × " + name;
    }).join("; ");
  }

  function renderCustomerDetail(model) {
    const customer = model.customers.get(state.selectedCustomerKey);
    if (!customer) {
      state.detailView = "top-customers";
      renderTopCustomersDetail(model);
      return;
    }
    const orders = customer.orders.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const bookings = customer.bookings.slice().sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
    const paid = orders.filter(row => engine.paidPurchase(row));
    const paidTotal = paid.reduce((sum, row) => sum + row.subtotal, 0);
    const completedCount = orders.filter(row => engine.qualifyingPurchase(row)).length;
    let html = detailHeader(customer.name, "Business-specific order and booking history. Contact details are not shown in this view.");
    html += '<div class="customer-detail-grid">' +
      statCard("Completed orders", formatNumber(completedCount), "Non-refunded orders on record") +
      statCard("Paid total", formatMoney(paidTotal), paid.length + " orders with payment status marked paid") +
      statCard("Booking requests", formatNumber(bookings.length), "Requests recorded for this business") +
      '</div>';
    let history = "";
    if (!orders.length && !bookings.length) history = '<div class="customer-empty"><strong>No purchase or booking history</strong><p>Business activity will appear here when a record is available.</p></div>';
    else {
      history = '<div class="customer-progress-list">' + orders.map(order => '<div class="customer-analysis-item"><strong>Order · ' + escapeHtml(formatDate(order.created_at)) + ' · ' + escapeHtml(order.status || "Status not recorded") + '</strong><span>' + escapeHtml(orderLineText(model, order)) + '</span><span>' + (engine.paidPurchase(order) ? 'Paid total: ' + escapeHtml(formatMoney(order.subtotal)) : 'Order value not counted as confirmed paid spend · payment: ' + escapeHtml(order.payment_status || "not recorded")) + '</span></div>').join("") + bookings.map(booking => '<div class="customer-analysis-item"><strong>Booking request · ' + escapeHtml(formatDate(booking.created_at)) + ' · ' + escapeHtml(booking.status || "Status not recorded") + '</strong><span>' + escapeHtml(model.itemMap.get(booking.item_id)?.name || "Service or booking request") + '</span></div>').join("") + '</div>';
    }
    html += detailBlock("Recorded business history", history);
    html += detailBlock("Storefront activity", '<p>Current visit and product-view events are session-level and cannot be matched to this customer’s identity in the records available to the business. Aggregate anonymous activity is available under Customer Behaviour.</p>');
    element("customerDetailPanel").innerHTML = html;
  }

  function renderDetailView(model, view) {
    const panel = element("customerDetailPanel");
    if (!panel) return;
    if (view === "overview") renderOverviewDetail(model);
    else if (view === "behaviour") renderBehaviourDetail(model);
    else if (view === "preferences") renderPreferencesDetail(model);
    else if (view === "habits") renderHabitsDetail(model);
    else if (view === "journey") renderJourneyDetail(model);
    else if (view === "retention") renderRetentionDetail(model);
    else if (view === "insights") renderInsightsDetail(model);
    else if (view === "top-customers") renderTopCustomersDetail(model);
    else if (view === "customer") renderCustomerDetail(model);
    else {
      state.detailView = "";
      setHidden("customerDetailPanel", true);
      setHidden("customerMain", false);
    }
  }

  function openDetail(view) {
    if (!state.model) return;
    state.previousDetail = state.detailView;
    state.detailView = view;
    state.selectedCustomerKey = "";
    render();
  }

  function openCustomer(key) {
    if (!state.model || !state.model.customers.has(key)) return;
    state.previousDetail = state.detailView;
    state.detailView = "customer";
    state.selectedCustomerKey = key;
    render();
  }

  function setClient(client) {
    if (!client) return;
    if (state.client === client) return;
    if (state.authSubscription && typeof state.authSubscription.unsubscribe === "function") state.authSubscription.unsubscribe();
    state.client = client;
    if (client.auth && typeof client.auth.onAuthStateChange === "function") {
      const result = client.auth.onAuthStateChange(event => {
        if (event !== "SIGNED_OUT") return;
        state.requestId++;
        state.client = null;
        state.businessId = "";
        state.businessName = "";
        state.model = null;
        state.detailView = "";
        state.previousDetail = "";
        state.selectedCustomerKey = "";
        showLoading(false);
        resetSummary();
        setHidden("customerMain", true);
        setHidden("customerDetailPanel", true);
        setNotice("", false);
      });
      state.authSubscription = result && result.data && result.data.subscription || result && result.subscription || null;
    }
  }

  function goBack() {
    if (state.detailView === "customer" && state.previousDetail) {
      state.detailView = state.previousDetail;
      state.previousDetail = "";
    } else {
      state.detailView = "";
      state.previousDetail = "";
      state.selectedCustomerKey = "";
    }
    render();
  }

  function bindEvents() {
    element("customerDateRange")?.addEventListener("change", () => {
      const custom = element("customerDateRange").value === "custom";
      setHidden("customerCustomRange", !custom);
      if (!custom) refresh();
    });
    ["customerCustomStart", "customerCustomEnd"].forEach(id => element(id)?.addEventListener("change", () => {
      if (element("customerDateRange")?.value === "custom" && element("customerCustomStart")?.value && element("customerCustomEnd")?.value) refresh();
    }));
    element("customerRefresh")?.addEventListener("click", refresh);
    element("customerTopSearch")?.addEventListener("input", event => { state.search = event.target.value || ""; if (state.model) renderCustomerRows(state.model, element("customerTopBody"), element("customerTableCount"), 5); });
    document.addEventListener("input", event => {
      if (event.target.id === "customerAllSearch") {
        state.search = event.target.value || "";
        if (state.model && state.detailView === "top-customers") renderCustomerRows(state.model, element("customerAllBody"), element("customerAllCount"));
      }
    });
    element("customerDashboard")?.addEventListener("click", event => {
      const metric = event.target.closest("[data-customer-metric]");
      if (metric) {
        state.metric = metric.dataset.customerMetric;
        document.querySelectorAll("[data-customer-metric]").forEach(button => {
          const active = button === metric;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        if (state.model) renderMainChart(state.model);
        return;
      }
      const sort = event.target.closest("[data-customer-sort]");
      if (sort) {
        if (state.sortBy === sort.dataset.customerSort) state.sortDirection *= -1;
        else { state.sortBy = sort.dataset.customerSort; state.sortDirection = -1; }
        if (state.model) {
          renderCustomerRows(state.model, element("customerTopBody"), element("customerTableCount"), 5);
          if (state.detailView === "top-customers") renderCustomerRows(state.model, element("customerAllBody"), element("customerAllCount"));
        }
        return;
      }
      const customer = event.target.closest("[data-customer-detail]");
      if (customer) { openCustomer(customer.dataset.customerDetail); return; }
      const view = event.target.closest("[data-customer-view]");
      if (view) { openDetail(view.dataset.customerView); return; }
      const action = event.target.closest("[data-customer-action]");
      if (!action) return;
      if (action.dataset.customerAction === "all-insights") openDetail("insights");
      else if (action.dataset.customerAction === "top-customers") openDetail("top-customers");
      else if (action.dataset.customerAction === "back") goBack();
    });
    document.addEventListener("click", event => {
      const button = event.target.closest('[data-section="customers"]');
      if (button) window.setTimeout(() => { if (element("customerDashboard") && !element("customerDashboard").hidden) refresh(); }, 0);
    });
    window.addEventListener("storenest:business-client-ready", event => {
      setClient(event.detail?.client || window.StoreNestBusinessClient || null);
      if (state.businessId && !element("customerDashboard").hidden) refresh();
    });
    window.addEventListener("storenest:owner-business-ready", event => {
      const nextId = String(event.detail?.businessId || element("businessSelect")?.value || "");
      const changed = nextId !== state.businessId;
      state.businessId = nextId;
      state.businessName = String(event.detail?.businessName || "");
      if (changed) {
        state.model = null;
        state.detailView = "";
        state.previousDetail = "";
        state.selectedCustomerKey = "";
        resetSummary();
      }
      if (!element("customerDashboard").hidden) refresh();
    });
    ["storenest:owner-orders-updated", "storenest:owner-bookings-updated", "storenest:owner-booking-updated"].forEach(name => window.addEventListener(name, event => {
      if (!event.detail?.businessId || String(event.detail.businessId) === state.businessId) {
        if (element("customerDashboard") && !element("customerDashboard").hidden) refresh();
      }
    }));
  }

  function initialize() {
    const today = new Date();
    const todayValue = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
    element("customerCustomStart")?.setAttribute("max", todayValue);
    element("customerCustomEnd")?.setAttribute("max", todayValue);
    setClient(window.StoreNestBusinessClient || null);
    state.businessId = String(element("businessSelect")?.value || "");
    bindEvents();
  }

  initialize();
  window.StoreNestCustomerDashboard = Object.freeze({ refresh, openDetail, openCustomer });
})();
