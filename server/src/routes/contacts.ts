import type { CreateAddressBookInput, CreateContactInput, UpdateContactInput } from '@yourcal/shared'
import type { FastifyInstance } from 'fastify'
import { EtagConflictError } from '../store/errors.js'
import { DavAddressBookStore } from '../store/DavAddressBookStore.js'
import { requireSession } from './requireSession.js'

const addressBookStore = new DavAddressBookStore()

export async function contactRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/addressbooks
  app.get('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const books = await addressBookStore.discoverAddressBooks(dav)
    return books
  })

  // POST /api/addressbooks
  app.post<{ Body: CreateAddressBookInput }>('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    if (!req.body?.displayName?.trim()) {
      reply.code(400).send({ error: 'bad_request', message: 'Address book display name is required' })
      return
    }
    const book = await addressBookStore.createAddressBook(dav, req.body)
    reply.code(201).send(book)
  })

  // DELETE /api/addressbooks/:id
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    await addressBookStore.deleteAddressBook(dav, req.params.id)
    reply.code(204).send()
  })

  // GET /api/addressbooks/:id/contacts
  app.get<{ Params: { id: string } }>('/:id/contacts', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const contacts = await addressBookStore.getContacts(dav, req.params.id)
    return contacts
  })

  // POST /api/addressbooks/:id/contacts
  app.post<{ Params: { id: string }; Body: CreateContactInput }>('/:id/contacts', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    if (!req.body) {
      reply.code(400).send({ error: 'bad_request', message: 'Missing contact fields' })
      return
    }
    const contact = await addressBookStore.createContact(dav, req.params.id, req.body)
    reply.code(201).send(contact)
  })

  // PUT /api/addressbooks/:id/contacts/:uid
  app.put<{ Params: { id: string; uid: string }; Body: UpdateContactInput }>(
    '/:id/contacts/:uid',
    async (req, reply) => {
      const dav = requireSession(req, reply)
      if (!dav) return
      if (!req.body?.href || !req.body?.fields) {
        reply.code(400).send({ error: 'bad_request', message: 'Missing required update fields (href, fields)' })
        return
      }
      try {
        const contact = await addressBookStore.updateContact(
          dav,
          req.params.id,
          req.params.uid,
          req.body.fields,
          req.body.etag,
          req.body.href,
        )
        return contact
      } catch (err) {
        if (err instanceof EtagConflictError) {
          reply.code(412).send({ error: 'conflict', message: (err as Error).message })
          return
        }
        throw err
      }
    },
  )

  // DELETE /api/addressbooks/:id/contacts/:uid
  app.delete<{ Params: { id: string; uid: string }; Querystring: { href: string; etag?: string } }>(
    '/:id/contacts/:uid',
    async (req, reply) => {
      const dav = requireSession(req, reply)
      if (!dav) return
      const { href, etag } = req.query
      if (!href) {
        reply.code(400).send({ error: 'bad_request', message: 'Missing href query parameter' })
        return
      }
      try {
        await addressBookStore.deleteContact(dav, href, etag ?? null)
        reply.code(204).send()
      } catch (err) {
        if (err instanceof EtagConflictError) {
          reply.code(412).send({ error: 'conflict', message: (err as Error).message })
          return
        }
        throw err
      }
    },
  )
}
