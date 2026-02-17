# @tinyclaw/plugin-channel-discord

Discord channel plugin for Tiny Claw. Connects a Discord bot to the agent, enabling conversations via Direct Messages and @mentions in guild channels.

## Setup

1. Create a Discord bot at <https://discord.com/developers/applications>
2. Enable **Message Content Intent** under Privileged Gateway Intents
3. Run Tiny Claw and ask it to pair the Discord channel
4. Provide the bot token when prompted
5. The agent auto-restarts and the bot connects automatically

## How It Works

- Listens for DMs and @mentions via discord.js
- Routes messages through the agent loop as `discord:<user-id>`
- Splits long responses to respect Discord's 2000-character limit

## Pairing Tools

| Tool | Description |
|------|-------------|
| `discord_pair` | Store a bot token and enable the plugin |
| `discord_unpair` | Disable the plugin (token kept in secrets) |

## License

GPLv3
