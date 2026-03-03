<template>
  <div class="worlds-page">
    <header class="topbar">
      <div class="brand">🌐 {{ t('app.name') }}</div>
      <div class="user-info">
        <span>{{ auth.user?.username }}</span>
        <LanguageSwitcher />
        <button class="btn btn-sm" @click="auth.logout(); router.push('/login')">{{ t('nav.logout') }}</button>
      </div>
    </header>

    <main class="content">
      <div class="page-header">
        <h1>{{ t('worlds.pageTitle') }}</h1>
        <button class="btn btn-primary" @click="openCreate">＋ {{ t('worlds.createBtn').replace('＋ ', '') }}</button>
      </div>

      <div v-if="loading" class="loading">{{ t('worlds.loading') }}</div>
      <div v-else-if="worlds.length === 0" class="empty">
        <div class="empty-icon">🌌</div>
        <p>{{ t('worlds.empty.message') }}</p>
      </div>
      <div v-else class="worlds-grid">
        <div
          v-for="world in worlds"
          :key="world.id"
          class="world-card card"
          @click="router.push(`/worlds/${world.id}`)"
        >
          <div class="world-card-top">
            <div class="world-name">{{ world.name }}</div>
            <button
              class="delete-btn"
              @click.stop="confirmDelete(world)"
              :title="t('worlds.card.deleteTitle')"
            >✕</button>
          </div>
          <div class="world-desc">{{ world.description }}</div>
          <div v-if="world.requirement" class="world-meta-field">
            {{ world.requirement }}
          </div>
          <div v-if="world.comment" class="world-meta-field world-meta-comment">
            {{ world.comment }}
          </div>
          <div class="world-footer">
            <span class="tag">{{ world.user_display_name }}</span>
            <span v-if="world.latest_review" class="has-review">{{ t('worlds.card.hasReview') }}</span>
            <span class="locale-badge">{{ world.locale || 'en' }}</span>
          </div>
        </div>
      </div>
    </main>

    <!-- Create World Modal -->
    <div v-if="showCreate" class="modal-overlay" @click.self="showCreate = false">
      <div class="modal">
        <h2>{{ t('worlds.create.title') }}</h2>
        <div class="form-group">
          <label>{{ t('worlds.create.name') }}<span class="required-star">*</span></label>
          <input v-model="form.name" type="text" :placeholder="t('worlds.create.namePlaceholder')" />
        </div>
        <div class="form-group">
          <label>{{ t('worlds.create.description') }}</label>
          <textarea v-model="form.description" rows="3" :placeholder="t('worlds.create.descriptionPlaceholder')"></textarea>
        </div>
        <div class="form-group">
          <label>{{ t('worlds.create.displayName') }}<span class="required-star">*</span></label>
          <input v-model="form.user_display_name" type="text" :placeholder="t('worlds.create.displayNamePlaceholder')" />
        </div>
        <div class="advanced-toggle" @click="showAdvanced = !showAdvanced">
          <span class="advanced-toggle-icon">{{ showAdvanced ? '▲' : '▼' }}</span>
          <span>{{ t('worlds.create.advanced') }}</span>
          <span v-if="!showAdvanced && (form.requirement || form.comment)" class="advanced-filled-dot" title="">●</span>
        </div>
        <div v-if="showAdvanced" class="advanced-section">
          <div class="form-group">
            <label>{{ t('worlds.create.locale') }}</label>
            <select v-model="form.locale" class="locale-select">
              <option value="en">{{ t('worldLocale.en') }}</option>
              <option value="zh-TW">{{ t('worldLocale.zh-TW') }}</option>
              <option value="zh-CN">{{ t('worldLocale.zh-CN') }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>{{ t('worlds.create.requirement') }}</label>
            <textarea v-model="form.requirement" rows="3" :placeholder="t('worlds.create.requirementPlaceholder')"></textarea>
          </div>
          <div class="form-group">
            <label>{{ t('worlds.create.comment') }}</label>
            <textarea v-model="form.comment" rows="3" :placeholder="t('worlds.create.commentPlaceholder')"></textarea>
          </div>
        </div>
        <div v-if="createError" class="error">{{ createError }}</div>
        <div class="modal-actions">
          <button class="btn" @click="showCreate = false">{{ t('worlds.create.cancel') }}</button>
          <button class="btn btn-primary" @click="createWorld" :disabled="creating">
            {{ creating ? t('worlds.create.submitting') : t('worlds.create.submit') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <div v-if="worldToDelete" class="modal-overlay" @click.self="worldToDelete = null">
      <div class="modal">
        <h2>{{ t('worlds.delete.title') }}</h2>
        <p class="delete-warning" v-html="t('worlds.delete.warning', { name: worldToDelete.name })"></p>
        <div class="modal-actions">
          <button class="btn" @click="worldToDelete = null">{{ t('worlds.delete.cancel') }}</button>
          <button class="btn btn-danger" @click="deleteWorld" :disabled="deleting">
            {{ deleting ? t('worlds.delete.confirming') : t('worlds.delete.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.js';
import { useLocale } from '../composables/useLocale.js';
import api from '../services/api.js';
import LanguageSwitcher from '../components/LanguageSwitcher.vue';

const { t } = useI18n();
const { getDefaultWorldLocale } = useLocale();
const auth = useAuthStore();
const router = useRouter();
const worlds = ref([]);
const loading = ref(true);
const showCreate = ref(false);
const showAdvanced = ref(false);
const creating = ref(false);
const createError = ref('');

function freshForm() {
  return {
    name: '',
    description: '',
    requirement: '',
    comment: '',
    user_display_name: '',
    locale: getDefaultWorldLocale(), // Default world locale = current UI locale
  };
}

const form = ref(freshForm());
const worldToDelete = ref(null);
const deleting = ref(false);

function openCreate() {
  form.value = freshForm(); // Refresh default locale each time
  showCreate.value = true;
}

async function loadWorlds() {
  loading.value = true;
  try {
    const res = await api.get('/worlds');
    worlds.value = res.data;
  } finally {
    loading.value = false;
  }
}

async function createWorld() {
  createError.value = '';
  if (!form.value.name || !form.value.user_display_name) {
    createError.value = t('worlds.create.error.required');
    return;
  }
  creating.value = true;
  try {
    const res = await api.post('/worlds', form.value);
    worlds.value.unshift(res.data);
    showCreate.value = false;
    showAdvanced.value = false;
  } catch (e) {
    createError.value = e.response?.data?.error || t('worlds.create.error.failed');
  } finally {
    creating.value = false;
  }
}

function confirmDelete(world) {
  worldToDelete.value = world;
}

async function deleteWorld() {
  deleting.value = true;
  try {
    await api.delete(`/worlds/${worldToDelete.value.id}`);
    worlds.value = worlds.value.filter(w => w.id !== worldToDelete.value.id);
    worldToDelete.value = null;
  } catch (e) {
    alert(e.response?.data?.error || t('worlds.delete.failed'));
  } finally {
    deleting.value = false;
  }
}

onMounted(loadWorlds);
</script>

<style scoped>
.worlds-page { min-height: 100vh; display: flex; flex-direction: column; }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  background: var(--bg2);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}
.brand { font-size: 18px; font-weight: 700; }
.user-info { display: flex; align-items: center; gap: 12px; color: var(--text2); font-size: 14px; }

.content { flex: 1; max-width: 1100px; margin: 0 auto; width: 100%; padding: 32px 24px; }

.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.page-header h1 { font-size: 26px; }

.loading, .empty { text-align: center; color: var(--text2); padding: 60px 0; }
.empty-icon { font-size: 48px; margin-bottom: 12px; }

.worlds-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }

@media (max-width: 600px) {
  .topbar { padding: 12px 16px; }
  .brand { font-size: 15px; }
  .user-info { gap: 8px; font-size: 13px; }
  .user-info span { display: none; }
  .content { padding: 20px 14px; }
  .page-header { flex-direction: column; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
  .page-header h1 { font-size: 22px; }
  .page-header .btn { width: 100%; justify-content: center; }
  .worlds-grid { grid-template-columns: 1fr; gap: 12px; }
}

@media (min-width: 601px) and (max-width: 900px) {
  .content { padding: 24px 18px; }
  .worlds-grid { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
}

.world-card {
  cursor: pointer;
  transition: all 0.2s;
  border-color: var(--border);
}
.world-card:hover { border-color: var(--primary); transform: translateY(-2px); }

.world-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.world-name { font-size: 18px; font-weight: 600; flex: 1; }

.delete-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text3);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}
.delete-btn:hover {
  background: rgba(255, 68, 68, 0.15);
  border-color: var(--danger);
  color: var(--danger);
}

.world-desc { font-size: 13px; color: var(--text2); margin-bottom: 14px; line-height: 1.5; }
.world-footer { display: flex; align-items: center; gap: 8px; }
.has-review { font-size: 12px; color: var(--success); }

.locale-badge {
  margin-left: auto;
  font-size: 11px;
  font-weight: 600;
  color: var(--text3);
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  letter-spacing: 0.02em;
  font-family: monospace;
}

.delete-warning {
  color: var(--text2);
  line-height: 1.7;
  margin-bottom: 20px;
}
.delete-warning strong { color: var(--text); }

.world-meta-field {
  font-size: 11px;
  color: var(--text3);
  line-height: 1.5;
  margin-bottom: 4px;
  border-left: 2px solid var(--border);
  padding-left: 7px;
  font-style: italic;
}
.world-meta-comment {
  color: var(--text3);
  opacity: 0.75;
}

.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--text2);
  padding: 8px 2px;
  user-select: none;
  margin-top: 2px;
  transition: color 0.15s;
}
.advanced-toggle:hover { color: var(--text); }
.advanced-toggle-icon { font-size: 10px; opacity: 0.6; }
.advanced-filled-dot { color: var(--primary); font-size: 8px; margin-left: 2px; }

.advanced-section {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px 4px;
  margin-bottom: 4px;
}
.advanced-section .form-group:last-child { margin-bottom: 8px; }

.locale-select {
  width: 100%;
  padding: 8px 10px;
  background: var(--bg3);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.locale-select:focus {
  outline: none;
  border-color: var(--primary);
}

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
</style>
