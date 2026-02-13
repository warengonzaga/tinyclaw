/**
 * TUI Theme
 *
 * Shared colors and styling constants for the TinyClaw CLI.
 * Uses picocolors for zero-dep, fast terminal color output.
 */

import pc from 'picocolors';

export const theme = {
  /** Brand color — used for the logo and key highlights */
  brand: (text: string) => pc.cyan(text),
  /** Success messages */
  success: (text: string) => pc.green(text),
  /** Warning messages */
  warn: (text: string) => pc.yellow(text),
  /** Error messages */
  error: (text: string) => pc.red(text),
  /** Muted / secondary text */
  dim: (text: string) => pc.dim(text),
  /** Bold text */
  bold: (text: string) => pc.bold(text),
  /** Command references in help text */
  cmd: (text: string) => pc.bold(pc.cyan(text)),
  /** Key/value label */
  label: (text: string) => pc.bold(pc.white(text)),
} as const;
