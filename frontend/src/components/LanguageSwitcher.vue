<template>
  <div class="lang-switcher">
    <button
      v-for="loc in availableLocales"
      :key="loc"
      class="lang-btn"
      :class="{ active: locale === loc }"
      @click="setLocale(loc)"
      :aria-label="t(`locale.${loc}`)"
      :title="t(`locale.${loc}`)"
    >
      {{ LOCALE_LABELS[loc] }}
    </button>
  </div>
</template>

<script setup>
import { useLocale } from '../composables/useLocale.js';

const { locale, setLocale, availableLocales, t } = useLocale();

// Short display labels for the switcher buttons
const LOCALE_LABELS = {
  'en': 'EN',
  'zh-TW': '繁',
  'zh-CN': '简',
};
</script>

<style scoped>
.lang-switcher {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px;
}

.lang-btn {
  background: transparent;
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text2);
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.02em;
  line-height: 1;
}

.lang-btn:hover {
  color: var(--text);
  background: var(--bg4);
}

.lang-btn.active {
  background: var(--primary);
  color: #fff;
}
</style>
