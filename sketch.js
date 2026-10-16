/* ==========================================================
   sketch.js — Núcleo de la experiencia (p5.js)
   ----------------------------------------------------------
   · Carga la tipografía y convierte cada letra en geometría
     (contornos muestreados + normales + Path2D para dibujar).
   · Detecta sobre qué letra está / hace clic la varita.
   · Dibuja el cielo, las letras con volumen y la varita.
   · Los hechizos y partículas viven en effects.js.
   ========================================================== */

// Cada índice de la frase se asocia a un hechizo (null = espacio)
const PHRASE = 'HARRY POTTER';
const SPELL_BY_INDEX = ['H', 'A', 'RR', 'RR', 'Y', null, 'P', 'O', 'TT', 'TT', 'E', 'RF'];
const FONT_FILE = 'assets/fonts/CinzelDecorative-Black.ttf';

// Estado global compartido con effects.js
let font = null;
let ctx;              // contexto 2D nativo del lienzo
let letters = [];
let S = 1;            // unidad de escala: 1 ≈ letra de 200 px
let T = 0;            // tiempo acumulado en segundos
let bgLayer;          // cielo estático pre-renderizado
let twinkles = [];
let shooting = null;
let nextShooting = 6;
let hovered = null;
let hintHidden = false;
const wand = { x: -999, y: -999, px: -999, py: -999, vx: 0, flash: 0, visible: false };

/* ---------------- Geometría de las letras ---------------- */

// Convierte los comandos de opentype.js (M, L, Q, C, Z) en polilíneas
function flattenPath(cmds) {
  const contours = [];
  let cur = null, px = 0, py = 0;
  for (const c of cmds) {
    if (c.type === 'M') { cur = [{ x: c.x, y: c.y }]; contours.push(cur); px = c.x; py = c.y; }
    else if (c.type === 'L') { cur.push({ x: c.x, y: c.y }); px = c.x; py = c.y; }
    else if (c.type === 'Q') {
      for (let i = 1; i <= 8; i++) {
        const t = i / 8, m = 1 - t;
        cur.push({ x: m * m * px + 2 * m * t * c.x1 + t * t * c.x, y: m * m * py + 2 * m * t * c.y1 + t * t * c.y });
      }
      px = c.x; py = c.y;
    } else if (c.type === 'C') {
      for (let i = 1; i <= 10; i++) {
        const t = i / 10, m = 1 - t;
        cur.push({
          x: m * m * m * px + 3 * m * m * t * c.x1 + 3 * m * t * t * c.x2 + t * t * t * c.x,
          y: m * m * m * py + 3 * m * m * t * c.y1 + 3 * m * t * t * c.y2 + t * t * t * c.y,
        });
      }
      px = c.x; py = c.y;
    }
  }
  return contours.filter((c) => c.length > 2);
}

