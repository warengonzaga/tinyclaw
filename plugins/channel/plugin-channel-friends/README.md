# @tinyclaw/plugin-channel-friends

Invite-based web chat channel plugin for Tiny Claw. Lets the owner invite friends to chat with the agent through a lightweight web interface.

## Setup

1. Enable the plugin via config or ask the agent
2. Ask the agent to invite a friend (e.g. "invite my friend John to friends chat")
3. Share the invite URL or code with your friend
4. Friend opens the link and starts chatting

## How It Works

- Runs an HTTP server on a configurable port (default 3001)
- Invite codes are single-use — redeemed into a session cookie
- Messages route through the agent loop as `friend:<username>`

## Management Tools

| Tool | Description |
|------|-------------|
| `friends_chat_invite` | Create a friend and generate an invite code |
| `friends_chat_reinvite` | Regenerate an invite for an existing friend |
| `friends_chat_revoke` | Revoke a friend's session and invite |
| `friends_chat_list` | List all friends |

## License

GPLv3
