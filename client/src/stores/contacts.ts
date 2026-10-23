import type { AddressBook, Contact, ContactFields, CreateContactInput } from '@yourcal/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '../api.js'

export const useContactsStore = defineStore('contacts', () => {
  const addressBooks = ref<AddressBook[]>([])
  const activeBookId = ref<string | null>(null)
  const contacts = ref<Contact[]>([])
  const selectedUid = ref<string | null>(null)
  const searchQuery = ref('')
  const loading = ref(false)
  const error = ref<string | null>(null)

  const activeBook = computed(() => addressBooks.value.find((b) => b.id === activeBookId.value) ?? null)

  const filteredContacts = computed(() => {
    const q = searchQuery.value.trim().toLowerCase()
    if (!q) return contacts.value
    return contacts.value.filter((c) => {
      const fn = c.fn.toLowerCase()
      const org = (c.organization ?? '').toLowerCase()
      const title = (c.title ?? '').toLowerCase()
      const emails = c.emails.some((e) => e.value.toLowerCase().includes(q))
      const phones = c.phones.some((p) => p.value.toLowerCase().includes(q))
      return fn.includes(q) || org.includes(q) || title.includes(q) || emails || phones
    })
  })

  const selectedContact = computed(() => contacts.value.find((c) => c.uid === selectedUid.value) ?? null)

  async function loadAddressBooks(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const books = await api.getAddressBooks()
      addressBooks.value = books
      if (books.length > 0 && (!activeBookId.value || !books.some((b) => b.id === activeBookId.value))) {
        activeBookId.value = books[0].id
      }
      if (activeBookId.value) {
        await loadContacts(activeBookId.value)
      } else {
        contacts.value = []
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load address books'
    } finally {
      loading.value = false
    }
  }

  async function selectAddressBook(id: string): Promise<void> {
    activeBookId.value = id
    selectedUid.value = null
    await loadContacts(id)
  }

  async function loadContacts(bookId: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const list = await api.getContacts(bookId)
      contacts.value = list
      if (selectedUid.value && !list.some((c) => c.uid === selectedUid.value)) {
        selectedUid.value = null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load contacts'
    } finally {
      loading.value = false
    }
  }

  async function createContact(bookId: string, fields: CreateContactInput): Promise<Contact> {
    const created = await api.createContact(bookId, fields)
    contacts.value.push(created)
    contacts.value.sort((a, b) => a.fn.localeCompare(b.fn, undefined, { sensitivity: 'base' }))
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
    const idx = contacts.value.findIndex((c) => c.uid === uid)
    if (idx !== -1) {
      contacts.value[idx] = updated
    }
    contacts.value.sort((a, b) => a.fn.localeCompare(b.fn, undefined, { sensitivity: 'base' }))
    return updated
  }

  async function deleteContact(bookId: string, uid: string, href: string, etag: string | null): Promise<void> {
    await api.deleteContact(bookId, uid, href, etag)
    contacts.value = contacts.value.filter((c) => c.uid !== uid)
    if (selectedUid.value === uid) {
      selectedUid.value = null
    }
  }

  async function createAddressBook(displayName: string): Promise<AddressBook> {
    const created = await api.createAddressBook({ displayName })
    addressBooks.value.push(created)
    await selectAddressBook(created.id)
    return created
  }

  async function deleteAddressBook(id: string): Promise<void> {
    await api.deleteAddressBook(id)
    addressBooks.value = addressBooks.value.filter((b) => b.id !== id)
    if (activeBookId.value === id) {
      activeBookId.value = addressBooks.value[0]?.id ?? null
      if (activeBookId.value) {
        await loadContacts(activeBookId.value)
      } else {
        contacts.value = []
      }
    }
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
    error,
    loadAddressBooks,
    selectAddressBook,
    loadContacts,
    createContact,
    updateContact,
    deleteContact,
    createAddressBook,
    deleteAddressBook,
  }
})
