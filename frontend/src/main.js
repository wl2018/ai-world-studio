import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router/index.js';
import i18n, { getInitialLocale } from './i18n/index.js';
import './style.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);

// Set initial <html lang> attribute for accessibility
document.documentElement.lang = getInitialLocale();

app.mount('#app');
