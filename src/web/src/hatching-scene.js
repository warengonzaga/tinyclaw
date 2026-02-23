// ============================================================
// hatching-scene.js — Cinematic hatching scene on Canvas 2D
//
// Phases:
//   fadein  → wander → deliver → exit → wobble → crack → reveal
// ============================================================

// ─── Config ──────────────────────────────────────────────────
const CFG = {
  antCount: 18,
  antBodyLen: 44,
  antSpeed: 72,
  antTurnRate: 3.5,
  eggRadius: 22,
  centerDeadZone: 120, // wander targets avoid this radius from center
  // Phase timing (relative to egg placement, in seconds)
  fadeInDur: 1.0,
  antEnterEnd: 2.0,
  eggCarrierEnter: 2.0,
  exitDelay: 1.5, // seconds after egg placed before ants exit
  wobbleDelay: 4.0, // seconds after egg placed before wobble starts
  crackDelay: 6.0, // seconds after egg placed before crack
  revealDelay: 7.0, // seconds after egg placed before card reveal
};

// ─── Utilities ───────────────────────────────────────────────
function seededRng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function randomEdgePoint(rng, w, h, margin = 60) {
  const edge = Math.floor(rng() * 4); // 0=top 1=right 2=bottom 3=left
  switch (edge) {
    case 0:
      return { x: rng() * w, y: -margin, edge: 0 };
    case 1:
      return { x: w + margin, y: rng() * h, edge: 1 };
    case 2:
      return { x: rng() * w, y: h + margin, edge: 2 };
    default:
      return { x: -margin, y: rng() * h, edge: 3 };
  }
}

function oppositeEdgePoint(rng, entryEdge, w, h, margin = 80) {
  // Pick exit on the opposite edge with some spread
  switch (entryEdge) {
    case 0:
      return { x: margin + rng() * (w - margin * 2), y: h + margin }; // top→bottom
    case 1:
      return { x: -margin, y: margin + rng() * (h - margin * 2) }; // right→left
    case 2:
      return { x: margin + rng() * (w - margin * 2), y: -margin }; // bottom→top
    default:
      return { x: w + margin, y: margin + rng() * (h - margin * 2) }; // left→right
  }
}

