# @tinyclaw/plugin-channel-telegram

Telegram channel plugin for Tiny Claw. It connects a Telegram bot to the agent using the official Bot API over long polling.

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather)
2. Copy the bot token
3. Run Tiny Claw and ask it to pair the Telegram channel
4. Provide the token when prompted
5. Call `tinyclaw_restart` to connect the bot

## How It Works

- Listens for private chats and `@botname` mentions in groups
- Routes messages through the agent loop as `telegram:<user-id>`
- Splits long responses to respect Telegram's message size limit
- Supports outbound proactive messages to users who have already started a private chat with the bot

## Pairing Tools

| Tool | Description |
|------|-------------|
| `telegram_pair` | Store a bot token and enable the plugin |
| `telegram_unpair` | Disable the plugin (token kept in secrets) |

## License

GPLv3
