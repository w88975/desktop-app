import { randomUUID } from 'crypto'
import { watch, type FSWatcher } from 'fs'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'path'
import type {
  ExternalAppManifest,
  ExternalAppRecord,
  ExternalWebToolManifest,
} from '../shared/app-platform'

interface ExternalAppRegistryOptions {
  rootPath: string
  builtinRootPath?: string
  fetcher?: typeof fetch
  onError?: (message: string, error?: unknown) => void
}

interface RemoteSourceFile extends Record<string, unknown> {
  schemaVersion?: number
  type: 'remote'
  url: string
  manifestUrl?: string
  entryUrl?: string
  iconFile?: string
  lastResolvedAt?: string
}

const APP_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const MANIFEST_FILENAME = 'manifest-hxsy.json'
const SOURCE_FILENAME = 'source.json'

function cloneRecord(record: ExternalAppRecord): ExternalAppRecord {
  return structuredClone(record)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`)
  return value.trim()
}

function parseWebTools(value: unknown): ExternalWebToolManifest[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('Invalid webTools')
  const names = new Set<string>()
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Invalid webTools[${index}]`)
    const raw = item as Record<string, unknown>
    const name = requireString(raw.name, `webTools[${index}].name`)
    if (names.has(name)) throw new Error(`Duplicate Web Tool: ${name}`)
    names.add(name)
    if (!raw.inputSchema || typeof raw.inputSchema !== 'object' || Array.isArray(raw.inputSchema)) {
      throw new Error(`Invalid webTools[${index}].inputSchema`)
    }
    return {
      name,
      description: requireString(raw.description, `webTools[${index}].description`),
      inputSchema: structuredClone(raw.inputSchema as Record<string, unknown>),
      handler: requireString(raw.handler, `webTools[${index}].handler`),
    }
  })
}

export function parseExternalAppManifest(value: unknown, expectedAppId: string): ExternalAppManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifest must be an object')
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported manifest schemaVersion: ${String(raw.schemaVersion)}`)
  const appId = requireString(raw.appId, 'appId')
  if (appId !== expectedAppId) throw new Error(`Manifest appId "${appId}" does not match directory "${expectedAppId}"`)
  if (!APP_ID_PATTERN.test(appId)) throw new Error(`Invalid appId: ${appId}`)

  const manifest: ExternalAppManifest = {
    schemaVersion: 1,
    appId,
    title: requireString(raw.title, 'title'),
    icon: requireString(raw.icon, 'icon'),
    entry: requireString(raw.entry, 'entry'),
    webTools: parseWebTools(raw.webTools),
  }
  if (raw.version !== undefined) manifest.version = requireString(raw.version, 'version')
  if (raw.description !== undefined) manifest.description = requireString(raw.description, 'description')
  return manifest
}

export function resolveLocalAppFile(appDirectory: string, relativePath: string): string {
  if (isAbsolute(relativePath) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(relativePath)) {
    throw new Error(`Local App path must be relative: ${relativePath}`)
  }
  const normalizedRelative = normalize(relativePath.replace(/^\.\//, ''))
  const resolvedRoot = resolve(appDirectory)
  const resolvedPath = resolve(resolvedRoot, normalizedRelative)
  const childPath = relative(resolvedRoot, resolvedPath)
  if (!childPath || childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
    throw new Error(`Local App path escapes app directory: ${relativePath}`)
  }
  return resolvedPath
}

function localAppUrl(appId: string, relativePath: string): string {
  const normalizedPath = normalize(relativePath.replace(/^\.\//, '')).split(sep).join('/')
  return `hxsy-app://${appId}/${normalizedPath}`
}

function parseRemoteSource(value: unknown): RemoteSourceFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('source.json must be an object')
  const source = value as Record<string, unknown>
  if (source.type !== 'remote') throw new Error('source.json type must be "remote"')
  const url = new URL(requireString(source.url, 'source.url'))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Remote App URL must use http or https')
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return { ...source, type: 'remote', url: url.toString() } as RemoteSourceFile
}

