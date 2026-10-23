<script setup lang="ts">
import type { Contact, ContactFields } from '@yourcal/shared'
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import AppNavSwitcher from '../components/AppNavSwitcher.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import SettingsDialog from '../components/SettingsDialog.vue'
import { useContactsStore } from '../stores/contacts.js'
import { useSessionStore } from '../stores/session.js'

const contactsStore = useContactsStore()
const session = useSessionStore()

const showSettingsDialog = ref(false)
const confirmingDelete = ref<Contact | null>(null)
const confirmingDeleteBook = ref<string | null>(null)
const isEditing = ref(false)
const isCreating = ref(false)
const newBookName = ref('')
const showNewBookForm = ref(false)
const newBookInput = ref<HTMLInputElement | null>(null)

// Edit/Create form state
const form = reactive<ContactFields>({
  fn: '',
  givenName: '',
  familyName: '',
  nickname: '',
  organization: '',
  title: '',
  role: '',
  notes: '',
  bday: '',
  url: '',
  emails: [],
  phones: [],
  addresses: [],
})

onMounted(async () => {
  await contactsStore.loadAddressBooks()
})

async function onLogout(): Promise<void> {
  await session.logout()
  window.location.href = '/login'
}

function selectContact(contact: Contact): void {
  contactsStore.selectedUid = contact.uid
  isEditing.value = false
  isCreating.value = false
}

function startCreate(): void {
  contactsStore.selectedUid = null
  isEditing.value = false
  isCreating.value = true
  resetForm()
}

function startEdit(): void {
  if (!contactsStore.selectedContact) return
  isCreating.value = false
  isEditing.value = true
  const c = contactsStore.selectedContact
  form.fn = c.fn
  form.givenName = c.givenName ?? ''
  form.familyName = c.familyName ?? ''
  form.nickname = c.nickname ?? ''
  form.organization = c.organization ?? ''
  form.title = c.title ?? ''
  form.role = c.role ?? ''
  form.notes = c.notes ?? ''
  form.bday = c.bday ?? ''
  form.url = c.url ?? ''
  form.emails = (c.emails ?? []).map((e) => ({ ...e }))
  form.phones = (c.phones ?? []).map((p) => ({ ...p }))
  form.addresses = (c.addresses ?? []).map((a) => ({ ...a }))
}

function cancelEdit(): void {
  isEditing.value = false
  isCreating.value = false
  resetForm()
}

function resetForm(): void {
  form.fn = ''
  form.givenName = ''
  form.familyName = ''
  form.nickname = ''
  form.organization = ''
  form.title = ''
  form.role = ''
  form.notes = ''
  form.bday = ''
  form.url = ''
  form.emails = [{ type: 'WORK', value: '' }]
  form.phones = [{ type: 'CELL', value: '' }]
  form.addresses = []
}

function addEmail(): void {
  form.emails.push({ type: 'WORK', value: '' })
}

function removeEmail(idx: number): void {
  form.emails.splice(idx, 1)
}

function addPhone(): void {
  form.phones.push({ type: 'CELL', value: '' })
}

function removePhone(idx: number): void {
  form.phones.splice(idx, 1)
}

function addAddress(): void {
  form.addresses.push({ type: 'HOME', street: '', locality: '', region: '', postalCode: '', country: '' })
}

function removeAddress(idx: number): void {
  form.addresses.splice(idx, 1)
}

async function saveContact(): Promise<void> {
  if (!contactsStore.activeBookId) return

  const given = form.givenName?.trim() || undefined
  const family = form.familyName?.trim() || undefined
  const full = form.fn.trim() || [given, family].filter(Boolean).join(' ') || 'Unnamed'

  const payload: ContactFields = {
    fn: full,
    givenName: given,
    familyName: family,
    nickname: form.nickname?.trim() || undefined,
    organization: form.organization?.trim() || undefined,
    title: form.title?.trim() || undefined,
    role: form.role?.trim() || undefined,
    notes: form.notes?.trim() || undefined,
    bday: form.bday?.trim() || undefined,
    url: form.url?.trim() || undefined,
    emails: form.emails.map((e) => ({ type: e.type, value: e.value.trim() })).filter((e) => e.value),
    phones: form.phones.map((p) => ({ type: p.type, value: p.value.trim() })).filter((p) => p.value),
    addresses: form.addresses.filter(
      (a) => a.street?.trim() || a.locality?.trim() || a.region?.trim() || a.postalCode?.trim() || a.country?.trim(),
    ),
  }

  if (isCreating.value) {
    await contactsStore.createContact(contactsStore.activeBookId, payload)
    isCreating.value = false
  } else if (isEditing.value && contactsStore.selectedContact) {
    const c = contactsStore.selectedContact
    await contactsStore.updateContact(contactsStore.activeBookId, c.uid, payload, c.href, c.etag)
    isEditing.value = false
  }
}

