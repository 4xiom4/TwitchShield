import { WorkerFetchHook } from './worker-fetch';

(function initTwitchShieldWorker() {
  const hook = new WorkerFetchHook();
  hook.hookFetch();
  console.log('[TwitchShield Worker] HLS Fetch Hook initialized');
})();
