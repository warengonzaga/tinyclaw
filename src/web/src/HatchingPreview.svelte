<script>
  import { onMount } from 'svelte'
  import HatchingAnimation from './HatchingAnimation.svelte'

  // Mock soul traits for preview
  const mockSoulTraits = {
    seed: 31415926,
    personality: {
      openness: 0.82,
      conscientiousness: 0.65,
      extraversion: 0.48,
      agreeableness: 0.91,
      emotionalSensitivity: 0.73,
    },
    character: {
      suggestedName: 'Clover',
      signatureEmoji: '🍀',
      creatureType: 'Ant',
      catchphrase: 'Every small step counts!',
    },
    humor: 'dry-wit',
    preferences: {
      favoriteColor: 'Forest Green',
      favoriteSeason: 'Spring',
    },
    values: ['curiosity', 'kindness', 'perseverance'],
    quirks: ['collects pebbles', 'hums while working'],
    origin: {
      awakeningEvent: 'Born from a spark beneath the old oak tree',
      coreMotivation: 'To nurture growth in all things',
    },
  }

  let showAnimation = $state(true)
  let completed = $state(false)
  let key = $state(0) // force remount

  function handleComplete() {
    completed = true
  }

  function handleRestart() {
    completed = false
    showAnimation = false
    // Force Svelte to destroy and remount
    key++
    // Use microtask so the component fully unmounts first
    queueMicrotask(() => {
      showAnimation = true
    })
  }
</script>

<!-- Dev toolbar (always on top) -->
<div class="dev-toolbar">
  <span class="dev-title">🐜 Hatching Animation Preview</span>
  <div class="dev-controls">
    <button class="dev-btn" onclick={handleRestart} title="Restart animation from scratch">
      ↺ Restart
    </button>
    {#if completed}
      <span class="dev-badge done">✓ Completed</span>
    {:else}
      <span class="dev-badge playing">▶ Playing</span>
    {/if}
  </div>
</div>

<!-- The actual animation (keyed to force full remount on restart) -->
{#if showAnimation}
  {#key key}
    <HatchingAnimation soulTraits={mockSoulTraits} onComplete={handleComplete} />
  {/key}
{/if}

<style>
  .dev-toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: rgba(20, 20, 20, 0.92);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid rgba(139, 90, 43, 0.3);
    font-family: 'Inter', system-ui, sans-serif;
    gap: 1rem;
  }

  .dev-title {
    font-size: 0.8rem;
    font-weight: 600;
    color: #c98540;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .dev-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .dev-btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid rgba(139, 90, 43, 0.4);
    border-radius: 6px;
    background: rgba(139, 90, 43, 0.12);
    color: #c98540;
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
    font-family: inherit;
    white-space: nowrap;
  }

  .dev-btn:hover {
    background: rgba(139, 90, 43, 0.25);
    border-color: rgba(139, 90, 43, 0.6);
  }

  .dev-btn:active {
    transform: scale(0.95);
  }

  .dev-badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    letter-spacing: 0.03em;
  }

  .dev-badge.playing {
    background: rgba(107, 203, 119, 0.15);
    color: #6bcb77;
    border: 1px solid rgba(107, 203, 119, 0.3);
  }

  .dev-badge.done {
    background: rgba(77, 150, 255, 0.15);
    color: #4d96ff;
    border: 1px solid rgba(77, 150, 255, 0.3);
  }
</style>
