<script>
  import { onMount } from 'svelte'
  import { createHatchingScene } from './hatching-scene.js'

  let { soulTraits = null, onComplete = () => {} } = $props()

  let canvasEl = $state(null)
  let phase = $state('init')
  let showCard = $state(false)
  let showButton = $state(false)
  let prefersReducedMotion = $state(false)

  // 3D card tilt state (hover-based)
  let cardRotX = $state(0)
  let cardRotY = $state(0)
  let targetRotX = 0
  let targetRotY = 0
  let tiltRaf = null
  let pointerNormX = $state(0) // -0.5 to 0.5
  let pointerNormY = $state(0)

  // Personality trait percentage (0.0-1.0 → 0-100)
  function traitPercent(value) {
    return Math.round((value ?? 0) * 100)
  }

  // Format seed as serial number
  function formatSeedSerial(seed) {
    return '#' + String(seed).padStart(8, '0')
  }

  const traitLabels = {
    openness: 'Openness',
    conscientiousness: 'Conscientiousness',
    extraversion: 'Extraversion',
    agreeableness: 'Agreeableness',
    emotionalSensitivity: 'Sensitivity',
  }

  // ─── Card hover tilt interaction ────────────────────
  function onCardPointerMove(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    // Normalized position: -0.5 to 0.5 from center
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    pointerNormX = px
    pointerNormY = py
    targetRotY = px * 40     // ±20 degrees horizontal
    targetRotX = -py * 30    // ±15 degrees vertical (inverted)
    startTiltLoop()
  }

  function onCardPointerLeave() {
    targetRotX = 0
    targetRotY = 0
    pointerNormX = 0
    pointerNormY = 0
    startTiltLoop()
  }

  function startTiltLoop() {
    if (tiltRaf) return
    const step = () => {
      // Snappy easing — fast response, smooth settle
      cardRotX += (targetRotX - cardRotX) * 0.18
      cardRotY += (targetRotY - cardRotY) * 0.18
      if (Math.abs(targetRotX - cardRotX) < 0.05 && Math.abs(targetRotY - cardRotY) < 0.05) {
        cardRotX = targetRotX
        cardRotY = targetRotY
        tiltRaf = null
        return
      }
      tiltRaf = requestAnimationFrame(step)
    }
    tiltRaf = requestAnimationFrame(step)
  }

  // ─── Lifecycle ──────────────────────────────────────
  onMount(() => {
    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReducedMotion) {
      showCard = true
      setTimeout(() => { showButton = true }, 600)
      return () => {
        if (tiltRaf) cancelAnimationFrame(tiltRaf)
      }
    }

    const scene = createHatchingScene(canvasEl, {
      onPhaseChange(p) { phase = p },
      onReveal() {
        showCard = true
        setTimeout(() => { showButton = true }, 1800)
      },
    })
    scene.start()

    return () => {
      scene.destroy()
      if (tiltRaf) cancelAnimationFrame(tiltRaf)
    }
  })

  function handleGreet() {
    onComplete()
  }

  // ─── Derived display values ─────────────────────────
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

  // Holo gradient reacts strongly to card tilt
  let holoAngle = $derived(180 + cardRotY * 4)
  let holoBgPos = $derived(`${50 + cardRotY * 2.5}% ${50 - cardRotX * 2.5}%`)
  // Dynamic shadow shifts with tilt
  let cardShadowX = $derived(Math.round(-cardRotY * 0.8))
  let cardShadowY = $derived(Math.round(cardRotX * 0.8))
  // Specular glint position tracks pointer
  let glintX = $derived(50 + pointerNormX * 80)
  let glintY = $derived(50 + pointerNormY * 80)
  let glintOpacity = $derived(Math.min(1, (Math.abs(pointerNormX) + Math.abs(pointerNormY)) * 0.6))
</script>

