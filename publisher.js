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

  function setView(view) {
    activeView = view;
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
    const url = new URL("/business-owner.html", window.location.origin);
    url.searchParams.set("ref", code);
    return url.toString();
  }

  function setPublisherReferralDetails() {
    const link = buildPublisherReferralLink();
    $("publisherReferralLink").value = link || "Referral link unavailable";
    $("publisherReferralCode").textContent = publisherProfile?.referral_code || "—";
    $("copyPublisherReferralLink").disabled = !link;
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

  function renderDashboard() {
    const displayName = publisherProfile?.display_name || "Publisher";
    const fullName = fullNameFromAccount() || displayName;
    const statusText = publisherProfile?.status === "active" ? "Active" : "Unavailable";
    $("sidebarDisplayName").textContent = displayName;
    $("sidebarInitials").textContent = initials(displayName);
    $("welcomeFullName").textContent = fullName.split(/\s+/)[0] || displayName;
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
    if (updateHistory && window.location.hash !== "#" + key) {
      window.history.pushState({ publisherSection: key }, "", "#" + key);
    }
    if (key === "businesses" && activeClient && publisherProfile?.id) {
      loadReferredBusinessAccounts();
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
    document.querySelectorAll("[data-signout]").forEach((button) => button.addEventListener("click", signOut));
    window.addEventListener("popstate", () => {
      const section = window.location.hash.replace(/^#/, "");
      if (activeView === "dashboard") setDashboardSection(section, false);
    });
    window.addEventListener("hashchange", () => {
      const section = window.location.hash.replace(/^#/, "");
      if (activeView === "dashboard") setDashboardSection(section, false);
    });
  }

  wireEvents();
  configureContactField("newAccountMethod", "newAccountContact", "newAccountContactLabel");
  configureContactField("loginMethod", "loginContact", "loginContactLabel");
  configureContactField("recoveryMethod", "recoveryContact", "recoveryContactLabel");
  initialize();
})();
