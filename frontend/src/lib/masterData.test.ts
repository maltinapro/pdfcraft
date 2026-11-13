import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeEntry } from './archive'
import { BACKUP_VERSION, exportBackup, readBackup } from './backup'
import { defaultDoc, defaultDrafts } from './documents'
import {
  MASTER_DATA_VERSION,
  loadMasterData,
  masterDataFromArchive,
  mergeMasterData,
  parseMasterData,
  saveArticleFromItem,
  saveMasterData,
  saveRecipient,
  searchArticles,
  searchContacts,
  serializeMasterData,
  type MasterData,
} from './masterData'
import { DEFAULT_SETTINGS, defaultInvoice, newItem, type Recipient } from './types'

const STORAGE_KEY = 'pdfcraft.masterData'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  }
}

const recipient = (name: string, extra: Partial<Recipient> = {}): Recipient => ({
  name,
  address: 'Kundenweg 5',
  city: '54321 Kundenstadt',
  vatId: '',
  email: '',
  buyerReference: '',
  ...extra,
})

const sample = (): MasterData => ({
  contacts: [{ id: 'c1', ...recipient('Kunde AG', { vatId: 'DE123456789', email: 'a@kunde.example' }) }],
  articles: [{ id: 'a1', description: 'Beratung', unit: 'h', price: 95, taxRate: 19 }],
})

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

describe('parseMasterData', () => {
  it('accepts what serializeMasterData writes', () => {
    expect(parseMasterData(JSON.parse(JSON.stringify(serializeMasterData(sample()))))).toEqual(sample())
  })

  const file = (patch: object) => ({ ...serializeMasterData(sample()), ...patch })

  it.each([
    ['not an object', 'x'],
    ['no version', { contacts: [], articles: [] }],
    ['contacts is not a list', file({ contacts: {} })],
    ['contact without name', file({ contacts: [{ id: 'c', name: ' ' }] })],
    ['contact field of the wrong type', file({ contacts: [{ id: 'c', name: 'A', city: 5 }] })],
    ['contact field too long', file({ contacts: [{ id: 'c', name: 'x'.repeat(201) }] })],
    ['unknown unit', file({ articles: [{ id: 'a', description: 'X', unit: 'parsec', price: 1, taxRate: 19 }] })],
    ['VAT rate that is not offered', file({ articles: [{ id: 'a', description: 'X', unit: 'h', price: 1, taxRate: 5 }] })],
    ['price is not a number', file({ articles: [{ id: 'a', description: 'X', unit: 'h', price: '1', taxRate: 19 }] })],
    ['price out of range', file({ articles: [{ id: 'a', description: 'X', unit: 'h', price: 1e10, taxRate: 19 }] })],
    ['newer version', file({ masterDataVersion: MASTER_DATA_VERSION + 1 })],
  ])('rejects %s', (_name, input) => {
    expect(() => parseMasterData(input)).toThrow()
  })

  it('keeps the first entry of a duplicated id', () => {
    const data = parseMasterData(file({ contacts: [{ id: 'c', name: 'A' }, { id: 'c', name: 'B' }] }))
    expect(data.contacts.map((c) => c.name)).toEqual(['A'])
  })
})

