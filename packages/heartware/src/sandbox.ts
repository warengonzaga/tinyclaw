/**
 * Heartware Sandbox - Layers 1 & 2 Security
 *
 * Layer 1: Path Sandboxing
 * - Validates all file paths are within heartware directory
 * - Blocks path traversal attacks (../, absolute paths)
 * - Enforces whitelist of allowed files
 *
 * Layer 2: Content Validation
 * - Detects suspicious patterns in file content
 * - Blocks code injection attempts
 * - Validates file sizes
 */

import { resolve, relative, normalize } from 'path';
import { HeartwareSecurityError } from './errors.js';
import type {
  PathValidationResult,
  ContentValidationResult,
  ContentValidationRule
} from './types.js';

/**
 * Whitelist of allowed heartware files
 * CRITICAL: Only these files can be accessed
 */
const ALLOWED_FILES: readonly string[] = [
  'IDENTITY.md',
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'TOOLS.md',
  'MEMORY.md',
  'BOOTSTRAP.md',
  'SHIELD.md',
  'SEED.txt'
] as const;

/**
 * Files that cannot be written to by the agent.
 * These are generated once and remain permanent — like a real soul.
 */
const IMMUTABLE_FILES: readonly string[] = [
  'SOUL.md',
  'SEED.txt'
] as const;

/**
 * Memory file pattern: memory/YYYY-MM-DD.md
 * Allows daily memory logs but blocks other patterns
 */
const MEMORY_FILE_PATTERN = /^memory[\/\\]\d{4}-\d{2}-\d{2}\.md$/;

/**
 * Suspicious content patterns (Layer 2 Security)
 * These patterns indicate potential code injection or security threats
 */
