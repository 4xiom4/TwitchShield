import fs from 'fs';
import vm from 'vm';

const scriptCode = fs.readFileSync('dist/twitch-shield.user.js', 'utf-8');

console.log('[Test] Testing full lifecycle in VM...');

let capturedBlobStr = null;

// Mock window environment
const windowContext = {
  window: {},
  self: {},
  document: {
    readyState: 'complete',
    addEventListener: () => {},
    querySelector: () => null,
    getElementsByTagName: () => []
  },
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  },
  Blob: class MockBlob {
    constructor(parts, options) {
      capturedBlobStr = parts.join('');
    }
  },
  URL: class MockURL extends URL {
    static createObjectURL(blob) { return 'blob:https://www.twitch.tv/mock-worker-uuid'; }
    static revokeObjectURL() {}
  },
  Worker: class NativeWorker {
    constructor(url) {}
    addEventListener() {}
    postMessage() {}
  },
  fetch: async () => new Response(''),
  XMLHttpRequest: class MockXHR {
    open() {}
    overrideMimeType() {}
    send() {}
    responseText = '/* Original Twitch Worker JS */';
  },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  console: console
};

windowContext.window = windowContext;
windowContext.self = windowContext;
vm.createContext(windowContext);

// 1. Run user script in Window context
try {
  vm.runInContext(scriptCode, windowContext);
  console.log('✅ Window initialization passed without errors!');
} catch (err) {
  console.error('❌ Window initialization error:', err);
  process.exit(1);
}

// 2. Instantiate Worker as Twitch would
try {
  const twitchWorker = new windowContext.Worker('blob:https://www.twitch.tv/1234-5678');
  console.log('✅ Worker constructor passed!');
  if (!capturedBlobStr) {
    throw new Error('No blob string was captured by MockBlob!');
  }
  console.log('Captured worker blob code length:', capturedBlobStr.length);
} catch (err) {
  console.error('❌ Worker constructor error:', err);
  process.exit(1);
}

// 3. Now simulate running that captured blob string inside WorkerGlobalScope!
const workerContext = {
  self: {},
  fetch: async (url) => {
    return {
      status: 200,
      text: async () => '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2.000,live\nsegment.ts'
    };
  },
  XMLHttpRequest: class WorkerXHR {
    open() {}
    overrideMimeType() {}
    send() {}
    responseText = 'console.log("Original WASM code loaded");';
  },
  Response: class MockResponse {
    constructor(body, init) {
      this.body = body;
      this.status = init?.status || 200;
    }
    async text() { return String(this.body); }
  },
  addEventListener: () => {},
  postMessage: () => {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  console: console
};
workerContext.self = workerContext;
vm.createContext(workerContext);

try {
  vm.runInContext(capturedBlobStr, workerContext);
  console.log('✅ Worker code executed inside WorkerGlobalScope without any errors!');
} catch (err) {
  console.error('❌ WorkerGlobalScope evaluation error:', err);
  process.exit(1);
}

// 4. Test fetch inside worker context
try {
  workerContext.fetch('https://video-edge.twitch.tv/v1/segment.m3u8').then(res => {
    console.log('✅ Worker fetch completed successfully!');
    process.exit(0);
  }).catch(err => {
    console.error('❌ Worker fetch error:', err);
    process.exit(1);
  });
} catch (err) {
  console.error('❌ Worker fetch call error:', err);
  process.exit(1);
}
