import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from '../dav/context.js'

const davFetchMock = vi.fn()
const clientMock = {
  account: { homeUrl: 'https://dav.example.com/user/contacts-home/' },
  updateVCard: vi.fn(),
  deleteVCard: vi.fn(),
}
vi.mock('../dav/auth.js', () => ({ davFetch: davFetchMock }))
vi.mock('../dav/client.js', () => ({ createClient: async () => clientMock }))

const { DavContactStore, hrefInBook } = await import('./DavContactStore.js')
const { encodeId } = await import('./idCodec.js')
const { ForbiddenError } = await import('./errors.js')

const ctx: DavContext = { baseUrl: 'https://dav.example.com/', username: 'alice', password: 'secret' }
const bookUrl = 'https://dav.example.com/user/contacts/'
const bookId = encodeId(bookUrl)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('hrefInBook', () => {
  it('accepts cards inside the collection', () => {
    expect(hrefInBook(bookUrl, 'https://dav.example.com/user/contacts/a.vcf')).toBe(true)
    expect(hrefInBook(bookUrl, '/user/contacts/a.vcf')).toBe(true)
  })

  it('rejects other collections, including ones sharing a name prefix', () => {
    expect(hrefInBook(bookUrl, 'https://dav.example.com/user/calendar/event1.ics')).toBe(false)
    expect(hrefInBook(bookUrl, 'https://dav.example.com/user/contacts-evil/a.vcf')).toBe(false)
  })
})

describe('DavContactStore write scoping', () => {
  const store = new DavContactStore()

  it('refuses to update a resource outside the address book', async () => {
    await expect(
      store.updateCard(ctx, bookId, 'https://dav.example.com/user/calendar/event1.ics', '"e"', 'BEGIN:VCARD'),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(clientMock.updateVCard).not.toHaveBeenCalled()
  })

  it('refuses to delete a resource outside the address book', async () => {
    await expect(
      store.deleteCard(ctx, bookId, 'https://dav.example.com/user/calendar/event1.ics', '"e"'),
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(clientMock.deleteVCard).not.toHaveBeenCalled()
  })

  it('refuses an href on a different host', async () => {
    await expect(
      store.deleteCard(ctx, bookId, 'https://evil.example.org/user/contacts/a.vcf', '"e"'),
    ).rejects.toThrow()
    expect(clientMock.deleteVCard).not.toHaveBeenCalled()
  })
})

describe('createAddressBook', () => {
  it('MKCOLs a new addressbook collection under the home set and escapes the name', async () => {
    davFetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    const created = await new DavContactStore().createAddressBook(ctx, `Tom & "Jerry" <b>`)

    const [, url, init] = davFetchMock.mock.calls[0]
    expect(String(url).startsWith('https://dav.example.com/user/contacts-home/')).toBe(true)
    expect(init.method).toBe('MKCOL')
    expect(init.body).toContain('<C:addressbook/>')
    expect(init.body).toContain('Tom &#38; &#34;Jerry&#34; &#60;b&#62;')
    expect(init.body).not.toContain('<b>')
    expect(created.displayName).toBe(`Tom & "Jerry" <b>`)
  })

  it('surfaces a server rejection', async () => {
    davFetchMock.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }))
    await expect(new DavContactStore().createAddressBook(ctx, 'x')).rejects.toThrow(/403/)
  })
})
