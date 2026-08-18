/**
 * Documentation links and summaries for contextual help throughout the UI.
 * Summaries provide quick context; "Learn more" opens the full docs.
 */

/**
 * Documentation site root. Single source of truth for every in-app doc link —
 * do not hardcode doc URLs anywhere else.
 */
export const DOCS_HOME = 'https://docs-aiadp.hxsyai.com/'

/**
 * Whether the docs site serves the per-feature deep paths declared in `DOCS`.
 *
 * The site currently only has a landing page, so every link resolves to
 * `DOCS_HOME`. The `path` values below are kept intact: once the site ships
 * these routes, flip this to `true` and deep links start working — no other
 * change needed.
 */
const DOCS_DEEP_LINKS_ENABLED = false

export type DocFeature =
  | 'sources'
  | 'sources-api'
  | 'sources-mcp'
  | 'sources-local'
  | 'skills'
  | 'statuses'
  | 'permissions'
  | 'labels'
  | 'workspaces'
  | 'themes'
  | 'app-settings'
  | 'preferences'
  | 'automations'
  | 'messaging'
  | 'sharing'

export interface DocInfo {
  /** Path relative to DOC_BASE_URL */
  path: string
  /** Display title for the help popover */
  title: string
  /** 1-2 sentence summary for quick context */
  summary: string
}

export const DOCS: Record<DocFeature, DocInfo> = {
  sources: {
    path: '/sources/overview',
    title: 'Sources',
    summary:
      'Connect external data like MCP servers, REST APIs, and local filesystems. Sources give your agent tools to access services like GitHub, Linear, or your Obsidian vault.',
  },
  'sources-api': {
    path: '/sources/apis/overview',
    title: 'APIs',
    summary:
      'Connect to any REST API with flexible authentication. Make HTTP requests to external services directly from your conversations.',
  },
  'sources-mcp': {
    path: '/sources/mcp-servers/overview',
    title: 'MCP Servers',
    summary:
      'Connect to Model Context Protocol servers for rich tool integrations. MCP servers provide structured access to services like GitHub, Linear, and Notion.',
  },
  'sources-local': {
    path: '/sources/local-filesystems',
    title: 'Local Folders',
    summary:
      'Give your agent access to local directories like Obsidian vaults, code repositories, or data folders on your machine.',
  },
  skills: {
    path: '/skills/overview',
    title: 'Skills',
    summary:
      'Reusable instruction sets that teach your agent specialized behaviors. Create a SKILL.md file and invoke it with @mention in your messages.',
  },
  statuses: {
    path: '/statuses/overview',
    title: 'Statuses',
    summary:
      'Organize conversations into workflow states like Todo, In Progress, and Done. Open statuses appear in your inbox; closed ones move to the archive.',
  },
  permissions: {
    path: '/core-concepts/permissions',
    title: 'Permissions',
    summary:
      'Control how much autonomy your agent has. Explore mode is read-only, Ask to Edit prompts before changes, and Execute mode runs without prompts.',
  },
  labels: {
    path: '/labels/overview',
    title: 'Labels',
    summary:
      'Tag sessions with colored labels for organization and filtering. Labels support hierarchical nesting, typed values, and auto-apply rules that extract data from messages using regex patterns.',
  },
  workspaces: {
    path: '/go-further/workspaces',
    title: 'Workspaces',
    summary:
      'Separate configurations for different contexts like personal projects or work. Each workspace has its own sources, skills, statuses, and session history.',
  },
  themes: {
    path: '/go-further/themes',
    title: 'Themes',
    summary:
      'Customize the visual appearance with a 6-color system. Override specific colors in theme.json or install preset themes for complete visual styles.',
  },
  'app-settings': {
    path: '/reference/config/config-file',
    title: 'App Settings',
    summary:
      'Configure global app settings like your default model, authentication method, and workspace list. Settings are stored in ~/.craft-agent/config.json.',
  },
  preferences: {
    path: '/reference/config/preferences',
    title: 'Preferences',
    summary:
      'Personal preferences like your name, timezone, and language that help the agent personalize responses. Stored in ~/.craft-agent/preferences.json.',
  },
  automations: {
    path: '/automations/overview',
    title: 'Automations',
    summary:
      'Automate actions when events occur — run commands on schedules, react to label changes, or trigger prompts. Configured in automations.json.',
  },
  messaging: {
    path: '/messaging/overview',
    title: 'Messaging',
    summary:
      'Connect a session to a chat platform — Telegram, WhatsApp, or Lark / Feishu — and reach your agent from anywhere. Pair workspace supergroups, route automations to forum topics, and send rich replies natively.',
  },
  sharing: {
    path: '/go-further/sharing',
    title: 'Sharing',
    summary:
      'Publish a read-only snapshot of a session so others can follow along. Shared links stay in sync until you stop sharing.',
  },
}

/**
 * Get the full documentation URL for a feature.
 *
 * Falls back to the docs home page while `DOCS_DEEP_LINKS_ENABLED` is off.
 */
export function getDocUrl(feature: DocFeature): string {
  if (!DOCS_DEEP_LINKS_ENABLED) return DOCS_HOME
  return `${DOCS_HOME.replace(/\/$/, '')}${DOCS[feature].path}`
}

/**
 * Get the doc info (title, summary, path) for a feature
 */
export function getDocInfo(feature: DocFeature): DocInfo {
  return DOCS[feature]
}
