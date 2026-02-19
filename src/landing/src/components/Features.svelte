<script>
  const features = [
    {
      emoji: '💬',
      title: 'Discord-Like UI',
      description: 'Dark-themed web interface with real-time SSE streaming, typing indicators, inline delegation event cards, and an active agents sidebar.',
    },
    {
      emoji: '🧠',
      title: 'Adaptive Memory',
      description: '3-layer memory system (episodic, semantic FTS5, temporal decay) that learns what to remember and forget over time.',
    },
    {
      emoji: '🤖',
      title: 'Self-Improving',
      description: 'Behavioral pattern detection that makes the agent better with every interaction. It grows with you.',
    },
    {
      emoji: '🔌',
      title: 'Plugin Architecture',
      description: 'Channels, providers, and tools are all plugins. The core stays tiny — everything else is extensible.',
    },
    {
      emoji: '🎭',
      title: 'Heartware Personality',
      description: 'Built-in personality engine with SOUL.md and IDENTITY.md. Tiny Claw has its own character — it\'s a friend, not a tool.',
    },
    {
      emoji: '🧩',
      title: 'Smart Routing',
      description: '8-dimension query classifier that routes simple queries to cheap models and complex ones to powerful ones, cutting LLM costs.',
    },
    {
      emoji: '📐',
      title: 'Context Compactor',
      description: '4-layer context compaction pipeline with rule-based pre-compression, deduplication, LLM summarization, and tiered summaries.',
    },
    {
      emoji: '🛡️',
      title: 'SHIELD.md Anti-Malware',
      description: 'Runtime SHIELD.md enforcement engine with threat parsing, pattern matching, and built-in anti-malware protection.',
    },
    {
      emoji: '🔒',
      title: '5-Layer Security',
      description: 'Path sandbox, content validation, audit log, auto-backup, and rate limiting keep your data safe.',
    },
    {
      emoji: '🏗️',
      title: 'Delegation System',
      description: 'Autonomous sub-agent orchestration with self-improving role templates, blackboard collaboration, and adaptive timeouts.',
    },
    {
      emoji: '📡',
      title: 'Inter-Agent Comms',
      description: 'Lightweight pub/sub event bus for real-time inter-agent communication with wildcard subscriptions and bounded history.',
    },
    {
      emoji: '⚡',
      title: 'Bun-Native',
      description: 'Built on Bun for maximum performance and minimal footprint. Fast startup, low memory, native speed.',
    },
  ]
</script>

<section id="features" class="py-24 sm:py-32">
  <div class="mx-auto max-w-6xl px-6">
    <!-- Section header -->
    <div class="text-center mb-16">
      <h2 class="text-3xl sm:text-4xl font-bold tracking-tight">
        <span class="bg-gradient-to-r from-gradient-start to-gradient-end bg-clip-text text-transparent">Packed with Power</span>
      </h2>
      <p class="mt-4 text-lg text-text-muted max-w-2xl mx-auto">
        A single ant is tiny, but it's autonomous, it learns, it adapts, and it builds something greater over time.
      </p>
    </div>

    <!-- Feature grid -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {#each features as feature}
        <div class="group rounded-xl border border-border bg-bg-card p-6 transition-all hover:border-border-hover hover:bg-bg-card-hover hover:-translate-y-0.5">
          <div class="text-3xl mb-3 select-none">{feature.emoji}</div>
          <h3 class="text-base font-semibold text-text-normal mb-2">{feature.title}</h3>
          <p class="text-sm text-text-muted leading-relaxed">{feature.description}</p>
        </div>
      {/each}
    </div>
  </div>
</section>
