import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ExternalAppRegistry,
  parseExternalAppManifest,
  resolveLocalAppFile,
} from '../external-app-registry'

const registries: ExternalAppRegistry[] = []

afterEach(() => {
  for (const registry of registries.splice(0)) registry.destroy()
})

async function tempAppsRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hxsy-external-apps-'))
}

function manifest(appId: string) {
  return {
    schemaVersion: 1,
    appId,
    title: '测试 App',
    icon: './icon.svg',
    entry: './index.html',
    webTools: [{
      name: 'create_item',
      description: '创建数据',
      inputSchema: { type: 'object' },
      handler: 'createItem',
    }],
  }
}

describe('ExternalAppRegistry', () => {
  it('校验 manifest 必填字段、appId 与 Web Tool', () => {
    const parsed = parseExternalAppManifest(manifest('com.huaxisy.demo'), 'com.huaxisy.demo')
    expect(parsed.webTools?.[0]).toEqual({
      name: 'create_item',
      description: '创建数据',
      inputSchema: { type: 'object' },
      handler: 'createItem',
    })
    expect(() => parseExternalAppManifest(manifest('wrong'), 'com.huaxisy.demo')).toThrow('does not match directory')
    expect(() => parseExternalAppManifest({ ...manifest('com.huaxisy.demo'), schemaVersion: 2 }, 'com.huaxisy.demo')).toThrow('Unsupported')
  })

  it('拒绝 Local App 路径穿越', () => {
    expect(resolveLocalAppFile('/tmp/apps/demo', './index.html')).toBe('/tmp/apps/demo/index.html')
    expect(() => resolveLocalAppFile('/tmp/apps/demo', '../secret')).toThrow('escapes app directory')
    expect(() => resolveLocalAppFile('/tmp/apps/demo', '/etc/passwd')).toThrow('must be relative')
  })

  it('扫描 Local App 并生成 hxsy-app URL', async () => {
    const rootPath = await tempAppsRoot()
    const appDirectory = join(rootPath, 'com.huaxisy.local')
    await mkdir(appDirectory)
    await writeFile(join(appDirectory, 'manifest-hxsy.json'), JSON.stringify(manifest('com.huaxisy.local')))
    await writeFile(join(appDirectory, 'index.html'), '<h1>Local</h1>')
    await writeFile(join(appDirectory, 'icon.svg'), '<svg/>')

    const registry = new ExternalAppRegistry({ rootPath })
    registries.push(registry)
    await registry.initialize()

    expect(registry.list()).toEqual([expect.objectContaining({
      appId: 'com.huaxisy.local',
      sourceType: 'local',
      status: 'ready',
      title: '测试 App',
      entryUrl: 'hxsy-app://com.huaxisy.local/index.html',
      iconUrl: 'hxsy-app://com.huaxisy.local/icon.svg',
    })])
  })

  it('扫描 Builtin App，并阻止用户目录覆盖同 appId', async () => {
    const rootPath = await tempAppsRoot()
    const builtinRootPath = await tempAppsRoot()
    const appId = 'todo-placeholder'
    const builtinDirectory = join(builtinRootPath, appId)
    const userDirectory = join(rootPath, appId)
    await mkdir(builtinDirectory)
    await mkdir(userDirectory)
    await writeFile(join(builtinDirectory, 'manifest-hxsy.json'), JSON.stringify({ ...manifest(appId), title: 'Builtin TODO' }))
    await writeFile(join(builtinDirectory, 'index.html'), '<h1>Builtin</h1>')
    await writeFile(join(builtinDirectory, 'icon.svg'), '<svg/>')
    await writeFile(join(userDirectory, 'manifest-hxsy.json'), JSON.stringify({ ...manifest(appId), title: 'User Override' }))
    await writeFile(join(userDirectory, 'index.html'), '<h1>User</h1>')
    await writeFile(join(userDirectory, 'icon.svg'), '<svg/>')

    const registry = new ExternalAppRegistry({ rootPath, builtinRootPath })
    registries.push(registry)
    await registry.initialize()

    expect(registry.get(appId)).toMatchObject({ sourceType: 'builtin', title: 'Builtin TODO' })
    expect(registry.resolveResourcePath(appId, 'index.html')).toBe(join(builtinDirectory, 'index.html'))
  })

  it('Remote App 先发现占位，首次解析后缓存 manifest、icon、source', async () => {
    const rootPath = await tempAppsRoot()
    const appId = 'com.huaxisy.remote'
    const appDirectory = join(rootPath, appId)
    await mkdir(appDirectory)
    await writeFile(join(appDirectory, 'source.json'), JSON.stringify({
      schemaVersion: 1,
      type: 'remote',
      url: 'https://apps.internal/remote/',
      customField: 'keep-me',
    }))

    const requested: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith('manifest-hxsy.json')) {
        return Response.json(manifest(appId))
      }
      return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })
    }) as typeof fetch
    const registry = new ExternalAppRegistry({ rootPath, fetcher })
    registries.push(registry)
    await registry.initialize()

    expect(registry.get(appId)).toMatchObject({ status: 'discovered', title: '加载中...' })
    const resolved = await registry.resolveRemote(appId)
    expect(resolved).toMatchObject({
      status: 'ready',
      entryUrl: 'https://apps.internal/remote/index.html',
      iconUrl: `hxsy-app://${appId}/icon.svg`,
    })
    expect(requested).toEqual([
      'https://apps.internal/remote/manifest-hxsy.json',
      'https://apps.internal/remote/icon.svg',
    ])
    const source = JSON.parse(await readFile(join(appDirectory, 'source.json'), 'utf8'))
    expect(source.customField).toBe('keep-me')
    expect(source.iconFile).toBe('icon.svg')
    expect(JSON.parse(await readFile(join(appDirectory, 'manifest-hxsy.json'), 'utf8')).appId).toBe(appId)
  })

  it('Remote App 请求失败保留目录并进入 error', async () => {
    const rootPath = await tempAppsRoot()
    const appId = 'com.huaxisy.offline'
    const appDirectory = join(rootPath, appId)
    await mkdir(appDirectory)
    await writeFile(join(appDirectory, 'source.json'), JSON.stringify({ type: 'remote', url: 'https://offline.internal/app/' }))

    const registry = new ExternalAppRegistry({
      rootPath,
      fetcher: (async () => new Response('offline', { status: 503 })) as unknown as typeof fetch,
    })
    registries.push(registry)
    await registry.initialize()
    const resolved = await registry.resolveRemote(appId)

    expect(resolved).toMatchObject({ status: 'error', title: '加载失败' })
    expect(await readFile(join(appDirectory, 'source.json'), 'utf8')).toContain('offline.internal')
  })
})
