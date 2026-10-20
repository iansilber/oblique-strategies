// Tuning mode (index.html?tune): a DialKit timeline with one clip per moment of the opening,
// plus a panel for the knobs that aren't on the timeline. Edits write straight into ANIM and CUES.
import { createDialKit, createDialRoot, createDialTimeline, createDialTimelineRoot } from "./vendor/dialkit/dialkit.js";

// Inlined as a <style> rather than a <link> so it also loads where only scripts may come from files.
fetch(new URL("./vendor/dialkit/styles.css", import.meta.url)).then((r) => r.text())
  .then((text) => document.head.append(Object.assign(document.createElement("style"), { textContent: text })));

// Same spring maths as DialKit's own preview, so a spring curve looks the same here as in the dock.
function springParams(s) {
  if (s.stiffness !== undefined || s.damping !== undefined || s.mass !== undefined)
    return { stiffness: s.stiffness ?? 200, damping: s.damping ?? 25, mass: s.mass ?? 1 };
  const root = 2 * Math.PI / (Math.max(0.05, s.visualDuration ?? 0.3) * 1.2), stiffness = root * root;
  return { stiffness, damping: 2 * Math.min(1, Math.max(0.05, 1 - (s.bounce ?? 0.3))) * Math.sqrt(stiffness), mass: 1 };
}
function springProgress(t, { stiffness, damping, mass }) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (z < 0.9999) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + z * w0 / wd * Math.sin(wd * t)); }
  if (z < 1.0001) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(z * z - 1), r1 = -z * w0 + wd, r2 = -z * w0 - wd;
  return 1 + (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r1 - r2);
}

// Timeline clip (group.clip) → ANIM entry, and which of its numbers are dials in the clip editor.
const MOMENTS = [
  ["lid.lift", "lidLift", { height: 0 }],
  ["lid.swing", "lidSwing", { arc: 0, tiltX: 0, tiltZ: 0 }],
  ["camera.pullBack", "camera", {}],
  ["card.rise", "cardRise", { height: 0, z: 0, tip: 0 }],
  ["card.flyOut", "cardFly", { arc: 0 }],
];
// Sound cues as markers: drag one to move where its clip starts. Closing plays the timeline backward,
// so a closing cue fires when the playhead passes it going left.
const SOUND_KEYS = { "lid-lift": "lidLift", "lid-down": "lidDown", "card-out": "cardOut", "card-back": "cardBack", "lid-pickup": "lidPickup", "lid-close": "lidClose" };
const get = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);
const r3 = (n) => Math.round(n * 1000) / 1000;

