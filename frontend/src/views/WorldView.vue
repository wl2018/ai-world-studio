<template>
  <div class="world-page">
    <div class="sidebar-overlay" v-if="sidebarOpen" @click="sidebarOpen = false"></div>

    <!-- Finishing overlay -->
    <div class="finishing-overlay" v-if="finishing">
      <div class="finishing-dialog">
        <div class="finishing-spinner"></div>
        <div class="finishing-title">{{ t('world.finishing.title') }}</div>
        <div class="finishing-desc">{{ t('world.finishing.desc') }}</div>
      </div>
    </div>

    <!-- Sidebar -->
    <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
      <div class="sidebar-header">
        <RouterLink to="/worlds" class="back-btn">{{ t('nav.back') }}</RouterLink>
        <div class="world-title">{{ world?.name }}</div>
        <div class="world-subdesc">{{ world?.description }}</div>
        <div v-if="world?.requirement" class="world-meta-field">{{ world.requirement }}</div>
      </div>

      <div class="sidebar-section-title">{{ t('world.historicalRounds') }}</div>

      <div class="rounds-list">
        <div
          v-for="round in finishedRounds"
          :key="round.id"
          class="round-item"
          :class="{ active: viewingRound?.id === round.id }"
          @click="viewRound(round)"
        >
          <div class="round-date">{{ formatDate(round.created_at) }}</div>
        </div>
        <div v-if="finishedRounds.length === 0" class="no-rounds">{{ t('world.noRounds') }}</div>
      </div>

      <div class="sidebar-footer">
        <button
          v-if="!activeRound && !viewingRound"
          class="btn btn-primary"
          style="width:100%;justify-content:center"
          @click="startNewRound"
          :disabled="startingRound"
        >
          {{ startingRound ? t('world.startingRound') : t('world.startNewRound') }}
        </button>
        <div v-if="activeRound" class="active-badge">{{ t('world.roundInProgress') }}</div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="main-content">
      <!-- Mobile top bar -->
      <div class="mobile-topbar">
        <button class="sidebar-toggle-btn" @click="sidebarOpen = !sidebarOpen" aria-label="Toggle sidebar">☰</button>
        <span class="mobile-world-title">{{ world?.name }}</span>
        <div></div>
      </div>

      <!-- Viewing historical round -->
      <div v-if="viewingRound" class="round-viewer">
        <div class="viewer-header">
          <h2>{{ t('world.viewer.historyTitle', { date: formatDate(viewingRound.created_at) }) }}</h2>
          <div>
            <button class="btn btn-sm btn-danger" @click="confirmDeleteRound">{{ t('world.viewer.deleteRound') }}</button>
            <span>&nbsp;&nbsp;&nbsp;</span>
            <button class="btn btn-sm" @click="viewingRound = null">{{ t('world.viewer.close') }}</button>
          </div>
        </div>
        <div v-if="viewingRound.review" class="review-box">
          <div class="review-label toggle-label" @click="toggleReview('viewingRound')">
            {{ t('world.review.label') }}
            <span class="toggle-arrow">{{ reviewOpen.viewingRound ? '▲' : '▼' }}</span>
          </div>
          <template v-if="reviewOpen.viewingRound">
            <div class="review-content">
              <div v-if="formatRoundReview(viewingRound.review).title" class="review-title">
                {{ formatRoundReview(viewingRound.review).title }}
              </div>
              <ul v-if="formatRoundReview(viewingRound.review).lines.length" class="review-lines">
                <li v-for="(line, i) in formatRoundReview(viewingRound.review).lines" :key="i">{{ line }}</li>
              </ul>
              <p v-if="formatRoundReview(viewingRound.review).summary" class="review-summary">
                {{ formatRoundReview(viewingRound.review).summary }}
              </p>
            </div>
          </template>
        </div>
        <div class="history-section phase1-section" v-if="!showHistoryOnlyPhase2">
          <div class="section-label">{{ t('world.viewer.phase1Label') }}</div>
          <div class="messages">
            <div
              v-for="(msg, i) in viewingRound.phase1_messages"
              :key="i"
              class="msg"
              :class="msg.role === 'user' ? 'msg-user' : 'msg-ai'"
            >
              <div class="msg-speaker">{{ msg.role === 'user' ? world?.user_display_name : t('world.phase1.aiSpeaker') }}</div>
              <div class="msg-text" v-html="formatText(msg.content)"></div>
            </div>
          </div>
        </div>
        <div class="history-section phase2-section">
          <div class="section-label" v-if="!showHistoryOnlyPhase2">{{ t('world.viewer.phase2Label') }}</div>
          <div class="messages">
            <div v-if="viewingRound.phase2_meta" class="phase2-context-banner">
              <span class="phase2-context-icon">🌍</span>
              <div class="phase2-context-text">
                <span class="phase2-context-item" v-for="(line, index) in parseLinesInvite(viewingRound.phase2_meta.linesInvite)" :key="index">
                  <span class="phase2-context-label" v-if="line.title">{{line.title}}</span>
                  {{line.description}}
                </span>
              </div>
            </div>
            <div
              v-for="(msg, i) in simplifyPhase2Messages(viewingRound.phase2_messages, world?.user_display_name)"
              :key="i"
              class="msg"
              :class="getMsgClass(msg)"
            >
              <div class="msg-speaker" v-if="msg.speaker !== '_system' && msg.speaker !== '_continue'">{{ msg.speaker }}</div>
              <div class="msg-text" v-html="formatText(msg.text)"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Active Round -->
      <div v-else-if="activeRound" class="active-round">
        <div class="shared-scroll" ref="sharedContainer">

          <!-- Phase 1 -->
          <div class="phase-block phase1-block">
            <div class="phase-header">
              <span class="phase-badge">{{ t('world.phase1.label') }}</span>
              <button class="btn btn-sm btn-danger" @click="confirmDiscardRound">{{ t('world.phase1.discardRound') }}</button>
            </div>
            <div class="phase-messages">
              <div
                v-for="(msg, i) in activeRound.phase1_messages"
                :key="'p1-'+i"
                class="msg"
                :class="msg.role === 'user' ? 'msg-user' : 'msg-ai'"
              >
                <div class="msg-speaker">{{ msg.role === 'user' ? world?.user_display_name : t('world.phase1.aiSpeaker') }}</div>
                <div class="msg-text" v-html="formatText(msg.content)"></div>
              </div>
              <div v-if="phase1Loading" class="msg msg-ai loading-msg">
                <div class="msg-speaker">{{ t('world.phase1.aiSpeaker') }}</div>
                <div class="typing-indicator"><span></span><span></span><span></span></div>
              </div>
            </div>
          </div>

          <!-- Phase 2 -->
          <template v-if="activeRound.status === 'phase2' || activeRound.status === 'finished'">
            <div class="phase-divider-h"></div>
            <div class="phase-block phase2-block">
              <div class="phase-header">
                <span class="phase-badge">{{ t('world.phase2.label') }}</span>
                <button
                  v-if="activeRound.status === 'phase2'"
                  class="btn btn-sm btn-primary"
                  @click="confirmFinishRound"
                >{{ t('world.phase2.endRound') }}</button>
              </div>
              <div class="phase-messages">
                <div v-if="phase2Context" class="phase2-context-banner">
                  <span class="phase2-context-icon">🌍</span>
                  <div class="phase2-context-text">
                    <span class="phase2-context-item" v-for="(line, index) in parseLinesInvite(phase2Context.linesInvite)" :key="index">
                      <span class="phase2-context-label" v-if="line.title">{{line.title}}</span>
                      {{line.description}}
                    </span>
                  </div>
                </div>
                <div
                  v-for="(msg, i) in simplifyPhase2Messages(activeRound.phase2_messages, world?.user_display_name)"
                  :key="'p2-'+i"
                  class="msg"
                  :class="getP2MsgClass(msg)"
                >
                  <template v-if="msg.speaker !== '_system'">
                    <div class="msg-speaker" v-if="msg.speaker !== '_continue'">{{ msg.speaker }}</div>
                    <div class="msg-text">{{ msg.text }}</div>
                  </template>
                  <template v-else>
                    <div class="system-msg">{{ msg.show }}</div>
                  </template>
                </div>
                <div v-if="phase2Loading" class="msg loading-msg">
                  <div class="typing-indicator"><span></span><span></span><span></span></div>
                </div>
              </div>
            </div>
          </template>

        </div>

        <!-- Fixed bottom input -->
        <div class="round-input-area">
          <template v-if="activeRound.status === 'phase1'">
            <div class="input-area">
              <div class="input-main">
                <textarea
                  ref="phase1TextareaRef"
                  v-model="phase1Input"
                  :placeholder="t('world.phase1.inputPlaceholder')"
                  rows="3"
                  @keydown.enter="handleEnter($event, sendPhase1, phase1Loading)"
                ></textarea>
                <button class="btn btn-primary" @click="sendPhase1AndFocus" :disabled="phase1Loading">
                  {{ phase1Input.trim() ? t('world.phase1.send') : t('world.phase1.skip') }}
                </button>
              </div>
              <div class="input-options">
                <label class="enter-option">
                  <input type="checkbox" v-model="enterNewline" />
                  <span>{{ t('world.phase1.enterNewline') }}</span>
                </label>
              </div>
            </div>
          </template>

          <div v-if="pendingStartChat" class="start-chat-prompt">
            <div class="start-chat-info">
              <strong>{{ t('world.phase2.readyTitle') }}</strong><br>
              <div class="phase2-context-text">
                <span class="phase2-context-item" v-for="(line, index) in parseLinesInvite(pendingStartChat.linesInvite)" :key="index">
                  <span class="phase2-context-label" v-if="line.title">{{line.title}}</span>
                  {{line.description}}
                </span>
              </div>
            </div>
            <button class="btn btn-primary" @click="startPhase2" :disabled="starting2">
              {{ starting2 ? t('world.phase2.entering') : t('world.phase2.enterWorld') }}
            </button>
          </div>

          <template v-if="activeRound.status === 'phase2'">
            <div class="input-area">
              <div v-if="allCharsLeft" class="status-banner status-all-left">
                <span>{{ t('world.phase2.allLeft') }}</span>
                <span class="status-hint">{{ t('world.phase2.allLeftHint') }}</span>
              </div>
              <div class="input-main">
                <textarea
                  ref="phase2TextareaRef"
                  v-model="phase2Input"
                  :placeholder="t('world.phase2.inputPlaceholder', { name: world?.user_display_name })"
                  rows="3"
                  @keydown.enter="handlePhase2Enter($event)"
                  @keydown.ctrl="handlePhase2Ctrl($event)"
                ></textarea>
                <div class="input-actions">
                  <button class="btn status-all-left btn-rejoin" @click="contChat" :disabled="phase2Loading" v-if="allCharsLeft">
                    {{ t('world.phase2.rejoin') }}
                  </button>
                  <button class="btn" @click="goBack()" :disabled="phase2Loading" v-if="!allCharsLeft">
                    {{ singleLineMode ? t('world.phase2.goBack') : t('world.phase2.goBackMulti') }}
                  </button>
                  <button class="btn btn-primary" @click="sendPhase2AndFocus" :disabled="phase2Loading || allCharsLeft || (phase2Input.length && !phase2Input.trim())">
                    {{ phase2Input ? t('world.phase2.send') : t('world.phase2.skip') }}
                  </button>
                </div>
              </div>
              <div class="input-options">
                <label class="enter-option">
                  <input type="checkbox" v-model="allowAfterUserComment" />
                  <span>{{ t('world.phase2.allowAfterComment') }}</span>
                </label>
                <span>&nbsp;</span>
                <label class="enter-option">
                  <input type="checkbox" v-model="enterNewline" />
                  <span>{{ t('world.phase2.enterNewline') }}</span>
                </label>
                <span>&nbsp;</span>
                <label class="enter-option">
                  <input type="checkbox" v-model="singleLineMode" />
                  <span>{{ t('world.phase2.singleLine') }}</span>
                </label>
              </div>
            </div>
          </template>

          <div v-if="activeRound.status === 'finished'" class="review-box">
            <div class="review-label toggle-label" @click="toggleReview('activeRound')">
              {{ t('world.review.activeLabel') }}
              <span class="toggle-arrow">{{ reviewOpen.activeRound ? '▲' : '▼' }}</span>
            </div>
            <template v-if="reviewOpen.activeRound">
              <div class="review-content">
                <div v-if="formatRoundReview(activeRound.review).title" class="review-title">
                  {{ formatRoundReview(activeRound.review).title }}
                </div>
                <ul v-if="formatRoundReview(activeRound.review).lines.length" class="review-lines">
                  <li v-for="(line, i) in formatRoundReview(activeRound.review).lines" :key="i">{{ line }}</li>
                </ul>
                <p v-if="formatRoundReview(activeRound.review).summary" class="review-summary">
                  {{ formatRoundReview(activeRound.review).summary }}
                </p>
              </div>
            </template>
            <button class="btn btn-primary" style="margin-top:12px" @click="clearActive">{{ t('world.review.close') }}</button>
          </div>
        </div>
      </div>

      <!-- No active round / welcome -->
      <div v-else class="welcome">
        <div class="welcome-icon">🌐</div>
        <h2>{{ world?.name }}</h2>
        <p>{{ world?.description }}</p>
        <div v-if="world?.requirement || world?.comment" class="welcome-meta">
          <div v-if="world?.requirement" class="welcome-meta-item">
            <span class="welcome-meta-label">{{ t('world.additionalDesc') }}</span>
            <span>{{ world.requirement }}</span>
          </div>
          <div v-if="world?.comment" class="welcome-meta-item welcome-meta-comment">
            <span class="welcome-meta-label">{{ t('world.notes') }}</span>
            <span>{{ world.comment }}</span>
          </div>
        </div>
        <button class="btn btn-primary" style="margin-top:20px" @click="startNewRound" :disabled="startingRound">
          {{ startingRound ? t('world.startingRound') : t('world.startNewRound') }}
        </button>
      </div>
    </main>

    <!-- Discard confirm -->
    <div v-if="showDiscardConfirm" class="modal-overlay">
      <div class="modal">
        <h2>{{ t('world.discard.title') }}</h2>
        <p style="color:var(--text2);margin-bottom:20px;line-height:1.6">{{ t('world.discard.message') }}</p>
        <div class="modal-actions">
          <button class="btn" @click="showDiscardConfirm = false">{{ t('world.discard.cancel') }}</button>
          <button class="btn btn-danger" @click="discardRound">{{ t('world.discard.confirm') }}</button>
        </div>
      </div>
    </div>

    <!-- Finish confirm -->
    <div v-if="showFinishConfirm" class="modal-overlay">
      <div class="modal">
        <h2>{{ t('world.finish.title') }}</h2>
        <p style="color:var(--text2);margin-bottom:20px;line-height:1.6">{{ t('world.finish.message') }}</p>
        <div class="modal-actions">
          <button class="btn" @click="showFinishConfirm = false">{{ t('world.finish.cancel') }}</button>
          <button class="btn btn-primary" @click="finishRound" :disabled="finishing">
            {{ finishing ? t('world.finish.confirming') : t('world.finish.confirm') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Delete round confirm -->
    <div v-if="showDeleteConfirm" class="modal-overlay">
      <div class="modal">
        <h2>{{ t('world.deleteRound.title') }}</h2>
        <p style="color:var(--text2);margin-bottom:20px;line-height:1.6">{{ t('world.deleteRound.message') }}</p>
        <div class="modal-actions">
          <button class="btn" @click="showDeleteConfirm = false">{{ t('world.deleteRound.cancel') }}</button>
          <button class="btn btn-danger" @click="deleteRound">{{ t('world.deleteRound.confirm') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute, RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import api from '../services/api.js';

const { t } = useI18n();
const route = useRoute();
const worldId = route.params.worldId;

const sidebarOpen = ref(false);
const world = ref(null);
const rounds = ref([]);
const activeRound = ref(null);
const viewingRound = ref(null);

const phase1Input = ref('');
const phase2Input = ref('');
const allowAfterUserComment = ref(false);
const enterNewline = ref(false);
const singleLineMode = ref(false);
const phase1Loading = ref(false);
const phase2Loading = ref(false);
const startingRound = ref(false);
const starting2 = ref(false);
const finishing = ref(false);

const allCharsLeft = ref(false);
const showDiscardConfirm = ref(false);
const showFinishConfirm = ref(false);
const showDeleteConfirm = ref(false);
const showHistoryOnlyPhase2 = ref(true);
const pendingStartChat = ref(null);
const phase2Context = ref(null);
const sharedContainer = ref(null);

const reviewOpen = ref({ viewingRound: false, activeRound: false });
function toggleReview(key) { reviewOpen.value[key] = !reviewOpen.value[key]; }

const finishedRounds = computed(() =>
  rounds.value.filter(r => r.status === 'finished').sort((a, b) => b.created_at - a.created_at)
);

async function loadWorld() {
  const res = await api.get(`/worlds/${worldId}`);
  world.value = res.data;
}

async function loadRounds() {
  const res = await api.get(`/worlds/${worldId}/rounds`);
  rounds.value = res.data;
  const active = res.data.find(r => r.status === 'phase1' || r.status === 'phase2');
  if (active) {
    activeRound.value = active;
    if (active.status === 'phase1' && active.pending_start_chat) {
      const { linesInvite } = active.pending_start_chat;
      pendingStartChat.value = { linesInvite };
    }
    if (active.status === 'phase2' && active.phase2_meta) {
      const meta = typeof active.phase2_meta === 'string' ? JSON.parse(active.phase2_meta) : active.phase2_meta;
      allCharsLeft.value = meta.allCharsLeft;
      phase2Context.value = { linesInvite: meta.linesInvite };
    }
  }
}

async function startNewRound() {
  startingRound.value = true;
  try {
    const res = await api.post(`/worlds/${worldId}/rounds`);
    activeRound.value = res.data;
    rounds.value.unshift(res.data);
    pendingStartChat.value = null;
  } finally {
    startingRound.value = false;
  }
}

const phase1TextareaRef = ref(null);
const phase2TextareaRef = ref(null);

function handlePhase2Enter(event) {
  if (!allCharsLeft.value) handleEnter(event, sendPhase2, phase2Loading.value);
}

function handlePhase2Ctrl(event) {
  if (event.shiftKey) return;
  if (event.key === 'ArrowUp') { event.preventDefault(); goBack(true); }
  else if (['z','Z'].includes(event.key)) { event.preventDefault(); goBack(singleLineMode.value); }
  else if (['1','s','S'].includes(event.key)) { event.preventDefault(); allowAfterUserComment.value = !allowAfterUserComment.value; }
  else if (['2','d','D'].includes(event.key)) { event.preventDefault(); enterNewline.value = !enterNewline.value; }
  else if (['3','f','F'].includes(event.key)) { event.preventDefault(); singleLineMode.value = !singleLineMode.value; }
}

function handleEnter(event, sendFn, loading) {
  if (enterNewline.value) return;
  if (event.shiftKey) return;
  if (loading) return;
  event.preventDefault();
  sendFn();
}

async function sendPhase1AndFocus() {
  await sendPhase1();
  nextTick(() => { phase1TextareaRef.value?.focus(); });
}

async function sendPhase2AndFocus() {
  await sendPhase2();
  nextTick(() => { phase2TextareaRef.value?.focus(); });
}

async function sendPhase1() {
  if (phase1Loading.value) return;
  const msg = phase1Input.value.trim();
  phase1Input.value = '';
  phase1Loading.value = true;
  try {
    const res = await api.post(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat/phase1`, { message: msg });
    activeRound.value.phase1_messages = res.data.messages;
    if (res.data.command?.type === 'start_chat') {
      pendingStartChat.value = { linesInvite: res.data.command.linesInvite };
    }
    await nextTick();
    scrollToBottom(sharedContainer.value);
  } finally {
    phase1Loading.value = false;
  }
}

async function startPhase2() {
  starting2.value = true;
  try {
    await api.post(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat/start_phase2`, {});
    allCharsLeft.value = false;
    activeRound.value.status = 'phase2';
    activeRound.value.phase2_messages = [];
    phase2Context.value = { ...pendingStartChat.value };
    pendingStartChat.value = null;
    await nextTick();
    scrollToBottom(sharedContainer.value);
  } catch (e) {
    alert('Error: ' + (e.response?.data?.error || e.message));
  } finally {
    starting2.value = false;
  }
}

async function sendPhase2() {
  if (phase2Loading.value || allCharsLeft.value) return;
  const msg = phase2Input.value.trim();
  phase2Input.value = '';
  phase2Loading.value = true;
  try {
    const res = await api.post(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat/phase2/user`, {
      message: msg, singleLineMode: singleLineMode.value, allowAfterUserComment: allowAfterUserComment.value
    });
    activeRound.value.phase2_messages = res.data.messages;
    if (res.data.event === 'all_left') allCharsLeft.value = true;
    await nextTick();
    scrollToBottom(sharedContainer.value);
  } finally {
    phase2Loading.value = false;
  }
}

async function contChat() {
  if (activeRound.value.status !== 'phase2' || !allCharsLeft.value) return;
  try {
    const res = await api.post(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat/phase2/continue_chat`, {});
    allCharsLeft.value = res.data.allCharsLeft;
    await nextTick();
    scrollToBottom(sharedContainer.value);
  } finally {}
}

async function goBack(_singleLineMode) {
  if (activeRound.value.status !== 'phase2') return;
  if (allCharsLeft.value) { contChat(); return; }
  try {
    const res = await api.post(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat/phase2/go_back`, {
      singleLineMode: _singleLineMode === undefined ? singleLineMode.value : _singleLineMode
    });
    activeRound.value.phase2_messages = res.data.messages;
    await nextTick();
    scrollToBottom(sharedContainer.value);
  } finally {}
}

function confirmDiscardRound() { showDiscardConfirm.value = true; }
function confirmFinishRound() { showFinishConfirm.value = true; }
function confirmDeleteRound() { showDeleteConfirm.value = true; }

async function discardRound() {
  await api.delete(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat`);
  rounds.value = rounds.value.filter(r => r.id !== activeRound.value.id);
  activeRound.value = null;
  pendingStartChat.value = null;
  showDiscardConfirm.value = false;
}

async function finishRound() {
  showFinishConfirm.value = false;
  finishing.value = true;
  try {
    const res = await api.post(`/worlds/${worldId}/rounds/${activeRound.value.id}/chat/finish`);
    activeRound.value.status = 'finished';
    activeRound.value.review = res.data.roundReview;
    const idx = rounds.value.findIndex(r => r.id === activeRound.value.id);
    if (idx >= 0) rounds.value[idx] = { ...activeRound.value };
  } finally {
    finishing.value = false;
  }
}

async function deleteRound() {
  showDeleteConfirm.value = false;
  try {
    await api.delete(`/worlds/${worldId}/rounds/${viewingRound.value.id}/chat`);
    rounds.value = rounds.value.filter(r => r.id !== viewingRound.value.id);
    viewingRound.value = null;
  } finally {}
}

function clearActive() {
  const idx = rounds.value.findIndex(r => r.id === activeRound.value.id);
  if (idx >= 0) rounds.value[idx] = { ...activeRound.value };
  activeRound.value = null;
}

function viewRound(round) {
  viewingRound.value = round;
  reviewOpen.value.viewingRound = false;
  sidebarOpen.value = false;
}

function getMsgClass(msg) {
  if (msg.speaker === '_system') return 'msg-system';
  return 'msg-char';
}

function getP2MsgClass(msg) {
  if (msg.speaker === '_system') return 'msg-system';
  if (msg.speaker === world.value?.user_display_name || msg.is_user) return 'msg-user';
  return 'msg-char';
}

function formatText(text) {
  if (!text) return '';
  if (text === '[Invitation sent]')
    return t('world.phase1.invitationSent');
  else if (text === '[The user has generated an invitation through the command]')
    return t('world.phase1.invitationSentByCommand');
  else if (text === '[An error occurred while processing the user instruction]')
    return t('world.phase1.userCommandError')
  return text
    .replace(/```([^```]*)```/gs, '<pre class="code-block">$1</pre>')
    .replace(/\n/g, '<br>');
}

function formatDate(ts) {
  if (!ts) return '';
  // Use locale-aware date formatting based on current UI locale
  return new Date(ts * 1000).toLocaleString();
}

function formatRoundReview(roundReview) {
  const out = { title: '', lines: [], summary: '' };
  if (roundReview.title) out.title = roundReview.title;
  if (roundReview.linesReview?.length) {
    for (const line of roundReview.linesReview) {
      if (line.slice(0, 1) !== '@') out.lines.push(line);
    }
  }
  if (roundReview.summary) out.summary = roundReview.summary;
  return out;
}

function parseLinesInvite(linesInvite) {
  const linesParsed = [];
  for (const line of linesInvite) {
    const m = line.match(/[:：]/);
    if (m) {
      linesParsed.push({ title: line.slice(0, m.index), description: line.slice(m.index + 1) });
    } else {
      linesParsed.push({ description: line });
    }
  }
  return linesParsed;
}

function simplifyPhase2Messages(messages, user) {
  const simplified = [];
  let speaker = null;
  let spoken = false;
  for (const msg of messages) {
    if (speaker !== msg.speaker && msg.speaker !== '_continue') {
      speaker = msg.speaker;
      spoken = false;
    }
    if (!msg.text.trim()) continue;
    if (!spoken)
      simplified.push({ speaker, text: msg.text.trim(), is_user: speaker === user });
    else
      simplified.push({ speaker: '_continue', text: msg.text.trim(), is_user: speaker === user });
    spoken = true;
  }
  return simplified;
}

function scrollToBottom(el) { if (el) el.scrollTop = el.scrollHeight; }

watch(() => activeRound.value?.phase1_messages?.length, async () => { await nextTick(); scrollToBottom(sharedContainer.value); });
watch(() => activeRound.value?.phase2_messages?.length, async () => { await nextTick(); scrollToBottom(sharedContainer.value); });

onMounted(async () => {
  await loadWorld();
  await loadRounds();
});
</script>

<style scoped>
.world-page { display: flex; height: 100vh; overflow: hidden; }

.sidebar {
  width: 260px; min-width: 260px;
  background: var(--bg2); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
}
.sidebar-header { padding: 16px; border-bottom: 1px solid var(--border); }
.back-btn { font-size: 13px; color: var(--text2); display: block; margin-bottom: 10px; }
.back-btn:hover { color: var(--text); }
.world-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
.world-subdesc { font-size: 12px; color: var(--text2); line-height: 1.4; }
.sidebar-section-title { padding: 12px 16px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text3); }
.rounds-list { flex: 1; overflow-y: auto; padding: 4px 8px; }
.round-item { padding: 10px; border-radius: 8px; cursor: pointer; margin-bottom: 4px; transition: background 0.15s; }
.round-item:hover { background: var(--bg3); }
.round-item.active { background: var(--bg4); }
.round-date { font-size: 11px; color: var(--text3); margin-bottom: 3px; }
.no-rounds { text-align: center; color: var(--text3); font-size: 13px; padding: 20px 0; }
.sidebar-footer { padding: 14px; border-top: 1px solid var(--border); }
.active-badge { text-align: center; font-size: 13px; color: var(--success); font-weight: 600; }

.main-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.welcome { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; text-align: center; }
.welcome-icon { font-size: 52px; margin-bottom: 16px; }
.welcome h2 { font-size: 26px; margin-bottom: 8px; }
.welcome p { color: var(--text2); max-width: 400px; line-height: 1.6; }

.active-round { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.shared-scroll { flex: 1; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; }
.phase-block { display: flex; flex-direction: column; flex-shrink: 0; }
.phase1-block { background: var(--phase1-bg); }
.phase2-block { background: var(--phase2-bg); }
.phase-divider-h { height: 4px; flex-shrink: 0; background: linear-gradient(90deg, var(--primary), #44cc88); }
.phase-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 2; }
.phase1-block .phase-header { background: var(--phase1-bg); }
.phase2-block .phase-header { background: var(--phase2-bg); }
.phase-badge { font-size: 12px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.06em; }
.phase-messages { padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; }

.phase2-context-banner { display: flex; align-items: flex-start; gap: 10px; background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; margin-bottom: 4px; font-size: 13px; color: var(--text2); line-height: 1.5; }
.phase2-context-icon { font-size: 16px; margin-top: 1px; flex-shrink: 0; }
.phase2-context-text { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.phase2-context-item { display: inline; }
.phase2-context-label { font-weight: 600; color: var(--text1); margin-right: 4px; }

.round-input-area { flex-shrink: 0; border-top: 1px solid var(--border); background: var(--bg2); }
.msg { display: flex; flex-direction: column; gap: 4px; max-width: 75%; }
.msg-user { align-self: flex-end; align-items: flex-end; }
.msg-ai { align-self: flex-start; }
.msg-char { align-self: flex-start; }
.msg-speaker { font-size: 11px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.04em; }
.msg-user .msg-speaker { color: var(--primary); }
.msg-text { background: var(--bg3); border: 1px solid var(--border); border-radius: 12px; padding: 10px 14px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; }
.msg-user .msg-text { background: var(--primary); border-color: var(--primary); color: #fff; border-radius: 12px 12px 4px 12px; }
.msg-ai .msg-text, .msg-char .msg-text { border-radius: 12px 12px 12px 4px; }
.system-msg { align-self: center; font-size: 12px; color: var(--text3); font-style: italic; background: var(--bg4); padding: 4px 12px; border-radius: 100px; }
.loading-msg { align-self: flex-start; }
.typing-indicator { display: flex; gap: 4px; padding: 12px 16px; background: var(--bg3); border: 1px solid var(--border); border-radius: 12px; }
.typing-indicator span { width: 6px; height: 6px; border-radius: 50%; background: var(--text2); animation: bounce 1.2s infinite; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

.input-area { padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
.input-main { display: flex; gap: 10px; align-items: flex-end; }
.input-main textarea { flex: 1; min-height: 60px; max-height: 140px; }
.input-options { display: flex; align-items: center; padding: 0 2px; }
.enter-option { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text2); cursor: pointer; user-select: none; }
.enter-option input[type="checkbox"] { width: 13px; height: 13px; cursor: pointer; accent-color: var(--primary); }

.start-chat-prompt { margin: 0; padding: 12px 16px; background: var(--bg3); border: 1px solid var(--primary); border-radius: 10px; display: flex; align-items: center; justify-content: space-between; gap: 14px; font-size: 14px; line-height: 1.5; flex-shrink: 0; }
.start-chat-info { flex: 1; color: var(--text2); }
.start-chat-info strong { color: var(--text); display: block; margin-bottom: 4px; }

.review-box { margin: 12px 16px; padding: 14px; background: var(--bg3); border: 1px solid var(--border); border-radius: 10px; flex-shrink: 0; }
.review-label { font-size: 12px; font-weight: 600; color: var(--text2); margin-bottom: 8px; }
.toggle-label { display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; margin-bottom: 0; padding: 4px 0; }
.toggle-label:hover { color: var(--text); }
.toggle-arrow { font-size: 10px; opacity: 0.6; }
.review-content { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.review-title { font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.4; }
.review-lines { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
.review-lines li { font-size: 12px; color: var(--text2); line-height: 1.5; padding-left: 10px; position: relative; }
.review-lines li::before { content: '·'; position: absolute; left: 0; color: var(--text2); }
.review-summary { margin: 0; font-size: 13px; color: var(--text); line-height: 1.6; padding-top: 4px; border-top: 1px solid var(--border); }

.round-viewer { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
.viewer-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; border-bottom: 1px solid var(--border); background: var(--bg2); flex-shrink: 0; }
.viewer-header h2 { font-size: 16px; }
.history-section { padding: 20px 24px; }
.section-label { font-size: 12px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
.history-section.phase1-section { background: var(--phase1-bg); }
.history-section.phase2-section { background: var(--phase2-bg); }

:deep(.code-block) { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 13px; white-space: pre-wrap; margin: 6px 0; font-family: monospace; }

.input-actions { display: flex; flex-direction: column; gap: 6px; align-items: stretch; }

.status-banner { display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.status-all-left { background: rgba(100,180,100,0.1); border: 1px solid rgba(100,180,100,0.3); color: var(--success, #44aa77); }
.status-hint { font-size: 11px; opacity: 0.75; }
.btn-rejoin { border-color: var(--success, #44cc88); color: var(--success, #44cc88); }
.btn-rejoin:hover { background: rgba(68,204,136,0.08); }

.world-meta-field { font-size: 11px; color: var(--text3); line-height: 1.5; margin-top: 5px; border-left: 2px solid var(--border); padding-left: 6px; font-style: italic; }

.welcome-meta { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; max-width: 420px; text-align: left; width: 100%; }
.welcome-meta-item { font-size: 12px; color: var(--text3); line-height: 1.5; border-left: 2px solid var(--border); padding-left: 8px; font-style: italic; }
.welcome-meta-comment { opacity: 0.7; }
.welcome-meta-label { font-weight: 600; font-style: normal; color: var(--text2); margin-right: 5px; }

.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }

.mobile-topbar { display: none; }
.sidebar-overlay { display: none; }

@media (max-width: 768px) {
  .world-page { flex-direction: column; position: relative; }
  .sidebar-overlay { display: block; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; }
  .sidebar { position: fixed; top: 0; left: 0; height: 100%; z-index: 101; transform: translateX(-100%); transition: transform 0.25s ease; width: 280px; min-width: 280px; box-shadow: 4px 0 20px rgba(0,0,0,0.4); }
  .sidebar.sidebar-open { transform: translateX(0); }
  .mobile-topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--bg2); border-bottom: 1px solid var(--border); flex-shrink: 0; position: sticky; top: 0; z-index: 10; }
  .sidebar-toggle-btn { background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 8px; padding: 6px 10px; font-size: 16px; cursor: pointer; line-height: 1; }
  .mobile-world-title { font-size: 15px; font-weight: 600; color: var(--text); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg { max-width: 90%; }
  .phase-header { flex-wrap: wrap; gap: 6px; padding: 8px 12px; }
  .input-area { padding: 10px 12px; }
  .input-main { gap: 8px; }
  .input-main textarea { min-height: 50px; }
  .start-chat-prompt { flex-direction: column; align-items: flex-start; gap: 10px; }
  .start-chat-prompt .btn { width: 100%; justify-content: center; }
  .review-box { margin: 10px 12px; }
  .viewer-header { flex-direction: column; align-items: flex-start; gap: 10px; padding: 12px 16px; }
  .history-section { padding: 16px 14px; }
  .phase-messages { padding: 12px 14px; }
  .input-actions { flex-direction: column; align-items: stretch; }
  .welcome { padding: 30px 20px; }
  .welcome h2 { font-size: 22px; }
}

@media (min-width: 769px) {
  .mobile-topbar { display: none; }
  .sidebar-toggle-btn { display: none; }
}

.finishing-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 9999; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
.finishing-dialog { background: #1e1e2e; border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 40px 48px; display: flex; flex-direction: column; align-items: center; gap: 16px; box-shadow: 0 8px 40px rgba(0,0,0,0.5); min-width: 260px; text-align: center; }
.finishing-spinner { width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.15); border-top-color: #7c9dff; border-radius: 50%; animation: finishing-spin 0.9s linear infinite; }
@keyframes finishing-spin { to { transform: rotate(360deg); } }
.finishing-title { font-size: 18px; font-weight: 600; color: #e2e8f0; letter-spacing: 0.02em; }
.finishing-desc { font-size: 14px; color: #94a3b8; line-height: 1.5; }
</style>