function iconCacheFilename(iconUrl: URL, contentType: string | null): string {
  const extension = extname(iconUrl.pathname).toLowerCase()
  if (['.png', '.svg', '.webp', '.jpg', '.jpeg', '.ico'].includes(extension)) return `icon${extension}`
  if (contentType?.includes('svg')) return 'icon.svg'
  if (contentType?.includes('webp')) return 'icon.webp'
  if (contentType?.includes('jpeg')) return 'icon.jpg'
  if (contentType?.includes('icon')) return 'icon.ico'
  return 'icon.png'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function atomicWrite(path: string, data: string | Uint8Array): Promise<void> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`
  await writeFile(temporaryPath, data)
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error
    await unlink(path).catch(() => {})
    await rename(temporaryPath, path)
  }
}

export class ExternalAppRegistry {
  private readonly rootPath: string
  private readonly builtinRootPath: string | null
  private readonly fetcher: typeof fetch
  private readonly onError: (message: string, error?: unknown) => void
  private readonly records = new Map<string, ExternalAppRecord>()
  private readonly appDirectories = new Map<string, string>()
  private readonly listeners = new Set<(apps: ExternalAppRecord[]) => void>()
  private readonly resolvingRemote = new Map<string, Promise<ExternalAppRecord>>()
  private readonly watchers: FSWatcher[] = []
  private scanTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: ExternalAppRegistryOptions) {
    this.rootPath = resolve(options.rootPath)
    this.builtinRootPath = options.builtinRootPath ? resolve(options.builtinRootPath) : null
    this.fetcher = options.fetcher ?? fetch
    this.onError = options.onError ?? (() => {})
  }

  getRootPath(): string {
    return this.rootPath
  }

  resolveResourcePath(appId: string, relativePath: string): string {
    const appDirectory = this.appDirectories.get(appId)
    if (!appDirectory) throw new Error(`Unknown App directory: ${appId}`)
    return resolveLocalAppFile(appDirectory, relativePath)
  }

  list(): ExternalAppRecord[] {
    return [...this.records.values()]
      .map(cloneRecord)
      .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
  }

  get(appId: string): ExternalAppRecord | null {
    const record = this.records.get(appId)
    return record ? cloneRecord(record) : null
  }

  subscribe(listener: (apps: ExternalAppRecord[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
    await this.scan()
    this.startWatcher(this.rootPath)
    if (this.builtinRootPath && await pathExists(this.builtinRootPath)) this.startWatcher(this.builtinRootPath)
  }

  async scan(): Promise<ExternalAppRecord[]> {
    await mkdir(this.rootPath, { recursive: true })
    const nextRecords = new Map<string, ExternalAppRecord>()
    const nextDirectories = new Map<string, string>()
    const candidates: Array<{
      appId: string
      appDirectory: string
      forcedSourceType?: 'builtin'
    }> = []

    if (this.builtinRootPath && await pathExists(this.builtinRootPath)) {
      const entries = await readdir(this.builtinRootPath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory() || !APP_ID_PATTERN.test(entry.name)) continue
        candidates.push({
          appId: entry.name,
          appDirectory: join(this.builtinRootPath, entry.name),
          forcedSourceType: 'builtin',
        })
      }
    }

    const userEntries = await readdir(this.rootPath, { withFileTypes: true })
    for (const entry of userEntries) {
      if (!entry.isDirectory() || !APP_ID_PATTERN.test(entry.name)) continue
      candidates.push({ appId: entry.name, appDirectory: join(this.rootPath, entry.name) })
    }

    for (const candidate of candidates) {
      // Builtin先扫描并保留身份；用户目录不能覆盖同 appId。
      if (nextRecords.has(candidate.appId)) continue
      const existing = this.records.get(candidate.appId)
      try {
        const record = await this.scanAppDirectory(
          candidate.appId,
          candidate.appDirectory,
          existing,
          candidate.forcedSourceType
        )
        nextRecords.set(candidate.appId, record)
        nextDirectories.set(candidate.appId, candidate.appDirectory)
      } catch (error) {
        const sourceType = candidate.forcedSourceType
          ?? (await pathExists(join(candidate.appDirectory, SOURCE_FILENAME)) ? 'remote' : 'local')
        nextRecords.set(candidate.appId, {
          appId: candidate.appId,
          sourceType,
          status: 'error',
          title: '加载失败',
          error: error instanceof Error ? error.message : String(error),
          webTools: [],
        })
        nextDirectories.set(candidate.appId, candidate.appDirectory)
      }
    }

    this.records.clear()
    for (const [appId, record] of nextRecords) this.records.set(appId, record)
    this.appDirectories.clear()
    for (const [appId, directory] of nextDirectories) this.appDirectories.set(appId, directory)
    this.emitChanged()
    return this.list()
  }

  resolveRemote(appId: string): Promise<ExternalAppRecord> {
    const active = this.resolvingRemote.get(appId)
    if (active) return active
    const resolution = this.resolveRemoteNow(appId).finally(() => this.resolvingRemote.delete(appId))
    this.resolvingRemote.set(appId, resolution)
    return resolution
  }

  private async resolveRemoteNow(appId: string): Promise<ExternalAppRecord> {
    const existing = this.records.get(appId)
    if (!existing || existing.sourceType !== 'remote') throw new Error(`Unknown Remote App: ${appId}`)
    const appDirectory = this.appDirectories.get(appId)
    if (!appDirectory) throw new Error(`Unknown Remote App directory: ${appId}`)
    const sourcePath = join(appDirectory, SOURCE_FILENAME)
    const sourceRaw = await readJson(sourcePath)
    const source = parseRemoteSource(sourceRaw)

    this.records.set(appId, { ...existing, status: 'loading', title: '加载中...', error: undefined })
    this.emitChanged()

    try {
      const manifestUrl = new URL(MANIFEST_FILENAME, source.url)
      const manifestResponse = await this.fetcher(manifestUrl)
      if (!manifestResponse.ok) throw new Error(`Manifest request failed: HTTP ${manifestResponse.status}`)
      const manifestRaw = await manifestResponse.json()
      const manifest = parseExternalAppManifest(manifestRaw, appId)
      const entryUrl = new URL(manifest.entry, source.url).toString()
      const iconUrl = new URL(manifest.icon, source.url)
      const iconResponse = await this.fetcher(iconUrl)
      if (!iconResponse.ok) throw new Error(`Icon request failed: HTTP ${iconResponse.status}`)
      const iconFile = iconCacheFilename(iconUrl, iconResponse.headers.get('content-type'))
      const iconBytes = new Uint8Array(await iconResponse.arrayBuffer())
      const now = new Date().toISOString()
      const nextSource: RemoteSourceFile = {
        ...source,
        schemaVersion: 1,
        manifestUrl: manifestUrl.toString(),
        entryUrl,
        iconFile,
        lastResolvedAt: now,
      }

      await atomicWrite(join(appDirectory, MANIFEST_FILENAME), `${JSON.stringify(manifestRaw, null, 2)}\n`)
      await atomicWrite(join(appDirectory, iconFile), iconBytes)
      await atomicWrite(sourcePath, `${JSON.stringify(nextSource, null, 2)}\n`)

      const record = this.recordFromManifest(manifest, 'remote', entryUrl, localAppUrl(appId, iconFile))
      this.records.set(appId, record)
      this.emitChanged()
      return cloneRecord(record)
    } catch (error) {
      const record: ExternalAppRecord = {
        ...existing,
        status: 'error',
        title: '加载失败',
        error: error instanceof Error ? error.message : String(error),
      }
      this.records.set(appId, record)
      this.emitChanged()
      return cloneRecord(record)
    }
  }

  async retry(appId: string): Promise<ExternalAppRecord> {
    const existing = this.records.get(appId)
    if (!existing) throw new Error(`Unknown External App: ${appId}`)
    if (existing.sourceType === 'remote') return this.resolveRemote(appId)

    this.records.set(appId, { ...existing, status: 'loading', title: '加载中...', error: undefined })
    this.emitChanged()
    let record: ExternalAppRecord
    try {
      const appDirectory = this.appDirectories.get(appId)
      if (!appDirectory) throw new Error(`Unknown App directory: ${appId}`)
      record = await this.scanLocalApp(appId, appDirectory, existing.sourceType === 'builtin' ? 'builtin' : 'local')
    } catch (error) {
      record = {
        ...existing,
        status: 'error',
        title: '加载失败',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    this.records.set(appId, record)
    this.emitChanged()
    return cloneRecord(record)
  }

  markRuntimeError(appId: string, error: string): void {
    const existing = this.records.get(appId)
    if (!existing) return
    this.records.set(appId, { ...existing, status: 'error', title: '加载失败', error })
    this.emitChanged()
  }

  destroy(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = null
    for (const watcher of this.watchers.splice(0)) watcher.close()
    this.listeners.clear()
  }

  private async scanAppDirectory(
    appId: string,
    appDirectory: string,
    existing?: ExternalAppRecord,
    forcedSourceType?: 'builtin'
  ): Promise<ExternalAppRecord> {
    if (forcedSourceType === 'builtin') return this.scanLocalApp(appId, appDirectory, 'builtin')
    const sourcePath = join(appDirectory, SOURCE_FILENAME)
    if (await pathExists(sourcePath)) {
      const source = parseRemoteSource(await readJson(sourcePath))
      const manifestPath = join(appDirectory, MANIFEST_FILENAME)
      if (await pathExists(manifestPath)) {
        const manifest = parseExternalAppManifest(await readJson(manifestPath), appId)
        const entryUrl = source.entryUrl ?? new URL(manifest.entry, source.url).toString()
        const iconFile = source.iconFile
        const iconUrl = iconFile && await pathExists(join(appDirectory, iconFile))
          ? localAppUrl(appId, iconFile)
          : undefined
        return this.recordFromManifest(manifest, 'remote', entryUrl, iconUrl)
      }
      if (existing?.status === 'loading') return cloneRecord(existing)
      return {
        appId,
        sourceType: 'remote',
        status: 'discovered',
        title: '加载中...',
        webTools: [],
      }
    }
    return this.scanLocalApp(appId, appDirectory, 'local')
  }

  private async scanLocalApp(
    appId: string,
    appDirectory: string,
    sourceType: 'builtin' | 'local'
  ): Promise<ExternalAppRecord> {
    const manifest = parseExternalAppManifest(await readJson(join(appDirectory, MANIFEST_FILENAME)), appId)
    const entryPath = resolveLocalAppFile(appDirectory, manifest.entry)
    const iconPath = resolveLocalAppFile(appDirectory, manifest.icon)
    if (!await pathExists(entryPath)) throw new Error(`Local App entry not found: ${manifest.entry}`)
    if (!await pathExists(iconPath)) throw new Error(`Local App icon not found: ${manifest.icon}`)
    return this.recordFromManifest(
      manifest,
      sourceType,
      localAppUrl(appId, manifest.entry),
      localAppUrl(appId, manifest.icon)
    )
  }

  private recordFromManifest(
    manifest: ExternalAppManifest,
    sourceType: 'builtin' | 'local' | 'remote',
    entryUrl: string,
    iconUrl?: string
  ): ExternalAppRecord {
    return {
      appId: manifest.appId,
      sourceType,
      status: 'ready',
      title: manifest.title,
      description: manifest.description,
      version: manifest.version,
      iconUrl,
      entryUrl,
      webTools: manifest.webTools ?? [],
    }
  }

  private startWatcher(path: string): void {
    try {
      const watcher = watch(path, { recursive: true }, () => this.scheduleScan())
      watcher.on('error', error => this.onError('External App watcher failed', error))
      this.watchers.push(watcher)
    } catch (error) {
      this.onError('External App watcher unavailable', error)
    }
  }

  private scheduleScan(): void {
    if (this.scanTimer) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      void this.scan().catch(error => this.onError('External App rescan failed', error))
    }, 250)
  }

  private emitChanged(): void {
    const snapshot = this.list()
    for (const listener of this.listeners) listener(snapshot)
  }
}
