/**
 * Feature flags for controlling experimental or in-development features.
 */

/** Safe accessor for process.env — returns undefined in browser/renderer contexts. */
function getEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Shared runtime detector for development/debug environments.
 *
 * Use this instead of app-specific debug flags (e.g., Electron main isDebugMode)
 * so behavior stays consistent across shared code and subprocess backends.
 */
export function isDevRuntime(): boolean {
  const nodeEnv = (getEnv('NODE_ENV') || '').toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'dev' || getEnv('CRAFT_DEBUG') === '1';
}

/**
 * Runtime-evaluated check for developer feedback feature.
 * Explicit env override has precedence over dev-runtime defaults.
 */
export function isDeveloperFeedbackEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_DEVELOPER_FEEDBACK'));
  if (override !== undefined) return override;
  return isDevRuntime();
}

/**
 * Runtime-evaluated check for craft-agents-cli integration.
 *
 * Defaults to disabled. Override with CRAFT_FEATURE_CRAFT_AGENTS_CLI=1|0.
 */
export function isCraftAgentsCliEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_CRAFT_AGENTS_CLI'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Runtime-evaluated check for embedded server settings page.
 *
 * Defaults to disabled. Override with CRAFT_FEATURE_EMBEDDED_SERVER=1|0.
 */
export function isEmbeddedServerEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_EMBEDDED_SERVER'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Runtime-evaluated check for the in-app auto-update pipeline.
 *
 * Disabled: this fork has no release channel of its own, and the upstream feed
 * (agents.craft.do) must never be reached — it would ship Craft Agents builds to
 * our users. Everything stays wired up behind this flag; flip it (or set
 * CRAFT_FEATURE_AUTO_UPDATE=1) once our own update server is in place, after
 * repointing `publish.url` in apps/electron/electron-builder.yml and
 * VERSIONS_URL in packages/shared/src/version/manifest.ts.
 */
export function isAutoUpdateEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_AUTO_UPDATE'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Runtime-evaluated check for publishing sessions to the web viewer.
 *
 * Disabled: "share online" POSTs the full session transcript to the upstream
 * viewer service (agents.craft.do/s/api). We have no viewer deployment of our
 * own, so leaving it on means user conversations leave for a third party.
 * Re-enable only after VIEWER_URL (packages/shared/src/branding.ts) points at
 * our own service.
 */
export function isSessionSharingEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('CRAFT_FEATURE_SESSION_SHARING'));
  if (override !== undefined) return override;
  return false;
}

export const FEATURE_FLAGS = {
  /** Enable Opus 4.7 fast mode (speed:"fast" + beta header). 6x pricing. */
  fastMode: false,
  /**
   * Enable agent developer feedback tool.
   *
   * Defaults to enabled in explicit development runtimes; disabled otherwise.
   * Override with CRAFT_FEATURE_DEVELOPER_FEEDBACK=1|0.
   */
  get developerFeedback(): boolean {
    return isDeveloperFeedbackEnabled();
  },
  /**
   * Enable craft-agent CLI guidance and guardrails.
   *
   * Defaults to disabled. Override with CRAFT_FEATURE_CRAFT_AGENTS_CLI=1|0.
   */
  get craftAgentsCli(): boolean {
    return isCraftAgentsCliEnabled();
  },
  /**
   * Enable embedded server settings page.
   *
   * Defaults to disabled. Override with CRAFT_FEATURE_EMBEDDED_SERVER=1|0.
   */
  get embeddedServer(): boolean {
    return isEmbeddedServerEnabled();
  },
  /**
   * Enable the in-app auto-update pipeline (feed check, download, install).
   *
   * Defaults to disabled — no release channel yet. Override with
   * CRAFT_FEATURE_AUTO_UPDATE=1|0.
   */
  get autoUpdate(): boolean {
    return isAutoUpdateEnabled();
  },
  /**
   * Enable publishing sessions to the web viewer.
   *
   * Defaults to disabled — the viewer endpoint is still upstream's. Override
   * with CRAFT_FEATURE_SESSION_SHARING=1|0.
   */
  get sessionSharing(): boolean {
    return isSessionSharingEnabled();
  },
} as const;
