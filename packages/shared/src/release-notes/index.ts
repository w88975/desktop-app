/**
 * Release Notes Utilities
 *
 * Loads release notes from bundled assets and syncs them to ~/.craft-agent/release-notes/.
 * Follows the same pattern as docs/index.ts.
 *
 * Source content lives in apps/electron/resources/release-notes/*.md.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';

const CONFIG_DIR = join(homedir(), '.craft-agent');
const RELEASE_NOTES_DIR = join(CONFIG_DIR, 'release-notes');

let releaseNotesInitialized = false;

function getAssetsDir(): string {
  return getBundledAssetsDir('release-notes')
    ?? join(process.cwd(), 'resources', 'release-notes');
}

/**
 * Load bundled release notes from asset files.
 * Returns { filename → content } map.
 */
function loadBundledReleaseNotes(): Record<string, string> {
  const assetsDir = getAssetsDir();
  const notes: Record<string, string> = {};

  // Try bundled assets first, fall back to ~/.craft-agent/release-notes/
  // (Docker/remote server may not have CRAFT_BUNDLED_ASSETS_ROOT set,
  // but initializeReleaseNotes() copies files to the config dir at startup)
  let dir = assetsDir;
  if (!existsSync(dir)) {
    dir = RELEASE_NOTES_DIR;
  }

  let files: string[];
  try {
    files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')) : [];
  } catch {
    console.warn(`[release-notes] Could not read release notes dir: ${dir}`);
    return notes;
  }

  for (const filename of files) {
    const filePath = join(dir, filename);
    try {
      notes[filename] = readFileSync(filePath, 'utf-8');
    } catch (error) {
      console.error(`[release-notes] Failed to load ${filename}:`, error);
    }
  }

  return notes;
}

let _bundledNotes: Record<string, string> | null = null;

function getBundledReleaseNotes(): Record<string, string> {
  if (_bundledNotes === null) {
    _bundledNotes = loadBundledReleaseNotes();
  }
  return _bundledNotes;
}

/**
 * Initialize release notes directory with bundled content.
 * Call at app startup alongside initializeDocs().
 */
export function initializeReleaseNotes(): void {
  if (releaseNotesInitialized) return;
  releaseNotesInitialized = true;

  if (!existsSync(RELEASE_NOTES_DIR)) {
    mkdirSync(RELEASE_NOTES_DIR, { recursive: true });
  }

  const bundledNotes = getBundledReleaseNotes();
  for (const [filename, content] of Object.entries(bundledNotes)) {
    const notePath = join(RELEASE_NOTES_DIR, filename);
    writeFileSync(notePath, content, 'utf-8');
  }

  // Drop notes the bundle no longer ships. Without this the sync is
  // append-only, so notes from a previous install linger forever — they keep
  // showing up in the release notes panel and, because the "unseen" check
  // compares against the newest file on disk, leave the badge permanently lit.
  // Only this directory's own .md files are touched; it is app-managed.
  let stale = 0;
  try {
    for (const filename of readdirSync(RELEASE_NOTES_DIR)) {
      if (!filename.endsWith('.md')) continue;
      if (filename in bundledNotes) continue;
      unlinkSync(join(RELEASE_NOTES_DIR, filename));
      stale++;
    }
  } catch (error) {
    debug(`[release-notes] Could not prune stale notes: ${error}`);
  }

  debug(`[release-notes] Synced ${Object.keys(bundledNotes).length} release notes, pruned ${stale}`);
}

/**
 * Parse version from filename (e.g., "0.4.1.md" → "0.4.1").
 */
function parseVersion(filename: string): string {
  return filename.replace(/\.md$/, '');
}

/**
 * Compare semver strings for sorting (descending — newest first).
 */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
}

/** Maximum number of release notes to display in the UI. */
const MAX_DISPLAY_NOTES = 10;

export interface ReleaseNote {
  version: string;
  content: string;
}

/** Only `X.Y.Z.md` files are released notes; `next.md` is an authoring buffer. */
const VERSION_FILENAME = /^\d+\.\d+\.\d+\.md$/;

/**
 * Get release notes sorted newest-first, limited to the most recent 10.
 *
 * Non-version files are filtered out. Letting `next.md` through makes
 * `compareSemver` return NaN for every comparison against it, which leaves the
 * sort order undefined — and `getLatestReleaseVersion()` could then report
 * "next" as the current version.
 */
export function getReleaseNotesList(): ReleaseNote[] {
  const notes = getBundledReleaseNotes();
  return Object.entries(notes)
    .filter(([filename]) => VERSION_FILENAME.test(filename))
    .map(([filename, content]) => ({
      version: parseVersion(filename),
      content,
    }))
    .sort((a, b) => compareSemver(a.version, b.version))
    .slice(0, MAX_DISPLAY_NOTES);
}

/**
 * Get the latest release note version string.
 */
export function getLatestReleaseVersion(): string | undefined {
  const list = getReleaseNotesList();
  return list[0]?.version;
}

/**
 * Get all release notes combined into a single markdown string.
 * Each version is separated by a horizontal rule.
 */
export function getCombinedReleaseNotes(): string {
  const list = getReleaseNotesList();
  return list.map(n => {
    // Auto-inject version header if the content doesn't start with one
    if (!n.content.trimStart().startsWith('# ')) {
      return `# v${n.version}\n\n${n.content}`;
    }
    return n.content;
  }).join('\n\n---\n\n');
}
