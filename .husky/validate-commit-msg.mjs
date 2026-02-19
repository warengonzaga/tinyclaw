import { readFileSync } from "fs";

const msgFile = process.argv[2];
const raw = readFileSync(msgFile, "utf8");
const firstLine = raw.replace(/\r/g, "").split("\n")[0].trim();

// Allow merge commits
if (/^Merge /.test(firstLine)) process.exit(0);

// Clean Commit convention pattern
// Format: <emoji> <type>[(<scope>)]: <description>
const pattern =
  /^(📦|🔧|🗑️|🔒|⚙️|☕|🧪|📖|🚀) (new|update|remove|security|setup|chore|test|docs|release)( \([a-z0-9][a-z0-9-]*\))?: .{1,72}$/u;

if (!pattern.test(firstLine)) {
  console.error("");
  console.error("✖ Invalid commit message format.");
  console.error("");
  console.error("  Expected: <emoji> <type>[(<scope>)]: <description>");
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
  console.error("");
  console.error("  Reference: https://github.com/wgtechlabs/clean-commit");
  console.error("");
  process.exit(1);
}
