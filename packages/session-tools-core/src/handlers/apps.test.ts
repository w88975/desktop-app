import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import { handleCallWebTool, handleCloseApp, handleListApps, handleOpenApp } from './apps.ts';

function context(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    sessionId: 'session-1',
    workspacePath: '/tmp/workspace',
    sourcesPath: '/tmp/workspace/sources',
    skillsPath: '/tmp/workspace/skills',
    plansFolderPath: '/tmp/workspace/plans',
    callbacks: { onPlanSubmitted: () => {}, onAuthRequest: () => {} },
    fs: {} as SessionToolContext['fs'],
    loadSourceConfig: () => null,
    ...overrides,
  };
}

describe('app session tools', () => {
  it('supports discovery, open, call, result, and close flow', async () => {
    const ctx = context({
      listApps: async () => [{
        appId: 'todo', title: 'TODO', kind: 'built-in', status: 'ready',
        functions: [{
          name: 'create_todo', description: 'Create todo', handler: 'createTodo',
          inputSchema: { type: 'object' },
        }],
      }],
      openApp: async appId => ({ appId, tabId: 'tab-1', status: 'opened' }),
      callWebTool: async (_appId, _functionName, args) => ({ created: args.title }),
      closeApp: async appId => ({ appId, tabId: 'tab-1', status: 'closed' }),
    });

    expect((await handleListApps(ctx, {})).content[0].text).toContain('create_todo');
    expect((await handleOpenApp(ctx, { appId: 'todo' })).content[0].text).toContain('"status": "opened"');
    const called = await handleCallWebTool(ctx, {
      appId: 'todo', functionName: 'create_todo', arguments: { title: 'Ship it' },
    });
    expect(called.isError).toBe(false);
    expect(called.structuredContent).toEqual({ created: 'Ship it' });
    expect((await handleCloseApp(ctx, { appId: 'todo' })).content[0].text).toContain('"status": "closed"');
  });

  it('fails clearly outside desktop host', async () => {
    const result = await handleCallWebTool(context(), {
      appId: 'todo', functionName: 'create_todo', arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('desktop app');
  });
});
