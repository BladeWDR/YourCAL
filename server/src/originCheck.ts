import type { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Defence in depth on top of the SameSite=Lax session cookie: a
 * state-changing request from a browser carries an Origin header, and it
 * must name this app's own host (or the proxy-forwarded one). Requests with
 * no Origin (curl, server-to-server) are left alone.
 */
export async function originCheck(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return
  const origin = req.headers.origin
  if (!origin) return
  let originHost = ''
  try {
    originHost = new URL(origin).host
  } catch {
    // leave empty -> rejected below
  }
  const forwarded = req.headers['x-forwarded-host']
  const hosts = [req.headers.host, ...(typeof forwarded === 'string' ? forwarded.split(',').map((h) => h.trim()) : [])]
  if (!originHost || !hosts.includes(originHost)) {
    await reply.code(403).send({ error: 'bad_origin', message: 'Cross-origin request rejected' })
  }
}
