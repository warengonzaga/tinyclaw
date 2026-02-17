<script>
  import { onMount, tick } from 'svelte'
  import { marked } from 'marked'
  import DOMPurify from 'dompurify'
  import QRCode from 'qrcode'
  import AvatarLed from './AvatarLed.svelte'
  import {
    SECURITY_WARNING_TITLE,
    SECURITY_WARNING_BODY,
    SECURITY_LICENSE,
    SECURITY_WARRANTY,
    SECURITY_SAFETY_TITLE,
    SECURITY_SAFETY_PRACTICES,
    SECURITY_CONFIRM,
    DEFAULT_MODEL,
    defaultModelNote,
    TOTP_SETUP_TITLE,
    TOTP_SETUP_BODY,
    BACKUP_CODES_INTRO,
    BACKUP_CODES_HINT,
    RECOVERY_TOKEN_HINT,
  } from '@tinyclaw/core/messages'

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

  // Auth state
  let authChecked = $state(false)
  let ownerClaimed = $state(false)
  let isOwner = $state(false)
  let bootstrapSecret = $state('')
  let setupToken = $state('')
  let setupError = $state('')
  let setupLoading = $state(false)
  let setupSubmitting = $state(false)
  let setupPhase = $state('bootstrap')
  let acceptedRisk = $state(false)
  let setupApiKey = $state('')
  let setupSoulSeed = $state('')
  let setupTotpSecret = $state('')
  let setupTotpUri = $state('')
  let setupTotpQrUrl = $state('')
  let setupTotpCode = $state('')
  let setupBackupCodes = $state([])
  let setupRecoveryToken = $state('')
  let setupRestarting = $state(false)
  let totpCode = $state('')
  let loginError = $state('')
  let loginLoading = $state(false)
  let wantsLogin = $state(false) // true when on /login path
  let wantsRecovery = $state(false) // true when on /recovery path

  // Recovery state
  let recoveryToken = $state('')
  let recoverySessionId = $state('')
  let recoveryBackupCode = $state('')
  let recoveryError = $state('')
  let recoveryLoading = $state(false)
  let recoveryPhase = $state('token') // 'token' | 'backup' | 'totp-setup' | 'totp-confirm' | 'new-codes'
  let recoverySuccess = $state(false)
  let recoveryLocked = $state(false)
  let recoveryLockTimer = $state(null)
  let recoveryPermanentlyBlocked = $state(false)
  let recoveryBackupCodesRemaining = $state(0)

  // TOTP re-enrollment state (after recovery)
  let reenrollToken = $state('')
  let reenrollTotpSecret = $state('')
  let reenrollTotpUri = $state('')
  let reenrollTotpQrUrl = $state('')
  let reenrollTotpCode = $state('')
  let reenrollLoading = $state(false)
  let reenrollError = $state('')
  let reenrollBackupCodes = $state([])
  let reenrollRecoveryToken = $state('')

  // Copy/download feedback state
  let copiedRecoveryToken = $state(false)
  let copiedBackupCodes = $state(false)
  let copiedReenrollRecoveryToken = $state(false)
  let copiedReenrollBackupCodes = $state(false)

  async function copyToClipboard(text, flagSetter) {
    try {
      await navigator.clipboard.writeText(text)
      flagSetter(true)
      setTimeout(() => flagSetter(false), 2000)
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const success = document.execCommand('copy')
      document.body.removeChild(ta)
      if (success) {
        flagSetter(true)
        setTimeout(() => flagSetter(false), 2000)
      } else {
        console.warn('Clipboard copy failed: execCommand returned false')
      }
    }
  }

  function downloadCredentials(recoveryToken, backupCodes) {
    const lines = [
      'Tiny Claw — Recovery Credentials',
      '=================================',
      '',
      'RECOVERY TOKEN',
      '──────────────',
      recoveryToken,
      '',
      'BACKUP CODES',
      '────────────',
      ...backupCodes.map((code, i) => `${i + 1}. ${code}`),
      '',
      '─────────────────────────────────',
      'Store this file in a secure location.',
      'Each backup code can only be used once.',
      `Generated: ${new Date().toISOString()}`,
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'tinyclaw-recovery-credentials.txt'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // View: 'loading' | 'setup' | 'login' | 'recovery' | 'owner'
  // Owner dashboard is the default authenticated view
  let view = $derived(
    !authChecked ? 'loading'
    : !ownerClaimed ? 'setup'
    : wantsRecovery ? 'recovery'
    : wantsLogin ? 'login'
    : isOwner ? 'owner'
    : 'landing'
  )

  // Delegation state
  let activeDelegation = $state(null) // Current delegation being set up (before tool returns)
  let backgroundTasks = $state([])    // Background tasks list (running + completed + failed)
  let subAgents = $state([])          // All sub-agents (active + soft_deleted)
  let showPanel = $state(false)       // Toggle for the side panel
  let botStartedAt = $state(null)    // Timestamp from health API for uptime

  // Track which background task completions have been auto-injected into chat.
  // Persisted in sessionStorage so refreshes don't re-inject old results.
  const shownCompletionIds = new Set(
    JSON.parse(sessionStorage.getItem('tc_shownCompletionIds') || '[]')
  )
  function markCompletionShown(id) {
    shownCompletionIds.add(id)
    sessionStorage.setItem('tc_shownCompletionIds', JSON.stringify([...shownCompletionIds]))
  }

  // First fetch flag — on page load we seed the set with already-completed
  // tasks so they are not re-injected into chat.
  let initialFetchDone = false

  // Owner userId — matches what the server sets
  const userId = 'web:owner'

  const createId = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`

  const getTimestamp = () => {
    return new Date().toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    })
  }

  onMount(async () => {
    // Check auth status first
    await checkAuth()

    // Route detection — determine view based on URL path
    const pathname = window.location.pathname
    if (!ownerClaimed && pathname !== '/setup') {
      window.history.replaceState({}, '', '/setup')
    }
    if (pathname === '/login' && ownerClaimed && !isOwner) {
      wantsLogin = true
    }
    if (pathname === '/recovery' && ownerClaimed && !isOwner) {
      wantsRecovery = true
    }

    checkHealth()
    if (view === 'owner') {
      fetchBackgroundTasks()
      fetchSubAgents()
    }
    const interval = setInterval(checkHealth, 12000)
    // Poll faster (3s) to keep sidebar responsive during background execution
    const bgInterval = setInterval(() => {
      if (view === 'owner') {
        fetchBackgroundTasks()
        fetchSubAgents()
      }
    }, 3000)

    // Sync view state on back/forward navigation
    const handlePopstate = () => {
      const p = window.location.pathname
      wantsLogin = p === '/login' && ownerClaimed && !isOwner
      wantsRecovery = p === '/recovery' && ownerClaimed && !isOwner
    }
    window.addEventListener('popstate', handlePopstate)

    // Auto-close panel when crossing from desktop → mobile breakpoint
    const mql = window.matchMedia('(min-width: 768px)')
    const handleBreakpoint = (e) => {
      if (!e.matches) showPanel = false
    }
    mql.addEventListener('change', handleBreakpoint)

    return () => {
      clearInterval(interval)
      clearInterval(bgInterval)
      window.removeEventListener('popstate', handlePopstate)
      mql.removeEventListener('change', handleBreakpoint)
    }
  })

  // Strip em-dashes and en-dashes from text before rendering
  function stripDashes(text) {
    return text
      .replace(/\s*—\s*/g, ', ')
      .replace(/\s*–\s*/g, ', ')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\./g, '.')
  }

  function renderMarkdown(text) {
    if (!text) return ''
    const cleaned = stripDashes(text)
    const html = marked.parse(cleaned)
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['input'],
      ADD_ATTR: ['type', 'checked', 'disabled']
    })
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

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/status')
      if (res.ok) {
        const data = await res.json()
        ownerClaimed = data.claimed
        isOwner = data.isOwner
      }
    } catch {
      // Server not ready yet
    }
    authChecked = true
  }

  async function submitBootstrap() {
    if (!bootstrapSecret.trim() || setupLoading) return
    setupLoading = true
    setupError = ''
    try {
      const res = await fetch('/api/setup/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: bootstrapSecret.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        setupToken = data.setupToken
        setupTotpSecret = data.totpSecret || ''
        setupTotpUri = data.totpUri || ''
        if (setupTotpUri) {
          setupTotpQrUrl = await QRCode.toDataURL(setupTotpUri, { width: 200, margin: 2 })
        }
        setupPhase = 'form'
        bootstrapSecret = ''
      } else {
        setupError = data.error || 'Bootstrap verification failed'
      }
    } catch {
      setupError = 'Could not reach Tiny Claw server'
    }
    setupLoading = false
  }

  function handleBootstrapKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitBootstrap()
    }
  }

  async function submitSetup() {
    if (setupSubmitting) return
    setupSubmitting = true
    setupError = ''

    try {
      const res = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setupToken,
          acceptRisk: acceptedRisk,
          apiKey: setupApiKey,
          soulSeed: setupSoulSeed,
          totpCode: setupTotpCode,
        })
      })

      const data = await res.json()
      if (res.ok) {
        setupBackupCodes = data.backupCodes || []
        setupRecoveryToken = data.recoveryToken || ''
        setupPhase = 'backup-codes'
      } else {
        setupError = data.error || 'Setup failed'
      }
    } catch {
      setupError = 'Could not reach Tiny Claw server'
    }

    setupSubmitting = false
  }

  async function finishSetupAndEnter() {
    setupRestarting = true

    // First, try an immediate auth check (works when server doesn't restart)
    try {
      await checkAuth()
      if (ownerClaimed && isOwner) {
        setupRestarting = false
        window.history.replaceState({}, '', '/')
        fetchBackgroundTasks()
        fetchSubAgents()
        return
      }
    } catch {
      // Server likely restarting — fall through to polling
    }

    // Poll until the server comes back online and owner is authenticated
    const pollInterval = 2000
    const maxAttempts = 90 // 3 minutes max
    let attempts = 0

    const poll = async () => {
      attempts++
      try {
        const res = await fetch('/api/auth/status')
        if (res.ok) {
          const data = await res.json()
          ownerClaimed = data.claimed
          isOwner = data.isOwner
          authChecked = true

          if (ownerClaimed) {
            // Server is back — redirect to owner page or login
            setupRestarting = false
            if (isOwner) {
              window.history.replaceState({}, '', '/')
              fetchBackgroundTasks()
              fetchSubAgents()
            } else {
              // Session lost during restart — go to login
              wantsLogin = true
              window.history.replaceState({}, '', '/login')
            }
            return
          }
        }
      } catch {
        // Server still restarting — keep polling
      }

      if (attempts < maxAttempts) {
        setTimeout(poll, pollInterval)
      } else {
        // Timeout — show a manual redirect hint
        setupRestarting = false
        setupError = 'Server is taking longer than expected. Please refresh the page.'
      }
    }

    // Wait a moment for the server to begin restarting before polling
    setTimeout(poll, 1500)
  }

  async function submitLogin() {
    if (!totpCode.trim() || loginLoading) return
    loginLoading = true
    loginError = ''
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          totpCode: totpCode.trim(),
        })
      })
      const data = await res.json()
      if (res.ok) {
        isOwner = true
        wantsLogin = false
        totpCode = ''
        // Redirect to owner dashboard
        window.history.replaceState({}, '', '/')
        // Start polling owner data
        fetchBackgroundTasks()
        fetchSubAgents()
      } else {
        loginError = data.error || 'Login failed'
      }
    } catch {
      loginError = 'Could not reach Tiny Claw server'
    }
    loginLoading = false
  }

  function handleLoginKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitLogin()
    }
  }

  function handleRecoveryLockout(errorMsg) {
    recoveryLocked = true
    recoveryError = errorMsg
    // Extract seconds from error like "Try again in 60 seconds."
    const match = errorMsg.match(/(\d+)\s*seconds/)
    if (match) {
      let remaining = parseInt(match[1], 10)
      if (recoveryLockTimer) clearInterval(recoveryLockTimer)
      recoveryLockTimer = setInterval(() => {
        remaining--
        if (remaining <= 0) {
          clearInterval(recoveryLockTimer)
          recoveryLockTimer = null
          recoveryLocked = false
          recoveryError = ''
        } else {
          recoveryError = `Too many attempts. Try again in ${remaining} seconds.`
        }
      }, 1000)
    }
  }

  async function submitRecoveryToken() {
    if (!recoveryToken.trim() || recoveryLoading || recoveryLocked) return
    recoveryLoading = true
    recoveryError = ''
    try {
      const res = await fetch('/api/recovery/validate-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: recoveryToken.trim() })
      })
      const data = await res.json()
      if (res.ok) {
        recoverySessionId = data.recoverySessionId
        recoveryPhase = 'backup'
        recoveryToken = ''
      } else if (res.status === 403) {
        recoveryPermanentlyBlocked = true
        recoveryLocked = true
        recoveryError = 'Access permanently blocked.'
      } else if (res.status === 429) {
        handleRecoveryLockout(data.error || 'Too many attempts.')
      } else {
        recoveryError = data.error || 'Invalid token.'
      }
    } catch {
      recoveryError = 'Could not reach Tiny Claw server'
    }
    recoveryLoading = false
  }

  async function submitRecoveryBackup() {
    if (!recoveryBackupCode.trim() || recoveryLoading || recoveryLocked) return
    recoveryLoading = true
    recoveryError = ''
    try {
      const res = await fetch('/api/recovery/use-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recoverySessionId,
          backupCode: recoveryBackupCode.trim(),
        })
      })
      const data = await res.json()
      if (res.ok) {
        recoverySuccess = true
        recoveryBackupCode = ''
        recoveryBackupCodesRemaining = data.backupCodesRemaining ?? 0
        // Transition to TOTP re-setup prompt
        recoveryPhase = 'totp-setup'
      } else if (res.status === 403) {
        recoveryPermanentlyBlocked = true
        recoveryLocked = true
        recoveryError = 'Access permanently blocked.'
      } else if (res.status === 429) {
        handleRecoveryLockout(data.error || 'Too many attempts.')
      } else {
        recoveryError = data.error || 'Invalid code.'
      }
    } catch {
      recoveryError = 'Could not reach Tiny Claw server'
    }
    recoveryLoading = false
  }

  function handleRecoveryKeydown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (recoveryPhase === 'token') submitRecoveryToken()
      else if (recoveryPhase === 'backup') submitRecoveryBackup()
      else if (recoveryPhase === 'totp-confirm') submitReenrollTotp()
    }
  }

  /** Start TOTP re-enrollment — request a new TOTP secret from the server. */
  async function startTotpReenroll() {
    reenrollLoading = true
    reenrollError = ''
    try {
      const res = await fetch('/api/owner/totp-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await res.json()
      if (res.ok) {
        reenrollToken = data.reenrollToken
        reenrollTotpSecret = data.totpSecret
        reenrollTotpUri = data.totpUri
        if (reenrollTotpUri) {
          reenrollTotpQrUrl = await QRCode.toDataURL(reenrollTotpUri, { width: 200, margin: 2 })
        }
        recoveryPhase = 'totp-confirm'
      } else {
        reenrollError = data.error || 'Failed to start TOTP setup.'
      }
    } catch {
      reenrollError = 'Could not reach Tiny Claw server.'
    }
    reenrollLoading = false
  }

  /** Confirm TOTP re-enrollment — verify code and get new backup codes + recovery token. */
  async function submitReenrollTotp() {
    if (!reenrollTotpCode.trim() || reenrollLoading) return
    reenrollLoading = true
    reenrollError = ''
    try {
      const res = await fetch('/api/owner/totp-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reenrollToken,
          totpCode: reenrollTotpCode.trim(),
        })
      })
      const data = await res.json()
      if (res.ok) {
        reenrollBackupCodes = data.backupCodes || []
        reenrollRecoveryToken = data.recoveryToken || ''
        recoveryPhase = 'new-codes'
      } else {
        reenrollError = data.error || 'Invalid code.'
      }
    } catch {
      reenrollError = 'Could not reach Tiny Claw server.'
    }
    reenrollLoading = false
  }

  /** Skip TOTP re-enrollment — go straight to dashboard. */
  async function skipTotpReenroll() {
    await checkAuth()
    if (isOwner) {
      wantsRecovery = false
      window.history.replaceState({}, '', '/')
      fetchBackgroundTasks()
      fetchSubAgents()
    }
  }

  /** Finish TOTP re-enrollment — go to dashboard after saving new codes. */
  async function finishReenrollAndEnter() {
    await checkAuth()
    if (isOwner) {
      wantsRecovery = false
      window.history.replaceState({}, '', '/')
      fetchBackgroundTasks()
      fetchSubAgents()
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

        // Detect newly completed/failed tasks and auto-inject results into chat.
        // On the very first fetch after page load, just seed the set so we
        // don't re-inject results the user already saw before the refresh.
        for (const task of newTasks) {
          if (
            (task.status === 'completed' || task.status === 'failed') &&
            !shownCompletionIds.has(task.id)
          ) {
            markCompletionShown(task.id)
            if (initialFetchDone) {
              injectBackgroundResult(task)
            }
          }
        }
        initialFetchDone = true

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

    const endpoint = '/api/chat'
    const body = { message, userId, stream: true }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json'
      },
      body: JSON.stringify(body)
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
      case 'running': case 'working': return 'bg-yellow'
      case 'completed': case 'delivered': return 'bg-green'
      case 'failed': return 'bg-red'
      case 'active': case 'idle': return 'bg-green'
      case 'suspended': return 'bg-yellow'
      case 'soft_deleted': case 'archived': return 'bg-text-muted'
      default: return 'bg-text-muted'
    }
  }

  function getAgentStatusLabel(agent) {
    // Check if this agent has a running background task
    const runningTask = backgroundTasks.find(t => t.agentId === agent.id && t.status === 'running')
    if (runningTask) return 'working'
    if (agent.status === 'soft_deleted') return 'archived'
    // Check if the last task failed (0 successes out of 1+ tasks)
    const lastTask = backgroundTasks.find(t => t.agentId === agent.id && t.status === 'failed')
    if (lastTask || (agent.totalTasks > 0 && agent.successfulTasks === 0)) return 'failed'
    // "Suspended" is the internal state for idle-after-task; show user-friendly label
    return 'idle'
  }

  function getHistoryLabel(agent) {
    // Contextual label for archived agents
    if (agent.totalTasks > 0 && agent.successfulTasks === 0) return 'failed'
    if (agent.totalTasks > 0 && agent.successfulTasks === agent.totalTasks) return 'completed'
    if (agent.totalTasks > 0) return 'partial' // some succeeded, some failed
    return 'dismissed'
  }

  function getHistoryColor(label) {
    switch (label) {
      case 'failed': return 'bg-red'
      case 'completed': return 'bg-green'
      case 'partial': return 'bg-yellow'
      default: return 'bg-text-muted'
    }
  }

  function getHistoryTextColor(label) {
    switch (label) {
      case 'failed': return 'text-red'
      case 'completed': return 'text-green'
      case 'partial': return 'text-yellow'
      default: return 'text-text-muted'
    }
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
  // Only truly active agents (with running work) show in Active Sub-Agents.
  // Suspended and soft_deleted agents go to History.
  let isFailedAgent = (a) => a.totalTasks > 0 && a.successfulTasks === 0
  let activeAgents = $derived(allAgents.filter(a => a.status === 'active'))
  let archivedAgents = $derived(allAgents.filter(a =>
    a.status === 'soft_deleted' || a.status === 'suspended'
  ))
  let workingAgents = $derived(
    activeAgents.filter(a => backgroundTasks.some(t => t.agentId === a.id && t.status === 'running'))
  )

  // Count for panel badge — include live delegation + agents with running tasks
  let runningBgTasks = $derived(backgroundTasks.filter(t => t.status === 'running').length)
  let activeAgentCount = $derived(
    workingAgents.length + (activeDelegation ? 1 : 0)
  )

  // Track delegation roles that have been completed/resulted across ALL messages.
  // Used to hide the spinner on "start" cards even when the completion event
  // lands in a different message (e.g. after an approval flow).
  let completedDelegationRoles = $derived(
    new Set(
      messages.flatMap(m =>
        (m.delegationEvents || [])
          .filter(e => e.type === 'complete' || e.type === 'result')
          .map(e => e.role)
      )
    )
  )
</script>

<div class="h-full flex flex-col bg-bg-tertiary">
{#if view === 'loading'}
  <!-- Loading State -->
  <div class="flex-1 flex items-center justify-center">
    <div class="flex flex-col items-center gap-4">
      <div class="delegation-spinner w-10 h-10 border-3 border-brand/30 border-t-brand rounded-full"></div>
      <span class="text-text-muted text-sm">Connecting to Tiny Claw...</span>
    </div>
  </div>


{:else if view === 'setup'}
  <!-- Setup Onboarding Page -->
  <div class="flex-1 overflow-y-auto bg-bg-primary">
  <div class="min-h-full flex items-center justify-center px-4 py-6">
    <div class="w-full max-w-xl flex flex-col items-center text-center">
      <div class="w-20 h-20 rounded-full bg-brand/20 flex items-center justify-center mb-6">
        <span class="text-4xl">🛡️</span>
      </div>
      <h1 class="text-2xl font-bold text-text-normal mb-2">Tiny Claw Setup</h1>

      {#if setupPhase === 'bootstrap'}
        <p class="text-text-muted text-sm mb-6">
          Enter the 30-character bootstrap secret from the Tiny Claw logs to claim ownership.
        </p>

        {#if setupError}
          <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
            {setupError}
          </div>
        {/if}

        <div class="w-full flex gap-2">
          <input
            bind:value={bootstrapSecret}
            onkeydown={handleBootstrapKeydown}
            type="text"
            placeholder="30-character bootstrap secret"
            class="flex-1 bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm font-mono uppercase"
            disabled={setupLoading}
          />
          <button
            onclick={submitBootstrap}
            disabled={setupLoading || !bootstrapSecret.trim()}
            class="px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {setupLoading ? 'Verifying...' : 'Continue'}
          </button>
        </div>

        <p class="text-text-muted/50 text-xs mt-4">
          The bootstrap secret is printed when Tiny Claw starts and expires after 1 hour.
        </p>
      {:else if setupPhase === 'form'}
        <p class="text-text-muted text-sm mb-5 w-full text-left">
          Complete the owner setup to enable the dashboard and secure access.
        </p>

        {#if setupError}
          <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm text-left">
            {setupError}
          </div>
        {/if}

        <div class="w-full p-4 rounded-lg bg-yellow/10 border border-yellow/30 text-left mb-4">
          <p class="text-yellow text-sm font-semibold mb-2">{SECURITY_WARNING_TITLE}</p>
          <p class="text-text-muted text-sm mb-3">{SECURITY_WARNING_BODY}</p>
          <p class="text-text-muted text-sm font-semibold mb-3">{SECURITY_LICENSE}</p>
          <p class="text-text-muted text-sm font-semibold mb-3">{SECURITY_WARRANTY}</p>
          <p class="text-text-muted text-sm font-semibold mb-1">{SECURITY_SAFETY_TITLE}</p>
          <ul class="text-text-muted text-sm list-disc list-inside mb-3">
            {#each SECURITY_SAFETY_PRACTICES as practice}
              <li>{practice}</li>
            {/each}
          </ul>
          <label class="mt-3 flex items-start gap-2 text-sm text-text-normal">
            <input type="checkbox" bind:checked={acceptedRisk} class="mt-1" />
            <span>{SECURITY_CONFIRM}.</span>
          </label>
        </div>

        <div class="w-full p-4 rounded-lg bg-bg-secondary border border-bg-modifier-active text-left mb-4">
          <p class="text-text-normal text-sm font-semibold mb-1">Default Built-in Provider</p>
          <p class="text-text-muted text-sm whitespace-pre-line">{defaultModelNote(DEFAULT_MODEL)}</p>
        </div>

        <div class="w-full grid gap-3">
          <input
            bind:value={setupApiKey}
            type="password"
            placeholder="Enter your Ollama Cloud API key"
            class="w-full bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm"
            disabled={setupSubmitting}
          />
          <input
            bind:value={setupSoulSeed}
            type="text"
            placeholder="Soul Seed (optional; leave blank for random)"
            class="w-full bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm"
            disabled={setupSubmitting}
          />
        </div>

        <div class="w-full mt-4 p-4 rounded-lg bg-bg-secondary border border-bg-modifier-active text-left">
          <p class="text-text-normal text-sm font-semibold mb-2">{TOTP_SETUP_TITLE}</p>
          <p class="text-text-muted text-sm mb-2">{TOTP_SETUP_BODY}</p>
          {#if setupTotpQrUrl}
            <div class="flex justify-center mb-3">
              <img src={setupTotpQrUrl} alt="Scan this QR code with your authenticator app" class="rounded-lg" width="200" height="200" />
            </div>
          {/if}
          <p class="text-text-muted text-xs mb-1">Or enter the secret manually:</p>
          <p class="text-text-normal text-xs font-mono break-all mb-3">{setupTotpSecret}</p>
          <input
            bind:value={setupTotpCode}
            type="text"
            placeholder="Authenticator code"
            class="w-full bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm"
            disabled={setupSubmitting}
          />
        </div>

        <button
          onclick={submitSetup}
          disabled={setupSubmitting || !acceptedRisk || !setupApiKey.trim() || !setupTotpCode.trim()}
          class="w-full mt-4 px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {setupSubmitting ? 'Saving setup...' : 'Complete setup'}
        </button>
      {:else if setupPhase === 'backup-codes'}
        {#if setupRestarting}
          <!-- Restarting overlay -->
          <div class="w-full flex flex-col items-center justify-center py-12">
            <div class="delegation-spinner w-10 h-10 border-3 border-brand/30 border-t-brand rounded-full mb-4"></div>
            <p class="text-text-normal text-sm font-medium mb-1">Starting Tiny Claw agent...</p>
            <p class="text-text-muted text-xs">The server is restarting. You will be redirected automatically.</p>
          </div>
        {:else}
        <p class="text-text-muted text-sm mb-4">
          {BACKUP_CODES_INTRO}
        </p>

        <div class="w-full p-4 rounded-lg bg-bg-secondary border border-brand/30 text-left mb-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs text-brand font-semibold uppercase tracking-wider">Recovery Token</p>
            <button
              onclick={() => copyToClipboard(setupRecoveryToken, v => copiedRecoveryToken = v)}
              class="text-xs px-2 py-1 rounded transition-colors {copiedRecoveryToken ? 'bg-green/20 text-green' : 'bg-bg-primary text-text-muted hover:text-text-normal hover:bg-bg-modifier-active'}"
            >
              {copiedRecoveryToken ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div class="text-sm font-mono text-text-normal break-all select-all bg-bg-primary px-3 py-2 rounded">{setupRecoveryToken}</div>
          <p class="text-xs text-text-muted mt-2">{RECOVERY_TOKEN_HINT}</p>
        </div>

        <div class="w-full p-4 rounded-lg bg-bg-secondary border border-bg-modifier-active text-left mb-4 max-h-72 overflow-y-auto">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs text-text-muted font-semibold uppercase tracking-wider">Backup Codes</p>
            <button
              onclick={() => copyToClipboard(setupBackupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n'), v => copiedBackupCodes = v)}
              class="text-xs px-2 py-1 rounded transition-colors {copiedBackupCodes ? 'bg-green/20 text-green' : 'bg-bg-primary text-text-muted hover:text-text-normal hover:bg-bg-modifier-active'}"
            >
              {copiedBackupCodes ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          {#each setupBackupCodes as code, idx}
            <div class="text-sm font-mono text-text-normal py-1">{idx + 1}. {code}</div>
          {/each}
        </div>

        <p class="text-xs text-text-muted/60 mb-4">
          {BACKUP_CODES_HINT}
        </p>

        <div class="w-full flex flex-col gap-2">
          <button
            onclick={() => downloadCredentials(setupRecoveryToken, setupBackupCodes)}
            class="w-full px-5 py-3 bg-bg-secondary text-text-normal rounded-lg font-medium text-sm transition-colors hover:bg-bg-modifier-active border border-bg-modifier-active"
          >
            ⬇ Download recovery credentials
          </button>

          <button
            onclick={finishSetupAndEnter}
            disabled={setupRestarting}
            class="w-full px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            I stored my recovery token and backup codes
          </button>
        </div>
        {/if}
      {/if}
    </div>
  </div>
  </div>

{:else if view === 'login'}
  <!-- Owner Login Page — TOTP only -->
  <!-- Title Bar -->
  <div class="h-9 min-h-9 px-4 flex items-center bg-bg-titlebar border-b border-bg-modifier-active">
    <div class="flex items-center gap-2 md:absolute md:left-1/2 md:-translate-x-1/2">
      <span class="text-sm font-semibold text-text-normal tracking-wide">Tiny Claw 🐜</span>
      <span class="text-xs text-text-muted/50 font-medium">Beta</span>
      <span class="text-[10px] text-text-muted/30">v1.0.0</span>
      <span class="text-text-muted/30 text-xs">|</span>
      <span class="text-xs text-text-muted/50 font-medium">Owner Login</span>
    </div>
  </div>
  <div class="flex-1 flex items-center justify-center px-4">
    <div class="w-full max-w-sm flex flex-col items-center text-center">
      <div class="w-20 h-20 rounded-full bg-brand/20 flex items-center justify-center mb-6">
        <span class="text-4xl">🔑</span>
      </div>
      <h1 class="text-2xl font-bold text-text-normal mb-2">Owner Login</h1>
      <p class="text-text-muted text-sm mb-6">
        Enter your authenticator code.
      </p>

      {#if loginError}
        <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
          {loginError}
        </div>
      {/if}

      <div class="w-full flex flex-col gap-2">
        <input
          bind:value={totpCode}
          onkeydown={handleLoginKeydown}
          type="text"
          placeholder="Authenticator code"
          class="flex-1 bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm font-mono"
          disabled={loginLoading}
        />

        <button
          onclick={submitLogin}
          disabled={loginLoading || !totpCode.trim()}
          class="px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
        >
          {loginLoading ? 'Logging in...' : 'Login'}
        </button>
      </div>
    </div>
  </div>

{:else if view === 'recovery'}
  <!-- Recovery Page — token gate + backup code + TOTP re-setup -->
  <div class="flex-1 flex items-center justify-center px-4">
    <div class="w-full max-w-sm flex flex-col items-center text-center">
      <div class="w-20 h-20 rounded-full bg-red/20 flex items-center justify-center mb-6">
        <span class="text-4xl">{recoveryPhase === 'new-codes' ? '✅' : recoveryPhase === 'totp-setup' || recoveryPhase === 'totp-confirm' ? '🔧' : '🔐'}</span>
      </div>

      {#if recoveryPhase === 'totp-setup'}
        <!-- TOTP Re-setup Prompt -->
        <h1 class="text-2xl font-bold text-text-normal mb-2">Set Up New Authenticator</h1>
        <p class="text-text-muted text-sm mb-2">
          You recovered access using a backup code. Set up a new authenticator to secure your account.
        </p>
        <p class="text-text-muted text-sm mb-6">
          {#if recoveryBackupCodesRemaining <= 1}
            <span class="text-red font-semibold">This was your last backup code. You must set up a new authenticator to continue.</span>
          {:else}
            You have <span class="text-brand font-semibold">{recoveryBackupCodesRemaining}</span> backup code{recoveryBackupCodesRemaining === 1 ? '' : 's'} remaining.
          {/if}
        </p>

        {#if reenrollError}
          <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
            {reenrollError}
          </div>
        {/if}

        <button
          onclick={startTotpReenroll}
          disabled={reenrollLoading}
          class="w-full px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {reenrollLoading ? 'Generating...' : 'Set up new authenticator'}
        </button>

        {#if recoveryBackupCodesRemaining > 1}
          <button
            onclick={skipTotpReenroll}
            class="w-full mt-3 px-5 py-3 bg-transparent text-text-muted rounded-lg font-medium text-sm transition-colors hover:text-text-normal hover:bg-bg-secondary border border-bg-modifier-active"
          >
            Skip for now
          </button>
        {/if}

      {:else if recoveryPhase === 'totp-confirm'}
        <!-- TOTP verification step -->
        <h1 class="text-2xl font-bold text-text-normal mb-2">Verify Authenticator</h1>
        <p class="text-text-muted text-sm mb-4">
          Add this key to your authenticator app, then enter the code it generates.
        </p>

        <div class="w-full p-4 rounded-lg bg-bg-secondary border border-bg-modifier-active text-left mb-4">
          {#if reenrollTotpQrUrl}
            <div class="flex justify-center mb-3">
              <img src={reenrollTotpQrUrl} alt="Scan this QR code with your authenticator app" class="rounded-lg" width="200" height="200" />
            </div>
          {/if}
          <p class="text-text-muted text-xs mb-1">Or enter the secret manually:</p>
          <p class="text-text-normal text-xs font-mono break-all mb-1">{reenrollTotpSecret}</p>
        </div>

        {#if reenrollError}
          <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
            {reenrollError}
          </div>
        {/if}

        <div class="w-full flex flex-col gap-2">
          <input
            bind:value={reenrollTotpCode}
            onkeydown={handleRecoveryKeydown}
            type="text"
            placeholder="Authenticator code"
            class="flex-1 bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm font-mono"
            disabled={reenrollLoading}
          />

          <button
            onclick={submitReenrollTotp}
            disabled={reenrollLoading || !reenrollTotpCode.trim()}
            class="px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {reenrollLoading ? 'Verifying...' : 'Confirm'}
          </button>
        </div>

      {:else if recoveryPhase === 'new-codes'}
        <!-- New backup codes + recovery token display -->
        <h1 class="text-2xl font-bold text-text-normal mb-2">New Credentials</h1>
        <p class="text-text-muted text-sm mb-4">
          Your authenticator has been updated. Save your new recovery token and backup codes now.
        </p>

        <div class="w-full p-4 rounded-lg bg-bg-secondary border border-brand/30 text-left mb-4">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs text-brand font-semibold uppercase tracking-wider">Recovery Token</p>
            <button
              onclick={() => copyToClipboard(reenrollRecoveryToken, v => copiedReenrollRecoveryToken = v)}
              class="text-xs px-2 py-1 rounded transition-colors {copiedReenrollRecoveryToken ? 'bg-green/20 text-green' : 'bg-bg-primary text-text-muted hover:text-text-normal hover:bg-bg-modifier-active'}"
            >
              {copiedReenrollRecoveryToken ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div class="text-sm font-mono text-text-normal break-all select-all bg-bg-primary px-3 py-2 rounded">{reenrollRecoveryToken}</div>
          <p class="text-xs text-text-muted mt-2">Go to <span class="text-brand font-mono">/recovery</span> and enter this token to start the recovery process.</p>
        </div>

        <div class="w-full p-4 rounded-lg bg-bg-secondary border border-bg-modifier-active text-left mb-4 max-h-72 overflow-y-auto">
          <div class="flex items-center justify-between mb-2">
            <p class="text-xs text-text-muted font-semibold uppercase tracking-wider">Backup Codes</p>
            <button
              onclick={() => copyToClipboard(reenrollBackupCodes.map((c, i) => `${i + 1}. ${c}`).join('\n'), v => copiedReenrollBackupCodes = v)}
              class="text-xs px-2 py-1 rounded transition-colors {copiedReenrollBackupCodes ? 'bg-green/20 text-green' : 'bg-bg-primary text-text-muted hover:text-text-normal hover:bg-bg-modifier-active'}"
            >
              {copiedReenrollBackupCodes ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          {#each reenrollBackupCodes as code, idx}
            <div class="text-sm font-mono text-text-normal py-1">{idx + 1}. {code}</div>
          {/each}
        </div>

        <p class="text-xs text-text-muted/60 mb-4">
          Each backup code can only be used once. Your old codes are no longer valid.
        </p>

        <div class="w-full flex flex-col gap-2">
          <button
            onclick={() => downloadCredentials(reenrollRecoveryToken, reenrollBackupCodes)}
            class="w-full px-5 py-3 bg-bg-secondary text-text-normal rounded-lg font-medium text-sm transition-colors hover:bg-bg-modifier-active border border-bg-modifier-active"
          >
            ⬇ Download recovery credentials
          </button>

          <button
            onclick={finishReenrollAndEnter}
            class="w-full px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80"
          >
            I stored my recovery token and backup codes
          </button>
        </div>

      {:else if recoveryPhase === 'token'}
        <h1 class="text-2xl font-bold text-text-normal mb-2">Account Recovery</h1>
        <p class="text-text-muted text-sm mb-6">
          Enter your recovery token to continue.
        </p>

        {#if recoveryError}
          <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
            {recoveryError}
          </div>
        {/if}

        <div class="w-full flex flex-col gap-2">
          <input
            bind:value={recoveryToken}
            onkeydown={handleRecoveryKeydown}
            type="text"
            placeholder="Recovery token"
            class="flex-1 bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm font-mono uppercase"
            disabled={recoveryLoading || recoveryLocked}
          />

          <button
            onclick={submitRecoveryToken}
            disabled={recoveryLoading || recoveryLocked || !recoveryToken.trim()}
            class="px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {recoveryLoading ? 'Verifying...' : 'Continue'}
          </button>
        </div>
      {:else if recoveryPhase === 'backup'}
        <h1 class="text-2xl font-bold text-text-normal mb-2">Enter Backup Code</h1>
        <p class="text-text-muted text-sm mb-6">
          Enter one of your backup codes to regain access.
        </p>

        {#if recoveryError}
          <div class="w-full mb-4 px-3 py-2 bg-red/10 border border-red/30 rounded-lg text-red text-sm">
            {recoveryError}
          </div>
        {/if}

        <div class="w-full flex flex-col gap-2">
          <input
            bind:value={recoveryBackupCode}
            onkeydown={handleRecoveryKeydown}
            type="text"
            placeholder="Backup code"
            class="flex-1 bg-input-bg text-text-normal placeholder-text-muted px-4 py-3 rounded-lg outline-none border border-transparent focus:border-brand/50 text-sm font-mono uppercase"
            disabled={recoveryLoading || recoveryLocked}
          />

          <button
            onclick={submitRecoveryBackup}
            disabled={recoveryLoading || recoveryLocked || !recoveryBackupCode.trim()}
            class="px-5 py-3 bg-brand text-white rounded-lg font-medium text-sm transition-colors hover:bg-brand/80 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          >
            {recoveryLoading ? 'Recovering...' : 'Recover Access'}
          </button>
        </div>
      {/if}

      {#if recoveryPhase === 'token' || recoveryPhase === 'backup'}
        <a
          href="/login"
          onclick={(e) => { e.preventDefault(); wantsRecovery = false; wantsLogin = true; window.history.replaceState({}, '', '/login'); }}
          class="mt-6 text-sm text-text-muted hover:text-text-normal"
        >
          Back to login
        </a>
      {/if}
    </div>
  </div>

{:else if view === 'landing'}
  <!-- Static Landing / Branding Page -->
  <div class="h-full flex flex-col relative">
    <!-- Top-right owner login icon -->
    <a
      href="/login"
      onclick={(e) => { e.preventDefault(); wantsLogin = true; window.history.pushState({}, '', '/login'); }}
      class="absolute top-4 right-4 p-2 rounded-lg hover:bg-bg-modifier-hover transition-colors group z-10"
      title="Owner Login"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 text-text-muted group-hover:text-brand transition-colors">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <polyline points="10 17 15 12 10 7" />
        <line x1="15" y1="12" x2="3" y2="12" />
      </svg>
    </a>

    <!-- Centered branding -->
    <div class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-4 select-none">
        <span class="text-6xl">🐜</span>
        <div class="flex flex-col items-center gap-1">
          <h1 class="text-3xl font-bold text-text-normal tracking-wide">Tiny Claw</h1>
          <div class="flex items-center gap-2">
            <span class="text-sm text-text-muted/60 font-medium">Beta</span>
            <span class="text-xs text-text-muted/30">v1.0.0</span>
          </div>
        </div>
        <p class="text-text-muted/50 text-sm mt-2">Autonomous AI Agent Framework</p>
      </div>
    </div>
  </div>

{:else}
  <!-- Owner Dashboard (full view) -->
  <!-- Title Bar -->
  <div class="h-9 min-h-9 px-4 flex items-center bg-bg-titlebar border-b border-bg-modifier-active">
    <div class="flex items-center gap-2 md:absolute md:left-1/2 md:-translate-x-1/2">
      <span class="text-sm font-semibold text-text-normal tracking-wide">Tiny Claw 🐜</span>
      <span class="text-xs text-text-muted/50 font-medium">Beta</span>
      <span class="text-[10px] text-text-muted/30">v1.0.0</span>
      <span class="text-text-muted/30 text-xs">|</span>
      <span class="text-xs text-text-muted/50 font-medium">Owner</span>
    </div>
    <div class="ml-auto flex items-center gap-1 md:gap-2">
      <a
        href="https://github.com/warengonzaga/tinyclaw"
        target="_blank"
        rel="noopener noreferrer"
        class="titlebar-link flex items-center gap-1.5 p-1.5 md:px-2 md:py-1 rounded hover:bg-bg-modifier-hover text-xs"
        title="Star on GitHub"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
          <path fill-rule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clip-rule="evenodd" />
        </svg>
        <span class="hidden md:inline">Star</span>
      </a>
      <a
        href="https://github.com/sponsors/warengonzaga"
        target="_blank"
        rel="noopener noreferrer"
        class="titlebar-link flex items-center gap-1.5 p-1.5 md:px-2 md:py-1 rounded hover:bg-bg-modifier-hover text-xs"
        title="Sponsor"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5">
          <path d="M9.653 16.915l-.005-.003-.019-.01a20.759 20.759 0 01-1.162-.682 22.045 22.045 0 01-2.582-1.9C4.045 12.733 2 10.352 2 7.5a4.5 4.5 0 018-2.828A4.5 4.5 0 0118 7.5c0 2.852-2.044 5.233-3.885 6.82a22.049 22.049 0 01-3.744 2.582l-.019.01-.005.003h-.002a.723.723 0 01-.692 0h-.002z" />
        </svg>
        <span class="hidden md:inline">Sponsor</span>
      </a>
      <a
        href="https://github.com/warengonzaga/tinyclaw/blob/main/CONTRIBUTING.md"
        target="_blank"
        rel="noopener noreferrer"
        class="titlebar-link flex items-center gap-1.5 p-1.5 md:px-2 md:py-1 rounded hover:bg-bg-modifier-hover text-xs"
        title="Contribute"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" class="w-3.5 h-3.5">
          <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
        </svg>
        <span class="hidden md:inline">Contribute</span>
      </a>
    </div>
  </div>

  <!-- Profile Bar -->
  <div class="h-12 min-h-12 px-4 flex items-center border-b border-bg-modifier-active bg-bg-tertiary shadow-sm">
    <div class="flex items-center gap-2.5">
      <AvatarLed size={32} {status} />
      <div class="flex flex-col">
        <span class="text-sm font-semibold text-text-normal leading-tight">Tiny Claw</span>
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
  <div class="flex-1 flex min-h-0 relative">
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
            <span class="text-4xl">🐜</span>
          </div>
          <h2 class="text-2xl font-bold text-text-normal mb-2">Welcome to Tiny Claw</h2>
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
                    <span class="text-lg">🐜</span>
                  </div>
                {/if}
              </div>
              
              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-baseline gap-2">
                  <span class={`font-medium ${message.role === 'user' ? 'text-brand' : 'text-green'}`}>
                    {message.role === 'user' ? 'You' : 'Tiny Claw'}
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
                        {@const hasCompleted = message.delegationEvents.some((e, j) => j > eventIdx && (e.type === 'complete' || e.type === 'result')) || completedDelegationRoles.has(event.role)}
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
                Tiny Claw is working...
              {:else}
                Tiny Claw is thinking...
              {/if}
            </span>
          {/if}
        </div>
      </form>
    </div>
  </div>

  <!-- Right Sidebar: Profile Panel -->
    {#if showPanel}
      <div class="panel-overlay md:hidden" onclick={() => showPanel = false} role="presentation"></div>
    {/if}
    <div class="panel-sidebar {showPanel ? 'panel-open' : ''} border-bg-modifier-active bg-bg-secondary overflow-hidden">
      <div class="w-72 flex flex-col h-full">
      <!-- Banner -->
      <div class="h-16 min-h-16 bg-brand"></div>

      <!-- Avatar overlapping banner -->
      <div class="px-4 -mt-8 mb-2">
        <AvatarLed size={64} {status} ringColor="var(--color-bg-secondary)" cutoutColor="var(--color-bg-secondary)" />
      </div>

      <!-- Name -->
      <div class="px-4 mb-3">
        <h2 class="text-lg font-bold text-text-normal">Tiny Claw</h2>
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
        <!-- Active Sub-Agents row -->
        <div class="px-4 py-3 flex items-center justify-between cursor-default">
          <span class="text-sm text-text-normal">Active Sub-Agents — {activeAgents.length + (activeDelegation ? 1 : 0)}</span>
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
                    <span class={`w-2 h-2 rounded-full flex-shrink-0 ${getStatusColor(statusLabel)}`}></span>
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
                  <span class={statusLabel === 'working' ? 'text-brand' : statusLabel === 'failed' ? 'text-red' : 'capitalize'}>{statusLabel}</span>
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
          <span class="text-sm text-text-normal">Background Tasks — {runningBgTasks}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-text-muted">
            <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
          </svg>
        </div>
        {#if runningBgTasks > 0}
          <div class="px-3 pb-2 space-y-1.5">
            {#each backgroundTasks.filter(t => t.status === 'running') as task (task.id)}
              <div class="flex items-center gap-2 px-1">
                <div class="delegation-spinner w-2.5 h-2.5 border-2 border-brand/30 border-t-brand rounded-full flex-shrink-0"></div>
                <span class="text-xs text-text-muted truncate">{task.taskDescription || 'Working...'}</span>
              </div>
            {/each}
          </div>
        {/if}

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
                {@const historyLabel = getHistoryLabel(agent)}
                <div class="p-2.5 rounded-lg bg-bg-tertiary opacity-60">
                  <div class="flex items-center gap-2">
                    <span class={`w-2 h-2 rounded-full flex-shrink-0 ${getHistoryColor(historyLabel)}`}></span>
                    <span class="text-sm font-medium text-text-muted truncate">{agent.role}</span>
                  </div>
                  <div class="flex items-center gap-3 mt-1.5 text-xs text-text-muted">
                    <span title="Performance">{((agent.performanceScore || 0) * 100).toFixed(0)}%</span>
                    <span title="Tasks">{agent.successfulTasks || 0}/{agent.totalTasks || 0} tasks</span>
                    <span class={getHistoryTextColor(historyLabel)}>{historyLabel}</span>
                    <span class="text-text-muted">· archived</span>
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
    </div>
  </div>
{/if}
</div>
