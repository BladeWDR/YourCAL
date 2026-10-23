import { DavContactStore } from './DavContactStore.js'

// Contacts are always read straight from the CardDAV server; unlike
// calendars there is no SQLite read-cache in front of them.
export const contactStore = new DavContactStore()
