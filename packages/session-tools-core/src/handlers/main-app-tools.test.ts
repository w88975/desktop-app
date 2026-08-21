import { describe, expect, it } from 'bun:test';
import type { SessionToolContext } from '../context.ts';
import {
  handleMainAppCloseTab,
  handleMainAppListTabs,
  handleMainAppSwitchTab,
} from './main-app-tools.ts';

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

const tabs = {
  activeTarget: 'agent',
  tabs: [
    { target: 'home', kind: 'home' as const, title: 'Home', active: false, closable: false },
    { target: 'agent', kind: 'agent' as const, title: 'Agent', active: true, closable: false },
  ],
};

describe('main App session tools', () => {
  it('lists, switches, and closes through host callbacks', async () => {
    const ctx = context({
      listMainAppTabs: async () => tabs,
      switchMainAppTab: async target => ({ action: 'switched', target, tab: tabs.tabs[0]!, state: tabs }),
      closeMainAppTab: async target => ({ action: 'closed', target, tab: tabs.tabs[0]!, state: tabs }),
    });

    expect((await handleMainAppListTabs(ctx, {})).content[0].text).toContain('activeTarget');
    expect((await handleMainAppSwitchTab(ctx, { target: 'home' })).content[0].text).toContain('switched');
    expect((await handleMainAppCloseTab(ctx, { target: 'tab-1' })).content[0].text).toContain('closed');
  });

  it('fails clearly outside desktop host', async () => {
    const result = await handleMainAppListTabs(context(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('desktop app');
  });
});
