/**
 * Built-in model constants — single source of truth.
 *
 * Every package that needs a model name or the list of supported models
 * should import from here so there is exactly ONE place to update when
 * models change.
 */

// ---------------------------------------------------------------------------
// Default model — used when no persisted config exists yet
// ---------------------------------------------------------------------------

/** The primary / recommended built-in model tag. */
export const DEFAULT_MODEL = 'kimi-k2.5:cloud' as const;

/** The default Ollama Cloud base URL. */
export const DEFAULT_BASE_URL = 'https://ollama.com' as const;

/** The default provider identifier. */
export const DEFAULT_PROVIDER = 'ollama' as const;

// ---------------------------------------------------------------------------
// Built-in model catalogue
// ---------------------------------------------------------------------------

/**
 * Every model shipped as a built-in option on Ollama Cloud.
 * Order matters — the first entry is treated as the recommended default
 * in the setup wizard and elsewhere.
 */
export const BUILTIN_MODELS = [
  {
    value: 'kimi-k2.5:cloud',
    label: 'kimi-k2.5:cloud',
    hint: 'recommended — best for conversation, reasoning, and multimodal tasks',
  },
  {
    value: 'gpt-oss:120b-cloud',
    label: 'gpt-oss:120b-cloud',
    hint: 'best for structured tasks, coding, and admin operations',
  },
] as const;

/** Just the model tag strings, useful for validation / enum checks. */
export const BUILTIN_MODEL_TAGS = BUILTIN_MODELS.map((m) => m.value) as unknown as readonly [
  'kimi-k2.5:cloud',
  'gpt-oss:120b-cloud',
];

/** Union type of all built-in model tags. */
export type BuiltinModelTag = (typeof BUILTIN_MODEL_TAGS)[number];
