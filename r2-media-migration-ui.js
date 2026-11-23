'use strict';

(() => {
  const params = new URLSearchParams(location.search);
  const allowedPreview = location.hostname.endsWith('.vercel.app')
    && params.get('r2migration') === '1';
  if (!allowedPreview) return;
  fetch('/api/r2-media-migration', {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error'
  }).then(response => response.ok ? response.json() : null)
    .then(result => { if (result?.ready === true) initialize(); })
    .catch(() => {});
  function initialize() {
  const MAX_OBJECT_BYTES = 20 * 1024 * 1024;
  const MAX_BATCH_BYTES = 20 * 1024 * 1024;
  const MAX_BATCH_ITEMS = 4;
  const SUPPORTED = {
    'image/jpeg': new Set(['jpg', 'jpeg']),
    'image/png': new Set(['png']),
    'image/webp': new Set(['webp']),
    'image/gif': new Set(['gif']),
    'video/mp4': new Set(['mp4']),
    'video/webm': new Set(['webm'])
  };
  const EXTENSION_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm'
  };
  const BUCKETS = ['storenest-product-media', 'storenest-brand-media'];
  let scan = null;
  let running = false;
  let stopRequested = false;
  let oldBodyOverflow = '';

  const style = document.createElement('style');
  style.textContent = [
    '#r2-copy-launch{position:fixed;right:86px;bottom:22px;z-index:100000;border:0;border-radius:999px;padding:12px 18px;background:#0b6b58;color:#fff;font:600 14px system-ui;box-shadow:0 5px 22px #0004;cursor:pointer}',
    '#r2-copy-overlay[hidden]{display:none!important}',
    '#r2-copy-overlay{position:fixed;inset:0;z-index:100001;background:#061410bb;display:grid;place-items:center;padding:18px;font:14px/1.5 system-ui;color:#18332c}',
    '#r2-copy-dialog{width:min(760px,96vw);max-height:min(88vh,850px);overflow:auto;background:#fff;border:1px solid #c9ddd5;border-radius:18px;box-shadow:0 16px 60px #0005;padding:22px}',
    '#r2-copy-dialog h2{margin:0 0 6px;font-size:22px}',
    '#r2-copy-dialog p{margin:7px 0 12px}',
    '#r2-copy-note{padding:12px 14px;border-radius:10px;background:#eff8f4;border:1px solid #d3e9df}',
    '#r2-copy-actions{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}',
    '#r2-copy-actions button{border:1px solid #b8d3c8;border-radius:9px;padding:10px 14px;background:#fff;color:#163d32;font:600 14px system-ui;cursor:pointer}',
    '#r2-copy-actions button.primary{background:#0b6b58;border-color:#0b6b58;color:#fff}',
    '#r2-copy-actions button:disabled{opacity:.55;cursor:wait}',
    '#r2-copy-close{float:right;border:0;background:transparent;font-size:23px;cursor:pointer;color:#234}',
    '#r2-copy-status{min-height:44px;padding:10px 12px;border-radius:9px;background:#f6f8f7;white-space:pre-wrap}',
    '#r2-copy-summary{margin:12px 0;border-collapse:collapse;width:100%;font-size:13px}',
    '#r2-copy-summary th,#r2-copy-summary td{text-align:left;padding:8px;border-bottom:1px solid #e3ece8}',
    '#r2-copy-summary th:last-child,#r2-copy-summary td:last-child{text-align:right}',
    '@media(max-width:600px){#r2-copy-launch{right:74px;bottom:14px;padding:10px 13px}#r2-copy-dialog{padding:16px}}'
  ].join('');
  document.head.append(style);

  const launch = document.createElement('button');
  launch.id = 'r2-copy-launch';
  launch.type = 'button';
  launch.textContent = 'Cloudflare R2 copy';
  launch.setAttribute('aria-haspopup', 'dialog');

  const overlay = document.createElement('div');
  overlay.id = 'r2-copy-overlay';
  overlay.hidden = true;
  overlay.innerHTML = '<section id="r2-copy-dialog" role="dialog" aria-modal="true" aria-labelledby="r2-copy-title">'
    + '<button id="r2-copy-close" type="button" aria-label="Close">×</button>'
    + '<h2 id="r2-copy-title">Copy existing media to Cloudflare R2</h2>'
    + '<p>This Preview tool copies your owned businesses’ product and brand media, then reads each R2 copy back and checks its SHA-256 hash.</p>'
    + '<div id="r2-copy-note"><strong>Copy only:</strong> Supabase originals, database media URLs and storefront publication are left unchanged. This pass does not delete or update database records.</div>'
    + '<div id="r2-copy-actions"><button id="r2-copy-scan" class="primary" type="button">Scan my media</button><button id="r2-copy-run" class="primary" type="button" disabled>Copy and verify</button><button id="r2-copy-stop" type="button" disabled>Stop after current file</button></div>'
    + '<div id="r2-copy-status" role="status" aria-live="polite">Sign in to the business owner dashboard, then scan your media.</div>'
    + '<table id="r2-copy-summary" hidden><thead><tr><th>Business</th><th>Eligible files</th><th>Size</th></tr></thead><tbody></tbody></table>'
    + '<p id="r2-copy-skipped" hidden></p>'
    + '</section>';
  document.body.append(launch, overlay);

  const status = overlay.querySelector('#r2-copy-status');
  const scanButton = overlay.querySelector('#r2-copy-scan');
  const runButton = overlay.querySelector('#r2-copy-run');
  const stopButton = overlay.querySelector('#r2-copy-stop');
  const summary = overlay.querySelector('#r2-copy-summary');
  const summaryBody = summary.querySelector('tbody');
  const skippedText = overlay.querySelector('#r2-copy-skipped');

  function formatBytes(value) {
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function openPanel() {
    overlay.hidden = false;
    oldBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.querySelector('#r2-copy-close').focus();
  }
  function closePanel() {
    if (running) stopRequested = true;
    overlay.hidden = true;
    document.body.style.overflow = oldBodyOverflow;
    launch.focus();
  }
  function safeName(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 255
      && value !== '.' && value !== '..' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  }
  function mimeFor(entry) {
    const name = String(entry.name || '');
    const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const recorded = String(entry.metadata?.mimetype || entry.metadata?.contentType || '').split(';')[0].trim().toLowerCase();
    const mime = Object.hasOwn(SUPPORTED, recorded) ? recorded : (EXTENSION_MIME[extension] || '');
    if (!Object.hasOwn(SUPPORTED, mime) || !SUPPORTED[mime].has(extension)) return '';
    return mime;
  }
  async function listTree(client, bucket, root, ownerId, businessId) {
    const found = [];
    const seen = new Set();
    let visited = 0;
    let skipped = 0;
    async function walk(directory, depth) {
      if (depth > 8) throw Error('Media folder nesting is too deep to scan safely.');
      if (seen.has(directory)) return;
      seen.add(directory);
      let offset = 0;
      while (true) {
        const { data, error } = await client.storage.from(bucket).list(directory, {
          limit: 100, offset, sortBy: { column: 'name', order: 'asc' }
        });
        if (error) throw error;
        const entries = Array.isArray(data) ? data : [];
        const folders = [];
        for (const entry of entries) {
          visited++;
          if (visited > 5000) throw Error('This business has over 5,000 media objects; use a smaller migration batch.');
          if (entry?.id === null) {
            if (safeName(entry?.name)) folders.push(directory + '/' + entry.name);
            continue;
          }
          if (!safeName(entry?.name)) { skipped++; continue; }
          const key = directory + '/' + entry.name;
          const mime = mimeFor(entry);
          const size = Number(entry.metadata?.size ?? entry.metadata?.contentLength);
          if (!mime || !Number.isSafeInteger(size) || size < 1 || size > MAX_OBJECT_BYTES) { skipped++; continue; }
          if (!key.startsWith(ownerId + '/' + businessId + '/')) { skipped++; continue; }
          found.push({ sourceBucket: bucket, key, mime, expectedBytes: size, businessId });
        }
        for (const folder of folders) await walk(folder, depth + 1);
        if (entries.length < 100) break;
        offset += entries.length;
      }
    }
    await walk(root, 0);
    return { found, skipped };
  }
  function renderScan(result) {
    summaryBody.replaceChildren();
    for (const row of result.businesses) {
      const tr = document.createElement('tr');
      for (const value of [row.name, String(row.count), formatBytes(row.bytes)]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.append(td);
      }
      summaryBody.append(tr);
    }
    summary.hidden = result.businesses.length === 0;
    skippedText.hidden = result.skipped === 0;
    skippedText.textContent = result.skipped
      ? result.skipped + ' files were skipped because their type or size is outside the migration allowlist.'
      : '';
    runButton.disabled = running || result.items.length === 0;
  }
  async function scanMedia() {
    if (running) return;
    scanButton.disabled = true;
    runButton.disabled = true;
    summary.hidden = true;
    skippedText.hidden = true;
    status.textContent = 'Checking the signed-in owner and listing their media…';
    try {
      if (!currentUser?.id) throw Error('Sign in to the business owner dashboard first.');
      const client = await loadAuth();
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError || !session?.access_token) throw Error('Your session has expired. Sign in again.');
      await fetchOwnerBusinesses(client);
      const ownerId = currentUser.id;
      const businesses = ownerBusinesses.filter(business => business?.id && business.owner_id === ownerId);
      if (!businesses.length) throw Error('No businesses owned by this account were found.');
      const rows = [];
      const items = [];
      let skipped = 0;
      for (const business of businesses) {
        status.textContent = 'Scanning ' + (business.name || 'business') + '…';
        let count = 0;
        let bytes = 0;
        for (const bucket of BUCKETS) {
          const root = ownerId + '/' + business.id;
          const listed = await listTree(client, bucket, root, ownerId, business.id);
          for (const item of listed.found) {
            items.push(item);
            count++;
            bytes += item.expectedBytes;
          }
          skipped += listed.skipped;
        }
        rows.push({ id: business.id, name: business.name || 'Business', count, bytes });
      }
      scan = { ownerId, businesses: rows, items, skipped };
      renderScan(scan);
      status.textContent = items.length
        ? 'Scan complete: ' + items.length + ' eligible files (' + formatBytes(items.reduce((sum, item) => sum + item.expectedBytes, 0)) + '). Ready to copy.'
        : 'Scan complete: no supported media files were found in the businesses owned by this account.';
    } catch (error) {
      scan = null;
      status.textContent = 'Scan failed: ' + (error?.message || 'Could not list media.');
    } finally {
      scanButton.disabled = false;
    }
  }
  function makeBatches(items) {
    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.businessId)) groups.set(item.businessId, []);
      groups.get(item.businessId).push(item);
    }
    const batches = [];
    for (const [businessId, group] of groups) {
      let batch = [];
      let bytes = 0;
      for (const item of group) {
        if (batch.length && (batch.length >= MAX_BATCH_ITEMS || bytes + item.expectedBytes > MAX_BATCH_BYTES)) {
          batches.push({ businessId, items: batch });
          batch = [];
          bytes = 0;
        }
        batch.push(item);
        bytes += item.expectedBytes;
      }
      if (batch.length) batches.push({ businessId, items: batch });
    }
    return batches;
  }
  async function copyMedia() {
    if (!scan || running) return;
    running = true;
    stopRequested = false;
    scanButton.disabled = true;
    runButton.disabled = true;
    stopButton.disabled = false;
    const batches = makeBatches(scan.items);
    let verifiedCount = 0;
    let verifiedBytes = 0;
    let failedCount = 0;
    let incomplete = false;
    try {
      const client = await loadAuth();
      for (let index = 0; index < batches.length; index++) {
        if (stopRequested) break;
        if (currentUser?.id !== scan.ownerId) throw Error('The signed-in account changed; copy stopped.');
        const batch = batches[index];
        const { data: { session }, error: sessionError } = await client.auth.getSession();
        if (sessionError || !session?.access_token) throw Error('Your session expired; sign in again and rescan.');
        status.textContent = 'Copying batch ' + (index + 1) + ' of ' + batches.length + '… ' + verifiedCount + ' verified so far.';
        const response = await fetch('/api/r2-media-migration', {
          method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'copy',
            businessId: batch.businessId,
            sessionToken: session.access_token,
            items: batch.items.map(item => ({
              sourceBucket: item.sourceBucket,
              key: item.key,
              mime: item.mime,
              expectedBytes: item.expectedBytes
            }))
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw Error(result.error || ('Migration endpoint returned HTTP ' + response.status + '.'));
        for (const entry of result.results || []) {
          if (entry.verified === true) {
            verifiedCount++;
            verifiedBytes += entry.bytes || 0;
          } else {
            failedCount++;
            status.textContent = 'Stopped at ' + entry.key + ': ' + (entry.error || 'R2 copy could not be verified.');
          }
        }
        if (!result.complete) { incomplete = true; break; }
      }
      if (failedCount) {
        status.textContent = 'Stopped with ' + verifiedCount + ' files verified (' + formatBytes(verifiedBytes) + '); ' + failedCount + ' file(s) need attention. Rescan and retry after reviewing the error.';
      } else if (stopRequested) {
        status.textContent = 'Stopped after the current request: ' + verifiedCount + ' files verified (' + formatBytes(verifiedBytes) + '). Rescan and resume when ready.';
      } else if (incomplete) {
        status.textContent = 'The server stopped before verifying the entire batch. ' + verifiedCount + ' files are verified; rescan and retry.';
      } else {
        status.textContent = 'Copy and R2 hash verification complete for ' + verifiedCount + ' files (' + formatBytes(verifiedBytes) + '). Supabase originals and database URLs remain unchanged.';
      }
    } catch (error) {
      status.textContent = 'Copy paused: ' + (error?.message || 'Could not complete the copy.');
    } finally {
      running = false;
      scanButton.disabled = false;
      stopButton.disabled = true;
      runButton.disabled = !scan?.items?.length;
    }
  }

  launch.addEventListener('click', openPanel);
  overlay.querySelector('#r2-copy-close').addEventListener('click', closePanel);
  overlay.addEventListener('click', event => { if (event.target === overlay) closePanel(); });
  scanButton.addEventListener('click', scanMedia);
  runButton.addEventListener('click', copyMedia);
  stopButton.addEventListener('click', () => {
    stopRequested = true;
    stopButton.disabled = true;
    status.textContent = 'Will stop after the current file batch finishes…';
  });
  openPanel();
  }
})();