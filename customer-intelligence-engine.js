(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StoreNestCustomerEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const DAY_MS = 86400000;
  const PERIODS = { today: "Today", last7: "Last 7 days", last30: "Last 30 days", month: "This month", last90: "Last 90 days", custom: "Custom range" };

  function startOfDay(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(value, count) {
    const date = new Date(value);
    date.setDate(date.getDate() + count);
    return date;
  }

  function dayKey(value) {
    const date = startOfDay(value);
    if (!date) return "";
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }

  function dateRange(period, custom, now) {
    const today = startOfDay(now || new Date());
    if (!today) return null;
    let start;
    let end = addDays(today, 1);
    if (period === "today") start = today;
    else if (period === "last7") start = addDays(today, -6);
    else if (period === "last30") start = addDays(today, -29);
    else if (period === "month") start = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (period === "last90") start = addDays(today, -89);
    else if (period === "custom") {
      const from = String(custom && custom.start || "");
      const to = String(custom && custom.end || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
      start = startOfDay(new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10))));
      const last = startOfDay(new Date(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10))));
      if (!start || !last || last < start || last > today) return null;
      end = addDays(last, 1);
    } else start = addDays(today, -29);
    const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
    return {
      start,
      end,
      duration,
      previousStart: addDays(start, -duration),
      previousEnd: start,
      label: PERIODS[period] || PERIODS.last30
    };
  }

  function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : null;
  }

  function within(value, start, end) {
    const time = timestamp(value);
    return time !== null && time >= start.getTime() && time < end.getTime();
  }

  function normalizeEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
  }

  function normalizePhone(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.indexOf("0027") === 0) digits = "27" + digits.slice(4);
    else if (digits.indexOf("0") === 0 && digits.length === 10) digits = "27" + digits.slice(1);
    return digits.length >= 7 ? digits : "";
  }

  function parseArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) { return []; }
    }
    return [];
  }

  function normalizeOrder(row) {
    if (!row || typeof row !== "object") return null;
    const amount = Number(row.subtotal);
    return {
      id: String(row.id || ""),
      business_id: String(row.business_id || ""),
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
      status: String(row.status || "").trim().toLowerCase(),
      payment_status: String(row.payment_status || "").trim().toLowerCase(),
      subtotal: Number.isFinite(amount) && amount >= 0 ? amount : 0,
      customer_user_id: String(row.customer_user_id || ""),
      customer_name: String(row.customer_name || "").trim(),
      contact_email: normalizeEmail(row.contact_email),
      contact_phone: normalizePhone(row.contact_phone),
      analytics_session_id: String(row.analytics_session_id || ""),
      items: parseArray(row.items)
    };
  }

  function normalizeBooking(row) {
    if (!row || typeof row !== "object") return null;
    return {
      id: String(row.id || ""),
      business_id: String(row.business_id || ""),
      item_id: String(row.item_id || ""),
      created_at: String(row.created_at || ""),
      updated_at: String(row.updated_at || ""),
      status: String(row.status || "").trim().toLowerCase(),
      customer_user_id: String(row.customer_user_id || ""),
      customer_name: String(row.customer_name || "").trim(),
      contact_email: normalizeEmail(row.contact_email),
      contact_phone: normalizePhone(row.contact_phone),
      analytics_session_id: String(row.analytics_session_id || "")
    };
  }

  function normalizeEvent(row) {
    if (!row || typeof row !== "object") return null;
    return {
      business_id: String(row.business_id || ""),
      event_type: String(row.event_type || ""),
      session_id: String(row.session_id || ""),
      item_id: String(row.item_id || ""),
      occurred_at: String(row.occurred_at || "")
    };
  }

  function normalizeItem(row) {
    if (!row || typeof row !== "object") return null;
    return {
      id: String(row.id || ""),
      business_id: String(row.business_id || ""),
      name: String(row.name || "").trim(),
      item_type: String(row.item_type || "product"),
      category_id: String(row.category_id || "")
    };
  }

  function normalizeCategory(row) {
    if (!row || typeof row !== "object") return null;
    return { id: String(row.id || ""), name: String(row.name || "").trim() };
  }

  function qualifyingPurchase(order) {
    const sharedDefinition = root && root.StoreNestAnalyticsEngine && root.StoreNestAnalyticsEngine.completedPurchase;
    if (typeof sharedDefinition === "function") return sharedDefinition(order);
    return Boolean(order && order.status === "completed" && order.payment_status !== "refunded");
  }

  function paidPurchase(order) {
    return qualifyingPurchase(order) && order.payment_status === "paid";
  }

  function identityTokens(record) {
    const tokens = [];
    if (record.customer_user_id) tokens.push("user:" + record.customer_user_id.toLowerCase());
    if (record.contact_email) tokens.push("email:" + record.contact_email);
    if (record.contact_phone) tokens.push("phone:" + record.contact_phone);
    return [...new Set(tokens)];
  }

  function buildIdentityGroups(orders, bookings) {
    const parent = new Map();
    function find(token) {
      if (!parent.has(token)) parent.set(token, token);
      const next = parent.get(token);
      if (next !== token) parent.set(token, find(next));
      return parent.get(token);
    }
    function union(left, right) {
      const a = find(left), b = find(right);
      if (a !== b) parent.set(b, a);
    }
    const records = [];
    orders.forEach(row => records.push({ kind: "order", row, time: timestamp(row.created_at) }));
    bookings.forEach(row => records.push({ kind: "booking", row, time: timestamp(row.created_at) }));
    records.sort((a, b) => (a.time === null ? Infinity : a.time) - (b.time === null ? Infinity : b.time));
    for (const record of records) {
      const tokens = identityTokens(record.row);
      record.tokens = tokens;
      for (let index = 1; index < tokens.length; index++) union(tokens[0], tokens[index]);
    }
    const rootToKey = new Map();
    const groups = new Map();
    for (const record of records) {
      if (!record.tokens.length) {
        record.row.customer_key = "";
        continue;
      }
      const root = find(record.tokens[0]);
      if (!rootToKey.has(root)) rootToKey.set(root, "customer-" + (rootToKey.size + 1));
      const key = rootToKey.get(root);
      record.row.customer_key = key;
      let group = groups.get(key);
      if (!group) {
        group = { key, name: "Customer", first_seen: record.row.created_at || "", last_seen: record.row.created_at || "", orders: [], bookings: [] };
        groups.set(key, group);
      }
      if (record.row.customer_name) group.name = record.row.customer_name;
      if (!group.first_seen || (record.time !== null && record.time < timestamp(group.first_seen))) group.first_seen = record.row.created_at;
      if (!group.last_seen || (record.time !== null && record.time > timestamp(group.last_seen))) group.last_seen = record.row.created_at;
      if (record.kind === "order") group.orders.push(record.row);
      else group.bookings.push(record.row);
    }
    return groups;
  }

  function createBuckets(range) {
    if (!range) return [];
    const step = range.duration <= 31 ? 1 : Math.max(1, Math.ceil(range.duration / 15));
    const buckets = [];
    for (let start = new Date(range.start); start < range.end;) {
      const end = new Date(Math.min(addDays(start, step).getTime(), range.end.getTime()));
      buckets.push({ start, end, label: new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short" }).format(start) });
      start = end;
    }
    return buckets;
  }

  function makeMetrics(model, start, end) {
    const rangeOrders = model.orders.filter(row => within(row.created_at, start, end));
    const purchases = rangeOrders.filter(qualifyingPurchase);
    const buyers = new Set(purchases.map(row => row.customer_key).filter(Boolean));
    const returning = new Set();
    for (const key of buyers) {
      const group = model.customers.get(key);
      if (group && group.orders.filter(row => {
        const orderTime = timestamp(row.created_at);
        return qualifyingPurchase(row) && orderTime !== null && orderTime < end.getTime();
      }).length > 1) returning.add(key);
    }
    const newCustomers = [...model.customers.values()].filter(group => within(group.first_seen, start, end)).length;
    const identifiedPaid = purchases.filter(row => row.customer_key && paidPurchase(row));
    const spend = identifiedPaid.reduce((sum, row) => sum + row.subtotal, 0);
    return {
      totalOrders: purchases.length,
      identifiedBuyers: buyers.size,
      returningCustomers: returning.size,
      returningRate: buyers.size ? returning.size / buyers.size * 100 : null,
      averageSpend: identifiedPaid.length ? spend / identifiedPaid.length : null,
      paidSpend: spend,
      paidOrderCount: identifiedPaid.length,
      newCustomers,
      firstTimePurchasers: Math.max(0, buyers.size - returning.size),
      buyerKeys: buyers,
      repeatKeys: returning,
      rangeOrders: purchases
    };
  }

  function buildSeries(model, range, eventsAvailable) {
    const buckets = createBuckets(range);
    return {
      purchases: buckets.map(bucket => ({
        ...bucket,
        value: model.orders.filter(row => qualifyingPurchase(row) && within(row.created_at, bucket.start, bucket.end)).length
      })),
      visits: buckets.map(bucket => {
        if (!eventsAvailable) return { ...bucket, value: null };
        const sessions = new Set(model.events.filter(row => row.event_type === "store_visit" && row.session_id && within(row.occurred_at, bucket.start, bucket.end)).map(row => row.session_id));
        return { ...bucket, value: sessions.size };
      }),
      repeatRate: buckets.map(bucket => {
        const orders = model.orders.filter(row => qualifyingPurchase(row) && within(row.created_at, bucket.start, bucket.end) && row.customer_key);
        const buyers = new Set(orders.map(row => row.customer_key));
        if (!buyers.size) return { ...bucket, value: null };
        const repeat = [...buyers].filter(key => {
          const group = model.customers.get(key);
          return Boolean(group && group.orders.some(row => qualifyingPurchase(row) && timestamp(row.created_at) < bucket.start.getTime()));
        }).length;
        return { ...bucket, value: repeat / buyers.size * 100 };
      })
    };
  }

  function paidAverageForKeys(model, keys, start, end) {
    const rows = model.orders.filter(row => row.customer_key && keys.has(row.customer_key) && paidPurchase(row) && within(row.created_at, start, end));
    if (!rows.length) return null;
    return { average: rows.reduce((sum, row) => sum + row.subtotal, 0) / rows.length, count: rows.length };
  }

  function buildInsights(model, current, previous, range) {
    const insights = [];
    if (current.identifiedBuyers >= 5 && previous.identifiedBuyers >= 5 && current.returningRate !== null && previous.returningRate !== null) {
      const change = current.returningRate - previous.returningRate;
      if (Math.abs(change) >= 5) {
        insights.push({
          key: "repeat-rate-change",
          type: "retention",
          title: change > 0 ? "More identified customers are returning" : "Fewer identified customers are returning",
          explanation: "The repeat purchase rate moved from " + previous.returningRate.toFixed(1) + "% to " + current.returningRate.toFixed(1) + "% for identified purchasers.",
          evidence: [{ label: "Current repeat rate", value: current.returningRate.toFixed(1) + "% (" + current.identifiedBuyers + " buyers)" }, { label: "Previous repeat rate", value: previous.returningRate.toFixed(1) + "% (" + previous.identifiedBuyers + " buyers)" }, { label: "Change", value: (change > 0 ? "+" : "") + change.toFixed(1) + " percentage points" }],
          view: "retention"
        });
      }
    }
    const orders = current.rangeOrders;
    const weekendOrders = orders.filter(row => {
      const date = startOfDay(row.created_at);
      return date && (date.getDay() === 0 || date.getDay() === 6);
    });
    let weekendDays = 0, weekdayDays = 0;
    for (let day = new Date(range.start); day < range.end; day = addDays(day, 1)) {
      if (day.getDay() === 0 || day.getDay() === 6) weekendDays++;
      else weekdayDays++;
    }
    const weekdayOrders = orders.length - weekendOrders.length;
    if (orders.length >= 8 && weekendDays >= 2 && weekdayDays >= 3) {
      const weekendAverage = weekendOrders.length / weekendDays;
      const weekdayAverage = weekdayOrders / weekdayDays;
      if (weekdayAverage > 0 && weekendAverage >= weekdayAverage * 1.2) {
        insights.push({
          key: "weekend-purchase-pattern",
          type: "timing",
          title: "Purchases are more frequent on weekends",
          explanation: "Completed orders per weekend day were " + (weekendAverage / weekdayAverage * 100 - 100).toFixed(0) + "% higher than the weekday average.",
          evidence: [{ label: "Weekend orders", value: weekendOrders.length + " across " + weekendDays + " days" }, { label: "Weekday orders", value: weekdayOrders + " across " + weekdayDays + " days" }, { label: "Sample", value: orders.length + " completed orders" }],
          view: "habits"
        });
      }
    }
    const repeatSpend = paidAverageForKeys(model, current.repeatKeys, range.start, range.end);
    const firstSpend = paidAverageForKeys(model, new Set([...current.buyerKeys].filter(key => !current.repeatKeys.has(key))), range.start, range.end);
    if (current.repeatKeys.size >= 3 && firstSpend && repeatSpend && firstSpend.count >= 3 && repeatSpend.count >= 3 && repeatSpend.average >= firstSpend.average * 1.2) {
      insights.push({
        key: "repeat-customer-spend",
        type: "spend",
        title: "Returning customers spend more per paid order",
        explanation: "Their average paid order is " + (repeatSpend.average / firstSpend.average * 100 - 100).toFixed(0) + "% higher than first-time customers in this period.",
        evidence: [{ label: "Returning customer average", value: "R" + repeatSpend.average.toFixed(2) + " across " + repeatSpend.count + " paid orders" }, { label: "First-time customer average", value: "R" + firstSpend.average.toFixed(2) + " across " + firstSpend.count + " paid orders" }],
        view: "habits"
      });
    }
    const previousStart = range.previousStart;
    const previousEnd = range.previousEnd;
    const itemViews = new Map();
    const countViews = (start, end) => {
      for (const event of model.events) {
        if (event.event_type !== "product_view" || !event.item_id || !event.session_id || !within(event.occurred_at, start, end)) continue;
        if (!itemViews.has(event.item_id)) itemViews.set(event.item_id, { current: new Set(), previous: new Set() });
        const bucket = itemViews.get(event.item_id);
        (within(event.occurred_at, range.start, range.end) ? bucket.current : bucket.previous).add(event.session_id);
      }
    };
    countViews(previousStart, range.end);
    let risingItem = null;
    for (const [itemId, sets] of itemViews) {
      if (sets.current.size >= 3 && sets.previous.size >= 3 && sets.current.size >= sets.previous.size * 1.5 && (!risingItem || sets.current.size > risingItem.current)) {
        const item = model.itemMap.get(itemId);
        risingItem = { itemId, name: item && item.name || "A product or service", current: sets.current.size, previous: sets.previous.size };
      }
    }
    if (risingItem) {
      insights.push({
        key: "item-interest-increase",
        type: "interest",
        title: "More customers are viewing " + risingItem.name,
        explanation: "Recorded product views increased across identified sessions compared with the previous period.",
        evidence: [{ label: "Current views", value: risingItem.current + " unique sessions" }, { label: "Previous views", value: risingItem.previous + " unique sessions" }],
        view: "preferences"
      });
    }
    return insights.slice(0, 3);
  }

  function buildTopCustomers(model, current, range) {
    const rows = [];
    for (const key of current.buyerKeys) {
      const customer = model.customers.get(key);
      if (!customer) continue;
      const periodOrders = customer.orders.filter(row => qualifyingPurchase(row) && within(row.created_at, range.start, range.end));
      const paid = periodOrders.filter(paidPurchase);
      const paidSpend = paid.reduce((sum, row) => sum + row.subtotal, 0);
      const allPurchasesToEnd = customer.orders.filter(row => {
        const orderTime = timestamp(row.created_at);
        return qualifyingPurchase(row) && orderTime !== null && orderTime < range.end.getTime();
      }).length;
      const latest = periodOrders.reduce((best, row) => !best || timestamp(row.created_at) > timestamp(best.created_at) ? row : best, null);
      rows.push({
        key,
        name: customer.name,
        orders: periodOrders.length,
        paidSpend,
        paidOrders: paid.length,
        lastPurchase: latest && latest.created_at || "",
        status: allPurchasesToEnd > 1 ? "Returning" : "Active"
      });
    }
    return rows;
  }

  function buildJourney(model, range) {
    const events = model.events.filter(row => within(row.occurred_at, range.start, range.end) && row.session_id);
    const eventGroups = new Map();
    for (const event of events) {
      if (!eventGroups.has(event.session_id)) eventGroups.set(event.session_id, []);
      eventGroups.get(event.session_id).push({ type: event.event_type, time: timestamp(event.occurred_at), itemId: event.item_id });
    }
    const orderGroups = new Map();
    for (const order of model.orders.filter(row => within(row.created_at, range.start, range.end) && row.analytics_session_id)) {
      if (!orderGroups.has(order.analytics_session_id)) orderGroups.set(order.analytics_session_id, []);
      orderGroups.get(order.analytics_session_id).push({ type: "order_placed", time: timestamp(order.created_at), completed: qualifyingPurchase(order), orderId: order.id });
    }
    const visitSessions = new Set(events.filter(row => row.event_type === "store_visit").map(row => row.session_id));
    const funnel = { visits: visitSessions.size, productViews: 0, cartAdds: 0, checkoutStarts: 0, ordersPlaced: 0, completedOrders: 0 };
    for (const sessionId of visitSessions) {
      const steps = [...(eventGroups.get(sessionId) || []), ...(orderGroups.get(sessionId) || [])].sort((a, b) => (a.time || 0) - (b.time || 0));
      let cursor = -Infinity;
      const next = type => {
        const found = steps.find(step => step.type === type && step.time >= cursor);
        if (!found) return null;
        cursor = found.time;
        return found;
      };
      if (!next("store_visit")) continue;
      if (!next("product_view")) continue;
      funnel.productViews++;
      if (!next("cart_add")) continue;
      funnel.cartAdds++;
      if (!next("checkout_start")) continue;
      funnel.checkoutStarts++;
      const placed = next("order_placed");
      if (!placed) continue;
      funnel.ordersPlaced++;
      if (placed.completed) funnel.completedOrders++;
    }
    const serviceItemIds = new Set([...model.itemMap.values()].filter(item => item.item_type === "service").map(item => item.id));
    const serviceViewEvents = events.filter(row => row.event_type === "product_view" && serviceItemIds.has(row.item_id) && row.session_id);
    const serviceViewSessions = new Set();
    for (const view of serviceViewEvents) {
      const visit = events.find(row => row.event_type === "store_visit" && row.session_id === view.session_id && timestamp(row.occurred_at) <= timestamp(view.occurred_at));
      if (visit) serviceViewSessions.add(view.session_id);
    }
    const serviceBookingRows = model.bookings.filter(row => within(row.created_at, range.start, range.end));
    const linkedServiceBookingSessions = new Set();
    for (const booking of serviceBookingRows) {
      const bookingSession = booking.analytics_session_id;
      const bookingTime = timestamp(booking.created_at);
      if (!bookingSession || bookingTime === null) continue;
      const viewedService = serviceViewEvents.some(row => row.session_id === bookingSession && timestamp(row.occurred_at) <= bookingTime);
      const visited = events.some(row => row.event_type === "store_visit" && row.session_id === bookingSession && timestamp(row.occurred_at) <= bookingTime);
      if (viewedService && visited) linkedServiceBookingSessions.add(bookingSession);
    }
    const serviceVisitSessions = new Set(events.filter(row => row.event_type === "store_visit" && serviceViewSessions.has(row.session_id)).map(row => row.session_id));
    return {
      funnel,
      service: { visits: serviceVisitSessions.size, serviceViews: serviceViewSessions.size, bookingRequests: serviceBookingRows.length, linkedBookingSessions: linkedServiceBookingSessions.size },
      trackingAvailable: model.eventsAvailable
    };
  }

  function buildPreferences(model, range) {
    const purchaseMap = new Map();
    const viewMap = new Map();
    const optionMap = new Map();
    const itemMap = model.itemMap;
    function recordOption(value) {
      if (value === null || value === undefined || value === "") return;
      if (Array.isArray(value)) { value.forEach(recordOption); return; }
      if (typeof value === "object") {
        Object.entries(value).forEach(([key, nested]) => {
          const cleanKey = String(key).replace(/[_-]/g, " ").trim();
          if (["id", "item id", "price", "quantity", "note", "sku"].includes(cleanKey.toLowerCase())) return;
          if (typeof nested === "string" || typeof nested === "number") {
            const valueText = String(nested).trim();
            if (valueText && valueText.length <= 80) {
              const label = cleanKey + ": " + valueText;
              optionMap.set(label, (optionMap.get(label) || 0) + 1);
            }
          } else recordOption(nested);
        });
      }
    }
    for (const order of model.orders.filter(row => qualifyingPurchase(row) && within(row.created_at, range.start, range.end))) {
      for (const line of order.items) {
        if (!line || typeof line !== "object") continue;
        const itemId = String(line.item_id || line.itemId || line.id || "");
        const item = itemMap.get(itemId);
        const name = String(line.name || line.item_name || line.product_name || line.title || item && item.name || "Product or service");
        const quantity = Math.max(1, Number(line.quantity) || 1);
        const key = itemId || name;
        const row = purchaseMap.get(key) || { key, itemId, name, quantity: 0, orders: 0, type: item && item.item_type || "product" };
        row.quantity += quantity;
        row.orders++;
        purchaseMap.set(key, row);
        recordOption(line.selection || line.options || line.variants || {});
      }
    }
    const pairs = new Set();
    for (const event of model.events.filter(row => row.event_type === "product_view" && row.item_id && row.session_id && within(row.occurred_at, range.start, range.end))) {
      const pair = event.item_id + "\u0000" + event.session_id;
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      const item = itemMap.get(event.item_id);
      const name = item && item.name || "Product or service";
      const row = viewMap.get(event.item_id) || { key: event.item_id, itemId: event.item_id, name, sessions: 0, type: item && item.item_type || "product" };
      row.sessions++;
      viewMap.set(event.item_id, row);
    }
    return {
      purchased: [...purchaseMap.values()].sort((a, b) => b.quantity - a.quantity),
      viewed: [...viewMap.values()].sort((a, b) => b.sessions - a.sessions),
      options: [...optionMap].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    };
  }

  function buildModel(input) {
    const options = input || {};
    const businessId = String(options.businessId || "");
    const orders = (Array.isArray(options.orders) ? options.orders : []).map(normalizeOrder).filter(Boolean).filter(row => !businessId || row.business_id === businessId);
    const bookings = (Array.isArray(options.bookings) ? options.bookings : []).map(normalizeBooking).filter(Boolean).filter(row => !businessId || row.business_id === businessId);
    const events = (Array.isArray(options.events) ? options.events : []).map(normalizeEvent).filter(Boolean).filter(row => !businessId || row.business_id === businessId);
    const items = (Array.isArray(options.items) ? options.items : []).map(normalizeItem).filter(Boolean).filter(row => !businessId || row.business_id === businessId);
    const categories = (Array.isArray(options.categories) ? options.categories : []).map(normalizeCategory).filter(Boolean);
    const customers = buildIdentityGroups(orders, bookings);
    const itemMap = new Map(items.map(row => [row.id, row]));
    const categoryMap = new Map(categories.map(row => [row.id, row.name]));
    const period = options.period || "last30";
    const range = dateRange(period, options.custom, options.now || new Date());
    if (!range) return { valid: false, reason: "Choose a valid date range." };
    const current = makeMetrics({ orders, customers }, range.start, range.end);
    const previous = makeMetrics({ orders, customers }, range.previousStart, range.previousEnd);
    const model = { valid: true, businessId, period, range, orders, bookings, events, items, categories, customers, itemMap, categoryMap, eventsAvailable: options.eventsAvailable !== false, current, previous };
    model.series = buildSeries(model, range, model.eventsAvailable);
    model.insights = buildInsights(model, current, previous, range);
    model.topCustomers = buildTopCustomers(model, current, range);
    model.journey = buildJourney(model, range);
    model.preferences = buildPreferences(model, range);
    return model;
  }

  function purchaseIntervals(model) {
    const intervals = [];
    for (const group of model.customers.values()) {
      const dates = group.orders.filter(qualifyingPurchase).map(row => timestamp(row.created_at)).filter(value => value !== null).sort((a, b) => a - b);
      for (let index = 1; index < dates.length; index++) intervals.push((dates[index] - dates[index - 1]) / DAY_MS);
    }
    intervals.sort((a, b) => a - b);
    if (!intervals.length) return null;
    const middle = Math.floor(intervals.length / 2);
    const median = intervals.length % 2 ? intervals[middle] : (intervals[middle - 1] + intervals[middle]) / 2;
    return { medianDays: median, intervals: intervals.length };
  }

  function cohortRetention(model, now) {
    const cohorts = new Map();
    const asOf = (now instanceof Date ? now : new Date()).getTime();
    for (const group of model.customers.values()) {
      const dates = group.orders.filter(qualifyingPurchase).map(row => timestamp(row.created_at)).filter(value => value !== null).sort((a, b) => a - b);
      if (!dates.length) continue;
      const first = new Date(dates[0]);
      const key = first.getFullYear() + "-" + String(first.getMonth() + 1).padStart(2, "0");
      if (!cohorts.has(key)) cohorts.set(key, { key, customers: 0, repeatedWithin30Days: 0, mature: asOf - dates[0] >= 30 * DAY_MS });
      const cohort = cohorts.get(key);
      cohort.customers++;
      cohort.mature = cohort.mature && asOf - dates[0] >= 30 * DAY_MS;
      if (dates.some(value => value > dates[0] && value <= dates[0] + 30 * DAY_MS)) cohort.repeatedWithin30Days++;
    }
    return [...cohorts.values()].sort((a, b) => a.key.localeCompare(b.key)).map(row => ({
      ...row,
      repeatRate: row.mature && row.customers ? row.repeatedWithin30Days / row.customers * 100 : null
    }));
  }

  return Object.freeze({
    addDays,
    buildIdentityGroups,
    buildJourney,
    buildModel,
    buildPreferences,
    cohortRetention,
    createBuckets,
    dateRange,
    dayKey,
    normalizeEmail,
    normalizePhone,
    paidPurchase,
    purchaseIntervals,
    qualifyingPurchase,
    within
  });
});
