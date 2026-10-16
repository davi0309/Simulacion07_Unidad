/* ==========================================================
   effects.js — Partículas y hechizos de cada letra
   ----------------------------------------------------------
   Este archivo usa variables globales definidas en sketch.js:
   ctx (contexto 2D), S (escala), T (tiempo) y letters.
   ========================================================== */

// ---------- Utilidades matemáticas ----------
const PI2 = Math.PI * 2;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerpN = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Punto interpolado a lo largo de un contorno (u en [0,1), se envuelve)
function ptAlong(L, ci, u) {
  const c = L.contours[ci];
  const n = c.length;
  const f = (((u % 1) + 1) % 1) * n;
  const i0 = Math.floor(f) % n;
  const i1 = (i0 + 1) % n;
  const k = f - Math.floor(f);
  const a = c[i0], b = c[i1];
  let nx = lerpN(a.nx, b.nx, k), ny = lerpN(a.ny, b.ny, k);
  const m = Math.hypot(nx, ny) || 1;
  return { x: lerpN(a.x, b.x, k), y: lerpN(a.y, b.y, k), nx: nx / m, ny: ny / m };
}

// Contorno elegido con probabilidad proporcional a su longitud
function randomContour(L) {
  let r = Math.random() * L.pts.length;
  for (let i = 0; i < L.contours.length; i++) {
    r -= L.contours[i].length;
    if (r <= 0) return i;
  }
  return 0;
}

// Cinta con grosor decreciente (raíces, colas…)
function ribbonPath(pts, w0, w1) {
  const n = pts.length;
  if (n < 2) return null;
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y;
    const m = Math.hypot(tx, ty) || 1;
    tx /= m; ty /= m;
    const w = lerpN(w0, w1, i / (n - 1)) * 0.5;
    left.push([pts[i].x - ty * w, pts[i].y + tx * w]);
    right.push([pts[i].x + ty * w, pts[i].y - tx * w]);
  }
  const p = new Path2D();
  p.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i < n; i++) p.lineTo(left[i][0], left[i][1]);
  for (let i = n - 1; i >= 0; i--) p.lineTo(right[i][0], right[i][1]);
  p.closePath();
  return p;
}

// Prefijo de una polilínea según progreso 0..1 (con punto final interpolado)
function partialPts(pts, prog) {
  if (prog <= 0) return [];
  const f = prog * (pts.length - 1);
  const i = Math.floor(f);
  const out = pts.slice(0, i + 1);
  if (i < pts.length - 1) {
    const k = f - i, a = pts[i], b = pts[i + 1];
    out.push({ x: lerpN(a.x, b.x, k), y: lerpN(a.y, b.y, k) });
  }
  return out;
}

/* ==========================================================
   SISTEMA DE PARTÍCULAS
   Partículas simples con edad, vida, velocidad, arrastre,
   gravedad y deriva por ruido de Perlin. Se dibujan con
   sprites radiales pre-renderizados (rápido en canvas 2D).
   ========================================================== */
