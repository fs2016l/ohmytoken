import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { ThirdPartyCatalogue, ThirdPartyEntry } from '../../shared/third-party-notices'

interface StoredEntry extends Omit<ThirdPartyEntry, 'documents'> {
  documents: (ThirdPartyEntry['documents'][number] & { file: string; sha256: string })[]
}
interface StoredCatalogue {
  schemaVersion: number
  applicationVersion: string
  entries: StoredEntry[]
}

export class ThirdPartyNoticesService {
  private cached: Promise<StoredCatalogue> | undefined
  private readonly directory: string
  constructor(directory: string) {
    this.directory = directory
  }

  private load(): Promise<StoredCatalogue> {
    return (this.cached ??= readFile(join(this.directory, 'generated/catalogue.json'), 'utf8')
      .then((text) => {
        const data: StoredCatalogue = JSON.parse(text)
        if (data.schemaVersion !== 1 || !Array.isArray(data.entries))
          throw new Error('Invalid third-party catalogue')
        return data
      })
      .catch((error) => {
        this.cached = undefined
        throw error
      }))
  }

  async list(): Promise<ThirdPartyCatalogue> {
    const data = await this.load()
    return {
      applicationVersion: data.applicationVersion,
      entries: data.entries.map(
        ({ id, name, version, license, category, project, source, external, documents }) => ({
          id,
          name,
          version,
          license,
          category,
          project,
          source,
          external,
          documents: documents.map(({ name, source }) => ({ name, source })),
        }),
      ),
    }
  }

  async read(id: string, index: number): Promise<string> {
    if (typeof id !== 'string' || id.length > 200 || !Number.isSafeInteger(index) || index < 0)
      throw new Error('Invalid notice selection')
    const entry = (await this.load()).entries.find((item) => item.id === id)
    const document = entry?.documents[index]
    if (!document || !/^documents\/[a-f0-9]{64}\.txt$/.test(document.file))
      throw new Error('Unknown notice document')
    const file = join(this.directory, 'generated', document.file)
    if ((await stat(file)).size > 1024 * 1024) throw new Error('Notice document too large')
    const text = await readFile(file, 'utf8')
    if (createHash('sha256').update(text).digest('hex') !== document.sha256)
      throw new Error('Notice document integrity check failed')
    return text
  }
}
