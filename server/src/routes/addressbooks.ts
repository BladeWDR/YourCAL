import { createHash } from 'node:crypto'
import type {
  Contact,
  CreateAddressBookInput,
  ContactInput,
  DeleteContactInput,
  ImportResult,
  RenameGroupInput,
  RenameGroupResult,
  UpdateContactInput,
} from '@yourdav/shared'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { applyContactInput, ensureUid, photoFromCard, renameCategory, splitVcf, vcardToContact } from '../vcard/card.js'
import type { DavContext } from '../dav/context.js'
import { EtagConflictError } from '../store/errors.js'
import { encodeId } from '../store/idCodec.js'
import type { RawCard } from '../store/ContactStore.js'
import { contactStore } from '../store/contacts.js'
import { requireSession } from './requireSession.js'

const MAX_PHOTO_BYTES = 2 * 1024 * 1024

function toContact(addressBookId: string, card: RawCard): Contact {
  return vcardToContact(card.vcard, addressBookId, encodeId(card.href), card.href, card.etag)
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, '').slice(0, 100) || 'export'
}

function validInput(body: ContactInput | undefined): string | null {
  if (!body || typeof body !== 'object') return 'body is required'
  if (!body.name || typeof body.name !== 'object') return 'name is required'
  for (const k of ['emails', 'phones', 'urls', 'addresses', 'categories'] as const) {
    if (!Array.isArray(body[k])) return `${k} must be an array`
  }
  const hasAny =
    Object.values(body.name).some((v) => String(v).trim()) || body.org?.trim() || body.fullName?.trim()
  if (!hasAny) return 'A name or organization is required'
  if (typeof body.photo === 'string') {
    if (!/^data:image\/(jpeg|png|gif|webp);base64,/i.test(body.photo)) return 'photo must be a base64 image data URI'
    if (body.photo.length > MAX_PHOTO_BYTES * 1.4) return 'photo is too large'
  }
  return null
}

/** Loads the address book and rejects writes to a read-only one. Replies and returns false on failure. */
async function writable(dav: DavContext, id: string, reply: FastifyReply): Promise<boolean> {
  const book = (await contactStore.discoverAddressBooks(dav)).find((b) => b.id === id)
  if (!book) {
    reply.code(404).send({ error: 'not_found', message: 'Address book not found' })
    return false
  }
  if (book.readOnly) {
    reply.code(403).send({ error: 'forbidden', message: 'This address book is read-only' })
    return false
  }
  return true
}

