import ICAL from 'ical.js'
import type { Contact, ContactFields, ContactPostalAddress } from '@yourcal/shared'

function formatType(typeParam: unknown): string | undefined {
  if (!typeParam) return undefined
  if (Array.isArray(typeParam)) {
    return typeParam
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof typeParam === 'string') {
    return typeParam
  }
  return undefined
}

function extractBday(val: unknown): string | undefined {
  if (!val) return undefined
  let str: string | undefined
  if (typeof val === 'string') {
    str = val
  } else if (typeof val === 'object' && val !== null) {
    const v = val as {
      toICALString?: () => string
      year?: number
      month?: number
      day?: number
      _time?: { year?: number; month?: number; day?: number }
    }
    const t = v._time ?? v
    if (typeof t.year === 'number' && typeof t.month === 'number' && typeof t.day === 'number') {
      const y = String(t.year).padStart(4, '0')
      const m = String(t.month).padStart(2, '0')
      const d = String(t.day).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    if (typeof v.toICALString === 'function') {
      str = v.toICALString()
    }
  }

  if (str && /^\d{8}$/.test(str)) {
    return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`
  }
  return str
}

export function vcardToContact(
  vcardStr: string,
  meta: { href: string; etag: string | null; addressBookId: string },
): Contact {
  const parsed = ICAL.parse(vcardStr)
  const comp = new ICAL.Component(parsed)

  const uid = comp.getFirstPropertyValue('uid') as string | null
  const fnProp = comp.getFirstPropertyValue('fn') as string | null

  // N: [family, given, additional, prefix, suffix]
  const nVal = comp.getFirstPropertyValue('n') as string[] | null
  const familyName = Array.isArray(nVal) && nVal[0] ? nVal[0] : undefined
  const givenName = Array.isArray(nVal) && nVal[1] ? nVal[1] : undefined
  const additionalName = Array.isArray(nVal) && nVal[2] ? nVal[2] : undefined
  const honorificPrefix = Array.isArray(nVal) && nVal[3] ? nVal[3] : undefined
  const honorificSuffix = Array.isArray(nVal) && nVal[4] ? nVal[4] : undefined

  let fn = fnProp || ''
  if (!fn) {
    fn = [honorificPrefix, givenName, additionalName, familyName, honorificSuffix]
      .filter(Boolean)
      .join(' ')
      .trim()
  }
  if (!fn) {
    fn = '(Unnamed Contact)'
  }

  const nickname = (comp.getFirstPropertyValue('nickname') as string | null) || undefined
  const orgVal = comp.getFirstPropertyValue('org')
  const organization = Array.isArray(orgVal)
    ? orgVal.filter(Boolean).join('; ')
    : typeof orgVal === 'string'
      ? orgVal
      : undefined

  const title = (comp.getFirstPropertyValue('title') as string | null) || undefined
  const role = (comp.getFirstPropertyValue('role') as string | null) || undefined
  const notes = (comp.getFirstPropertyValue('note') as string | null) || undefined
  const bday = extractBday(comp.getFirstPropertyValue('bday'))
  const url = (comp.getFirstPropertyValue('url') as string | null) || undefined

  const emails = comp
    .getAllProperties('email')
    .map((p) => ({
      type: formatType(p.getParameter('type')),
      value: String(p.getFirstValue() ?? '').trim(),
    }))
    .filter((e) => e.value.length > 0)

  const phones = comp
    .getAllProperties('tel')
    .map((p) => ({
      type: formatType(p.getParameter('type')),
      value: String(p.getFirstValue() ?? '').trim(),
    }))
    .filter((p) => p.value.length > 0)

  const addresses: ContactPostalAddress[] = []
  for (const p of comp.getAllProperties('adr')) {
    const parts = p.getFirstValue() as string[] | null
    if (!Array.isArray(parts)) continue
    // ADR structure: [pobox, ext, street, locality, region, postalCode, country]
    const street = parts[2] || undefined
    const locality = parts[3] || undefined
    const region = parts[4] || undefined
    const postalCode = parts[5] || undefined
    const country = parts[6] || undefined
    if (!street && !locality && !region && !postalCode && !country) continue
    addresses.push({
      type: formatType(p.getParameter('type')),
      street,
      locality,
      region,
      postalCode,
      country,
    })
  }

  return {
    uid: uid || meta.href.split('/').filter(Boolean).pop()?.replace(/\.vcf$/i, '') || crypto.randomUUID(),
    href: meta.href,
    etag: meta.etag,
    addressBookId: meta.addressBookId,
    fn,
    givenName,
    familyName,
    additionalName,
    honorificPrefix,
    honorificSuffix,
    nickname,
    organization,
    title,
    role,
    notes,
    bday,
    url,
    emails,
    phones,
    addresses,
  }
}

export function contactToVcard(
  fields: ContactFields,
  options?: { uid?: string; existingVcard?: string },
): string {
  let comp: ICAL.Component
  if (options?.existingVcard) {
    try {
      const parsed = ICAL.parse(options.existingVcard)
      comp = new ICAL.Component(parsed)
    } catch {
      comp = new ICAL.Component('vcard')
      comp.addPropertyWithValue('version', '3.0')
    }
  } else {
    comp = new ICAL.Component('vcard')
    comp.addPropertyWithValue('version', '3.0')
  }

  // Version: ensure set
  if (!comp.getFirstPropertyValue('version')) {
    comp.addPropertyWithValue('version', '3.0')
  }

  // UID
  const currentUid = comp.getFirstPropertyValue('uid')
  if (!currentUid) {
    comp.addPropertyWithValue('uid', options?.uid ?? crypto.randomUUID())
  }

  // FN
  const fn = fields.fn || [fields.givenName, fields.familyName].filter(Boolean).join(' ').trim() || 'Unnamed'
  if (comp.getFirstProperty('fn')) {
    comp.updatePropertyWithValue('fn', fn)
  } else {
    comp.addPropertyWithValue('fn', fn)
  }

  // N: [family, given, additional, prefix, suffix]
  const n = [
    fields.familyName ?? '',
    fields.givenName ?? '',
    fields.additionalName ?? '',
    fields.honorificPrefix ?? '',
    fields.honorificSuffix ?? '',
  ]
  if (comp.getFirstProperty('n')) {
    comp.updatePropertyWithValue('n', n)
  } else {
    comp.addPropertyWithValue('n', n)
  }

  // Single optional properties
  const singleProps: Array<[string, string | undefined]> = [
    ['nickname', fields.nickname],
    ['org', fields.organization],
    ['title', fields.title],
    ['role', fields.role],
    ['note', fields.notes],
    ['bday', fields.bday],
    ['url', fields.url],
  ]

  for (const [propName, val] of singleProps) {
    if (val !== undefined && val !== null && val.trim() !== '') {
      if (comp.getFirstProperty(propName)) {
        comp.updatePropertyWithValue(propName, val.trim())
      } else {
        comp.addPropertyWithValue(propName, val.trim())
      }
    } else {
      comp.removeAllProperties(propName)
    }
  }

  // Multi-value: emails
  comp.removeAllProperties('email')
  for (const email of fields.emails) {
    if (!email.value || !email.value.trim()) continue
    const prop = comp.addPropertyWithValue('email', email.value.trim())
    if (email.type) {
      prop.setParameter('type', email.type)
    }
  }

  // Multi-value: phones
  comp.removeAllProperties('tel')
  for (const phone of fields.phones) {
    if (!phone.value || !phone.value.trim()) continue
    const prop = comp.addPropertyWithValue('tel', phone.value.trim())
    if (phone.type) {
      prop.setParameter('type', phone.type)
    }
  }

  // Multi-value: addresses
  comp.removeAllProperties('adr')
  for (const addr of fields.addresses) {
    const val = [
      '',
      '',
      addr.street ?? '',
      addr.locality ?? '',
      addr.region ?? '',
      addr.postalCode ?? '',
      addr.country ?? '',
    ]
    if (val.slice(2).every((v) => !v)) continue
    const prop = comp.addPropertyWithValue('adr', val)
    if (addr.type) {
      prop.setParameter('type', addr.type)
    }
  }

  return comp.toString()
}
