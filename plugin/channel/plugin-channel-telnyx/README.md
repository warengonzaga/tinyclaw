# @tinyclaw/plugin-channel-telnyx

Telnyx SMS/Voice channel plugin for TinyClaw - AI-powered voice and text messaging.

## Features

- **SMS Messaging**: Send and receive text messages with the AI agent
- **Voice Calls**: AI-powered phone conversations using Telnyx Call Control
- **Multi-number Support**: Route different numbers to different agents
- **Proactive Outreach**: Agent can initiate SMS messages to users

## Installation

This plugin is included in the TinyClaw monorepo. To enable it:

1. Create a Telnyx account at https://telnyx.com
2. Purchase a phone number or port an existing one
3. Generate an API key at https://portal.telnyx.com/#/app/api-keys
4. Run TinyClaw and ask it to pair the Telnyx channel
5. Provide the API key and phone number when prompted
6. Configure webhook URL in Telnyx portal: `https://your-server/telnyx/webhook`
7. Restart TinyClaw

## Configuration

The plugin stores configuration in:

- **API Key**: Stored securely in secrets engine (`channel.telnyx.apiKey`)
- **Phone Number**: E.164 format (e.g., `+15551234567`)
- **Enabled**: Boolean flag to enable/disable the channel

## Tools Provided

### telnyx_pair
Pair TinyClaw with Telnyx. Requires API key and phone number.

### telnyx_unpair
Disconnect the Telnyx channel.

### telnyx_send_sms
Proactively send an SMS to a user. Useful for notifications, reminders, and follow-ups.

## Webhook Setup

In the Telnyx portal:

1. Go to your phone number settings
2. Set the webhook URL to your server's `/telnyx/webhook` endpoint
3. Enable both SMS and Call Control webhooks

## Usage Examples

**Pair Telnyx:**
```
User: Connect my Telnyx phone number +15551234567
Agent: I'll help you pair Telnyx. What's your API key?
User: KEY0abc123...
Agent: Telnyx paired! Now configure the webhook at https://your-server/telnyx/webhook
```

**Send SMS:**
```
User: Text John at +15559876543 and remind him about the meeting
Agent: [Uses telnyx_send_sms tool]
Agent: Done! I sent the reminder to John.
```

## License

MIT
