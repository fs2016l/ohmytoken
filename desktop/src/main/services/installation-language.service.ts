import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isAppLanguage, type AppLanguage } from '../../shared/app-preferences'

/** Read only the installer hint; existing renderer preferences always take precedence. */
export function readInstallationLanguage(resourcesDirectory: string): AppLanguage | null {
  try {
    const value = readFileSync(join(resourcesDirectory, 'installation-language'), 'utf8').trim()
    return isAppLanguage(value) ? value : null
  } catch {
    return null
  }
}
