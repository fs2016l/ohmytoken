import { createHash } from 'node:crypto'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface DiscoveryFonts {
  css: string
  files: Map<string, string>
}
function within(root: string, file: string): boolean {
  const path = relative(root, file)
  return path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path)
}

/** Reuses only fonts already shipped with Agent; no arbitrary file serving. */
export async function collectDiscoveryFonts(
  rendererRoot: string,
  sourceRoot?: string,
): Promise<DiscoveryFonts> {
  const root = resolve(sourceRoot ?? rendererRoot)
  const files = new Map<string, string>()
  const faces: string[] = []
  const visited = new Set<string>()
  async function inspect(file: string): Promise<void> {
    if (visited.has(file) || !within(root, file)) return
    visited.add(file)
    const css = await readFile(file, 'utf8')
    for (const match of css.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]\)?\s*;/g)) {
      const imported = resolve(dirname(file), match[1])
      if (extname(imported) === '.css') await inspect(imported)
    }
    for (const match of css.matchAll(/@font-face\s*\{[^}]+\}/g)) {
      let face = match[0]
      let valid = true
      for (const url of face.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
        const path = url[1]
        if (/^(?:[a-z]+:|\/\/)/i.test(path) || /[?#%]/.test(path)) {
          valid = false
          break
        }
        const filename = path.startsWith('/')
          ? resolve(root, '.' + path)
          : resolve(dirname(file), path)
        if (!within(root, filename) || extname(filename) !== '.woff2') {
          valid = false
          break
        }
        const info = await stat(filename)
        if (!info.isFile()) {
          valid = false
          break
        }
        const id =
          createHash('sha256')
            .update(relative(root, filename) + ':' + info.size + ':' + info.mtimeMs)
            .digest('hex') + '.woff2'
        files.set(id, filename)
        face = face.replace(url[0], `url("omt-discovery://fonts/${id}")`)
      }
      if (valid) faces.push(face)
    }
  }
  if (sourceRoot) {
    await inspect(join(root, 'styles/fonts.css'))
    await inspect(join(root, 'style.css'))
  } else {
    for (const name of await readdir(join(root, 'assets'))) {
      if (name.endsWith('.css')) await inspect(join(root, 'assets', name))
    }
  }
  if (!faces.length || !files.size) throw new Error('Agent fonts unavailable')
  return { css: [...new Set(faces)].join('\n'), files }
}