// Remuestrea un contorno cerrado con separación constante
function resampleClosed(poly, spacing) {
  const pts = poly.slice();
  const f = pts[0], l = pts[pts.length - 1];
  if (Math.hypot(f.x - l.x, f.y - l.y) > 0.01) pts.push({ x: f.x, y: f.y });
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const n = Math.max(8, Math.round(total / spacing));
  const step = total / n;
  const out = [];
  let seg = 1, acc = 0, segLen = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
  for (let k = 0; k < n; k++) {
    const d = k * step;
    while (acc + segLen < d && seg < pts.length - 1) {
      acc += segLen; seg++;
      segLen = Math.hypot(pts[seg].x - pts[seg - 1].x, pts[seg].y - pts[seg - 1].y);
    }
    const t = segLen > 0 ? (d - acc) / segLen : 0;
    const a = pts[seg - 1], b = pts[seg];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

class Letter {
  constructor(ch, index, spell, path, fs) {
    this.ch = ch;
    this.index = index;
    this.spell = spell;
    this.fs = fs;
    this.p2d = new Path2D(path.toPathData(2));
    const bb = path.getBoundingBox();
    this.bb = { x1: bb.x1, y1: bb.y1, x2: bb.x2, y2: bb.y2 };
    this.w = bb.x2 - bb.x1;
    this.h = bb.y2 - bb.y1;
    this.cx = (bb.x1 + bb.x2) / 2;
    this.cy = (bb.y1 + bb.y2) / 2;

    // Contornos muestreados: base de raíces, rayos, pelo, arañas…
    this.raw = flattenPath(path.commands);
    this.sp = Math.max(2, 3 * S);
    this.contours = this.raw.map((c, ci) => resampleClosed(c, this.sp).map((p, i) => ({ x: p.x, y: p.y, nx: 0, ny: 0, c: ci, i })));
    for (const c of this.contours) {
      const n = c.length;
      for (let i = 0; i < n; i++) {
        const a = c[(i - 1 + n) % n], b = c[(i + 1) % n];
        let nx = b.y - a.y, ny = -(b.x - a.x);
        const m = Math.hypot(nx, ny) || 1;
        nx /= m; ny /= m;
        // La normal debe apuntar HACIA AFUERA de la letra
        if (this.inside(c[i].x + nx * 1.5, c[i].y + ny * 1.5)) { nx = -nx; ny = -ny; }
        c[i].nx = nx; c[i].ny = ny;
      }
    }
    this.pts = this.contours.flat();
    // Contorno exterior = el de mayor caja
    let best = 0, bestA = -1;
    this.contours.forEach((c, i) => {
      const xs = c.map((p) => p.x), ys = c.map((p) => p.y);
      const a = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      if (a > bestA) { bestA = a; best = i; }
    });
    this.outer = best;
    this.hover = 0;
    this.resetDynamic();
  }

  // Valores que los hechizos vuelven a escribir en cada fotograma
  resetDynamic() {
    this.ox = 0; this.oy = 0; this.rot = 0; this.shakeAmt = 0;
    this.glow = 0; this.glowCol = [255, 215, 140];
    this.green = 0; this.stone = 0; this.fur = 0; this.frost = 0; this.lev = 0;
    this.stoneFx = null;
  }

  // Punto dentro de la letra (regla par-impar sobre los contornos)
  inside(x, y) {
    let inside = false;
    for (const c of this.raw) {
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const a = c[i], b = c[j];
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
    }
    return inside;
  }

  distTo(x, y) {
    let d = Infinity;
    for (const p of this.pts) {
      const dd = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (dd < d) d = dd;
    }
    return Math.sqrt(d);
  }

  // Transformación actual de la letra (levitar, temblar, girar)
  push() {
    ctx.save();
    const sx = this.shakeAmt ? rand(-1, 1) * this.shakeAmt : 0;
    const sy = this.shakeAmt ? rand(-1, 1) * this.shakeAmt : 0;
    ctx.translate(this.cx + this.ox + sx, this.cy + this.oy + sy);
    if (this.rot) ctx.rotate(this.rot);
    ctx.translate(-this.cx, -this.cy);
  }
  pop() { ctx.restore(); }

  toWorld(x, y) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const dx = x - this.cx, dy = y - this.cy;
    return { x: this.cx + this.ox + dx * c - dy * s, y: this.cy + this.oy + dx * s + dy * c };
  }
  toLocal(x, y) {
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
    const dx = x - this.cx - this.ox, dy = y - this.cy - this.oy;
    return { x: this.cx + dx * c - dy * s, y: this.cy + dx * s + dy * c };
  }
}

// Distribuye HARRY POTTER en una o dos líneas según la proporción de pantalla
function buildLetters() {
  const otf = font.font;
  const upm = otf.unitsPerEm;
  const capH = ((otf.tables.os2 && otf.tables.os2.sCapHeight) || upm * 0.7) / upm;
  const twoLines = width < height * 1.05;
  const lines = twoLines ? [[0, 5], [6, 12]] : [[0, 12]];
  const track = 0.045;

  const glyphs = [...PHRASE].map((ch) => otf.charToGlyph(ch));
  const lineW = ([a, b]) => {
    let w = 0;
    for (let i = a; i < b; i++) {
      w += glyphs[i].advanceWidth / upm + track;
      if (i + 1 < b) w += otf.getKerningValue(glyphs[i], glyphs[i + 1]) / upm;
    }
    return w - track;
  };
  const maxW = Math.max(...lines.map(lineW));
  const fs = Math.min((width * (twoLines ? 0.84 : 0.88)) / maxW, height * (twoLines ? 0.22 : 0.3));
  S = fs / 200;

  const gap = fs * 0.32;
  const blockH = lines.length * capH * fs + (lines.length - 1) * gap;
  let baseline = height * 0.48 - blockH / 2 + capH * fs;

  letters = [];
  for (const ln of lines) {
    let x = (width - lineW(ln) * fs) / 2;
    for (let i = ln[0]; i < ln[1]; i++) {
      const ch = PHRASE[i];
      if (ch !== ' ') {
        const path = otf.getPath(ch, x, baseline, fs);
        letters.push(new Letter(ch, i, SPELL_BY_INDEX[i], path, fs));
      }
      x += (glyphs[i].advanceWidth / upm + track) * fs;
      if (i + 1 < ln[1]) x += (otf.getKerningValue(glyphs[i], glyphs[i + 1]) / upm) * fs;
    }
    baseline += capH * fs + gap;
  }
}

/* ---------------- Cielo nocturno ---------------- */
function buildSky() {
  bgLayer = createGraphics(width, height);
  bgLayer.pixelDensity(pixelDensity());
  const g = bgLayer.drawingContext;
  const grd = g.createLinearGradient(0, 0, 0, height);
  grd.addColorStop(0, '#02030a');
  grd.addColorStop(0.55, '#070b1e');
  grd.addColorStop(1, '#0d1430');
  g.fillStyle = grd;
  g.fillRect(0, 0, width, height);
  // Nebulosas tenues
  for (let i = 0; i < 6; i++) {
    const x = rand(width), y = rand(height * 0.8), r = rand(0.2, 0.45) * Math.max(width, height);
    const col = pick([[60, 50, 120], [30, 60, 120], [80, 40, 100]]);
    const ng = g.createRadialGradient(x, y, 0, x, y, r);
    ng.addColorStop(0, rgba(col, 0.13));
    ng.addColorStop(1, rgba(col, 0));
    g.fillStyle = ng;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Estrellas fijas
  const n = Math.floor((width * height) / 2600);
  for (let i = 0; i < n; i++) {
    const a = rand(0.15, 0.7);
    g.fillStyle = `rgba(230,235,255,${a})`;
    const r = Math.random() < 0.92 ? rand(0.3, 0.9) : rand(1, 1.6);
    g.beginPath(); g.arc(rand(width), rand(height), r, 0, PI2); g.fill();
  }
  // Estrellas que titilan (se dibujan en cada fotograma)
  twinkles = [];
  const nt = Math.floor((width * height) / 9000);
  for (let i = 0; i < nt; i++) {
    twinkles.push({ x: rand(width), y: rand(height), r: rand(2, 5.5), ph: rand(PI2), sp: rand(0.6, 2.2), col: pick([[220, 230, 255], [255, 240, 210], [200, 210, 255]]) });
  }
}

function drawSky(dt) {
  image(bgLayer, 0, 0, width, height);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dim = 1 - Spells.dread * 0.7;
  for (const s of twinkles) {
    const a = (0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(T * s.sp + s.ph), 3)) * dim;
    ctx.globalAlpha = a;
    ctx.drawImage(Particles.sprite(s.col, 'glow'), s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
  }
  // Estrella fugaz ocasional
  nextShooting -= dt;
  if (!shooting && nextShooting <= 0) {
    const ang = rand(0.25, 0.6);
    shooting = { x: rand(width * 0.1, width * 0.7), y: rand(height * 0.05, height * 0.3), vx: Math.cos(ang) * 900, vy: Math.sin(ang) * 900, age: 0 };
    nextShooting = rand(7, 16);
  }
  if (shooting) {
    shooting.age += dt;
    shooting.x += shooting.vx * dt;
    shooting.y += shooting.vy * dt;
    const k = Math.max(0, 1 - shooting.age / 0.9);
    const tx = shooting.x - shooting.vx * 0.12, ty = shooting.y - shooting.vy * 0.12;
    const grd = ctx.createLinearGradient(tx, ty, shooting.x, shooting.y);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(1, `rgba(255,255,255,${0.8 * k * dim})`);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = grd;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(shooting.x, shooting.y); ctx.stroke();
    if (k <= 0) shooting = null;
  }
  ctx.restore();
}

/* ---------------- Letras con volumen ---------------- */
function mixCol(a, b, t) { return [lerpN(a[0], b[0], t), lerpN(a[1], b[1], t), lerpN(a[2], b[2], t)]; }

function drawLetter(L) {
  // Color de la cara según las transformaciones activas
  let c = [250, 247, 240];
  if (L.frost) c = mixCol(c, [178, 192, 214], 0.45 * L.frost);
  if (L.fur) c = mixCol(c, [255, 233, 204], 0.55 * L.fur);
  if (L.green) c = mixCol(c, [26, 92, 50], L.green);
  if (L.stone) c = mixCol(c, [134, 129, 121], L.stone);

  const depth = Math.max(6, Math.round(10 * S));
  const total = L.fs * 0.055;
  const dx = (total * 0.55) / depth, dy = total / depth;

  L.push();

  // Sombra proyectada (se aleja si la letra levita)
  ctx.save();
  ctx.translate(-L.ox * 0.3, -L.oy * 0.9);
  ctx.shadowColor = `rgba(0,0,0,${0.55 - 0.3 * L.lev})`;
  ctx.shadowBlur = (22 + 30 * L.lev) * S;
  ctx.shadowOffsetX = 6 * S;
  ctx.shadowOffsetY = (16 + 50 * L.lev) * S;
  ctx.fillStyle = 'rgba(0,0,0,0.01)';
  ctx.fill(L.p2d);
  ctx.restore();

  // Extrusión: capas desplazadas, más oscuras hacia atrás
  for (let i = depth; i >= 1; i--) {
    const shade = lerpN(0.22, 0.5, 1 - i / depth);
    ctx.save();
    ctx.translate(dx * i, dy * i);
    ctx.fillStyle = rgba([c[0] * shade, c[1] * shade, c[2] * shade * 1.05], 1);
    ctx.fill(L.p2d);
    ctx.restore();
  }

  // Cara frontal con degradado (luz desde arriba)
  const grd = ctx.createLinearGradient(0, L.bb.y1, 0, L.bb.y2);
  grd.addColorStop(0, rgba(mixCol(c, [255, 255, 255], 0.25), 1));
  grd.addColorStop(0.55, rgba(c, 1));
  grd.addColorStop(1, rgba([c[0] * 0.78, c[1] * 0.78, c[2] * 0.8], 1));

  const g = Math.max(L.glow, L.hover * 0.55);
  if (g > 0.01) {
    const gc = L.glow >= L.hover * 0.55 ? L.glowCol : [255, 215, 140];
    ctx.save();
    ctx.shadowColor = rgba(gc, Math.min(1, g));
    ctx.shadowBlur = (16 + 46 * g) * S;
    ctx.fillStyle = grd;
    ctx.fill(L.p2d);
    ctx.restore();
  }
  ctx.fillStyle = grd;
  ctx.fill(L.p2d);

  // Textura de piedra (si la E está petrificada)
  if (L.stoneFx) L.stoneFx.drawSurface(L);

  // Bisel: luz arriba-izquierda, sombra abajo-derecha (recortado a la letra)
  ctx.save();
  ctx.clip(L.p2d);
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(-1.8 * S, -1.8 * S);
  ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.lineWidth = 4.5 * S;
  ctx.stroke(L.p2d);
  ctx.restore();
  ctx.translate(1.6 * S, 1.6 * S);
  ctx.strokeStyle = `rgba(255,255,255,${0.75 - 0.4 * L.stone})`;
  ctx.lineWidth = 2.6 * S;
  ctx.stroke(L.p2d);
  ctx.restore();

  // Contorno dorado cuando la varita apunta a la letra
  if (L.hover > 0.01) {
    ctx.strokeStyle = rgba([240, 205, 130], 0.75 * L.hover);
    ctx.lineWidth = 1.4 * S;
    ctx.stroke(L.p2d);
  }
  L.pop();
}

/* ---------------- Detección de letras ---------------- */
// 1) Si el punto cae dentro del trazo de una letra → esa letra.
// 2) Si no, entre las letras cuya caja (con margen) lo contiene,
//    gana la de borde más cercano. Así nunca se activan dos letras
//    y el hueco de la O también cuenta como O.
function pickLetter(x, y) {
  let best = null, bestScore = Infinity;
  const pad = 12 * S;
  for (const L of letters) {
    if (!L.spell) continue;
    const p = L.toLocal(x, y);
    if (p.x < L.bb.x1 - pad || p.x > L.bb.x2 + pad || p.y < L.bb.y1 - pad || p.y > L.bb.y2 + pad) continue;
    if (L.inside(p.x, p.y)) return L;
    const inBox = p.x >= L.bb.x1 && p.x <= L.bb.x2 && p.y >= L.bb.y1 && p.y <= L.bb.y2;
    const d = L.distTo(p.x, p.y);
    if (!inBox && d > pad) continue;
    const score = inBox ? d * 0.5 : d;
    if (score < bestScore) { bestScore = score; best = L; }
  }
  return best;
}

/* ---------------- Varita ---------------- */
function updateWand(dt) {
  wand.px = wand.x; wand.py = wand.y;
  wand.x = mouseX; wand.y = mouseY;
  const vx = (wand.x - wand.px) / Math.max(dt, 0.001);
  wand.vx = lerpN(wand.vx, vx, Math.min(1, dt * 8));
  wand.flash = Math.max(0, wand.flash - dt * 3);
  if (!wand.visible) return;
  // Estela luminosa proporcional a la velocidad
  const speed = Math.hypot(wand.x - wand.px, wand.y - wand.py) / Math.max(dt, 0.001);
  let n = Math.min(4, speed * 0.004);
  while (n > 0) {
    if (Math.random() < n) {
      Particles.add({ x: wand.x + rand(-2, 2), y: wand.y + rand(-2, 2), vx: rand(-15, 15), vy: rand(-5, 25), drift: 8, life: rand(0.35, 0.9), size: rand(2, 4.5), col: pick([[255, 230, 170], [255, 255, 240], [190, 210, 255]]), alpha: 0.9 });
    }
    n -= 1;
  }
}

function drawWand() {
  if (!wand.visible) return;
  const len = Math.min(150, Math.max(95, 115 * S));
  const ang = 0.95 + Math.max(-0.35, Math.min(0.35, wand.vx * 0.0006));
  ctx.save();
  ctx.translate(wand.x, wand.y);
  ctx.rotate(ang);
  // Vara de madera (de la punta al mango)
  const wood = ctx.createLinearGradient(0, -5, 0, 5);
  wood.addColorStop(0, '#2a1a10');
  wood.addColorStop(0.45, '#7a5232');
  wood.addColorStop(1, '#1e120a');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.moveTo(0, -1.1);
  ctx.lineTo(len * 0.62, -3.1);
  ctx.lineTo(len * 0.62, 3.1);
  ctx.lineTo(0, 1.1);
  ctx.closePath();
  ctx.fill();
  // Mango tallado
  const handle = ctx.createLinearGradient(0, -6, 0, 6);
  handle.addColorStop(0, '#1a0f08');
  handle.addColorStop(0.45, '#5a3a22');
  handle.addColorStop(1, '#120a05');
  ctx.fillStyle = handle;
  ctx.beginPath();
  ctx.moveTo(len * 0.62, -3.6);
  ctx.quadraticCurveTo(len * 0.8, -5.2, len, -4.4);
  ctx.lineTo(len, 4.4);
  ctx.quadraticCurveTo(len * 0.8, 5.2, len * 0.62, 3.6);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,160,110,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) {
    const x = len * (0.66 + i * 0.08);
    ctx.beginPath(); ctx.moveTo(x, -4.2); ctx.quadraticCurveTo(x + 3, 0, x, 4.2); ctx.stroke();
  }
  ctx.fillStyle = '#2e1d10';
  ctx.beginPath(); ctx.ellipse(len + 2, 0, 4, 5, 0, 0, PI2); ctx.fill();
  ctx.restore();

  // Luz de la punta: crece sobre una letra y destella al hacer clic
  const glow = 10 + 10 * (hovered ? 1 : 0) + 26 * wand.flash + Math.sin(T * 6) * 1.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.9;
  ctx.drawImage(Particles.sprite([255, 225, 160], 'glow'), wand.x - glow, wand.y - glow, glow * 2, glow * 2);
  ctx.restore();
}

/* ---------------- Ciclo de p5 ---------------- */
function preload() {
  font = loadFont(FONT_FILE, () => {}, () => { font = null; });
}

function setup() {
  pixelDensity(Math.min(2, displayDensity()));
  const cnv = createCanvas(windowWidth, windowHeight);
  cnv.parent('stage');
  ctx = drawingContext;
  if (!font) {
    document.getElementById('error').hidden = false;
    noLoop();
    return;
  }
  cnv.mousePressed(onPress);
  cnv.elt.addEventListener('pointerenter', () => { wand.visible = true; });
  cnv.elt.addEventListener('pointerleave', () => { wand.visible = false; hovered = null; });
  cnv.elt.addEventListener('pointermove', () => { wand.visible = true; });
  buildScene();
  setupUI();
}

function buildScene() {
  Spells.clear();
  Particles.clear();
  buildLetters();
  buildSky();
}

function draw() {
  const dt = Math.min(0.05, deltaTime / 1000);
  T += dt;

  // --- Actualización ---
  updateWand(dt);
  hovered = wand.visible ? pickLetter(mouseX, mouseY) : null;
  for (const L of letters) {
    L.resetDynamic();
    const target = hovered && hovered.spell === L.spell ? 1 : 0;  // las letras hermanas se iluminan juntas
    L.hover = lerpN(L.hover, target, Math.min(1, dt * 10));
    L.oy -= L.hover * 2 * S;
  }
  Spells.update(dt);
  Particles.update(dt);

  // --- Dibujo (de atrás hacia adelante) ---
  drawSky(dt);
  Spells.drawBack();
  Particles.draw('back');
  for (const L of letters) drawLetter(L);
  Spells.drawFront();
  Particles.draw('front');
  drawWand();
}

function onPress() {
  Sound.init();                      // el audio solo puede arrancar tras un gesto del usuario
  wand.visible = true;
  wand.flash = 1;
  for (let i = 0; i < 14; i++) {
    const a = rand(PI2), v = rand(30, 120);
    Particles.add({ x: mouseX, y: mouseY, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 0.92, life: rand(0.3, 0.7), size: rand(2, 4), col: [255, 232, 180] });
  }
  const L = pickLetter(mouseX, mouseY);
  if (L && L.spell) {
    Spells.cast(L.spell, L);
    if (!hintHidden) { hintHidden = true; document.getElementById('hint').classList.add('hidden'); }
  } else {
    Sound.play('wand');
  }
  return false;
}

function windowResized() {
  if (!font) return;
  resizeCanvas(windowWidth, windowHeight);
  buildScene();                      // se recalcula la geometría; los hechizos activos se reinician
}

/* ---------------- Controles HTML ---------------- */
function setupUI() {
  const btn = document.getElementById('btn-sound');
  const vol = document.getElementById('volume');
  const reset = document.getElementById('btn-reset');

  btn.addEventListener('click', () => {
    Sound.init();
    const on = !Sound.enabled;
    Sound.setEnabled(on);
    btn.setAttribute('aria-pressed', String(on));
  });
  vol.addEventListener('input', () => {
    Sound.init();
    Sound.setVolume(parseFloat(vol.value));
  });
  reset.addEventListener('click', () => {
    Spells.clear();
    Particles.clear();
    hintHidden = false;
    document.getElementById('hint').classList.remove('hidden');
  });
}
