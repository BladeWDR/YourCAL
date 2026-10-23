import type { AddressBook } from '@yourdav/shared'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from '../dav/context.js'

process.env.SESSION_SECRET ??= 'a'.repeat(64)

const storeMock: Record<string, ReturnType<typeof vi.fn>> = {
  discoverAddressBooks: vi.fn(),
  createAddressBook: vi.fn(),
  deleteAddressBook: vi.fn(),
  getCards: vi.fn(),
}
vi.mock('../store/contacts.js', () => ({ contactStore: storeMock }))

const { addressBookRoutes } = await import('./addressbooks.js')

const dav: DavContext = { baseUrl: 'https://dav.example.com/dav/', username: 'alice', password: 'secret' }

function book(id: string, overrides: Partial<AddressBook> = {}): AddressBook {
  return { id, displayName: id, description: null, readOnly: false, ctag: null, ...overrides }
}

async function buildApp(opts: { authenticated?: boolean } = {}): Promise<FastifyInstance> {
  const { authenticated = true } = opts
  const app = Fastify()
  app.decorateRequest('session', null as never)
  app.addHook('onRequest', async (req) => {
    req.session = { get: (key: string) => (key === 'dav' && authenticated ? dav : undefined) } as never
  })
  await app.register(addressBookRoutes, { prefix: '/api/addressbooks' })
  return app
}

let app: FastifyInstance
beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(async () => {
  await app?.close()
})

describe('POST /api/addressbooks', () => {
  it('401s when unauthenticated', async () => {
    app = await buildApp({ authenticated: false })
    const res = await app.inject({ method: 'POST', url: '/api/addressbooks', payload: { displayName: 'Work' } })
    expect(res.statusCode).toBe(401)
    expect(storeMock.createAddressBook).not.toHaveBeenCalled()
  })

  it('creates an address book with a trimmed name', async () => {
    storeMock.createAddressBook.mockResolvedValue(book('new', { displayName: 'Work' }))
    app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/addressbooks', payload: { displayName: '  Work  ' } })
    expect(res.statusCode).toBe(201)
    expect(storeMock.createAddressBook).toHaveBeenCalledWith(dav, 'Work')
    expect(res.json().displayName).toBe('Work')
  })

  it.each([[''], ['   '], ['x'.repeat(201)]])('rejects the invalid name %j', async (displayName) => {
    app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/addressbooks', payload: { displayName } })
    expect(res.statusCode).toBe(400)
    expect(storeMock.createAddressBook).not.toHaveBeenCalled()
  })

  it('rejects a missing body', async () => {
    app = await buildApp()
    const res = await app.inject({ method: 'POST', url: '/api/addressbooks' })
    expect(res.statusCode).toBe(400)
    expect(storeMock.createAddressBook).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/addressbooks/:id', () => {
  it('401s when unauthenticated', async () => {
    app = await buildApp({ authenticated: false })
    const res = await app.inject({ method: 'DELETE', url: '/api/addressbooks/b1' })
    expect(res.statusCode).toBe(401)
    expect(storeMock.deleteAddressBook).not.toHaveBeenCalled()
  })

  it('deletes a discovered, writable address book', async () => {
    storeMock.discoverAddressBooks.mockResolvedValue([book('b1'), book('b2')])
    storeMock.deleteAddressBook.mockResolvedValue(undefined)
    app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/addressbooks/b1' })
    expect(res.statusCode).toBe(204)
    expect(storeMock.deleteAddressBook).toHaveBeenCalledWith(dav, 'b1')
  })

  it('404s for an id that is not a discovered address book, without issuing a DELETE', async () => {
    storeMock.discoverAddressBooks.mockResolvedValue([book('b1')])
    app = await buildApp()
    // e.g. a crafted id pointing at a calendar or the principal collection
    const res = await app.inject({ method: 'DELETE', url: '/api/addressbooks/some-calendar-id' })
    expect(res.statusCode).toBe(404)
    expect(storeMock.deleteAddressBook).not.toHaveBeenCalled()
  })

  it('403s for a read-only address book', async () => {
    storeMock.discoverAddressBooks.mockResolvedValue([book('b1', { readOnly: true })])
    app = await buildApp()
    const res = await app.inject({ method: 'DELETE', url: '/api/addressbooks/b1' })
    expect(res.statusCode).toBe(403)
    expect(storeMock.deleteAddressBook).not.toHaveBeenCalled()
  })
})