async function onDeleteContact(): Promise<void> {
  const contact = confirmingDelete.value
  confirmingDelete.value = null
  if (!contact || !contactsStore.activeBookId) return
  await contactsStore.deleteContact(contactsStore.activeBookId, contact.uid, contact.href, contact.etag)
}

function toggleNewBookForm(): void {
  showNewBookForm.value = !showNewBookForm.value
  if (showNewBookForm.value) {
    newBookName.value = ''
    void nextTick(() => newBookInput.value?.focus())
  }
}

async function createBook(): Promise<void> {
  const name = newBookName.value.trim()
  if (!name) return
  await contactsStore.createAddressBook(name)
  newBookName.value = ''
  showNewBookForm.value = false
}

async function onDeleteBook(): Promise<void> {
  const id = confirmingDeleteBook.value
  confirmingDeleteBook.value = null
  if (!id) return
  await contactsStore.deleteAddressBook(id)
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase() || '?'
}

const contactCountLabel = computed(() => {
  const count = contactsStore.filteredContacts.length
  return count === 1 ? '1 contact' : `${count} contacts`
})
</script>

<template>
  <div class="layout">
    <!-- Sidebar: Exactly mirrors CalendarView.vue dimensions & structure -->
    <aside class="sidebar">
      <AppNavSwitcher />

      <div class="sidebar__actions">
        <button
          class="btn btn-primary sidebar__new"
          :disabled="!contactsStore.activeBookId"
          title="Create a new contact"
          @click="startCreate"
        >
          <span aria-hidden="true">+</span> New Contact
        </button>
      </div>

      <!-- Address Books Section (Mirrors CalendarList.vue) -->
      <div class="address-books">
        <div class="address-books__header">
          <h2 class="address-books__heading">Address Books</h2>
          <button type="button" class="icon-add-btn" title="New address book" @click="toggleNewBookForm">+</button>
        </div>

        <form
          v-if="showNewBookForm"
          class="address-books__new-form"
          @submit.prevent="createBook"
          @keydown.esc="showNewBookForm = false"
        >
          <input
            ref="newBookInput"
            v-model="newBookName"
            type="text"
            placeholder="Address book name"
            class="address-books__new-input"
          />
          <div class="address-books__new-row">
            <button type="button" class="btn btn-ghost btn-sm" @click="showNewBookForm = false">Cancel</button>
            <button type="submit" class="btn btn-primary btn-sm" :disabled="!newBookName.trim()">Save</button>
          </div>
        </form>

        <ul class="address-books__list">
          <li
            v-for="book in contactsStore.addressBooks"
            :key="book.id"
            class="address-books__item"
            :class="{ 'address-books__item--active': book.id === contactsStore.activeBookId }"
            @click="contactsStore.selectAddressBook(book.id)"
          >
            <span class="address-books__icon" aria-hidden="true">📇</span>
            <span class="address-books__name" :title="book.displayName">{{ book.displayName }}</span>
            <button
              v-if="contactsStore.addressBooks.length > 1"
              type="button"
              class="icon-remove-btn address-books__delete"
              title="Delete address book"
              @click.stop="confirmingDeleteBook = book.id"
            >
              ×
            </button>
          </li>
        </ul>
      </div>

      <!-- User footer: Exactly mirrors CalendarView.vue -->
      <div class="sidebar__user">
        <div class="sidebar__username-row">
          <span class="sidebar__avatar">{{ (session.info?.username ?? '?').slice(0, 1).toUpperCase() }}</span>
          <span class="sidebar__username">{{ session.info?.username }}</span>
        </div>
        <div class="sidebar__user-actions">
          <button
            type="button"
            class="btn btn-ghost sidebar__settings-btn"
            title="Settings"
            @click="showSettingsDialog = true"
          >
            <span aria-hidden="true">⚙️</span> Settings
          </button>
          <button class="btn btn-ghost sidebar__signout" @click="onLogout">Sign out</button>
        </div>
      </div>
    </aside>

    <!-- Main Content: Framed inside the exact same card style as CalendarView -->
    <main class="main">
      <div class="contacts-card">
        <!-- Middle Column: Contacts List -->
        <section class="contacts-list-pane">
          <div class="contacts-list-header">
            <div class="search-box-wrap">
              <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                v-model="contactsStore.searchQuery"
                type="text"
                class="search-input"
                placeholder="Search contacts..."
              />
            </div>
            <span class="contacts-count">{{ contactCountLabel }}</span>
          </div>

          <div v-if="contactsStore.loading" class="pane-state">Loading contacts...</div>
          <div v-else-if="contactsStore.filteredContacts.length === 0" class="pane-state">
            <p v-if="contactsStore.searchQuery">No contacts match your search.</p>
            <p v-else>No contacts in this address book.</p>
          </div>
          <ul v-else class="contact-items">
            <li
              v-for="contact in contactsStore.filteredContacts"
              :key="contact.uid"
              class="contact-item"
              :class="{ 'contact-item--active': contact.uid === contactsStore.selectedUid && !isCreating }"
              @click="selectContact(contact)"
            >
              <div class="contact-item__avatar">{{ getInitials(contact.fn) }}</div>
              <div class="contact-item__info">
                <span class="contact-item__name">{{ contact.fn }}</span>
                <span class="contact-item__sub">
                  {{ contact.organization || contact.emails[0]?.value || contact.phones[0]?.value || '' }}
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- Right Column: Contact Details / Edit View -->
        <section class="contact-detail-pane">
          <!-- Editor Mode -->
          <div v-if="isCreating || isEditing" class="detail-card edit-card">
            <div class="edit-card__header">
              <h2>{{ isCreating ? 'New Contact' : 'Edit Contact' }}</h2>
              <div class="edit-card__actions">
                <button type="button" class="btn btn-ghost" @click="cancelEdit">Cancel</button>
                <button type="button" class="btn btn-primary" @click="saveContact">Save</button>
              </div>
            </div>

            <form class="edit-form" @submit.prevent="saveContact">
              <div class="form-row">
                <div class="form-group flex-1">
                  <label>First Name</label>
                  <input v-model="form.givenName" type="text" class="input" placeholder="First name" />
                </div>
                <div class="form-group flex-1">
                  <label>Last Name</label>
                  <input v-model="form.familyName" type="text" class="input" placeholder="Last name" />
                </div>
              </div>

              <div class="form-group">
                <label>Full Display Name (optional)</label>
                <input v-model="form.fn" type="text" class="input" placeholder="Leave empty to auto-generate" />
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label>Organization</label>
                  <input v-model="form.organization" type="text" class="input" placeholder="Company or Org" />
                </div>
                <div class="form-group flex-1">
                  <label>Job Title</label>
                  <input v-model="form.title" type="text" class="input" placeholder="Title" />
                </div>
              </div>

              <!-- Email Rows -->
              <div class="form-section">
                <div class="form-section__header">
                  <label>Email Addresses</label>
                  <button type="button" class="btn-text" @click="addEmail">+ Add Email</button>
                </div>
                <div v-for="(em, idx) in form.emails" :key="idx" class="multi-row">
                  <select v-model="em.type" class="select select-sm">
                    <option value="WORK">Work</option>
                    <option value="HOME">Home</option>
                    <option value="OTHER">Other</option>
                  </select>
                  <input v-model="em.value" type="email" class="input flex-1" placeholder="email@example.com" />
                  <button type="button" class="icon-remove-btn" @click="removeEmail(idx)">×</button>
                </div>
              </div>

              <!-- Phone Rows -->
              <div class="form-section">
                <div class="form-section__header">
                  <label>Phone Numbers</label>
                  <button type="button" class="btn-text" @click="addPhone">+ Add Phone</button>
                </div>
                <div v-for="(ph, idx) in form.phones" :key="idx" class="multi-row">
                  <select v-model="ph.type" class="select select-sm">
                    <option value="CELL">Mobile</option>
                    <option value="WORK">Work</option>
                    <option value="HOME">Home</option>
                    <option value="MAIN">Main</option>
                  </select>
                  <input v-model="ph.value" type="tel" class="input flex-1" placeholder="+1 (555) 000-0000" />
                  <button type="button" class="icon-remove-btn" @click="removePhone(idx)">×</button>
                </div>
              </div>

              <!-- Address Rows -->
              <div class="form-section">
                <div class="form-section__header">
                  <label>Postal Addresses</label>
                  <button type="button" class="btn-text" @click="addAddress">+ Add Address</button>
                </div>
                <div v-for="(ad, idx) in form.addresses" :key="idx" class="address-box">
                  <div class="address-box__header">
                    <select v-model="ad.type" class="select select-sm">
                      <option value="HOME">Home</option>
                      <option value="WORK">Work</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <button type="button" class="icon-remove-btn" @click="removeAddress(idx)">×</button>
                  </div>
                  <input v-model="ad.street" type="text" class="input" placeholder="Street Address" />
                  <div class="form-row">
                    <input v-model="ad.locality" type="text" class="input flex-1" placeholder="City" />
                    <input v-model="ad.region" type="text" class="input flex-1" placeholder="State/Region" />
                  </div>
                  <div class="form-row">
                    <input v-model="ad.postalCode" type="text" class="input flex-1" placeholder="Postal Code" />
                    <input v-model="ad.country" type="text" class="input flex-1" placeholder="Country" />
                  </div>
                </div>
              </div>

              <div class="form-row">
                <div class="form-group flex-1">
                  <label>Birthday</label>
                  <input v-model="form.bday" type="date" class="input" />
                </div>
                <div class="form-group flex-1">
                  <label>Website</label>
                  <input v-model="form.url" type="url" class="input" placeholder="https://..." />
                </div>
              </div>

              <div class="form-group">
                <label>Notes</label>
                <textarea v-model="form.notes" class="input textarea" rows="3" placeholder="Notes..."></textarea>
              </div>
            </form>
          </div>

          <!-- View Mode: Contact Selected -->
          <div v-else-if="contactsStore.selectedContact" class="detail-card">
            <div class="detail-header">
              <div class="detail-avatar">{{ getInitials(contactsStore.selectedContact.fn) }}</div>
              <div class="detail-titles">
                <h1 class="detail-name">{{ contactsStore.selectedContact.fn }}</h1>
                <p
                  v-if="contactsStore.selectedContact.title || contactsStore.selectedContact.organization"
                  class="detail-org"
                >
                  {{
                    [contactsStore.selectedContact.title, contactsStore.selectedContact.organization]
                      .filter(Boolean)
                      .join(' • ')
                  }}
                </p>
              </div>
              <div class="detail-actions">
                <button type="button" class="btn btn-secondary" @click="startEdit">Edit</button>
                <button
                  type="button"
                  class="btn btn-danger"
                  @click="confirmingDelete = contactsStore.selectedContact"
                >
                  Delete
                </button>
              </div>
            </div>

            <div class="detail-body">
              <!-- Emails -->
              <div v-if="contactsStore.selectedContact.emails.length > 0" class="detail-group">
                <span class="detail-label">Email</span>
                <div v-for="(em, i) in contactsStore.selectedContact.emails" :key="i" class="detail-entry">
                  <a :href="`mailto:${em.value}`" class="detail-link">{{ em.value }}</a>
                  <span v-if="em.type" class="badge">{{ em.type }}</span>
                </div>
              </div>

              <!-- Phones -->
              <div v-if="contactsStore.selectedContact.phones.length > 0" class="detail-group">
                <span class="detail-label">Phone</span>
                <div v-for="(ph, i) in contactsStore.selectedContact.phones" :key="i" class="detail-entry">
                  <a :href="`tel:${ph.value}`" class="detail-link">{{ ph.value }}</a>
                  <span v-if="ph.type" class="badge">{{ ph.type }}</span>
                </div>
              </div>

              <!-- Addresses -->
              <div v-if="contactsStore.selectedContact.addresses.length > 0" class="detail-group">
                <span class="detail-label">Address</span>
                <div v-for="(ad, i) in contactsStore.selectedContact.addresses" :key="i" class="detail-address">
                  <span v-if="ad.type" class="badge mb-1">{{ ad.type }}</span>
                  <p v-if="ad.street">{{ ad.street }}</p>
                  <p v-if="ad.locality || ad.region || ad.postalCode">
                    {{ [ad.locality, ad.region, ad.postalCode].filter(Boolean).join(', ') }}
                  </p>
                  <p v-if="ad.country">{{ ad.country }}</p>
                </div>
              </div>

              <!-- Birthday -->
              <div v-if="contactsStore.selectedContact.bday" class="detail-group">
                <span class="detail-label">Birthday</span>
                <div class="detail-entry">{{ contactsStore.selectedContact.bday }}</div>
              </div>

              <!-- Website -->
              <div v-if="contactsStore.selectedContact.url" class="detail-group">
                <span class="detail-label">Website</span>
                <div class="detail-entry">
                  <a :href="contactsStore.selectedContact.url" target="_blank" rel="noopener" class="detail-link">
                    {{ contactsStore.selectedContact.url }}
                  </a>
                </div>
              </div>

              <!-- Notes -->
              <div v-if="contactsStore.selectedContact.notes" class="detail-group">
                <span class="detail-label">Notes</span>
                <div class="detail-notes">{{ contactsStore.selectedContact.notes }}</div>
              </div>
            </div>
          </div>

          <!-- View Mode: Empty Selection -->
          <div v-else class="detail-card empty-card">
            <div class="empty-state">
              <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <h3>No contact selected</h3>
              <p>Select a contact from the list or create a new one.</p>
              <button class="btn btn-primary mt-3" @click="startCreate">+ New Contact</button>
            </div>
          </div>
        </section>
      </div>
    </main>

    <!-- Dialogs -->
    <SettingsDialog v-if="showSettingsDialog" @close="showSettingsDialog = false" />

    <ConfirmDialog
      v-if="confirmingDelete"
      title="Delete Contact"
      :message="`Are you sure you want to delete ${confirmingDelete.fn}?`"
      confirm-label="Delete"
      @confirm="onDeleteContact"
      @cancel="confirmingDelete = null"
    />

    <ConfirmDialog
      v-if="confirmingDeleteBook"
      title="Delete Address Book"
      message="Are you sure you want to delete this address book and all of its contacts?"
      confirm-label="Delete"
      @confirm="onDeleteBook"
      @cancel="confirmingDeleteBook = null"
    />
  </div>
