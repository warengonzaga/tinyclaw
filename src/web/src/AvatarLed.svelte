<script>
  /**
   * Reusable avatar with LED status indicator (Discord-style).
   * Designed at 64px (standard), proportionally scales to any size.
   * The status dot sits at the bottom-right with its center on the
   * avatar circle's edge — exactly matching Discord's placement.
   *
   * @prop {number}  size   - Avatar diameter in px (default: 64)
   * @prop {'online'|'offline'|'checking'} status - LED state
   * @prop {string}  emoji  - Emoji shown inside the avatar (default: �)
   * @prop {string}  ringColor - CSS color for the avatar outer ring (optional)
   * @prop {string}  cutoutColor - CSS color for the dot cutout ring matching parent bg
   */
  let {
    size = 64,
    status = 'offline',
    emoji = '🐜',
    ringColor = '',
    cutoutColor = ''
  } = $props()

  // Dot: 37.5% of avatar (50% bigger than the previous 25%)
  // Discord uses roughly this ratio on their 80px/128px avatars
  const dotSize = $derived(Math.round(size * 0.375))

  // Cutout ring: ~19% of dot size
  const dotRing = $derived(Math.max(2, Math.round(dotSize * 0.19)))

  // Avatar outer ring: ~6% of avatar diameter
  const avatarRing = $derived(ringColor ? Math.max(2, Math.round(size * 0.0625)) : 0)

  // Emoji font size: ~37% of avatar diameter
  const emojiSize = $derived(Math.round(size * 0.375))

  // Position dot so its center sits on the avatar circle's edge at 315° (bottom-right).
  // For a circle of radius r, the point at 315° is:
  //   x = r + r·cos(315°) = r + r·(√2/2)
  //   y = r + r·sin(315°) = r + r·(√2/2)  (in CSS top-left coords, flip y)
  // Then offset by half the dot size to center it on that point.
  const radius = $derived(size / 2)
  const cos315 = Math.cos((315 * Math.PI) / 180) // ≈ 0.7071
  const sin315 = Math.sin((315 * Math.PI) / 180) // ≈ -0.7071
  // Bottom/right offset = avatar size - (center of avatar + radius toward 315°) - half dot
  const dotBottom = $derived(Math.round(radius - radius * Math.abs(sin315) - dotSize / 2))
  const dotRight = $derived(Math.round(radius - radius * cos315 - dotSize / 2))

  const ledClass = $derived(
    status === 'online' ? 'led-online'
    : status === 'offline' ? 'led-offline'
    : 'led-checking'
  )
</script>

<div class="avatar-led-wrapper" style="width: {size}px; height: {size}px;">
  <div
    class="avatar-led-circle"
    style="
      width: {size}px;
      height: {size}px;
      {ringColor ? `border: ${avatarRing}px solid ${ringColor};` : ''}
    "
  >
    <span style="font-size: {emojiSize}px; line-height: 1;">{emoji}</span>
  </div>
  <span
    class="avatar-led-dot {ledClass}"
    style="
      width: {dotSize}px;
      height: {dotSize}px;
      bottom: {dotBottom}px;
      right: {dotRight}px;
      border-width: {dotRing}px;
      {cutoutColor ? `border-color: ${cutoutColor};` : ''}
    "
  ></span>
</div>

<style>
  .avatar-led-wrapper {
    position: relative;
    display: inline-block;
    flex-shrink: 0;
  }

  .avatar-led-circle {
    border-radius: 50%;
    background: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .avatar-led-dot {
    position: absolute;
    border-radius: 50%;
    border-style: solid;
    border-color: var(--color-bg-tertiary);
    box-sizing: border-box;
  }
</style>
