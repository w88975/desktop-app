import { protocol, session, type Session } from 'electron'
import { readFile } from 'fs/promises'
import type { ExternalAppRegistry } from './external-app-registry'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function registerExternalAppScheme(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'hxsy-app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }])
}

const registeredSessions = new WeakSet<Session>()

function createExternalAppProtocolHandler(registry: ExternalAppRegistry) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const appId = url.hostname
      if (!registry.get(appId)) return new Response('Unknown App', { status: 404 })
      const relativePath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
      if (!relativePath) return new Response('Missing path', { status: 404 })
      const filePath = registry.resolveResourcePath(appId, relativePath)
      const body = await readFile(filePath)
      const extension = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': MIME_TYPES[extension] ?? 'application/octet-stream',
          'cache-control': 'no-cache',
        },
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return new Response('Not Found', { status: 404 })
      return new Response('Invalid App resource', { status: 400 })
    }
  }
}

export function registerExternalAppProtocolForSession(
  targetSession: Session,
  registry: ExternalAppRegistry
): void {
  if (registeredSessions.has(targetSession)) return
  targetSession.protocol.handle('hxsy-app', createExternalAppProtocolHandler(registry))
  registeredSessions.add(targetSession)
}

export function registerExternalAppProtocol(registry: ExternalAppRegistry): void {
  registerExternalAppProtocolForSession(session.defaultSession, registry)
}