</template>

<style scoped>
/* Top-level layout: Exactly matching CalendarView.vue */
.layout {
  display: flex;
  height: 100vh;
  background: var(--color-bg);
}

.sidebar {
  width: 256px;
  flex-shrink: 0;
  padding: 1.25rem 1rem;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  overflow-y: auto;
}

.sidebar__actions {
  display: flex;
  gap: 0.5rem;
}

.sidebar__new {
  flex: 1;
  font-size: 0.88rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
}

.sidebar__new span {
  font-size: 1.05rem;
  line-height: 1;
}

/* Address Books Section (Mirrors CalendarList.vue) */
.address-books {
  display: flex;
  flex-direction: column;
}

.address-books__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.4rem;
}

.address-books__heading {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-text-faint);
  margin: 0;
}

.address-books__new-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  margin-bottom: 0.4rem;
  background: var(--color-surface-hover);
  border-radius: var(--radius-sm);
}

.address-books__new-input {
  width: 100%;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  font-size: 0.82rem;
  background: var(--color-surface);
  color: inherit;
  box-sizing: border-box;
}

.address-books__new-row {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}

.btn-sm {
  padding: 0.25rem 0.6rem;
  font-size: 0.78rem;
}

.address-books__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.address-books__item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.5rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.12s ease;
  font-size: 0.88rem;
  color: var(--color-text);
}

