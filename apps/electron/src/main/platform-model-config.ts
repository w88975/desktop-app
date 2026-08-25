import type { CredentialManager } from '@craft-agent/shared/credentials'
import {
  loadStoredConfig,
  saveConfig,
  type LlmConnection,
  type StoredConfig,
} from '@craft-agent/shared/config'
import type { AuthenticatedRequest, AuthenticatedResponse } from '../shared/auth'

export const PLATFORM_MODEL_CONNECTION_SLUG = 'hxsy-platform'
export const PLATFORM_MODEL_CONFIG_PATH = '/ai-service/api/model_center/openai/config'

interface PlatformModelConfig {
  baseUrl: string
  apiKey: string
  modelPublicIds: string[]
}

interface PlatformModelEnvelope {
  code?: unknown
  message?: unknown
  data?: unknown
}

interface PlatformModelConfigDeps {
  request(input: AuthenticatedRequest): Promise<AuthenticatedResponse>
  credentials: Pick<CredentialManager, 'setLlmApiKey'>
  loadConfig?: () => StoredConfig | null
  saveConfig?: (config: StoredConfig) => void
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`模型服务配置缺少 ${field}`)
  }
  return value.trim()
}

export function parsePlatformModelConfig(response: AuthenticatedResponse): PlatformModelConfig {
  const envelope = response.data as PlatformModelEnvelope | null
  if (!response.ok || !envelope || typeof envelope !== 'object' || envelope.code !== 200) {
    const message = typeof envelope?.message === 'string' && envelope.message.trim()
      ? envelope.message.trim()
      : '获取模型服务配置失败'
    throw new Error(message)
  }

  const data = envelope.data
  if (!data || typeof data !== 'object') throw new Error('模型服务配置响应格式错误')

  const raw = data as Record<string, unknown>
  const modelPublicIds = typeof raw.model_public_ids === 'string'
    ? raw.model_public_ids.split(',').map(id => id.trim()).filter(Boolean)
    : null
  if (!modelPublicIds) throw new Error('模型服务配置缺少 model_public_ids')

  return {
    baseUrl: requiredString(raw.base_url, 'base_url').replace(/\/+$/, ''),
    apiKey: requiredString(raw.api_key, 'api_key'),
    modelPublicIds: [...new Set(modelPublicIds)],
  }
}

function createPlatformConnection(
  modelConfig: PlatformModelConfig,
  existing?: LlmConnection,
): LlmConnection {
  return {
    slug: PLATFORM_MODEL_CONNECTION_SLUG,
    name: existing?.name ?? '华西数医模型服务',
    providerType: 'pi_compat',
    type: 'openai-compat',
    baseUrl: modelConfig.baseUrl,
    authType: 'api_key_with_endpoint',
    models: modelConfig.modelPublicIds,
    defaultModel: modelConfig.modelPublicIds[0],
    piAuthProvider: 'openai',
    customEndpoint: { api: 'openai-completions' },
    createdAt: existing?.createdAt ?? Date.now(),
    lastUsedAt: existing?.lastUsedAt,
  }
}

/** Refresh platform-managed connection without changing user-managed connections/defaults. */
export async function syncPlatformModelConfig(deps: PlatformModelConfigDeps): Promise<void> {
  const response = await deps.request({
    path: PLATFORM_MODEL_CONFIG_PATH,
    method: 'POST',
    body: {},
  })
  const modelConfig = parsePlatformModelConfig(response)
  const loadConfig = deps.loadConfig ?? loadStoredConfig
  const persistConfig = deps.saveConfig ?? saveConfig
  const config = loadConfig() ?? {
    workspaces: [],
    activeWorkspaceId: null,
    activeSessionId: null,
  }
  const connections = config.llmConnections ?? []
  const existingIndex = connections.findIndex(connection => connection.slug === PLATFORM_MODEL_CONNECTION_SLUG)
  const existing = existingIndex >= 0 ? connections[existingIndex] : undefined
  const managedConnection = createPlatformConnection(modelConfig, existing)

  await deps.credentials.setLlmApiKey(PLATFORM_MODEL_CONNECTION_SLUG, modelConfig.apiKey)

  const nextConnections = [...connections]
  if (existingIndex >= 0) nextConnections[existingIndex] = managedConnection
  else nextConnections.push(managedConnection)

  config.llmConnections = nextConnections
  if (connections.length === 0) config.defaultLlmConnection = PLATFORM_MODEL_CONNECTION_SLUG
  persistConfig(config)
}
