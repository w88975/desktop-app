import { describe, expect, it } from 'bun:test'
import {
  installAgentToolsMainWorldBridge,
  type AgentAppBridge,
  type ExternalWebToolResult,
} from '../app-platform'

describe('window.agent.tools main-world bridge', () => {
  it('registers property handlers, invokes them, and returns async results', async () => {
    const fakeWindow = new EventTarget() as EventTarget & { agent: AgentAppBridge }
    const previousWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      value: fakeWindow,
      configurable: true,
      writable: true,
    })

    try {
      installAgentToolsMainWorldBridge()

      let registered = ''
      fakeWindow.addEventListener('hxsy-agent-webtool-registered', event => {
        registered = (event as CustomEvent<string>).detail
      })
      fakeWindow.agent.tools.createTodo = async ({ title }) => ({ id: 'todo-1', title })
      expect(registered).toBe('createTodo')

      const resultPromise = new Promise<ExternalWebToolResult>(resolve => {
        fakeWindow.addEventListener('hxsy-agent-webtool-result', event => {
          resolve(JSON.parse((event as CustomEvent<string>).detail))
        }, { once: true })
      })
      fakeWindow.dispatchEvent(new CustomEvent('hxsy-agent-webtool-invoke', {
        detail: JSON.stringify({
          callId: 'call-1',
          handler: 'createTodo',
          arguments: { title: 'Ship it' },
        }),
      }))

      await expect(resultPromise).resolves.toEqual({
        callId: 'call-1',
        ok: true,
        result: { id: 'todo-1', title: 'Ship it' },
      })
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
        writable: true,
      })
    }
  })
})
