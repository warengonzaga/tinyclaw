# Contributing to Tiny Claw 🐜

Thanks for your interest in contributing to Tiny Claw! Every contribution - code, docs, bug reports, or ideas - helps make AI companions more accessible to everyone.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## Contributor License Agreement (CLA)

By submitting a pull request, you agree to our [Contributor License Agreement](CLA.md). The CLA is required because Tiny Claw uses a **dual-licensing** model (GPL-3.0 + Commercial). First-time contributors will be prompted to sign the CLA automatically via [CLA Assistant](https://cla-assistant.io/) when opening a PR.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (latest stable)
- [Git](https://git-scm.com/)
- A [GitHub](https://github.com/) account

### Fork & Clone

```bash
# Fork the repo on GitHub first, then:
git clone https://github.com/YOUR_USERNAME/tinyclaw.git
cd tinyclaw
git remote add upstream https://github.com/warengonzaga/tinyclaw.git
bun install
```

### Run in Development

```bash
bun dev        # Start the CLI in development mode
bun dev:ui     # Start the web UI in development mode
bun build      # Build all packages
bun test       # Run the full test suite
```

## Project Structure

Tiny Claw is a **Bun workspace monorepo**. The core stays tiny - everything else is a plugin.

```
tinyclaw/
  packages/        Core library packages (tiny, focused, no circular deps)
  plugins/         Plugin packages (channels, providers, tools)
  src/cli/         CLI entry point
  src/web/         Web UI (Svelte 5)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture overview.

## Development Workflow

1. **Create an issue first** - describe what you want to work on before writing code.
2. **Sync with upstream** - keep your fork current:
   ```bash
   git fetch upstream && git merge upstream/dev
   ```
3. **Create a branch** from `dev` using one of these prefixes:
   - `feature/*` - new functionality
   - `fix/*` - bug fixes
   - `docs/*` - documentation changes
   - `refactor/*` - code restructuring without behavior changes
4. **Make your changes** - write code, add tests, update docs as needed.
5. **Verify locally**:
   ```bash
   bun build     # Ensure it compiles
   bun test      # Ensure tests pass
   ```
6. **Submit a PR** targeting the **`dev`** branch (never `main`).

## Commit Convention

This project follows the **[Clean Commit](https://github.com/wgtechlabs/clean-commit)** convention. See [AGENTS.md](AGENTS.md) for the full type reference.

| Emoji | Type | What it covers |
|:-----:|------|----------------|
| 📦 | `new` | Adding new features, files, or capabilities |
| 🔧 | `update` | Changing existing code, refactoring, improvements |
| 🗑️ | `remove` | Removing code, files, features, or dependencies |
| 🔒 | `security` | Security fixes, patches, vulnerability resolutions |
| ⚙️ | `setup` | Project configs, CI/CD, tooling, build systems |
| ☕ | `chore` | Maintenance tasks, dependency updates, housekeeping |
| 🧪 | `test` | Adding, updating, or fixing tests |
| 📖 | `docs` | Documentation changes and updates |
| 🚀 | `release` | Version releases and release preparation |

**Examples:**

```
📦 new (core): add conversation memory system
🔧 update (api): improve error handling
🧪 test (memory): add unit tests for temporal decay
📖 docs: update installation instructions
```

**Rules:** lowercase type, present tense, no trailing period, under 72 characters.

## Pull Request Guidelines

### Before Submitting

- [ ] An issue exists and is referenced in the PR description (e.g., `Closes #42`)
- [ ] PR targets the **`dev`** branch
- [ ] All commits follow the [Clean Commit](https://github.com/wgtechlabs/clean-commit) convention
- [ ] Code builds successfully (`bun build`)
- [ ] Tests pass (`bun test`)
- [ ] Documentation is updated (if applicable)
- [ ] CLA is signed

### PR Description

Include a clear summary of what changed and why. Reference the issue number. If the change is visual, include screenshots or recordings.

### Review Process

- A maintainer will review your PR and may request changes.
- Please respond to feedback promptly - stale PRs may be closed after 30 days of inactivity.
- Once approved, a maintainer will merge your PR.

## Writing Tests

Tests live in `tests/` directories alongside each package's `src/`. We use [Bun's built-in test runner](https://bun.sh/docs/cli/test).

```bash
bun test                          # Run all tests
bun test packages/memory          # Run tests for a specific package
bun test --watch                  # Run in watch mode
```

When contributing code, please:

- Add tests for new features and bug fixes.
- Keep tests focused - one behavior per test.
- Use descriptive test names that explain *what* is being tested.

## Code Style

- Use **TypeScript** with strong typing - avoid `any`.
- Follow existing patterns and conventions in the codebase.
- Keep functions small and focused with meaningful names.
- Handle errors gracefully - don't swallow exceptions silently.
- No circular dependencies between packages.

## Reporting Bugs

[Open a new issue](https://github.com/warengonzaga/tinyclaw/issues/new/choose) and include:

- A clear, descriptive title.
- Steps to reproduce the issue.
- Expected vs. actual behavior.
- Your environment (OS, Bun version, Node version if applicable).
- Relevant logs or error messages.

Please search [existing issues](https://github.com/warengonzaga/tinyclaw/issues) first to avoid duplicates.

## Suggesting Features

Feature ideas are welcome! [Open an issue](https://github.com/warengonzaga/tinyclaw/issues/new/choose) with:

- A clear description of the problem the feature solves.
- Your proposed solution or approach.
- Any alternatives you've considered.

## Getting Help

- Check the [docs/](docs/) folder for architecture and design documentation.
- Browse [existing issues](https://github.com/warengonzaga/tinyclaw/issues) and [discussions](https://github.com/warengonzaga/tinyclaw/discussions).
- Follow [@TinyClawAI](https://x.com/TinyClawAI) and [@warengonzaga](https://x.com/warengonzaga) on X for updates.

---

💻💖☕ Made with ❤️ by the Tiny Claw community