export default function tune(app) {
  // Nothing is saved between visits: every load starts from ANIM. Clear what earlier versions saved.
  try { for (const k of ["dialkit:oblique-opening", "dialkit:oblique-box"]) localStorage.removeItem(k); } catch (e) {}
  const { ANIM, CUES } = app;
  const config = { duration: ANIM.end };
  for (const [path, key, params] of MOMENTS) {
    const [group, clip] = path.split("."), a = ANIM[key];
    const to = Object.fromEntries(Object.keys(params).map((p) => [p, a[p]]));
    (config[group] ??= {})[clip] = {
      at: a.at, duration: a.dur,
      ...(Object.keys(to).length ? { from: params, to } : {}),
      transition: { type: "easing", duration: a.dur, ease: a.ease },
    };
  }
  config.openSounds = {}; config.closeSounds = {};
  for (const c of CUES) (c.dir > 0 ? config.openSounds : config.closeSounds)[SOUND_KEYS[c.s]] = { at: c.t, duration: 0.12 };

  const timeline = createDialTimeline("Opening", config, { id: "oblique-opening", autoplay: false });
  const dock = createDialTimelineRoot({ theme: "dark" });

  // Kept short so it clears the dock's ruler; the extra knobs sit in a collapsed folder.
  const panel = createDialKit("Box", {
    actions: {
      open: { type: "action", label: "Open with a new card" },
      openInfo: { type: "action", label: "Open the info draw" },
      close: { type: "action", label: "Close" },
      copy: { type: "action", label: "Copy ANIM for index.html" },
    },
    more: {
      _collapsed: true,
      infoDraw: false,
      secondCardLag: [ANIM.secondCardLag, 0, 1, 0.01],
      swap: [ANIM.swap, 0.1, 2, 0.05],
      closeSpeed: [ANIM.closeSpeed, 0.5, 3, 0.05],
    },
  }, {
    id: "oblique-box",
    onAction(action) {
      app.startAudio();
      if (action === "actions.open") app.replay("random");
      if (action === "actions.openInfo") app.replay("info");
      if (action === "actions.close") app.close();
      if (action === "actions.copy") copyAnim();
    },
  });
  const root = createDialRoot({ theme: "dark", position: "top-right" });

  // Audio needs a user gesture; the dock's play button counts if we start it on any press.
  addEventListener("pointerdown", () => app.startAudio(), { capture: true });

  let mine = false, prevT = 0;
  function apply(vals) {
    for (const [path, key, params] of MOMENTS) {
      const c = get(vals, path), a = ANIM[key];
      if (!c) continue;
      a.at = c.at; a.dur = Math.max(0.01, c.duration);
      const tr = c.transition;
      if (tr?.type === "spring") { const sp = springParams(tr); a.spring = tr; a.curve = (p) => springProgress(p * a.dur, sp); }
      else if (tr?.type === "easing") { a.ease = tr.ease; a.curve = a.spring = undefined; }
      for (const p of Object.keys(params)) if (typeof c.to?.[p] === "number") a[p] = c.to[p];
    }
    for (const c of CUES) {
      const m = get(vals, (c.dir > 0 ? "openSounds." : "closeSounds.") + SOUND_KEYS[c.s]);
      if (m) c.t = m.at;
    }
    ANIM.end = Math.max(3.75, vals.duration);
  }
  timeline.subscribe((vals) => {
    apply(vals);
    const t = vals.time;
    if (!mine && Math.abs(t - app.time) > 1e-4) {
      // The playhead moved in the dock (scrub or play): put the box there, with sounds when playing forward.
      if (vals.playing && t > prevT) for (const c of CUES) if (c.dir > 0 && prevT <= c.t && t > c.t) app.play(c.s);
      app.seek(t);
    }
    prevT = t;
    app.frame();
  });
  let infoDraw = null;
  panel.subscribe((p) => {
    const m = p.more;
    ANIM.secondCardLag = m.secondCardLag; ANIM.swap = m.swap; ANIM.closeSpeed = m.closeSpeed;
    if (m.infoDraw !== infoDraw) { infoDraw = m.infoDraw; app.setInfo(infoDraw); } else app.frame();
  });

  function copyAnim() {
    const keys = ["lidLift", "lidSwing", "camera", "cardRise", "cardFly"];
    const pad = Math.max(...keys.map((k) => k.length)) + 1;
    const lines = keys.map((k) => {
      const { at, dur, ease, curve, spring, ...rest } = ANIM[k];
      const extra = Object.entries(rest).map(([n, v]) => `, ${n}: ${r3(v)}`).join("");
      const note = spring ? `  // tuned as a spring ${JSON.stringify(spring)}; index.html plays it with ease` : "";
      return `  ${(k + ":").padEnd(pad)} { at: ${r3(at)}, dur: ${r3(dur)}, ease: [${ease.map(r3).join(", ")}]${extra} },${note}`;
    });
    const text = [
      "const ANIM = {", ...lines,
      `  secondCardLag: ${r3(ANIM.secondCardLag)},`, `  swap: ${r3(ANIM.swap)},`,
      `  closeSpeed: ${r3(ANIM.closeSpeed)},`, `  end: ${r3(ANIM.end)},`, "};", "",
      "const CUES = [", ...CUES.map((c) => `  { t: ${r3(c.t)}, dir: ${c.dir}, s: "${c.s}" },`), "];",
    ].join("\n");
    navigator.clipboard?.writeText(text).then(() => toast("Copied ANIM and CUES"), () => showText(text)) ?? showText(text);
  }
  function toast(msg) {
    const el = Object.assign(document.createElement("div"), { textContent: msg });
    Object.assign(el.style, { position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)", zIndex: 99999,
      background: "#222", color: "#eee", padding: "8px 14px", borderRadius: "8px", font: "13px system-ui" });
    document.body.append(el); setTimeout(() => el.remove(), 1800);
  }
  function showText(text) {
    const ta = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
    Object.assign(ta.style, { position: "fixed", inset: "10% 10% auto", height: "50%", zIndex: 99999,
      background: "#111", color: "#ddd", font: "12px ui-monospace, monospace", padding: "12px", borderRadius: "8px" });
    ta.addEventListener("blur", () => ta.remove());
    document.body.append(ta); ta.focus(); ta.select();
  }

  return {
    // The app's own playback (click to open or close) moves the dock's playhead along with it.
    onTime(t) { mine = true; timeline.seek(t); mine = false; prevT = t; },
    timeline, dock, panel, root,
  };
}
