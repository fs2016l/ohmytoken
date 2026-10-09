import { randomInt } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { REPLAY_TITLE_MAX_LENGTH, replayTitle, type ReplayOptions } from '../../shared/replay'

export const REPLAY_RECORD_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function folderTitle(title: string): string {
  // Preserve readable Unicode titles while excluding Windows path aliases and reserved names.
  let result = title
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^[. ]+|[. ]+$/gu, '')
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(result)) result = `_${result}`
  return result
    .slice(0, REPLAY_TITLE_MAX_LENGTH)
    .replace(/[\ud800-\udfff]/gu, '_')
    .replace(/[. ]+$/gu, '')
}

export function validReplayFolderName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (REPLAY_RECORD_ID.test(value)) return true
  const match = /^(.+)-\d{14}-[a-z0-9]{5}$/u.exec(value)
  return !!match && !!match[1] && folderTitle(match[1]) === match[1]
}

export async function createReplayFolder(
  directory: string,
  options: ReplayOptions,
  createdAt: number,
): Promise<string> {
  const title = folderTitle(replayTitle(options)) || replayTitle({ language: options.language })
  const date = new Date(createdAt)
  const timestamp = [
    String(date.getFullYear()).padStart(4, '0'),
    ...[
      date.getMonth() + 1,
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds(),
    ].map((value) => String(value).padStart(2, '0')),
  ].join('')
  for (;;) {
    const suffix = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    const name = `${title}-${timestamp}-${suffix}`
    try {
      // Atomic reservation: never reuse or overwrite a colliding directory or file.
      await fs.mkdir(join(directory, name))
      return name
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}
