"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const sourceFiles = ["business-owner.html", "storefront.html", "service-bookings.js", "sw.js", "analytics-dashboard.css", "analytics-dashboard.js", "storefront-analytics.js", "supabase/migrations/20261111104421_storefront_analytics.sql", "supabase/migrations/20261111104615_storefront_analytics_indexes.sql", "supabase/migrations/20261111105224_service_booking_analytics_attribution.sql"];
const fullCheckoutAvailable = sourceFiles.every(filename => fs.existsSync(path.join(__dirname, "..", filename)));

if (!fullCheckoutAvailable) {
  test("static integration checks require the complete StoreNest checkout", { skip: "The isolated workspace has analytics modules but not the full StoreNest source checkout." }, () => {});
} else {
const read = filename => fs.readFileSync(path.join(__dirname, "..", filename), "utf8");
const ownerHtml = read("business-owner.html");
const storefrontHtml = read("storefront.html");
const serviceBookingsJs = read("service-bookings.js");
const trackerJs = read("storefront-analytics.js");
const styles = read("analytics-dashboard.css");
const dashboardJs = read("analytics-dashboard.js");
const serviceWorker = read("sw.js");
const migration = read("supabase/migrations/20261111104421_storefront_analytics.sql");
const indexMigration = read("supabase/migrations/20261111104615_storefront_analytics_indexes.sql");
const bookingMigration = read("supabase/migrations/20261111105224_service_booking_analytics_attribution.sql");

test("the existing owner dashboard contains one Analytics section with the four shared-row metrics", () => {
  assert.match(ownerHtml, /id="analyticsDashboard"[^>]*data-section-view="analytics"/);
  for (const id of ["analyticsDateRange", "analyticsMetric", "analyticsSummary", "analyticsChart", "smartInsightList", "analyticsExploreMenu", "analyticsExploreToggle", "analyticsExploreList", "analyticsBusinessBack", "analyticsTrendsDescription", "analyticsInsightDetail"]) {
    assert.match(ownerHtml, new RegExp('id="' + id + '"'));
  }
  assert.match(ownerHtml, /analytics-dashboard.css/);
  assert.match(ownerHtml, /analytics-engine.js/);
  assert.match(ownerHtml, /analytics-dashboard.js/);
  assert.match(ownerHtml, /data-analytics-view="customers"/);
  assert.match(ownerHtml, /data-analytics-view="products"/);
  assert.match(ownerHtml, /data-analytics-view="orders"/);
  assert.match(ownerHtml, /data-analytics-view="operations"/);
  assert.match(styles, /.analytics-summary-row\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*border:1px solid/);
  assert.doesNotMatch(styles, /.analytics-summary-item\{[^}]*border:/);
});
test("Analytics categories stay in one Explore menu beside the timeframe", () => {
  const headerStart = ownerHtml.indexOf('<header class="analytics-header">');
  const headerEnd = ownerHtml.indexOf("</header>", headerStart);
  const header = ownerHtml.slice(headerStart, headerEnd);
  assert.ok(header.indexOf('id="analyticsExploreMenu"') < header.indexOf('id="analyticsDateRange"'));
  assert.match(ownerHtml, /id="analyticsExploreToggle"[^>]*aria-controls="analyticsExploreList"/);
  assert.equal((ownerHtml.match(/data-analytics-view=/g) || []).length, 4);
  assert.doesNotMatch(ownerHtml, /analytics-explore-panel|analyticsExploreTitle|Explore Your Business/);
  assert.doesNotMatch(ownerHtml, /analyticsBusinessDetail|analytics-view-summary|analytics-view-grid/);
  const trendsStart = ownerHtml.indexOf('class="analytics-card analytics-card-trends"');
  const trendsEnd = ownerHtml.indexOf('id="analyticsChart"', trendsStart);
  const trends = ownerHtml.slice(trendsStart, trendsEnd + 80);
  assert.ok(trends.indexOf('id="analyticsBusinessBack"') >= 0);
  assert.ok(trends.indexOf('id="analyticsBusinessBack"') < trends.indexOf('id="analyticsChart"'));
  assert.match(ownerHtml, /option value="product_views"/);
  assert.match(ownerHtml, /option value="bookings"/);
});

test("customer intelligence shortcuts open from one borderless list beside the timeframe", () => {
  const headerStart = ownerHtml.indexOf('<header class="customer-header">');
  const headerEnd = ownerHtml.indexOf("</header>", headerStart);
  const header = ownerHtml.slice(headerStart, headerEnd);
  const toggleIndex = header.indexOf('id="customerExploreToggle"');
  const listStart = header.indexOf('id="customerExploreList"');
  const listEnd = header.indexOf("</ul>", listStart);
  const list = header.slice(listStart, listEnd);
  assert.ok(toggleIndex >= 0 && listStart > toggleIndex && listEnd > listStart);
  for (const view of ["overview", "behaviour", "preferences", "habits", "journey", "retention"]) {
    assert.match(list, new RegExp('data-customer-view="' + view + '"'));
  }
  assert.ok(toggleIndex < header.indexOf('id="customerDateRange"'));
  assert.doesNotMatch(ownerHtml, /customer-explore-nav|customer-explore-grid|customer-explore-card/);
  assert.match(read("customer-dashboard.css"), /\.customer-explore-option\{[^}]*border:0/);
  assert.match(read("customer-dashboard.js"), /customerExploreToggle[\s\S]*setExploreMenuOpen\(false, true\)/);
});

test("category clicks update only the shared summary row and trends chart and return to overview", () => {
  const start = dashboardJs.indexOf("  function setAnalyticsView(view) {");
  const end = dashboardJs.indexOf("  function renderInsights(snapshot) {", start);
  const handler = dashboardJs.slice(start, end);
  assert.match(handler, /renderSummary\(snapshot, state\.activeView\)/);
  assert.match(handler, /renderChart\(snapshot\)/);
  assert.doesNotMatch(handler, /renderInsights|smartInsightList|analytics-main-grid|hidden\s*=/);
  assert.match(dashboardJs, /setAnalyticsView\(state\.activeView === selectedView \? "" : selectedView\)/);
  assert.match(dashboardJs, /setAnalyticsView\(""\)/);
  assert.match(dashboardJs, /querySelectorAll\("\[data-analytics-view\]"\)\.forEach\(button => \{\s*button\.addEventListener\("click"/);
  const navStart = ownerHtml.indexOf('id="analyticsExploreMenu"');
  const navEnd = ownerHtml.indexOf("</ul>", navStart);
  assert.doesNotMatch(ownerHtml.slice(navStart, navEnd), /aria-pressed/);
  assert.doesNotMatch(dashboardJs, /renderExplore|renderBusinessView|analyticsBusinessDetail/);
});

test("desktop Analytics fits the dashboard viewport without page scrolling", () => {
  assert.match(styles, /@media\s*\(min-width:\s*1100px\)[\s\S]*?\.workspace:has\(#analyticsDashboard:not\(\[hidden\]\)\)\{[^}]*overflow:hidden/);
  assert.match(styles, /\.analytics-content:not\(\[hidden\]\)\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow:hidden/);
  assert.match(styles, /\.analytics-main-grid\{[^}]*flex:1 1 auto[^}]*min-height:0/);
  assert.match(styles, /\.analytics-insight-list\{[^}]*overflow-y:auto/);
});

test("successful Analytics loads render the calculated snapshot", () => {
  assert.ok(dashboardJs.includes("render(currentSnapshot());"));
  assert.equal(dashboardJs.includes('pageState({ loading: false, error: "" });\\n      render();'), false);
});

test("the dashboard does not show the tracking status strip above the metrics", () => {
  assert.equal(dashboardJs.includes("StoreNest is not recording storefront sessions yet"), false);
  assert.equal(dashboardJs.includes("Visit tracking is available, but same-session order attribution is not connected yet"), false);
});

test("the historical tracking note row is removed from Analytics entirely", () => {
  assert.equal(ownerHtml.includes("analyticsTrackingNote"), false);
  assert.equal(ownerHtml.includes("StoreNest has no historical storefront session records"), false);
  assert.equal(dashboardJs.includes("analyticsTrackingNote"), false);
  assert.doesNotMatch(styles, /analytics-tracking-note/);
});

test("owner page markup does not emit literal escaped newline text", () => {
  assert.equal(ownerHtml.includes('href="/messaging-centre.css">\\n  <link'), false);
  assert.equal(ownerHtml.includes('<script src="/payments-dashboard.js?v=46"></script>\\n<script'), false);
});

test("storefront tracking runs only for public business content and records same-session order attribution", () => {
  assert.ok(storefrontHtml.includes("window.StoreNestAnalyticsTracker?.visit(business.id)"));
  assert.ok(storefrontHtml.includes("window.StoreNestAnalyticsTracker?.productView(activePublicBusiness?.id,item.id)"));
  assert.ok(storefrontHtml.includes("window.StoreNestAnalyticsTracker?.cartAdd(activePublicBusiness?.id,item.id)"));
  assert.ok(storefrontHtml.includes("window.StoreNestAnalyticsTracker?.checkoutStart(payload.business_id)"));
  assert.ok(storefrontHtml.includes("analytics_session_id:window.StoreNestAnalyticsTracker?.sessionId()||null"));
  assert.ok(serviceBookingsJs.includes("StoreNestAnalyticsTracker?.productView(business.id,item.id)"));
  assert.ok(serviceBookingsJs.includes("analytics_session_id:window.StoreNestAnalyticsTracker?.sessionId()||null"));
  assert.match(storefrontHtml, /storefront-analytics.js/);
  assert.ok(trackerJs.includes("30 * 60 * 1000"));
  assert.match(trackerJs, /storefront_analytics_events/);
  assert.match(trackerJs, /crypto.subtle.digest\("SHA-256"/);
  assert.doesNotMatch(trackerJs, /customer_name|contact_phone|contact_email|message.body/i);
});

test("analytics schema restricts event reads and insight state to the owning business", () => {
  assert.match(migration, /alter table public.storefront_analytics_events enable row level security/i);
  assert.match(migration, /for insert to anon, authenticated/i);
  assert.match(migration, /b.is_published = true/i);
  assert.match(migration, /b.owner_id = \(select auth.uid\(\)\)/i);
  assert.match(migration, /for select to authenticated/i);
  assert.match(migration, /status in \('new', 'viewed', 'action_taken', 'dismissed'\)/i);
  assert.match(migration, /add column if not exists analytics_session_id uuid/i);
  assert.match(migration, /grant insert \(analytics_session_id\) on public\.storefront_orders to authenticated/i);
  assert.match(migration, /grant select \(analytics_session_id\) on public\.storefront_orders to authenticated/i);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/i);
  assert.match(indexMigration, /drop index if exists public\.storefront_analytics_events_business_session_idx/i);
  assert.match(indexMigration, /on public\.storefront_analytics_events \(item_id\)/i);
  assert.match(bookingMigration, /add column if not exists analytics_session_id uuid/i);
  assert.match(bookingMigration, /grant insert \(analytics_session_id\)[\s\S]*to anon, authenticated/i);
  assert.match(bookingMigration, /grant select \(analytics_session_id\)[\s\S]*to authenticated/i);
});

test("service worker activates the new dashboard assets in a fresh cache", () => {
  assert.match(serviceWorker, /storenest-shell-v60/);
  for (const asset of ["analytics-dashboard.css", "analytics-engine.js", "analytics-dashboard.js", "customer-dashboard.css", "customer-intelligence-engine.js", "customer-dashboard.js", "storefront-analytics.js"]) {
    assert.match(serviceWorker, new RegExp("/" + asset.replaceAll(".", "\\.")));
  }
  assert.match(serviceWorker, /\.then\(\(\)=>self\.skipWaiting\(\)\)/);
});
}
