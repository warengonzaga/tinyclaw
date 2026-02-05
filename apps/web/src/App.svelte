<script>
  import { onMount, tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'

  marked.setOptions({
    breaks: true,
    gfm: true
  })

  const suggestedPrompts = [
    'Summarize my last session and plan next steps.',
    'List all available tools and what each one does.',
    'Help me refactor this file with a careful diff.',
    'Scan the repo for TODOs and propose a roadmap.'
  ]

  let input = ''
  let messages = []
  let toolEvents = []
  let isStreaming = false
  let streamError = ''
  let status = 'checking'
  let bottomAnchor

  const userId = 'default-user'

  const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

  $: activeToolCount = toolEvents.filter((tool) => tool.status === 'running').length
  $: lastTool = toolEvents[0]

  onMount(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 12000)
    return () => clearInterval(interval)
  })

  function renderMarkdown(text) {
    if (!text) return ''
    const html = marked.parse(text)
    return DOMPurify.sanitize(html)
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/health')
      status = res.ok ? 'online' : 'offline'
    } catch (error) {
      status = 'offline'
    }
  }

  async function sendMessage() {
    const message = input.trim()
    if (!message || isStreaming) return

    streamError = ''
    input = ''

    const userMessage = { id: createId(), role: 'user', content: message }
    messages = [...messages, userMessage]

    const assistantMessage = {
      id: createId(),
      role: 'assistant',
      content: '',
      streaming: true
    }
    messages = [...messages, assistantMessage]
    toolEvents = []

    await tick()
    scrollToBottom()

    try {
      await streamChat(message, assistantMessage.id)
    } catch (error) {
      streamError = error instanceof Error ? error.message : 'Streaming failed.'
      updateMessage(assistantMessage.id, {
        content: 'I had trouble streaming that response. Please try again.',
        streaming: false
      })
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  function updateMessage(id, patch) {
    messages = messages.map((message) => {
      if (message.id !== id) return message
      return normalizeMessage({ ...message, ...patch })
    })
  }

  function appendToMessage(id, text) {
    messages = messages.map((message) => {
      if (message.id !== id) return message
      const updated = { ...message, content: `${message.content}${text}` }
      return normalizeMessage(updated)
    })
  }

  function normalizeMessage(message) {
    if (!message || message.role !== 'assistant') return message

    const extraction = extractToolPayload(message.content || '')
    if (!extraction) return message

    const mergedText = [extraction.before, extraction.after].filter(Boolean).join('\n\n')
    return {
      ...message,
      content: mergedText,
      rawToolPayload: extraction.raw,
      showToolPayload: message.showToolPayload ?? false
    }
  }

  function extractToolPayload(text) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return null

    const raw = text.slice(start, end + 1).trim()
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      return null
    }

    if (!parsed || typeof parsed !== 'object') return null

    const hasToolKeys =
      'action' in parsed ||
      'tool' in parsed ||
      'tool_calls' in parsed ||
      'file_path' in parsed

    if (!hasToolKeys) return null

    return {
      raw,
      before: text.slice(0, start).trim(),
      after: text.slice(end + 1).trim()
    }
  }

  function toggleToolPayload(id) {
    messages = messages.map((message) => {
      if (message.id !== id) return message
      return { ...message, showToolPayload: !message.showToolPayload }
    })
  }

  function scrollToBottom() {
    bottomAnchor?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  function pushToolEvent(tool, status, result) {
    toolEvents = [
      {
        id: createId(),
        name: tool,
        status,
        result: result || '',
        timestamp: new Date().toLocaleTimeString()
      },
      ...toolEvents
    ]
  }

  function updateLatestTool(name, update) {
    const index = toolEvents.findIndex((tool) => tool.name === name && tool.status === 'running')
    if (index === -1) return
    toolEvents = toolEvents.map((tool, idx) =>
      idx === index ? { ...tool, ...update } : tool
    )
  }

  function handleStreamPayload(payload, assistantId) {
    if (typeof payload === 'string') {
      appendToMessage(assistantId, payload)
      return
    }

    if (!payload || !payload.type) return

    if (payload.type === 'text') {
      appendToMessage(assistantId, payload.content || '')
    }

    if (payload.type === 'tool_start') {
      pushToolEvent(payload.tool || 'unknown_tool', 'running')
    }

    if (payload.type === 'tool_result') {
      updateLatestTool(payload.tool || 'unknown_tool', {
        status: 'done',
        result: payload.result || ''
      })
    }

    if (payload.type === 'error') {
      streamError = payload.error || 'Streaming error.'
      updateLatestTool(payload.tool || 'unknown_tool', {
        status: 'error',
        result: payload.error || payload.result || ''
      })
    }

    if (payload.type === 'done') {
      updateMessage(assistantId, { streaming: false })
      isStreaming = false
    }
  }

  function parseSseChunk(chunk, assistantId) {
    const lines = chunk.split('\n')
    let data = ''

    for (const line of lines) {
      if (line.startsWith('data:')) {
        data += line.slice(5).trim()
      }
    }

    if (!data) return

    let payload = data
    try {
      payload = JSON.parse(data)
    } catch (error) {
      payload = data
    }

    handleStreamPayload(payload, assistantId)
  }

  async function streamChat(message, assistantId) {
    isStreaming = true

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json'
      },
      body: JSON.stringify({ message, userId, stream: true })
    })

    if (!response.ok) {
      isStreaming = false
      throw new Error(`Request failed with ${response.status}`)
    }

    const contentType = response.headers.get('content-type') || ''

    if (response.body && contentType.includes('text/event-stream')) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        let boundaryIndex = buffer.indexOf('\n\n')

        while (boundaryIndex !== -1) {
          const chunk = buffer.slice(0, boundaryIndex).trim()
          buffer = buffer.slice(boundaryIndex + 2)
          if (chunk) parseSseChunk(chunk, assistantId)
          boundaryIndex = buffer.indexOf('\n\n')
        }
      }

      if (buffer.trim()) {
        parseSseChunk(buffer.trim(), assistantId)
      }

      updateMessage(assistantId, { streaming: false })
      isStreaming = false
      scrollToBottom()
      return
    }

    const fallbackText = await response.text()

    try {
      const data = JSON.parse(fallbackText)
      const content = data.content || data.reply || data.message || ''
      updateMessage(assistantId, { content, streaming: false })
    } catch (error) {
      updateMessage(assistantId, { content: fallbackText, streaming: false })
    }

    isStreaming = false
    scrollToBottom()
  }

  function usePrompt(prompt) {
    input = prompt
  }