describe('storage', () => {
  it('round-trips through localStorage in its own key', () => {
    expect(saveMasterData(sample())).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"masterDataVersion":1')
    expect(loadMasterData()).toEqual(sample())
  })

  it('falls back to empty data when the stored value is broken', () => {
    localStorage.setItem(STORAGE_KEY, '{"masterDataVersion":1,"contacts":[{"name":""}],"articles":[]}')
    expect(loadMasterData()).toEqual({ contacts: [], articles: [] })
  })

  it('asks for persistent storage once, with the first save of real data', async () => {
    vi.resetModules()
    const persist = vi.fn(async () => true)
    vi.stubGlobal('navigator', { storage: { persist } })
    const fresh = await import('./masterData')
    fresh.saveMasterData({ contacts: [], articles: [] })
    expect(persist).not.toHaveBeenCalled()
    fresh.saveMasterData(sample())
    fresh.saveMasterData(sample())
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('reports a refused write', () => {
    vi.stubGlobal('localStorage', { ...fakeStorage(), setItem: () => { throw new Error('quota') } })
    expect(saveMasterData(sample())).toBe(false)
  })
})

describe('saving from a document', () => {
  it('stores a recipient once and updates it by name and address', () => {
    const first = saveRecipient({ contacts: [], articles: [] }, recipient('Neu GmbH'))
    expect(first.updated).toBe(false)
    const second = saveRecipient(first.data, recipient(' neu  gmbh', { email: 'x@neu.example' }))
    expect(second.updated).toBe(true)
    expect(second.data.contacts).toHaveLength(1)
    expect(second.data.contacts[0].email).toBe('x@neu.example')
    expect(second.data.contacts[0].id).toBe(first.data.contacts[0].id)
  })

  it('updates the price of an article with the same description, unit and VAT rate', () => {
    const base = sample()
    const same = saveArticleFromItem(base, newItem({ description: 'beratung', unit: 'h', price: 110, taxRate: 19 }))
    expect(same.updated).toBe(true)
    expect(same.data.articles).toHaveLength(1)
    expect(same.data.articles[0].price).toBe(110)
    const other = saveArticleFromItem(base, newItem({ description: 'Beratung', unit: 'h', price: 95, taxRate: 7 }))
    expect(other.updated).toBe(false)
    expect(other.data.articles).toHaveLength(2)
  })
})

describe('search', () => {
  it('matches every term anywhere in the entry, ignoring case', () => {
    const data = sample()
    expect(searchContacts(data.contacts, 'kunde kundenstadt')).toHaveLength(1)
    expect(searchContacts(data.contacts, 'kunde berlin')).toHaveLength(0)
    expect(searchContacts(data.contacts, '')).toHaveLength(1)
    expect(searchArticles(data.articles, 'BERAT')).toHaveLength(1)
  })
})

describe('seeding from issued documents', () => {
  const invoice = { ...defaultInvoice(), recipient: recipient('Kunde AG'), items: [newItem({ description: 'Beratung', unit: 'h', price: 95, taxRate: 19 }), newItem({ description: ' ', price: 1 })] }
  const deliveryNote = { ...defaultDoc('delivery-note'), recipient: recipient('Anderer Kunde'), items: [newItem({ description: 'Paket', unit: 'pcs' })] }
  const archive = [makeEntry('delivery-note', deliveryNote, DEFAULT_SETTINGS), makeEntry('invoice', invoice, DEFAULT_SETTINGS), makeEntry('invoice', invoice, DEFAULT_SETTINGS)]

  it('takes recipients of all documents and articles of priced ones, without duplicates', () => {
    const seed = masterDataFromArchive(archive)
    expect(seed.contacts.map((c) => c.name).sort()).toEqual(['Anderer Kunde', 'Kunde AG'])
    expect(seed.articles.map((a) => a.description)).toEqual(['Beratung'])
  })

  it('adds nothing when it runs twice', () => {
    const once = mergeMasterData({ contacts: [], articles: [] }, masterDataFromArchive(archive))
    expect(once.addedContacts).toBe(2)
    expect(once.addedArticles).toBe(1)
    const twice = mergeMasterData(once.data, masterDataFromArchive(archive))
    expect(twice.addedContacts + twice.addedArticles).toBe(0)
    expect(twice.data).toEqual(once.data)
  })

  it('does not touch entries that exist already', () => {
    const base = sample()
    const merged = mergeMasterData(base, { contacts: [{ id: 'other', ...recipient('Kunde AG', { email: 'changed@example.com' }) }], articles: [] })
    expect(merged.addedContacts).toBe(0)
    expect(merged.data.contacts[0].email).toBe('a@kunde.example')
  })
})

describe('backup', () => {
  const backup = (data: MasterData) => exportBackup(DEFAULT_SETTINGS, defaultInvoice(), defaultDrafts(), [], data)
  const asFile = (json: unknown) => new File([JSON.stringify(json)], 'backup.json', { type: 'application/json' })

  it('round-trips the master data', async () => {
    const content = await readBackup(new File([backup(sample())], 'backup.json'))
    expect(content.masterData).toEqual(sample())
    expect(JSON.parse(await backup(sample()).text()).backupVersion).toBe(BACKUP_VERSION)
    expect(BACKUP_VERSION).toBe(2)
  })

  it('still imports a version 1 file, without master data', async () => {
    const v1 = JSON.parse(await backup(sample()).text())
    v1.backupVersion = 1
    delete v1.masterData
    const content = await readBackup(asFile(v1))
    expect(content.masterData).toBeUndefined()
    expect(content.config).toBeDefined()
  })

  it('rejects a file with invalid master data and leaves the stored data alone', async () => {
    saveMasterData(sample())
    const before = localStorage.getItem(STORAGE_KEY)
    const broken = JSON.parse(await backup(sample()).text())
    broken.masterData.articles[0].unit = 'parsec'
    await expect(readBackup(asFile(broken))).rejects.toThrow()
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(loadMasterData()).toEqual(sample())
  })

  it('rejects a backup from a newer version', async () => {
    const future = JSON.parse(await backup(sample()).text())
    future.backupVersion = BACKUP_VERSION + 1
    await expect(readBackup(asFile(future))).rejects.toThrow()
  })
})
