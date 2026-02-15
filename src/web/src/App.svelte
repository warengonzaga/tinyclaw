<script>
  import { onMount, tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import AvatarLed from './AvatarLed.svelte'

  marked.setOptions({
    breaks: true,
    gfm: true
  })

  let input = $state('')
  let messages = $state([])
  let isStreaming = $state(false)
  let isUsingTools = $state(false)
  let streamError = $state('')
  let status = $state('checking')
  let messagesContainer = $state(null)

  // Delegation state
  let activeDelegation = $state(null) // Current delegation being set up (before tool returns)
  let backgroundTasks = $state([])    // Background tasks list (running + completed + failed)
  let subAgents = $state([])          // All sub-agents (active + soft_deleted)
  let showPanel = $state(false)       // Toggle for the side panel
  let botStartedAt = $state(null)    // Timestamp from health API for uptime

  // Track which background task completions have been auto-injected into chat.
  // Non-reactive — used purely for dedup, not rendered.
  const shownCompletionIds = new Set()

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
    fetchBackgroundTasks()
    fetchSubAgents()
    const interval = setInterval(checkHealth, 12000)
    // Poll faster (3s) to keep sidebar responsive during background execution
    const bgInterval = setInterval(() => {
      fetchBackgroundTasks()
      fetchSubAgents()
    }, 3000)
    return () => {
      clearInterval(interval)
      clearInterval(bgInterval)
    }
  })

  function renderMarkdown(text) {
    if (!text) return ''
    const html = marked.parse(text)
    return DOMPurify.sanitize(html)
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/health')
      if (res.ok) {
        const data = await res.json()
        status = 'online'
        if (data.startedAt) botStartedAt = data.startedAt
      } else {
        status = 'offline'
      }
    } catch (error) {
      status = 'offline'
    }
  }

  function formatStartDate(ts) {
    if (!ts) return 'Unknown'
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  }

  async function fetchBackgroundTasks() {
    try {
      const res = await fetch(`/api/background-tasks?userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        const newTasks = data.tasks || []

        // Detect newly completed/failed tasks and auto-inject results into chat
        for (const task of newTasks) {
          if (
            (task.status === 'completed' || task.status === 'failed') &&
            !shownCompletionIds.has(task.id)
          ) {
            shownCompletionIds.add(task.id)
            injectBackgroundResult(task)
          }
        }

        backgroundTasks = newTasks
      }
    } catch { /* ignore */ }
  }

  function injectBackgroundResult(task) {
    const agent = subAgents.find(a => a.id === task.agentId)
    const roleName = agent?.role || 'Sub-agent'

    const resultMessage = {
      id: createId(),
      role: 'assistant',
      content: task.status === 'completed'
        ? task.result || 'Task completed successfully.'
        : `The background task failed: ${task.result || 'Unknown error'}`,
      streaming: false,
      timestamp: getTimestamp(),
      delegationEvents: [{
        type: 'result',
        role: roleName,
        success: task.status === 'completed',
        task: task.taskDescription,
        timestamp: getTimestamp()
      }]
    }
    messages = [...messages, resultMessage]
    tick().then(scrollToBottom)

    // Also refresh sub-agents (stats may have updated)
    fetchSubAgents()
  }

  async function fetchSubAgents() {
    try {
      const res = await fetch(`/api/sub-agents?userId=${userId}`)
      if (res.ok) {
        const data = await res.json()
        const fetched = data.agents || []
        console.log('[fetchSubAgents]', fetched.length, 'agents from API', fetched.map(a => `${a.role}(${a.status})`))
        subAgents = fetched
      } else {
        console.warn('[fetchSubAgents] API returned', res.status, res.statusText)
      }
    } catch (err) {
      console.warn('[fetchSubAgents] fetch error:', err)
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
      timestamp: getTimestamp(),
      delegationEvents: [] // Track delegation events for this message
    }
    messages = [...messages, assistantMessage]
    isUsingTools = false
    activeDelegation = null

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

  function addDelegationEvent(msgId, event) {
    messages = messages.map((message) => {
      if (message.id !== msgId) return message
      return {
        ...message,
        delegationEvents: [...(message.delegationEvents || []), event]
      }
    })
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight
    }
  }

  function handleStreamPayload(payload, assistantId) {
    console.log('[Stream Event]', payload)
    
    if (typeof payload === 'string') {
      appendToMessage(assistantId, payload)
      return
    }

    if (!payload || !payload.type) return

    if (payload.type === 'text') {
      appendToMessage(assistantId, payload.content || '')
    }

    if (payload.type === 'tool_start') {
      console.log('[Tool Start]', payload.tool)
      isUsingTools = true
    }

    if (payload.type === 'tool_result') {
      console.log('[Tool Result]', payload.tool)
      isUsingTools = false
    }

    // Delegation events
    if (payload.type === 'delegation_start') {
      const info = payload.delegation || {}
      activeDelegation = {
        role: info.role || 'Sub-agent',
        task: info.task || '',
        tier: info.tier || 'auto',
        startedAt: Date.now()
      }
      addDelegationEvent(assistantId, {
        type: 'start',
        role: info.role,
        task: info.task,
        tier: info.tier,
        timestamp: getTimestamp()
      })
      // Trigger a fetch shortly after start — the agent record is saved to DB
      // within milliseconds of delegation_start, so a small delay catches it.
      setTimeout(() => fetchSubAgents(), 1500)
    }

    if (payload.type === 'delegation_complete') {
      const info = payload.delegation || {}
      console.log('[delegation_complete] SSE payload:', JSON.stringify(info))
      // With non-blocking delegation, this event means the task has been
      // dispatched to the background — not that it's finished.
      activeDelegation = null
      addDelegationEvent(assistantId, {
        type: 'complete',
        role: info.role,
        success: info.success,
        isReuse: info.isReuse,
        taskId: info.taskId,
        timestamp: getTimestamp()
      })

      // Immediately push agent data into the sidebar state so it appears
      // without waiting for the next poll cycle.
      if (info.agentId && info.role) {
        const existing = subAgents.find(a => a.id === info.agentId)
        if (!existing) {
          subAgents = [...subAgents, {
            id: info.agentId,
            role: info.role,
            status: 'active',
            performanceScore: 0.5,
            totalTasks: 0,
            successfulTasks: 0,
            lastActiveAt: Date.now()
          }]
          console.log('[delegation_complete] Pushed agent to sidebar:', info.agentId, info.role)
        }
      } else {
        console.warn('[delegation_complete] Missing agentId or role — cannot push to sidebar', { agentId: info.agentId, role: info.role })
      }

      // Delay fetch slightly so the immediate push isn't overwritten by a
      // stale server response racing with the DB write.
      setTimeout(() => {
        fetchSubAgents()
        fetchBackgroundTasks()
      }, 800)
    }

    // Legacy background_start events (from delegate_background tool)
    if (payload.type === 'background_start') {
      const info = payload.delegation || {}
      activeDelegation = null
      addDelegationEvent(assistantId, {
        type: 'complete',
        role: info.role,
        task: info.task,
        taskId: info.taskId,
        timestamp: getTimestamp()
      })
      setTimeout(() => {
        fetchBackgroundTasks()
        fetchSubAgents()
      }, 800)
    }

    if (payload.type === 'background_update') {
      fetchBackgroundTasks()
    }

    if (payload.type === 'error') {
      streamError = payload.error || 'Streaming error.'
      isUsingTools = false
      activeDelegation = null
    }

    if (payload.type === 'done') {
      updateMessage(assistantId, { streaming: false })
      isStreaming = false
      isUsingTools = false
      activeDelegation = null
    }
  }

  function parseSseChunk(chunk, assistantId) {
    const lines = chunk.split('\n')

    for (const line of lines) {
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (!data) continue

        let payload = data
        try {
          payload = JSON.parse(data)
        } catch (error) {
          // Plain text payload
          payload = data
        }

        handleStreamPayload(payload, assistantId)
      }
    }
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

  function formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp
    const seconds = Math.floor(diff / 1000)
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    return `${hours}h ago`
  }

  function getStatusColor(s) {
    switch (s) {
      case 'running': return 'bg-yellow'
      case 'completed': return 'bg-green'
      case 'failed': return 'bg-red'
      case 'delivered': return 'bg-green'
      case 'active': return 'bg-green'
      case 'suspended': return 'bg-yellow'
      case 'soft_deleted': return 'bg-text-muted'
      default: return 'bg-text-muted'
    }
  }

  function getAgentStatusLabel(agent) {
    // Check if this agent has a running background task
    const runningTask = backgroundTasks.find(t => t.agentId === agent.id && t.status === 'running')
    if (runningTask) return 'working'
    if (agent.status === 'soft_deleted') return 'archived'
    if (agent.status === 'suspended') return 'suspended'
    return 'idle'
  }

  function getAgentCurrentTask(agent) {
    // Get the most recent task for this agent
    return backgroundTasks.find(t => t.agentId === agent.id && t.status === 'running')
      || backgroundTasks.find(t => t.agentId === agent.id && (t.status === 'completed' || t.status === 'failed'))
  }

  // Derived: separate active from archived
  // Also include "phantom" agents implied by running background tasks whose
  // agent records haven't been returned by the API yet (timing / userId mismatch).
  let knownAgentIds = $derived(new Set(subAgents.map(a => a.id)))
  let phantomAgents = $derived(
    backgroundTasks
      .filter(t => t.agentId && !knownAgentIds.has(t.agentId))
      .reduce((acc, t) => {
        if (!acc.find(a => a.id === t.agentId)) {
          acc.push({
            id: t.agentId,
            role: t.taskDescription?.split(':')[0] || 'Background Agent',
            status: 'active',
            performanceScore: 0.5,
            totalTasks: 0,
            successfulTasks: 0,
            lastActiveAt: t.startedAt || Date.now()
          })
        }
        return acc
      }, [])
  )
  let allAgents = $derived([...subAgents, ...phantomAgents])
  let activeAgents = $derived(allAgents.filter(a => a.status === 'active' || a.status === 'suspended'))
  let archivedAgents = $derived(allAgents.filter(a => a.status === 'soft_deleted'))
  let workingAgents = $derived(
    activeAgents.filter(a => backgroundTasks.some(t => t.agentId === a.id && t.status === 'running'))
  )

  // Count for panel badge — include live delegation + agents with running tasks
  let runningBgTasks = $derived(backgroundTasks.filter(t => t.status === 'running').length)
  let activeAgentCount = $derived(
    workingAgents.length + (activeDelegation ? 1 : 0)
  )
</script>

<div class="h-full flex flex-col bg-bg-tertiary">
  <!-- Title Bar -->
  <div class="h-9 min-h-9 px-4 flex items-center bg-bg-titlebar border-b border-bg-modifier-active relative">
    <div class="absolute left-1/2 -translate-x-1/2 flex items-center gap-2">
      <span class="text-sm font-semibold text-text-normal tracking-wide">TinyClaw</span>
      <span class="text-xs text-text-muted/50 font-medium">Beta</span>
      <span class="text-[10px] text-text-muted/30">v1.0.0</span>
    </div>
    <div class="ml-auto flex items-center gap-1">
      <a
        href="https://github.com/warengonzaga/tinyclaw"
        target="_blank"
        rel="noopener noreferrer"
        class="titlebar-link p-1.5 rounded hover:bg-bg-modifier-hover"
        title="Star on GitHub"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
          <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
        </svg>
      </a>
      <a
        href="https://github.com/sponsors/warengonzaga"
        target="_blank"
        rel="noopener noreferrer"
        class="titlebar-link p-1.5 rounded hover:bg-bg-modifier-hover"
        title="Sponsor"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
          <path d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 01-.692 0h-.002z" />
        </svg>
      </a>
      <a
        href="https://github.com/warengonzaga/tinyclaw/blob/main/CONTRIBUTING.md"
        target="_blank"
        rel="noopener noreferrer"
        class="titlebar-link p-1.5 rounded hover:bg-bg-modifier-hover"
        title="Contribute"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-4 h-4">
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
        </svg>
      </a>
    </div>
  </div>

  <!-- Profile Bar -->
  <div class="h-12 min-h-12 px-4 flex items-center border-b border-bg-modifier-active bg-bg-tertiary shadow-sm">
    <div class="flex items-center gap-2.5">
      <AvatarLed size={32} {status} />
      <div class="flex flex-col">
        <span class="text-sm font-semibold text-text-normal leading-tight">TinyClaw</span>
        <span class="text-[11px] {status === 'offline' ? 'text-text-muted/50' : 'text-text-muted'} leading-tight capitalize">{status}</span>
      </div>
    </div>

    <button
      onclick={() => showPanel = !showPanel}
      class="relative ml-auto p-1.5 rounded-md transition-colors hover:bg-bg-modifier-hover {showPanel ? 'text-text-normal' : 'text-text-muted'}"
      title="Toggle Profile Panel"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-5 h-5">
        <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
      </svg>
      {#if runningBgTasks > 0 || activeAgentCount > 0}
        <span class="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-brand text-white text-[9px] flex items-center justify-center font-medium">
          {activeAgentCount}
        </span>
      {/if}
    </button>
  </div>

  <!-- Content Area: Chat + Optional Right Sidebar -->
  <div class="flex-1 flex min-h-0">
    <!-- Main Chat Area -->
    <div class="flex-1 flex flex-col min-w-0">
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
                    <span class="text-xs text-text-muted/70">
                      {#if activeDelegation}
                        delegating...
                      {:else if isUsingTools}
                        working...
                      {:else}
                        thinking...
                      {/if}
                    </span>
                  {/if}
                </div>

                <!-- Delegation Event Cards (inline) -->
                {#if message.delegationEvents?.length > 0}
                  <div class="my-2 space-y-2">
                    {#each message.delegationEvents as event, eventIdx}
                      {#if event.type === 'start'}
                        {@const hasCompleted = message.delegationEvents.some((e, j) => j > eventIdx && (e.type === 'complete' || e.type === 'result'))}
                        {#if !hasCompleted}
                        <div class="delegation-card flex items-start gap-3 p-3 rounded-lg bg-brand/10 border border-brand/20">
                          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-brand">
                              <path d="M15.98 1.804a1 1 0 0 0-1.96 0l-.24 1.192a1 1 0 0 1-.784.785l-1.192.238a1 1 0 0 0 0 1.962l1.192.238a1 1 0 0 1 .785.785l.238 1.192a1 1 0 0 0 1.962 0l.238-1.192a1 1 0 0 1 .785-.785l1.192-.238a1 1 0 0 0 0-1.962l-1.192-.238a1 1 0 0 1-.785-.785l-.238-1.192ZM6.949 5.684a1 1 0 0 0-1.898 0l-.683 2.051a1 1 0 0 1-.633.633l-2.051.683a1 1 0 0 0 0 1.898l2.051.684a1 1 0 0 1 .633.632l.683 2.051a1 1 0 0 0 1.898 0l.683-2.051a1 1 0 0 1 .633-.633l2.051-.683a1 1 0 0 0 0-1.898l-2.051-.683a1 1 0 0 1-.633-.633L6.95 5.684ZM13.949 13.684a1 1 0 0 0-1.898 0l-.184.551a1 1 0 0 1-.632.633l-.551.183a1 1 0 0 0 0 1.898l.551.183a1 1 0 0 1 .633.633l.183.551a1 1 0 0 0 1.898 0l.184-.551a1 1 0 0 1 .632-.633l.551-.183a1 1 0 0 0 0-1.898l-.551-.184a1 1 0 0 1-.633-.632l-.183-.551Z" />
                            </svg>
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-sm font-medium text-brand">Spawning Sub-Agent</span>
                              {#if event.tier && event.tier !== 'auto'}
                                <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/20 text-brand uppercase font-medium">{event.tier}</span>
                              {/if}
                            </div>
                            <p class="text-sm text-text-normal mt-0.5">{event.role}</p>
                            {#if event.task}
                              <p class="text-xs text-text-muted mt-1 line-clamp-2">{event.task}</p>
                            {/if}
                          </div>
                          <div class="flex-shrink-0">
                            <div class="delegation-spinner w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full"></div>
                          </div>
                        </div>
                        {/if}
                      {/if}

                      {#if event.type === 'complete'}
                        <div class="delegation-card flex items-start gap-3 p-3 rounded-lg bg-brand/10 border border-brand/20">
                          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-brand">
                              <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
                            </svg>
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-sm font-medium text-brand">
                                Sub-Agent Dispatched
                              </span>
                              {#if event.isReuse}
                                <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow/20 text-yellow font-medium">REUSED</span>
                              {/if}
                            </div>
                            <p class="text-sm text-text-muted mt-0.5">{event.role} — working in background</p>
                          </div>
                        </div>
                      {/if}

                      {#if event.type === 'result'}
                        <div class="delegation-card flex items-start gap-3 p-3 rounded-lg {event.success ? 'bg-green/10 border border-green/20' : 'bg-red/10 border border-red/20'}">
                          <div class="flex-shrink-0 w-8 h-8 rounded-full {event.success ? 'bg-green/20' : 'bg-red/20'} flex items-center justify-center">
                            {#if event.success}
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-green">
                                <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
                              </svg>
                            {:else}
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-red">
                                <path fill-rule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clip-rule="evenodd" />
                              </svg>
                            {/if}
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <span class="text-sm font-medium {event.success ? 'text-green' : 'text-red'}">
                                {event.success ? 'Sub-Agent Completed' : 'Sub-Agent Failed'}
                              </span>
                            </div>
                            <p class="text-sm text-text-muted mt-0.5">{event.role}</p>
                            {#if event.task}
                              <p class="text-xs text-text-muted mt-1 line-clamp-2">{event.task}</p>
                            {/if}
                          </div>
                        </div>
                      {/if}

                      {#if event.type === 'background'}
                        <div class="delegation-card flex items-start gap-3 p-3 rounded-lg bg-yellow/10 border border-yellow/20">
                          <div class="flex-shrink-0 w-8 h-8 rounded-full bg-yellow/20 flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-yellow">
                              <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clip-rule="evenodd" />
                            </svg>
                          </div>
                          <div class="flex-1 min-w-0">
                            <span class="text-sm font-medium text-yellow">Background Task Started</span>
                            <p class="text-sm text-text-normal mt-0.5">{event.role}</p>
                            {#if event.task}
                              <p class="text-xs text-text-muted mt-1 line-clamp-2">{event.task}</p>
                            {/if}
                            <p class="text-xs text-text-muted mt-1">Results will appear when ready</p>
                          </div>
                        </div>
                      {/if}
                    {/each}
                  </div>
                {/if}

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

      <!-- Active delegation indicator above input -->
      {#if activeDelegation}
        <div class="mb-2 px-3 py-2 bg-brand/10 border border-brand/20 rounded-lg flex items-center gap-2">
          <div class="delegation-spinner w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full flex-shrink-0"></div>
          <span class="text-sm text-brand font-medium">Delegating to {activeDelegation.role}</span>
          <span class="text-xs text-text-muted truncate">{activeDelegation.task}</span>
        </div>
      {/if}
      
      <form onsubmit={(e) => { e.preventDefault(); sendMessage(); }} class="relative">
        <div class="bg-input-bg rounded-lg flex items-end gap-2 pr-2">
          <textarea
            bind:value={input}
            onkeydown={handleKeydown}
            placeholder="Message @tinyclaw"
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
            <span class="text-text-muted/70">
              {#if activeDelegation}
                Sub-agent working...
              {:else if isUsingTools}
                TinyClaw is working...
              {:else}
                TinyClaw is thinking...
              {/if}
            </span>
          {/if}
        </div>
      </form>
    </div>
  </div>

  <!-- Right Sidebar: Profile Panel -->
  {#if showPanel}
    <div class="panel-sidebar w-72 min-w-72 border-l border-bg-modifier-active bg-bg-secondary flex flex-col overflow-hidden">
      <!-- Banner -->
      <div class="h-16 min-h-16 bg-brand"></div>

      <!-- Avatar overlapping banner -->
      <div class="px-4 -mt-8 mb-2">
        <AvatarLed size={64} {status} ringColor="var(--color-bg-secondary)" cutoutColor="var(--color-bg-secondary)" />
      </div>

      <!-- Name -->
      <div class="px-4 mb-3">
        <h2 class="text-lg font-bold text-text-normal">TinyClaw</h2>
      </div>

      <!-- Info Card -->
      <div class="mx-4 p-3 rounded-lg bg-bg-tertiary">
        <h3 class="text-xs font-bold text-text-muted uppercase mb-1">Uptime Since</h3>
        <p class="text-sm text-text-normal">{formatStartDate(botStartedAt)}</p>
      </div>

      <!-- Divider -->
      <div class="mx-4 mt-3 border-t border-bg-modifier-active"></div>

      <!-- Agents & Tasks (like Mutual Servers / Mutual Friends) -->
      <div class="flex-1 overflow-y-auto">
        <!-- Active Agents row -->
        <div class="px-4 py-3 flex items-center justify-between cursor-default">
          <span class="text-sm text-text-normal">Active Agents — {activeAgents.length + (activeDelegation ? 1 : 0)}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-text-muted">
            <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
          </svg>
        </div>

        <!-- Inline agent list -->
        <div class="px-3 pb-2 space-y-2">
          {#if activeDelegation}
            <div class="p-2.5 rounded-lg bg-brand/10 border border-brand/20">
              <div class="flex items-center gap-2">
                <div class="delegation-spinner w-2.5 h-2.5 border-2 border-brand/30 border-t-brand rounded-full flex-shrink-0"></div>
                <span class="text-sm font-medium text-brand truncate">{activeDelegation.role}</span>
              </div>
              {#if activeDelegation.task}
                <p class="text-xs text-text-muted mt-1 line-clamp-2">{activeDelegation.task}</p>
              {/if}
              <div class="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                <span class="text-brand">spawning</span>
                {#if activeDelegation.tier && activeDelegation.tier !== 'auto'}
                  <span class="uppercase">{activeDelegation.tier}</span>
                {/if}
              </div>
            </div>
          {/if}

          {#if activeAgents.length === 0 && !activeDelegation}
            <p class="text-xs text-text-muted py-1 px-1">No active sub-agents</p>
          {:else}
            {#each activeAgents as agent (agent.id)}
              {@const statusLabel = getAgentStatusLabel(agent)}
              {@const currentTask = getAgentCurrentTask(agent)}
              <div class="p-2.5 rounded-lg bg-bg-tertiary {statusLabel === 'working' ? 'border border-brand/20' : ''}">
                <div class="flex items-center gap-2">
                  {#if statusLabel === 'working'}
                    <div class="delegation-spinner w-2.5 h-2.5 border-2 border-brand/30 border-t-brand rounded-full flex-shrink-0"></div>
                  {:else}
                    <span class={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(agent.status)}`}></span>
                  {/if}
                  <span class="text-sm font-medium text-text-normal truncate">{agent.role}</span>
                </div>
                {#if currentTask}
                  <p class="text-xs text-text-muted mt-1 line-clamp-2">
                    {currentTask.taskDescription || currentTask.task_description || 'Working...'}
                  </p>
                  {#if currentTask.status === 'completed' && currentTask.result}
                    <div class="mt-1.5 p-2 rounded bg-bg-primary text-xs text-text-normal max-h-16 overflow-y-auto line-clamp-3">
                      {currentTask.result}
                    </div>
                  {/if}
                {/if}
                <div class="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                  <span title="Performance">{((agent.performanceScore || 0) * 100).toFixed(0)}%</span>
                  <span title="Tasks">{agent.successfulTasks || 0}/{agent.totalTasks || 0} tasks</span>
                  <span class={statusLabel === 'working' ? 'text-brand' : 'capitalize'}>{statusLabel}</span>
                </div>
                {#if agent.lastActiveAt}
                  <div class="text-[10px] text-text-muted mt-1">{formatTimeAgo(agent.lastActiveAt)}</div>
                {/if}
              </div>
            {/each}
          {/if}
        </div>

        <!-- Background Tasks row -->
        <div class="px-4 py-3 flex items-center justify-between cursor-default border-t border-bg-modifier-active">
          <span class="text-sm text-text-normal">Background Tasks — {backgroundTasks.length}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-text-muted">
            <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
          </svg>
        </div>

        <!-- Archived agents -->
        {#if archivedAgents.length > 0}
          <div class="border-t border-bg-modifier-active">
            <div class="px-4 py-3 flex items-center justify-between cursor-default">
              <span class="text-sm text-text-muted">History — {archivedAgents.length}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-text-muted">
                <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
              </svg>
            </div>
            <div class="px-3 pb-2 space-y-2">
              {#each archivedAgents as agent (agent.id)}
                {@const lastTask = getAgentCurrentTask(agent)}
                <div class="p-2.5 rounded-lg bg-bg-tertiary opacity-60">
                  <div class="flex items-center gap-2">
                    <span class={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(agent.status)}`}></span>
                    <span class="text-sm font-medium text-text-muted truncate">{agent.role}</span>
                  </div>
                  <div class="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                    <span title="Performance">{((agent.performanceScore || 0) * 100).toFixed(0)}%</span>
                    <span title="Tasks">{agent.successfulTasks || 0}/{agent.totalTasks || 0} tasks</span>
                    <span>archived</span>
                  </div>
                  {#if agent.lastActiveAt}
                    <div class="text-[10px] text-text-muted mt-1">{formatTimeAgo(agent.lastActiveAt)}</div>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  </div>
</div>
