import { SupportedLanguage } from './i18n';

export interface TwitchShieldConfig {
  version: number;
  language: SupportedLanguage;
  silentMode: boolean; // True by default: zero disruption on stream
  adSignifier: string;
  clientId: string;
  backupPlayerTypes: string[];
  fallbackPlayerType: string;
  forceAccessTokenPlayerType: string;
  skipPlayerReloadOnHevc: boolean;
  alwaysReloadPlayerOnAd: boolean;
  reloadPlayerAfterAd: boolean;
  playerReloadMinimalRequestsTime: number;
  playerReloadMinimalRequestsPlayerIndex: number;
  playerBufferingFix: boolean;
  playerBufferingDelay: number;
  playerBufferingSameStateCount: number;
  playerBufferingDangerZone: number;
  playerBufferingDoPlayerReload: boolean;
  playerBufferingMinRepeatDelay: number;
  isAdStrippingEnabled: boolean;
  debug: boolean;
}

export const DEFAULT_CONFIG: TwitchShieldConfig = {
  version: 2,
  language: 'es',
  silentMode: true, // Non-disruptive by default
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
  } catch (err) {}
  return { ...DEFAULT_CONFIG };
}

export function saveUserConfig(cfg: Partial<TwitchShieldConfig>): void {
  try {
    const current = loadUserConfig();
    const updated = { ...current, ...cfg };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.error('[TwitchShield] Error guardando configuración:', err);
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
