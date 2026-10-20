import type { CalendarObject } from '@yourcal/shared'
import type { FastifyInstance } from 'fastify'
import { fetchSubscriptionEvents } from '../ical/subscription.js'
import { requireSession } from './requireSession.js'

// A feed is re-fetched and re-expanded on every view change, and the URL is
// user-supplied, so repeated identical requests are cached briefly (and
// concurrent ones share a single fetch) rather than each hitting the remote
// server and the recurrence expander.
const CACHE_TTL_MS = 60_000
const CACHE_MAX_ENTRIES = 100
const cache = new Map<string, { expires: number; events: Promise<CalendarObject[]> }>()

// Concurrent uncached fetches allowed per CalDAV account.
const MAX_CONCURRENT_PER_USER = 4
const inFlight = new Map<string, number>()

// Bounds the recurrence expansion a single request can demand; comfortably
// above the widest view the client asks for (year view plus padding).
const MAX_RANGE_MS = 800 * 24 * 60 * 60 * 1000

/** Test hook: forget every cached feed and in-flight count. */
export function clearSubscriptionCache(): void {
  cache.clear()
  inFlight.clear()
}

export async function subscriptionRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { url?: string; start?: string; end?: string } }>('/events', async (req, reply) => {
    // Fetches an arbitrary user-supplied URL server-side; safeFetchExternal
    // (server/src/dav/ssrf.ts) blocks private/loopback/link-local
    // addresses (incl. cloud metadata endpoints), re-validates every
    // redirect hop, and caps the response size.
    const dav = requireSession(req, reply)
    if (!dav) return

    const { url, start, end } = req.query
    if (!url || !start || !end) {
      return reply
        .code(400)
        .send({ error: 'bad_request', message: 'url, start and end query params are required' })
    }
    if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
      return reply.code(400).send({ error: 'bad_request', message: 'start and end must be valid ISO dates' })
    }

    const rangeMs = new Date(end).getTime() - new Date(start).getTime()
    if (rangeMs < 0 || rangeMs > MAX_RANGE_MS) {
      return reply.code(400).send({ error: 'bad_request', message: 'start/end range is invalid or too large' })
    }

    // fetchSubscriptionEvents normalizes internally (webcal://, Google embed
    // links); this parse is only a protocol sanity check on the raw input.
    let parsed: URL
    try {
      parsed = new URL(url.replace(/^webcal:\/\//, 'https://'))
    } catch {
      return reply.code(400).send({ error: 'bad_request', message: 'Invalid subscription URL' })
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reply.code(400).send({ error: 'bad_request', message: 'Only http(s)/webcal URLs are supported' })
    }

    const now = Date.now()
    for (const [key, entry] of cache) {
      if (entry.expires <= now) cache.delete(key)
    }
    const cacheKey = JSON.stringify([url, start, end])
    let cached = cache.get(cacheKey)
    const userKey = `${dav.baseUrl}\n${dav.username}`
    const count = inFlight.get(userKey) ?? 0
    if (!cached) {
      if (count >= MAX_CONCURRENT_PER_USER) {
        return reply.code(429).send({ error: 'too_many_requests', message: 'Too many subscription requests in progress' })
      }
      inFlight.set(userKey, count + 1)
      const events = fetchSubscriptionEvents(url, { start, end }).finally(() => {
        const remaining = (inFlight.get(userKey) ?? 1) - 1
        if (remaining > 0) inFlight.set(userKey, remaining)
        else inFlight.delete(userKey)
      })
      cached = { expires: now + CACHE_TTL_MS, events }
      cache.set(cacheKey, cached)
      // Failures aren't worth caching.
      events.catch(() => {
        if (cache.get(cacheKey) === cached) cache.delete(cacheKey)
      })
      if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!)
    }

    try {
      return reply.send(await cached.events)
    } catch (err) {
      req.log.warn({ err }, 'Failed to fetch subscription feed')
      return reply.code(502).send({ error: 'bad_gateway', message: 'Could not fetch or parse the subscription feed' })
    }
  })
}
