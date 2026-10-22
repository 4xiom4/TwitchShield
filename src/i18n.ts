export type SupportedLanguage = 'es' | 'en';

export interface Translations {
  active: string;
  blockingAds: string;
  blockingMidroll: string;
  strippingAds: string;
  cleanStreamFound: string;
  settingsTitle: string;
  silentMode: string;
  silentModeDesc: string;
  bufferWatchdog: string;
  adStripping: string;
  forceReload: string;
  language: string;
  adsBlockedCount: string;
  statusClean: string;
}

export const MESSAGES: Record<SupportedLanguage, Translations> = {
  es: {
    active: 'TwitchShield Activo',
    blockingAds: 'Bloqueando anuncios...',
    blockingMidroll: 'Bloqueando anuncios (midroll)...',
    strippingAds: 'Suprimiendo anuncios...',
    cleanStreamFound: 'Flujo limpio conectado',
    settingsTitle: 'Configuración de TwitchShield',
    silentMode: 'Modo silencioso (sin banners)',
    silentModeDesc: 'Oculta avisos en pantalla para no interrumpir el directo',
    bufferWatchdog: 'Watchdog antibuffering automático',
    adStripping: 'Supresión de anuncios de respaldo',
    forceReload: '🔄 Forzar recarga del directo',
    language: 'Idioma / Language',
    adsBlockedCount: 'Anuncios bloqueados en sesión',
    statusClean: 'Transmisión sin anuncios'
  },
  en: {
    active: 'TwitchShield Active',
    blockingAds: 'Blocking ads...',
    blockingMidroll: 'Blocking midroll ads...',
    strippingAds: 'Stripping ads...',
    cleanStreamFound: 'Clean stream connected',
    settingsTitle: 'TwitchShield Settings',
    silentMode: 'Silent mode (no banners)',
    silentModeDesc: 'Hides on-screen notices to prevent live stream disruption',
    bufferWatchdog: 'Auto antibuffering watchdog',
    adStripping: 'Fallback ad stripping',
    forceReload: '🔄 Force reload stream',
    language: 'Language / Idioma',
    adsBlockedCount: 'Ads blocked this session',
    statusClean: 'Ad-free playback'
  }
};

export function getTranslations(lang: SupportedLanguage = 'es'): Translations {
  return MESSAGES[lang] || MESSAGES.es;
}
