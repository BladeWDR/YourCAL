import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DavContext } from './context.js'

const createClient = vi.fn()
vi.mock('./client.js', () => ({ createClient: (...args: unknown[]) => createClient(...args) }))

const { supportsContacts } = await import('./discovery.js')

let n = 0
/** A fresh account per test, so the module-level probe cache never leaks between them. */
function account(): DavContext {
  n++
  return { baseUrl: 'https://dav.example.com/', username: `user${n}`, password: 'secret' }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('supportsContacts', () => {
  it('is true when CardDAV discovery finds an address book home', async () => {
    createClient.mockResolvedValue({ account: { homeUrl: 'https://dav.example.com/ab/' } })
    expect(await supportsContacts(account())).toBe(true)
    expect(createClient).toHaveBeenCalledWith(expect.anything(), 'carddav')
  })

  it('is false when discovery throws, and does not throw itself', async () => {
    createClient.mockRejectedValue(new Error('cannot find homeUrl'))
    expect(await supportsContacts(account())).toBe(false)
  })

  it('is false when no home set was resolved', async () => {
    createClient.mockResolvedValue({ account: {} })
    expect(await supportsContacts(account())).toBe(false)
  })

  it('remembers the answer instead of re-running discovery', async () => {
    createClient.mockRejectedValue(new Error('no carddav here'))
    const ctx = account()
    expect(await supportsContacts(ctx)).toBe(false)
    expect(await supportsContacts(ctx)).toBe(false)
    expect(createClient).toHaveBeenCalledTimes(1)
  })
})
