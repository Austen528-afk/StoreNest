'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../r2-media-display.js'), 'utf8');
const supabaseImage = 'https://cypbjzbagezdelmemuhb.supabase.co/storage/v1/object/public/'
  + 'storenest-product-media/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/'
  + 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/example.jpg';

function createContext() {
  class Element {
    constructor(tagName = 'DIV') {
      this.tagName = tagName;
      this.nodeType = 1;
      this.attributes = new Map();
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelectorAll() { return []; }
  }
  class HTMLImageElement extends Element {
    constructor() { super('IMG'); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    get srcset() { return this.getAttribute('srcset') || ''; }
    set srcset(value) { this.setAttribute('srcset', value); }
  }
  class HTMLSourceElement extends Element {
    constructor() { super('SOURCE'); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    get srcset() { return this.getAttribute('srcset') || ''; }
    set srcset(value) { this.setAttribute('srcset', value); }
  }
  class HTMLVideoElement extends Element {
    constructor() { super('VIDEO'); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
    get poster() { return this.getAttribute('poster') || ''; }
    set poster(value) { this.setAttribute('poster', value); }
  }
  class HTMLAudioElement extends Element {
    constructor() { super('AUDIO'); }
    get src() { return this.getAttribute('src') || ''; }
    set src(value) { this.setAttribute('src', value); }
  }
  class HTMLAnchorElement extends Element {
    constructor() { super('A'); }
    get href() { return this.getAttribute('href') || ''; }
    set href(value) { this.setAttribute('href', value); }
  }

  const listeners = new Map();
  const document = {
    documentElement: new Element('HTML'),
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  const context = {
    location: {
      hostname: 'storenest-eight.vercel.app',
      search: '',
      origin: 'https://storenest-eight.vercel.app',
      href: 'https://storenest-eight.vercel.app/'
    },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    fetch: async () => ({
      ok: true,
      json: async () => ({ deliveryEnabled: true, defaultDelivery: true })
    }),
    document,
    Element,
    HTMLImageElement,
    HTMLSourceElement,
    HTMLVideoElement,
    HTMLAudioElement,
    HTMLAnchorElement,
    MutationObserver: class { observe() {} },
    URL,
    URLSearchParams,
    Set,
    WeakMap,
    WeakSet
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(script, context);
  return { listeners, HTMLImageElement };
}

async function ready(context) {
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.listeners.has('error'), true);
}

test('an image missing from R2 falls back to its original public Supabase URL', async () => {
  const context = createContext();
  await ready(context);
  const image = new context.HTMLImageElement();

  image.src = supabaseImage;
  assert.match(image.src, /^https:\/\/storenest-eight\.vercel\.app\/api\/r2-media-url\?/);

  context.listeners.get('error')({ target: image });
  assert.equal(image.src, supabaseImage);
});

test('a failed R2 srcset restores the original candidates and does not rewrite them again', async () => {
  const context = createContext();
  await ready(context);
  const image = new context.HTMLImageElement();
  const sourceSet = `${supabaseImage} 586w`;

  image.src = supabaseImage;
  image.srcset = sourceSet;
  assert.match(image.srcset, /^https:\/\/storenest-eight\.vercel\.app\/api\/r2-media-url\?/);

  context.listeners.get('error')({ target: image });
  assert.equal(image.src, supabaseImage);
  assert.equal(image.srcset, sourceSet);
  context.listeners.get('error')({ target: image });
  assert.equal(image.srcset, sourceSet);
});
