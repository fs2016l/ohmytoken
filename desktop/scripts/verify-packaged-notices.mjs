import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { writeOrCheckNotices } from './third-party-notices.mjs'

export function verifyPackagedNotices(root, resources) {
  const expected = writeOrCheckNotices({ root, check: true })
  const read = (file) => readFileSync(join(resources, file))
  const equal = (actual, wanted, label) => {
    if (!actual.equals(wanted))
      throw new Error(`Packaged notice is missing, stale or modified: ${label}`)
  }
  for (const file of ['LICENSE', 'LICENSE_SCOPE.md', 'COMMERCIAL_LICENSE.md', 'LICENSE-MIT-LEGACY'])
    equal(read(file), readFileSync(join(root, '..', file)), file)
  for (const file of ['generated/catalogue.json', 'THIRD_PARTY_NOTICES.md'])
    equal(read(`licenses/${file}`), readFileSync(join(root, 'third-party-licenses', file)), file)
  for (const [file, text] of expected.documents)
    equal(read(`licenses/generated/${file}`), Buffer.from(text), file)
  const chromium = read('licenses/runtime/LICENSES.chromium.html')
  if (createHash('sha256').update(chromium).digest('hex') !== expected.chromiumSha256)
    throw new Error('Packaged Chromium license does not match the installed Electron runtime')
  return expected.catalogue.entries.length
}