.address-books__item:hover {
  background: var(--color-surface-hover);
}

.address-books__item--active {
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
}

.address-books__icon {
  font-size: 0.95rem;
  flex-shrink: 0;
}

.address-books__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.address-books__delete {
  opacity: 0;
  transition: opacity 0.12s ease;
}

.address-books__item:hover .address-books__delete {
  opacity: 1;
}

/* User footer: Exactly matching CalendarView.vue */
.sidebar__user {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.6rem 0.25rem 0;
  border-top: 1px solid var(--color-border);
  font-size: 0.85rem;
}

.sidebar__username-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  justify-content: flex-start;
  padding: 0.3rem 0.35rem;
}

.sidebar__avatar {
  width: 1.6rem;
  height: 1.6rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-weight: 600;
  font-size: 0.75rem;
}

.sidebar__username {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.sidebar__user-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.sidebar__settings-btn {
  padding: 0.3rem 0.5rem;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.sidebar__signout {
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  flex-shrink: 0;
  margin-left: auto;
}

/* Main & Card: Exactly matching CalendarView.vue framing */
.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
}

.contacts-card {
  flex: 1;
  min-height: 0;
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--color-border);
  display: flex;
  overflow: hidden;
}

/* Contacts List Pane (Left of Card) */
.contacts-list-pane {
  width: 290px;
  min-width: 290px;
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-surface);
}

