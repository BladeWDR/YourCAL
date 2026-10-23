import { createHash } from 'node:crypto'
import { createClient } from './client.js'
import type { DavContext } from './context.js'
import { assertHostAllowed } from './hostAllowlist.js'

/**
 * Proves credentials are valid by running full CalDAV discovery
 * (well-known -> principal -> calendar-home-set). Throws on any
 * auth or network failure; callers translate that into a 401/502.
 */
export async function verifyCredentials(ctx: DavContext): Promise<void> {
  assertHostAllowed(ctx.baseUrl)
  const client = await createClient(ctx)
  if (!client.account) {
    throw new Error('CalDAV discovery did not resolve an account')
  }
}

// CardDAV discovery is several round trips and a CalDAV-only server fails it
// every time, so remember the answer (per account, never the password) for a
// while rather than re-probing on every whoami.
const CONTACTS_PROBE_TTL_MS = 10 * 60 * 1000
const contactsProbe = new Map<string, { ok: boolean; expiresAt: number }>()

/**
 * Whether the account has an address book home set, i.e. whether the Contacts
 * half of the app can work. Never throws: any failure counts as "no contacts".
 */
export async function supportsContacts(ctx: DavContext): Promise<boolean> {
  const key = createHash('sha256').update(`${ctx.baseUrl}\n${ctx.username}`).digest('hex')
  const now = Date.now()
  const cached = contactsProbe.get(key)
  if (cached && cached.expiresAt > now) return cached.ok

  let ok = false
  try {
    const client = await createClient(ctx, 'carddav')
    ok = Boolean(client.account?.homeUrl)
  } catch {
    ok = false
  }
  if (contactsProbe.size > 500) {
    for (const [k, v] of contactsProbe) if (v.expiresAt <= now) contactsProbe.delete(k)
  }
  contactsProbe.set(key, { ok, expiresAt: now + CONTACTS_PROBE_TTL_MS })
  return ok
}