<div class="hatching-container">
  <!-- Canvas scene — grassy soil, ants, egg -->
  <canvas
    bind:this={canvasEl}
    class="hatching-canvas"
    class:faded={showCard}
  ></canvas>

  <!-- 3D Draggable Card Reveal -->
  {#if showCard}
    <div class="card-reveal-container">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card-perspective"
        onpointermove={onCardPointerMove}
        onpointerleave={onCardPointerLeave}
      >
        <div class="card-rise-wrapper">
        <div
          class="soul-card"
          style="transform: rotateX({cardRotX}deg) rotateY({cardRotY}deg); box-shadow: {cardShadowX}px {cardShadowY}px 30px rgba(139,90,43,0.35), 0 0 60px rgba(139,90,43,0.15), {cardShadowX * 0.5}px {cardShadowY * 1.5 + 4}px 24px rgba(0,0,0,0.55);"
        >
          <!-- Holographic shimmer overlay — reacts to tilt -->
          <div
            class="holo-overlay"
            style="background-position: {holoBgPos};"
          ></div>

          <!-- Specular glint — bright spot following pointer -->
          <div
            class="specular-glint"
            style="background: radial-gradient(circle at {glintX}% {glintY}%, rgba(255,255,255,{glintOpacity * 0.18}) 0%, transparent 55%);"
          ></div>

          <!-- Card content -->
          <div class="card-content">
            <div class="card-header">
              <div class="card-avatar">
                <span class="card-avatar-emoji">🐜</span>
                <span class="card-signature-emoji">{signatureEmoji}</span>
              </div>
              <h2 class="card-name">{agentName}</h2>
              <div class="card-creature-badge">{creatureType}</div>
            </div>

            <p class="card-catchphrase">"{catchphrase}"</p>

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
                <span class="flavor-text">{humor === 'none' ? 'Serious' : humor.replaceAll('-', ' ')}</span>
              </div>
            </div>

            <div class="card-origin">
              <div class="card-section-label">Origin</div>
              <p class="origin-text">{originEvent}</p>
              <p class="origin-motivation">"{coreMotivation}"</p>
            </div>

            <div class="card-tags">
              {#each values as val}
                <span class="tag tag-value">{val}</span>
              {/each}
              {#each quirks as quirk}
                <span class="tag tag-quirk">{quirk}</span>
              {/each}
            </div>

            <div class="card-serial">{seedSerial}</div>
          </div>
        </div>
        </div>
      </div>

      <p class="drag-hint">hover over the card to tilt</p>

      {#if showButton}
        <button class="greet-btn" onclick={handleGreet}>
          Say hi to your new friend 👋
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
    background: #050505;
  }

  /* ============================================
     Canvas
     ============================================ */
  .hatching-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transition: opacity 1.2s ease-out;
  }

  .hatching-canvas.faded {
    opacity: 0.15;
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
    gap: 1rem;
    animation: card-container-fade 0.8s ease-out forwards;
    max-height: 90vh;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1rem;
    touch-action: pan-y;
  }

  .card-perspective {
    perspective: 800px;
    cursor: default;
    user-select: none;
    -webkit-user-select: none;
  }

  .card-rise-wrapper {
    animation: card-rise-in 1s ease-out forwards;
  }

  .soul-card {
    position: relative;
    width: 340px;
    max-width: 90vw;
    border-radius: 16px;
    overflow: hidden;
    transform-style: preserve-3d;
    transition: transform 0.06s ease-out, box-shadow 0.15s ease;
    box-shadow:
      0 0 30px rgba(139, 90, 43, 0.3),
      0 0 60px rgba(139, 90, 43, 0.15),
      0 4px 24px rgba(0, 0, 0, 0.5);
    will-change: transform, box-shadow;
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
      rgba(255, 107, 107, 0.08) 0%,
      rgba(255, 217, 61, 0.08) 20%,
      rgba(107, 203, 119, 0.08) 40%,
      rgba(77, 150, 255, 0.08) 60%,
      rgba(155, 89, 182, 0.08) 80%,
      rgba(255, 107, 107, 0.08) 100%
    );
    background-size: 300% 300%;
    transition: background-position 0.05s linear;
    z-index: 2;
    pointer-events: none;
    border-radius: 16px;
  }

  .specular-glint {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    border-radius: 16px;
    mix-blend-mode: overlay;
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

  .card-catchphrase {
    text-align: center;
    font-style: italic;
    color: #8a8a8a;
    font-size: 0.8rem;
    margin: 0;
    animation: card-content-stagger 0.6s 0.5s ease-out both;
  }

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

  /* Drag hint */
  .drag-hint {
    font-size: 0.65rem;
    color: #5a5a5a;
    letter-spacing: 0.04em;
    margin: 0;
    animation: card-content-stagger 0.6s 1.8s ease-out both;
  }

  /* Greet Button */
  .greet-btn {
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

  .greet-btn:hover {
    background: rgba(139, 90, 43, 0.25);
    border-color: rgba(139, 90, 43, 0.6);
    box-shadow: 0 0 20px rgba(139, 90, 43, 0.2);
  }

  .greet-btn:active {
    transform: scale(0.97);
  }

  /* ============================================
     Keyframe Animations
     ============================================ */

  @keyframes card-container-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes card-rise-in {
    0% {
      transform: scale(0.3) rotateY(30deg) translateY(40px);
      opacity: 0;
    }
    60% {
      transform: scale(1.05) rotateY(-5deg) translateY(-8px);
      opacity: 1;
    }
    80% {
      transform: scale(0.98) rotateY(2deg) translateY(2px);
    }
    100% {
      transform: scale(1) rotateY(0deg) translateY(0);
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
    .greet-btn,
    .card-reveal-container {
      animation-duration: 0.01s !important;
      animation-delay: 0s !important;
    }

    .soul-card::before,
    .holo-overlay {
      animation: none;
    }

    .stat-bar-fill {
      animation-duration: 0.01s !important;
      animation-delay: 0s !important;
    }

    .hatching-canvas {
      transition-duration: 0.01s !important;
    }
  }
</style>