function exitPoint(x, y, w, h, margin = 80) {
  // Pick the nearest edge and go beyond it
  const dists = [
    { ex: x, ey: -margin }, // top
    { ex: w + margin, ey: y }, // right
    { ex: x, ey: h + margin }, // bottom
    { ex: -margin, ey: y }, // left
  ];
  let best = dists[0],
    bestD = Infinity;
  for (const d of dists) {
    const dd = dist(x, y, d.ex, d.ey);
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

// ─── Ground Texture ──────────────────────────────────────────
function createGroundTexture(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const rng = seededRng(42);

  // 1. Base gradient
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, '#5a4233');
  g.addColorStop(0.5, '#4a3525');
  g.addColorStop(1, '#352519');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 2. Soil texture — tiny variable dots
  for (let i = 0; i < 10000; i++) {
    const x = rng() * w,
      y = rng() * h;
    const sz = rng() * 2.2 + 0.4;
    const b = rng() * 45 + 25;
    ctx.fillStyle = `rgba(${b + 30},${b + 12},${b},${rng() * 0.28 + 0.08})`;
    ctx.fillRect(x, y, sz, sz);
  }

  // 3. Pebbles / small stones
  for (let i = 0; i < 45; i++) {
    const x = rng() * w,
      y = rng() * h;
    const rx = rng() * 5 + 2,
      ry = rng() * 3 + 1.5;
    const a = rng() * Math.PI;
    const gr = rng() * 55 + 80;
    ctx.fillStyle = `rgba(${gr},${gr - 8},${gr - 14},${rng() * 0.35 + 0.15})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, a, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Grass blades
  for (let i = 0; i < 60; i++) {
    const x = rng() * w,
      y = rng() * h;
    const ht = rng() * 22 + 8;
    const lean = (rng() - 0.5) * 16;
    const green = rng() * 55 + 55;
    ctx.strokeStyle = `rgba(${green - 18},${green + 28},${green - 22},${rng() * 0.45 + 0.25})`;
    ctx.lineWidth = rng() * 1.6 + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * 0.5, y - ht * 0.6, x + lean, y - ht);
    ctx.stroke();
  }

  // 5. Vignette
  const v = ctx.createRadialGradient(
    w / 2,
    h / 2,
    Math.min(w, h) * 0.28,
    w / 2,
    h / 2,
    Math.max(w, h) * 0.72,
  );
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  return c;
}

// ─── Ant ─────────────────────────────────────────────────────
const CARGO_TYPES = ['leaf', 'crumb', 'berry', 'seed'];

class Ant {
  constructor(id, cargo, x, y, w, h, rng, exitTarget) {
    this.id = id;
    this.cargo = cargo; // 'leaf' | 'crumb' | 'berry' | 'seed' | 'egg' | null
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.rng = rng;
    this.speed = CFG.antSpeed * (0.85 + rng() * 0.3);
    this.walkPhase = rng() * Math.PI * 2;
    this.opacity = 0;
    this.placed = false;
    // Natural wobble parameters for crossing ants
    this.wobbleFreq = 0.6 + rng() * 0.8; // rad/s — gentle sway
    this.wobbleAmp = 0.06 + rng() * 0.06; // radians — subtle
    // Detour state — occasional side-trips (only some ants detour)
    // Use id-based selection so it's truly varied (seeded RNG has correlated outputs)
    this.willDetour = id % 3 !== 0; // ~66% of ants detour, rest go straight
    this.detourTimer = 0.5 + (((id * 31) % 17) / 17) * 5.0; // spread 0.5–5.5s based on id
    this.detouring = false;
    this.detourPause = 0; // brief sniff-pause before veering
    this.detourX = 0;
    this.detourY = 0;
    this.detoursDone = 0;
    this.maxDetours = 1 + (id % 2); // alternating 1 or 2 detours
    this.baseSpeed = this.speed; // remember normal speed
    this.exitX = exitTarget?.x ?? w / 2; // remember original exit
    this.exitY = exitTarget?.y ?? h / 2;

    if (cargo === 'egg') {
      // Egg carrier — target gets overridden in buildAnts
      this.state = 'entering';
      this.targetX = w / 2;
      this.targetY = h / 2;
      this.angle = Math.atan2(h / 2 - y, w / 2 - x);
    } else {
      // Regular ants — walk across the screen with small detours
      this.state = 'crossing';
      this.targetX = this.exitX;
      this.targetY = this.exitY;
      this.angle = Math.atan2(this.targetY - y, this.targetX - x) + (rng() - 0.5) * 0.15;
    }
  }

  pickDetour() {
    // Pause briefly (ant "notices" something), then veer off
    this.detourPause = 0.3 + this.rng() * 0.3;
    // Big perpendicular offset so the swerve is clearly visible
    const perpAngle = this.angle + (this.rng() > 0.5 ? Math.PI / 2 : -Math.PI / 2);
    const detourDist = 100 + this.rng() * 100; // 100-200px sideways
    const forwardDist = 20 + this.rng() * 30;
    this.detourX = this.x + Math.cos(perpAngle) * detourDist + Math.cos(this.angle) * forwardDist;
    this.detourY = this.y + Math.sin(perpAngle) * detourDist + Math.sin(this.angle) * forwardDist;
    // Clamp inside screen
    this.detourX = clamp(this.detourX, 40, this.w - 40);
    this.detourY = clamp(this.detourY, 40, this.h - 40);
    this.targetX = this.detourX;
    this.targetY = this.detourY;
    this.detouring = true;
    this.detoursDone++;
  }

  startExiting() {
    this.state = 'exiting';
    const ep = exitPoint(this.x, this.y, this.w, this.h);
    this.targetX = ep.ex;
    this.targetY = ep.ey;
    this.speed = CFG.antSpeed * 1.1;
  }

  update(dt) {
    if (this.state === 'gone') return;

    // Fade in (quick, for all ants)
    if (this.opacity < 1) {
      this.opacity = clamp(this.opacity + dt * 2.5, 0, 1);
    }

    // Turn toward target
    const targetAngle = Math.atan2(this.targetY - this.y, this.targetX - this.x);
    const diff = angleDiff(this.angle, targetAngle);
    // Faster turning during detour so the swerve is sharp and visible
    const turnRate = this.detouring ? CFG.antTurnRate * 3 : CFG.antTurnRate;
    this.angle += clamp(diff, -turnRate * dt, turnRate * dt);

    // Natural ant wobble — gentle periodic sway while walking
    if (this.state === 'crossing') {
      this.angle += Math.sin(this.walkPhase * this.wobbleFreq) * this.wobbleAmp * dt;

      // Detour countdown (only for ants that detour, up to maxDetours)
      if (this.willDetour && this.detoursDone < this.maxDetours) {
        this.detourTimer -= dt;
        if (this.detourTimer <= 0 && !this.detouring) {
          this.pickDetour();
          this.detourTimer = 2 + this.rng() * 3;
        }
      }

      // Detour pause — ant briefly stops before veering
      if (this.detourPause > 0) {
        this.detourPause -= dt;
        this.speed = this.baseSpeed * 0.15; // nearly stop
        return; // skip movement while pausing
      }

      // While detouring, move a bit slower (sniffing around)
      if (this.detouring) {
        this.speed = this.baseSpeed * 0.65;
      } else {
        this.speed = this.baseSpeed;
      }

      // Reached detour point — resume toward exit
      if (this.detouring && dist(this.x, this.y, this.targetX, this.targetY) < 30) {
        this.detouring = false;
        this.targetX = this.exitX;
        this.targetY = this.exitY;
        this.speed = this.baseSpeed;
      }
    }

    // Move
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;

    // Walk cycle
    this.walkPhase += this.speed * dt * 0.14;

    // State transitions
    if (this.state === 'crossing') {
      // Off-screen → done
      if (this.x < -100 || this.x > this.w + 100 || this.y < -100 || this.y > this.h + 100) {
        this.state = 'gone';
      }
    } else if (this.state === 'entering') {
      // Egg carrier heading to center
      if (dist(this.x, this.y, this.targetX, this.targetY) < 30) {
        this.state = 'delivering';
      }
    } else if (this.state === 'delivering') {
      if (dist(this.x, this.y, this.targetX, this.targetY) < 20) {
        this.state = 'placing';
      }
    } else if (this.state === 'placing') {
      // Slow down, stop
      this.speed = Math.max(this.speed - 80 * dt, 0);
      if (this.speed <= 0 && !this.placed) {
        this.placed = true;
        this.cargo = null;
      }
    } else if (this.state === 'exiting') {
      // Walk off screen — no fade
      if (this.x < -100 || this.x > this.w + 100 || this.y < -100 || this.y > this.h + 100) {
        this.state = 'gone';
      }
    }
  }

  draw(ctx) {
    if (this.state === 'gone' || this.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    this._drawLegs(ctx);
    this._drawBody(ctx);
    this._drawAntennae(ctx);
    this._drawMandibles(ctx);
    if (this.cargo) this._drawCargo(ctx);

    ctx.restore();
  }

  _drawBody(ctx) {
    // Abdomen (back, largest)
    ctx.fillStyle = '#1a0e06';
    ctx.beginPath();
    ctx.ellipse(-14, 0, 9, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Slight highlight
    ctx.fillStyle = 'rgba(90,60,30,0.18)';
    ctx.beginPath();
    ctx.ellipse(-15, -2, 5, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Petiole (narrow waist)
    ctx.fillStyle = '#1a0e06';
    ctx.beginPath();
    ctx.arc(-4, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Thorax
    ctx.fillStyle = '#221308';
    ctx.beginPath();
    ctx.ellipse(2, 0, 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = '#2a1810';
    ctx.beginPath();
    ctx.ellipse(12, 0, 5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes — tiny dots
    ctx.fillStyle = '#888';
    ctx.beginPath();
    ctx.arc(14, -2.5, 1, 0, Math.PI * 2);
    ctx.arc(14, 2.5, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawLegs(ctx) {
    ctx.strokeStyle = '#2a1508';
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';

    const pairs = [
      { x: 7, bw: 3.8 },
      { x: -1, bw: 4.2 },
      { x: -11, bw: 5.5 },
    ];
    pairs.forEach((p, i) => {
      const ph = this.walkPhase + i * 2.1;
      const swing = Math.sin(ph) * 5.5;
      for (const side of [-1, 1]) {
        const sp = side === 1 ? swing : -swing;
        ctx.beginPath();
        ctx.moveTo(p.x, side * p.bw);
        // Knee
        const kx = p.x + sp * 0.4;
        const ky = side * (p.bw + 7);
        // Foot
        const fx = p.x + sp;
        const fy = side * (p.bw + 13);
        ctx.lineTo(kx, ky);
        ctx.lineTo(fx, fy);
        ctx.stroke();
      }
    });
  }

  _drawAntennae(ctx) {
    ctx.strokeStyle = '#2a1810';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    const wave = Math.sin(this.walkPhase * 0.7) * 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(15, side * 2);
      ctx.quadraticCurveTo(19, side * (5 + wave * side), 23, side * (8 + wave));
      ctx.stroke();
    }
  }

  _drawMandibles(ctx) {
    // Tiny claws — the signature feature!
    ctx.strokeStyle = '#3a2010';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(16, side * 2);
      ctx.quadraticCurveTo(20, side * 4.5, 22, side * 1.5);
      ctx.stroke();
    }
  }

  _drawCargo(ctx) {
    const cx = 21,
      cy = 0;
    switch (this.cargo) {
      case 'leaf':
        ctx.fillStyle = '#4a8d3a';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 5, 3, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#3a7d28';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy);
        ctx.lineTo(cx + 4, cy);
        ctx.stroke();
        break;
      case 'crumb':
        ctx.fillStyle = '#c8a870';
        ctx.beginPath();
        ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.arc(cx - 1, cy - 1, 1.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'berry':
        ctx.fillStyle = '#8b3a8b';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.arc(cx - 0.8, cy - 1, 1, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'seed':
        ctx.fillStyle = '#c8a850';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 4, 2.2, 0.2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'egg': {
        // Egg held between mandibles
        const eg = ctx.createRadialGradient(cx - 1, cy - 1, 0, cx, cy, 8);
        eg.addColorStop(0, '#fffdf5');
        eg.addColorStop(0.6, '#fff5e6');
        eg.addColorStop(1, '#ffe0b2');
        ctx.fillStyle = eg;
        ctx.beginPath();
        ctx.ellipse(cx + 1, cy, 5, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        // Highlight
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.beginPath();
        ctx.ellipse(cx, cy - 2, 2.5, 3, -0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
}

// ─── Egg ─────────────────────────────────────────────────────
class Egg {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = CFG.eggRadius;
    this.rotation = 0;
    this.wobbleAmount = 0;
    this.crackProgress = 0;
    this.cracked = false;
    this.opacity = 1;
    this.scale = 0;
    this.appearStart = 0;
  }

  appear(time) {
    this.appearStart = time;
  }

  update(dt, elapsed, eggPlacedAt) {
    // Appear animation (scale in)
    if (this.appearStart > 0) {
      const t = clamp((elapsed - this.appearStart) / 0.5, 0, 1);
      this.scale = t < 0.6 ? lerp(0, 1.12, t / 0.6) : lerp(1.12, 1, (t - 0.6) / 0.4);
    }

    if (eggPlacedAt <= 0) return;
    const wobbleStart = eggPlacedAt + CFG.wobbleDelay;
    const crackStart = eggPlacedAt + CFG.crackDelay;

    // Wobble phase
    if (elapsed >= wobbleStart && !this.cracked) {
      const wt = clamp((elapsed - wobbleStart) / (crackStart - wobbleStart), 0, 1);
      this.wobbleAmount = wt * wt * 18; // degrees, ramps up quadratically
      const freq = 4 + wt * 14;
      this.rotation = Math.sin(elapsed * freq) * this.wobbleAmount * (Math.PI / 180);
    }

    // Crack phase
    if (elapsed >= crackStart && !this.cracked) {
      const ct = clamp((elapsed - crackStart) / 0.8, 0, 1);
      this.crackProgress = ct;
      if (ct >= 1) this.cracked = true;
    }

    // Fade after crack
    if (this.cracked) {
      this.opacity = clamp(this.opacity - dt * 3, 0, 1);
    }
  }

  draw(ctx) {
    if (this.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rotation);
    const s = this.scale;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(2 * s, 5 * s, this.radius * 0.75 * s, this.radius * 0.28 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    // Main egg
    const r = this.radius * s;
    const eg = ctx.createRadialGradient(-r * 0.18, -r * 0.2, 0, 0, 0, r * 1.2);
    eg.addColorStop(0, '#fffdf8');
    eg.addColorStop(0.45, '#fff5e6');
    eg.addColorStop(1, '#f5d9a8');
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.7, r, 0, 0, Math.PI * 2);
    ctx.fill();

    // Subtle outline
    ctx.strokeStyle = 'rgba(180,140,90,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.15, -r * 0.3, r * 0.28, r * 0.42, -0.3, 0, Math.PI * 2);
    ctx.fill();

    // Crack lines
    if (this.crackProgress > 0) {
      this._drawCracks(ctx, r, this.crackProgress);
    }

    // Glow during wobble
    if (this.wobbleAmount > 5) {
      const glowAlpha = clamp((this.wobbleAmount - 5) / 13, 0, 0.25);
      const glow = ctx.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.5);
      glow.addColorStop(0, `rgba(255,220,150,${glowAlpha})`);
      glow.addColorStop(1, 'rgba(255,220,150,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  _drawCracks(ctx, r, progress) {
    const rng = seededRng(777);
    const numCracks = Math.floor(progress * 7) + 1;
    ctx.strokeStyle = '#7a5d3d';
    ctx.lineWidth = 1.8;

    for (let i = 0; i < numCracks; i++) {
      const startAngle = rng() * Math.PI * 2;
      const startR = rng() * r * 0.25;
      let cx = Math.cos(startAngle) * startR;
      let cy = Math.sin(startAngle) * startR;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      const segs = 2 + Math.floor(rng() * 3);
      for (let j = 0; j < segs; j++) {
        cx += (rng() - 0.5) * r * 0.5 * progress;
        cy += (rng() - 0.5) * r * 0.6 * progress;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
  }
}

// ─── Particles ───────────────────────────────────────────────
class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  emit(x, y, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 200;
      const colors = ['#fffdf5', '#ffeedd', '#ffe0b2', '#ffcc80', '#fff8e1', '#d4a85a'];
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 0.4 + Math.random() * 0.8,
        size: 2 + Math.random() * 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: 60 + Math.random() * 40,
      });
    }
  }

  // Sparkle / glow particles (slow, drifting)
  emitGlow(x, y, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 10 + Math.random() * 30;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        life: 1,
        decay: 0.25 + Math.random() * 0.35,
        size: 1.5 + Math.random() * 3,
        color: `rgba(255,240,200,${0.4 + Math.random() * 0.4})`,
        gravity: -10,
      });
    }
  }

  update(dt) {
    this.particles = this.particles.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      p.life -= p.decay * dt;
      return p.life > 0;
    });
  }

  draw(ctx) {
    for (const p of this.particles) {
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  get active() {
    return this.particles.length > 0;
  }
}

// ─── Scene Controller ────────────────────────────────────────
export function createHatchingScene(canvas, callbacks = {}) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let w = 0,
    h = 0;
  let groundTex = null;
  let ants = [];
  let egg = null;
  let eggCarrier = null;
  let particles = new ParticleSystem();
  let animId = null;
  let startTs = 0;
  let prevTs = 0;
  let currentPhase = 'init';
  let fadeIn = 0;
  let sceneFadeOut = 0;
  let emittedCrack = false;
  let rng = seededRng(99);
  let destroyed = false;

  function setPhase(p) {
    if (p !== currentPhase) {
      currentPhase = p;
      callbacks.onPhaseChange?.(p);
    }
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    groundTex = createGroundTexture(w * dpr, h * dpr);
  }

  function buildAnts() {
    ants = [];
    rng = seededRng(99);
    for (let i = 0; i < CFG.antCount; i++) {
      const start = randomEdgePoint(rng, w, h);
      const hasCargo = rng() > 0.35;
      const cargo = hasCargo ? CARGO_TYPES[Math.floor(rng() * CARGO_TYPES.length)] : null;
      const exit = oppositeEdgePoint(seededRng(i * 53 + 3), start.edge, w, h);
      const ant = new Ant(i, cargo, start.x, start.y, w, h, seededRng(i * 137 + 7), exit);
      ants.push(ant);
    }

    // Egg carrier — enters with the pack, heads straight for center
    const eStart = randomEdgePoint(rng, w, h);
    eggCarrier = new Ant(100, 'egg', eStart.x, eStart.y, w, h, seededRng(555));
    eggCarrier.opacity = 0;
    eggCarrier.state = 'entering';
    eggCarrier.targetX = w / 2;
    eggCarrier.targetY = h / 2;
    // Point directly at center from the start
    eggCarrier.angle = Math.atan2(h / 2 - eStart.y, w / 2 - eStart.x);
    eggCarrier.speed = CFG.antSpeed * 1.4;
  }

  // Track when egg was placed so we can time exits after it
  let eggPlacedAt = 0;

  function updatePhase(elapsed) {
    // Phase machine
    if (elapsed < CFG.fadeInDur) {
      setPhase('fadein');
    } else if (!eggCarrier.placed) {
      // Still waiting for egg delivery — ants keep wandering
      if (currentPhase === 'init' || currentPhase === 'fadein') {
        setPhase('wander');
      }
    } else if (eggPlacedAt > 0 && elapsed - eggPlacedAt < CFG.exitDelay) {
      // Just placed — brief pause before exits
      if (currentPhase !== 'deliver') setPhase('deliver');
    } else if (currentPhase === 'deliver') {
      // After exitDelay — egg carrier exits
      setPhase('exit');
      if (eggCarrier.state !== 'exiting' && eggCarrier.state !== 'gone') {
        eggCarrier.startExiting();
      }
    }

    // All timing below is relative to egg placement
    if (eggPlacedAt <= 0) return;
    const sincePlace = elapsed - eggPlacedAt;

    // Wobble
    if (sincePlace >= CFG.wobbleDelay && (currentPhase === 'exit' || currentPhase === 'deliver')) {
      setPhase('wobble');
    }

    // Crack
    if (sincePlace >= CFG.crackDelay && currentPhase === 'wobble') {
      setPhase('crack');
    }

    // Reveal
    if (sincePlace >= CFG.revealDelay && currentPhase === 'crack') {
      setPhase('reveal');
      callbacks.onReveal?.();
    }
  }

  function update(dt, elapsed) {
    // Fade in
    fadeIn = clamp(elapsed / CFG.fadeInDur, 0, 1);

    // Scene fade out after crack
    const absCrackTime = eggPlacedAt > 0 ? eggPlacedAt + CFG.crackDelay : Infinity;
    if (elapsed >= absCrackTime) {
      sceneFadeOut = clamp((elapsed - absCrackTime) / 1.5, 0, 0.65);
    }

    // Update ants
    for (const a of ants) a.update(dt);

    // Egg carrier
    if (elapsed >= CFG.eggCarrierEnter) {
      if (eggCarrier.opacity < 1 && eggCarrier.state === 'entering') {
        eggCarrier.opacity = clamp(eggCarrier.opacity + dt * 1.5, 0, 1);
      }
      eggCarrier.update(dt);

      // Place egg
      if (eggCarrier.placed && !egg) {
        egg = new Egg(eggCarrier.x, eggCarrier.y);
        egg.appear(elapsed);
        eggPlacedAt = elapsed;
        // Start carrier exiting
        eggCarrier.state = 'exiting';
        const ep = exitPoint(eggCarrier.x, eggCarrier.y, w, h);
        eggCarrier.targetX = ep.ex;
        eggCarrier.targetY = ep.ey;
        eggCarrier.speed = CFG.antSpeed * 1.1;
      }
    }

    // Update egg
    if (egg) egg.update(dt, elapsed, eggPlacedAt);

    // Particles
    particles.update(dt);

    // Absolute crack/wobble times (only valid after egg placed)
    const absCrack = eggPlacedAt > 0 ? eggPlacedAt + CFG.crackDelay : Infinity;
    const absWobble = eggPlacedAt > 0 ? eggPlacedAt + CFG.wobbleDelay : Infinity;

    // Emit crack burst
    if (elapsed >= absCrack && !emittedCrack && egg) {
      particles.emit(egg.x, egg.y, 45);
      particles.emitGlow(egg.x, egg.y, 20);
      emittedCrack = true;
    }

    // Emit glow sparks during intense wobble
    if (egg && elapsed >= absWobble + 1 && elapsed < absCrack && Math.random() < 0.15) {
      particles.emitGlow(egg.x + (Math.random() - 0.5) * 20, egg.y + (Math.random() - 0.5) * 20, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);

    // Black base
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, w, h);

    // Ground (fade in)
    ctx.globalAlpha = fadeIn;
    ctx.drawImage(groundTex, 0, 0, w, h);
    ctx.globalAlpha = 1;

    // Ants
    for (const a of ants) a.draw(ctx);
    if (eggCarrier) eggCarrier.draw(ctx);

    // Egg
    if (egg) egg.draw(ctx);

    // Particles
    particles.draw(ctx);

    // Scene darken overlay after crack
    if (sceneFadeOut > 0) {
      ctx.fillStyle = `rgba(5,5,5,${sceneFadeOut})`;
      ctx.fillRect(0, 0, w, h);
    }

    // Fade overlay at start
    if (fadeIn < 1) {
      ctx.fillStyle = `rgba(5,5,5,${1 - fadeIn})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  function loop(ts) {
    if (destroyed || paused) return;
    if (!startTs) {
      startTs = ts;
      prevTs = ts;
    }
    const adjustedTs = ts - pausedTotal;
    const elapsed = (adjustedTs - startTs) / 1000;
    const dt = Math.min((ts - prevTs) / 1000, 0.05); // cap delta
    prevTs = ts;

    updatePhase(elapsed);
    update(dt, elapsed);
    draw();

    animId = requestAnimationFrame(loop);
  }

  function start() {
    resize();
    buildAnts();
    window.addEventListener('resize', onResize);
    animId = requestAnimationFrame(loop);
  }

  function clampTarget(a) {
    // Recompute exit point for the new canvas bounds
    const ep = exitPoint(a.x, a.y, w, h);
    a.exitX = ep.ex;
    a.exitY = ep.ey;
    // If the ant is heading toward its exit (not detouring), update the target too
    if (!a.detouring && a.state === 'crossing') {
      a.targetX = a.exitX;
      a.targetY = a.exitY;
    } else if (a.detouring) {
      // Clamp detour point inside new bounds
      a.detourX = clamp(a.detourX, 40, w - 40);
      a.detourY = clamp(a.detourY, 40, h - 40);
      a.targetX = a.detourX;
      a.targetY = a.detourY;
    } else if (a.state === 'entering') {
      a.targetX = w / 2;
      a.targetY = h / 2;
    } else if (a.state === 'exiting') {
      const exitPt = exitPoint(a.x, a.y, w, h);
      a.targetX = exitPt.ex;
      a.targetY = exitPt.ey;
    }
  }

  function onResize() {
    resize();
    // Rebuild ground but keep animation state
    for (const a of ants) {
      a.w = w;
      a.h = h;
      clampTarget(a);
    }
    if (eggCarrier) {
      eggCarrier.w = w;
      eggCarrier.h = h;
      clampTarget(eggCarrier);
    }
  }

  function destroy() {
    destroyed = true;
    if (animId) cancelAnimationFrame(animId);
    window.removeEventListener('resize', onResize);
  }

  // ─── Dev controls ─────────────────────────────────────────
  let paused = false;
  let pausedAt = 0; // performance.now() when paused
  let pausedTotal = 0; // accumulated paused ms

  function pause() {
    if (paused || destroyed) return;
    paused = true;
    pausedAt = performance.now();
    if (animId) cancelAnimationFrame(animId);
  }

  function resume() {
    if (!paused || destroyed) return;
    pausedTotal += performance.now() - pausedAt;
    paused = false;
    animId = requestAnimationFrame(loop);
  }

  function restart() {
    destroyed = false;
    paused = false;
    if (animId) cancelAnimationFrame(animId);
    startTs = 0;
    prevTs = 0;
    currentPhase = 'init';
    fadeIn = 0;
    sceneFadeOut = 0;
    emittedCrack = false;
    eggPlacedAt = 0;
    egg = null;
    eggCarrier = null;
    particles = new ParticleSystem();
    pausedTotal = 0;
    pausedAt = 0;
    resize();
    buildAnts();
    animId = requestAnimationFrame(loop);
  }

  function getElapsed() {
    if (!startTs) return 0;
    const now = paused ? pausedAt : performance.now();
    return (now - startTs - pausedTotal) / 1000;
  }

  function getPhase() {
    return currentPhase;
  }

  function isPaused() {
    return paused;
  }

  return { start, destroy, pause, resume, restart, getElapsed, getPhase, isPaused };
}