export async function addressBookRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    return reply.send(await contactStore.discoverAddressBooks(dav))
  })

  app.post<{ Body: CreateAddressBookInput }>('/', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const name = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : ''
    if (!name || name.length > 200) {
      return reply.code(400).send({ error: 'bad_request', message: 'A name of up to 200 characters is required' })
    }
    return reply.code(201).send(await contactStore.createAddressBook(dav, name))
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    // Only a discovered, writable address book can be deleted -- never an
    // arbitrary collection a crafted id happens to point at.
    if (!(await writable(dav, req.params.id, reply))) return
    await contactStore.deleteAddressBook(dav, req.params.id)
    return reply.code(204).send()
  })

  app.get<{ Params: { id: string } }>('/:id/contacts', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const cards = await contactStore.getCards(dav, req.params.id)
    return reply.send(cards.map((c) => toContact(req.params.id, c)))
  })

  app.post<{ Params: { id: string }; Body: ContactInput }>('/:id/contacts', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const err = validInput(req.body)
    if (err) return reply.code(400).send({ error: 'bad_request', message: err })
    if (!(await writable(dav, req.params.id, reply))) return

    const created = await contactStore.createCard(dav, req.params.id, applyContactInput(null, req.body))
    // Re-read so the client gets the server's etag even if it omitted one on 201.
    const card = created.etag ? created : await contactStore.getCard(dav, req.params.id, created.href)
    return reply.code(201).send(toContact(req.params.id, card))
  })

  app.put<{ Params: { id: string }; Body: UpdateContactInput }>('/:id/contacts', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const err = validInput(req.body)
    if (err || !req.body.href || !req.body.etag) {
      return reply.code(400).send({ error: 'bad_request', message: err ?? 'href and etag are required' })
    }
    if (!(await writable(dav, req.params.id, reply))) return

    try {
      // Edit against the server's current copy so unmanaged properties are never lost.
      const current = await contactStore.getCard(dav, req.params.id, req.body.href)
      if (current.etag && current.etag !== req.body.etag) throw new EtagConflictError('Contact changed')
      const updated = await contactStore.updateCard(
        dav,
        req.params.id,
        req.body.href,
        req.body.etag,
        applyContactInput(current.vcard, req.body),
      )
      return reply.send(toContact(req.params.id, updated))
    } catch (e) {
      if (e instanceof EtagConflictError) {
        return reply
          .code(412)
          .send({ error: 'conflict', message: 'This contact was changed elsewhere. Reload and try again.' })
      }
      throw e
    }
  })

  app.delete<{ Params: { id: string }; Querystring: DeleteContactInput }>('/:id/contacts', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const { href, etag } = req.query
    if (!href || !etag) return reply.code(400).send({ error: 'bad_request', message: 'href and etag are required' })
    if (!(await writable(dav, req.params.id, reply))) return
    try {
      await contactStore.deleteCard(dav, req.params.id, href, etag)
      return reply.code(204).send()
    } catch (e) {
      if (e instanceof EtagConflictError) {
        return reply
          .code(412)
          .send({ error: 'conflict', message: 'This contact was changed elsewhere. Reload and try again.' })
      }
      throw e
    }
  })

  app.get<{ Params: { id: string }; Querystring: { href?: string } }>('/:id/photo', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    if (!req.query.href) return reply.code(400).send({ error: 'bad_request', message: 'href is required' })
    const card = await contactStore.getCard(dav, req.params.id, req.query.href)
    const photo = photoFromCard(card.vcard)
    if (!photo) return reply.code(404).send({ error: 'not_found', message: 'No photo' })
    // Served inline into <img>; never let the browser sniff it into something executable.
    return reply
      .header('Content-Type', /^image\/(jpeg|png|gif|webp)$/.test(photo.mime) ? photo.mime : 'application/octet-stream')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=300')
      .send(photo.data)
  })

  app.get<{ Params: { id: string } }>('/:id/export', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const [books, cards] = await Promise.all([contactStore.discoverAddressBooks(dav), contactStore.getCards(dav, req.params.id)])
    const name = books.find((b) => b.id === req.params.id)?.displayName ?? 'contacts'
    return reply
      .header('Content-Type', 'text/vcard; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${sanitizeFilename(name)}.vcf"`)
      .send(cards.map((c) => c.vcard.trim().replace(/\r?\n/g, '\r\n') + '\r\n').join(''))
  })

  app.post<{ Params: { id: string }; Body: string }>('/:id/import', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    if (typeof req.body !== 'string' || !req.body.includes('BEGIN:VCARD')) {
      return reply.code(400).send({ error: 'bad_request', message: 'Expected a .vcf file' })
    }
    if (!(await writable(dav, req.params.id, reply))) return

    const existing = new Set((await contactStore.getCards(dav, req.params.id)).map((c) => vcardToContact(c.vcard, '', '', '', '').uid))
    const result: ImportResult = { imported: 0, skipped: 0 }
    for (const raw of splitVcf(req.body)) {
      // A card with no UID gets one derived from its content, so importing the
      // same file twice skips it rather than duplicating it.
      const { card, uid } = ensureUid(raw, `import-${createHash('sha1').update(raw).digest('hex')}`)
      if (existing.has(uid)) {
        result.skipped++
        continue
      }
      try {
        await contactStore.createCard(dav, req.params.id, card)
        existing.add(uid)
        result.imported++
      } catch (e) {
        req.log.warn({ err: e }, 'vCard import: card rejected')
        result.skipped++
      }
    }
    return reply.send(result)
  })

  // Groups are vCard CATEGORIES, so renaming one rewrites that line on every card carrying it.
  app.post<{ Params: { id: string }; Body: RenameGroupInput }>('/:id/groups/rename', async (req, reply) => {
    const dav = requireSession(req, reply)
    if (!dav) return
    const from = typeof req.body?.from === 'string' ? req.body.from : ''
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : ''
    if (!from || !to) return reply.code(400).send({ error: 'bad_request', message: 'from and to are required' })
    if (!(await writable(dav, req.params.id, reply))) return

    const result: RenameGroupResult = { updated: 0, failed: 0 }
    for (const card of await contactStore.getCards(dav, req.params.id)) {
      const next = renameCategory(card.vcard, from, to)
      if (next === null) continue
      try {
        await contactStore.updateCard(dav, req.params.id, card.href, card.etag, next)
        result.updated++
      } catch (e) {
        req.log.warn({ err: e }, 'group rename failed for a card')
        result.failed++
      }
    }
    return reply.send(result)
  })
}