</script>

<div class="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="badge">TinyClaw</div>
      <p class="subtitle">Agent console with live tools telemetry.</p>
    </div>

    <div class="status">
      <span class={`dot ${status}`}></span>
      <div>
        <div class="status-label">System status</div>
        <div class="status-value">{status}</div>
      </div>
      <div class="status-meta">
        <div class="status-count">{activeToolCount}</div>
        <div class="status-caption">active tools</div>
      </div>
    </div>

    <section class="panel">
      <div class="panel-header">
        <h2>Tool Activity</h2>
        {#if lastTool}
          <span class="panel-meta">latest {lastTool.timestamp}</span>
        {/if}
      </div>

      {#if toolEvents.length === 0}
        <p class="muted">No tools used yet. Trigger a query to see live tool calls.</p>
      {:else}
        <div class="tool-list">
          {#each toolEvents as tool (tool.id)}
            <article class={`tool-card ${tool.status}`}>
              <div class="tool-row">
                <span class="tool-name">{tool.name}</span>
                <span class={`tool-status ${tool.status}`}>{tool.status}</span>
              </div>
              {#if tool.result}
                <div class="tool-result">{tool.result}</div>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>

    <section class="panel">
      <div class="panel-header">
        <h2>Quick Prompts</h2>
        <span class="panel-meta">tap to load</span>
      </div>
      <div class="prompt-list">
        {#each suggestedPrompts as prompt}
          <button class="prompt" type="button" on:click={() => usePrompt(prompt)}>
            {prompt}
          </button>
        {/each}
      </div>
    </section>
  </aside>

  <main class="chat">
    <header class="chat-header">
      <div>
        <h1>Conversation</h1>
        <p class="muted">Streaming responses and tool usage appear here in real time.</p>
      </div>
      <div class="header-meta">
        <div class="chip">User: {userId}</div>
        <div class={`chip ${isStreaming ? 'active' : ''}`}>
          {isStreaming ? 'Streaming' : 'Idle'}
        </div>
      </div>
    </header>

    <section class="messages">
      {#if messages.length === 0}
        <div class="empty">
          <h3>Ready when you are.</h3>
          <p>Start a request and watch the response stream in.</p>
        </div>
      {/if}

      {#each messages as message (message.id)}
        <article class={`bubble ${message.role}`}>
          <div class="bubble-header">
            <span class="role">{message.role === 'user' ? 'You' : 'TinyClaw'}</span>
            {#if message.streaming}
              <span class="streaming">streaming</span>
            {/if}
          </div>
          <div class="bubble-content">
            {@html renderMarkdown(message.content || (message.streaming ? '...' : ''))}
          </div>
          {#if message.rawToolPayload}
            <div class="tool-payload">
              <button type="button" class="tool-toggle" on:click={() => toggleToolPayload(message.id)}>
                {message.showToolPayload ? 'Hide tool details' : 'Show tool details'}
              </button>
              {#if message.showToolPayload}
                <pre class="tool-raw">{message.rawToolPayload}</pre>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
      <div bind:this={bottomAnchor}></div>
    </section>

    <form class="composer" on:submit|preventDefault={sendMessage}>
      <textarea
        bind:value={input}
        on:keydown={handleKeydown}
        placeholder="Ask TinyClaw anything..."
        rows="3"
      ></textarea>
      <div class="actions">
        <div class="helper">Shift + Enter for a new line</div>
        <button type="submit" disabled={isStreaming || !input.trim()}>
          {isStreaming ? 'Working...' : 'Send'}
        </button>
      </div>
    </form>

    {#if streamError}
      <div class="error">{streamError}</div>
    {/if}
  </main>
</div>
