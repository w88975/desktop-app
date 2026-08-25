import { describe, expect, it } from 'bun:test'
import type { StoredConfig } from '@craft-agent/shared/config'
import {
  PLATFORM_MODEL_CONFIG_PATH,
  PLATFORM_MODEL_CONNECTION_SLUG,
  parsePlatformModelConfig,
  syncPlatformModelConfig,
} from '../platform-model-config'

function response(data: unknown) {
  return { status: 200, ok: true, data }
}

function emptyConfig(): StoredConfig {
  return { workspaces: [], activeWorkspaceId: null, activeSessionId: null }
}

describe('platform model config', () => {
  it('parses, trims, and deduplicates model config', () => {
    expect(parsePlatformModelConfig(response({
      code: 200,
      data: {
        base_url: 'https://gateway.example.com/compatible-mode/',
        api_key: 'sk-secret',
        model_public_ids: 'provider/model-a, provider/model-b,provider/model-a',
      },
    }))).toEqual({
      baseUrl: 'https://gateway.example.com/compatible-mode',
      apiKey: 'sk-secret',
      modelPublicIds: ['provider/model-a', 'provider/model-b'],
    })
  })

  it('creates first platform connection as default and stores key separately', async () => {
    let config = emptyConfig()
    let storedKey: { slug: string; key: string } | undefined

    await syncPlatformModelConfig({
      request: async input => {
        expect(input).toEqual({ path: PLATFORM_MODEL_CONFIG_PATH, method: 'POST', body: {} })
        return response({
          code: 200,
          data: {
            base_url: 'https://gateway.example.com/compatible-mode',
            api_key: 'sk-secret',
            model_public_ids: 'provider/model-a,provider/model-b',
          },
        })
      },
      credentials: {
        setLlmApiKey: async (slug, key) => { storedKey = { slug, key } },
      },
      loadConfig: () => config,
      saveConfig: next => { config = next },
    })

    expect(storedKey).toEqual({ slug: PLATFORM_MODEL_CONNECTION_SLUG, key: 'sk-secret' })
    expect(config.defaultLlmConnection).toBe(PLATFORM_MODEL_CONNECTION_SLUG)
    expect(config.llmConnections?.[0]).toMatchObject({
      slug: PLATFORM_MODEL_CONNECTION_SLUG,
      providerType: 'pi_compat',
      baseUrl: 'https://gateway.example.com/compatible-mode',
      models: ['provider/model-a', 'provider/model-b'],
      defaultModel: 'provider/model-a',
      customEndpoint: { api: 'openai-completions' },
    })
    expect(JSON.stringify(config)).not.toContain('sk-secret')
  })

  it('refreshes only managed connection and preserves selected source', async () => {
    let config: StoredConfig = {
      ...emptyConfig(),
      defaultLlmConnection: 'user-source',
      llmConnections: [
        {
          slug: 'user-source',
          name: 'User source',
          providerType: 'pi_compat',
          authType: 'api_key_with_endpoint',
          baseUrl: 'https://user.example.com/v1',
          customEndpoint: { api: 'openai-completions' },
          models: ['user-model'],
          defaultModel: 'user-model',
          createdAt: 1,
        },
        {
          slug: PLATFORM_MODEL_CONNECTION_SLUG,
          name: 'Custom platform name',
          providerType: 'pi_compat',
          authType: 'api_key_with_endpoint',
          baseUrl: 'https://old.example.com',
          customEndpoint: { api: 'openai-completions' },
          models: ['old-model'],
          defaultModel: 'old-model',
          createdAt: 2,
        },
      ],
    }

    await syncPlatformModelConfig({
      request: async () => response({
        code: 200,
        data: {
          base_url: 'https://new.example.com/compatible-mode',
          api_key: 'sk-new',
          model_public_ids: 'new/model',
        },
      }),
      credentials: { setLlmApiKey: async () => {} },
      loadConfig: () => config,
      saveConfig: next => { config = next },
    })

    expect(config.defaultLlmConnection).toBe('user-source')
    expect(config.llmConnections?.[0]).toMatchObject({
      slug: 'user-source',
      baseUrl: 'https://user.example.com/v1',
      defaultModel: 'user-model',
    })
    expect(config.llmConnections?.[1]).toMatchObject({
      name: 'Custom platform name',
      baseUrl: 'https://new.example.com/compatible-mode',
      models: ['new/model'],
      defaultModel: 'new/model',
      createdAt: 2,
    })
  })

  it('accepts an empty available-model list', async () => {
    let config = emptyConfig()
    await syncPlatformModelConfig({
      request: async () => response({
        code: 200,
        data: {
          base_url: 'https://gateway.example.com/compatible-mode',
          api_key: 'sk-secret',
          model_public_ids: '',
        },
      }),
      credentials: { setLlmApiKey: async () => {} },
      loadConfig: () => config,
      saveConfig: next => { config = next },
    })

    expect(config.llmConnections?.[0]?.models).toEqual([])
    expect(config.llmConnections?.[0]?.defaultModel).toBeUndefined()
  })
})
