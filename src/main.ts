import { loadUserConfig } from './config';
import { GQLManager } from './gql/dynamic-hash';
import { VideoWatchdog } from './player/video-watchdog';
import { preventBackgroundThrottling } from './player/visibility';
import { pauseResumePlayer, reloadPlayer } from './player/react-hook';
import { TwitchShieldOverlay } from './ui/badge';

declare const __INJECTED_WORKER_CODE__: string;

(function initTwitchShield() {
  'use strict';

  const OUR_VERSION = 1;
  const win = window as any;

  if (typeof win.twitchShieldVersion !== 'undefined' && win.twitchShieldVersion >= OUR_VERSION) {
    console.log(`[TwitchShield] Skipping initialization, already active (v${win.twitchShieldVersion})`);
    return;
  }
  win.twitchShieldVersion = OUR_VERSION;

  console.log(`[TwitchShield] Initializing TwitchShield v${OUR_VERSION}...`);

  const gqlManager = GQLManager.getInstance();
  const config = loadUserConfig();
  const activeWorkers: Worker[] = [];

  let overlay: TwitchShieldOverlay | null = null;
  let watchdog: VideoWatchdog | null = null;

  function broadcastToWorkers(key: string, value: any): void {
    for (const w of activeWorkers) {
      w.postMessage({ key, value });
    }
  }

  // 1. Hook window.fetch for GQL token & header inspection
  const realFetch = window.fetch;
  win.realFetch = realFetch;

  window.fetch = function (url: RequestInfo | URL, init?: RequestInit, ...args: any[]): Promise<Response> {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

    if (urlStr.includes('/gql')) {
      gqlManager.inspectFetchRequest(urlStr, init);

      if (init?.headers) {
        const h = init.headers as Record<string, string>;
        if (h['Client-Version']) broadcastToWorkers('UpdateClientVersion', h['Client-Version']);
        if (h['Client-Session-Id']) broadcastToWorkers('UpdateClientSession', h['Client-Session-Id']);
        if (h['Client-Integrity']) broadcastToWorkers('UpdateClientIntegrityHeader', h['Client-Integrity']);
        if (h['Authorization']) broadcastToWorkers('UpdateAuthorizationHeader', h['Authorization']);
        const devId = h['X-Device-Id'] || h['Device-ID'];
        if (devId) broadcastToWorkers('UpdateDeviceId', devId);
      }
    }

    return (realFetch as any).apply(this, [url, init, ...args]);
  };

  // 2. Hook window.Worker
  const OrigWorker = window.Worker;

  function getWasmWorkerJs(blobUrl: string): string {
    const req = new XMLHttpRequest();
    req.open('GET', blobUrl, false);
    req.overrideMimeType('text/javascript');
    req.send();
    return req.responseText;
  }

  const PatchedWorker = class extends OrigWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      const urlStr = typeof scriptURL === 'string' ? scriptURL : scriptURL.toString();
      let isTwitchWorker = false;
      try {
        isTwitchWorker = new URL(urlStr).origin.endsWith('.twitch.tv');
      } catch {}

      if (!isTwitchWorker) {
        super(scriptURL, options);
        return;
      }

      const originalCode = getWasmWorkerJs(urlStr);
      const injectedWorkerCode = typeof __INJECTED_WORKER_CODE__ !== 'undefined' ? __INJECTED_WORKER_CODE__ : '';

      const combinedCode = `
        ${injectedWorkerCode}
        ${originalCode}
      `;

      const newBlob = new Blob([combinedCode], { type: 'application/javascript' });
      super(URL.createObjectURL(newBlob), options);

      activeWorkers.push(this);

      // Initial state sync to worker
      this.postMessage({ key: 'UpdateClientId', value: config.clientId });
      this.postMessage({ key: 'UpdateDeviceId', value: gqlManager.getDeviceId() });

      this.addEventListener('message', async (e: MessageEvent) => {
        const data = e.data;
        if (!data) return;

        if (data.key === 'UpdateAdBlockBanner' && overlay) {
          overlay.update(data);
          if (watchdog) {
            watchdog.setStrippingState(!!data.isStrippingAdSegments);
          }
        } else if (data.key === 'PauseResumePlayer') {
          pauseResumePlayer();
        } else if (data.key === 'ReloadPlayer') {
          reloadPlayer();
        } else if (data.key === 'FetchRequest') {
          const req = data.value;
          try {
            const resp = await realFetch(req.url, req.options);
            const body = await resp.text();
            this.postMessage({
              key: 'FetchResponse',
              value: {
                id: req.id,
                status: resp.status,
                statusText: resp.statusText,
                headers: Object.fromEntries(resp.headers.entries()),
                body
              }
            });
          } catch (err: any) {
            this.postMessage({
              key: 'FetchResponse',
              value: {
                id: req.id,
                error: err?.message || 'Fetch failed'
              }
            });
          }
        }
      });
    }
  };

  window.Worker = PatchedWorker;

  // 3. Start player watchdog and tab throttling prevention
  watchdog = new VideoWatchdog();
  preventBackgroundThrottling();

  // 4. Initialize UI Overlay
  const initUI = () => {
    overlay = new TwitchShieldOverlay();
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initUI();
  } else {
    window.addEventListener('DOMContentLoaded', initUI);
  }

  // 5. Expose debug methods
  win.reloadTwitchPlayer = () => reloadPlayer();
  win.TWITCH_SHIELD_STATUS = () => ({
    version: OUR_VERSION,
    config,
    capturedHash: gqlManager.getPlaybackAccessTokenHash(),
    activeWorkersCount: activeWorkers.length
  });

  console.log(`[TwitchShield] TwitchShield v${OUR_VERSION} loaded successfully.`);
})();
