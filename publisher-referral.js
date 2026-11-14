(() => {
  const storageKey = "storenest-publisher-referral";
  const validCode = value => /^[A-Z0-9_-]{1,50}$/.test(String(value || ""));
  const pageUrl = new URL(window.location.href);
  const incomingCode = String(pageUrl.searchParams.get("ref") || "").trim().toUpperCase();
  let referralCode = "";

  if (validCode(incomingCode)) {
    referralCode = incomingCode;
    try {
      window.localStorage.setItem(storageKey, referralCode);
    } catch {}
    pageUrl.searchParams.delete("ref");
    window.history.replaceState(
      window.history.state,
      "",
      pageUrl.pathname + pageUrl.search + pageUrl.hash
    );
  } else {
    try {
      referralCode = String(window.localStorage.getItem(storageKey) || "").trim().toUpperCase();
    } catch {}
  }

  if (!validCode(referralCode)) return;

  document.querySelectorAll('a[href]').forEach(anchor => {
    let target;
    try {
      target = new URL(anchor.href, window.location.origin);
    } catch {
      return;
    }
    if (target.origin !== window.location.origin || target.pathname !== "/business-owner.html") return;
    target.searchParams.set("ref", referralCode);
    anchor.href = target.pathname + target.search + target.hash;
  });
})();
