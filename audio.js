/* ==========================================================
   audio.js — Diseño sonoro con Web Audio API
   ----------------------------------------------------------
   Todos los sonidos se SINTETIZAN en el navegador (osciladores,
   ruido filtrado y envolventes), así que el proyecto no depende
   de archivos externos ni de licencias.

   Opcional: si quieres usar tus propios archivos, colócalos en
   assets/sounds/ y regístralos en assets/sounds/sounds.json, por
   ejemplo: { "H": "raices.mp3", "A": "patronus.mp3" }.
   Si un archivo falta o no carga, se usa el sonido sintetizado.

   Claves: H, A, RR, Y, P, O, TT, E, RF  (RF = R final)
   ========================================================== */

const Sound = (() => {
  let ac = null;          // AudioContext (se crea tras el primer clic)
  let master = null;      // volumen general
  let dry = null;         // bus seco
  let wet = null;         // bus hacia la reverberación
  let noiseBuf = null;    // ruido blanco reutilizable
  let enabled = true;
  let volume = 0.7;
  const buffers = {};     // archivos opcionales decodificados
  const lastPlay = {};    // anti-saturación por clave

  // ---------- Inicialización (llamar desde un gesto del usuario) ----------
  function init() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // navegador sin Web Audio: la experiencia sigue sin sonido
    ac = new Ctx();

    master = ac.createGain();
    master.gain.value = enabled ? volume : 0;

    // Compresor suave para que los efectos simultáneos no saturen
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    master.connect(comp).connect(ac.destination);

    dry = ac.createGain();
    dry.connect(master);

    const verb = ac.createConvolver();
    verb.buffer = makeImpulse(3.2, 2.6);
    wet = ac.createGain();
    wet.gain.value = 0.55;
    wet.connect(verb).connect(master);

    noiseBuf = makeNoise(2.5);
    loadManifest();
  }

  // ---------- Archivos opcionales ----------
  async function loadManifest() {
    try {
      const res = await fetch('assets/sounds/sounds.json', { cache: 'no-store' });
      if (!res.ok) return;
      const map = await res.json();
      for (const [key, file] of Object.entries(map)) {
        if (!file) continue;
        try {
          const r = await fetch('assets/sounds/' + file);
          if (!r.ok) continue;
          const data = await r.arrayBuffer();
          buffers[key] = await ac.decodeAudioData(data);
        } catch (e) { /* archivo inválido: se usa el sintetizado */ }
      }
    } catch (e) { /* sin manifiesto: solo sonidos sintetizados */ }
  }

  // ---------- Utilidades de síntesis ----------
  function makeNoise(seconds) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(seconds, decay) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // Envolvente ataque–decaimiento sobre un AudioParam
  function env(param, t, attack, release, peak, sustain = 0) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    if (sustain > 0) param.setValueAtTime(peak, t + attack + sustain);
    param.exponentialRampToValueAtTime(0.0001, t + attack + sustain + release);
  }

  function out(node, wetAmount = 0.3) {
    node.connect(dry);
    if (wetAmount > 0) {
      const s = ac.createGain();
      s.gain.value = wetAmount;
      node.connect(s).connect(wet);
    }
  }

  // Ráfaga de ruido filtrado
  function noise(t, dur, { type = 'bandpass', freq = 1000, q = 1, gain = 0.2, attack = 0.005, wetAmt = 0.2, freqTo = null } = {}) {
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    f.Q.value = q;
    const g = ac.createGain();
    env(g.gain, t, attack, Math.max(0.01, dur - attack), gain);
    src.connect(f).connect(g);
    out(g, wetAmt);
    src.start(t, Math.random() * 2);
    src.stop(t + dur + 0.05);
    return { src, filter: f, gain: g };
  }

  // Tono simple
  function tone(t, dur, { type = 'sine', freq = 440, freqTo = null, gain = 0.1, attack = 0.01, wetAmt = 0.4, detune = 0, vibrato = 0, vibRate = 5 } = {}) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqTo) o.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    o.detune.value = detune;
    if (vibrato > 0) {
      const lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.frequency.value = vibRate;
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }
    const g = ac.createGain();
    env(g.gain, t, attack, Math.max(0.01, dur - attack), gain);
    o.connect(g);
    out(g, wetAmt);
    o.start(t);
    o.stop(t + dur + 0.1);
    return { osc: o, gain: g };
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- Sonidos sintetizados por hechizo ----------
  const synth = {
    // H — crecimiento vegetal y florecimiento
    H(t) {
      noise(t, 2.2, { type: 'bandpass', freq: 260, freqTo: 1900, q: 3, gain: 0.12, attack: 0.6, wetAmt: 0.3 });
      noise(t + 0.2, 1.8, { type: 'highpass', freq: 3500, gain: 0.03, attack: 0.4 });
      const notes = [1046.5, 1318.5, 1568, 1760, 2093];
      notes.forEach((f, i) => {
        tone(t + 2.0 + i * 0.16 + rnd(0, 0.04), 1.4, { freq: f, gain: 0.06, attack: 0.005, wetAmt: 0.7 });
      });
    },

    // A — destello mágico y sonido etéreo
    A(t) {
      noise(t, 0.35, { type: 'highpass', freq: 3000, gain: 0.18, attack: 0.002, wetAmt: 0.6 });
      [440, 659.3, 880, 1108.7].forEach((f, i) => {
        tone(t + 0.05 + i * 0.07, 4.2, { freq: f, gain: 0.05, attack: 0.5, detune: rnd(-8, 8), wetAmt: 0.9, vibrato: 2, vibRate: 4 + i });
      });
      tone(t + 0.4, 3.2, { freq: 1760, gain: 0.025, attack: 0.8, wetAmt: 1, vibrato: 10, vibRate: 7 });
    },

    // RR — electricidad, descarga y humo
    RR(t, reverse) {
      const n = reverse ? 14 : 46;
      const span = reverse ? 0.6 : 2.0;
      for (let i = 0; i < n; i++) {
        const tt = t + Math.pow(Math.random(), 1.3) * span;
        noise(tt, rnd(0.015, 0.07), { type: 'bandpass', freq: rnd(1800, 6000), q: 2, gain: rnd(0.08, 0.26), attack: 0.001, wetAmt: 0.15 });
      }
      const buzz = tone(t, reverse ? 0.8 : 2.2, { type: 'sawtooth', freq: reverse ? 90 : 55, freqTo: reverse ? 40 : 70, gain: 0.06, attack: 0.02, wetAmt: 0.1 });
      // modulación de amplitud "zumbante"
      const lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.type = 'square';
      lfo.frequency.value = 17;
      lg.gain.value = 0.03;
      lfo.connect(lg).connect(buzz.gain.gain);
      lfo.start(t);
      lfo.stop(t + 2.4);
      if (!reverse) noise(t + 0.3, 2.6, { type: 'lowpass', freq: 900, freqTo: 180, gain: 0.12, attack: 0.5, wetAmt: 0.4 });
    },

    // Y — chispas y pequeño estallido mágico
    Y(t) {
      [0, 0.14, 0.29].forEach((d, i) => {
        noise(t + d, 0.09, { type: 'highpass', freq: 900, gain: 0.25 - i * 0.05, attack: 0.001, wetAmt: 0.4 });
      });
      for (let i = 0; i < 16; i++) {
        tone(t + rnd(0.02, 0.9), 0.18, { type: 'sine', freq: rnd(2000, 5200), gain: 0.03, attack: 0.002, wetAmt: 0.6 });
      }
    },

    // P — viento oscuro y sonido espectral
    P(t) {
      const w = noise(t, 7, { type: 'lowpass', freq: 320, gain: 0.3, attack: 1.8, wetAmt: 0.5 });
      const lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.frequency.value = 0.25;
      lg.gain.value = 220;
      lfo.connect(lg).connect(w.filter.frequency);
      lfo.start(t);
      lfo.stop(t + 7.2);
      tone(t + 0.5, 6, { type: 'sine', freq: 110, freqTo: 72, gain: 0.07, attack: 1.5, wetAmt: 0.8 });
      tone(t + 0.5, 6, { type: 'sine', freq: 116.5, freqTo: 75, gain: 0.06, attack: 1.5, wetAmt: 0.8 });
      // "aliento" espectral
      noise(t + 1.2, 3.5, { type: 'bandpass', freq: 700, freqTo: 380, q: 9, gain: 0.08, attack: 1.4, wetAmt: 0.9 });
    },

    // O — pasos diminutos de arañas
    O(t) {
      for (let i = 0; i < 70; i++) {
        const tt = t + 0.2 + Math.random() * 5;
        noise(tt, 0.012, { type: 'highpass', freq: 3800, gain: rnd(0.04, 0.12), attack: 0.0008, wetAmt: 0.05 });
        if (Math.random() < 0.3) tone(tt, 0.02, { type: 'triangle', freq: rnd(1700, 2700), gain: 0.02, attack: 0.001, wetAmt: 0 });
      }
    },

    // TT — transformación fantástica, pelo y cola
    TT(t, reverse) {
      if (!reverse) {
        tone(t, 0.7, { type: 'sine', freq: 180, freqTo: 820, gain: 0.1, attack: 0.02, wetAmt: 0.3, vibrato: 30, vibRate: 9 });
        tone(t + 0.65, 0.5, { type: 'sine', freq: 820, freqTo: 520, gain: 0.07, attack: 0.01, wetAmt: 0.3 });
        const r = noise(t + 0.2, 1.8, { type: 'bandpass', freq: 3200, q: 0.8, gain: 0.1, attack: 0.3, wetAmt: 0.2 });
        const lfo = ac.createOscillator();
        const lg = ac.createGain();
        lfo.frequency.value = 11;
        lg.gain.value = 0.05;
        lfo.connect(lg).connect(r.gain.gain);
        lfo.start(t);
        lfo.stop(t + 2.1);
      } else {
        tone(t, 0.8, { type: 'sine', freq: 700, freqTo: 160, gain: 0.09, attack: 0.02, wetAmt: 0.3, vibrato: 20, vibRate: 8 });
        noise(t, 0.9, { type: 'bandpass', freq: 2800, q: 0.8, gain: 0.06, attack: 0.05 });
      }
    },

    // E — vibración, roca y fragmentos
    E(t, reverse) {
      const dur = reverse ? 0.9 : 2.3;
      const r = noise(t, dur, { type: 'lowpass', freq: 160, gain: 0.45, attack: 0.1, wetAmt: 0.3 });
      const lfo = ac.createOscillator();
      const lg = ac.createGain();
      lfo.frequency.value = 13;
      lg.gain.value = 0.18;
      lfo.connect(lg).connect(r.gain.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
      const bits = reverse ? 10 : 24;
      for (let i = 0; i < bits; i++) {
        noise(t + rnd(0.1, dur), rnd(0.02, 0.06), { type: 'bandpass', freq: rnd(500, 2500), q: 3, gain: rnd(0.06, 0.16), attack: 0.001, wetAmt: 0.2 });
      }
      if (!reverse) {
        tone(t + 2.35, 0.5, { type: 'sine', freq: 75, freqTo: 38, gain: 0.35, attack: 0.005, wetAmt: 0.4 });
        noise(t + 2.35, 0.35, { type: 'lowpass', freq: 500, gain: 0.25, attack: 0.002, wetAmt: 0.4 });
      }
    },

    // RF — levitación y magia flotante
    RF(t, reverse) {
      const from = reverse ? 660 : 330;
      const to = reverse ? 300 : 660;
      tone(t, 2.4, { type: 'sine', freq: from, freqTo: to, gain: 0.08, attack: 0.4, wetAmt: 0.8, vibrato: 7, vibRate: 5 });
      tone(t, 2.4, { type: 'triangle', freq: from * 1.5, freqTo: to * 1.5, gain: 0.03, attack: 0.6, wetAmt: 0.9, vibrato: 9, vibRate: 5.5 });
      for (let i = 0; i < 8; i++) {
        tone(t + 0.3 + i * 0.22, 0.6, { freq: (reverse ? 2600 - i * 150 : 1500 + i * 150), gain: 0.02, attack: 0.005, wetAmt: 1 });
      }
    },

    // Varita: pequeño destello al hacer clic fuera de las letras
    wand(t) {
      tone(t, 0.35, { freq: rnd(1900, 2600), freqTo: 3200, gain: 0.025, attack: 0.003, wetAmt: 0.8 });
    },
  };

  // ---------- API pública ----------
  function play(key, opts = {}) {
    if (!ac || !enabled) return;
    const now = ac.currentTime;
    // Evita apilar el mismo sonido decenas de veces con clics rapidísimos
    if (lastPlay[key] && now - lastPlay[key] < 0.18) return;
    lastPlay[key] = now;
    const t = now + 0.01;

    const fileKey = opts.reverse ? key + '_off' : key;
    const buf = buffers[fileKey] || (!opts.reverse && buffers[key]);
    if (buf) {
      const src = ac.createBufferSource();
      src.buffer = buf;
      const g = ac.createGain();
      g.gain.value = 0.9;
      src.connect(g);
      out(g, 0.15);
      src.start(t);
      return;
    }
    if (synth[key]) synth[key](t, !!opts.reverse);
  }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ac.currentTime, 0.05);
  }

  function setEnabled(on) {
    enabled = on;
    if (master) master.gain.setTargetAtTime(enabled ? volume : 0, ac.currentTime, 0.05);
  }

  return { init, play, setVolume, setEnabled, get enabled() { return enabled; } };
})();
