/**
 * TUI Banner
 *
 * ASCII art logo and version display for TinyClaw CLI.
 * Displayed at the top of setup wizard and help output.
 */

import { theme } from './theme.js';

// version is read lazily to avoid import issues with JSON modules
let cachedVersion: string | undefined;

function getVersion(): string {
  if (!cachedVersion) {
    // Bun supports JSON import; fallback to unknown
    try {
      // Use require for JSON in Bun
      const pkg = require('../../package.json');
      cachedVersion = pkg.version ?? 'unknown';
    } catch {
      cachedVersion = 'unknown';
    }
  }
  return cachedVersion!;
}

const LOGO = `
  _____ _             ____ _               
 |_   _(_)_ __  _   _/ ___| | __ ___      __
   | | | | '_ \\| | | | |   | |/ _\` \\ \\ /\\ / /
   | | | | | | | |_| | |___| | (_| |\\ V  V / 
   |_| |_|_| |_|\\__, |\\____|_|\\__,_| \\_/\\_/  
                 |___/                        `;

/**
 * Print the branded banner to stdout
 */
export function showBanner(): void {
  console.log(theme.brand(LOGO));
  console.log(
    `  ${theme.dim('v' + getVersion())} ${theme.dim('—')} ${theme.dim('Small agent, mighty friend')}`
  );
  console.log();
}

/**
 * Get the version string
 */
export { getVersion };
