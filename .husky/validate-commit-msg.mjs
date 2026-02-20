import { readFileSync } from "fs";

const msgFile = process.argv[2];
if (!msgFile) {
  console.error("Error: No commit message file path provided.");
  process.exit(1);
}
let raw;
try {
  raw = readFileSync(msgFile, "utf8");
} catch (err) {
  console.error(
    `Error: Could not read commit message file "${msgFile}": ${err.message}`,
  );
  process.exit(1);
}
const firstLine = raw.replace(/\r/g, "").split("\n")[0].trim();

// Allow merge and revert commits
if (/^Merge /.test(firstLine) || /^Revert /.test(firstLine)) process.exit(0);

// Clean Commit convention pattern
// Format: <emoji> <type>[!][(<scope>)]: <description>
const pattern =
  /^(📦|🔧|🗑\uFE0F?|🔒|⚙\uFE0F?|☕|🧪|📖|🚀) (new|update|remove|security|setup|chore|test|docs|release)(!?)( \([a-z0-9][a-z0-9-]*\))?: .{1,72}$/u;

// Only new, update, remove, security may use the breaking change marker
const breakingMatch = firstLine.match(pattern);
if (breakingMatch) {
  const type = breakingMatch[2];
  const bang = breakingMatch[3];
  if (bang === '!' && !['new', 'update', 'remove', 'security'].includes(type)) {
    console.error('');
    console.error('✖ Breaking change marker (!) is only allowed for: new, update, remove, security');
    console.error('');
    process.exit(1);
  }
}

if (!pattern.test(firstLine)) {
  console.error("");
  console.error("✖ Invalid commit message format.");
  console.error("");
  console.error("  Expected: <emoji> <type>[!][(<scope>)]: <description>");
  console.error("");
  console.error("  Use ! after type for breaking changes (new, update, remove, security only)");
  console.error("");
  console.error("  Types and emojis:");
  console.error("    📦 new      – new features, files, or capabilities");
  console.error("    🔧 update   – changes, refactoring, improvements");
  console.error("    🗑️  remove   – removing code, files, or dependencies");
  console.error("    🔒 security – security fixes or patches");
  console.error("    ⚙️  setup    – configs, CI/CD, tooling, build systems");
  console.error("    ☕ chore    – maintenance, dependency updates");
  console.error("    🧪 test     – adding or updating tests");
  console.error("    📖 docs     – documentation changes");
  console.error("    🚀 release  – version releases");
  console.error("");
  console.error("  Examples:");
  console.error("    📦 new: user authentication system");
  console.error("    🔧 update (api): improve error handling");
  console.error("    ⚙️  setup (ci): configure github actions workflow");
  console.error("    📦 new!: completely redesign authentication system");
  console.error("    🔧 update! (api): change response format for all endpoints");
  console.error("");
  console.error("  Reference: https://github.com/wgtechlabs/clean-commit");
  console.error("");
  process.exit(1);
}
