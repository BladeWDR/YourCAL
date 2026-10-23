import type {
  AddressBook,
  Contact,
  CreateAddressBookInput,
  CreateContactInput,
  ContactFields,
} from '@yourcal/shared'
import { createClient } from '../dav/client.js'
import type { DavContext } from '../dav/context.js'
import { davFetch } from '../dav/auth.js'
import { assertHrefSameHost } from '../dav/hostAllowlist.js'
import { EtagConflictError } from './errors.js'
import { decodeId, encodeId } from './idCodec.js'
import { contactToVcard, vcardToContact } from '../vcard/vcard.js'

export class DavAddressBookStore {
  async discoverAddressBooks(ctx: DavContext): Promise<AddressBook[]> {
    const client = await createClient(ctx, 'carddav')
    const davBooks = await client.fetchAddressBooks()

    return davBooks.map((book) => {
      const url = String(book.url)
      return {
        id: encodeId(url),
        displayName: typeof book.displayName === 'string' && book.displayName ? book.displayName : 'Contacts',
        ctag: book.ctag ?? null,
        readOnly: false,
      }
    })
  }

  async createAddressBook(ctx: DavContext, input: CreateAddressBookInput): Promise<AddressBook> {
    const client = await createClient(ctx, 'carddav')
    const homeUrl = client.account?.homeUrl
    if (!homeUrl) {
      throw new Error('CardDAV account has no addressbook-home-set URL')
    }

    const url = new URL(`${crypto.randomUUID()}/`, homeUrl.endsWith('/') ? homeUrl : `${homeUrl}/`).toString()

    const body = `<?xml version="1.0" encoding="utf-8" ?>
<D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:set>
    <D:prop>
      <D:resourcetype>
        <D:collection/>
        <C:addressbook/>
      </D:resourcetype>
      <D:displayname>${input.displayName.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)}</D:displayname>
    </D:prop>
  </D:set>
</D:mkcol>`

    const response = await davFetch(ctx, url, {
      method: 'MKCOL',
      headers: { 'Content-Type': 'application/xml' },
      body,
    })

    if (!response.ok) {
      throw new Error(`Failed to create address book: ${response.status} ${response.statusText}`)
    }

    return {
      id: encodeId(url),
      displayName: input.displayName,
      ctag: null,
      readOnly: false,
    }
  }

  async deleteAddressBook(ctx: DavContext, addressBookId: string): Promise<void> {
    const url = decodeId(addressBookId)
    assertHrefSameHost(ctx.baseUrl, url)
    const response = await davFetch(ctx, url, { method: 'DELETE' })
    if (!response.ok) {
      throw new Error(`Failed to delete address book: ${response.status} ${response.statusText}`)
    }
  }

  async getContacts(ctx: DavContext, addressBookId: string): Promise<Contact[]> {
    const url = decodeId(addressBookId)
    assertHrefSameHost(ctx.baseUrl, url)
    const client = await createClient(ctx, 'carddav')

    const vcards = await client.fetchVCards({
      addressBook: { url },
    })

    const contacts: Contact[] = []
    for (const vcard of vcards) {
      if (!vcard.data) continue
      try {
        contacts.push(
          vcardToContact(vcard.data, {
            href: vcard.url,
            etag: vcard.etag ?? null,
            addressBookId,
          }),
        )
      } catch {
        // Skip unparseable cards gracefully
      }
    }

    contacts.sort((a, b) => a.fn.localeCompare(b.fn, undefined, { sensitivity: 'base' }))
    return contacts
  }

  async createContact(ctx: DavContext, addressBookId: string, fields: CreateContactInput): Promise<Contact> {
    const url = decodeId(addressBookId)
    assertHrefSameHost(ctx.baseUrl, url)
    const client = await createClient(ctx, 'carddav')

    const uid = crypto.randomUUID()
    const filename = `${uid}.vcf`
    const vcardString = contactToVcard(fields, { uid })

    const response = await client.createVCard({
      addressBook: { url },
      filename,
      vCardString: vcardString,
    })

    if (!response.ok) {
      throw new Error(`Failed to create contact: ${response.status} ${response.statusText}`)
    }

    const href = new URL(filename, url.endsWith('/') ? url : `${url}/`).toString()
    const etag = response.headers.get('etag') ?? null

    return vcardToContact(vcardString, {
      href,
      etag,
      addressBookId,
    })
  }

  async updateContact(
    ctx: DavContext,
    addressBookId: string,
    uid: string,
    fields: ContactFields,
    etag: string | null,
    href: string,
  ): Promise<Contact> {
    assertHrefSameHost(ctx.baseUrl, href)
    const bookUrl = decodeId(addressBookId)
    assertHrefSameHost(ctx.baseUrl, bookUrl)
    const client = await createClient(ctx, 'carddav')

    // Fetch existing vcard if possible to preserve unknown properties
    let existingVcard: string | undefined
    try {
      const cards = await client.fetchVCards({
        addressBook: { url: bookUrl },
        objectUrls: [href],
      })
      if (cards.length > 0 && cards[0].data) {
        existingVcard = cards[0].data
      }
    } catch {
      // Continue without existing vcard
    }

    const vcardString = contactToVcard(fields, { uid, existingVcard })
    const headers: Record<string, string> = {}
    if (etag) {
      headers['If-Match'] = etag
    }

    const response = await client.updateVCard({
      vCard: { url: href, data: vcardString, etag: etag ?? undefined },
      headers,
    })

    if (response.status === 412) {
      throw new EtagConflictError('Contact changed since it was last read')
    }
    if (!response.ok) {
      throw new Error(`Failed to update contact: ${response.status} ${response.statusText}`)
    }

    const newEtag = response.headers.get('etag') ?? etag
    return vcardToContact(vcardString, {
      href,
      etag: newEtag,
      addressBookId,
    })
  }

  async deleteContact(ctx: DavContext, href: string, etag: string | null): Promise<void> {
    assertHrefSameHost(ctx.baseUrl, href)
    const client = await createClient(ctx, 'carddav')
    const headers: Record<string, string> = {}
    if (etag) {
      headers['If-Match'] = etag
    }

    const response = await client.deleteVCard({
      vCard: { url: href, etag: etag ?? undefined },
      headers,
    })

    if (response.status === 412) {
      throw new EtagConflictError('Contact changed since it was last read')
    }
    if (!response.ok) {
      throw new Error(`Failed to delete contact: ${response.status} ${response.statusText}`)
    }
  }
}
