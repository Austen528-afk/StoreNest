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


  function formatRand(value) {
    const amount = Number(value);
    return "R" + (Number.isFinite(amount) ? amount : 0).toFixed(2);
  }

  function renderCommissionReport(rows) {
    const records = Array.isArray(rows) ? rows : [];
    const performance = $("publisherCommissionPerformanceRows");
    const balance = $("publisherCommissionBalanceRows");
    performance.replaceChildren();
    balance.replaceChildren();

    if (!records.length) {
      const performanceRow = document.createElement("tr");
      const performanceCell = document.createElement("td");
      performanceCell.colSpan = 6;
      performanceCell.className = "center";
      performanceCell.textContent = "No referred business commission records yet.";
      performanceRow.appendChild(performanceCell);
      performance.appendChild(performanceRow);

      const balanceRow = document.createElement("tr");
      const balanceCell = document.createElement("td");
      balanceCell.colSpan = 5;
      balanceCell.className = "center";
      balanceCell.textContent = "No Publisher commission balances yet.";
      balanceRow.appendChild(balanceCell);
      balance.appendChild(balanceRow);
      $("publisherCommissionPerformanceStatus").textContent = "No records";
      $("publisherCommissionBalanceStatus").textContent = "No records";
      return;
    }

    records.forEach((record) => {
      const recordType = record.is_test === true ? "TEST · not payable" : "Live";
      const performanceRow = document.createElement("tr");
      addCell(performanceRow, record.publisher_name || "Publisher");
      addCell(performanceRow, record.business_name || "Referred business");
      addCell(performanceRow, formatRand(record.sales_generated));
      addCell(performanceRow, formatRand(record.platform_fees_collected));
      addCell(performanceRow, formatRand(record.outstanding_platform_fees));
      const typeCell = document.createElement("td");
      if (record.is_test === true) {
        const badge = document.createElement("span");
        badge.className = "commission-test-tag";
        badge.textContent = recordType;
        typeCell.appendChild(badge);
      } else {
        typeCell.textContent = recordType;
      }
      performanceRow.appendChild(typeCell);
      performance.appendChild(performanceRow);

      const balanceRow = document.createElement("tr");
      addCell(balanceRow, record.publisher_name || "Publisher");
      addCell(balanceRow, record.business_name || "Referred business");
      addCell(balanceRow, formatRand(record.publisher_commission_earned));
      addCell(balanceRow, formatRand(record.publisher_commission_pending));
      const balanceTypeCell = document.createElement("td");
      if (record.is_test === true) {
        const badge = document.createElement("span");
        badge.className = "commission-test-tag";
        badge.textContent = recordType;
        balanceTypeCell.appendChild(badge);
      } else {
        balanceTypeCell.textContent = recordType;
      }
      balanceRow.appendChild(balanceTypeCell);
      balance.appendChild(balanceRow);
    });

    const summary = records.length + (records.length === 1 ? " business record" : " business records");
    $("publisherCommissionPerformanceStatus").textContent = summary;
    $("publisherCommissionBalanceStatus").textContent = summary;
  }

  function renderCommissionReportError() {
    const performance = $("publisherCommissionPerformanceRows");
    const balance = $("publisherCommissionBalanceRows");
    performance.replaceChildren();
    balance.replaceChildren();
    const performanceRow = document.createElement("tr");
    const performanceCell = document.createElement("td");
    performanceCell.colSpan = 6;
    performanceCell.className = "center";
    performanceCell.textContent = "Commission performance could not be loaded.";
    performanceRow.appendChild(performanceCell);
    performance.appendChild(performanceRow);
    const balanceRow = document.createElement("tr");
    const balanceCell = document.createElement("td");
    balanceCell.colSpan = 5;
    balanceCell.className = "center";
    balanceCell.textContent = "Commission balances could not be loaded.";
    balanceRow.appendChild(balanceCell);
    balance.appendChild(balanceRow);
    $("publisherCommissionPerformanceStatus").textContent = "Unavailable";
    $("publisherCommissionBalanceStatus").textContent = "Unavailable";
  }

  async function loadCommissionReport() {
    try {
      const { data, error } = await client.rpc("get_platform_admin_publisher_commission_report");
      if (error) throw error;
      renderCommissionReport(data);
    } catch (error) {
      console.error("Could not load the Publisher commission report:", error);
      renderCommissionReportError();
    }
  }

  function setTestFeedback(message, error = false) {
    const feedback = $("publisherCommissionTestFeedback");
    feedback.textContent = message || "";
    feedback.hidden = !message;
    feedback.dataset.state = error ? "error" : "success";
  }

  async function runPublisherCommissionTest1() {
    const button = $("runPublisherCommissionTest1");
    if (!client || !activeUser || !window.confirm(
      "Run the controlled Test 1 for LEON and Dino? It creates one isolated, clearly marked test record and does not publish a storefront, process a payment, recover a fee, or pay a commission."
    )) return;

    button.disabled = true;
    button.textContent = "Running Test 1…";
    setTestFeedback("");
    try {
      const { data, error } = await client.rpc("run_publisher_commission_test_1");
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || Number(result.fee_record_count) !== 1 || Number(result.commission_record_count) !== 1) {
        throw new Error("Test 1 did not return exactly one persisted fee record and one commission record.");
      }
      setTestFeedback(
        "Test 1 verified for " + (result.business_name || "Dino") + ": " +
        formatRand(result.outstanding_fees) + " outstanding fee and " +
        formatRand(result.commission_pending) + " pending commission. One fee record and one commission record remain after repeated confirmation. Test data is non-payable."
      );
      await loadReferrals();
    } catch (error) {
      console.error("Publisher Test 1 could not be completed:", error);
      setTestFeedback(error?.message || "Test 1 could not be completed.", true);
    } finally {
      button.disabled = false;
      button.textContent = "Run Test 1";
    }
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
    await loadCommissionReport();
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
  $("runPublisherCommissionTest1").addEventListener("click", runPublisherCommissionTest1);

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