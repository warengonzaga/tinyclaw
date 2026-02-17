<script>
  import { onMount } from 'svelte'

  let { soulTraits = null, onComplete = () => {} } = $props()

  // Animation phases: 'ants' → 'egg-place' → 'ants-exit' → 'hatch' → 'card'
  let phase = $state('ants')
  let showButton = $state(false)
  let prefersReducedMotion = $state(false)

  // Ant configurations — each ant has a unique path, cargo, and timing
  const antConfigs = [
    { id: 1, cargo: 'none', startX: -8, startY: 20, endX: 55, endY: 48, delay: 0, duration: 4, exitX: 110, exitY: 15 },
    { id: 2, cargo: 'food-bread', startX: 110, startY: 35, endX: 65, endY: 52, delay: 0.3, duration: 3.8, exitX: -10, exitY: 30 },
    { id: 3, cargo: 'none', startX: -5, startY: 65, endX: 40, endY: 55, delay: 0.6, duration: 4.2, exitX: 110, exitY: 70 },
    { id: 4, cargo: 'food-apple', startX: 110, startY: 75, endX: 60, endY: 58, delay: 0.2, duration: 3.5, exitX: -10, exitY: 80 },
    { id: 5, cargo: 'egg', startX: -8, startY: 45, endX: 50, endY: 50, delay: 0.8, duration: 4.5, exitX: -10, exitY: 40 },
    { id: 6, cargo: 'none', startX: 110, startY: 15, endX: 70, endY: 45, delay: 1.0, duration: 3.6, exitX: 110, exitY: 20 },
    { id: 7, cargo: 'food-bread', startX: -5, startY: 80, endX: 35, endY: 60, delay: 0.4, duration: 4.0, exitX: -10, exitY: 85 },
    { id: 8, cargo: 'none', startX: 110, startY: 55, endX: 45, endY: 53, delay: 1.2, duration: 3.9, exitX: 110, exitY: 50 },
    { id: 9, cargo: 'food-apple', startX: -8, startY: 30, endX: 55, endY: 47, delay: 0.5, duration: 4.3, exitX: -10, exitY: 25 },
    { id: 10, cargo: 'none', startX: 110, startY: 85, endX: 50, endY: 56, delay: 0.7, duration: 3.7, exitX: 110, exitY: 90 },
    { id: 11, cargo: 'none', startX: -5, startY: 55, endX: 42, endY: 51, delay: 1.1, duration: 4.1, exitX: -10, exitY: 60 },
    { id: 12, cargo: 'food-bread', startX: 110, startY: 45, endX: 58, endY: 54, delay: 0.9, duration: 3.4, exitX: 110, exitY: 40 },
  ]

  function getCargoEmoji(cargo) {
    switch (cargo) {
      case 'egg': return '🥚'
      case 'food-bread': return '🍞'
      case 'food-apple': return '🍎'
      default: return ''
    }
  }

  // Personality trait percentage (0.0-1.0 → 0-100)
  function traitPercent(value) {
    return Math.round((value ?? 0) * 100)
  }

  // Format seed as serial number
  function formatSeedSerial(seed) {
    return '#' + String(seed).padStart(8, '0')
  }

  // Personality trait labels
  const traitLabels = {
    openness: 'Openness',
    conscientiousness: 'Conscientiousness',
    extraversion: 'Extraversion',
    agreeableness: 'Agreeableness',
    emotionalSensitivity: 'Sensitivity',
  }

  onMount(() => {
    // Check reduced motion preference
    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const timers = []

    if (prefersReducedMotion) {
      // Skip directly to card reveal
      phase = 'card'
      timers.push(setTimeout(() => { showButton = true }, 800))
      return () => { timers.forEach(clearTimeout) }
    }

    // Phase 1: Ants crawl in (already started via 'ants' phase)
    // Phase 2: After ants arrive, egg ant places egg (5s)
    timers.push(setTimeout(() => {
      phase = 'egg-place'
    }, 5000))

    // Phase 3: All ants exit (8s mark)
    timers.push(setTimeout(() => {
      phase = 'ants-exit'
    }, 8000))

    // Phase 4: Egg hatches (11s mark)
    timers.push(setTimeout(() => {
      phase = 'hatch'
    }, 11000))

    // Phase 5: Card reveal (14s mark)
    timers.push(setTimeout(() => {
      phase = 'card'
    }, 14000))

    // Show button (15.5s mark)
    timers.push(setTimeout(() => {
      showButton = true
    }, 15500))

    return () => { timers.forEach(clearTimeout) }
  })

  function handleEnterColony() {
    onComplete()
  }

  // Derive display values from traits
  let agentName = $derived(soulTraits?.character?.suggestedName || 'Tiny Claw Agent')
  let signatureEmoji = $derived(soulTraits?.character?.signatureEmoji || '🐜')
  let creatureType = $derived(soulTraits?.character?.creatureType || 'Ant')
  let catchphrase = $derived(soulTraits?.character?.catchphrase || 'Ready to serve!')
  let seedSerial = $derived(formatSeedSerial(soulTraits?.seed ?? 0))
  let personality = $derived(soulTraits?.personality || {})
  let humor = $derived(soulTraits?.humor || 'none')
  let favoriteColor = $derived(soulTraits?.preferences?.favoriteColor || 'Brown')
  let favoriteSeason = $derived(soulTraits?.preferences?.favoriteSeason || 'Autumn')
  let values = $derived(soulTraits?.values || [])
  let quirks = $derived(soulTraits?.quirks || [])
  let originEvent = $derived(soulTraits?.origin?.awakeningEvent || 'Awakened from digital slumber')
  let coreMotivation = $derived(soulTraits?.origin?.coreMotivation || 'To help and explore')
