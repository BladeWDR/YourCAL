import type { AddressBook } from '@yourdav/shared'
import type { DavContext } from '../dav/context.js'

/** A card as stored on the server, before mapping to a Contact. */
export interface RawCard {
  href: string
  etag: string
  vcard: string
}

export interface ContactStore {
  discoverAddressBooks(ctx: DavContext): Promise<AddressBook[]>
  createAddressBook(ctx: DavContext, displayName: string): Promise<AddressBook>
  deleteAddressBook(ctx: DavContext, addressBookId: string): Promise<void>
  getCards(ctx: DavContext, addressBookId: string): Promise<RawCard[]>
  getCard(ctx: DavContext, addressBookId: string, href: string): Promise<RawCard>
  createCard(ctx: DavContext, addressBookId: string, vcard: string): Promise<RawCard>
  updateCard(ctx: DavContext, addressBookId: string, href: string, etag: string, vcard: string): Promise<RawCard>
  deleteCard(ctx: DavContext, addressBookId: string, href: string, etag: string): Promise<void>
}