const SUSPICIOUS_PATTERNS: readonly ContentValidationRule[] = [
  {
    pattern: /eval\s*\(/gi,
    severity: 'block',
    description: 'eval() detected - code execution risk'
  },
  {
    pattern: /exec\s*\(/gi,
    severity: 'block',
    description: 'exec() detected - command execution risk'
  },
  {
    pattern: /require\s*\(/gi,
    severity: 'block',
    description: 'require() detected - module loading risk'
  },
  {
    pattern: /import\s+.*from\s+['"`]/gi,
    severity: 'block',
    description: 'import statement detected - module loading risk'
  },
  {
    pattern: /__dirname/gi,
    severity: 'block',
    description: '__dirname access detected - path disclosure risk'
  },
  {
    pattern: /__filename/gi,
    severity: 'block',
    description: '__filename access detected - path disclosure risk'
  },
  {
    pattern: /process\.env/gi,
    severity: 'block',
    description: 'process.env access detected - environment variable risk'
  },
  {
    pattern: /\.\.\/\.\.\//g,
    severity: 'block',
    description: 'Path traversal in content detected'
  },
  {
    pattern: /fs\.readFileSync/gi,
    severity: 'block',
    description: 'File system access detected'
  },
  {
    pattern: /fs\.writeFileSync/gi,
    severity: 'block',
    description: 'File system write detected'
  },
  {
    pattern: /child_process/gi,
    severity: 'block',
    description: 'Child process access detected'
  },
  {
    pattern: /Function\s*\(/gi,
    severity: 'block',
    description: 'Function constructor detected - code execution risk'
  }
] as const;

/**
 * Layer 1: Path Sandboxing
 *
 * Validates that a file path:
 * 1. Resolves to within the heartware directory (no traversal)
 * 2. Is in the whitelist or matches allowed patterns
 * 3. Uses normalized paths (no weird characters)
 * 4. Blocks writes to immutable files (SOUL.md, SEED)
 *
 * @param heartwareDir - Base heartware directory
 * @param requestedPath - Path requested by the agent
 * @param operation - The operation being performed (default: 'read')
 * @throws HeartwareSecurityError if path is invalid or file is immutable
 */
export function validatePath(
  heartwareDir: string,
  requestedPath: string,
  operation: 'read' | 'write' = 'read'
): PathValidationResult {
  // 1. Normalize path (removes .., ., converts slashes)
  const normalized = normalize(requestedPath);

  // 2. Resolve to absolute path
  const resolved = resolve(heartwareDir, normalized);

  // 3. CRITICAL: Ensure resolved path is within heartware directory
  //    This blocks path traversal attacks like ../../../etc/passwd
  if (!resolved.startsWith(heartwareDir)) {
    throw new HeartwareSecurityError(
      'PATH_TRAVERSAL',
      `Path traversal attempt blocked: ${requestedPath}`,
      {
        requestedPath,
        relativePath: normalized
      }
    );
  }

  // 4. Get relative path for whitelist checking
  const relativePath = relative(heartwareDir, resolved);

  // 5. Normalize path separators for cross-platform consistency
  const normalizedRelative = relativePath.replace(/\\/g, '/');

  // 6. Check against whitelist and patterns
  const isAllowedFile = ALLOWED_FILES.includes(normalizedRelative);
  const isMemoryFile = MEMORY_FILE_PATTERN.test(normalizedRelative);

  if (!isAllowedFile && !isMemoryFile) {
    throw new HeartwareSecurityError(
      'INVALID_FILE',
      `File not in whitelist: ${normalizedRelative}`,
      {
        relativePath: normalizedRelative,
        requestedPath
      }
    );
  }

  // 7. CRITICAL: Block writes to immutable files
  if (operation === 'write' && isImmutableFile(normalizedRelative)) {
    throw new HeartwareSecurityError(
      'IMMUTABLE_FILE',
      `Cannot modify immutable file: ${normalizedRelative}. This file is permanently locked.`,
      {
        relativePath: normalizedRelative,
        requestedPath
      }
    );
  }

  return {
    safe: true,
    resolved,
    relativePath: normalizedRelative
  };
}

/**
 * Layer 2: Content Validation
 *
 * Scans content for suspicious patterns that might indicate:
 * - Code injection attempts
 * - Attempts to access system resources
 * - Attempts to execute commands
 *
 * @throws HeartwareSecurityError if content contains blocking patterns
 */
export function validateContent(
  content: string,
  filename: string
): ContentValidationResult {
  const warnings: string[] = [];

  for (const rule of SUSPICIOUS_PATTERNS) {
    if (rule.pattern.test(content)) {
      if (rule.severity === 'block') {
        throw new HeartwareSecurityError(
          'SUSPICIOUS_CONTENT',
          `Blocked suspicious content: ${rule.description}`,
          {
            filename,
            rule: rule.description
          }
        );
      } else {
        warnings.push(`Warning: ${rule.description} in ${filename}`);
      }
    }
  }

  return {
    safe: true,
    warnings
  };
}

/**
 * Validate file size to prevent memory exhaustion
 *
 * @throws HeartwareSecurityError if file size exceeds limit
 */
export function validateFileSize(
  size: number,
  maxSize: number = 1_048_576 // Default: 1MB
): void {
  if (size > maxSize) {
    throw new HeartwareSecurityError(
      'FILE_SIZE_EXCEEDED',
      `File size ${size} bytes exceeds maximum ${maxSize} bytes`,
      {
        size,
        maxSize,
        limitMB: (maxSize / 1_048_576).toFixed(2)
      }
    );
  }
}

/**
 * Check if a file is in the whitelist
 */
export function isAllowedFile(filename: string): boolean {
  return ALLOWED_FILES.includes(filename) || MEMORY_FILE_PATTERN.test(filename);
}

/**
 * Check if a file is immutable (cannot be written to)
 */
export function isImmutableFile(filename: string): boolean {
  return IMMUTABLE_FILES.includes(filename);
}

/**
 * Get list of immutable files
 */
export function getImmutableFiles(): readonly string[] {
  return IMMUTABLE_FILES;
}

/**
 * Get list of allowed files (for documentation/debugging)
 */
export function getAllowedFiles(): readonly string[] {
  return ALLOWED_FILES;
}

/**
 * Get memory file pattern (for documentation/debugging)
 */
export function getMemoryFilePattern(): RegExp {
  return MEMORY_FILE_PATTERN;
}