</script>

<div class="hatching-container">
  <!-- Background darkness -->
  <div class="hatching-bg"></div>

  <!-- Ant Layer -->
  {#if phase === 'ants' || phase === 'egg-place' || phase === 'ants-exit'}
    <div class="ant-layer">
      {#each antConfigs as ant (ant.id)}
        <div
          class="ant-entity"
          class:ant-entering={phase === 'ants'}
          class:ant-settled={phase === 'egg-place'}
          class:ant-exiting={phase === 'ants-exit'}
          style="
            --start-x: {ant.startX}%;
            --start-y: {ant.startY}%;
            --end-x: {ant.endX}%;
            --end-y: {ant.endY}%;
            --exit-x: {ant.exitX}%;
            --exit-y: {ant.exitY}%;
            --delay: {ant.delay}s;
            --duration: {ant.duration}s;
            --flip: {ant.startX > 50 ? '-1' : '1'};
          "
        >
          <span class="ant-sprite" style="transform: scaleX(var(--flip));">🐜</span>
          {#if ant.cargo !== 'none' && !(ant.cargo === 'egg' && (phase === 'egg-place' || phase === 'ants-exit'))}
            <span class="ant-cargo">{getCargoEmoji(ant.cargo)}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- Egg at center -->
  {#if phase === 'egg-place' || phase === 'ants-exit' || phase === 'hatch'}
    <div class="egg-center" class:egg-shaking={phase === 'hatch'}>
      {#if phase !== 'hatch'}
        <span class="egg-emoji">🥚</span>
      {:else}
        <span class="egg-emoji egg-cracking">🥚</span>
        <span class="egg-hatched">🐣</span>
      {/if}
    </div>
  {/if}

  <!-- Card Reveal -->
  {#if phase === 'card'}
    <div class="card-reveal-container">
      <div class="soul-card">
        <!-- Holographic shimmer overlay -->
        <div class="holo-overlay"></div>

        <!-- Card content -->
        <div class="card-content">
          <!-- Profile header -->
          <div class="card-header">
            <div class="card-avatar">
              <span class="card-avatar-emoji">🐜</span>
              <span class="card-signature-emoji">{signatureEmoji}</span>
            </div>
            <h2 class="card-name">{agentName}</h2>
            <div class="card-creature-badge">{creatureType}</div>
          </div>

          <!-- Catchphrase -->
          <p class="card-catchphrase">"{catchphrase}"</p>

          <!-- Personality Stats -->
          <div class="card-stats">
            <div class="card-section-label">Personality Matrix</div>
            {#each Object.entries(traitLabels) as [key, label]}
              <div class="stat-row">
                <span class="stat-label">{label}</span>
                <div class="stat-bar-bg">
                  <div
                    class="stat-bar-fill"
                    style="--target-width: {traitPercent(personality[key])}%"
                  ></div>
                </div>
                <span class="stat-value">{traitPercent(personality[key])}</span>
              </div>
            {/each}
          </div>

          <!-- Flavor Section -->
          <div class="card-flavor">
            <div class="flavor-row">
              <span class="flavor-icon">🎨</span>
              <span class="flavor-text">{favoriteColor}</span>
            </div>
            <div class="flavor-row">
              <span class="flavor-icon">🌿</span>
              <span class="flavor-text">{favoriteSeason}</span>
            </div>
            <div class="flavor-row">
              <span class="flavor-icon">😄</span>
              <span class="flavor-text">{humor === 'none' ? 'Serious' : humor.replace('-', ' ')}</span>
            </div>
          </div>

          <!-- Origin -->
          <div class="card-origin">
            <div class="card-section-label">Origin</div>
            <p class="origin-text">{originEvent}</p>
            <p class="origin-motivation">"{coreMotivation}"</p>
          </div>

          <!-- Values & Quirks -->
          <div class="card-tags">
            {#each values as val}
              <span class="tag tag-value">{val}</span>
            {/each}
            {#each quirks as quirk}
              <span class="tag tag-quirk">{quirk}</span>
            {/each}
          </div>

          <!-- Serial Number -->
          <div class="card-serial">{seedSerial}</div>
        </div>
      </div>

      <!-- Enter Colony button -->
      {#if showButton}
        <button class="enter-colony-btn" onclick={handleEnterColony}>
          Enter Colony →
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .hatching-container {
    position: fixed;
    inset: 0;
    z-index: 100;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hatching-bg {
    position: absolute;
    inset: 0;
    background: #050505;
  }

  /* ============================================
     Ant Layer
     ============================================ */
  .ant-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .ant-entity {
    position: absolute;
    font-size: 1.8rem;
    display: flex;
    align-items: center;
    gap: 2px;
    z-index: 2;
  }

  .ant-entity.ant-entering {
    left: var(--start-x);
    top: var(--start-y);
    animation: ant-crawl-in var(--duration) var(--delay) ease-in-out forwards;
  }

  .ant-entity.ant-settled {
    left: var(--end-x);
    top: var(--end-y);
    animation: ant-idle 2s ease-in-out infinite;
  }

  .ant-entity.ant-exiting {
    left: var(--end-x);
    top: var(--end-y);
    animation: ant-crawl-out 2.5s ease-in forwards;
  }

  .ant-sprite {
    display: inline-block;
  }

  .ant-cargo {
    font-size: 1rem;
    position: relative;
    top: -8px;
  }

  /* ============================================
     Egg
     ============================================ */
  .egg-center {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 5;
    font-size: 3rem;
    animation: egg-settle 0.6s ease-out forwards;
  }

  .egg-emoji {
    display: inline-block;
  }

  .egg-shaking .egg-emoji {
    animation: egg-shake 2s ease-in-out forwards;
  }

  .egg-cracking {
    animation: egg-crack 1.5s 1.5s ease-out forwards !important;
  }

  .egg-hatched {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%) scale(0);
    font-size: 3.5rem;
    animation: chick-emerge 0.8s 2.5s ease-out forwards;
  }

  /* ============================================
     Card Reveal
     ============================================ */
  .card-reveal-container {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    animation: card-container-fade 0.5s ease-out forwards;
    max-height: 90vh;
    overflow-y: auto;
    padding: 1rem;
  }

  .soul-card {
    position: relative;
    width: 340px;
    max-width: 90vw;
    border-radius: 16px;
    overflow: hidden;
    animation: card-rise-in 1s ease-out forwards;
    box-shadow:
      0 0 30px rgba(139, 90, 43, 0.3),
      0 0 60px rgba(139, 90, 43, 0.15),
      0 4px 24px rgba(0, 0, 0, 0.5);
  }

  /* Holographic shimmer border */
  .soul-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 16px;
    padding: 2px;
    background: conic-gradient(
      from var(--holo-angle, 0deg),
      #ff6b6b, #ffd93d, #6bcb77, #4d96ff, #9b59b6, #ff6b6b
    );
    mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    mask-composite: exclude;
    -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    animation: holo-rotate 3s linear infinite;
    z-index: 1;
  }

  .holo-overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(255, 107, 107, 0.05) 0%,
      rgba(255, 217, 61, 0.05) 20%,
      rgba(107, 203, 119, 0.05) 40%,
      rgba(77, 150, 255, 0.05) 60%,
      rgba(155, 89, 182, 0.05) 80%,
      rgba(255, 107, 107, 0.05) 100%
    );
    background-size: 200% 200%;
    animation: holo-bg-shift 4s ease-in-out infinite;
    z-index: 2;
    pointer-events: none;
    border-radius: 16px;
  }

  .card-content {
    position: relative;
    z-index: 3;
    background: linear-gradient(180deg, #0f0f0f 0%, #141414 100%);
    border-radius: 14px;
    margin: 2px;
    padding: 1.25rem 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /* Card Header */
  .card-header {
    text-align: center;
    animation: card-content-stagger 0.6s 0.3s ease-out both;
  }

  .card-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .card-avatar-emoji {
    font-size: 3.5rem;
    filter: drop-shadow(0 2px 8px rgba(139, 90, 43, 0.4));
  }

  .card-signature-emoji {
    font-size: 1.5rem;
    opacity: 0.8;
  }

  .card-name {
    font-size: 1.35rem;
    font-weight: 700;
    color: #e0e0e0;
    margin: 0;
    letter-spacing: 0.02em;
  }

  .card-creature-badge {
    display: inline-block;
    margin-top: 0.35rem;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: rgba(139, 90, 43, 0.2);
    border: 1px solid rgba(139, 90, 43, 0.3);
    color: #c98540;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  /* Catchphrase */
  .card-catchphrase {
    text-align: center;
    font-style: italic;
    color: #8a8a8a;
    font-size: 0.8rem;
    margin: 0;
    animation: card-content-stagger 0.6s 0.5s ease-out both;
  }

  /* Stats Section */
  .card-stats {
    animation: card-content-stagger 0.6s 0.7s ease-out both;
  }

  .card-section-label {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #c98540;
    margin-bottom: 0.4rem;
  }

  .stat-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .stat-label {
    font-size: 0.7rem;
    color: #8a8a8a;
    width: 100px;
    flex-shrink: 0;
    text-align: right;
  }

  .stat-bar-bg {
    flex: 1;
    height: 6px;
    background: #1e1e1e;
    border-radius: 3px;
    overflow: hidden;
  }

  .stat-bar-fill {
    height: 100%;
    width: 0%;
    border-radius: 3px;
    background: linear-gradient(90deg, #8b5a2b, #c98540);
    animation: stat-fill-anim 1s 1.2s ease-out forwards;
  }

  .stat-value {
    font-size: 0.65rem;
    color: #8a8a8a;
    width: 24px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* Flavor */
  .card-flavor {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    animation: card-content-stagger 0.6s 0.9s ease-out both;
  }

  .flavor-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .flavor-icon {
    font-size: 0.85rem;
  }

  .flavor-text {
    font-size: 0.7rem;
    color: #8a8a8a;
    text-transform: capitalize;
  }

  /* Origin */
  .card-origin {
    animation: card-content-stagger 0.6s 1.1s ease-out both;
  }

  .origin-text {
    font-size: 0.75rem;
    color: #a0a0a0;
    margin: 0 0 0.25rem;
    line-height: 1.4;
  }

  .origin-motivation {
    font-size: 0.7rem;
    color: #c98540;
    font-style: italic;
    margin: 0;
  }

  /* Tags */
  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    justify-content: center;
    animation: card-content-stagger 0.6s 1.3s ease-out both;
  }

  .tag {
    font-size: 0.6rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    font-weight: 500;
  }

  .tag-value {
    background: rgba(107, 203, 119, 0.12);
    color: #6bcb77;
    border: 1px solid rgba(107, 203, 119, 0.2);
  }

  .tag-quirk {
    background: rgba(155, 89, 182, 0.12);
    color: #bb9cdb;
    border: 1px solid rgba(155, 89, 182, 0.2);
  }

  /* Serial Number */
  .card-serial {
    text-align: center;
    font-size: 0.6rem;
    color: #4a4a4a;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.12em;
    padding-top: 0.5rem;
    border-top: 1px solid #1e1e1e;
    animation: card-content-stagger 0.6s 1.5s ease-out both;
  }

  /* Enter Colony Button */
  .enter-colony-btn {
    padding: 0.75rem 2rem;
    border: 1px solid rgba(139, 90, 43, 0.4);
    border-radius: 8px;
    background: rgba(139, 90, 43, 0.15);
    color: #c98540;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    animation: btn-fade-in 0.8s ease-out both;
    letter-spacing: 0.02em;
  }

  .enter-colony-btn:hover {
    background: rgba(139, 90, 43, 0.25);
    border-color: rgba(139, 90, 43, 0.6);
    box-shadow: 0 0 20px rgba(139, 90, 43, 0.2);
  }

  .enter-colony-btn:active {
    transform: scale(0.97);
  }

  /* ============================================
     Keyframe Animations
     ============================================ */

  @keyframes ant-crawl-in {
    0% {
      left: var(--start-x);
      top: var(--start-y);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    100% {
      left: var(--end-x);
      top: var(--end-y);
      opacity: 1;
    }
  }

  @keyframes ant-idle {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
  }

  @keyframes ant-crawl-out {
    0% {
      left: var(--end-x);
      top: var(--end-y);
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      left: var(--exit-x);
      top: var(--exit-y);
      opacity: 0;
    }
  }

  @keyframes egg-settle {
    0% {
      transform: translate(-50%, -50%) scale(0.3);
      opacity: 0;
    }
    60% {
      transform: translate(-50%, -50%) scale(1.1);
      opacity: 1;
    }
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
  }

  @keyframes egg-shake {
    0%   { transform: translate(-50%, -50%) rotate(0deg); }
    10%  { transform: translate(-50%, -50%) rotate(3deg); }
    20%  { transform: translate(-50%, -50%) rotate(-3deg); }
    30%  { transform: translate(-50%, -50%) rotate(5deg); }
    40%  { transform: translate(-50%, -50%) rotate(-5deg); }
    50%  { transform: translate(-50%, -50%) rotate(8deg); }
    60%  { transform: translate(-50%, -50%) rotate(-8deg); }
    70%  { transform: translate(-50%, -50%) rotate(10deg); }
    80%  { transform: translate(-50%, -50%) rotate(-10deg); }
    85%  { transform: translate(-50%, -50%) rotate(12deg); }
    90%  { transform: translate(-50%, -50%) rotate(-12deg); }
    95%  { transform: translate(-50%, -50%) rotate(0deg) scale(1.1); }
    100% { transform: translate(-50%, -50%) rotate(0deg) scale(1.15); }
  }

  @keyframes egg-crack {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(1.2);
    }
    100% {
      opacity: 0;
      transform: scale(1.5);
    }
  }

  @keyframes chick-emerge {
    0% {
      transform: translate(-50%, -50%) scale(0);
      opacity: 0;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.3);
      opacity: 1;
    }
    70% {
      transform: translate(-50%, -50%) scale(0.9);
    }
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 1;
    }
  }

  @keyframes card-container-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes card-rise-in {
    0% {
      transform: scale(0.3) rotateY(30deg);
      opacity: 0;
    }
    60% {
      transform: scale(1.05) rotateY(-5deg);
      opacity: 1;
    }
    80% {
      transform: scale(0.98) rotateY(2deg);
    }
    100% {
      transform: scale(1) rotateY(0deg);
      opacity: 1;
    }
  }

  @keyframes card-content-stagger {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes holo-rotate {
    to {
      --holo-angle: 360deg;
    }
  }

  @keyframes holo-bg-shift {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }

  @keyframes stat-fill-anim {
    from { width: 0%; }
    to { width: var(--target-width); }
  }

  @keyframes btn-fade-in {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Register custom property for conic gradient animation */
  @property --holo-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  /* ============================================
     Reduced Motion
     ============================================ */
  @media (prefers-reduced-motion: reduce) {
    .soul-card,
    .card-content *,
    .enter-colony-btn,
    .card-reveal-container {
      animation-duration: 0.01s !important;
      animation-delay: 0s !important;
    }

    .soul-card::before {
      animation: none;
    }

    .holo-overlay {
      animation: none;
    }

    .stat-bar-fill {
      animation-duration: 0.01s !important;
      animation-delay: 0s !important;
    }
  }
</style>
