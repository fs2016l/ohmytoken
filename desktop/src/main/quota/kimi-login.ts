import { join } from 'node:path'

type Region = 'cn' | 'global'

export function kimiRegion(value: unknown): Region | undefined {
  if (value === 'cn' || value === 'mainland-cn' || value === 'REGION_CN') return 'cn'
  if (value === 'global' || value === 'REGION_GLOBAL') return 'global'
  return undefined
}

export function kimiCodeHomes(home: string, env: NodeJS.ProcessEnv): string[] {
  return [
    ...new Set(
      [
        env.KIMI_CODE_HOME,
        env.KIMI_SHARE_DIR,
        join(home, '.kimi-code'),
        join(home, '.kimi'),
      ].filter((path): path is string => Boolean(path)),
    ),
  ]
}
