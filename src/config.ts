import { TwitchShieldConfig } from './types';

export const DEFAULT_CONFIG: TwitchShieldConfig = {
  version: 1,
  adSignifier: 'stitched',
  clientId: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
  backupPlayerTypes: ['embed', 'popout', 'autoplay'],
  fallbackPlayerType: 'embed',
  forceAccessTokenPlayerType: 'popout',
  skipPlayerReloadOnHevc: false,
  alwaysReloadPlayerOnAd: false,
  reloadPlayerAfterAd: true,
  playerReloadMinimalRequestsTime: 1500,
  playerReloadMinimalRequestsPlayerIndex: 2, // autoplay
  playerBufferingFix: true,
  playerBufferingDelay: 600,
  playerBufferingSameStateCount: 3,
  playerBufferingDangerZone: 1,
  playerBufferingDoPlayerReload: false,
  playerBufferingMinRepeatDelay: 8000,
  isAdStrippingEnabled: true,
  debug: false
};

const STORAGE_KEY = 'TWITCH_SHIELD_CONFIG';
const DYNAMIC_HASH_KEY = 'TWITCH_SHIELD_GQL_HASH';

export function loadUserConfig(): TwitchShieldConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (err) {
    // Ignore storage parse error
  }
  return { ...DEFAULT_CONFIG };
}

export function saveUserConfig(cfg: Partial<TwitchShieldConfig>): void {
  try {
    const current = loadUserConfig();
    const updated = { ...current, ...cfg };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('[TwitchShield] Failed to save config to localStorage', err);
  }
}

export function getCachedGQLHash(): string | null {
  try {
    return localStorage.getItem(DYNAMIC_HASH_KEY);
  } catch {
    return null;
  }
}

export function setCachedGQLHash(hash: string): void {
  try {
    localStorage.setItem(DYNAMIC_HASH_KEY, hash);
  } catch {}
}
