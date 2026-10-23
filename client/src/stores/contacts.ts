import type { AddressBook, Contact, ContactInput } from '@yourdav/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api.js'

const FRESH_MS = 30_000
const STORAGE_KEY_ACTIVE_BOOK = 'yourdav:active-address-book'

/** Sentinel for the "Not grouped" filter; a real category can't collide because it's never user-typed. */
export const UNGROUPED = '\u0000ungrouped'

/** Sort key: family name, then given name, falling back to the display name. */
function sortKey(c: Contact): string {
  const { family, given } = c.name
  return (family || given ? `${family} ${given}` : c.fullName).toLocaleLowerCase()
}

function searchText(c: Contact): string {
  return [
    c.fullName,
    c.nickname,
    c.org,
    c.title,
    c.notes,
    ...c.emails.map((e) => e.value),
    ...c.phones.map((p) => p.value.replace(/[^\d+]/g, '')),
    ...c.phones.map((p) => p.value),
    ...c.categories,
  ]
    .join('\n')
    .toLocaleLowerCase()
}

function readActiveBook(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_BOOK)
  } catch {
    return null
  }
}

function writeActiveBook(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY_ACTIVE_BOOK, id)
    else localStorage.removeItem(STORAGE_KEY_ACTIVE_BOOK)
  } catch {
    // storage unavailable (private window etc.) -- the choice just isn't remembered
  }
}

