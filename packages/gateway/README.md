# @tinyclaw/gateway

Outbound message gateway for proactive messaging across channels.

Routes messages from the agent system to users via their connected channel (Web UI, Discord, Friends Chat, etc.) using userId prefix-based routing.

## Usage

```ts
import { createGateway } from '@tinyclaw/gateway';

const gateway = createGateway();

// Register a channel sender
gateway.register('web', {
  name: 'Web UI',
  async send(userId, message) {
    // Push via SSE to the browser
  },
});

// Send a proactive message
await gateway.send('web:owner', {
  content: 'Your background task is complete!',
  priority: 'normal',
  source: 'background_task',
});

// Broadcast to all channels
await gateway.broadcast({
  content: 'System update available',
  priority: 'low',
  source: 'system',
});
```
