/**
 * Friends Chat Tools
 *
 * Agent tools for managing friend invites. These are registered as pairing
 * tools so the AI agent can create invite links, regenerate codes, revoke
 * access, and list friends conversationally.
 *
 * All tools are owner-only (checked by the agent loop's authority system).
 */

import type { Tool, ConfigManagerInterface } from '@tinyclaw/types';
import { InviteStore } from './store.js';

/** Config key for the enabled flag. */
export const FRIENDS_ENABLED_CONFIG_KEY = 'channels.friends.enabled';
/** Config key for the plugin server port. */
export const FRIENDS_PORT_CONFIG_KEY = 'channels.friends.port';
/** Config key for the base URL (for generating invite links). */
export const FRIENDS_BASE_URL_CONFIG_KEY = 'channels.friends.baseUrl';
/** The plugin's package ID. */
export const FRIENDS_PLUGIN_ID = '@tinyclaw/plugin-channel-friends';

export function createFriendsTools(
  store: InviteStore,
  configManager: ConfigManagerInterface,
): Tool[] {
  return [
    {
      name: 'friends_chat_invite',
      description:
        'Create a new friend and generate an invite link for the Friends Web Chat. ' +
        'The owner must provide a unique username. An invite code and URL will be generated. ' +
        'The friend uses the link or code to start chatting. ' +
        'The invite code is single-use — once redeemed, the friend gets a session cookie.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description:
              'Unique username for the friend (lowercase alphanumeric + underscores). ' +
              'This is permanent and identifies the friend in FRIENDS.md.',
          },
          nickname: {
            type: 'string',
            description:
              'Optional display name for the friend. Defaults to the username. ' +
              'The friend can change this later.',
          },
        },
        required: ['username'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const username = (args.username as string || '').trim();
        if (!username) {
          return 'Error: username is required.';
        }

        const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (sanitized.length < 2 || sanitized.length > 32) {
          return 'Error: username must be 2–32 characters (letters, numbers, underscores).';
        }

        if (store.exists(sanitized)) {
          return `Error: a friend with username "${sanitized}" already exists. Use friends_chat_reinvite to generate a new invite code for them.`;
        }

        const nickname = (args.nickname as string || '').trim() || undefined;
        const friend = store.createFriend(sanitized, nickname);

        const baseUrl = configManager.get<string>(FRIENDS_BASE_URL_CONFIG_KEY) || '';
        const port = configManager.get<number>(FRIENDS_PORT_CONFIG_KEY) || 3001;
        const base = baseUrl || `http://localhost:${port}`;
        const inviteUrl = `${base}/chat?invite=${friend.inviteCode}`;

        return (
          `Friend "${friend.nickname}" (username: ${friend.username}) created!\n\n` +
          `Invite URL: ${inviteUrl}\n` +
          `Invite code: ${friend.inviteCode}\n\n` +
          `Share the URL or code with your friend. ` +
          `The code is single-use — once they open the link and start chatting, ` +
          `their browser is authenticated. If they switch browsers or clear cookies, ` +
          `use friends_chat_reinvite to generate a new code for them.`
        );
      },
    },

    {
      name: 'friends_chat_reinvite',
      description:
        'Generate a new invite code for an existing friend. ' +
        'Use this when a friend switches browsers, clears cookies, or loses access. ' +
        'The old session is invalidated — the friend must use the new code to re-authenticate.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'The username of the existing friend to re-invite.',
          },
        },
        required: ['username'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const username = (args.username as string || '').trim();
        if (!username) {
          return 'Error: username is required.';
        }

        const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const newCode = store.regenerateInvite(sanitized);

        if (!newCode) {
          return `Error: no friend found with username "${sanitized}". Use friends_chat_invite to create a new friend.`;
        }

        const baseUrl = configManager.get<string>(FRIENDS_BASE_URL_CONFIG_KEY) || '';
        const port = configManager.get<number>(FRIENDS_PORT_CONFIG_KEY) || 3001;
        const base = baseUrl || `http://localhost:${port}`;
        const inviteUrl = `${base}/chat?invite=${newCode}`;

        return (
          `New invite generated for "${sanitized}"!\n\n` +
          `Invite URL: ${inviteUrl}\n` +
          `Invite code: ${newCode}\n\n` +
          `Their previous session has been invalidated. ` +
          `Share the new link or code with them.`
        );
      },
    },

    {
      name: 'friends_chat_revoke',
      description:
        'Revoke a friend\'s access to the Friends Web Chat. ' +
        'Their session and any pending invite code are invalidated immediately. ' +
        'To restore access later, use friends_chat_reinvite.',
      parameters: {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            description: 'The username of the friend to revoke.',
          },
        },
        required: ['username'],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const username = (args.username as string || '').trim();
        if (!username) {
          return 'Error: username is required.';
        }

        const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const revoked = store.revokeFriend(sanitized);

        if (!revoked) {
          return `Error: no friend found with username "${sanitized}".`;
        }

        return (
          `Access revoked for "${sanitized}". ` +
          `Their session cookie and invite code have been invalidated. ` +
          `Use friends_chat_reinvite to restore access.`
        );
      },
    },

    {
      name: 'friends_chat_list',
      description:
        'List all registered friends and their status. ' +
        'Shows username, nickname, whether they have an active session or pending invite, ' +
        'and when they were last seen.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(): Promise<string> {
        const friends = store.listFriends();

        if (friends.length === 0) {
          return 'No friends registered yet. Use friends_chat_invite to invite someone.';
        }

        const lines = friends.map((f) => {
          const status = f.sessionToken
            ? 'active'
            : f.inviteCode
              ? 'invite pending'
              : 'revoked';

          const lastSeen = new Date(f.lastSeen).toLocaleString();
          return `- **${f.nickname}** (@${f.username}) — ${status}, last seen: ${lastSeen}`;
        });

        return `**Registered Friends (${friends.length})**\n\n${lines.join('\n')}`;
      },
    },
  ];
}