export const useContactsStore = defineStore('contacts', () => {
  const addressBooks = ref<AddressBook[]>([])
  const activeBookId = ref<string | null>(readActiveBook())
  const contactsByBook = ref<Record<string, Contact[]>>({})
  const booksLoadedAt = ref(0)
  const contactsLoadedAt = ref<Record<string, number>>({})
  const selectedId = ref<string | null>(null)
  /** null = no group filter; UNGROUPED = contacts with no category; otherwise a category name. */
  const selectedGroup = ref<string | null>(null)
  const searchQuery = ref('')
  const loading = ref(false)
  const isRefreshing = ref(false)
  const error = ref<string | null>(null)

  const activeBook = computed(() => addressBooks.value.find((b) => b.id === activeBookId.value) ?? null)
  const contacts = computed<Contact[]>(() => (activeBookId.value ? (contactsByBook.value[activeBookId.value] ?? []) : []))

  const groups = computed(() => {
    const counts = new Map<string, number>()
    for (const c of contacts.value) for (const g of c.categories) counts.set(g, (counts.get(g) ?? 0) + 1)
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  const ungroupedCount = computed(() => contacts.value.filter((c) => c.categories.length === 0).length)

  const filteredContacts = computed(() => {
    const q = searchQuery.value.trim().toLocaleLowerCase()
    const qDigits = q.replace(/[^\d+]/g, '')
    return contacts.value
      .filter((c) => {
        if (selectedGroup.value === UNGROUPED) return c.categories.length === 0
        if (selectedGroup.value) return c.categories.includes(selectedGroup.value)
        return true
      })
      .filter((c) => {
        if (!q) return true
        const text = searchText(c)
        return text.includes(q) || (qDigits.length >= 3 && text.includes(qDigits))
      })
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  })

  const selectedContact = computed(() => contacts.value.find((c) => c.id === selectedId.value) ?? null)

  function setActiveBook(id: string | null): void {
    activeBookId.value = id
    writeActiveBook(id)
  }

  function putContacts(bookId: string, list: Contact[]): void {
    contactsByBook.value[bookId] = list
    contactsLoadedAt.value[bookId] = Date.now()
    if (selectedId.value && bookId === activeBookId.value && !list.some((c) => c.id === selectedId.value)) {
      selectedId.value = null
    }
    if (selectedGroup.value && selectedGroup.value !== UNGROUPED && bookId === activeBookId.value) {
      if (!list.some((c) => c.categories.includes(selectedGroup.value as string))) selectedGroup.value = null
    }
  }

  async function loadAddressBooks(force = false): Promise<void> {
    const now = Date.now()
    const bookId = activeBookId.value
    const booksFresh = !force && booksLoadedAt.value > 0 && now - booksLoadedAt.value < FRESH_MS
    const activeFresh =
      !force && !!bookId && (contactsLoadedAt.value[bookId] ?? 0) > 0 && now - contactsLoadedAt.value[bookId] < FRESH_MS
    if (booksFresh && activeFresh) return

    // Only show the blocking spinner when there is nothing cached to show.
    const hasCached = bookId ? (contactsByBook.value[bookId]?.length ?? 0) > 0 : false
    if (hasCached) isRefreshing.value = true
    else loading.value = true
    error.value = null

    try {
      // Fetch the books and the remembered book's contacts in parallel. A failed
      // contacts fetch (e.g. the remembered book was deleted elsewhere) is not
      // fatal here -- it falls through to the book-existence check below.
      const [books, list] = await Promise.all([
        booksFresh ? Promise.resolve(addressBooks.value) : api.getAddressBooks(),
        bookId && !activeFresh ? api.getContacts(bookId).catch(() => null) : Promise.resolve(null),
      ])
      addressBooks.value = books
      booksLoadedAt.value = Date.now()

      const target = books.some((b) => b.id === bookId) ? bookId : (books[0]?.id ?? null)
      if (target !== bookId) {
        setActiveBook(target)
        selectedId.value = null
        selectedGroup.value = null
      }
      if (!target) return
      if (target === bookId && list) putContacts(target, list)
      else await loadContacts(target, true)
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load address books'
    } finally {
      loading.value = false
      isRefreshing.value = false
    }
  }

  async function selectAddressBook(id: string, force = false): Promise<void> {
    setActiveBook(id)
    selectedId.value = null
    selectedGroup.value = null
    await loadContacts(id, force)
  }

  async function loadContacts(bookId: string, force = false): Promise<void> {
    const loadedAt = contactsLoadedAt.value[bookId] ?? 0
    if (!force && loadedAt > 0 && Date.now() - loadedAt < FRESH_MS) return

    if ((contactsByBook.value[bookId]?.length ?? 0) > 0) isRefreshing.value = true
    else loading.value = true
    error.value = null

    try {
      putContacts(bookId, await api.getContacts(bookId))
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load contacts'
    } finally {
      loading.value = false
      isRefreshing.value = false
    }
  }

  async function createContact(bookId: string, input: ContactInput): Promise<Contact> {
    const created = await api.createContact(bookId, input)
    contactsByBook.value[bookId] = [...(contactsByBook.value[bookId] ?? []), created]
    contactsLoadedAt.value[bookId] = Date.now()
    selectedId.value = created.id
    return created
  }

  async function updateContact(existing: Contact, input: ContactInput): Promise<Contact> {
    const bookId = existing.addressBookId
    const updated = await api.updateContact(bookId, { ...input, href: existing.href, etag: existing.etag })
    contactsByBook.value[bookId] = (contactsByBook.value[bookId] ?? []).map((c) => (c.id === existing.id ? updated : c))
    contactsLoadedAt.value[bookId] = Date.now()
    // The id is derived from the href, so it is stable across an edit.
    selectedId.value = updated.id
    return updated
  }

  async function deleteContact(contact: Contact): Promise<void> {
    const bookId = contact.addressBookId
    await api.deleteContact(bookId, contact.href, contact.etag)
    contactsByBook.value[bookId] = (contactsByBook.value[bookId] ?? []).filter((c) => c.id !== contact.id)
    contactsLoadedAt.value[bookId] = Date.now()
    if (selectedId.value === contact.id) selectedId.value = null
  }

  /** Renames a group in the active address book. Returns how many cards could not be updated. */
  async function renameGroup(from: string, to: string): Promise<number> {
    const bookId = activeBookId.value
    if (!bookId) return 0
    const { failed } = await api.renameGroup(bookId, from, to)
    const wasSelected = selectedGroup.value === from
    await loadContacts(bookId, true)
    if (wasSelected) selectedGroup.value = to
    return failed
  }

  async function createAddressBook(displayName: string): Promise<AddressBook> {
    const created = await api.createAddressBook({ displayName })
    addressBooks.value = [...addressBooks.value, created]
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
      const next = addressBooks.value[0]?.id ?? null
      setActiveBook(next)
      selectedId.value = null
      selectedGroup.value = null
      if (next) await loadContacts(next, true)
    }
  }

  function clear(): void {
    addressBooks.value = []
    activeBookId.value = null
    contactsByBook.value = {}
    booksLoadedAt.value = 0
    contactsLoadedAt.value = {}
    selectedId.value = null
    selectedGroup.value = null
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
    groups,
    ungroupedCount,
    filteredContacts,
    selectedId,
    selectedGroup,
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
    renameGroup,
    createAddressBook,
    deleteAddressBook,
    clear,
  }
})
