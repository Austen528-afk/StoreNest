(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const TERMS_VERSION = "publisher-account-v2";
  const SECTION_TITLES = {
    overview: "Overview",
    businesses: "My Businesses",
    earnings: "Earnings & Commissions",
    recruitment: "Recruitment",
    campaigns: "Campaigns",
    messages: "Messages",
    analytics: "Analytics",
    settings: "Settings"
  };

  let customerClient = null;
  let businessClient = null;
  let activeClient = null;
  let currentUser = null;
  let publisherProfile = null;
  let accountProfiles = { customer: null, businessOwner: null };
  let pendingSignup = null;
  let pendingPhoneRecovery = null;
  let recoveryAuthorized = false;
  let isSigningOut = false;
  let activeView = "loading";
  let registeredAuthListeners = false;
  let welcomeStoryTimer = null;
  let welcomeStorySwapTimeout = null;
  const WELCOME_STORY_INTERVAL_MS = 3000;
  let analyticsSelectedCategory = "recruitment";
  let publisherAnalyticsRefreshTimer = null;
  let publisherAnalyticsRequestToken = 0;
  const PUBLISHER_ANALYTICS_REFRESH_MS = 30000;

  function setView(view) {
    activeView = view;
    if (view !== "dashboard") stopPublisherAnalyticsRefresh();
    $("publisherLoading").hidden = true;
    document.querySelectorAll("[data-view]").forEach((element) => {
      element.hidden = element.dataset.view !== view;
    });
    if (view !== "dashboard") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setMessage(element, message, kind) {
    if (!element) return;
    element.textContent = message || "";
    element.hidden = !message;
    element.classList.toggle("success", kind === "success");
  }

  function clearMessages() {
    document.querySelectorAll(".form-message").forEach((element) => setMessage(element, "", ""));
  }

  function friendlyError(error) {
    const message = String(error?.message || "");
    if (/invalid login credentials/i.test(message)) return "The email or phone number and password do not match.";
    if (/email not confirmed|phone not confirmed/i.test(message)) return "Confirm your StoreNest email or phone, then try again.";
    if (/unsupported phone provider|phone provider is not enabled/i.test(message)) return "Phone codes are not enabled for this StoreNest project yet. Choose Email or use the verified email linked to your account.";
    if (/rate limit|over_email_send_rate_limit/i.test(message)) return "Too many attempts. Please wait a little and try again.";
    if (/user already registered|already been registered/i.test(message)) return "This email or phone may already belong to a StoreNest account. Sign in with that account instead.";
    if (/row-level security|permission denied|publisher_profiles/i.test(message)) return "StoreNest could not save your Publisher profile. Please try again, and contact support if it continues.";
    return message || "Something went wrong. Please try again.";
  }

  function setBusy(button, busy, busyText) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (busyText) button.textContent = busyText;
    } else {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.dataset.label) button.textContent = button.dataset.label;
    }
  }

  function selectedMethod(name) {
    return document.querySelector('input[name="' + name + '"]:checked')?.value || "email";
  }

  function configureContactField(methodName, inputId, labelId) {
    const method = selectedMethod(methodName);
    const input = $(inputId);
    if (!input) return;
    const email = method === "email";
    input.type = email ? "email" : "tel";
    input.autocomplete = email ? "username" : "tel";
    input.placeholder = email ? "you@example.com" : "072 123 4567 or +27 72 123 4567";
    const label = $(labelId);
    if (label) label.textContent = email ? "Email address" : "Phone number";
  }

  function fullNameFromAccount() {
    const metadata = currentUser?.user_metadata || {};
    return String(
      metadata.full_name ||
      accountProfiles.businessOwner?.full_name ||
      accountProfiles.customer?.profile_name ||
      metadata.profile_name ||
      ""
    ).trim();
  }

  function accountEmail() {
    return String(currentUser?.email || accountProfiles.customer?.contact_email || "").trim();
  }

  function accountPhone() {
    return String(currentUser?.phone || accountProfiles.customer?.contact_phone || "").trim();
  }

  async function getAuthUser(client) {
    if (!client) return null;
    try {
      const { data, error } = await client.auth.getUser();
      if (error) {
        if (!/session missing|auth session missing/i.test(error.message || "")) console.warn("Could not read a StoreNest auth session:", error.message);
        return null;
      }
      return data?.user || null;
    } catch (error) {
      console.warn("Could not read a StoreNest auth session:", error?.message || error);
      return null;
    }
  }

  async function readAccountProfiles(client, userId) {
    const profiles = { customer: null, businessOwner: null };
    const [customerResult, ownerResult] = await Promise.all([
      client.from("customer_profiles").select("user_id,profile_name,contact_email,contact_phone").eq("user_id", userId).maybeSingle(),
      client.from("business_owner_profiles").select("user_id,full_name").eq("user_id", userId).maybeSingle()
    ]);
    if (!customerResult.error) profiles.customer = customerResult.data || null;
    if (!ownerResult.error) profiles.businessOwner = ownerResult.data || null;
    return profiles;
  }

  async function readPublisherProfile(client, userId) {
    const { data, error } = await client
      .from("publisher_profiles")
      .select("id,user_id,display_name,status,referral_code,created_at,updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  function registerAuthListeners() {
    if (registeredAuthListeners) return;
    registeredAuthListeners = true;
    const clients = [...new Set([customerClient, businessClient].filter(Boolean))];
    clients.forEach((client) => {
      client.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") {
          activeClient = client;
          currentUser = session?.user || null;
          recoveryAuthorized = true;
          setMessage($("resetMessage"), "", "");
          setView("password-reset");
          return;
        }
        if (event === "SIGNED_OUT" && activeView === "dashboard" && !isSigningOut) {
          window.setTimeout(() => routeFromAvailableSessions(), 0);
        }
      });
    });
  }

  async function routeFromAvailableSessions() {
    const customerUser = await getAuthUser(customerClient);
    if (customerUser) {
      await openAccount(customerClient, customerUser);
      return;
    }
    const businessUser = businessClient === customerClient ? null : await getAuthUser(businessClient);
    if (businessUser) {
      await openAccount(businessClient, businessUser);
      return;
    }
    currentUser = null;
    activeClient = null;
    publisherProfile = null;
    accountProfiles = { customer: null, businessOwner: null };
    setView("choice");
  }

  async function initialize() {
    try {
      const auth = window.StoreNestCustomerAuth;
      if (!auth) throw new Error("StoreNest account sign-in could not be loaded. Refresh the page and try again.");
      customerClient = await auth.getClient();
      businessClient = typeof auth.getBusinessClient === "function" ? await auth.getBusinessClient() : customerClient;
      registerAuthListeners();

      const [customerUser, businessUser] = await Promise.all([
        getAuthUser(customerClient),
        businessClient === customerClient ? Promise.resolve(null) : getAuthUser(businessClient)
      ]);
      const params = new URLSearchParams(window.location.search);
      if (params.get("mode") === "reset") {
        if (customerUser) {
          activeClient = customerClient;
          currentUser = customerUser;
          recoveryAuthorized = true;
          setView("password-reset");
          return;
        }
        setView("forgot");
        setMessage($("recoveryMessage"), "Open the password reset link from your email to choose a new password.", "");
        return;
      }
      if (customerUser) {
        await openAccount(customerClient, customerUser);
      } else if (businessUser) {
        await openAccount(businessClient, businessUser);
      } else {
        setView("choice");
      }
    } catch (error) {
      console.error("Publisher sign-in could not initialize:", error);
      setView("choice");
      setMessage($("choiceMessage"), friendlyError(error), "error");
    }
  }

  async function openAccount(client, user) {
    activeClient = client;
    currentUser = user;
    accountProfiles = await readAccountProfiles(client, user.id);
    let profile;
    try {
      profile = await readPublisherProfile(client, user.id);
    } catch (error) {
      console.error("Publisher profile could not be loaded:", error);
      setView("blocked");
      $("blockedMessage").textContent = "The Publisher profile service is not available right now. Refresh the page or try again later.";
      return;
    }
    publisherProfile = profile;
    if (!profile) {
      prepareExistingPublisherRegistration();
      setView("publisher-register");
      return;
    }
    if (profile.status !== "active") {
      $("blockedMessage").textContent = "This Publisher profile is not currently active. Contact StoreNest support if you think this is a mistake.";
      setView("blocked");
      return;
    }
    renderDashboard();
    setView("dashboard");
    const desiredSection = window.location.hash.replace(/^#/, "");
    setDashboardSection(SECTION_TITLES[desiredSection] ? desiredSection : "overview", false);
  }

  function prepareExistingPublisherRegistration() {
    const fullName = fullNameFromAccount();
    $("registrationAccountName").textContent = fullName || "StoreNest member";
    $("registrationAccountEmail").textContent = accountEmail() || "Not provided";
    $("registrationAccountPhone").textContent = accountPhone() || "Not provided";
    $("existingFullName").value = fullName;
    $("existingDisplayName").value = publisherProfile?.display_name || fullName;
    $("existingTerms").checked = false;
    setMessage($("existingPublisherMessage"), "", "");
  }

  function initials(value) {
    const parts = String(value || "StoreNest").trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return parts.map((part) => part.slice(0, 1).toUpperCase()).join("") || "SN";
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(date);
  }

  function buildPublisherReferralLink() {
    const code = String(publisherProfile?.referral_code || "").trim();
    if (!code) return "";
    const url = new URL("/", window.location.origin);
    url.searchParams.set("ref", code);
    return url.toString();
  }

  function setPublisherReferralDetails() {
    const link = buildPublisherReferralLink();
    $("publisherReferralLink").value = link || "Referral link unavailable";
    $("publisherReferralCode").textContent = publisherProfile?.referral_code || "—";
    $("copyPublisherReferralLink").disabled = !link;
  }

  async function copyPublisherMessageLink() {
    const status = $("publisherMessageLinkStatus");
    const code = String(publisherProfile?.referral_code || "").trim();
    if (!code) {
      setMessage(status, "Your Publisher contact link is not available yet. Refresh and try again.", "error");
      return;
    }
    const link = new URL("/", window.location.origin);
    link.searchParams.set("message_publisher", code);
    try {
      await navigator.clipboard.writeText(link.toString());
      setMessage(status, "Publisher contact link copied. Share it with a StoreNest customer.", "success");
    } catch (error) {
      setMessage(status, "Clipboard access is unavailable. Copy this link from the browser address bar: " + link.toString(), "error");
    }
  }

  async function copyPublisherReferralLink() {
    const link = buildPublisherReferralLink();
    if (!link) {
      setMessage($("publisherReferralMessage"), "Your referral link is not available yet. Refresh the page and try again.", "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setMessage($("publisherReferralMessage"), "Referral link copied. Share it with the business owner you referred.", "success");
    } catch {
      $("publisherReferralLink").focus();
      $("publisherReferralLink").select();
      setMessage($("publisherReferralMessage"), "Select the link and copy it to share with the business owner.", "");
    }
  }

  function appendReferralCell(row, label, value, className) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (className) cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }

  function renderReferredBusinessAccounts(accounts) {
    const rows = $("publisherBusinessesRows");
    rows.replaceChildren();
    accounts.forEach((account) => {
      const storeNames = Array.isArray(account.store_names) ? account.store_names.filter(Boolean) : [];
      const ownerName = String(account.business_owner_name || "Business Owner").trim();
      const primaryName = storeNames[0] || ownerName || "Business Owner";
      const row = document.createElement("tr");
      const accountCell = document.createElement("td");
      accountCell.dataset.label = "Business account";
      const title = document.createElement("strong");
      title.textContent = primaryName;
      const subtitle = document.createElement("small");
      subtitle.textContent = storeNames.length
        ? "Business Owner: " + ownerName
        : "Business Owner account";
      accountCell.append(title, subtitle);
      row.appendChild(accountCell);

      appendReferralCell(row, "Registered", formatDate(account.registered_at));
      const storeCount = Number(account.store_count || 0);
      appendReferralCell(row, "Storefronts", storeCount + (storeCount === 1 ? " storefront" : " storefronts"));
      const publishedCount = Number(account.published_store_count || 0);
      const statusText = publishedCount > 0
        ? "Storefront published"
        : storeCount > 0
          ? "Storefront setup"
          : "Account registered";
      const statusCell = document.createElement("td");
      statusCell.dataset.label = "Status";
      const status = document.createElement("span");
      status.className = "referral-status";
      status.textContent = statusText;
      statusCell.appendChild(status);
      row.appendChild(statusCell);
      rows.appendChild(row);
    });
  }

  async function loadReferredBusinessAccounts() {
    $("publisherBusinessesLoading").hidden = false;
    $("publisherBusinessesError").hidden = true;
    $("publisherBusinessesEmpty").hidden = true;
    $("publisherBusinessesTableWrap").hidden = true;
    $("publisherBusinessesSummary").textContent = "Loading referred business accounts…";
    try {
      if (!activeClient || !publisherProfile?.id) throw new Error("Publisher account data is not ready. Refresh and try again.");
      const { data, error } = await activeClient.rpc("get_my_referred_business_accounts");
      if (error) throw error;
      const accounts = Array.isArray(data) ? data : [];
      renderReferredBusinessAccounts(accounts);
      $("publisherBusinessesLoading").hidden = true;
      $("publisherBusinessesEmpty").hidden = accounts.length > 0;
      $("publisherBusinessesTableWrap").hidden = accounts.length === 0;
      $("publisherBusinessesSummary").textContent = accounts.length + (accounts.length === 1 ? " referred Business Owner account" : " referred Business Owner accounts");
    } catch (error) {
      $("publisherBusinessesLoading").hidden = true;
      $("publisherBusinessesSummary").textContent = "Referred business accounts could not be loaded.";
      $("publisherBusinessesError").textContent = friendlyError(error);
      $("publisherBusinessesError").hidden = false;
    }
  }


  function formatCommissionMoney(value) {
    const amount = Number(value);
    return "R" + (Number.isFinite(amount) ? amount : 0).toFixed(2);
  }

  function appendCommissionCell(row, label, value, className) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (className) cell.className = className;
    if (value instanceof Node) cell.appendChild(value);
    else cell.textContent = value == null ? "" : String(value);
    row.appendChild(cell);
  }

  function renderPublisherCommissionRecords(records, emptyMessage) {
    const table = $("publisherCommissionRows");
    if (!table) return;
    table.replaceChildren();
    const commissions = Array.isArray(records) ? records : [];
    if (!commissions.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "earnings-empty-state";
      cell.textContent = emptyMessage || "No commission records yet.";
      row.appendChild(cell);
      table.appendChild(row);
      return;
    }

    commissions.forEach((record, index) => {
      const row = document.createElement("tr");
      appendCommissionCell(row, "#", "#" + String(index + 1).padStart(3, "0"), "earnings-record-number");

      const businessWrap = document.createElement("span");
      businessWrap.className = "earnings-business-name";
      const icon = document.createElement("span");
      icon.className = "earnings-business-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▦";
      const businessCopy = document.createElement("span");
      const businessName = document.createElement("strong");
      businessName.textContent = String(record.business_name || "Referred business");
      businessCopy.appendChild(businessName);
      if (record.is_test === true) {
        const testNote = document.createElement("small");
        testNote.className = "earnings-business-test-note";
        testNote.textContent = "Sandbox test · not payable";
        businessCopy.appendChild(testNote);
      }
      businessWrap.append(icon, businessCopy);
      appendCommissionCell(row, "Business", businessWrap);

      appendCommissionCell(row, "Your Commission (15%)", formatCommissionMoney(record.commission_amount), "earnings-amount");

      const paymentType = document.createElement("span");
      const isCollection = record.payment_type === "pay_on_collection";
      paymentType.className = "earnings-type-pill " + (isCollection ? "earnings-type-pill--pending" : "earnings-type-pill--earned");
      const paymentIcon = document.createElement("span");
      paymentIcon.setAttribute("aria-hidden", "true");
      paymentIcon.textContent = isCollection ? "▣" : "▰";
      paymentType.appendChild(paymentIcon);
      paymentType.appendChild(document.createTextNode(isCollection ? "Pay on Collection" : "Online Payment"));
      appendCommissionCell(row, "Payment Type", paymentType);

      const isEarned = record.status === "earned";
      const status = document.createElement("span");
      status.className = "earnings-status-pill " + (isEarned ? "earnings-status-pill--earned" : "earnings-status-pill--pending");
      const statusIcon = document.createElement("span");
      statusIcon.setAttribute("aria-hidden", "true");
      statusIcon.textContent = isEarned ? "✓" : "◷";
      status.appendChild(statusIcon);
      status.appendChild(document.createTextNode(isEarned ? "Earned" : "Pending"));
      appendCommissionCell(row, "Status", status);
      table.appendChild(row);
    });
  }

  async function loadPublisherCommissionDashboard() {
    const statusLabel = $("publisherEarningsDataStatus");
    const note = $("publisherEarningsRecordsNote");
    const statIds = [
      "publisherEarningsTotalEarned",
      "publisherEarningsPending",
      "publisherEarningsTotalCommissions",
      "publisherEarningsBusinesses"
    ];
    statIds.forEach((id) => { if ($(id)) $(id).textContent = "—"; });
    if (statusLabel) statusLabel.textContent = "Loading commission records…";

    try {
      if (!activeClient || !publisherProfile?.id) throw new Error("Publisher account data is not ready.");
      const [summaryResult, recordsResult] = await Promise.all([
        activeClient.rpc("get_my_publisher_commission_summary"),
        activeClient.rpc("get_my_publisher_commission_records")
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (recordsResult.error) throw recordsResult.error;

      const summary = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
      const records = Array.isArray(recordsResult.data) ? recordsResult.data : [];
      // Test-only rows are visible in the records table with an explicit label,
      // but must never inflate the Publisher's live earnings totals.
      const liveRecords = records.filter((record) => record.is_test !== true);
      const sumLiveCommissions = (status) => liveRecords
        .filter((record) => !status || record.status === status)
        .reduce((total, record) => total + (Number(record.commission_amount) || 0), 0);
      $("publisherEarningsTotalEarned").textContent = formatCommissionMoney(sumLiveCommissions("earned"));
      $("publisherEarningsPending").textContent = formatCommissionMoney(sumLiveCommissions("pending"));
      $("publisherEarningsTotalCommissions").textContent = formatCommissionMoney(sumLiveCommissions());
      $("publisherEarningsBusinesses").textContent = new Intl.NumberFormat("en-ZA").format(Number(summary?.referred_businesses) || 0);
      renderPublisherCommissionRecords(records);
      const hasTestRecord = records.some((record) => record.is_test === true);
      if (statusLabel) statusLabel.textContent = hasTestRecord
        ? "Connected · sandbox records separated"
        : "Connected to your commission records";
      if (note) note.textContent = hasTestRecord
        ? "Sandbox records are labelled and excluded from live totals. Only your commission information is shown."
        : "Only your commission amount and status are shown here.";
    } catch (error) {
      console.error("Publisher commission records could not be loaded:", error);
      if (statusLabel) statusLabel.textContent = "Commission data unavailable";
      if (note) note.textContent = "Your commission data could not be loaded. Refresh and try again.";
      renderPublisherCommissionRecords([], "Your commission records could not be loaded. Refresh and try again.");
    }
  }

  function startWelcomeStory(firstName) {
    const card = $("publisherWelcomeCard");
    const eyebrow = $("welcomeStoryEyebrow");
    const title = $("welcomeStoryTitle");
    const description = $("welcomeStoryDescription");
    if (!card || !eyebrow || !title || !description) return;

    if (welcomeStoryTimer) window.clearTimeout(welcomeStoryTimer);
    if (welcomeStorySwapTimeout) window.clearTimeout(welcomeStorySwapTimeout);
    card.classList.remove("is-changing");

    const slides = [
      {
        key: "welcome",
        eyebrow: "YOUR PUBLISHER WORKSPACE",
        title: "Welcome, " + (firstName || "Publisher"),
        description: "Your Publisher workspace is ready."
      },
      {
        key: "ready",
        eyebrow: "YOUR PUBLISHER WORKSPACE",
        title: "Your Publisher account is ready.",
        description: "Use this workspace to keep your StoreNest work organized as the Publisher tools are developed."
      },
      {
        key: "attention",
        eyebrow: "AI INSIGHTS",
        title: "AI detected elements that might need attention.",
        description: "AI reflections and recommendations for your StoreNest work."
      },
      {
        key: "recommendations",
        eyebrow: "AI REFLECTIONS & RECOMMENDATIONS",
        title: "AI reflections and recommendations",
        description: "Personalized guidance will appear here as the Publisher tools are developed."
      }
    ];

    let currentIndex = 0;
    const applySlide = (index) => {
      const slide = slides[index];
      card.dataset.welcomeSlide = slide.key;
      eyebrow.textContent = slide.eyebrow;
      title.textContent = slide.title;
      description.textContent = slide.description;
    };

    applySlide(currentIndex);
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const advance = () => {
      if (document.hidden || card.matches(":hover")) {
        welcomeStoryTimer = window.setTimeout(advance, 1000);
        return;
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= slides.length) return;

      card.classList.add("is-changing");
      welcomeStorySwapTimeout = window.setTimeout(() => {
        currentIndex = nextIndex;
        applySlide(currentIndex);
        window.requestAnimationFrame(() => card.classList.remove("is-changing"));

        if (currentIndex < slides.length - 1) {
          welcomeStoryTimer = window.setTimeout(advance, WELCOME_STORY_INTERVAL_MS);
        } else {
          welcomeStoryTimer = null;
        }
      }, prefersReducedMotion ? 0 : 420);
    };

    welcomeStoryTimer = window.setTimeout(advance, WELCOME_STORY_INTERVAL_MS);
  }

  function renderDashboard() {
    const displayName = publisherProfile?.display_name || "Publisher";
    const fullName = fullNameFromAccount() || displayName;
    const statusText = publisherProfile?.status === "active" ? "Active" : "Unavailable";
    $("sidebarDisplayName").textContent = displayName;
    $("sidebarInitials").textContent = initials(displayName);
    startWelcomeStory(fullName.split(/\s+/)[0] || displayName);
    $("memberSince").textContent = formatDate(publisherProfile?.created_at);
    $("publisherStatusPill").textContent = statusText;
    $("overviewStatus").textContent = statusText;
    $("settingsDisplayName").value = displayName;
    $("settingsFullName").textContent = fullName || "Not provided";
    $("settingsEmail").textContent = accountEmail() || "Not provided";
    $("settingsPhone").textContent = accountPhone() || "Not provided";
    setPublisherReferralDetails();
    setMessage($("settingsMessage"), "", "");
  }

  function setDashboardSection(section, updateHistory) {
    const key = SECTION_TITLES[section] ? section : "overview";
    document.querySelectorAll("[data-dashboard-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.dashboardPanel !== key;
    });
    document.querySelectorAll("[data-section-link]").forEach((button) => {
      const active = button.dataset.sectionLink === key;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    $("dashboardHeading").textContent = SECTION_TITLES[key];
    if (key === "analytics" && activeClient && publisherProfile?.id) startPublisherAnalyticsRefresh();
    else stopPublisherAnalyticsRefresh();
    if (updateHistory && window.location.hash !== "#" + key) {
      window.history.pushState({ publisherSection: key }, "", "#" + key);
    }
    if (key === "businesses" && activeClient && publisherProfile?.id) {
      loadReferredBusinessAccounts();
    }
    if (key === "earnings" && activeClient && publisherProfile?.id) {
      loadPublisherCommissionDashboard();
    }
  }


  const PUBLISHER_ANALYTICS_CATEGORIES = {
    recruitment: {
      category: "RECRUITMENT",
      title: "Recruitment Analytics",
      description: "Understand how effectively you attract and register new businesses.",
      metrics: ["Referral Visits", "Registrations", "Conversion Rate"],
      chartTitle: "Recruitment Trends",
      insight: "Referral registrations come from your saved referral relationships. StoreNest does not currently record referral-link visits, so conversion cannot be calculated."
    },
    commissions: {
      category: "COMMISSIONS",
      title: "Commissions Analytics",
      description: "Track the development of your own publisher earnings.",
      metrics: ["Total Earned", "Pending Commissions", "Commission Growth"],
      chartTitle: "Commission Earnings Over Time",
      insight: "This view includes only your persisted commission records. Test-only records are excluded from the live totals."
    },
    businesses: {
      category: "MY BUSINESSES",
      title: "My Businesses Analytics",
      description: "Monitor the development of your referred business network.",
      metrics: ["Registered", "Activated", "Inactive"],
      chartTitle: "Business Activation Snapshot",
      insight: "A referred business is counted as activated when it has at least one published storefront. No business sales or revenue are shown."
    },
    progression: {
      category: "PROGRESSION",
      title: "Progression Analytics",
      description: "Track progress toward higher publisher commission levels.",
      metrics: ["Current Share", "Next Level", "Milestone Progress"],
      chartTitle: "Commission Level Progression",
      insight: "Publisher level settings and qualification milestones are not stored yet. No progression estimate is shown."
    }
  };

  function setPublisherAnalyticsStatus(message) {
    const status = $("analyticsDataStatus");
    if (status) status.textContent = message;
  }

  function renderPublisherAnalyticsMetrics(categoryKey, values) {
    const config = PUBLISHER_ANALYTICS_CATEGORIES[categoryKey];
    const container = $("analyticsMetrics");
    if (!config || !container) return;
    container.setAttribute("aria-label", config.title + " summary metrics");
    const cards = config.metrics.map((label, index) => {
      const metric = values?.[index] || {};
      const card = document.createElement("article");
      card.className = "publisher-analytics-metric";
      const metricLabel = document.createElement("span");
      metricLabel.textContent = label;
      const metricValue = document.createElement("strong");
      metricValue.textContent = metric.value == null ? "—" : String(metric.value);
      const note = document.createElement("small");
      note.textContent = metric.note || "Waiting for live StoreNest records";
      card.append(metricLabel, metricValue, note);
      return card;
    });
    container.replaceChildren(...cards);
  }

  function setPublisherAnalyticsChartEmpty(title, caption, badge) {
    const svg = $("analyticsChartSvg");
    const bars = $("analyticsChartBars");
    const labels = $("analyticsChartLabels");
    const placeholder = $("analyticsChartPlaceholder");
    const line = $("analyticsChartLine");
    const fill = $("analyticsChartAreaFill");
    if (svg) svg.setAttribute("hidden", "");
    if (bars) {
      bars.hidden = true;
      bars.replaceChildren();
    }
    if (labels) {
      labels.hidden = true;
      labels.replaceChildren();
    }
    if (placeholder) placeholder.hidden = false;
    if (line) {
      line.setAttribute("hidden", "");
      line.setAttribute("d", "");
    }
    if (fill) {
      fill.setAttribute("hidden", "");
      fill.setAttribute("d", "");
    }
    if ($("analyticsChartPlaceholderTitle")) $("analyticsChartPlaceholderTitle").textContent = title;
    if ($("analyticsChartCaption")) $("analyticsChartCaption").textContent = caption;
    if ($("analyticsChartBadge") && badge) $("analyticsChartBadge").textContent = badge;
    const area = document.querySelector(".publisher-analytics-chart-area");
    if (area) area.setAttribute("aria-label", title + ". " + caption);
  }

  function recentPublisherMonths() {
    const now = new Date();
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
      const key = month.getFullYear() + "-" + String(month.getMonth() + 1).padStart(2, "0");
      return {
        key,
        start: month,
        end: new Date(month.getFullYear(), month.getMonth() + 1, 1),
        label: month.toLocaleDateString("en-ZA", { month: "short" })
      };
    });
  }

  function publisherMonthlySeries(records, dateField, amountField) {
    const months = recentPublisherMonths();
    const sums = new Map(months.map((month) => [month.key, 0]));
    (Array.isArray(records) ? records : []).forEach((record) => {
      const date = new Date(record?.[dateField]);
      if (!Number.isFinite(date.getTime())) return;
      const key = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
      if (!sums.has(key)) return;
      const amount = amountField ? Math.max(0, Number(record?.[amountField]) || 0) : 1;
      sums.set(key, sums.get(key) + amount);
    });
    return { labels: months.map((month) => month.label), values: months.map((month) => sums.get(month.key) || 0) };
  }

  function renderPublisherAnalyticsLineChart(values, labels, caption, badge) {
    const numericValues = Array.isArray(values) ? values.map((value) => Math.max(0, Number(value) || 0)) : [];
    const max = Math.max(0, ...numericValues);
    if (!numericValues.length || max <= 0) {
      setPublisherAnalyticsChartEmpty("No recent records yet", caption, "Live records");
      return;
    }
    const svg = $("analyticsChartSvg");
    const line = $("analyticsChartLine");
    const fill = $("analyticsChartAreaFill");
    const bars = $("analyticsChartBars");
    const placeholder = $("analyticsChartPlaceholder");
    const monthLabels = $("analyticsChartLabels");
    const chartArea = document.querySelector(".publisher-analytics-chart-area");
    if (!svg || !line || !fill) return;
    const xStart = 22;
    const xEnd = 678;
    const yTop = 34;
    const yBottom = 146;
    const points = numericValues.map((value, index) => {
      const x = xStart + ((xEnd - xStart) * index) / Math.max(1, numericValues.length - 1);
      const y = yBottom - (value / max) * (yBottom - yTop);
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });
    const linePath = "M " + points.map((point) => point.x + " " + point.y).join(" L ");
    const areaPath = linePath + " L " + xEnd + " 165 L " + xStart + " 165 Z";
    line.setAttribute("d", linePath);
    fill.setAttribute("d", areaPath);
    line.removeAttribute("hidden");
    fill.removeAttribute("hidden");
    svg.hidden = false;
    if (bars) {
      bars.hidden = true;
      bars.replaceChildren();
    }
    if (placeholder) placeholder.hidden = true;
    if ($("analyticsChartCaption")) $("analyticsChartCaption").textContent = caption;
    if ($("analyticsChartBadge")) $("analyticsChartBadge").textContent = badge || "Last 6 months";
    if (chartArea) chartArea.setAttribute("aria-label", caption);
    if (monthLabels) {
      monthLabels.replaceChildren(...labels.map((label) => {
        const month = document.createElement("span");
        month.textContent = label;
        return month;
      }));
      monthLabels.hidden = false;
    }
  }

  function renderPublisherActivationChart(activated, inactive, total) {
    if (!total) {
      setPublisherAnalyticsChartEmpty("No referred businesses yet", "Business activation appears when referred accounts are registered.", "Current status");
      return;
    }
    const svg = $("analyticsChartSvg");
    const bars = $("analyticsChartBars");
    const labels = $("analyticsChartLabels");
    const placeholder = $("analyticsChartPlaceholder");
    if (svg) svg.setAttribute("hidden", "");
    if (labels) {
      labels.hidden = true;
      labels.replaceChildren();
    }
    if (placeholder) placeholder.hidden = true;
    if (!bars) return;
    bars.replaceChildren();
    [
      { label: "Activated", value: activated, fillClass: "analytics-chart-bar-fill--active" },
      { label: "Not yet activated", value: inactive, fillClass: "analytics-chart-bar-fill--inactive" }
    ].forEach((item) => {
      const row = document.createElement("div");
      row.className = "analytics-chart-bar-row";
      const label = document.createElement("span");
      label.className = "analytics-chart-bar-label";
      label.textContent = item.label;
      const track = document.createElement("span");
      track.className = "analytics-chart-bar-track";
      const fill = document.createElement("span");
      fill.className = "analytics-chart-bar-fill " + item.fillClass;
      fill.style.width = Math.round((item.value / total) * 100) + "%";
      track.appendChild(fill);
      const value = document.createElement("strong");
      value.className = "analytics-chart-bar-value";
      value.textContent = new Intl.NumberFormat("en-ZA").format(item.value);
      row.append(label, track, value);
      bars.appendChild(row);
    });
    bars.hidden = false;
    if ($("analyticsChartCaption")) $("analyticsChartCaption").textContent = "Current published-storefront status across your referred businesses.";
    if ($("analyticsChartBadge")) $("analyticsChartBadge").textContent = "Current status";
    const area = document.querySelector(".publisher-analytics-chart-area");
    if (area) area.setAttribute("aria-label", "Business activation snapshot: " + activated + " activated, " + inactive + " not yet activated.");
  }

  function commissionGrowthMetric(records) {
    const now = new Date();
    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    let current = 0;
    let previous = 0;
    records.forEach((record) => {
      const date = new Date(record.created_at);
      if (!Number.isFinite(date.getTime())) return;
      const amount = Math.max(0, Number(record.commission_amount) || 0);
      if (date >= currentStart && date < nextStart) current += amount;
      else if (date >= previousStart && date < currentStart) previous += amount;
    });
    if (previous <= 0) return { value: "—", note: "No previous-month baseline" };
    const percent = ((current - previous) / previous) * 100;
    return {
      value: (percent > 0 ? "+" : "") + percent.toFixed(1) + "%",
      note: "Compared with the previous calendar month"
    };
  }

  function setPublisherAnalyticsProgressionUnavailable() {
    renderPublisherAnalyticsMetrics("progression", [
      { value: "—", note: "Current level is not saved" },
      { value: "—", note: "Level rules are not configured" },
      { value: "—", note: "Milestones are not configured" }
    ]);
    setPublisherAnalyticsChartEmpty(
      "Progression data is not configured",
      "StoreNest has not saved publisher levels or qualification milestones, so no progress is estimated.",
      "Not configured"
    );
    $("analyticsInsight").textContent = PUBLISHER_ANALYTICS_CATEGORIES.progression.insight;
    setPublisherAnalyticsStatus("Progression data unavailable");
  }

  async function loadPublisherAnalytics(categoryKey) {
    const key = categoryKey || analyticsSelectedCategory;
    if (!PUBLISHER_ANALYTICS_CATEGORIES[key]) return;
    if (key === "progression") {
      setPublisherAnalyticsProgressionUnavailable();
      return;
    }
    if (!activeClient || !publisherProfile?.id) {
      setPublisherAnalyticsStatus("Waiting for Publisher account");
      return;
    }
    const requestToken = ++publisherAnalyticsRequestToken;
    setPublisherAnalyticsStatus("Updating live StoreNest records…");
    try {
      if (key === "recruitment" || key === "businesses") {
        const { data, error } = await activeClient.rpc("get_my_referred_business_accounts");
        if (error) throw error;
        if (requestToken !== publisherAnalyticsRequestToken || key !== analyticsSelectedCategory) return;
        const accounts = Array.isArray(data) ? data : [];
        const registered = accounts.length;
        if (key === "recruitment") {
          const series = publisherMonthlySeries(accounts, "registered_at");
          renderPublisherAnalyticsMetrics(key, [
            { value: "—", note: "Referral visits are not tracked yet" },
            { value: new Intl.NumberFormat("en-ZA").format(registered), note: "Referred owner accounts" },
            { value: "—", note: "Requires referral-visit tracking" }
          ]);
          renderPublisherAnalyticsLineChart(
            series.values,
            series.labels,
            "Referred business registrations per month, using your saved referral relationships.",
            "Last 6 months"
          );
          $("analyticsInsight").textContent = registered
            ? "Your registered referrals are connected. Referral-link visits are not stored, so a conversion rate cannot be calculated."
            : "StoreNest is checking your saved referral relationships. Referral visits are not stored, so visits and conversion remain unavailable.";
        } else {
          const activated = accounts.filter((account) => Number(account.published_store_count || 0) > 0).length;
          const inactive = Math.max(0, registered - activated);
          renderPublisherAnalyticsMetrics(key, [
            { value: new Intl.NumberFormat("en-ZA").format(registered), note: "Referred owner accounts" },
            { value: new Intl.NumberFormat("en-ZA").format(activated), note: "At least one storefront published" },
            { value: new Intl.NumberFormat("en-ZA").format(inactive), note: "No storefront published yet" }
          ]);
          renderPublisherActivationChart(activated, inactive, registered);
          $("analyticsInsight").textContent = registered
            ? "Activation counts use published storefront status. Businesses without a published storefront may need setup support."
            : "No referred business accounts are registered yet. Activation will appear when a referred business publishes a storefront.";
        }
      } else if (key === "commissions") {
        const { data, error } = await activeClient.rpc("get_my_publisher_commission_records");
        if (error) throw error;
        if (requestToken !== publisherAnalyticsRequestToken || key !== analyticsSelectedCategory) return;
        const records = (Array.isArray(data) ? data : []).filter((record) => record?.is_test !== true);
        const totalEarned = records
          .filter((record) => record.status === "earned")
          .reduce((sum, record) => sum + (Number(record.commission_amount) || 0), 0);
        const pending = records
          .filter((record) => record.status === "pending")
          .reduce((sum, record) => sum + (Number(record.commission_amount) || 0), 0);
        const series = publisherMonthlySeries(records, "created_at", "commission_amount");
        renderPublisherAnalyticsMetrics(key, [
          { value: formatCommissionMoney(totalEarned), note: "Your earned commissions" },
          { value: formatCommissionMoney(pending), note: "Your pending commissions" },
          commissionGrowthMetric(records)
        ]);
        renderPublisherAnalyticsLineChart(
          series.values,
          series.labels,
          "Your eligible commissions recorded per month. StoreNest fees and business sales are not shown.",
          "Last 6 months"
        );
        $("analyticsInsight").textContent = "Only your persisted commission amounts and statuses are included. Demonstration records are excluded from live totals.";
      }
      setPublisherAnalyticsStatus("Live · updated " + new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }));
    } catch (error) {
      if (requestToken !== publisherAnalyticsRequestToken || key !== analyticsSelectedCategory) return;
      console.warn("Publisher Analytics could not be refreshed:", error?.message || error);
      setPublisherAnalyticsStatus("Live data unavailable");
    }
  }

  function stopPublisherAnalyticsRefresh() {
    if (publisherAnalyticsRefreshTimer !== null) {
      window.clearInterval(publisherAnalyticsRefreshTimer);
      publisherAnalyticsRefreshTimer = null;
    }
    publisherAnalyticsRequestToken += 1;
  }

  function startPublisherAnalyticsRefresh() {
    stopPublisherAnalyticsRefresh();
    if (!activeClient || !publisherProfile?.id) {
      setPublisherAnalyticsStatus("Publisher account required");
      return;
    }
    loadPublisherAnalytics(analyticsSelectedCategory);
    publisherAnalyticsRefreshTimer = window.setInterval(() => {
      const panel = $("analyticsPanel");
      if (!document.hidden && activeView === "dashboard" && panel && !panel.hidden && analyticsSelectedCategory !== "progression") {
        loadPublisherAnalytics(analyticsSelectedCategory);
      }
    }, PUBLISHER_ANALYTICS_REFRESH_MS);
  }

  function selectPublisherAnalyticsCategory(categoryKey) {
    const config = PUBLISHER_ANALYTICS_CATEGORIES[categoryKey];
    const panel = $("analyticsPanel");
    if (!config || !panel) return;
    analyticsSelectedCategory = categoryKey;

    panel.querySelectorAll("[data-analytics-tab]").forEach((button) => {
      const selected = button.dataset.analyticsTab === categoryKey;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
    });

    const selectedTab = panel.querySelector('[data-analytics-tab="' + categoryKey + '"]');
    const content = $("publisherAnalyticsContent");
    if (selectedTab && content) content.setAttribute("aria-labelledby", selectedTab.id);

    $("analyticsCategory").textContent = config.category;
    $("analyticsTitle").textContent = config.title;
    $("analyticsDescription").textContent = config.description;
    $("analyticsChartTitle").textContent = config.chartTitle;
    $("analyticsInsight").textContent = config.insight;

    renderPublisherAnalyticsMetrics(categoryKey, config.metrics.map(() => ({ value: "—", note: "Loading live StoreNest records" })));
    setPublisherAnalyticsChartEmpty("Loading live StoreNest records", "Waiting for your publisher-scoped data.", "Live records");

    if (categoryKey === "progression") {
      setPublisherAnalyticsProgressionUnavailable();
    } else if (!panel.hidden && activeClient && publisherProfile?.id) {
      loadPublisherAnalytics(categoryKey);
    } else {
      setPublisherAnalyticsStatus("Live records load when Analytics opens");
    }
  }

  async function createPublisherProfile(client, user, fullName, displayName) {
    const name = String(fullName || "").trim();
    const publisherName = String(displayName || "").trim();
    if (name.length < 2 || name.length > 100) throw new Error("Full name must be between 2 and 100 characters.");
    if (publisherName.length < 2 || publisherName.length > 80) throw new Error("Publisher display name must be between 2 and 80 characters.");
    if (!client || !user?.id) throw new Error("Sign in to your StoreNest account before creating a Publisher profile.");

    const { data: updatedUser, error: metadataError } = await client.auth.updateUser({
      data: { ...(user.user_metadata || {}), full_name: name }
    });
    if (metadataError) console.warn("StoreNest full name could not be updated:", metadataError.message);
    currentUser = updatedUser?.user || user;

    const { data, error } = await client
      .from("publisher_profiles")
      .insert({ user_id: user.id, display_name: publisherName })
      .select("id,user_id,display_name,status,referral_code,created_at,updated_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        const existing = await readPublisherProfile(client, user.id);
        if (existing) {
          publisherProfile = existing;
          await openAccount(client, currentUser);
          return;
        }
      }
      throw error;
    }
    publisherProfile = data;
    accountProfiles = await readAccountProfiles(client, user.id);
    renderDashboard();
    setView("dashboard");
    setDashboardSection("overview", false);
    window.history.replaceState({ publisherSection: "overview" }, "", window.location.pathname + window.location.search + "#overview");
  }

  function showSignupVerification(pending) {
    pendingSignup = pending;
    $("verificationDestination").textContent = pending.destination;
    $("verificationCode").value = "";
    setMessage($("verificationMessage"), "A confirmation code was sent. Enter it once to verify your StoreNest account.", "");
    setView("verify");
    $("verificationCode").focus();
  }

  async function submitNewPublisherAccount(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("newAccountSubmit");
    setBusy(button, true, "Creating account…");
    setMessage($("newAccountMessage"), "", "");
    try {
      const fullName = $("newAccountFullName").value.trim();
      const displayName = $("newAccountDisplayName").value.trim();
      const password = $("newAccountPassword").value;
      if (password !== $("newAccountPasswordConfirm").value) throw new Error("The passwords do not match.");
      if (!$("newAccountTerms").checked) throw new Error("Accept the Publisher Terms and Conditions to continue.");
      const method = selectedMethod("newAccountMethod");
      const result = await window.StoreNestCustomerAuth.createAccount(method, $("newAccountContact").value, password, {
        full_name: fullName,
        profile_name: fullName
      });
      const pending = {
        method: result.method,
        destination: result.destination,
        password: password,
        fullName: fullName,
        displayName: displayName,
        termsAccepted: true
      };
      if (result.user && result.session) {
        await createPublisherProfile(customerClient, result.user, fullName, displayName);
        return;
      }
      showSignupVerification(pending);
    } catch (error) {
      console.error("Publisher registration failed:", error);
      setMessage($("newAccountMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function verifyNewPublisherAccount(event) {
    event.preventDefault();
    if (!pendingSignup) {
      setMessage($("verificationMessage"), "Start registration again to request a new confirmation code.", "error");
      return;
    }
    const button = $("verifySignupButton");
    setBusy(button, true, "Confirming…");
    setMessage($("verificationMessage"), "", "");
    try {
      const result = await window.StoreNestCustomerAuth.verifyCode(
        pendingSignup.method,
        pendingSignup.destination,
        $("verificationCode").value
      );
      let user = result.user;
      if (!user) throw new Error("StoreNest did not return an account after confirmation. Sign in and continue.");
      if (!result.session) {
        const signedIn = await window.StoreNestCustomerAuth.signInWithPassword(
          pendingSignup.method,
          pendingSignup.destination,
          pendingSignup.password
        );
        user = signedIn.user || user;
      }
      pendingSignup.password = "";
      await createPublisherProfile(customerClient, user, pendingSignup.fullName, pendingSignup.displayName);
      pendingSignup = null;
    } catch (error) {
      console.error("Publisher account confirmation failed:", error);
      setMessage($("verificationMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function submitExistingPublisher(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("existingPublisherSubmit");
    setBusy(button, true, "Creating profile…");
    setMessage($("existingPublisherMessage"), "", "");
    try {
      if (!$("existingTerms").checked) throw new Error("Accept the Publisher Terms and Conditions to continue.");
      await createPublisherProfile(activeClient, currentUser, $("existingFullName").value, $("existingDisplayName").value);
    } catch (error) {
      console.error("Publisher profile creation failed:", error);
      setMessage($("existingPublisherMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function submitLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("loginSubmit");
    setBusy(button, true, "Signing in…");
    setMessage($("loginMessage"), "", "");
    try {
      const result = await window.StoreNestCustomerAuth.signInWithPassword(
        selectedMethod("loginMethod"),
        $("loginContact").value,
        $("loginPassword").value
      );
      if (!result.user) throw new Error("Sign-in did not complete. Check your details and try again.");
      activeClient = customerClient;
      await openAccount(customerClient, result.user);
    } catch (error) {
      console.error("Publisher sign-in failed:", error);
      setMessage($("loginMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function submitForgotPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("sendRecoveryButton");
    setBusy(button, true, "Sending…");
    setMessage($("recoveryMessage"), "", "");
    $("phoneRecoveryCodePanel").hidden = true;
    pendingPhoneRecovery = null;
    try {
      const method = selectedMethod("recoveryMethod");
      const value = $("recoveryContact").value;
      if (method === "email") {
        const email = window.StoreNestCustomerAuth.normalizeEmail(value);
        const { error } = await customerClient.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + window.location.pathname + "?mode=reset"
        });
        if (error) throw error;
        setMessage($("recoveryMessage"), "If that email is linked to a StoreNest account, a password reset message will be sent.", "success");
      } else {
        pendingPhoneRecovery = await window.StoreNestCustomerAuth.sendExistingAccountCode("phone", value);
        $("phoneRecoveryDestination").textContent = pendingPhoneRecovery.destination;
        $("phoneRecoveryCode").value = "";
        $("phoneRecoveryCodePanel").hidden = false;
        setMessage($("recoveryMessage"), "If that phone number is linked to a StoreNest account, a one-time code will be sent.", "success");
      }
    } catch (error) {
      console.error("StoreNest password recovery could not start:", error);
      setMessage($("recoveryMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function verifyPhoneRecovery() {
    if (!pendingPhoneRecovery) {
      setMessage($("recoveryMessage"), "Request a one-time code first.", "error");
      return;
    }
    const button = $("verifyPhoneRecovery");
    setBusy(button, true, "Confirming…");
    setMessage($("recoveryMessage"), "", "");
    try {
      const result = await window.StoreNestCustomerAuth.verifyCode(
        "phone",
        pendingPhoneRecovery.destination,
        $("phoneRecoveryCode").value
      );
      if (!result.user || !result.session) throw new Error("The phone code did not open a StoreNest session. Request a new code and try again.");
      activeClient = customerClient;
      currentUser = result.user;
      recoveryAuthorized = true;
      setView("password-reset");
    } catch (error) {
      console.error("Phone password recovery could not be confirmed:", error);
      setMessage($("recoveryMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function submitNewPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("saveNewPassword");
    setBusy(button, true, "Saving…");
    setMessage($("resetMessage"), "", "");
    try {
      const password = $("resetNewPassword").value;
      if (password !== $("resetNewPasswordConfirm").value) throw new Error("The passwords do not match.");
      if (!recoveryAuthorized || !activeClient) throw new Error("Open your StoreNest password reset link or confirm the phone code first.");
      const { data, error } = await activeClient.auth.updateUser({ password: password });
      if (error) throw error;
      currentUser = data?.user || currentUser;
      await activeClient.auth.signOut({ scope: "local" });
      recoveryAuthorized = false;
      setView("login");
      setMessage($("loginMessage"), "Your password has been updated. Sign in with the new password.", "success");
    } catch (error) {
      console.error("StoreNest password reset failed:", error);
      setMessage($("resetMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function savePublisherSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const button = $("savePublisherSettings");
    setBusy(button, true, "Saving…");
    setMessage($("settingsMessage"), "", "");
    try {
      const displayName = $("settingsDisplayName").value.trim();
      if (displayName.length < 2 || displayName.length > 80) throw new Error("Publisher display name must be between 2 and 80 characters.");
      const { data, error } = await activeClient
        .from("publisher_profiles")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("user_id", currentUser.id)
        .select("id,user_id,display_name,status,referral_code,created_at,updated_at")
        .single();
      if (error) throw error;
      publisherProfile = data;
      renderDashboard();
      setMessage($("settingsMessage"), "Publisher display name saved.", "success");
    } catch (error) {
      console.error("Publisher profile settings could not be saved:", error);
      setMessage($("settingsMessage"), friendlyError(error), "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function signOut() {
    const buttons = document.querySelectorAll("[data-signout]");
    buttons.forEach((button) => setBusy(button, true, "Signing out…"));
    isSigningOut = true;
    try {
      const clients = [...new Set([customerClient, businessClient].filter(Boolean))];
      const results = await Promise.allSettled(clients.map((client) => client.auth.signOut({ scope: "local" })));
      const failed = results.find((result) => result.status === "rejected" || result.value?.error);
      if (failed) {
        const error = failed.status === "rejected" ? failed.reason : failed.value.error;
        throw error;
      }
      currentUser = null;
      activeClient = null;
      publisherProfile = null;
      accountProfiles = { customer: null, businessOwner: null };
      setView("choice");
    } catch (error) {
      console.error("StoreNest sign-out failed:", error);
      setMessage($("settingsMessage"), friendlyError(error), "error");
    } finally {
      isSigningOut = false;
      buttons.forEach((button) => setBusy(button, false));
    }
  }

  function wireEvents() {
    $("startPublisherRegistration").addEventListener("click", () => {
      clearMessages();
      $("newAccountFullName").value = "";
      $("newAccountDisplayName").value = "";
      $("newAccountPassword").value = "";
      $("newAccountPasswordConfirm").value = "";
      $("newAccountTerms").checked = false;
      configureContactField("newAccountMethod", "newAccountContact", "newAccountContactLabel");
      setView("new-account");
    });
    $("openPublisherSignIn").addEventListener("click", () => {
      clearMessages();
      configureContactField("loginMethod", "loginContact", "loginContactLabel");
      setView("login");
    });
    $("loginToRegister").addEventListener("click", () => $("startPublisherRegistration").click());
    $("newAccountToLogin").addEventListener("click", () => $("openPublisherSignIn").click());
    document.querySelectorAll("[data-back-to-choice]").forEach((button) => button.addEventListener("click", () => setView("choice")));
    document.querySelectorAll("[data-back-to-login]").forEach((button) => button.addEventListener("click", () => setView("login")));
    $("existingRegistrationBack").addEventListener("click", () => { window.location.assign("/"); });
    $("newPublisherAccountForm").addEventListener("submit", submitNewPublisherAccount);
    $("publisherVerifyForm").addEventListener("submit", verifyNewPublisherAccount);
    $("existingPublisherForm").addEventListener("submit", submitExistingPublisher);
    $("publisherLoginForm").addEventListener("submit", submitLogin);
    $("forgotPasswordForm").addEventListener("submit", submitForgotPassword);
    $("newPasswordForm").addEventListener("submit", submitNewPassword);
    $("publisherSettingsForm").addEventListener("submit", savePublisherSettings);
    $("copyPublisherReferralLink").addEventListener("click", copyPublisherReferralLink);
  $("copyPublisherMessageLink").addEventListener("click", copyPublisherMessageLink);
    $("openForgotPassword").addEventListener("click", () => {
      clearMessages();
      $("phoneRecoveryCodePanel").hidden = true;
      configureContactField("recoveryMethod", "recoveryContact", "recoveryContactLabel");
      setView("forgot");
    });
    $("resendSignupCode").addEventListener("click", async () => {
      if (!pendingSignup) return;
      const button = $("resendSignupCode");
      setBusy(button, true, "Sending…");
      setMessage($("verificationMessage"), "", "");
      try {
        await window.StoreNestCustomerAuth.resendConfirmation(pendingSignup.method, pendingSignup.destination);
        setMessage($("verificationMessage"), "A new confirmation code was sent.", "success");
      } catch (error) {
        setMessage($("verificationMessage"), friendlyError(error), "error");
      } finally {
        setBusy(button, false);
      }
    });
    $("cancelSignupVerification").addEventListener("click", () => {
      pendingSignup = null;
      setView("choice");
    });
    $("verifyPhoneRecovery").addEventListener("click", verifyPhoneRecovery);
    document.querySelectorAll('input[name="newAccountMethod"]').forEach((input) => input.addEventListener("change", () => configureContactField("newAccountMethod", "newAccountContact", "newAccountContactLabel")));
    document.querySelectorAll('input[name="loginMethod"]').forEach((input) => input.addEventListener("change", () => configureContactField("loginMethod", "loginContact", "loginContactLabel")));
    document.querySelectorAll('input[name="recoveryMethod"]').forEach((input) => input.addEventListener("change", () => {
      configureContactField("recoveryMethod", "recoveryContact", "recoveryContactLabel");
      $("phoneRecoveryCodePanel").hidden = true;
    }));
    document.querySelectorAll("[data-section-link]").forEach((button) => button.addEventListener("click", () => setDashboardSection(button.dataset.sectionLink, true)));

    const analyticsTabs = [...document.querySelectorAll("[data-analytics-tab]")];
    analyticsTabs.forEach((button) => button.addEventListener("click", () => {
      selectPublisherAnalyticsCategory(button.dataset.analyticsTab);
    }));
    document.querySelector("[data-analytics-tablist]")?.addEventListener("keydown", (event) => {
      const currentButton = event.target.closest("[data-analytics-tab]");
      if (!currentButton) return;
      const currentIndex = analyticsTabs.indexOf(currentButton);
      if (currentIndex < 0 || !analyticsTabs.length) return;
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % analyticsTabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + analyticsTabs.length) % analyticsTabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = analyticsTabs.length - 1;
      else return;
      event.preventDefault();
      analyticsTabs[nextIndex].focus();
      selectPublisherAnalyticsCategory(analyticsTabs[nextIndex].dataset.analyticsTab);
    });
    selectPublisherAnalyticsCategory("recruitment");

    document.querySelectorAll("[data-signout]").forEach((button) => button.addEventListener("click", signOut));
    window.addEventListener("popstate", () => {
      const section = window.location.hash.replace(/^#/, "");
      if (activeView === "dashboard") setDashboardSection(section, false);
    });
    window.addEventListener("hashchange", () => {
      const section = window.location.hash.replace(/^#/, "");
      if (activeView === "dashboard") setDashboardSection(section, false);
    });
    document.addEventListener("visibilitychange", () => {
      const panel = $("analyticsPanel");
      if (!document.hidden && activeView === "dashboard" && panel && !panel.hidden && analyticsSelectedCategory !== "progression") {
        loadPublisherAnalytics(analyticsSelectedCategory);
      }
    });
    window.addEventListener("focus", () => {
      const panel = $("analyticsPanel");
      if (activeView === "dashboard" && panel && !panel.hidden && analyticsSelectedCategory !== "progression") {
        loadPublisherAnalytics(analyticsSelectedCategory);
      }
    });
  }

  wireEvents();
  configureContactField("newAccountMethod", "newAccountContact", "newAccountContactLabel");
  configureContactField("loginMethod", "loginContact", "loginContactLabel");
  configureContactField("recoveryMethod", "recoveryContact", "recoveryContactLabel");
  initialize();
})();

