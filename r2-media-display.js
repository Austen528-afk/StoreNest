(function () {
  'use strict';

  const branchPreview = location.hostname.endsWith('.vercel.app')
    && location.hostname.includes('git-feat-r2-storage-int-');
  if (!branchPreview) return;

  const params = new URLSearchParams(location.search);
  const modeKey = 'storenest.r2delivery.preview';
  if (params.get('r2delivery') === '0') {
    try { sessionStorage.removeItem(modeKey); } catch {}
    return;
  }
  if (params.get('r2delivery') === '1') {
    try { sessionStorage.setItem(modeKey, '1'); } catch {}
  } else {
    try { if (sessionStorage.getItem(modeKey) !== '1') return; } catch { return; }
  }

  const sourceOrigin = 'https://cypbjzbagezdelmemuhb.supabase.co';
  const sourcePrefix = '/storage/v1/object/public/';
  const buckets = new Set(['storenest-product-media', 'storenest-brand-media']);
  const extensions = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm']);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const resourceAttributes = ['src', 'srcset', 'poster', 'href', 'data-src', 'data-srcset', 'data-lazy-src', 'data-original', 'data-poster'];

  function routeFor(value) {
    if (typeof value !== 'string' || !value || value.length > 8192) return null;
    let source;
    try { source = new URL(value, location.href); } catch { return null; }
    if (source.origin !== sourceOrigin || !source.pathname.startsWith(sourcePrefix)) return null;

    let segments;
    try {
      segments = source.pathname.slice(sourcePrefix.length).split('/').map(part => decodeURIComponent(part));
    } catch { return null; }
    const bucket = segments.shift();
    const key = segments.join('/');
    if (!buckets.has(bucket) || segments.length < 3 || segments.length > 12
      || !uuid.test(segments[0] || '') || !uuid.test(segments[1] || '')
      || segments.some(part => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) || part.length > 255)) return null;
    const filename = segments[segments.length - 1];
    if (filename === '.' || filename === '..') return null;
    const extension = filename.split('.').pop().toLowerCase();
    if (!extensions.has(extension)) return null;

    const target = new URL('/api/r2-media-url', location.origin);
    target.searchParams.set('bucket', bucket);
    target.searchParams.set('key', key);
    return target.toString();
  }

  function routeSrcset(value) {
    return String(value).split(',').map(candidate => {
      const trimmed = candidate.trim();
      if (!trimmed) return trimmed;
      const match = /^(\S+)([\s\S]*)$/.exec(trimmed);
      if (!match) return trimmed;
      const target = routeFor(match[1]);
      return target ? target + match[2] : trimmed;
    }).join(', ');
  }

  function routeCss(value) {
    return String(value).replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, quote, url) => {
      const target = routeFor(url.trim());
      return target ? 'url(' + quote + target + quote + ')' : whole;
    });
  }

  function routeAttribute(element, name, value) {
    const attribute = String(name).toLowerCase();
    if (attribute === 'srcset' || attribute === 'data-srcset') return routeSrcset(value);
    if (attribute === 'style') return routeCss(value);
    if (attribute === 'href' && !/^(A|AREA)$/i.test(element.tagName || '')) return value;
    return routeFor(String(value)) || value;
  }

  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const updated = routeAttribute(this, name, String(value));
    return nativeSetAttribute.call(this, name, updated);
  };

  function patchProperty(constructorName, property, kind) {
    const constructor = window[constructorName];
    const descriptor = constructor && Object.getOwnPropertyDescriptor(constructor.prototype, property);
    if (!descriptor || !descriptor.configurable || typeof descriptor.set !== 'function') return;
    Object.defineProperty(constructor.prototype, property, {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(value) {
        const updated = kind === 'srcset'
          ? routeSrcset(String(value))
          : routeFor(String(value)) || value;
        descriptor.set.call(this, updated);
      }
    });
  }

  patchProperty('HTMLImageElement', 'src', 'url');
  patchProperty('HTMLImageElement', 'srcset', 'srcset');
  patchProperty('HTMLSourceElement', 'src', 'url');
  patchProperty('HTMLSourceElement', 'srcset', 'srcset');
  patchProperty('HTMLVideoElement', 'src', 'url');
  patchProperty('HTMLVideoElement', 'poster', 'url');
  patchProperty('HTMLAudioElement', 'src', 'url');
  patchProperty('HTMLAnchorElement', 'href', 'url');

  function rewriteElement(element) {
    if (!element || element.nodeType !== 1) return;
    for (const name of resourceAttributes) {
      if (element.hasAttribute(name)) {
        const current = element.getAttribute(name);
        const updated = routeAttribute(element, name, current);
        if (updated !== current) nativeSetAttribute.call(element, name, updated);
      }
    }
    if (element.hasAttribute('style')) {
      const current = element.getAttribute('style');
      const updated = routeCss(current);
      if (updated !== current) nativeSetAttribute.call(element, 'style', updated);
    }
  }

  function scan(node) {
    if (!node || node.nodeType !== 1) return;
    rewriteElement(node);
    if (node.querySelectorAll) {
      for (const element of node.querySelectorAll('*')) rewriteElement(element);
    }
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') rewriteElement(record.target);
      else for (const node of record.addedNodes) scan(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'poster', 'href', 'style', 'data-src', 'data-srcset', 'data-lazy-src', 'data-original', 'data-poster']
  });
  scan(document.documentElement);
})();