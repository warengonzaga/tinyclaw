<script>
  import { onMount, tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'

  marked.setOptions({
    breaks: true,
    gfm: true
  })

  let input = $state('')
  let messages = $state([])
  let isStreaming = $state(false)
  let streamError = $state('')
  let status = $state('checking')
  let messagesContainer = $state(null)

  const userId = 'default-user'

  const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

  const getTimestamp = () => {
    return new Date().toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
  }

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

    const userMessage = { 
      id: createId(), 
      role: 'user', 
      content: message,
      timestamp: getTimestamp()
    }
    messages = [...messages, userMessage]

    const assistantMessage = {
      id: createId(),
      role: 'assistant',
      content: '',
      streaming: true,
      timestamp: getTimestamp()
    }
    messages = [...messages, assistantMessage]

    await tick()
    scrollToBottom()

    try {
      await streamChat(message, assistantMessage.id)
    } catch (error) {
      streamError = error instanceof Error ? error.message : 'Streaming failed.'
      updateMessage(assistantMessage.id, {
        content: 'I had trouble processing that request. Please try again.',
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
      return { ...message, ...patch }
    })
  }

  function appendToMessage(id, text) {
    messages = messages.map((message) => {
      if (message.id !== id) return message
      return { ...message, content: `${message.content}${text}` }
    })
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
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

    if (payload.type === 'error') {
      streamError = payload.error || 'Streaming error.'
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

        await tick()
        scrollToBottom()
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
</script>

<div class="h-full flex flex-col bg-bg-tertiary">
  <!-- Header -->
  <header class="h-12 min-h-12 px-4 flex items-center border-b border-bg-modifier-active bg-bg-tertiary shadow-sm">
    <div class="flex items-center gap-2">
      <span class="text-text-muted">#</span>
      <h1 class="text-base font-semibold text-text-normal">tinyclaw</h1>
    </div>
    <div class="ml-auto flex items-center gap-3">
      <div class="flex items-center gap-2 text-sm">
        <span class={`w-2 h-2 rounded-full ${status === 'online' ? 'bg-green' : status === 'offline' ? 'bg-red' : 'bg-yellow'}`}></span>
        <span class="text-text-muted">{status}</span>
      </div>
    </div>
  </header>

  <!-- Messages Area -->
  <div 
    bind:this={messagesContainer}
    class="flex-1 overflow-y-auto px-4 py-4"
  >
    {#if messages.length === 0}
      <!-- Welcome State -->
      <div class="flex flex-col items-center justify-center h-full text-center">
        <div class="w-20 h-20 rounded-full bg-brand/20 flex items-center justify-center mb-4">
          <span class="text-4xl">🐾</span>
        </div>
        <h2 class="text-2xl font-bold text-text-normal mb-2">Welcome to TinyClaw</h2>
        <p class="text-text-muted max-w-md">
          This is the start of your conversation. Ask me anything and I'll do my best to help!
        </p>
      </div>
    {:else}
      <!-- Message List -->
      <div class="space-y-4">
        {#each messages as message (message.id)}
          <div class="group flex gap-4 py-0.5 px-2 rounded hover:bg-bg-modifier-hover transition-colors">
            <!-- Avatar -->
            <div class="flex-shrink-0 mt-0.5">
              {#if message.role === 'user'}
                <div class="w-10 h-10 rounded-full bg-brand flex items-center justify-center">
                  <span class="text-white text-sm font-medium">U</span>
                </div>
              {:else}
                <div class="w-10 h-10 rounded-full bg-green flex items-center justify-center">
                  <span class="text-lg">🐾</span>
                </div>
              {/if}
            </div>
            
            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class={`font-medium ${message.role === 'user' ? 'text-brand' : 'text-green'}`}>
                  {message.role === 'user' ? 'You' : 'TinyClaw'}
                </span>
                <span class="text-xs text-text-muted">{message.timestamp}</span>
                {#if message.streaming}
                  <span class="text-xs text-yellow">typing...</span>
                {/if}
              </div>
              <div class="markdown-content text-text-normal mt-0.5">
                {#if message.content}
                  {@html renderMarkdown(message.content)}
                {:else if message.streaming}
                  <div class="flex gap-1 py-2">
                    <span class="typing-dot w-2 h-2 bg-text-muted rounded-full"></span>
                    <span class="typing-dot w-2 h-2 bg-text-muted rounded-full"></span>
                    <span class="typing-dot w-2 h-2 bg-text-muted rounded-full"></span>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Input Area -->
  <div class="px-4 pb-6 pt-2">
    {#if streamError}
      <div class="mb-2 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
        {streamError}
      </div>
    {/if}
    
    <form onsubmit={(e) => { e.preventDefault(); sendMessage(); }} class="relative">
      <div class="bg-input-bg rounded-lg flex items-end gap-2 pr-2">
        <textarea
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder="Message #tinyclaw"
          rows="1"
          class="flex-1 bg-transparent text-text-normal placeholder-text-muted px-4 py-3 resize-none outline-none max-h-48 min-h-[48px]"
          style="field-sizing: content;"
        ></textarea>
        
        <button 
          type="submit" 
          disabled={isStreaming || !input.trim()}
          aria-label="Send message"
          class="mb-2 p-2 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-bg-modifier-hover text-text-muted hover:text-text-normal flex items-center justify-center flex-shrink-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
            <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
          </svg>
        </button>
      </div>
      
      <div class="flex items-center justify-between mt-2 text-xs text-text-muted px-1">
        <span>Press <kbd class="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">Enter</kbd> to send, <kbd class="px-1.5 py-0.5 bg-bg-secondary rounded text-[10px]">Shift+Enter</kbd> for new line</span>
        {#if isStreaming}
          <span class="text-yellow">TinyClaw is thinking...</span>
        {/if}
      </div>
    </form>
  </div>
</div>
