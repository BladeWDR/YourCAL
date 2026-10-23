import { describe, expect, it } from 'vitest'
import { contactToVcard, vcardToContact } from './vcard.js'
import type { ContactFields } from '@yourdav/shared'

describe('vcard parser & serializer', () => {
  it('parses a full vCard correctly', () => {
    const raw = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:test-uid-1',
      'FN:Jane Mary Doe',
      'N:Doe;Jane;Mary;Dr.;Esq.',
      'NICKNAME:Janie',
      'ORG:Acme Corp;Research',
      'TITLE:Principal Scientist',
      'ROLE:Director',
      'NOTE:Important collaborator',
      'BDAY:1985-12-25',
      'URL:https://example.com/jane',
      'EMAIL;TYPE=WORK:jane.doe@work.com',
      'EMAIL;TYPE=HOME:jane@home.com',
      'TEL;TYPE=WORK,VOICE:+1-555-0100',
      'TEL;TYPE=CELL:+1-555-0199',
      'ADR;TYPE=WORK:;;100 Innovation Way;Boston;MA;02110;USA',
      'END:VCARD',
    ].join('\r\n')

    const contact = vcardToContact(raw, {
      href: 'http://localhost/testuser/contacts/test-uid-1.vcf',
      etag: '"etag123"',
      addressBookId: 'ab-1',
    })

    expect(contact.uid).toBe('test-uid-1')
    expect(contact.fn).toBe('Jane Mary Doe')
    expect(contact.givenName).toBe('Jane')
    expect(contact.familyName).toBe('Doe')
    expect(contact.additionalName).toBe('Mary')
    expect(contact.honorificPrefix).toBe('Dr.')
    expect(contact.honorificSuffix).toBe('Esq.')
    expect(contact.nickname).toBe('Janie')
    expect(contact.organization).toBe('Acme Corp; Research')
    expect(contact.title).toBe('Principal Scientist')
    expect(contact.role).toBe('Director')
    expect(contact.notes).toBe('Important collaborator')
    expect(contact.bday).toBe('1985-12-25')
    expect(contact.url).toBe('https://example.com/jane')
    expect(contact.emails).toEqual([
      { type: 'WORK', value: 'jane.doe@work.com' },
      { type: 'HOME', value: 'jane@home.com' },
    ])
    expect(contact.phones).toEqual([
      { type: 'WORK, VOICE', value: '+1-555-0100' },
      { type: 'CELL', value: '+1-555-0199' },
    ])
    expect(contact.addresses).toEqual([
      {
        type: 'WORK',
        street: '100 Innovation Way',
        locality: 'Boston',
        region: 'MA',
        postalCode: '02110',
        country: 'USA',
      },
    ])
  })

  it('serializes contact fields to vCard and roundtrips', () => {
    const fields: ContactFields = {
      fn: 'Bob Builder',
      givenName: 'Bob',
      familyName: 'Builder',
      organization: 'Can We Fix It LLC',
      title: 'Contractor',
      emails: [{ type: 'WORK', value: 'bob@builder.com' }],
      phones: [{ type: 'CELL', value: '+1-800-FIX-IT' }],
      addresses: [{ street: '42 Main St', locality: 'Bobsville' }],
    }

    const vcardString = contactToVcard(fields, { uid: 'bob-fixed-uid' })
    expect(vcardString).toContain('BEGIN:VCARD')
    expect(vcardString).toContain('FN:Bob Builder')
    expect(vcardString).toContain('N:Builder;Bob;;;')
    expect(vcardString).toContain('EMAIL;TYPE=WORK:bob@builder.com')
    expect(vcardString).toContain('TEL;TYPE=CELL:+1-800-FIX-IT')

    const roundtrip = vcardToContact(vcardString, {
      href: 'http://localhost/ab/bob.vcf',
      etag: null,
      addressBookId: 'ab',
    })
    expect(roundtrip.fn).toBe('Bob Builder')
    expect(roundtrip.givenName).toBe('Bob')
    expect(roundtrip.familyName).toBe('Builder')
    expect(roundtrip.organization).toBe('Can We Fix It LLC')
    expect(roundtrip.emails).toEqual([{ type: 'WORK', value: 'bob@builder.com' }])
    expect(roundtrip.phones).toEqual([{ type: 'CELL', value: '+1-800-FIX-IT' }])
  })
})
