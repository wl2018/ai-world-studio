import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import api from '../services/api.js';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || null);
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'));

  const isLoggedIn = computed(() => !!token.value);

  async function login(username, password) {
    const res = await api.post('/auth/login', { username, password });
    token.value = res.data.token;
    user.value = { id: res.data.userId, username: res.data.username };
    localStorage.setItem('token', token.value);
    localStorage.setItem('user', JSON.stringify(user.value));
  }

  async function register(username, password) {
    const res = await api.post('/auth/register', { username, password });
    token.value = res.data.token;
    user.value = { id: res.data.userId, username: res.data.username };
    localStorage.setItem('token', token.value);
    localStorage.setItem('user', JSON.stringify(user.value));
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  return { token, user, isLoggedIn, login, register, logout };
});
