import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const routes = [
  { path: '/', redirect: '/worlds' },
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { guest: true } },
  { path: '/register', component: () => import('../views/RegisterView.vue'), meta: { guest: true } },
  { path: '/worlds', component: () => import('../views/WorldsView.vue'), meta: { auth: true } },
  { path: '/worlds/:worldId', component: () => import('../views/WorldView.vue'), meta: { auth: true } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.auth && !auth.isLoggedIn) return '/login';
  if (to.meta.guest && auth.isLoggedIn) return '/worlds';
});

export default router;
