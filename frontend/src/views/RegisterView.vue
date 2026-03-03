<template>
  <div class="auth-page">
    <div class="auth-box card">
      <h1>🌐 {{ t('app.name') }}</h1>
      <p class="subtitle">{{ t('auth.register.title') }}</p>

      <form @submit.prevent="handleRegister">
        <div class="form-group">
          <label>{{ t('auth.fields.username') }}</label>
          <input v-model="username" type="text" :placeholder="t('auth.fields.usernamePlaceholder')" required />
        </div>
        <div class="form-group">
          <label>{{ t('auth.fields.password') }}</label>
          <input v-model="password" type="password" :placeholder="t('auth.fields.passwordHint')" required minlength="6" />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" :disabled="loading">
          {{ loading ? t('auth.register.submitting') : t('auth.register.submit') }}
        </button>
      </form>

      <p class="switch-link">
        {{ t('auth.register.switchPrompt') }}
        <RouterLink to="/login">{{ t('auth.register.switchLink') }}</RouterLink>
      </p>

      <div class="lang-row">
        <LanguageSwitcher />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.js';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';

const { t } = useI18n();
const auth = useAuthStore();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

async function handleRegister() {
  error.value = '';
  loading.value = true;
  try {
    await auth.register(username.value, password.value);
    router.push('/worlds');
  } catch (e) {
    error.value = e.response?.data?.error || t('auth.register.error');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.auth-box {
  width: 400px;
  max-width: 100%;
}
h1 { font-size: 24px; margin-bottom: 6px; }
.subtitle { color: var(--text2); margin-bottom: 24px; font-size: 14px; }
.switch-link { margin-top: 18px; text-align: center; font-size: 14px; color: var(--text2); }
.lang-row { margin-top: 20px; display: flex; justify-content: center; }
</style>
