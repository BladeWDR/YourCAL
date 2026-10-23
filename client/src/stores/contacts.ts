import type { AddressBook, Contact, ContactFields, CreateContactInput } from '@yourdav/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api.js'

const FRESH_MS = 30_000
const STORAGE_KEY_ACTIVE_BOOK = 'yourdav:active-address-book'

export const useContactsStore = defineStore('contacts', () => {
  const addressBooks = ref<AddressBook[]>([])
  const activeBookId = ref<string | null>(localStorage.getItem(STORAGE_KEY_ACTIVE_BOOK))
  const contactsByBook = ref<Record<string, Contact[]>>({})
  const booksLoadedAt = ref<number>(0)
  const contactsLoadedAt = ref<Record<string, number>>({})
  const selectedUid = ref<string | null>(null)
  const searchQuery = ref('')
  const loading = ref(false)
  const isRefreshing = ref(false)
  const error = ref<string | null>(null)

  const activeBook = computed(() => addressBooks.value.find((b) => b.id === activeBookId.value) ?? null)

  const contacts = computed<Contact[]>({
    get: () => (activeBookId.value ? contactsByBook.value[activeBookId.value] ?? [] : []),
    set: (val: Contact[]) => {
      if (activeBookId.value) {
        contactsByBook.value[activeBookId.value] = val
      }
    },
  })

  const filteredContacts = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    const list = contacts.value
    if (!q) return list
    return list.filter((c) => {
      const fn = c.fn.toLowerCase()
      const org = (c.organization ?? '').toLowerCase()
      const title = (c.title ?? '').toLowerCase()
      const emails = c.emails.some((e) => e.value.toLowerCase().includes(q))
      const phones = c.phones.some((p) => p.value.toLowerCase().includes(q))
      return fn.includes(q) || org.includes(q) || title.includes(q) || emails || phones
    })
  })

  const selectedContact = computed(() => contacts.value.find((c) => c.uid === selectedUid.value) ?? null)

  async function loadAddressBooks(force = false): Promise<void> {
    const now = Date.now()
    const booksFresh = !force && booksLoadedAt.value > 0 && now - booksLoadedAt.value < FRESH_MS
    const activeFresh =
      !force &&
      Boolean(activeBookId.value) &&
      (contactsLoadedAt.value[activeBookId.value ?? ''] ?? 0) > 0 &&
      now - (contactsLoadedAt.value[activeBookId.value ?? ''] ?? 0) < FRESH_MS

    if (booksFresh && activeFresh) {
      return
    }

    const hasExistingContacts = activeBookId.value ? (contactsByBook.value[activeBookId.value]?.length ?? 0) > 0 : false
    if (!hasExistingContacts) {
      loading.value = true
    } else {
      isRefreshing.value = true
    }
    error.value = null

    try {
      if (activeBookId.value && !activeFresh) {
        // Fetch books and contacts in parallel
        const [books, contactsList] = await Promise.all([
          booksFresh ? Promise.resolve(addressBooks.value) : api.getAddressBooks(),
          api.getContacts(activeBookId.value),
        ])
        addressBooks.value = books
        booksLoadedAt.value = Date.now()

        if (!books.some((b) => b.id === activeBookId.value)) {
          activeBookId.value = books[0]?.id ?? null
          if (activeBookId.value) {
            localStorage.setItem(STORAGE_KEY_ACTIVE_BOOK, activeBookId.value)
            await loadContacts(activeBookId.value, true)
          } else {
            localStorage.removeItem(STORAGE_KEY_ACTIVE_BOOK)
          }
        } else {
          contactsByBook.value[activeBookId.value] = contactsList
          contactsLoadedAt.value[activeBookId.value] = Date.now()
          if (selectedUid.value && !contactsList.some((c) => c.uid === selectedUid.value)) {
            selectedUid.value = null
          }
        }
      } else {
        const books = await api.getAddressBooks()
        addressBooks.value = books
        booksLoadedAt.value = Date.now()

        if (books.length > 0 && (!activeBookId.value || !books.some((b) => b.id === activeBookId.value))) {
          activeBookId.value = books[0].id
          localStorage.setItem(STORAGE_KEY_ACTIVE_BOOK, activeBookId.value)
        }
        if (activeBookId.value) {
          await loadContacts(activeBookId.value, force)
        }
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load address books'
    } finally {
      loading.value = false
      isRefreshing.value = false
    }
  }

  async function selectAddressBook(id: string, force = false): Promise<void> {
    activeBookId.value = id
    localStorage.setItem(STORAGE_KEY_ACTIVE_BOOK, id)
    selectedUid.value = null
    await loadContacts(id, force)
  }

  async function loadContacts(bookId: string, force = false): Promise<void> {
    const now = Date.now()
    const fresh = !force && (contactsLoadedAt.value[bookId] ?? 0) > 0 && now - (contactsLoadedAt.value[bookId] ?? 0) < FRESH_MS
    if (fresh) {
      return
    }

    const hasExisting = (contactsByBook.value[bookId]?.length ?? 0) > 0
    if (!hasExisting) {
      loading.value = true
    } else {
      isRefreshing.value = true
    }
    error.value = null

    try {
      const list = await api.getContacts(bookId)
      contactsByBook.value[bookId] = list
      contactsLoadedAt.value[bookId] = Date.now()
      if (selectedUid.value && !list.some((c) => c.uid === selectedUid.value)) {
        selectedUid.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load contacts'
    } finally {
      loading.value = false
      isRefreshing.value = false
    }
  }

  async function createContact(bookId: string, fields: CreateContactInput): Promise<Contact> {
    const created = await api.createContact(bookId, fields)
    const list = [...(contactsByBook.value[bookId] ?? []), created]
    list.sort((a, b) => a.fn.localeCompare(b.fn, undefined, { sensitivity: 'base' }))
    contactsByBook.value[bookId] = list
    contactsLoadedAt.value[bookId] = Date.now()
    selectedUid.value = created.uid
    return created
  }

  async function updateContact(
    bookId: string,
    uid: string,
    fields: ContactFields,
    href: string,
    etag: string | null,
  ): Promise<Contact> {
    const updated = await api.updateContact(bookId, uid, { href, etag, fields })
    const list = [...(contactsByBook.value[bookId] ?? [])]
    const idx = list.findIndex((c) => c.uid === uid)
    if (idx !== -1) {
      list[idx] = updated
    }
    list.sort((a, b) => a.fn.localeCompare(b.fn, undefined, { sensitivity: 'base' }))
    contactsByBook.value[bookId] = list
    contactsLoadedAt.value[bookId] = Date.now()
    return updated
  }

  async function deleteContact(bookId: string, uid: string, href: string, etag: string | null): Promise<void> {
    await api.deleteContact(bookId, uid, href, etag)
    contactsByBook.value[bookId] = (contactsByBook.value[bookId] ?? []).filter((c) => c.uid !== uid)
    contactsLoadedAt.value[bookId] = Date.now()
    if (selectedUid.value === uid) {
      selectedUid.value = null
    }
  }

  async function createAddressBook(displayName: string): Promise<AddressBook> {
    const created = await api.createAddressBook({ displayName })
    addressBooks.value.push(created)
    booksLoadedAt.value = Date.now()
    await selectAddressBook(created.id, true)
    return created
  }

  async function deleteAddressBook(id: string): Promise<void> {
    await api.deleteAddressBook(id)
    addressBooks.value = addressBooks.value.filter((b) => b.id !== id)
    booksLoadedAt.value = Date.now()
    delete contactsByBook.value[id]
    delete contactsLoadedAt.value[id]
    if (activeBookId.value === id) {
      const nextId = addressBooks.value[0]?.id ?? null
      activeBookId.value = nextId
      if (nextId) {
        localStorage.setItem(STORAGE_KEY_ACTIVE_BOOK, nextId)
        await loadContacts(nextId, true)
      } else {
        localStorage.removeItem(STORAGE_KEY_ACTIVE_BOOK)
      }
    }
  }

  function clear(): void {
    addressBooks.value = []
    activeBookId.value = null
    contactsByBook.value = {}
    booksLoadedAt.value = 0
    contactsLoadedAt.value = {}
    selectedUid.value = null
    searchQuery.value = ''
    loading.value = false
    isRefreshing.value = false
    error.value = null
  }

  return {
    addressBooks,
    activeBookId,
    activeBook,
    contacts,
    filteredContacts,
    selectedUid,
    selectedContact,
    searchQuery,
    loading,
    isRefreshing,
    error,
    loadAddressBooks,
    selectAddressBook,
    loadContacts,
    createContact,
    updateContact,
    deleteContact,
    createAddressBook,
    deleteAddressBook,
    clear,
  }
})
