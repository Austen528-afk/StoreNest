(function () {
  'use strict';

  const previewBranch = location.hostname.endsWith('.vercel.app')
    && location.hostname.includes('git-feat-r2-storage-int-');
  let statusPromise;

  async function getStatus() {
    if (!statusPromise) {
      statusPromise = fetch('/api/r2-media-status', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error'
      }).then(async response => {
        if (!response.ok) throw new Error('R2 upload status is unavailable.');
        const result = await response.json();
        return {
          uploadEnabled: result?.uploadEnabled === true,
          preview: result?.environment === 'preview'
        };
      });
    }
    return statusPromise;
  }

  function previewOptedIn() {
    if (!previewBranch) return true;
    const params = new URLSearchParams(location.search);
    if (params.get('r2delivery') === '1') return true;
    try { return sessionStorage.getItem('storenest.r2delivery.preview') === '1'; } catch { return false; }
  }

  async function postJson(endpoint, body) {
    const response = await fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) throw new Error(result.error || 'R2 media request failed.');
    return result;
  }

  async function sha256Hex(file) {
    if (!window.crypto?.subtle) throw new Error('Secure media verification is unavailable in this browser.');
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function isEnabled() {
    const status = await getStatus();
    return status.uploadEnabled && (!status.preview || previewOptedIn());
  }

  async function upload(client, { businessId, sourceBucket, key, file }) {
    const status = await getStatus();
    if (!status.uploadEnabled || (status.preview && !previewOptedIn())) return null;
    if (!file || !Number.isSafeInteger(file.size) || file.size < 1) {
      throw new Error('Choose a non-empty media file.');
    }
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session?.access_token) throw new Error('Sign in again before uploading media.');

    const item = {
      businessId,
      sessionToken: session.access_token,
      sourceBucket,
      key,
      mime: file.type,
      expectedBytes: file.size
    };
    const authorization = await postJson('/api/r2-media-upload-url', item);
    if (typeof authorization.url !== 'string' || !authorization.headers
      || authorization.expiresInSeconds !== 300) {
      throw new Error('R2 upload authorization was invalid.');
    }

    let putResponse;
    try {
      putResponse = await fetch(authorization.url, {
        method: 'PUT',
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: authorization.headers,
        body: file
      });
    } catch {
      throw new Error('Cloudflare R2 upload failed. Check the media connection and retry.');
    }
    if (!putResponse.ok) throw new Error('Cloudflare R2 upload failed. HTTP ' + putResponse.status + '.');

    const expectedSha256 = await sha256Hex(file);
    const verification = await postJson('/api/r2-media-verify-upload', {
      ...item,
      expectedSha256
    });
    if (!verification.verified || verification.bytes !== file.size || verification.sha256 !== expectedSha256) {
      throw new Error('Cloudflare R2 could not verify the uploaded media.');
    }
    return { key, sha256: expectedSha256, bytes: verification.bytes, verified: true };
  }

  window.StoreNestR2Upload = Object.freeze({ isEnabled, upload });
})();