const Particles = (() => {
  const MAX = 2600;               // límite global para el rendimiento
  const list = [];
  const sprites = new Map();

  function sprite(c, kind) {
    const key = c.join(',') + kind;
    let s = sprites.get(key);
    if (s) return s;
    s = document.createElement('canvas');
    s.width = s.height = 64;
    const g = s.getContext('2d');
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (kind === 'glow') {
      grd.addColorStop(0, rgba([255, 255, 255], 1));
      grd.addColorStop(0.18, rgba(c, 0.95));
      grd.addColorStop(0.45, rgba(c, 0.28));
      grd.addColorStop(1, rgba(c, 0));
    } else {
      grd.addColorStop(0, rgba(c, 0.6));
      grd.addColorStop(0.55, rgba(c, 0.25));
      grd.addColorStop(1, rgba(c, 0));
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    sprites.set(key, s);
    return s;
  }

  function add(o) {
    if (list.length >= MAX) return null;
    const p = Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, ay: 0, drag: 1, life: 1, age: 0,
      size: 4, grow: 0, col: [255, 255, 255], alpha: 1, kind: 'glow',
      layer: 'front', drift: 0,
    }, o);
    list.push(p);
    return p;
  }

  function update(dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) { list[i] = list[list.length - 1]; list.pop(); continue; }
      if (p.drift) {
        const a = noise(p.x * 0.005, p.y * 0.005, T * 0.25) * PI2 * 2;
        p.vx += Math.cos(a) * p.drift * dt;
        p.vy += Math.sin(a) * p.drift * dt;
      }
      p.vy += p.ay * dt;
      if (p.drag !== 1) { const d = Math.pow(p.drag, dt * 60); p.vx *= d; p.vy *= d; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  function draw(layer) {
    // 1) humo y polvo (mezcla normal)
    ctx.save();
    for (const p of list) {
      if (p.layer !== layer || p.kind !== 'smoke') continue;
      const k = p.age / p.life;
      const a = p.alpha * Math.min(1, k * 6) * (1 - k);
      const s = p.size * (1 + p.grow * k);
      ctx.globalAlpha = a;
      ctx.drawImage(sprite(p.col, 'smoke'), p.x - s, p.y - s, s * 2, s * 2);
    }
    // 2) luces (mezcla aditiva)
    ctx.globalCompositeOperation = 'lighter';
    for (const p of list) {
      if (p.layer !== layer || p.kind === 'smoke') continue;
      const k = p.age / p.life;
      const a = p.alpha * Math.min(1, k * 8) * (1 - k);
      const s = p.size * (1 + p.grow * k);
      if (p.kind === 'streak') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = rgba(p.col, 1);
        ctx.lineWidth = Math.max(1, s * 0.45);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.globalAlpha = a;
      ctx.drawImage(sprite(p.col, 'glow'), p.x - s, p.y - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  return { add, update, draw, sprite, clear: () => { list.length = 0; }, get count() { return list.length; } };
})();

/* ==========================================================
   HECHIZOS
   - Transitorios (H, A, Y, P, O): tienen inicio, desarrollo y
     final. Un nuevo clic lanza otro (máx. 2 a la vez).
   - Persistentes (RR, TT, E, RF): transforman la letra y la
     dejan así. Un nuevo clic lanza el CONTRAHECHIZO (invierte).
   ========================================================== */
class Spell {
  constructor(key, group, clicked) {
    this.key = key;
    this.group = group;
    this.L = group[0];
    this.clicked = clicked;
    this.t = 0;
    this.dead = false;
    this.seed = Math.random() * 1000;
  }
  update(dt) { this.t += dt; }
  drawBack() {}
  drawFront() {}
}

class TransientSpell extends Spell {
  constructor(key, group, clicked, dur, fadeIn, fadeOut) {
    super(key, group, clicked);
    this.dur = dur; this.fadeIn = fadeIn; this.fadeOut = fadeOut;
    this.ending = false;
  }
  end() {  // acelera el final (cuando hay demasiados del mismo tipo)
    this.ending = true;
    const start = this.dur - this.fadeOut;
    if (this.t < start) this.t = start;
  }
  get alpha() {
    return clamp01(this.t / this.fadeIn) * clamp01((this.dur - this.t) / this.fadeOut);
  }
  update(dt) { super.update(dt); if (this.t >= this.dur) this.dead = true; }
}

class PersistentSpell extends Spell {
  constructor(key, group, clicked) {
    super(key, group, clicked);
    this.reversing = false;
    this.tPhase = 0;  // tiempo desde el último cambio de sentido
  }
  toggle() { this.reversing = !this.reversing; this.tPhase = 0; }
  update(dt) { super.update(dt); this.tPhase += dt; }
}

/* ---------- H · Raíces y flores ---------- */
class RootsSpell extends TransientSpell {
  constructor(group, clicked) {
    super('H', group, clicked, 11, 0.01, 2.2);
    const L = this.L;
    this.roots = [];
    this.leaves = [];
    this.flowers = [];

    // Semillas: puntos del contorno que miran hacia abajo, en la base de la letra
    const base = L.pts.filter((p) => p.y > L.bb.y2 - L.h * 0.07 && p.ny > 0.35).sort((a, b) => a.x - b.x);
    const seeds = [];
    const nSeeds = 8;
    for (let k = 0; k < nSeeds && base.length; k++) {
      const idx = Math.floor(((k + rand(0.2, 0.8)) / nSeeds) * base.length);
      seeds.push(base[Math.min(base.length - 1, idx)]);
    }

    for (const sd of seeds) {
      const c = L.contours[sd.c];
      const n = c.length;
      const delay = rand(0, 0.5);

      // 1) Raíz que trepa por el borde de la letra siguiendo su contorno
      const dir = Math.random() < 0.5 ? 1 : -1;
      const steps = Math.floor(n * rand(0.16, 0.3));
      const crawl = [];
      for (let k = 0; k < steps; k += 2) {
        const p = c[(((sd.i + dir * k) % n) + n) % n];
        const off = (1.2 + 3 * noise(k * 0.04, this.seed + sd.x * 0.01)) * S;
        crawl.push({ x: p.x + p.nx * off, y: p.y + p.ny * off, nx: p.nx, ny: p.ny });
      }
      const grow = rand(2.0, 3.0);
      this.roots.push({ pts: crawl, w0: rand(3, 4.2) * S, w1: 0.6 * S, delay, grow });

      // 2) Raíz colgante que se hunde bajo la letra
      const hang = [{ x: sd.x, y: sd.y }];
      let ang = Math.PI / 2 + rand(-0.5, 0.5), x = sd.x, y = sd.y;
      const hs = Math.floor(rand(9, 20));
      for (let k = 0; k < hs; k++) {
        ang += rand(-0.35, 0.35) + (Math.PI / 2 - ang) * 0.12;
        x += Math.cos(ang) * 3.2 * S;
        y += Math.sin(ang) * 3.2 * S;
        hang.push({ x, y });
      }
      this.roots.push({ pts: hang, w0: rand(2.6, 3.4) * S, w1: 0.4 * S, delay, grow: grow * 0.7 });

      // 3) Ramitas laterales, hojas y flores a lo largo de la raíz que trepa
      for (let k = 6; k < crawl.length; k += Math.floor(rand(8, 14))) {
        const p = crawl[k];
        const prog = k / crawl.length;
        const bDelay = delay + grow * prog;
        if (Math.random() < 0.7) {
          const br = [{ x: p.x, y: p.y }];
          let a = Math.atan2(p.ny, p.nx) + rand(-0.5, 0.5), bx = p.x, by = p.y;
          const curl = rand(-0.25, 0.25);
          const bs = Math.floor(rand(5, 10));
          for (let j = 0; j < bs; j++) {
            a += curl;
            bx += Math.cos(a) * 2.6 * S;
            by += Math.sin(a) * 2.6 * S;
            br.push({ x: bx, y: by });
          }
          this.roots.push({ pts: br, w0: 2 * S, w1: 0.4 * S, delay: bDelay, grow: 0.7 });
          if (Math.random() < 0.75) this.addFlower(bx, by, bDelay + 0.7 + rand(0.2, 0.9));
        } else {
          this.leaves.push({ x: p.x, y: p.y, a: Math.atan2(p.ny, p.nx) + rand(-0.6, 0.6), s: rand(4, 7) * S, delay: bDelay });
        }
      }
      const tip = crawl[crawl.length - 1];
      if (tip) this.addFlower(tip.x, tip.y, delay + grow + rand(0.1, 0.6));
    }
  }

  addFlower(x, y, delay) {
    const palettes = [
      { petal: [246, 178, 206], center: [255, 214, 92] },
      { petal: [252, 244, 236], center: [250, 200, 70] },
      { petal: [200, 170, 240], center: [255, 230, 120] },
    ];
    this.flowers.push({ x, y, delay, s: rand(5, 9) * S, np: Math.random() < 0.5 ? 5 : 6, rot: rand(PI2), pal: pick(palettes), popped: false });
  }

  update(dt) {
    super.update(dt);
    for (const f of this.flowers) {
      if (!f.popped && this.t > f.delay) {
        f.popped = true;
        for (let i = 0; i < 4; i++) {
          Particles.add({ x: f.x, y: f.y, vx: rand(-15, 15), vy: rand(-35, -10), drift: 20, life: rand(1, 2), size: rand(2, 3.5) * S, col: [230, 255, 170], alpha: 0.8 });
        }
      }
    }
  }

  drawFront() {
    const a = this.alpha;
    if (a <= 0) return;
    this.L.push();
    ctx.globalAlpha = a;
    // Raíces
    for (const r of this.roots) {
      const prog = easeInOut((this.t - r.delay) / r.grow);
      if (prog <= 0) continue;
      const pts = partialPts(r.pts, prog);
      const path = ribbonPath(pts, r.w0, lerpN(r.w0, r.w1, prog));
      if (!path) continue;
      ctx.fillStyle = 'rgb(70,46,28)';
      ctx.fill(path);
      ctx.strokeStyle = 'rgba(150,112,66,0.55)';
      ctx.lineWidth = 0.7 * S;
      ctx.stroke(path);
    }
    // Hojas
    for (const lf of this.leaves) {
      const k = easeOutBack(clamp01((this.t - lf.delay) / 0.6));
      if (k <= 0) continue;
      ctx.save();
      ctx.translate(lf.x, lf.y);
      ctx.rotate(lf.a);
      ctx.scale(k, k);
      ctx.fillStyle = 'rgb(84,140,64)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(lf.s * 0.6, -lf.s * 0.55, lf.s * 1.5, 0);
      ctx.quadraticCurveTo(lf.s * 0.6, lf.s * 0.55, 0, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(190,230,150,0.6)';
      ctx.lineWidth = 0.6 * S;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(lf.s * 1.3, 0); ctx.stroke();
      ctx.restore();
    }
    // Flores: los pétalos se abren como un abanico mientras crecen
    for (const f of this.flowers) {
      const raw = clamp01((this.t - f.delay) / 1.3);
      if (raw <= 0) continue;
      const k = easeOutBack(raw);
      const open = 0.25 + 0.75 * easeInOut(raw);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot + Math.sin(T * 1.2 + f.rot) * 0.08);
      for (let j = 0; j < f.np; j++) {
        const ang = (j / f.np) * PI2 * open;
        ctx.save();
        ctx.rotate(ang);
        ctx.fillStyle = rgba(f.pal.petal, 0.95);
        ctx.beginPath();
        ctx.ellipse(f.s * 0.55 * k, 0, f.s * 0.55 * k, f.s * 0.3 * k, 0, 0, PI2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = rgba(f.pal.center, 1);
      ctx.beginPath();
      ctx.arc(0, 0, f.s * 0.26 * k, 0, PI2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.L.pop();
  }
}

/* ---------- A · Expecto Patronum ---------- */
class PatronusSpell extends TransientSpell {
  constructor(group, clicked) {
    super('A', group, clicked, 9.5, 0.01, 2.6);
    const L = this.L;
    // Destello: partículas luminosas en todo el contorno
    for (let i = 0; i < 90; i++) {
      const p = pick(L.pts);
      const v = rand(15, 70);
      Particles.add({ x: p.x, y: p.y, vx: p.nx * v, vy: p.ny * v, drag: 0.96, life: rand(0.8, 1.8), size: rand(5, 11) * S, col: [190, 225, 255], alpha: 0.9 });
    }
    // Espíritus que recorren la silueta, orbitan y se dispersan
    this.spirits = [];
    for (let i = 0; i < 7; i++) {
      const ci = randomContour(L);
      const u = rand(1);
      const p0 = ptAlong(L, ci, u);
      this.spirits.push({ ci, u, speed: rand(0.1, 0.2) * (Math.random() < 0.5 ? -1 : 1), x: p0.x, y: p0.y, trail: [], orbitA: null, orbitR: 0, dir: Math.random() < 0.5 ? -1 : 1, vx: 0, vy: 0, size: rand(0.8, 1.25) });
    }
  }

  update(dt) {
    super.update(dt);
    const L = this.L, t = this.t;
    // Luz azul plateada: un pico inicial que se calma
    L.glow = Math.max(L.glow, (0.35 + 0.65 * Math.exp(-t * 1.6)) * this.alpha);
    L.glowCol = [160, 210, 255];

    for (const s of this.spirits) {
      let tx, ty;
      if (t < 3.6) {                      // 1) recorre el contorno
        s.u += s.speed * dt;
        const p = ptAlong(L, s.ci, s.u);
        const off = lerpN(3, 24, sstep(0.2, 3.6, t)) * S;
        tx = p.x + p.nx * off; ty = p.y + p.ny * off;
      } else if (t < 6.6) {               // 2) orbita alrededor de la letra
        if (s.orbitA === null) { s.orbitA = Math.atan2(s.y - L.cy, s.x - L.cx); s.orbitR = Math.hypot(s.x - L.cx, s.y - L.cy); }
        s.orbitA += s.dir * 1.5 * dt;
        s.orbitR = lerpN(s.orbitR, Math.max(L.w, L.h) * 0.72, dt * 1.2);
        tx = L.cx + Math.cos(s.orbitA) * s.orbitR * 1.15;
        ty = L.cy + Math.sin(s.orbitA) * s.orbitR * 0.8;
      } else {                            // 3) se dispersa lentamente
        if (!s.vx && !s.vy) {
          const a = Math.atan2(s.y - L.cy, s.x - L.cx);
          s.vx = Math.cos(a) * 60 * S; s.vy = Math.sin(a) * 40 * S - 30 * S;
        }
        s.vy -= 12 * S * dt;
        tx = s.x + s.vx * dt * 4; ty = s.y + s.vy * dt * 4;
      }
      const k = Math.min(1, dt * 7);
      s.x += (tx - s.x) * k;
      s.y += (ty - s.y) * k;
      s.trail.unshift({ x: s.x, y: s.y });
      if (s.trail.length > 26) s.trail.pop();
      if (Math.random() < 0.35 * this.alpha) {
        Particles.add({ x: s.x, y: s.y, vx: rand(-12, 12), vy: rand(-12, 12), life: rand(0.5, 1.1), size: rand(2, 4) * S, col: [170, 215, 255], alpha: 0.8 });
      }
    }
  }

  drawFront() {
    const a = this.alpha;
    if (a <= 0) return;
    const body = Particles.sprite([140, 200, 255], 'glow');
    const head = Particles.sprite([200, 235, 255], 'glow');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.spirits) {
      const n = s.trail.length;
      for (let i = n - 1; i >= 0; i--) {
        const k = 1 - i / n;
        const r = (2 + 9 * k * k) * S * s.size;
        ctx.globalAlpha = a * 0.55 * k;
        const p = s.trail[i];
        // Ondulación lateral: cola de forma espiritual
        const wob = Math.sin(T * 6 + i * 0.5) * i * 0.15 * S;
        ctx.drawImage(body, p.x - r + wob, p.y - r - wob, r * 2, r * 2);
      }
      const r = 15 * S * s.size;
      ctx.globalAlpha = a;
      ctx.drawImage(head, s.x - r, s.y - r, r * 2, r * 2);
    }
    ctx.restore();
  }
}

/* ---------- RR · Electricidad verde y humo ---------- */
class LightningSpell extends PersistentSpell {
  constructor(group, clicked) {
    super('RR', group, clicked);
    this.amount = 0;
    this.bolts = [];
    this.flash = 1;
    this.spawnAcc = 0;
    this.bridgeAcc = 0;
  }
  toggle() { super.toggle(); this.flash = 1; }

  makeContourBolt() {
    const L = pick(this.group);
    const ci = randomContour(L);
    const c = L.contours[ci];
    const n = c.length;
    const start = Math.floor(rand(n));
    const len = Math.floor(n * rand(0.08, 0.28));
    const stepI = Math.max(2, Math.round(9 * S / L.sp));
    const pts = [];
    const branches = [];
    for (let k = 0; k <= len; k += stepI) {
      const p = c[(start + k) % n];
      const j = rand(-1, 1) * 5 * S;
      const q = { x: p.x + p.nx * j, y: p.y + p.ny * j };
      pts.push(q);
      if (Math.random() < 0.18) {
        const br = [q];
        let a = Math.atan2(p.ny, p.nx) + rand(-0.7, 0.7), x = q.x, y = q.y;
        for (let b = 0; b < 4; b++) {
          a += rand(-0.6, 0.6);
          const st = rand(5, 11) * S;
          x += Math.cos(a) * st; y += Math.sin(a) * st;
          br.push({ x, y });
        }
        branches.push(br);
      }
    }
    return { paths: [pts, ...branches], age: 0, life: rand(0.06, 0.16) };
  }

  // Descarga que une las dos R: así se perciben conectadas
  makeBridgeBolt() {
    const [A, B] = this.group[0].cx < this.group[1].cx ? this.group : [this.group[1], this.group[0]];
    const pa = pick(A.pts.filter((p) => p.x > A.cx + A.w * 0.15));
    const pb = pick(B.pts.filter((p) => p.x < B.cx - B.w * 0.15));
    if (!pa || !pb) return null;
    let pts = [{ x: pa.x, y: pa.y }, { x: pb.x, y: pb.y }];
    let disp = Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.22;
    for (let d = 0; d < 5; d++) {
      const np = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        np.push({ x: (a.x + b.x) / 2 + rand(-disp, disp), y: (a.y + b.y) / 2 + rand(-disp, disp) }, b);
      }
      pts = np;
      disp *= 0.55;
    }
    return { paths: [pts], age: 0, life: rand(0.08, 0.18) };
  }

  update(dt) {
    super.update(dt);
    if (!this.reversing) this.amount = Math.min(1, this.amount + dt / 2.6);
    else this.amount = Math.max(0, this.amount - dt / 1.5);
    if (this.reversing && this.amount <= 0) { this.dead = true; return; }

    this.flash = Math.max(0, this.flash - dt * 0.7);
    const burst = this.reversing ? Math.max(0, 1 - this.tPhase / 0.6) : Math.exp(-this.tPhase * 0.7);
    const rate = this.reversing ? 30 * burst : 5 + 45 * burst;   // descargas por segundo
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) { this.spawnAcc -= 1; this.bolts.push(this.makeContourBolt()); }
    if (!this.reversing) {
      this.bridgeAcc += (1.2 + 5 * burst) * dt;
      while (this.bridgeAcc >= 1) { this.bridgeAcc -= 1; const b = this.makeBridgeBolt(); if (b) this.bolts.push(b); }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      this.bolts[i].age += dt;
      if (this.bolts[i].age > this.bolts[i].life) this.bolts.splice(i, 1);
    }

    // Humo oscuro que nace en los bordes y asciende
    const smokeRate = this.reversing ? 0 : 14 + 110 * burst;
    for (const L of this.group) {
      const g = easeInOut(this.amount);
      L.green = Math.max(L.green, g);
      L.glow = Math.max(L.glow, 0.15 * g + 0.6 * burst * (this.reversing ? 0.4 : 1));
      L.glowCol = [80, 255, 120];
      let nS = smokeRate * dt;
      while (nS > 0) {
        if (Math.random() < nS) {
          const p = pick(L.pts);
          const back = Math.random() < 0.7;
          Particles.add({
            kind: 'smoke', layer: back ? 'back' : 'front',
            x: p.x + p.nx * 2 * S, y: p.y + p.ny * 2 * S,
            vx: p.nx * rand(5, 18) * S, vy: p.ny * rand(5, 12) * S - rand(15, 40) * S,
            drift: 25 * S, drag: 0.99, life: rand(1.8, 3.2), size: rand(6, 12) * S, grow: 2.2,
            col: [34, 52, 40], alpha: back ? 0.55 : 0.3,
          });
        }
        nS -= 1;
      }
    }
  }

  drawFront() {
    if (!this.bolts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const b of this.bolts) {
      const k = 1 - b.age / b.life;
      const fl = k * (0.6 + 0.4 * Math.random());
      const passes = [[7 * S, rgba([60, 255, 110], 0.16 * fl)], [2.8 * S, rgba([110, 255, 150], 0.55 * fl)], [1.1 * S, rgba([225, 255, 230], 0.95 * fl)]];
      for (const [w, col] of passes) {
        ctx.lineWidth = w;
        ctx.strokeStyle = col;
        ctx.beginPath();
        for (const path of b.paths) {
          ctx.moveTo(path[0].x, path[0].y);
          for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/* ---------- Y · Chispas y resplandor ---------- */
class SparksSpell extends TransientSpell {
  constructor(group, clicked) {
    super('Y', group, clicked, 5.5, 0.01, 0.01);
    this.waves = [{ t: 0, n: 110 }, { t: 0.14, n: 60 }, { t: 0.3, n: 40 }];
  }
  update(dt) {
    super.update(dt);
    const L = this.L;
    for (const w of this.waves) {
      if (!w.done && this.t >= w.t) {
        w.done = true;
        for (let i = 0; i < w.n; i++) {
          const p = pick(L.pts);
          const v = rand(90, 340) * S;
          Particles.add({
            kind: 'streak', x: p.x, y: p.y,
            vx: p.nx * v + rand(-40, 40) * S, vy: p.ny * v + rand(-40, 40) * S,
            ay: 240 * S, drag: 0.94, life: rand(0.5, 1.4), size: rand(2.5, 4.5) * S,
            col: pick([[255, 214, 120], [255, 250, 230], [255, 160, 70]]),
          });
        }
      }
    }
    if (this.t < 2 && Math.random() < 0.6) {
      const p = pick(L.pts);
      Particles.add({ x: p.x, y: p.y, life: rand(0.3, 0.7), size: rand(3, 6) * S, col: [255, 236, 170] });
    }
    // Brillo intenso que se mantiene y luego disminuye
    this.g = this.t < 2 ? 1 : Math.max(0, 1 - (this.t - 2) / 3.3);
    L.glow = Math.max(L.glow, this.g);
    L.glowCol = [255, 200, 110];
  }
  drawBack() {
    const g = this.g || 0;
    if (g <= 0) return;
    const L = this.L;
    const r = Math.max(L.w, L.h) * (0.9 + 0.15 * Math.sin(T * 9));
    const grd = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, r);
    grd.addColorStop(0, rgba([255, 215, 130], 0.45 * g));
    grd.addColorStop(1, rgba([255, 160, 60], 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = grd;
    ctx.fillRect(L.cx - r, L.cy - r, r * 2, r * 2);
    ctx.restore();
  }
}

/* ---------- P · Sombras de dementores ---------- */
class DementorSpell extends TransientSpell {
  constructor(group, clicked) {
    super('P', group, clicked, 11.5, 1.6, 2.6);
    const L = this.L;
    this.shades = [];
    for (let i = 0; i < 4; i++) {
      const size = rand(16, 24) * S;
      const nodes = [];
      for (let k = 0; k < 16; k++) nodes.push({ x: L.cx, y: L.cy });
      this.shades.push({
        a0: (i / 4) * PI2 + rand(-0.3, 0.3), w: rand(0.28, 0.45) * (i % 2 ? -1 : 1),
        rx: L.w * rand(0.85, 1.25), ry: L.h * rand(0.45, 0.7), yOff: rand(-0.15, 0.1) * L.h,
        size, seg: size * 0.42, nodes, depth: 0, seed: rand(100), placed: false,
      });
    }
  }
  update(dt) {
    super.update(dt);
    const L = this.L, a = this.alpha;
    L.frost = Math.max(L.frost, a);
    Spells.dread = Math.max(Spells.dread, a * 0.9);
    for (const s of this.shades) {
      const ang = s.a0 + s.w * this.t;
      s.depth = Math.sin(ang);
      const wob = (noise(s.seed, T * 0.4) - 0.5) * 40 * S;
      const tx = L.cx + Math.cos(ang) * s.rx + wob;
      const ty = L.cy + s.yOff - s.depth * s.ry * 0.35 + Math.sin(T * 0.7 + s.seed) * 10 * S;
      const head = s.nodes[0];
      if (!s.placed) { for (const nd of s.nodes) { nd.x = tx; nd.y = ty; } s.placed = true; }
      head.x += (tx - head.x) * Math.min(1, dt * 2.5);
      head.y += (ty - head.y) * Math.min(1, dt * 2.5);
      // El manto sigue a la cabeza como una cadena flexible y cae suavemente
      for (let k = 1; k < s.nodes.length; k++) {
        const p = s.nodes[k - 1], c = s.nodes[k];
        c.y += 14 * S * dt;
        const dx = c.x - p.x, dy = c.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d > s.seg) { c.x = p.x + (dx / d) * s.seg; c.y = p.y + (dy / d) * s.seg; }
      }
      if (Math.random() < 0.5 * a) {
        const nd = s.nodes[Math.floor(rand(4, 15))];
        Particles.add({ kind: 'smoke', layer: s.depth > 0 ? 'front' : 'back', x: nd.x, y: nd.y, vx: rand(-8, 8) * S, vy: rand(-4, 10) * S, drift: 12 * S, life: rand(1.5, 2.6), size: rand(8, 14) * S, grow: 1.4, col: [48, 50, 60], alpha: 0.35 });
      }
    }
  }
  drawShade(s) {
    const a = this.alpha;
    const n = s.nodes.length;
    const sp = Particles.sprite([62, 64, 78], "smoke");
    ctx.save();
    // Jirones del manto
    ctx.strokeStyle = rgba([70, 72, 82], 0.35 * a);
    ctx.lineWidth = 1.4 * S;
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      for (let k = 6; k < n; k++) {
        const nd = s.nodes[k];
        const x = nd.x + Math.sin(T * 2 + k * 0.6 + r * 2) * (k - 5) * 0.9 * S + (r - 1) * 5 * S;
        if (k === 6) ctx.moveTo(x, nd.y); else ctx.lineTo(x, nd.y + r * 3 * S);
      }
      ctx.stroke();
    }
    // Cuerpo vaporoso
    for (let k = n - 1; k >= 0; k--) {
      const nd = s.nodes[k];
      const f = 1 - k / n;
      const r = s.size * (0.4 + 0.75 * f) * (0.85 + 0.3 * noise(s.seed + k * 0.3, T * 0.8));
      ctx.globalAlpha = Math.min(1, a * (0.75 + 0.4 * f));
      ctx.drawImage(sp, nd.x - r, nd.y - r, r * 2, r * 2);
    }
    // Capucha y vacío del rostro
    const h = s.nodes[0], h2 = s.nodes[2];
    const ang = Math.atan2(h.y - h2.y, h.x - h2.x) + Math.PI / 2;
    ctx.globalAlpha = a * 0.92;
    ctx.translate(h.x, h.y);
    ctx.rotate(ang * 0.25);
    ctx.fillStyle = 'rgb(28,28,34)';
    ctx.beginPath();
    ctx.moveTo(0, -s.size * 0.85);
    ctx.quadraticCurveTo(s.size * 0.7, -s.size * 0.4, s.size * 0.55, s.size * 0.55);
    ctx.lineTo(-s.size * 0.55, s.size * 0.55);
    ctx.quadraticCurveTo(-s.size * 0.7, -s.size * 0.4, 0, -s.size * 0.85);
    ctx.fill();
    ctx.fillStyle = 'rgb(6,6,9)';
    ctx.beginPath();
    ctx.ellipse(0, s.size * 0.05, s.size * 0.25, s.size * 0.32, 0, 0, PI2);
    ctx.fill();
    ctx.restore();
  }
  drawBack() { for (const s of this.shades) if (s.depth <= 0) this.drawShade(s); }
  drawFront() { for (const s of this.shades) if (s.depth > 0) this.drawShade(s); }
}

/* ---------- O · Arañas ---------- */
class SpiderSpell extends TransientSpell {
  constructor(group, clicked) {
    super('O', group, clicked, 12, 0.01, 1.8);
    const L = this.L;
    this.ci = L.outer;
    // Grosor aproximado del trazo de la O (distancia contorno exterior → interior)
    let stroke = L.w * 0.12;
    const inner = L.contours.findIndex((c, i) => i !== L.outer);
    if (inner >= 0) {
      const xs = L.contours[inner].map((p) => p.x);
      stroke = Math.max(4 * S, (L.w - (Math.max(...xs) - Math.min(...xs))) / 2);
    }
    this.stroke = stroke;
    this.spiders = [];
    for (let i = 0; i < 9; i++) {
      const base = -stroke * rand(0.3, 0.6);
      this.spiders.push({
        u: rand(1), dir: Math.random() < 0.5 ? 1 : -1, speed: rand(0.025, 0.06),
        size: rand(6, 9.5) * S, base, off: base, offT: base, wander: rand(1.5, 4.5), wanderLeft: 0,
        delay: rand(0, 1.4), phase: rand(PI2), x: 0, y: 0, head: 0, seed: rand(100), init: false,
      });
    }
  }
  update(dt) {
    super.update(dt);
    const L = this.L;
    const leaving = this.t > this.dur - this.fadeOut;
    for (const s of this.spiders) {
      if (this.t < s.delay) continue;
      const spd = s.speed * (1 + 0.5 * Math.sin(T * 3 + s.seed));
      s.u += s.dir * spd * dt;
      // A veces una araña se aleja del contorno y luego regresa
      s.wander -= dt;
      if (s.wanderLeft > 0) { s.wanderLeft -= dt; if (s.wanderLeft <= 0) { s.offT = s.base; s.wander = rand(2, 5); } }
      else if (s.wander <= 0) { s.offT = rand(14, 36) * S; s.wanderLeft = rand(0.8, 1.6); }
      if (leaving) s.offT = 70 * S;
      s.off += (s.offT - s.off) * Math.min(1, dt * 3);
      const p = ptAlong(L, this.ci, s.u);
      const nx = p.x + p.nx * s.off, ny = p.y + p.ny * s.off;
      if (!s.init) { s.x = nx; s.y = ny; s.init = true; s.head = Math.atan2(-p.nx * s.dir, p.ny * s.dir); }
      const mx = nx - s.x, my = ny - s.y;
      const moved = Math.hypot(mx, my);
      if (moved > 0.01) {
        const target = Math.atan2(my, mx);
        let d = target - s.head;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        s.head += d * Math.min(1, dt * 10);
      }
      s.phase += moved / (s.size * 0.35);
      s.x = nx; s.y = ny;
    }
  }
  drawSpider(s) {
    const sz = s.size;
    const emerge = clamp01((this.t - s.delay) / 0.5);
    if (emerge <= 0) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.head);
    ctx.scale(emerge, emerge);
    ctx.strokeStyle = 'rgb(22,20,24)';
    ctx.lineWidth = Math.max(0.8, 0.85 * S);
    ctx.lineCap = 'round';
    // 8 patas animadas: cada par alterna su fase
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 4; i++) {
        const swing = Math.sin(s.phase + i * Math.PI * 0.5 + (side > 0 ? Math.PI : 0)) * 0.35;
        const baseA = side * (Math.PI / 2) + (i - 1.5) * -0.42 * side + swing * side;
        const bx = sz * (0.25 - i * 0.12);
        const kx = bx + Math.cos(baseA) * sz * 0.9;
        const ky = Math.sin(baseA) * sz * 0.9;
        const fA = baseA + side * 0.6 - (i - 1.5) * 0.25 * side;
        const fx = kx + Math.cos(fA) * sz * 0.95;
        const fy = ky + Math.sin(fA) * sz * 0.95;
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.lineTo(kx, ky - side * sz * 0.15);
        ctx.lineTo(fx, fy);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgb(20,18,22)';
    ctx.strokeStyle = 'rgba(150,150,165,0.45)';
    ctx.lineWidth = 0.7 * S;
    ctx.beginPath(); ctx.ellipse(-sz * 0.55, 0, sz * 0.62, sz * 0.5, 0, 0, PI2); ctx.fill(); ctx.stroke();   // abdomen
    ctx.beginPath(); ctx.ellipse(sz * 0.15, 0, sz * 0.36, sz * 0.3, 0, 0, PI2); ctx.fill(); ctx.stroke();    // cefalotórax
    ctx.beginPath(); ctx.arc(sz * 0.5, 0, sz * 0.18, 0, PI2); ctx.fill();                                   // cabeza
    ctx.fillStyle = 'rgb(210,50,50)';
    ctx.beginPath(); ctx.arc(sz * 0.6, -sz * 0.07, sz * 0.05 + 0.3, 0, PI2); ctx.arc(sz * 0.6, sz * 0.07, sz * 0.05 + 0.3, 0, PI2); ctx.fill();
    ctx.restore();
  }
  drawFront() {
    const a = this.alpha;
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    for (const s of this.spiders) this.drawSpider(s);
    ctx.restore();
  }
}

/* ---------- TT · Criaturas peludas ---------- */
class FurSpell extends PersistentSpell {
  constructor(group, clicked) {
    super('TT', group, clicked);
    this.amount = 0;
    this.creatures = group
      .slice()
      .sort((a, b) => a.cx - b.cx)
      .map((L, idx) => {
        const strands = [];
        for (let i = 0; i < L.pts.length; i += 2) {
          strands.push({ p: L.pts[i], len: rand(6, 15) * S * (0.6 + 0.8 * noise(i * 0.05, idx * 10)), col: Math.floor(rand(3)), ph: rand(PI2) });
        }
        // Base de la cola: costado del fuste cerca de la base (izquierda la primera T, derecha la segunda)
        const side = idx === 0 ? -1 : 1;
        const cand = L.pts.filter((p) => p.y > L.bb.y2 - L.h * 0.28 && p.y < L.bb.y2 - L.h * 0.08 && p.nx * side > 0.7);
        cand.sort((a, b) => Math.abs(a.x - L.cx) - Math.abs(b.x - L.cx));
        const tailBase = cand[0] || { x: L.cx + side * L.w * 0.1, y: L.bb.y2 - L.h * 0.15 };
        return {
          L, strands, side, tailBase, seed: rand(100),
          ears: [-1, 1].map((e) => ({ x: L.cx + e * L.w * rand(0.2, 0.27), flick: 0, e })),
          blink: rand(1, 4), blinkT: 0,
        };
      });
  }
  update(dt) {
    super.update(dt);
    if (!this.reversing) this.amount = Math.min(1, this.amount + dt / 1.8);
    else this.amount = Math.max(0, this.amount - dt / 1.2);
    if (this.reversing && this.amount <= 0) { this.dead = true; return; }
    for (const c of this.creatures) {
      c.L.fur = Math.max(c.L.fur, easeInOut(this.amount));
      for (const ear of c.ears) {
        ear.flick = Math.max(0, ear.flick - dt * 3);
        if (Math.random() < dt * 0.4) ear.flick = 1;
      }
      c.blink -= dt;
      if (c.blink <= 0) { c.blinkT = 0.14; c.blink = rand(2, 5); }
      c.blinkT = Math.max(0, c.blinkT - dt);
    }
  }
  drawBack() {
    const a = easeInOut(this.amount);
    if (a <= 0) return;
    for (const c of this.creatures) {
      const L = c.L;
      L.push();
      // Orejas (detrás de la barra superior de la T)
      for (const ear of c.ears) {
        const h = L.h * 0.3 * a;
        const w = L.w * 0.16;
        const tw = ear.e * 0.18 + Math.sin(T * 1.4 + c.seed + ear.e) * 0.06 - ear.flick * 0.35 * ear.e;
        ctx.save();
        ctx.translate(ear.x, L.bb.y1 + L.h * 0.06);
        ctx.rotate(tw);
        ctx.fillStyle = 'rgb(176,134,96)';
        ctx.beginPath();
        ctx.moveTo(-w / 2, 0);
        ctx.quadraticCurveTo(-w * 0.35, -h * 0.7, 0, -h);
        ctx.quadraticCurveTo(w * 0.35, -h * 0.7, w / 2, 0);
        ctx.fill();
        ctx.fillStyle = 'rgb(232,166,176)';
        ctx.beginPath();
        ctx.moveTo(-w * 0.25, -h * 0.05);
        ctx.quadraticCurveTo(-w * 0.15, -h * 0.55, 0, -h * 0.78);
        ctx.quadraticCurveTo(w * 0.15, -h * 0.55, w * 0.25, -h * 0.05);
        ctx.fill();
        ctx.restore();
      }
      // Cola procedural: cadena de segmentos que ondula
      const pts = [{ x: c.tailBase.x, y: c.tailBase.y }];
      let ang = c.side > 0 ? 0.35 : Math.PI - 0.35;
      const seg = L.h * 0.055 * a;
      for (let k = 0; k < 14; k++) {
        ang += Math.sin(T * 2.6 - k * 0.45 + c.seed) * 0.2 * c.side - 0.07 * c.side;
        const p = pts[pts.length - 1];
        pts.push({ x: p.x + Math.cos(ang) * seg, y: p.y + Math.sin(ang) * seg });
      }
      const wBase = L.h * 0.12 * a;
      const outerP = ribbonPath(pts, wBase, wBase * 0.7);
      const innerP = ribbonPath(pts, wBase * 0.6, wBase * 0.35);
      if (outerP) {
        ctx.fillStyle = 'rgb(160,120,86)'; ctx.fill(outerP);
        ctx.fillStyle = 'rgb(214,178,138)'; ctx.fill(innerP);
        ctx.strokeStyle = 'rgba(160,120,86,0.9)';
        ctx.lineWidth = 1.2 * S;
        ctx.beginPath();
        for (let k = 1; k < pts.length; k++) {
          for (let j = 0; j < 3; j++) {
            const r = wBase * 0.5;
            const fa = k * 1.7 + j * 2.1 + Math.sin(T * 3 + k) * 0.25;
            ctx.moveTo(pts[k].x + Math.cos(fa) * r * 0.7, pts[k].y + Math.sin(fa) * r * 0.7);
            ctx.lineTo(pts[k].x + Math.cos(fa) * r * 1.25, pts[k].y + Math.sin(fa) * r * 1.25);
          }
        }
        ctx.stroke();
      }
      L.pop();
    }
  }
  drawFront() {
    const a = easeInOut(this.amount);
    if (a <= 0) return;
    const cols = ['rgb(172,130,92)', 'rgb(212,176,136)', 'rgb(240,220,190)'];
    for (const c of this.creatures) {
      const L = c.L;
      L.push();
      ctx.lineWidth = 1.3 * S;
      ctx.lineCap = 'round';
      // Pelo: hebras que nacen en el contorno y se mecen (agrupadas por color)
      for (let ci = 0; ci < 3; ci++) {
        ctx.strokeStyle = cols[ci];
        ctx.beginPath();
        for (const s of c.strands) {
          if (s.col !== ci) continue;
          const p = s.p;
          const sway = Math.sin(T * 2.2 + s.ph) * 0.22 + (noise(p.x * 0.01, T * 0.4) - 0.5) * 0.6;
          const ang = Math.atan2(p.ny, p.nx) + sway;
          const len = s.len * a;
          const bx = p.x - p.nx * 1.5 * S, by = p.y - p.ny * 1.5 * S;
          const tx = bx + Math.cos(ang) * len, ty = by + Math.sin(ang) * len;
          const cx = bx + Math.cos(ang - sway * 0.8) * len * 0.5, cy = by + Math.sin(ang - sway * 0.8) * len * 0.5;
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(cx, cy, tx, ty);
        }
        ctx.stroke();
      }
      // Ojos que parpadean sobre la barra
      if (a > 0.6) {
        const ea = (a - 0.6) / 0.4;
        const ey = L.bb.y1 + L.h * 0.1;
        const sy = c.blinkT > 0 ? 0.12 : 1;
        for (const e of [-1, 1]) {
          const ex = L.cx + e * L.w * 0.12;
          const r = L.h * 0.035;
          ctx.fillStyle = rgba([30, 22, 18], ea);
          ctx.beginPath(); ctx.ellipse(ex, ey, r, r * 1.2 * sy, 0, 0, PI2); ctx.fill();
          if (sy > 0.5) {
            ctx.fillStyle = rgba([255, 255, 255], ea);
            ctx.beginPath(); ctx.arc(ex - r * 0.3, ey - r * 0.4, r * 0.3, 0, PI2); ctx.fill();
          }
        }
      }
      L.pop();
    }
  }
}

/* ---------- E · Transformación en piedra ---------- */
class StoneSpell extends PersistentSpell {
  constructor(group, clicked) {
    super('E', group, clicked);
    const L = this.L;
    this.stone = 0;
    this.cracksP = 0;
    this.thud = false;
    this.speckles = [];
    this.blotches = [];
    this.cracks = [];
    // Muestras dentro de la letra (rechazo en la caja)
    let tries = 0;
    while (this.speckles.length < 320 && tries++ < 8000) {
      const x = rand(L.bb.x1, L.bb.x2), y = rand(L.bb.y1, L.bb.y2);
      if (L.inside(x, y)) this.speckles.push({ x, y, r: rand(0.6, 2.8) * S, dark: Math.random() < 0.6, a: rand(0.25, 0.7) });
    }
    tries = 0;
    while (this.blotches.length < 40 && tries++ < 4000) {
      const x = rand(L.bb.x1, L.bb.x2), y = rand(L.bb.y1, L.bb.y2);
      if (L.inside(x, y)) this.blotches.push({ x, y, r: rand(6, 18) * S, dark: Math.random() < 0.6 });
    }
    // Grietas: caminatas aleatorias desde el borde hacia el interior
    for (let i = 0; i < 11; i++) {
      const p = pick(L.pts);
      const pts = [{ x: p.x, y: p.y }];
      let a = Math.atan2(-p.ny, -p.nx) + rand(-0.4, 0.4), x = p.x, y = p.y;
      const steps = Math.floor(rand(8, 22));
      for (let k = 0; k < steps; k++) {
        a += rand(-0.55, 0.55);
        x += Math.cos(a) * 3 * S; y += Math.sin(a) * 3 * S;
        pts.push({ x, y });
        if (k > 3 && Math.random() < 0.12) {
          const br = [{ x, y }];
          let b = a + rand(0.6, 1.1) * (Math.random() < 0.5 ? -1 : 1), bx = x, by = y;
          for (let j = 0; j < 5; j++) { b += rand(-0.5, 0.5); bx += Math.cos(b) * 2.6 * S; by += Math.sin(b) * 2.6 * S; br.push({ x: bx, y: by }); }
          this.cracks.push({ pts: br, d: rand(0.3, 0.7) });
        }
      }
      this.cracks.push({ pts, d: rand(0, 0.35) });
    }
    this.dustBurst(40);
  }
  toggle() { super.toggle(); this.thud = false; this.from = this.stone; this.dustBurst(50); }
  dustBurst(n) {
    const L = this.L;
    for (let i = 0; i < n; i++) {
      const p = pick(L.pts);
      Particles.add({ kind: 'smoke', x: p.x, y: p.y, vx: p.nx * rand(10, 60) * S, vy: p.ny * rand(10, 40) * S - rand(0, 20) * S, ay: 60 * S, drag: 0.95, life: rand(0.8, 1.8), size: rand(2, 5) * S, grow: 1.2, col: [176, 170, 160], alpha: 0.7 });
    }
  }
  update(dt) {
    super.update(dt);
    const L = this.L, t = this.tPhase;
    let shake;
    if (!this.reversing) {
      shake = 3.6 * S * (1 - sstep(1.7, 2.3, t));
      this.stone = Math.max(this.stone, sstep(0.3, 2.4, t));
      this.cracksP = Math.max(this.cracksP, sstep(0.8, 2.6, t));
      if (!this.thud && t > 2.35) { this.thud = true; this.dustBurst(35); }
      if (t < 2.2 && Math.random() < dt * 70) this.dustBurst(1);
    } else {
      shake = 2 * S * (1 - sstep(0, 0.7, t));
      const k = 1 - sstep(0, 1.6, t);
      this.stone = (this.from || 1) * k;
      this.cracksP = Math.min(this.cracksP, this.stone);
      if (this.stone <= 0.001) { this.dead = true; return; }
    }
    L.shakeAmt = Math.max(L.shakeAmt, shake);
    L.stone = Math.max(L.stone, this.stone);
    L.stoneFx = this;
  }
  // Se dibuja dentro de drawLetter, recortado a la forma de la letra
  drawSurface(L) {
    const s = this.stone;
    if (s <= 0) return;
    ctx.save();
    ctx.clip(L.p2d);
    for (const b of this.blotches) {
      ctx.fillStyle = b.dark ? rgba([70, 66, 60], 0.2 * s) : rgba([200, 195, 185], 0.14 * s);
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, PI2); ctx.fill();
    }
    for (const p of this.speckles) {
      ctx.fillStyle = p.dark ? rgba([50, 47, 44], p.a * s) : rgba([225, 220, 210], p.a * 0.8 * s);
      ctx.fillRect(p.x, p.y, p.r, p.r);
    }
    // Sombra interior en los bordes: volumen de roca
    ctx.lineWidth = 10 * S;
    ctx.strokeStyle = rgba([36, 34, 31], 0.38 * s);
    ctx.stroke(L.p2d);
    // Grietas que se revelan progresivamente
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const c of this.cracks) {
      const prog = clamp01((this.cracksP - c.d) / (1 - c.d));
      if (prog <= 0) continue;
      const pts = partialPts(c.pts, prog);
      if (pts.length < 2) continue;
      for (const [dx, col, w] of [[S, rgba([255, 255, 255], 0.18 * s), 0.9 * S], [0, rgba([28, 26, 24], 0.85 * s), 1.4 * S]]) {
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(pts[0].x + dx, pts[0].y + dx);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + dx, pts[i].y + dx);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/* ---------- R final · Levitación ---------- */
class LevitateSpell extends PersistentSpell {
  constructor(group, clicked) {
    super('RF', group, clicked);
    this.amount = 0;
    this.landed = false;
  }
  update(dt) {
    super.update(dt);
    const L = this.L;
    if (!this.reversing) this.amount = Math.min(1, this.amount + dt / 2.4);
    else this.amount = Math.max(0, this.amount - dt / 1.9);
    const e = easeInOut(this.amount);
    if (this.reversing && this.amount <= 0) {
      this.dead = true;
      for (let i = 0; i < 20; i++) {
        const p = pick(L.pts.filter((q) => q.ny > 0.4)) || pick(L.pts);
        Particles.add({ kind: 'smoke', x: p.x, y: p.y, vx: rand(-40, 40) * S, vy: rand(-15, 0) * S, drag: 0.94, life: rand(0.6, 1.2), size: rand(3, 6) * S, grow: 1, col: [150, 140, 190], alpha: 0.5 });
      }
      return;
    }
    L.lev = e;
    L.oy += -e * L.h * 0.22 + Math.sin(T * 1.6) * 5 * S * e;
    L.rot += Math.sin(T * 0.9) * 0.06 * e;
    L.glow = Math.max(L.glow, 0.25 * e);
    L.glowCol = [200, 175, 255];
    // Partículas mágicas que caen desde la base de la letra flotante
    if (Math.random() < 40 * e * dt) {
      const p = pick(L.pts.filter((q) => q.ny > 0.4)) || pick(L.pts);
      const w = L.toWorld(p.x, p.y);
      Particles.add({ x: w.x + rand(-3, 3) * S, y: w.y, vx: rand(-10, 10) * S, vy: rand(12, 35) * S, drift: 10 * S, life: rand(1, 2), size: rand(3, 6) * S, col: pick([[205, 175, 255], [255, 225, 160]]), alpha: 0.85 });
    }
  }
  drawBack() {
    const e = easeInOut(this.amount);
    if (e <= 0) return;
    const L = this.L;
    const rx = L.w * 0.65, ry = 8 * S;
    const y = L.bb.y2 + 6 * S;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(L.cx, y);
    ctx.scale(1, ry / rx);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba([190, 160, 255], 0.4 * e));
    g.addColorStop(1, rgba([120, 90, 220], 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, rx, 0, PI2); ctx.fill();
    ctx.restore();
  }
}

/* ==========================================================
   GESTOR DE HECHIZOS
   ========================================================== */
const Spells = (() => {
  const CLASSES = { H: RootsSpell, A: PatronusSpell, RR: LightningSpell, Y: SparksSpell, P: DementorSpell, O: SpiderSpell, TT: FurSpell, E: StoneSpell, RF: LevitateSpell };
  const PERSISTENT = { RR: true, TT: true, E: true, RF: true };
  let active = [];
  const api = { dread: 0 };

  // Regla de interacción:
  //  · Transitorio → cada clic lanza el hechizo otra vez (máx. 2 simultáneos).
  //  · Persistente → el primer clic transforma; el siguiente lo invierte.
  api.cast = function (key, clicked) {
    const group = letters.filter((l) => l.spell === key);
    if (!group.length || !CLASSES[key]) return;
    if (PERSISTENT[key]) {
      const ex = active.find((s) => s.key === key && !s.dead);
      if (ex) { ex.toggle(); Sound.play(key, { reverse: ex.reversing }); return; }
      active.push(new CLASSES[key](group, clicked));
      Sound.play(key);
      return;
    }
    const same = active.filter((s) => s.key === key && !s.dead && !s.ending);
    if (same.length >= 2) same[0].end();
    active.push(new CLASSES[key](group, clicked));
    Sound.play(key);
  };

  api.isTransformed = (key) => active.some((s) => s.key === key && !s.dead && s.reversing === false);

  api.update = function (dt) {
    api.dread = 0;
    for (const s of active) s.update(dt);
    active = active.filter((s) => !s.dead);
  };

  api.drawBack = function () {
    if (api.dread > 0.001) {
      ctx.save();
      ctx.fillStyle = rgba([4, 7, 16], 0.5 * api.dread);
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    for (const s of active) s.drawBack();
  };
  api.drawFront = function () { for (const s of active) s.drawFront(); };
  api.clear = function () { active = []; api.dread = 0; };
  api.count = () => active.length;
  return api;
})();
