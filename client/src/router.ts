import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from './stores/session.js'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('./views/LoginView.vue'),
    },
    {
      path: '/',
      name: 'calendar',
      component: () => import('./views/CalendarView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/contacts',
      name: 'contacts',
      component: () => import('./views/ContactsView.vue'),
      meta: { requiresAuth: true },
    },
  ],
})

router.beforeEach(async (to) => {
  const session = useSessionStore()
  if (!session.checked) {
    await session.refresh()
  }

  if (to.meta.requiresAuth && !session.info) {
    return { name: 'login' }
  }
  // CalDAV-only account: there is no Contacts half to show.
  if (to.name === 'contacts' && session.info && !session.info.hasContacts) {
    return { name: 'calendar' }
  }
  if (to.name === 'login' && session.info) {
    return { name: 'calendar' }
  }
  return true
})