.contacts-list-header {
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.search-box-wrap {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.6rem;
  width: 14px;
  height: 14px;
  color: var(--color-text-faint);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 0.35rem 0.5rem 0.35rem 1.9rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-hover);
  color: var(--color-text);
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.search-input:focus {
  border-color: var(--color-primary);
  background: var(--color-surface);
}

.contacts-count {
  font-size: 0.75rem;
  color: var(--color-text-faint);
  padding-left: 0.2rem;
}

.contact-items {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
  overflow-y: auto;
}

.contact-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.85rem;
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.contact-item:hover {
  background: var(--color-surface-hover);
}

.contact-item--active {
  background: var(--color-primary-soft) !important;
}

.contact-item__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  flex-shrink: 0;
}

.contact-item--active .contact-item__avatar {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.contact-item__info {
  flex: 1;
  min-width: 0;
}

.contact-item__name {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.contact-item__sub {
  display: block;
  font-size: 0.78rem;
  color: var(--color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane-state {
  padding: 2.5rem 1rem;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

/* Contact Details Pane (Right of Card) */
.contact-detail-pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 1.5rem 2rem;
  background: var(--color-surface);
}

.detail-card {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.detail-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary-soft);
  color: var(--color-primary);
  font-size: 1.3rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.detail-titles {
  flex: 1;
  min-width: 0;
}

.detail-name {
  margin: 0;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--color-text);
}

.detail-org {
  margin: 0.25rem 0 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.detail-actions {
  display: flex;
  gap: 0.5rem;
}

.detail-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.detail-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.detail-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-faint);
}

.detail-entry {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.92rem;
  color: var(--color-text);
}

.detail-link {
  color: var(--color-primary);
  text-decoration: none;
}

.detail-link:hover {
  text-decoration: underline;
}

.detail-address {
  font-size: 0.9rem;
  line-height: 1.45;
}

.detail-address p {
  margin: 0;
}

.detail-notes {
  white-space: pre-wrap;
  font-size: 0.88rem;
  line-height: 1.5;
  background: var(--color-surface-hover);
  border: 1px solid var(--color-border);
  padding: 0.75rem 1rem;
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.badge {
  font-size: 0.68rem;
  text-transform: uppercase;
  font-weight: 600;
  padding: 0.15rem 0.45rem;
  border-radius: var(--radius-sm);
  background: var(--color-surface-hover);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.mb-1 {
  margin-bottom: 0.35rem;
  display: inline-block;
}

/* Edit Form */
.edit-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.edit-card__header h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--color-text);
}

.edit-card__actions {
  display: flex;
  gap: 0.5rem;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-row {
  display: flex;
  gap: 0.75rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.form-group label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text-muted);
}

.flex-1 {
  flex: 1;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem;
  background: var(--color-surface-hover);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

.form-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-section__header label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-text);
}

.multi-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.address-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.address-box__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.btn-text {
  background: none;
  border: none;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0;
}

.btn-text:hover {
  text-decoration: underline;
}

.select-sm {
  padding: 0.35rem 0.5rem;
  font-size: 0.8rem;
}

.empty-card {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state {
  text-align: center;
  padding: 2.5rem 1rem;
  color: var(--color-text-muted);
}

.empty-icon {
  width: 44px;
  height: 44px;
  margin-bottom: 0.75rem;
  color: var(--color-text-faint);
}

.empty-state h3 {
  margin: 0 0 0.35rem;
  color: var(--color-text);
  font-size: 1.05rem;
}

.empty-state p {
  margin: 0;
  font-size: 0.88rem;
}

.mt-3 {
  margin-top: 1rem;
}
</style>
