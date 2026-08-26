import { describe, expect, it } from 'bun:test'
import { BrowserToolSchema, getToolDefsAsJsonSchema } from './tool-defs'

describe('BrowserToolSchema compatibility', () => {
  it('accepts command and deprecated _command alias', () => {
    expect(BrowserToolSchema.parse({ command: 'snapshot' })).toEqual({ command: 'snapshot' })
    expect(BrowserToolSchema.parse({ _command: 'click @e1' })).toEqual({ _command: 'click @e1' })
  })

  it('publishes both fields to proxy consumers', () => {
    const definition = getToolDefsAsJsonSchema({ prefix: 'mcp__session__' })
      .find(tool => tool.name === 'mcp__session__browser_tool')
    expect(definition?.inputSchema).toMatchObject({
      properties: {
        command: expect.any(Object),
        _command: expect.any(Object),
      },
    })
  })
})
