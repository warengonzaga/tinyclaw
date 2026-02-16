# Contributing to Tiny Claw 🐜

Thanks for contributing! Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## Getting Started

**Prerequisites:** [Bun](https://bun.sh/), Git, GitHub account

```bash
git clone https://github.com/YOUR_USERNAME/tinyclaw.git
cd tinyclaw
git remote add upstream https://github.com/warengonzaga/tinyclaw.git
bun install
bun dev
```

## Development Workflow

1. **Create an issue first** before starting any work
2. Sync with upstream: `git fetch upstream && git merge upstream/dev`
3. Branch from `dev` using `feature/*`, `fix/*`, `docs/*`, or `refactor/*` prefixes
4. Make changes, then verify with `bun build`
5. Submit a PR targeting the `dev` branch (not `main`)

## Commit Convention

This project follows the **[Clean Commit](https://github.com/wgtechlabs/clean-commit)** convention. See [AGENTS.md](AGENTS.md) for the full type reference.

```
📦 new (core): add conversation memory system
🔧 update (api): improve error handling
📖 docs: update installation instructions
```

**Rules:** lowercase type, present tense, no trailing period, under 72 characters.

## Pull Request Checklist

- [ ] Issue exists and is referenced
- [ ] PR targets `dev` branch
- [ ] Commits follow Clean Commit convention
- [ ] Code builds successfully (`bun build`)
- [ ] Tests pass and docs updated (if applicable)

## Code Style

- Use **TypeScript** with strong typing
- Follow existing patterns in the codebase
- Keep functions small, names meaningful, errors handled gracefully

---

💻💖☕ Made with ❤️ by the Tiny Claw community
