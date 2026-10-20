// Ambient loops: an endless generative piece in the manner of Music for Airports.
// Seven notes, each repeating on its own loop length (19-41 s). The lengths don't divide
// evenly, so the combination never repeats. Original notes and sounds, synthesized live:
// no audio files, no license needed. Preview: https://claude.ai/artifact/FkL6EWJoA1YXG3CsDZCDdV
//
// Hooking it into index.html (three small changes):
//   1. <script src="ambient.js"></script> before the main inline script.
//   2. In startAudio(), right after the AudioContext is created:  Ambient.start(audio, muted);
//   3. In the mute button's click handler, after `muted = !muted`:  Ambient.setMuted(muted);
// It starts on the same first click that unlocks the box sounds and follows the same mute button.
(function () {
  const VOLUME = 0.4;  // kept well under the box sounds; it should sit in the background
  const LOOPS = [
    { note: "A2",  period: 41.2, kind: "pad"  },
    { note: "D4",  period: 19.3, kind: "pad"  },
    { note: "F#4", period: 23.1, kind: "pad"  },
    { note: "A4",  period: 29.9, kind: "pad"  },
    { note: "E5",  period: 26.7, kind: "bell" },
    { note: "B4",  period: 33.4, kind: "bell" },
    { note: "D5",  period: 37.6, kind: "bell" },
  ];

  function noteFreq(n) {
    const m = n.match(/^([A-G])(#|b)?(\d)$/);
    const semis = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return 440 * Math.pow(2, (semis + (parseInt(m[3]) - 4) * 12) / 12);
  }

  function makeReverb(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // Soft choir-like pad: detuned triangles through a low-pass, slow swell and long fade.
  function playPad(ctx, out, freq, t) {
    const g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = Math.min(1800, freq * 3); lp.Q.value = 0.3;
    const vib = ctx.createOscillator(), vibAmt = ctx.createGain();
    vib.frequency.value = 4.6 + Math.random(); vibAmt.gain.value = freq * 0.003;
    vib.connect(vibAmt);
    const oscs = [-6, 0, 5].map((cents) => {
      const o = ctx.createOscillator();
      o.type = "triangle"; o.frequency.value = freq; o.detune.value = cents;
      vibAmt.connect(o.frequency); o.connect(lp);
      return o;
    });
    lp.connect(g); g.connect(out);
    const peak = 0.07, attack = 2.8, hold = 1.6, release = 7;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    const end = t + attack + hold + release + 0.1;
    [...oscs, vib].forEach((o) => { o.start(t); o.stop(end); });
  }

  // Felt-piano tone: sine plus quiet overtones, soft strike and long decay.
  function playBell(ctx, out, freq, t) {
    const g = ctx.createGain();
    [[1, 1], [2, 0.18], [3.01, 0.05]].forEach(([mult, amp]) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * mult; og.gain.value = amp;
      o.connect(og); og.connect(g);
      o.start(t); o.stop(t + 9);
    });
    g.connect(out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 8.5);
  }

  let ctx = null, master = null, bus = null, state = null, timer = null;

  function schedule() {
    const now = ctx.currentTime;
    for (const s of state) {
      // Notes due while the tab was throttled are skipped rather than piled up.
      while (s.next < now - 1) s.next += s.period;
      while (s.next < now + 1.5) {
        (s.kind === "pad" ? playPad : playBell)(ctx, bus, s.freq, s.next);
        s.next += s.period;
      }
    }
  }

  function fadeTo(v, seconds) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(v, t + seconds);
  }

  function resume() {
    // Stagger entries so the piece opens sparsely each time it comes back.
    const t = ctx.currentTime;
    state.forEach((s, i) => { s.next = t + 1 + i * 2.7 + Math.random() * 3; });
    fadeTo(VOLUME, 4);
    clearInterval(timer);
    timer = setInterval(schedule, 250);
  }

  function pause() {
    clearInterval(timer); timer = null;
    fadeTo(0, 2);
  }

  window.Ambient = {
    start(audioCtx, muted) {
      if (ctx) return;
      ctx = audioCtx;
      master = ctx.createGain(); master.gain.value = 0;
      const dry = ctx.createGain(); dry.gain.value = 0.35;
      const wet = ctx.createGain(); wet.gain.value = 0.9;
      const rev = makeReverb(ctx, 7);
      bus = ctx.createGain();
      bus.connect(dry); bus.connect(rev); rev.connect(wet);
      dry.connect(master); wet.connect(master); master.connect(ctx.destination);
      state = LOOPS.map((l) => ({ ...l, freq: noteFreq(l.note), next: 0 }));
      if (!muted) resume();
    },
    setMuted(muted) {
      if (!ctx) return;
      if (muted) pause(); else if (!timer) resume();
    },
  };
})();
