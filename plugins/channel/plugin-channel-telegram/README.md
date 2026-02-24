# @tinyclaw/plugin-channel-telegram

Telegram channel plugin for Tiny Claw.

## Setup

1. Open Telegram and talk to [@BotFather](https://t.me/BotFather)
2. Run `/newbot` and follow the prompts
3. Copy the generated bot token
4. Run Tiny Claw and use `telegram_pair` with the token
5. Run `tinyclaw_restart` to apply changes

## Current Scope (V1)

- Pair and unpair Telegram channel
- Plugin lifecycle scaffolding
- Runtime transport is implemented in follow-up milestones

## Pairing Tools

| Tool | Description |
|------|-------------|
| `telegram_pair` | Store bot token and enable plugin |
| `telegram_unpair` | Disable plugin (token kept in secrets) |

## License

GPLv3
