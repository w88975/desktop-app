import { debug } from "../utils/debug";
import { FEATURE_FLAGS } from "../feature-flags";

/**
 * Subprocess binary manifest feed. Still points at upstream and is therefore
 * gated behind FEATURE_FLAGS.autoUpdate — repoint this before enabling.
 */
const VERSIONS_URL = 'https://agents.craft.do/electron';

export async function getLatestVersion(): Promise<string | null> {
    if (!FEATURE_FLAGS.autoUpdate) {
      debug('[manifest] Auto-update disabled — not contacting the version feed');
      return null;
    }
    try {
      const response = await fetch(`${VERSIONS_URL}/latest`);
      const data = await response.json();
      const version = (data as { version?: string }).version;
      if (typeof version !== 'string') {
        debug('[manifest] Latest version is not a valid string');
        return null;
      }
      return version ?? null;
    } catch (error) {
      debug(`[manifest] Failed to get latest version: ${error}`);
    }
    return null;
}

export async function getManifest(version: string): Promise<VersionManifest | null> {
    if (!FEATURE_FLAGS.autoUpdate) {
      debug('[manifest] Auto-update disabled — not contacting the version feed');
      return null;
    }
    try {
        const url = `${VERSIONS_URL}/${version}/manifest.json`;
        debug(`[manifest] Getting manifest for version: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        return data as VersionManifest;
    } catch (error) {
        debug(`[manifest] Failed to get manifest: ${error}`);
    }
    return null;
}


export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  filename?: string;
}

export interface VersionManifest {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, BinaryInfo>;
}
