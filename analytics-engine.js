(function (root) {
  "use strict";

  const DAY = 86400000;
  const PERIODS = Object.freeze({
    today: "Today",
    last7: "Last 7 days",
    last30: "Last 30 days",
    month: "This month",
    last90: "Last 90 days",
    custom: "Custom range"
  });

  function localDate(value) {
    const date = value instanceof Date ? value : new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, count) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
  }

  function dayKey(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function parseDateInput(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
  }

  function dateRange(period, custom, now) {
    const today = localDate(now || new Date());
    if (!today) return null;
    let start;
    let end;
    if (period === "today") {
      start = today;
      end = addDays(today, 1);
    } else if (period === "last7" || period === "last30" || period === "last90") {
      const count = period === "last7" ? 7 : period === "last30" ? 30 : 90;
      start = addDays(today, -(count - 1));
      end = addDays(today, 1);
    } else if (period === "month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = addDays(today, 1);
    } else if (period === "custom") {
      start = parseDateInput(custom && custom.start);
      const last = parseDateInput(custom && custom.end);
      if (!start || !last || last < start) return null;
      end = addDays(last, 1);
    } else {
      return dateRange("last30", custom, today);
    }

    const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
    return {
      start,
      end,
      previousStart: addDays(start, -duration),
      previousEnd: start,
      duration,
      label: PERIODS[period] || PERIODS.last30
    };
  }

  function normalizeOrder(row) {
    if (!row || typeof row !== "object" || !row.id) return null;
    const subtotal = Number(row.subtotal);
    let items = row.items;
    if (typeof items === "string") {
      try { items = JSON.parse(items); } catch (_) { items = []; }
    }
    return {
      id: String(row.id),
      business_id: String(row.business_id || ""),
      status: String(row.status || "").toLowerCase(),
      payment_status: String(row.payment_status || "").toLowerCase(),
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      created_at: String(row.created_at || ""),
      customer_user_id: row.customer_user_id ? String(row.customer_user_id) : "",
      analytics_session_id: row.analytics_session_id ? String(row.analytics_session_id) : "",
      items: Array.isArray(items) ? items : []
    };
  }

  function normalizeEvent(row) {
    if (!row || typeof row !== "object") return null;
    return {
      business_id: String(row.business_id || ""),
      event_type: String(row.event_type || ""),
      session_id: String(row.session_id || ""),
      item_id: row.item_id ? String(row.item_id) : "",
      occurred_at: String(row.occurred_at || "")
    };
  }

  function isWithin(value, start, end) {
    const date = localDate(value);
    return Boolean(date && date >= start && date < end);
  }

  function uniqueSessions(rows) {
    return new Set(rows.map(row => row.session_id).filter(Boolean));
  }

  function visitRows(events, start, end) {
    return events.filter(row => row.event_type === "store_visit" && isWithin(row.occurred_at, start, end));
  }

  function completedPurchase(order) {
    return order.status === "completed" && order.payment_status !== "refunded";
  }

  function orderRows(orders, start, end) {
    return orders.filter(row => isWithin(row.created_at, start, end));
  }

  function customerSummary(rangeOrders, allOrders, periodStart) {
    const buyers = new Set(rangeOrders.filter(completedPurchase).map(row => row.customer_user_id).filter(Boolean));
    const priorBuyers = new Set(allOrders
      .filter(row => row.customer_user_id && completedPurchase(row) && isWithin(row.created_at, new Date(0), periodStart))
      .map(row => row.customer_user_id));
    const returning = new Set([...buyers].filter(id => priorBuyers.has(id)));
    return {
      identifiedBuyers: buyers.size,
      returningBuyers: returning.size,
      newBuyers: Math.max(0, buyers.size - returning.size),
      returningRate: buyers.size >= 5 ? returning.size / buyers.size * 100 : null
    };
  }

  function buildSnapshot(input) {
    const options = input || {};
    const range = dateRange(options.period || "last30", options.custom, options.now || new Date());
    const businessId = String(options.businessId || "");
    const orders = (Array.isArray(options.orders) ? options.orders : []).map(normalizeOrder).filter(Boolean)
      .filter(row => !businessId || row.business_id === businessId);
    const events = (Array.isArray(options.events) ? options.events : []).map(normalizeEvent).filter(Boolean)
      .filter(row => !businessId || row.business_id === businessId);
    const items = (Array.isArray(options.items) ? options.items : []).filter(row => !businessId || String(row.business_id || businessId) === businessId);
    const customerHistory = (Array.isArray(options.customerHistory) ? options.customerHistory : orders).map(normalizeOrder).filter(Boolean)
      .filter(row => !businessId || row.business_id === businessId);
    const bookings = (Array.isArray(options.bookings) ? options.bookings : []).map(row => ({
      id: String(row?.id || ""),
      business_id: String(row?.business_id || ""),
      item_id: String(row?.item_id || ""),
      status: String(row?.status || "").toLowerCase(),
      created_at: String(row?.created_at || ""),
      analytics_session_id: row?.analytics_session_id ? String(row.analytics_session_id) : ""
    })).filter(row => row.id && (!businessId || row.business_id === businessId));
    if (!range) return { valid: false, businessId, period: options.period || "last30", orders, events, items };

    const currentOrders = orderRows(orders, range.start, range.end);
    const previousOrders = orderRows(orders, range.previousStart, range.previousEnd);
    const currentBookings = bookings.filter(row => isWithin(row.created_at, range.start, range.end));
    const currentEvents = events.filter(row => isWithin(row.occurred_at, range.start, range.end));
    const previousEvents = events.filter(row => isWithin(row.occurred_at, range.previousStart, range.previousEnd));
    const eventTrackingAvailable = options.eventsAvailable === true;
    const orderAttributionAvailable = options.orderAttributionAvailable !== false;
    const currentVisits = eventTrackingAvailable ? uniqueSessions(visitRows(currentEvents, range.start, range.end)).size : null;
    const previousVisits = eventTrackingAvailable ? uniqueSessions(visitRows(previousEvents, range.previousStart, range.previousEnd)).size : null;

    let conversion = { value: null, reason: eventTrackingAvailable && orderAttributionAvailable ? "insufficient" : "untracked", visits: 0, convertedSessions: 0 };
    let previousConversion = { value: null, reason: eventTrackingAvailable && orderAttributionAvailable ? "insufficient" : "untracked", visits: 0, convertedSessions: 0 };
    if (eventTrackingAvailable && orderAttributionAvailable) {
      const currentSessionIds = uniqueSessions(visitRows(currentEvents, range.start, range.end));
      const previousSessionIds = uniqueSessions(visitRows(previousEvents, range.previousStart, range.previousEnd));
      const currentConverted = new Set(currentOrders.map(row => row.analytics_session_id).filter(id => id && currentSessionIds.has(id)));
      const previousConverted = new Set(previousOrders.map(row => row.analytics_session_id).filter(id => id && previousSessionIds.has(id)));
      conversion = {
        value: currentSessionIds.size >= 10 ? currentConverted.size / currentSessionIds.size * 100 : null,
        reason: currentSessionIds.size >= 10 ? "available" : "insufficient",
        visits: currentSessionIds.size,
        convertedSessions: currentConverted.size
      };
      previousConversion = {
        value: previousSessionIds.size >= 10 ? previousConverted.size / previousSessionIds.size * 100 : null,
        reason: previousSessionIds.size >= 10 ? "available" : "insufficient",
        visits: previousSessionIds.size,
        convertedSessions: previousConverted.size
      };
    }

    const customers = customerSummary(currentOrders, customerHistory, range.start);
    const previousCustomers = customerSummary(previousOrders, customerHistory, range.previousStart);
    const cancelledOrders = currentOrders.filter(row => row.status === "cancelled");
    const previousCancelledOrders = previousOrders.filter(row => row.status === "cancelled");
    const currentVisitSessions = new Set(visitRows(currentEvents, range.start, range.end).map(row => row.session_id).filter(Boolean));
    const previousVisitSessions = new Set(visitRows(previousEvents, range.previousStart, range.previousEnd).map(row => row.session_id).filter(Boolean));

    const productViews = new Map();
    for (const event of currentEvents) {
      if (event.event_type !== "product_view" || !event.item_id || !event.session_id) continue;
      if (!productViews.has(event.item_id)) productViews.set(event.item_id, new Set());
      productViews.get(event.item_id).add(event.session_id);
    }
    const productPurchases = new Map();
    const productOrderSessions = new Map();
    const serviceBookingRequests = new Map();
    const serviceBookingSessions = new Map();
    for (const order of currentOrders) {
      for (const item of order.items) {
        const itemId = String(item.item_id || item.itemId || item.id || "");
        const quantity = Math.max(0, Number(item.quantity) || 0);
        if (!itemId) continue;
        if (order.analytics_session_id) {
          if (!productOrderSessions.has(itemId)) productOrderSessions.set(itemId, new Set());
          productOrderSessions.get(itemId).add(order.analytics_session_id);
        }
        if (completedPurchase(order)) {
          productPurchases.set(itemId, (productPurchases.get(itemId) || 0) + quantity);
        }
      }
    }
    for (const booking of currentBookings) {
      if (!booking.item_id) continue;
      serviceBookingRequests.set(booking.item_id, (serviceBookingRequests.get(booking.item_id) || 0) + 1);
      if (!booking.analytics_session_id) continue;
      if (!serviceBookingSessions.has(booking.item_id)) serviceBookingSessions.set(booking.item_id, new Set());
      serviceBookingSessions.get(booking.item_id).add(booking.analytics_session_id);
    }

    return {
      valid: true,
      businessId,
      period: options.period || "last30",
      range,
      orders,
      events,
      items,
      bookings,
      currentBookings,
      currentOrders,
      previousOrders,
      currentEvents,
      previousEvents,
      eventTrackingAvailable,
      orderAttributionAvailable,
      bookingAttributionAvailable: options.bookingAttributionAvailable !== false,
      customerHistory,
      visits: currentVisits,
      previousVisits,
      ordersPlaced: currentOrders.length,
      previousOrdersPlaced: previousOrders.length,
      conversion,
      previousConversion,
      customers,
      previousCustomers,
      cancelledCount: cancelledOrders.length,
      previousCancelledCount: previousCancelledOrders.length,
      cancellationRate: currentOrders.length ? cancelledOrders.length / currentOrders.length * 100 : null,
      previousCancellationRate: previousOrders.length ? previousCancelledOrders.length / previousOrders.length * 100 : null,
      currentVisitSessions,
      previousVisitSessions,
      productViews,
      productPurchases,
      productOrderSessions,
      serviceBookingRequests,
      serviceBookingSessions
    };
  }

  function percentageChange(current, previous) {
    if (current == null || previous == null) return { value: null, label: "Not available" };
    if (previous === 0) return current === 0 ? { value: 0, label: "No change" } : { value: null, label: "New" };
    const value = (current - previous) / Math.abs(previous) * 100;
    return { value, label: (value > 0 ? "+" : "") + value.toFixed(1) + "%" };
  }

  function makeBuckets(range) {
    if (!range) return [];
    const step = range.duration <= 31 ? 1 : 7;
    const buckets = [];
    for (let start = range.start; start < range.end;) {
      const end = addDays(start, Math.min(step, Math.ceil((range.end - start) / DAY)));
      buckets.push({ start, end, label: new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" }).format(start) });
      start = end;
    }
    return buckets;
  }

  function buildSeries(snapshot, metric) {
    if (!snapshot || !snapshot.valid) return [];
    const buckets = makeBuckets(snapshot.range);
    return buckets.map(bucket => {
      const orders = orderRows(snapshot.orders, bucket.start, bucket.end);
      const events = snapshot.events.filter(row => isWithin(row.occurred_at, bucket.start, bucket.end));
      const visits = snapshot.eventTrackingAvailable ? uniqueSessions(visitRows(events, bucket.start, bucket.end)) : null;
      let value = null;
      if (metric === "orders") value = orders.length;
      if (metric === "visits") value = visits ? visits.size : null;
      if (metric === "product_views") {
        if (snapshot.eventTrackingAvailable) {
          const itemSessions = new Set(events
            .filter(row => row.event_type === "product_view" && row.item_id && row.session_id)
            .map(row => String(row.item_id) + "\u0000" + String(row.session_id)));
          value = itemSessions.size;
        }
      }
      if (metric === "bookings") {
        value = (snapshot.bookings || []).filter(row => isWithin(row.created_at, bucket.start, bucket.end)).length;
      }
      if (metric === "conversion") {
        if (snapshot.orderAttributionAvailable && visits && visits.size >= 1) {
          const converted = new Set(orders.map(row => row.analytics_session_id).filter(id => id && visits.has(id)));
          value = converted.size / visits.size * 100;
        }
      }
      if (metric === "returning") {
        const customers = customerSummary(orders, snapshot.customerHistory || snapshot.orders, bucket.start);
        value = customers.returningBuyers;
      }
      return { start: bucket.start, end: bucket.end, label: bucket.label, value, sampleSize: visits ? visits.size : 0 };
    });
  }

  function buildInsights(snapshot, states, now) {
    if (!snapshot || !snapshot.valid) return [];
    const output = [];
    const stateMap = states && typeof states === "object" ? states : {};
    const detectedAt = (now instanceof Date ? now : new Date()).toISOString();
    const rangeStart = dayKey(snapshot.range.start);
    const rangeEnd = dayKey(addDays(snapshot.range.end, -1));

    function add(insight) {
      const saved = stateMap[insight.key] || {};
      const isStaleDismissal = saved.status === "dismissed" && saved.updated_at && (Date.parse(detectedAt) - Date.parse(saved.updated_at) > 30 * DAY);
      if (isStaleDismissal) saved.status = "new";
      insight.status = saved.status || "new";
      insight.statusUpdatedAt = saved.updated_at || null;
      insight.actedAt = saved.acted_at || null;
      insight.detectedAt = detectedAt;
      insight.observation = { start: rangeStart, end: rangeEnd, period: snapshot.period };
      output.push(insight);
    }

    const visitDelta = percentageChange(snapshot.visits, snapshot.previousVisits);
    if (snapshot.eventTrackingAvailable && snapshot.visits >= 20 && snapshot.previousVisits >= 20 && Math.abs(visitDelta.value || 0) >= 20) {
      const rising = visitDelta.value > 0;
      add({
        key: "traffic-change",
        type: "traffic_change",
        title: rising ? "Store sessions increased" : "Store sessions decreased",
        explanation: "StoreNest recorded " + Math.round(snapshot.visits).toLocaleString("en-ZA") + " storefront sessions in this period, compared with " + Math.round(snapshot.previousVisits).toLocaleString("en-ZA") + " in the preceding period.",
        interpretation: "This shows a change in traffic. The current storefront tracking does not identify where visitors came from or why the count changed.",
        recommendation: rising ? "Compare the change in sessions with orders and customer questions, then keep the storefront information and availability accurate." : "Check whether your storefront is published, its link is easy to find, and your current products or services are available.",
        priority: "medium",
        evidence: [{ label: "Current sessions", value: snapshot.visits }, { label: "Previous sessions", value: snapshot.previousVisits }, { label: "Change", value: visitDelta.label }],
        metric: "visits"
      });
    }

    const orderDelta = percentageChange(snapshot.ordersPlaced, snapshot.previousOrdersPlaced);
    if (snapshot.currentOrders.length >= 5 && snapshot.previousOrders.length >= 5 && Math.abs(orderDelta.value || 0) >= 30) {
      add({
        key: "order-volume-change",
        type: "order_volume_change",
        title: "Order volume changed",
        explanation: "Orders placed changed from " + snapshot.previousOrdersPlaced + " to " + snapshot.ordersPlaced + " across the two equal-length periods. This count includes orders later marked cancelled.",
        interpretation: "Order volume describes submitted orders, not confirmed payments or completed fulfilment.",
        recommendation: "Review order outcomes and cancellation counts before deciding whether the change needs a staffing, stock or process adjustment.",
        priority: "medium",
        evidence: [{ label: "Current orders placed", value: snapshot.ordersPlaced }, { label: "Previous orders placed", value: snapshot.previousOrdersPlaced }, { label: "Change", value: orderDelta.label }],
        metric: "orders"
      });
    }

    if (snapshot.eventTrackingAvailable) {
      for (const item of snapshot.items) {
        const itemId = String(item.id || "");
        const viewers = snapshot.productViews.get(itemId);
        const sessions = viewers ? viewers.size : 0;
        if (!itemId || sessions < 15) continue;
        const isService = String(item.item_type || "").toLowerCase() === "service";
        if (isService && !snapshot.bookingAttributionAvailable) continue;
        if (!isService && !snapshot.orderAttributionAvailable) continue;
        const purchasers = (isService ? snapshot.serviceBookingSessions : snapshot.productOrderSessions).get(itemId) || new Set();
        const converted = new Set([...purchasers].filter(id => viewers.has(id))).size;
        const rate = converted / sessions * 100;
        if (rate > 5) continue;
        add({
          key: (isService ? "service-view-booking-rate:" : "product-view-order-rate:") + itemId,
          type: isService ? "service_view_booking_rate" : "product_view_order_rate",
          itemId,
          service: isService,
          title: isService
            ? "Many sessions viewed “" + String(item.name || "this service") + "” without sending a booking request"
            : "Many sessions viewed “" + String(item.name || "this item") + "” without ordering it",
          explanation: sessions + " tracked sessions opened this " + (isService ? "service. " + converted + " of those sessions sent a booking request during the same session." : "item. " + converted + " of those sessions placed an order containing it during the same session."),
          interpretation: "This is a same-session view-to-" + (isService ? "booking-request" : "order") + " comparison. It does not reveal why customers did not continue.",
          recommendation: isService
            ? "Review the service description, photos, availability and booking questions. Make the next step and expected response clear; StoreNest does not yet measure response time."
            : "Review the item’s price, description, photos and availability. If these look correct, observe more sessions before making a change.",
          priority: "medium",
          evidence: [{ label: "Unique view sessions", value: sessions }, { label: isService ? "Same-session booking requests" : "Same-session orders", value: converted }, { label: isService ? "View-to-booking rate" : "View-to-order rate", value: rate.toFixed(1) + "%" }],
          metric: "product",
          viewSessions: sessions,
          convertedSessions: converted
        });
      }
    }

    const cancellationRate = snapshot.cancellationRate;
    const priorCancellationRate = snapshot.previousCancellationRate;
    if (snapshot.currentOrders.length >= 5 && cancellationRate >= 20 && (priorCancellationRate == null || cancellationRate - priorCancellationRate >= 10)) {
      add({
        key: "cancellations-increased",
        type: "cancellation_rate",
        title: "A notable share of orders were cancelled",
        explanation: snapshot.cancelledCount + " of " + snapshot.ordersPlaced + " orders in this period are currently marked cancelled (" + cancellationRate.toFixed(1) + "%).",
        interpretation: "The order record does not store a cancellation reason, so StoreNest cannot identify the cause.",
        recommendation: "Review the cancelled orders and note their reasons. Check whether availability, customer expectations or fulfilment timing are recurring factors.",
        priority: "high",
        evidence: [{ label: "Cancelled orders", value: snapshot.cancelledCount }, { label: "Orders placed", value: snapshot.ordersPlaced }, { label: "Cancellation share", value: cancellationRate.toFixed(1) + "%" }, { label: "Previous period", value: priorCancellationRate == null ? "No comparable sample" : priorCancellationRate.toFixed(1) + "%" }],
        metric: "operations"
      });
    }

    const buyerDelta = snapshot.customers.returningRate == null || snapshot.previousCustomers.returningRate == null
      ? null
      : snapshot.customers.returningRate - snapshot.previousCustomers.returningRate;
    if (buyerDelta != null && snapshot.customers.identifiedBuyers >= 5 && snapshot.previousCustomers.identifiedBuyers >= 5 && buyerDelta <= -10) {
      add({
        key: "returning-customer-decline",
        type: "returning_customer_decline",
        title: "Fewer identified customers are returning",
        explanation: "The returning-customer share among identified purchasers moved from " + snapshot.previousCustomers.returningRate.toFixed(1) + "% to " + snapshot.customers.returningRate.toFixed(1) + "%.",
        interpretation: "This calculation uses completed, non-refunded orders linked to signed-in customer accounts. Guest orders are excluded.",
        recommendation: "Review recent customer feedback and product availability. Consider a useful follow-up or repeat-purchase offer that fits your business.",
        priority: "medium",
        evidence: [{ label: "Current returning share", value: snapshot.customers.returningRate.toFixed(1) + "%" }, { label: "Previous returning share", value: snapshot.previousCustomers.returningRate.toFixed(1) + "%" }, { label: "Difference", value: buyerDelta.toFixed(1) + " pp" }, { label: "Identified purchasers", value: snapshot.customers.identifiedBuyers }],
        metric: "customers"
      });
    }

    if (snapshot.range.duration >= 28 && snapshot.currentOrders.filter(row => row.status !== "cancelled").length >= 20) {
      const dayCounts = Array(7).fill(0);
      const dayObservations = Array(7).fill(0);
      for (let day = snapshot.range.start; day < snapshot.range.end; day = addDays(day, 1)) dayObservations[day.getDay()]++;
      for (const order of snapshot.currentOrders) {
        if (order.status === "cancelled") continue;
        const date = localDate(order.created_at);
        if (date) dayCounts[date.getDay()]++;
      }
      const candidates = dayCounts.map((count, index) => ({ count, index, average: dayObservations[index] ? count / dayObservations[index] : 0 }))
        .filter(row => dayObservations[row.index] >= 4 && row.count >= 5);
      const average = snapshot.currentOrders.filter(row => row.status !== "cancelled").length / snapshot.range.duration;
      const peak = candidates.sort((a, b) => b.average - a.average)[0];
      if (peak && average > 0 && peak.average >= average * 1.6) {
        const dayName = new Intl.DateTimeFormat("en-ZA", { weekday: "long" }).format(new Date(2026, 0, 4 + peak.index));
        add({
          key: "weekday-demand-pattern:" + peak.index,
          type: "weekday_demand_pattern",
          title: "More orders tend to arrive on " + dayName,
          explanation: "Across the selected period, " + dayName + " averaged " + peak.average.toFixed(1) + " non-cancelled orders per day, compared with " + average.toFixed(1) + " per day overall.",
          interpretation: "This is a historical pattern in order creation dates. It may help with preparation but does not guarantee future demand.",
          recommendation: "Check stock, availability and order-handling coverage before the next " + dayName + ".",
          priority: "low",
          evidence: [{ label: dayName + " average", value: peak.average.toFixed(1) + " orders/day" }, { label: "Period average", value: average.toFixed(1) + " orders/day" }, { label: "Order history", value: snapshot.currentOrders.filter(row => row.status !== "cancelled").length + " non-cancelled orders" }],
          metric: "orders"
        });
      }
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return output.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.title.localeCompare(b.title));
  }

  function followUp(snapshot, insight, actedAt, now) {
    const start = new Date(actedAt || "");
    const current = now instanceof Date ? now : new Date(now || Date.now());
    if (!snapshot || !snapshot.valid || Number.isNaN(start.getTime())) return { available: false, reason: "missing_action_date" };
    const actionDay = localDate(start);
    const beforeStart = addDays(actionDay, -7);
    const beforeEnd = actionDay;
    const afterStart = addDays(actionDay, 1);
    const afterEnd = addDays(actionDay, 8);
    if (localDate(current) < afterEnd) return { available: false, reason: "wait", remainingDays: Math.max(1, Math.ceil((afterEnd - localDate(current)) / DAY)) };
    if (insight.metric === "visits") {
      const before = uniqueSessions(visitRows(snapshot.events, beforeStart, beforeEnd)).size;
      const after = uniqueSessions(visitRows(snapshot.events, afterStart, afterEnd)).size;
      return { available: true, before, after, change: percentageChange(after, before), message: "Sessions in the seven full days after the action are compared with the seven full days before it. This comparison does not prove the action caused the change." };
    }
    if (insight.metric === "orders") {
      const before = orderRows(snapshot.orders, beforeStart, beforeEnd).filter(row => row.status !== "cancelled").length;
      const after = orderRows(snapshot.orders, afterStart, afterEnd).filter(row => row.status !== "cancelled").length;
      return { available: true, before, after, change: percentageChange(after, before), message: "Non-cancelled orders created in the seven full days after the action are compared with the seven full days before it. This comparison does not prove the action caused the change." };
    }
    if (insight.metric === "operations") {
      const beforeRows = orderRows(snapshot.orders, beforeStart, beforeEnd);
      const afterRows = orderRows(snapshot.orders, afterStart, afterEnd);
      const before = beforeRows.length ? beforeRows.filter(row => row.status === "cancelled").length / beforeRows.length * 100 : null;
      const after = afterRows.length ? afterRows.filter(row => row.status === "cancelled").length / afterRows.length * 100 : null;
      return { available: true, before, after, change: before == null || after == null ? null : { value: after - before, label: (after - before > 0 ? "+" : "") + (after - before).toFixed(1) + " pp" }, message: "The share of orders created in each seven-day window that are currently marked cancelled is compared. Status-change timestamps are not stored, and this comparison does not prove the action caused the change." };
    }
    if (insight.metric === "product" && insight.itemId && snapshot.eventTrackingAvailable && (insight.service ? snapshot.bookingAttributionAvailable : snapshot.orderAttributionAvailable)) {
      const productWindow = (windowStart, windowEnd) => {
        const views = uniqueSessions(snapshot.events.filter(row => row.event_type === "product_view" && row.item_id === String(insight.itemId) && isWithin(row.occurred_at, windowStart, windowEnd)));
        const convertedSessions = insight.service
          ? new Set(snapshot.bookings.filter(row => row.item_id === String(insight.itemId) && row.analytics_session_id && isWithin(row.created_at, windowStart, windowEnd)).map(row => row.analytics_session_id).filter(id => views.has(id)))
          : new Set(snapshot.orders.filter(row => isWithin(row.created_at, windowStart, windowEnd) && row.analytics_session_id && row.items.some(item => String(item.item_id || item.itemId || item.id || "") === String(insight.itemId))).map(row => row.analytics_session_id).filter(id => views.has(id)));
        return { visits: views.size, converted: convertedSessions.size, rate: views.size ? convertedSessions.size / views.size * 100 : null };
      };
      const before = productWindow(beforeStart, beforeEnd);
      const after = productWindow(afterStart, afterEnd);
      if (before.visits < 10 || after.visits < 10) return { available: false, reason: "insufficient", beforeVisits: before.visits, afterVisits: after.visits };
      const difference = after.rate - before.rate;
      return {
        available: true,
        before: before.rate,
        after: after.rate,
        beforeLabel: before.rate.toFixed(1) + "% (" + before.visits + " view sessions)",
        afterLabel: after.rate.toFixed(1) + "% (" + after.visits + " view sessions)",
        change: { value: difference, label: (difference > 0 ? "+" : "") + difference.toFixed(1) + " pp" },
        message: "Same-session view-to-" + (insight.service ? "booking-request" : "order") + " rates in the seven full days after the action are compared with the seven full days before it. This comparison does not prove the action caused the change."
      };
    }
    return { available: false, reason: "unsupported_metric" };
  }

  const api = Object.freeze({ PERIODS, dateRange, dayKey, normalizeOrder, normalizeEvent, buildSnapshot, percentageChange, buildSeries, buildInsights, followUp, localDate, addDays, completedPurchase });
  root.StoreNestAnalyticsEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
