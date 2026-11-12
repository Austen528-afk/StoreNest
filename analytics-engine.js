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
      updated_at: String(row.updated_at || ""),
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

  function normalizeLifecycleEvent(row) {
    if (!row || typeof row !== "object" || !row.entity_id) return null;
    return {
      business_id: String(row.business_id || ""),
      entity_type: String(row.entity_type || ""),
      entity_id: String(row.entity_id),
      from_status: row.from_status == null ? "" : String(row.from_status).toLowerCase(),
      to_status: String(row.to_status || "").toLowerCase(),
      changed_at: String(row.changed_at || ""),
      actor_id: row.actor_id ? String(row.actor_id) : ""
    };
  }

  function durationSamples(events, entityType, fromStatus, toStatuses, start, end) {
    const byEntity = new Map();
    for (const event of events) {
      if (event.entity_type !== entityType || !event.entity_id) continue;
      if (!byEntity.has(event.entity_id)) byEntity.set(event.entity_id, []);
      byEntity.get(event.entity_id).push(event);
    }
    const samples = [];
    for (const rows of byEntity.values()) {
      rows.sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
      let startedAt = null;
      for (const row of rows) {
        const at = Date.parse(row.changed_at);
        if (!Number.isFinite(at)) continue;
        if (row.to_status === fromStatus) {
          startedAt = at;
          continue;
        }
        if (startedAt != null && toStatuses.includes(row.to_status)) {
          if (at > startedAt && (!start || !end || isWithin(row.changed_at, start, end))) samples.push((at - startedAt) / 3600000);
          startedAt = null;
        }
      }
    }
    return samples;
  }

  function durationSummary(samples) {
    if (!samples.length) return { averageHours: null, medianHours: null, sampleSize: 0 };
    const sorted = samples.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    return {
      averageHours: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      medianHours: median,
      sampleSize: samples.length
    };
  }

  function summarizeOperations(events, range) {
    const inCurrent = (from, to, type) => durationSummary(durationSamples(events, type, from, to, range.start, range.end));
    const inPrevious = (from, to, type) => durationSummary(durationSamples(events, type, from, to, range.previousStart, range.previousEnd));
    return {
      orderAcceptance: { current: inCurrent("new", ["accepted"], "order"), previous: inPrevious("new", ["accepted"], "order") },
      acceptedToPreparation: { current: inCurrent("accepted", ["preparing"], "order"), previous: inPrevious("accepted", ["preparing"], "order") },
      preparation: { current: inCurrent("preparing", ["prepared", "ready", "completed"], "order"), previous: inPrevious("preparing", ["prepared", "ready", "completed"], "order") },
      collection: { current: inCurrent("ready", ["completed"], "order"), previous: inPrevious("ready", ["completed"], "order") },
      orderFulfilment: { current: inCurrent("new", ["completed"], "order"), previous: inPrevious("new", ["completed"], "order") },
      bookingResponse: { current: inCurrent("pending", ["accepted", "declined"], "booking"), previous: inPrevious("pending", ["accepted", "declined"], "booking") },
      bookingCompletion: { current: inCurrent("accepted", ["completed"], "booking"), previous: inPrevious("accepted", ["completed"], "booking") }
    };
  }

  function summarizeMessages(conversations, messages, ownerId, orders, range, available) {
    if (!available || !ownerId) return { available: false, reason: available ? "owner_unavailable" : "not_tracked", incomingMessages: 0, responseSampleSize: 0, averageResponseHours: null, medianResponseHours: null, identifiedConversations: 0, conversationsFollowedByOrder: null };
    const conversationMap = new Map((conversations || []).map(row => [String(row.id), row]));
    const byConversation = new Map();
    for (const message of messages || []) {
      const id = String(message.conversation_id || "");
      if (!id || !conversationMap.has(id)) continue;
      if (!byConversation.has(id)) byConversation.set(id, []);
      byConversation.get(id).push({ sender_id: String(message.sender_id || ""), created_at: String(message.created_at || "") });
    }
    const responseHours = [];
    let incomingMessages = 0;
    let identifiedConversations = 0;
    let conversationsFollowedByOrder = 0;
    const pendingCustomerMessages = [];
    for (const [id, rows] of byConversation) {
      rows.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
      const conversation = conversationMap.get(id);
      let pendingCustomerMessage = null;
      let unansweredInConversation = [];
      let firstInRangeCustomerMessage = null;
      for (const row of rows) {
        const at = Date.parse(row.created_at);
        if (!Number.isFinite(at)) continue;
        if (row.sender_id === String(ownerId)) {
          if (pendingCustomerMessage) {
            if (isWithin(pendingCustomerMessage.created_at, range.start, range.end) && at > Date.parse(pendingCustomerMessage.created_at)) {
              responseHours.push((at - Date.parse(pendingCustomerMessage.created_at)) / 3600000);
            }
            pendingCustomerMessage = null;
            unansweredInConversation = [];
          }
        } else {
          if (isWithin(row.created_at, range.start, range.end)) {
            incomingMessages++;
            if (!firstInRangeCustomerMessage) firstInRangeCustomerMessage = row;
          }
          if (!pendingCustomerMessage) pendingCustomerMessage = row;
          unansweredInConversation.push(row);
        }
      }
      for (const pending of unansweredInConversation) {
        if (isWithin(pending.created_at, range.start, range.end)) pendingCustomerMessages.push(pending.created_at);
      }
      const customerId = String(conversation.customer_id || "");
      if (!customerId || !firstInRangeCustomerMessage) continue;
      identifiedConversations++;
      const messageAt = Date.parse(firstInRangeCustomerMessage.created_at);
      const followed = orders.some(order => order.customer_user_id === customerId && Date.parse(order.created_at) >= messageAt && Date.parse(order.created_at) <= messageAt + 7 * DAY);
      if (followed) conversationsFollowedByOrder++;
    }
    const response = durationSummary(responseHours);
    return {
      available: true,
      reason: "available",
      incomingMessages,
      responseSampleSize: response.sampleSize,
      averageResponseHours: response.averageHours,
      medianResponseHours: response.medianHours,
      unansweredMessages: pendingCustomerMessages.length,
      oldestUnansweredHours: pendingCustomerMessages.length ? pendingCustomerMessages.reduce((oldest, value) => Math.max(oldest, Math.max(0, (Date.now() - Date.parse(value)) / 3600000)), 0) : null,
      identifiedConversations,
      conversationsFollowedByOrder: identifiedConversations ? conversationsFollowedByOrder : null
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

  function bucketCount(rows, getDate, range) {
    const counts = new Map();
    for (const row of rows) {
      const date = getDate(row);
      if (!date || !isWithin(date, range.start, range.end)) continue;
      const key = dayKey(localDate(date));
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function peakOrderPatterns(rows, range) {
    const valid = rows.filter(row => row.status !== "cancelled");
    const days = bucketCount(valid, row => row.created_at, range);
    const weekdayDays = Array(7).fill(0);
    const weekdayOrders = Array(7).fill(0);
    const hourDays = Array(24).fill(0);
    const hourOrders = Array(24).fill(0);
    for (let day = range.start; day < range.end; day = addDays(day, 1)) weekdayDays[day.getDay()]++;
    for (const row of valid) {
      const date = new Date(row.created_at);
      if (Number.isNaN(date.getTime())) continue;
      weekdayOrders[date.getDay()]++;
      hourOrders[date.getHours()]++;
      hourDays[date.getHours()]++;
    }
    const weekdayCandidates = weekdayOrders.map((count, index) => ({ index, count, perDay: weekdayDays[index] ? count / weekdayDays[index] : 0 }))
      .filter(row => weekdayDays[row.index] >= 3 && row.count >= 3)
      .sort((a, b) => b.perDay - a.perDay);
    const uniqueOrderDays = days.size;
    const peakHour = hourOrders.map((count, hour) => ({ hour, count })).sort((a, b) => b.count - a.count)[0];
    return {
      weekday: valid.length >= 10 && weekdayCandidates[0] ? {
        name: new Intl.DateTimeFormat("en-ZA", { weekday: "long" }).format(new Date(2026, 0, 4 + weekdayCandidates[0].index)),
        orders: weekdayCandidates[0].count,
        averagePerDay: weekdayCandidates[0].perDay,
        observedDays: weekdayDays[weekdayCandidates[0].index]
      } : null,
      hour: valid.length >= 15 && uniqueOrderDays >= 5 && peakHour?.count >= 3 ? {
        startHour: peakHour.hour,
        label: String(peakHour.hour).padStart(2, "0") + ":00–" + String((peakHour.hour + 1) % 24).padStart(2, "0") + ":00",
        orders: peakHour.count,
        share: peakHour.count / valid.length * 100,
        observedDays: uniqueOrderDays
      } : null,
      nonCancelledOrders: valid.length,
      observedOrderDays: uniqueOrderDays
    };
  }

  function lifecycleSummary(events, range, trackingStartedAt) {
    const trackedFrom = localDate(trackingStartedAt);
    const available = Boolean(trackedFrom);
    const stages = ["new", "accepted", "preparing", "prepared", "ready", "completed", "cancelled"];
    const stageIds = Object.fromEntries(stages.map(stage => [stage, new Set()]));
    const statusChanges = new Map();
    const cancellationsByPriorStatus = new Map();
    const inRangeEvents = (events || []).filter(row => row.entity_type === "order" && isWithin(row.changed_at, range.start, range.end));
    for (const row of inRangeEvents) {
      if (!stageIds[row.to_status]) continue;
      stageIds[row.to_status].add(row.entity_id);
      statusChanges.set(row.to_status, (statusChanges.get(row.to_status) || 0) + 1);
      if (row.to_status === "cancelled" && row.from_status) {
        if (!cancellationsByPriorStatus.has(row.from_status)) cancellationsByPriorStatus.set(row.from_status, new Set());
        cancellationsByPriorStatus.get(row.from_status).add(row.entity_id);
      }
    }
    const bookingEvents = (events || []).filter(row => row.entity_type === "booking" && isWithin(row.changed_at, range.start, range.end));
    const bookingStatuses = Object.fromEntries(["pending", "accepted", "declined", "completed"].map(status => [status,
      new Set(bookingEvents.filter(row => row.to_status === status).map(row => row.entity_id)).size
    ]));
    return {
      available,
      trackingStartedAt: trackingStartedAt || null,
      trackedFrom,
      events: inRangeEvents,
      stageCounts: Object.fromEntries(stages.map(stage => [stage, stageIds[stage].size])),
      statusChanges: Object.fromEntries(statusChanges),
      cancellationsByPriorStatus: Object.fromEntries([...cancellationsByPriorStatus].map(([status, ids]) => [status, ids.size])),
      bookingStageCounts: bookingStatuses,
      trackedOrders: stageIds.new.size
    };
  }

  function itemType(item) {
    return String(item?.item_type || "product").toLowerCase() === "service" ? "service" : "product";
  }

  function variantCount(item) {
    const groups = Array.isArray(item?.customization_options) ? item.customization_options : [];
    const fashion = Array.isArray(item?.fashion_color_sets) ? item.fashion_color_sets : [];
    const decor = Array.isArray(item?.decor_color_sets) ? item.decor_color_sets : [];
    const countOptions = groups.reduce((sum, group) => sum + (Array.isArray(group?.options) ? group.options.length : 0), 0);
    return countOptions + fashion.length + decor.length;
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
    const categories = (Array.isArray(options.categories) ? options.categories : []).filter(row => !businessId || String(row.business_id || businessId) === businessId);
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
    const lifecycleEvents = (Array.isArray(options.lifecycleEvents) ? options.lifecycleEvents : []).map(normalizeLifecycleEvent).filter(Boolean)
      .filter(row => !businessId || row.business_id === businessId);
    const lifecycleTrackingAvailable = options.lifecycleAvailable === true;
    const lifecycleTrackingStartedAt = options.lifecycleTrackingStartedAt || null;
    const lifecycle = lifecycleTrackingAvailable ? lifecycleSummary(lifecycleEvents, range || dateRange("last30", null, options.now || new Date()), lifecycleTrackingStartedAt) : {
      available: false, trackingStartedAt: null, trackedFrom: null, events: [], stageCounts: {}, statusChanges: {}, cancellationsByPriorStatus: {}, bookingStageCounts: {}, trackedOrders: 0
    };
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
    const serviceBookingOutcomes = new Map();
    const cartAddSessions = new Map();
    const cartAdds = new Map();
    for (const order of currentOrders) {
      for (const item of order.items) {
        const itemId = String(item.item_id || item.itemId || item.id || "");
        const quantity = Math.max(0, Number(item.quantity) || 0);
        if (!itemId) continue;
      if (completedPurchase(order) && order.analytics_session_id) {
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
      const outcome = serviceBookingOutcomes.get(booking.item_id) || { pending: 0, accepted: 0, declined: 0, completed: 0 };
      if (Object.hasOwn(outcome, booking.status)) outcome[booking.status]++;
      serviceBookingOutcomes.set(booking.item_id, outcome);
      if (!booking.analytics_session_id) continue;
      if (!serviceBookingSessions.has(booking.item_id)) serviceBookingSessions.set(booking.item_id, new Set());
      serviceBookingSessions.get(booking.item_id).add(booking.analytics_session_id);
    }
    for (const event of currentEvents) {
      if (event.event_type !== "cart_add" || !event.item_id || !event.session_id) continue;
      cartAdds.set(event.item_id, (cartAdds.get(event.item_id) || 0) + 1);
      if (!cartAddSessions.has(event.item_id)) cartAddSessions.set(event.item_id, new Set());
      cartAddSessions.get(event.item_id).add(event.session_id);
    }

    const categoryNames = new Map(categories.map(row => [String(row.id), String(row.name || "Uncategorised")]));
    const itemPerformance = items.map(item => {
      const id = String(item.id || "");
      const service = itemType(item) === "service";
      const views = productViews.get(id) || new Set();
      const orderSessions = productOrderSessions.get(id) || new Set();
      const bookingSessions = serviceBookingSessions.get(id) || new Set();
      const convertedSessions = new Set([...(service ? bookingSessions : orderSessions)].filter(sessionId => views.has(sessionId)));
      const purchases = service ? 0 : productPurchases.get(id) || 0;
      const requests = service ? serviceBookingRequests.get(id) || 0 : 0;
      const conversionAvailable = eventTrackingAvailable && (service ? options.bookingAttributionAvailable !== false : orderAttributionAvailable);
      return {
        id,
        name: String(item.name || "Unnamed item"),
        type: service ? "service" : "product",
        categoryId: item.category_id ? String(item.category_id) : "",
        category: categoryNames.get(String(item.category_id || "")) || "Uncategorised",
        isAvailable: item.is_available !== false,
        price: Number(item.price || 0),
        priceRangeMin: item.price_range_min == null ? null : Number(item.price_range_min),
        priceRangeMax: item.price_range_max == null ? null : Number(item.price_range_max),
        variantCount: variantCount(item),
        viewSessions: eventTrackingAvailable ? views.size : null,
        cartAddSessions: eventTrackingAvailable ? (cartAddSessions.get(id) || new Set()).size : null,
        cartAdds: eventTrackingAvailable ? cartAdds.get(id) || 0 : null,
        purchasedUnits: purchases,
        purchasedOrders: completedPurchaseOrdersForItem(currentOrders, id),
        bookingRequests: requests,
        bookingOutcomes: serviceBookingOutcomes.get(id) || { pending: 0, accepted: 0, declined: 0, completed: 0 },
        convertedSessions: conversionAvailable ? convertedSessions.size : null,
        viewConversionRate: conversionAvailable && views.size ? convertedSessions.size / views.size * 100 : null,
        conversionAvailable,
        raw: item
      };
    });
    const customerItemDemand = buildCustomerItemDemand(currentOrders, customerHistory, range.start, items, categories);
    const orderStatusCounts = Object.fromEntries(["new", "accepted", "preparing", "prepared", "ready", "completed", "cancelled"].map(status => [status,
      currentOrders.filter(row => row.status === status).length
    ]));
    const completedOrders = currentOrders.filter(row => row.status === "completed");
    const orderBreakdown = buildOrderBreakdown(currentOrders, items, categoryNames);
    const orderPatterns = peakOrderPatterns(currentOrders, range);
    const valueOrders = currentOrders.filter(completedPurchase);
    const currentAverageOrderValue = valueOrders.length ? valueOrders.reduce((sum, row) => sum + row.subtotal, 0) / valueOrders.length : null;
    const operations = lifecycleTrackingAvailable ? summarizeOperations(lifecycleEvents, range) : null;
    const lifecycleStartedAt = Date.parse(lifecycleTrackingStartedAt || "");
    const lifecyclePeriodsComparable = lifecycleTrackingAvailable
      && Number.isFinite(lifecycleStartedAt)
      && range.previousStart.getTime() >= lifecycleStartedAt;
    const ownerId = String(options.ownerId || "");
    const messages = summarizeMessages(options.conversations || [], options.messages || [], ownerId, orders, range, options.messagesAvailable === true);
    const currentUnavailableInterest = itemPerformance.filter(row => !row.isAvailable && (row.viewSessions || 0) >= 10);

    return {
      valid: true,
      businessId,
      period: options.period || "last30",
      range,
      orders,
      events,
      items,
      categories,
      bookings,
      lifecycleEvents,
      lifecycleTrackingAvailable,
      lifecycleTrackingStartedAt,
      lifecycle,
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
      serviceBookingSessions,
      serviceBookingOutcomes,
      itemPerformance,
      customerItemDemand,
      cartAdds,
      cartAddSessions,
      orderStatusCounts,
      completedOrderCount: completedOrders.length,
      completionRate: currentOrders.length ? completedOrders.length / currentOrders.length * 100 : null,
      cancellationRate: currentOrders.length ? cancelledOrders.length / currentOrders.length * 100 : null,
      averageOrderValue: currentAverageOrderValue,
      orderBreakdown,
      orderPatterns,
      operations,
      demandOperations: {
        comparable: lifecyclePeriodsComparable,
        currentOrders: currentOrders.length,
        previousOrders: previousOrders.length,
        currentAcceptance: operations?.orderAcceptance.current || durationSummary([]),
        previousAcceptance: operations?.orderAcceptance.previous || durationSummary([]),
        currentFulfilment: operations?.orderFulfilment.current || durationSummary([]),
        previousFulfilment: operations?.orderFulfilment.previous || durationSummary([])
      },
      messages,
      messagesAvailable: options.messagesAvailable === true,
      ownerId,
      conversations: Array.isArray(options.conversations) ? options.conversations : [],
      messageRows: Array.isArray(options.messages) ? options.messages : [],
      currentUnavailableInterest,
      crossSystem: {
        visitsToOrders: { tracked: eventTrackingAvailable && orderAttributionAvailable, visits: currentVisits, orders: currentOrders.length, conversion },
        itemDemand: { tracked: eventTrackingAvailable, viewedItems: itemPerformance.filter(row => (row.viewSessions || 0) > 0).length, unavailableWithInterest: currentUnavailableInterest.length },
        demandToOperations: { tracked: lifecycleTrackingAvailable, placedOrders: currentOrders.length, accepted: lifecycle.stageCounts.accepted || 0, completed: lifecycle.stageCounts.completed || 0 },
        conversationsToOrders: messages
      }
    };
  }

  function completedPurchaseOrdersForItem(orders, itemId) {
    return orders.filter(order => completedPurchase(order) && order.items.some(item => String(item.item_id || item.itemId || item.id || "") === itemId)).length;
  }

  function buildCustomerItemDemand(currentOrders, allOrders, periodStart, items, categories) {
    const seenCustomers = new Set((allOrders || [])
      .filter(row => row.customer_user_id && completedPurchase(row) && isWithin(row.created_at, new Date(0), periodStart))
      .map(row => row.customer_user_id));
    const names = new Map((items || []).map(row => [String(row.id), String(row.name || "Item no longer listed")]));
    const categoryNames = new Map((categories || []).map(row => [String(row.id), String(row.name || "Uncategorised")]));
    const itemCategories = new Map((items || []).map(row => [String(row.id), categoryNames.get(String(row.category_id || "")) || "Uncategorised"]));
    const demand = new Map();
    const ordered = (currentOrders || []).filter(row => completedPurchase(row) && row.customer_user_id)
      .slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
    for (const order of ordered) {
      const isRepeatPurchase = seenCustomers.has(order.customer_user_id);
      seenCustomers.add(order.customer_user_id);
      const quantities = new Map();
      for (const line of order.items || []) {
        const id = String(line.item_id || line.itemId || line.id || "");
        if (!id) continue;
        quantities.set(id, (quantities.get(id) || 0) + Math.max(0, Number(line.quantity) || 0));
      }
      for (const [itemId, units] of quantities) {
        const row = demand.get(itemId) || {
          itemId,
          name: names.get(itemId) || String((order.items || []).find(line => String(line.item_id || line.itemId || line.id || "") === itemId)?.name || "Item no longer listed"),
          category: itemCategories.get(itemId) || "Uncategorised",
          firstPurchaseOrders: 0,
          repeatPurchaseOrders: 0,
          firstPurchaseUnits: 0,
          repeatPurchaseUnits: 0
        };
        if (isRepeatPurchase) {
          row.repeatPurchaseOrders++;
          row.repeatPurchaseUnits += units;
        } else {
          row.firstPurchaseOrders++;
          row.firstPurchaseUnits += units;
        }
        demand.set(itemId, row);
      }
    }
    return [...demand.values()].sort((a, b) => (b.repeatPurchaseOrders + b.firstPurchaseOrders) - (a.repeatPurchaseOrders + a.firstPurchaseOrders) || a.name.localeCompare(b.name));
  }

  function buildOrderBreakdown(orders, items, categoryNames) {
    const itemMap = new Map(items.map(item => [String(item.id), item]));
    const byItem = new Map();
    const byCategory = new Map();
    for (const order of orders) {
      for (const row of order.items) {
        const itemId = String(row.item_id || row.itemId || row.id || "");
        if (!itemId) continue;
        const quantity = Math.max(0, Number(row.quantity) || 0);
        const item = itemMap.get(itemId);
        const itemEntry = byItem.get(itemId) || { itemId, name: String(item?.name || row.name || "Item no longer listed"), type: itemType(item || {}), category: categoryNames.get(String(item?.category_id || "")) || "Uncategorised", units: 0, orders: 0, completedUnits: 0, cancelledOrders: 0, orderIds: new Set() };
        const newItemOrder = !itemEntry.orderIds.has(order.id);
        if (newItemOrder) { itemEntry.orderIds.add(order.id); itemEntry.orders++; }
        itemEntry.units += quantity;
        if (completedPurchase(order)) itemEntry.completedUnits += quantity;
        if (newItemOrder && order.status === "cancelled") itemEntry.cancelledOrders++;
        byItem.set(itemId, itemEntry);
        const category = itemEntry.category;
        const categoryEntry = byCategory.get(category) || { category, units: 0, orders: 0, completedUnits: 0, cancelledOrders: 0, orderIds: new Set() };
        const newCategoryOrder = !categoryEntry.orderIds.has(order.id);
        if (newCategoryOrder) { categoryEntry.orderIds.add(order.id); categoryEntry.orders++; }
        categoryEntry.units += quantity;
        if (completedPurchase(order)) categoryEntry.completedUnits += quantity;
        if (newCategoryOrder && order.status === "cancelled") categoryEntry.cancelledOrders++;
        byCategory.set(category, categoryEntry);
      }
    }
    const withoutOrderIds = rows => rows.map(({ orderIds, ...row }) => row);
    return { items: withoutOrderIds([...byItem.values()]).sort((a, b) => b.completedUnits - a.completedUnits), categories: withoutOrderIds([...byCategory.values()]).sort((a, b) => b.completedUnits - a.completedUnits) };
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

  function buildSeries(snapshot, metric, itemId) {
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
          const itemSessions = itemId
            ? new Set(events.filter(row => row.event_type === "product_view" && row.item_id === String(itemId) && row.session_id).map(row => row.session_id))
            : new Set(events.filter(row => row.event_type === "product_view" && row.item_id && row.session_id).map(row => String(row.item_id) + "\u0000" + String(row.session_id)));
          value = itemSessions.size;
        }
      }
      if (metric === "item_purchases" && itemId) {
        value = orders.filter(completedPurchase).reduce((sum, row) => sum + row.items
          .filter(item => String(item.item_id || item.itemId || item.id || "") === String(itemId))
          .reduce((units, item) => units + Math.max(0, Number(item.quantity) || 0), 0), 0);
      }
      if (metric === "item_booking_requests" && itemId) {
        value = (snapshot.bookings || []).filter(row => row.item_id === String(itemId) && isWithin(row.created_at, bucket.start, bucket.end)).length;
      }
      if (metric === "item_cart_adds" && itemId && snapshot.eventTrackingAvailable) {
        value = events.filter(row => row.event_type === "cart_add" && row.item_id === String(itemId)).length;
      }
      if (metric === "item_conversion" && itemId && snapshot.eventTrackingAvailable) {
        const selectedItem = snapshot.items.find(row => String(row.id) === String(itemId));
        const isService = itemType(selectedItem) === "service";
        const attributionAvailable = isService ? snapshot.bookingAttributionAvailable : snapshot.orderAttributionAvailable;
        if (attributionAvailable) {
          const views = uniqueSessions(events.filter(row => row.event_type === "product_view" && row.item_id === String(itemId) && row.session_id));
          const conversions = isService
            ? new Set((snapshot.bookings || []).filter(row => row.item_id === String(itemId) && row.analytics_session_id && isWithin(row.created_at, bucket.start, bucket.end)).map(row => row.analytics_session_id).filter(id => views.has(id)))
            : new Set(orders.filter(row => completedPurchase(row) && row.analytics_session_id && row.items.some(item => String(item.item_id || item.itemId || item.id || "") === String(itemId))).map(row => row.analytics_session_id).filter(id => views.has(id)));
          value = views.size >= 10 ? conversions.size / views.size * 100 : null;
        }
      }
      if (metric === "bookings") {
        value = (snapshot.bookings || []).filter(row => isWithin(row.created_at, bucket.start, bucket.end)).length;
      }
      if (metric === "completed_orders" || metric === "cancelled_orders") {
        if (snapshot.lifecycleTrackingAvailable && snapshot.lifecycleTrackingStartedAt) {
          const trackingDay = localDate(snapshot.lifecycleTrackingStartedAt);
          if (trackingDay && bucket.end > trackingDay) {
            const status = metric === "completed_orders" ? "completed" : "cancelled";
            value = snapshot.lifecycleEvents.filter(row => row.entity_type === "order" && row.to_status === status && isWithin(row.changed_at, bucket.start, bucket.end)).length;
          }
        }
      }
      if (["order_acceptance_hours", "order_accepted_to_preparation_hours", "order_preparation_hours", "order_collection_hours", "order_fulfilment_hours", "booking_response_hours", "booking_completion_hours"].includes(metric)) {
        if (snapshot.lifecycleTrackingAvailable && snapshot.lifecycleTrackingStartedAt) {
          const trackingDay = localDate(snapshot.lifecycleTrackingStartedAt);
          if (trackingDay && bucket.end > trackingDay) {
            const range = { start: bucket.start, end: bucket.end, previousStart: bucket.start, previousEnd: bucket.start };
            const timings = summarizeOperations(snapshot.lifecycleEvents, range);
            const key = ({ order_acceptance_hours: "orderAcceptance", order_accepted_to_preparation_hours: "acceptedToPreparation", order_preparation_hours: "preparation", order_collection_hours: "collection", order_fulfilment_hours: "orderFulfilment", booking_response_hours: "bookingResponse", booking_completion_hours: "bookingCompletion" })[metric];
            value = timings[key].current.averageHours;
          }
        }
      }
      if (metric === "message_response_hours" && snapshot.messagesAvailable && snapshot.ownerId) {
        const range = { start: bucket.start, end: bucket.end };
        const measured = summarizeMessages(snapshot.conversations, snapshot.messageRows, snapshot.ownerId, snapshot.orders, range, true);
        value = measured.responseSampleSize ? measured.averageResponseHours : null;
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
    const detectedDate = now instanceof Date ? now : new Date(now || Date.now());
    const detectedAt = detectedDate.toISOString();
    const detectedDay = localDate(detectedDate) || localDate(new Date());
    const rangeStart = dayKey(snapshot.range.start);
    const rangeEnd = dayKey(addDays(snapshot.range.end, -1));

    function add(insight) {
      const saved = { ...(stateMap[insight.key] || {}) };
      const isStaleDismissal = saved.status === "dismissed" && saved.updated_at && (Date.parse(detectedAt) - Date.parse(saved.updated_at) > 30 * DAY);
      if (isStaleDismissal) saved.status = "new";
      insight.status = saved.status || "new";
      insight.statusUpdatedAt = saved.updated_at || null;
      insight.actedAt = saved.acted_at || null;
      insight.detectedAt = detectedAt;
      insight.observation = { start: rangeStart, end: rangeEnd, period: snapshot.period };
      const priorityWeight = { high: 36, medium: 22, low: 10 }[insight.priority] || 10;
      const sampleRow = (insight.evidence || []).find(row => /session|order|transition|reply|purchaser/i.test(row.label || ""));
      const sampleMatch = String(sampleRow?.value || "").match(/[\d,.]+/);
      const sampleSize = Number(sampleMatch ? sampleMatch[0].replaceAll(",", "") : 0);
      const evidenceWeight = sampleSize >= 30 ? 20 : sampleSize >= 15 ? 16 : sampleSize >= 5 ? 11 : 6;
      const observationEnd = localDate(insight.observation.end);
      const daysOld = observationEnd ? Math.max(0, Math.floor((detectedDay - observationEnd) / DAY)) : 0;
      const recencyWeight = Math.max(0, 12 - Math.floor(daysOld / 3));
      const relevanceWeight = Number.isFinite(insight.relevanceWeight) ? insight.relevanceWeight : 10;
      const actionWeight = insight.recommendation ? 12 : 0;
      const statusPenalty = insight.status === "action_taken" ? 12 : insight.status === "viewed" ? 3 : 0;
      const dismissalPenalty = insight.status === "dismissed" || insight.status === "resolved" ? 100 : 0;
      insight.priorityBreakdown = { impact: priorityWeight, evidence: evidenceWeight, relevance: relevanceWeight, actionability: actionWeight, recency: recencyWeight, statusPenalty: statusPenalty + dismissalPenalty };
      insight.priorityScore = priorityWeight + evidenceWeight + relevanceWeight + actionWeight + recencyWeight - statusPenalty - dismissalPenalty;
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
            : "Many sessions viewed “" + String(item.name || "this item") + "” without a completed purchase",
          explanation: sessions + " tracked sessions opened this " + (isService ? "service. " + converted + " of those sessions sent a booking request during the same session." : "item. " + converted + " of those sessions completed a non-refunded order containing it during the same session."),
          interpretation: "This is a same-session view-to-" + (isService ? "booking-request" : "completed-purchase") + " comparison. It does not reveal why customers did not continue.",
          recommendation: isService
            ? "Review the service description, photos, availability and booking questions. Make the next step and expected response clear; StoreNest does not yet measure response time."
            : "Review the item’s price, description, photos and availability. If these look correct, observe more sessions before making a change.",
          priority: "medium",
          evidence: [{ label: "Unique view sessions", value: sessions }, { label: isService ? "Same-session booking requests" : "Same-session completed purchases", value: converted }, { label: isService ? "View-to-booking rate" : "View-to-purchase rate", value: rate.toFixed(1) + "%" }],
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

    if (snapshot.eventTrackingAvailable && snapshot.orderAttributionAvailable
      && snapshot.conversion.value != null && snapshot.previousConversion.value != null
      && snapshot.conversion.visits >= 30 && snapshot.previousConversion.visits >= 30) {
      const ppChange = snapshot.conversion.value - snapshot.previousConversion.value;
      if (ppChange <= -3) {
        add({
          key: "traffic-order-conversion-decline",
          type: "conversion_decline",
          title: "Fewer storefront sessions are becoming orders",
          explanation: "Tracked session-to-order conversion moved from " + snapshot.previousConversion.value.toFixed(1) + "% to " + snapshot.conversion.value.toFixed(1) + "% while both periods had at least 30 tracked sessions.",
          interpretation: "This compares same-session storefront visits and submitted orders. It shows a relationship in the records, not why customers did not order.",
          recommendation: "Compare the products viewed, current availability and order outcomes for the two periods. Check that prices, descriptions and checkout steps are clear.",
          priority: "high",
          evidence: [{ label: "Previous conversion", value: snapshot.previousConversion.value.toFixed(1) + "%" }, { label: "Current conversion", value: snapshot.conversion.value.toFixed(1) + "%" }, { label: "Change", value: ppChange.toFixed(1) + " pp" }, { label: "Current tracked sessions", value: snapshot.conversion.visits }],
          metric: "conversion"
        });
      }
    }

    if (snapshot.eventTrackingAvailable && snapshot.visits >= 20 && snapshot.previousVisits >= 20
      && snapshot.ordersPlaced >= 5 && snapshot.previousOrdersPlaced >= 5) {
      const trafficChange = percentageChange(snapshot.visits, snapshot.previousVisits);
      const volumeChange = percentageChange(snapshot.ordersPlaced, snapshot.previousOrdersPlaced);
      const movedTogether = trafficChange.value != null && volumeChange.value != null
        && ((trafficChange.value >= 20 && volumeChange.value >= 20)
          || (trafficChange.value <= -20 && volumeChange.value <= -20));
      if (movedTogether) {
        const increased = trafficChange.value > 0;
        add({
          key: "traffic-order-coincidence",
          type: "cross_system_relationship",
          title: increased ? "Store traffic and orders increased together" : "Store traffic and orders decreased together",
          explanation: "Tracked storefront sessions changed from " + snapshot.previousVisits + " to " + snapshot.visits + ", while orders placed changed from " + snapshot.previousOrdersPlaced + " to " + snapshot.ordersPlaced + " across equal-length periods.",
          interpretation: "The two measurements moved in the same direction during these periods. This is a relationship in the records, not proof that one change caused the other.",
          recommendation: increased
            ? "Review which items and order outcomes changed alongside traffic, then check that availability and preparation capacity match the added demand."
            : "Compare the items viewed, availability and order outcomes across both periods to identify where activity changed.",
          priority: "medium",
          evidence: [{ label: "Previous storefront sessions", value: snapshot.previousVisits }, { label: "Current storefront sessions", value: snapshot.visits }, { label: "Previous orders placed", value: snapshot.previousOrdersPlaced }, { label: "Current orders placed", value: snapshot.ordersPlaced }, { label: "Minimum samples", value: "20 sessions and 5 orders in each period" }],
          metric: "visits"
        });
      }
    }


    for (const item of snapshot.currentUnavailableInterest || []) {
      add({
        key: "unavailable-item-interest:" + item.id,
        type: "availability_interest",
        itemId: item.id,
        title: "Customers viewed an item that is unavailable now",
        explanation: "“" + item.name + "” is marked unavailable now and received " + item.viewSessions + " unique view sessions during the selected period.",
        interpretation: "Availability is the current catalogue setting; StoreNest has not recorded when it changed. The views may have happened before or after the item became unavailable.",
        recommendation: "Confirm whether the item should remain unavailable. If it is available again, update its status so customers can place an order or request.",
        priority: "medium",
        evidence: [{ label: "Current availability", value: "Unavailable" }, { label: "Unique view sessions", value: item.viewSessions }, { label: "Selected period", value: rangeStart + " to " + rangeEnd }],
        metric: "product"
      });
    }

    if (snapshot.lifecycleTrackingAvailable && snapshot.lifecycleTrackingStartedAt) {
      const operations = snapshot.operations;
      const timingChecks = [
        { key: "order-acceptance-delay", metric: "order_acceptance", label: "order acceptance", sample: operations.orderAcceptance.current, threshold: 24, recommendation: "Review when new orders are checked and whether notifications are reaching the right person." },
        { key: "order-fulfilment-delay", metric: "order_fulfilment", label: "order fulfilment", sample: operations.orderFulfilment.current, threshold: 48, recommendation: "Review preparation steps and whether customers receive a clear ready-for-collection update." },
        { key: "booking-response-delay", metric: "booking_response", label: "booking responses", sample: operations.bookingResponse.current, threshold: 24, recommendation: "Set a regular time to review new booking requests and keep your response window clear to customers." }
      ];
      for (const check of timingChecks) {
        if (check.sample.sampleSize < 3 || check.sample.averageHours < check.threshold) continue;
        add({
          key: check.key,
          type: "operational_delay",
          title: "Some " + check.label + " are taking longer",
          explanation: "Across " + check.sample.sampleSize + " recorded transitions, the average " + check.label + " time was " + check.sample.averageHours.toFixed(1) + " hours.",
          interpretation: "This timing uses status-change events recorded since lifecycle tracking began. Older records are not included, and this average does not explain the reason for the delay.",
          recommendation: check.recommendation,
          priority: check.sample.averageHours >= check.threshold * 2 ? "high" : "medium",
          evidence: [{ label: "Average time", value: check.sample.averageHours.toFixed(1) + " hours" }, { label: "Median time", value: check.sample.medianHours.toFixed(1) + " hours" }, { label: "Recorded transitions", value: check.sample.sampleSize }, { label: "Tracking since", value: new Intl.DateTimeFormat("en-ZA", { dateStyle: "medium" }).format(new Date(snapshot.lifecycleTrackingStartedAt)) }],
          metric: check.metric
        });
      }
    }

    if (snapshot.demandOperations?.comparable) {
      const relation = snapshot.demandOperations;
      const orderChange = percentageChange(relation.currentOrders, relation.previousOrders);
      const acceptanceChange = percentageChange(relation.currentAcceptance.averageHours, relation.previousAcceptance.averageHours);
      if (relation.currentOrders >= 5 && relation.previousOrders >= 5
        && relation.currentAcceptance.sampleSize >= 3 && relation.previousAcceptance.sampleSize >= 3
        && orderChange.value >= 20 && acceptanceChange.value >= 20) {
        add({
          key: "demand-acceptance-coincidence",
          type: "cross_system_relationship",
          title: "Higher order volume coincided with slower acceptance",
          explanation: "Orders placed changed from " + relation.previousOrders + " to " + relation.currentOrders + ", while average acceptance time changed from " + relation.previousAcceptance.averageHours.toFixed(1) + " to " + relation.currentAcceptance.averageHours.toFixed(1) + " hours.",
          interpretation: "The two changes occurred in the same comparable periods. This is an observed relationship, not proof that higher demand caused slower responses.",
          recommendation: "Review when new orders are checked and whether order alerts reach the person handling them.",
          priority: "high",
          evidence: [{ label: "Previous orders", value: relation.previousOrders }, { label: "Current orders", value: relation.currentOrders }, { label: "Previous average acceptance", value: relation.previousAcceptance.averageHours.toFixed(1) + " hours" }, { label: "Current average acceptance", value: relation.currentAcceptance.averageHours.toFixed(1) + " hours" }, { label: "Recorded transitions per period", value: relation.currentAcceptance.sampleSize + " current, " + relation.previousAcceptance.sampleSize + " previous" }],
          metric: "order_acceptance"
        });
      }
    }

    const cancellationStages = Object.entries(snapshot.lifecycle?.cancellationsByPriorStatus || {}).sort((a, b) => b[1] - a[1]);
    const repeatedStage = cancellationStages.find(([, count]) => count >= 3);
    if (repeatedStage) {
      const stageLabel = ({ new: "order placement", accepted: "acceptance", preparing: "preparation", prepared: "preparation", ready: "ready for collection" })[repeatedStage[0]] || repeatedStage[0];
      add({
        key: "cancellations-after-stage:" + repeatedStage[0],
        type: "cancellation_stage_pattern",
        title: "Several cancellations followed " + stageLabel,
        explanation: repeatedStage[1] + " recorded orders moved from " + stageLabel + " to cancelled during this period.",
        interpretation: "This identifies where cancellations followed a status change. StoreNest does not record cancellation reasons, so it cannot establish why they happened.",
        recommendation: "Review these orders and record their reasons in your normal business notes to see whether the same issue recurs.",
        priority: repeatedStage[1] >= 5 ? "high" : "medium",
        evidence: [{ label: "Cancellations after " + stageLabel, value: repeatedStage[1] }, { label: "Previous status", value: stageLabel }, { label: "Period", value: rangeStart + " to " + rangeEnd }],
        metric: "operations"
      });
    }

    if (snapshot.messages.available && snapshot.messages.responseSampleSize >= 3 && snapshot.messages.averageResponseHours >= 24) {
      add({
        key: "message-response-delay",
        type: "message_response_delay",
        title: "Customer messages are waiting for a reply",
        explanation: "The average time between customer messages and the next business reply was " + snapshot.messages.averageResponseHours.toFixed(1) + " hours across " + snapshot.messages.responseSampleSize + " replies.",
        interpretation: "StoreNest measures message timing and sender IDs only. Message text is not read for this analysis, and the measured gap does not show why a reply took longer.",
        recommendation: "Check the Chat Centre regularly or set a time each day to answer new customer messages.",
        priority: snapshot.messages.averageResponseHours >= 48 ? "high" : "medium",
        evidence: [{ label: "Average reply time", value: snapshot.messages.averageResponseHours.toFixed(1) + " hours" }, { label: "Median reply time", value: snapshot.messages.medianResponseHours.toFixed(1) + " hours" }, { label: "Measured replies", value: snapshot.messages.responseSampleSize }],
        metric: "message_response"
      });
    }

    if (snapshot.messages.available && snapshot.messages.unansweredMessages > 0 && snapshot.messages.oldestUnansweredHours >= 24) {
      add({
        key: "unanswered-customer-messages",
        type: "unanswered_messages",
        title: "A customer message is waiting for a reply",
        explanation: snapshot.messages.unansweredMessages + " customer message" + (snapshot.messages.unansweredMessages === 1 ? " is" : "s are") + " still unanswered; the oldest has been waiting " + snapshot.messages.oldestUnansweredHours.toFixed(1) + " hours.",
        interpretation: "StoreNest checks message timestamps and sender IDs only. It does not read message content or infer urgency from what a customer wrote.",
        recommendation: "Open the Chat Centre and review the unanswered conversation when you are available.",
        priority: snapshot.messages.oldestUnansweredHours >= 48 ? "high" : "medium",
        evidence: [{ label: "Unanswered customer messages", value: snapshot.messages.unansweredMessages }, { label: "Oldest waiting", value: snapshot.messages.oldestUnansweredHours.toFixed(1) + " hours" }],
        metric: "message_response"
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
        metric: "returning"
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

    return output.sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));
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
    if (insight.metric === "conversion") {
      if (!snapshot.eventTrackingAvailable || !snapshot.orderAttributionAvailable) return { available: false, reason: "not_tracked" };
      const windowConversion = (windowStart, windowEnd) => {
        const sessions = uniqueSessions(visitRows(snapshot.events, windowStart, windowEnd));
        const converted = new Set(orderRows(snapshot.orders, windowStart, windowEnd).map(row => row.analytics_session_id).filter(id => id && sessions.has(id)));
        return { sessions: sessions.size, rate: sessions.size ? converted.size / sessions.size * 100 : null };
      };
      const before = windowConversion(beforeStart, beforeEnd);
      const after = windowConversion(afterStart, afterEnd);
      if (before.sessions < 10 || after.sessions < 10) return { available: false, reason: "insufficient", beforeVisits: before.sessions, afterVisits: after.sessions };
      const difference = after.rate - before.rate;
      return {
        available: true,
        before: before.rate,
        after: after.rate,
        beforeLabel: before.rate.toFixed(1) + "% (" + before.sessions + " sessions)",
        afterLabel: after.rate.toFixed(1) + "% (" + after.sessions + " sessions)",
        change: { value: difference, label: (difference > 0 ? "+" : "") + difference.toFixed(1) + " pp" },
        message: "Same-session visit-to-order conversion in the seven full days after the action is compared with the seven full days before it. At least 10 tracked sessions are required in each window. This comparison does not prove the action caused the change."
      };
    }
    if (insight.metric === "order_acceptance" || insight.metric === "order_fulfilment" || insight.metric === "booking_response") {
      if (!snapshot.lifecycleTrackingAvailable) return { available: false, reason: "not_tracked" };
      const windowRange = (windowStart, windowEnd) => ({ start: windowStart, end: windowEnd, previousStart: windowStart, previousEnd: windowStart, duration: 7, label: "Follow-up" });
      const metricKey = ({ order_acceptance: "orderAcceptance", order_fulfilment: "orderFulfilment", booking_response: "bookingResponse" })[insight.metric];
      const before = summarizeOperations(snapshot.lifecycleEvents, windowRange(beforeStart, beforeEnd))[metricKey].current;
      const after = summarizeOperations(snapshot.lifecycleEvents, windowRange(afterStart, afterEnd))[metricKey].current;
      if (!before.sampleSize || !after.sampleSize) return { available: false, reason: "insufficient" };
      const difference = after.averageHours - before.averageHours;
      return {
        available: true,
        before: before.averageHours,
        after: after.averageHours,
        beforeLabel: before.averageHours.toFixed(1) + " hours (" + before.sampleSize + " transitions)",
        afterLabel: after.averageHours.toFixed(1) + " hours (" + after.sampleSize + " transitions)",
        change: { value: difference, label: (difference > 0 ? "+" : "") + difference.toFixed(1) + " hours" },
        message: "Average recorded transition times in the seven full days after the action are compared with the seven full days before it. A later change does not prove the action caused it."
      };
    }
    if (insight.metric === "product" && insight.itemId && snapshot.eventTrackingAvailable && (insight.service ? snapshot.bookingAttributionAvailable : snapshot.orderAttributionAvailable)) {
      const productWindow = (windowStart, windowEnd) => {
        const views = uniqueSessions(snapshot.events.filter(row => row.event_type === "product_view" && row.item_id === String(insight.itemId) && isWithin(row.occurred_at, windowStart, windowEnd)));
        const convertedSessions = insight.service
          ? new Set(snapshot.bookings.filter(row => row.item_id === String(insight.itemId) && row.analytics_session_id && isWithin(row.created_at, windowStart, windowEnd)).map(row => row.analytics_session_id).filter(id => views.has(id)))
        : new Set(snapshot.orders.filter(row => completedPurchase(row) && isWithin(row.created_at, windowStart, windowEnd) && row.analytics_session_id && row.items.some(item => String(item.item_id || item.itemId || item.id || "") === String(insight.itemId))).map(row => row.analytics_session_id).filter(id => views.has(id)));
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
    if (insight.metric === "returning") {
      const returningRate = (windowStart, windowEnd) => {
        const windowOrders = snapshot.orders.filter(row => isWithin(row.created_at, windowStart, windowEnd));
        const summary = customerSummary(windowOrders, snapshot.customerHistory || snapshot.orders, windowStart);
        return summary.returningRate == null ? null : { value: summary.returningRate, sample: summary.identifiedBuyers };
      };
      const before = returningRate(beforeStart, beforeEnd);
      const after = returningRate(afterStart, afterEnd);
      if (!before || !after) return { available: false, reason: "insufficient" };
      const difference = after.value - before.value;
      return {
        available: true,
        before: before.value,
        after: after.value,
        beforeLabel: before.value.toFixed(1) + "% (" + before.sample + " identified purchasers)",
        afterLabel: after.value.toFixed(1) + "% (" + after.sample + " identified purchasers)",
        change: { value: difference, label: (difference > 0 ? "+" : "") + difference.toFixed(1) + " pp" },
        message: "The returning share among identified purchasers in the seven full days after the action is compared with the seven full days before it. Guest orders are excluded; the comparison does not prove the action caused a change."
      };
    }
    if (insight.metric === "message_response" && snapshot.messagesAvailable) {
      const windowRange = (windowStart, windowEnd) => ({ start: windowStart, end: windowEnd });
      const before = summarizeMessages(snapshot.conversations, snapshot.messageRows, snapshot.ownerId, snapshot.orders, windowRange(beforeStart, beforeEnd), true);
      const after = summarizeMessages(snapshot.conversations, snapshot.messageRows, snapshot.ownerId, snapshot.orders, windowRange(afterStart, afterEnd), true);
      if (before.responseSampleSize < 1 || after.responseSampleSize < 1) return { available: false, reason: "insufficient" };
      const difference = after.averageResponseHours - before.averageResponseHours;
      return {
        available: true,
        before: before.averageResponseHours,
        after: after.averageResponseHours,
        beforeLabel: before.averageResponseHours.toFixed(1) + " hours (" + before.responseSampleSize + " replies)",
        afterLabel: after.averageResponseHours.toFixed(1) + " hours (" + after.responseSampleSize + " replies)",
        change: { value: difference, label: (difference > 0 ? "+" : "") + difference.toFixed(1) + " hours" },
        message: "Message reply times in the seven full days after the action are compared with the seven full days before it. Only message timestamps and sender IDs are used; message content is not inspected. The comparison does not prove the action caused a change."
      };
    }
    return { available: false, reason: "unsupported_metric" };
  }

  const api = Object.freeze({ PERIODS, dateRange, dayKey, normalizeOrder, normalizeEvent, buildSnapshot, percentageChange, buildSeries, buildInsights, followUp, localDate, addDays, completedPurchase });
  root.StoreNestAnalyticsEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
