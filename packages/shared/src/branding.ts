/**
 * Centralized branding assets for Huaxiaozhu
 * Used by OAuth callback pages
 */

export const HUAXIAOZHU_LOGO = [
  '██  ██ ██   ██  ███  ██ ██  ███  ██████  ██████ ██  ██ ██   ██',
  '██████ ██   ██ ██ ██ ██ ██ ██ ██    ██  ██  ██  ██  ██ ██   ██',
  '██  ██  █████  ██  ████ ██  ████    ██   ██████   ████   █████ ',
] as const;

/** Logo as a single string for HTML templates */
export const HUAXIAOZHU_LOGO_HTML = HUAXIAOZHU_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export const VIEWER_URL = 'https://docs-aiadp.hxsyai.com';
