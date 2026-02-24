/**
 * TUI Banner
 *
 * ASCII art logo and version display for Tiny Claw CLI.
 * Uses figlet with ANSI Shadow font for a modern look.
 * Displayed at the top of setup wizard and help output.
 */

import figlet from 'figlet';
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

// Generate the logo at module load time (synchronous, fast)
let LOGO: string;
try {
  LOGO = figlet.textSync('Tiny Claw', { font: 'ANSI Shadow' });
} catch {
  // Fallback if figlet font not available
  LOGO =
    `████████╗██╗███╗   ██╗██╗   ██╗ ██████╗██╗      █████╗ ██╗    ██╗\n` +
    `╚══██╔══╝██║████╗  ██║╚██╗ ██╔╝██╔════╝██║     ██╔══██╗██║    ██║\n` +
    `   ██║   ██║██╔██╗ ██║ ╚████╔╝ ██║     ██║     ███████║██║ █╗ ██║\n` +
    `   ██║   ██║██║╚██╗██║  ╚██╔╝  ██║     ██║     ██╔══██║██║███╗██║\n` +
    `   ██║   ██║██║ ╚████║   ██║   ╚██████╗███████╗██║  ██║╚███╔███╔╝\n` +
    `   ╚═╝   ╚═╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝`;
}

/**
 * Print the branded banner to stdout
 */
export function showBanner(): void {
  console.log(theme.brand(`\n${LOGO}`));
  console.log(
    `  ${theme.dim(`v${getVersion()}`)} ${theme.dim('—')} ${theme.dim('Your Personal Autonomous AI Companion 🐜')}`,
  );
  console.log(
    `  ${theme.dim('The original Tiny Claw — an alternative to OpenClaw, written from scratch 🐜')}`,
  );
  console.log();
}

/**
 * Get the version string
 */
export { getVersion };
