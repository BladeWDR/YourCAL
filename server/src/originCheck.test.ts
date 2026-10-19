import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { originCheck } from './originCheck.js'

async function build() {
  const app = Fastify()
  app.addHook('onRequest', originCheck)
  app.post('/x', async () => ({ ok: true }))
  app.get('/x', async () => ({ ok: true }))
  return app
}

const post = (headers: Record<string, string>) =>
  build().then((app) => app.inject({ method: 'POST', url: '/x', headers: { host: 'cal.example.com', ...headers } }))

describe('originCheck', () => {
  it('allows a same-origin POST', async () => {
    expect((await post({ origin: 'https://cal.example.com' })).statusCode).toBe(200)
  })
  it('allows a POST with no Origin header', async () => {
    expect((await post({})).statusCode).toBe(200)
  })
  it('rejects a cross-origin POST', async () => {
    expect((await post({ origin: 'https://evil.example' })).statusCode).toBe(403)
  })
  it('rejects a malformed Origin', async () => {
    expect((await post({ origin: 'null' })).statusCode).toBe(403)
  })
  it('accepts the proxy-forwarded host', async () => {
    expect((await post({ origin: 'https://public.example', 'x-forwarded-host': 'public.example' })).statusCode).toBe(200)
  })
  it('does not check GET requests', async () => {
    const app = await build()
    const res = await app.inject({ method: 'GET', url: '/x', headers: { origin: 'https://evil.example' } })
    expect(res.statusCode).toBe(200)
  })
})
