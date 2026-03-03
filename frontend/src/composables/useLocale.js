import { useI18n } from 'vue-i18n';
import { SUPPORTED_LOCALES, saveLocale, detectBrowserLocale } from '../i18n/index.js';

/**
 * Composable for locale switching.
 * Use this in any component that needs to read or change the UI language.
 *
 * Usage:
 *   const { locale, setLocale, availableLocales } = useLocale();
 */
export function useLocale() {
  const { locale, t } = useI18n();

  function setLocale(newLocale) {
    if (!SUPPORTED_LOCALES.includes(newLocale)) return;
    locale.value = newLocale;
    saveLocale(newLocale);
    // Update <html lang> for accessibility
    document.documentElement.lang = newLocale;
  }

  /**
   * Returns the locale that should be pre-selected as the world language
   * when the user creates a new world. Defaults to the current UI locale.
   */
  function getDefaultWorldLocale() {
    return locale.value;
  }

  return {
    locale,
    setLocale,
    availableLocales: SUPPORTED_LOCALES,
    getDefaultWorldLocale,
    t,
  };
}
