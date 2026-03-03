import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import zhTW from './locales/zh-TW.json';
import zhCN from './locales/zh-CN.json';

// Supported locales
export const SUPPORTED_LOCALES = ['en', 'zh-TW', 'zh-CN'];
export const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'ui-locale';

/**
 * Detect locale from browser settings.
 * Maps browser language codes to our supported locales.
 * Falls back to DEFAULT_LOCALE if no match.
 */
export function detectBrowserLocale() {
  const languages = navigator.languages || [navigator.language];
  for (const lang of languages) {
    // Exact match (e.g. 'zh-TW', 'en')
    if (SUPPORTED_LOCALES.includes(lang)) return lang;
    // Prefix match (e.g. 'zh-Hant' -> 'zh-TW', 'en-US' -> 'en')
    const prefix = lang.split('-')[0];
    if (prefix === 'zh') {
      // Distinguish simplified vs traditional by script tag or region
      if (lang.includes('TW') || lang.includes('HK') || lang.includes('MO') || lang.includes('Hant')) {
        return 'zh-TW';
      }
      return 'zh-CN';
    }
    if (prefix === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

/**
 * Get persisted UI locale from localStorage, or detect from browser.
 */
export function getInitialLocale() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED_LOCALES.includes(saved)) return saved;
  return detectBrowserLocale();
}

/**
 * Persist the user's locale choice.
 */
export function saveLocale(locale) {
  localStorage.setItem(STORAGE_KEY, locale);
}

const i18n = createI18n({
  legacy: false,           // Use Composition API mode
  locale: getInitialLocale(),
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    'en': en,
    'zh-TW': zhTW,
    'zh-CN': zhCN,
  },
  // Suppress missing translation warnings in production
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

export default i18n;
