(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const authPanel = $("adminAuth");
  const workspace = $("adminWorkspace");
  const loginForm = $("adminLoginForm");
  const loginButton = $("adminLoginButton");
  const authMessage = $("adminAuthMessage");
  const accountNotice = $("adminAccountNotice");
  let client = null;
  let activeUser = null;

  function setMessage(message, error = false) {
    authMessage.textContent = message || "";
    authMessage.hidden = !message;
    authMessage.style.borderColor = error ? "#efc6c1" : "#b9e8dc";
    authMessage.style.background = error ? "#fff5f3" : "#effaf6";
    authMessage.style.color = error ? "#9b342a" : "#226450";
  }

  function showLogin(message = "", error = false) {
    workspace.hidden = true;
    authPanel.hidden = false;
    loginForm.hidden = false;
    accountNotice.hidden = true;
    setMessage(message, error);
  }

  function showAccountDenied(user) {
    workspace.hidden = true;
    authPanel.hidden = false;
    loginForm.hidden = true;
    accountNotice.hidden = false;
    $("adminAccountEmail").textContent = user?.email || "your signed-in account";
    setMessage("This account is signed in but is not authorized to open Platform Admin.", true);
  }

  function addCell(row, value, className = "") {
    const cell = document.createElement("td");
    if (className) cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
  }

  function formatDate(value) {
    if (!value) return "—";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat("en-ZA", {
      day: "numeric", month: "short", year: "numeric"
    }).format(parsed);
  }

  function renderReferrals(rows) {
    const table = $("publisherReferralRows");
    table.replaceChildren();
    const records = Array.isArray(rows) ? rows : [];
    let total = 0;

    if (!records.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "center";
      cell.textContent = "No Publisher referral accounts have been registered yet.";
      row.appendChild(cell);
      table.appendChild(row);
    }

    records.forEach((record) => {
      const count = Number(record.business_account_count) || 0;
      total += count;
      const row = document.createElement("tr");
      addCell(row, record.publisher_name || "Publisher");
      addCell(row, record.referral_code || "—");
      addCell(row, record.publisher_status || "—");
      addCell(row, new Intl.NumberFormat("en-ZA").format(count));
      addCell(row, formatDate(record.last_business_registered_at));
      table.appendChild(row);
    });

    $("adminReferralTotal").textContent = new Intl.NumberFormat("en-ZA").format(total);
    $("publisherReferralStatus").textContent = records.length
      ? records.length + (records.length === 1 ? " publisher" : " publishers")
      : "No publishers";
  }

  function friendlyAdminError(error) {
    if (error?.code === "42501" || /administrator access required|permission denied/i.test(error?.message || "")) {
      return "This account is signed in but is not authorized to open Platform Admin.";
    }
    return "Publisher referral reporting could not be loaded. Refresh the page and try again.";
  }

  async function loadReferrals() {
    $("publisherReferralStatus").textContent = "Loading";
    const { data, error } = await client.rpc("get_platform_admin_publisher_referrals");
    if (error) {
      console.error("Could not load the Publisher referral report:", error);
      if (error.code === "42501" || /administrator access required/i.test(error.message || "")) {
        showAccountDenied(activeUser);
        return;
      }
      showLogin(friendlyAdminError(error), true);
      return;
    }

    renderReferrals(data);
    $("adminSignedInAs").textContent = activeUser?.email || "Administrator";
    authPanel.hidden = true;
    workspace.hidden = false;
    const note = document.querySelector(".demo-note");
    if (note) note.innerHTML = "<strong>Live referral reporting.</strong> Publisher registration totals are connected to StoreNest accounts.";
  }

  async function routeCurrentSession() {
    try {
      const { data, error } = await client.auth.getUser();
      if (error) throw error;
      activeUser = data?.user || null;
      if (!activeUser) {
        showLogin();
        return;
      }
      await loadReferrals();
    } catch (error) {
      console.error("Could not check the Platform Admin session:", error);
      showLogin("Sign in with your StoreNest administrator account.", false);
    }
  }

  async function signOutAndSwitch() {
    if (client) await client.auth.signOut();
    activeUser = null;
    loginForm.reset();
    showLogin("Enter the administrator account details to continue.", false);
    $("adminEmail").focus();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");
    loginButton.disabled = true;
    loginButton.textContent = "Signing in…";
    try {
      const email = $("adminEmail").value.trim().toLowerCase();
      const password = $("adminPassword").value;
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      activeUser = data?.user || null;
      await loadReferrals();
    } catch (error) {
      console.error("Platform Admin sign-in failed:", error);
      showLogin("The email and password could not be verified. Check them and try again.", true);
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
  });

  $("adminSwitchAccount").addEventListener("click", signOutAndSwitch);
  $("adminSignOut").addEventListener("click", signOutAndSwitch);
  $("refreshPublisherRecruitment").addEventListener("click", loadReferrals);

  async function initialize() {
    try {
      if (!window.StoreNestCustomerAuth) throw new Error("StoreNest account sign-in is unavailable.");
      client = await window.StoreNestCustomerAuth.getBusinessClient();
      await routeCurrentSession();
    } catch (error) {
      console.error("Platform Admin could not initialize:", error);
      showLogin("StoreNest sign-in is unavailable right now. Refresh the page and try again.", true);
    }
  }

  initialize();
})();