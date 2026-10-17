// The instrument. Ported from the frozen predecessor (Visual Climate Watch,
// components/movement/scene.tsx) under the 2026-10-16 owner decision
// permitting direct porting of visual/scene code; the React useEffect body is
// vanilla-ized into mountScene(el, data, controls, opts). Every hardcode the
// port inventory listed is stripped: engraving strings, source-gear mapping,
// narrative copy, the font literal and the basemap path all arrive as data.
// No country identity lives in this module (R1); every reading it draws is
// handed in by the page, which read it from the view JSON door (R11).
//
// Honest-mapping rule carried over unchanged: a part with no figure behind it
// is not drawn full. The pledge ring is GHOSTED when no pledge figure was
// read, an unread socket stays an EMPTY BORE, the finance cog is ghosted when
// unknown, and the gear train turns only on what was actually counted.
//
// data = {
//   iso3, aria, font, basemapUrl,
//   engravePlate, engraveRim, slabs: [up to 4 strings],
//   pledge:   { ratio: null|0..1 },                      // null → ghost ring
//   gears:    [{ teeth, live, engrave }, …3],            // live=false → ghost, still
//   pins:     number,                                    // one marker per hashed document
//   bridge:   { engrave, seated: boolean },
//   sockets:  [{ key, label, state, read }, …8],         // state: observed|pledged|absent|unknown
//   finance:  { live: boolean },
//   labels:   { plate|pledge|inventory|evidence|finance: { chip, title, value, color } },
// }
// controls = mutable { progress: 0..100|null, paused, inset }   (read every frame)
// opts = { onFail(), onSelect(id), onPhase(i), onProgress(pct) }
// Returns a dispose() function.
import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createExplosionLayout } from './explosion-layout.mjs';
import { PointerTap } from './pointer-tap.mjs';
import {
  cycleOffset, narrativeAmount, deskAmount, returnAmount, cyclePhase,
  reveal, btrReveal, btrStepAt, storyPhase, LAYER_WINDOWS,
} from './explosion-motion.mjs';

export async function mountScene(el, data, controls, opts = {}) {
  let cleanup = () => {};
  let cancelled = false;
  const fail = () => { cleanup(); if (!cancelled) opts.onFail?.(); };
  try {
    // ── COLOUR ─────────────────────────────────────────────────────────
    // This module holds no palette. Every colour it spends is read off the
    // mounted element, where engine/generated/design-tokens.css put it
    // (docs/DESIGN.md, gate R17) — so the scene cannot drift from the canon
    // the flat pages draw from, and a token the seed stops carrying stops
    // this scene rather than silently painting something else. A missing
    // token means the stylesheet never loaded, and the honest thing to show
    // then is the server-rendered dial, which the throw below falls back to.
    // The encoding is the canon's: MEANING spends hue — treaty and pledge
    // --un, measured --inv, reporting --btr, finance --fin — and every
    // structural part takes the neutral ramp or the paper surfaces.
    const css = getComputedStyle(el);
    const tok = (name) => {
      const v = css.getPropertyValue(name).trim();
      if (!v) throw new Error(`design token ${name} is not on the page — the canon did not load`);
      return v;
    };
    const hue = (name) => new T.Color(tok(name));
    const textures = [];
    const scene = new T.Scene();
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(hue('--paper'), 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    // Filmic tone mapping on a PAPER ground. The .85 cut belonged to a
    // near-black studio, where anything above it blew the specular roll-off
    // the machining depends on; on --paper the object is lit from the page
    // itself and 1.1 is what keeps a cream plate cream instead of grey.
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', data.aria || '');
    const pm = new T.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const env = pm.fromScene(room, .04);
    scene.environment = env.texture;
    // The room is what a metal REFLECTS. On paper the environment carries
    // most of the modelling and the key only rakes the edges.
    scene.environmentIntensity = .9;
    room.dispose(); pm.dispose();

    // A PAPER studio: the key still sits off-axis so a lifted part shadows
    // the part under it and an edge catches, but the ambient is the page
    // itself rather than a trace, and the bounce comes off --paper-raised.
    // Nothing here is a hue: every light is a surface token of the canon.
    const keyLight = new T.DirectionalLight(hue('--paper-raised'), 1.9);
    keyLight.position.set(-5.2, -3.4, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.left = -7; keyLight.shadow.camera.right = 7;
    keyLight.shadow.camera.top = 7; keyLight.shadow.camera.bottom = -7;
    keyLight.shadow.bias = -.001; keyLight.shadow.normalBias = .025; keyLight.shadow.radius = 5;
    scene.add(keyLight);
    scene.add(new T.AmbientLight(hue('--paper'), .85));
    const rimL = new T.DirectionalLight(hue('--paper-raised'), .6); rimL.position.set(5, 9, 5); scene.add(rimL);
    const bounce = new T.DirectionalLight(hue('--paper-sunken'), .45); bounce.position.set(-7, -6, -3); scene.add(bounce);

    const camera = new T.PerspectiveCamera(34, 1, .1, 100);
    const world = new T.Group(); world.rotation.z = -.13; scene.add(world);

    // ── MATERIALS, ported from the predecessor's own first pass ─────────
    // (work/scene-first-pass.tsx: silver .95/.3 over a grain bump, chrome
    // 1/.17, glass transmission .62 at ior 1.45, ruby clearcoat 1.)
    // The old set here was porcelain at metalness 0 under neutral tone
    // mapping, which is exactly why it read as white plastic. Metal is not a
    // colour: it is metalness near 1 at a low roughness with something in the
    // environment to reflect, and the grain bump is what stops a machined
    // face from looking like a rendered primitive.
    const grainData = new Uint8Array(256 * 256 * 4);
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const j = (y * 256 + x) * 4;
        const g = 105 + Math.sin(y * 2.3) * 17 + Math.sin(y * .31) * 13 + Math.sin(x * 51.9 + y * 7.3) * 7;
        grainData[j] = grainData[j + 1] = grainData[j + 2] = g;
        grainData[j + 3] = 255;
      }
    }
    const grain = new T.DataTexture(grainData, 256, 256);
    grain.wrapS = grain.wrapT = T.RepeatWrapping;
    grain.repeat.set(2, 3);
    grain.needsUpdate = true;
    textures.push(grain);
    // STRUCTURE takes the neutral ramp and the paper surfaces; only the four
    // meanings spend hue. Metalness and roughness are unchanged — metal is
    // not a colour, it is metalness near 1 at a low roughness with something
    // in the environment to reflect, and the grain bump is what stops a
    // machined face from looking like a rendered primitive.
    const silver = new T.MeshStandardMaterial({ color: hue('--rule-strong'), metalness: .80, roughness: .32, bumpMap: grain, bumpScale: .009 });
    const edge = new T.MeshStandardMaterial({ color: hue('--paper-raised'), metalness: .9, roughness: .20 });
    const steel = new T.MeshStandardMaterial({ color: hue('--src-a'), metalness: .85, roughness: .34, bumpMap: grain, bumpScale: .015 });
    const porcelain = new T.MeshStandardMaterial({ color: hue('--dial-face'), metalness: .35, roughness: .40, bumpMap: grain, bumpScale: .009 });
    const white = new T.MeshStandardMaterial({ color: hue('--paper-raised'), metalness: .6, roughness: .34 });
    // the recess a part sits in: the dial's own bezel edge, not a black well
    const shadowM = new T.MeshStandardMaterial({ color: hue('--dial-edge'), metalness: .2, roughness: .85 });
    // MEANING — treaty and pledge: a read pledge segment, and the marker that
    // stands for a document whose bytes are held and hashed
    const blue = new T.MeshPhysicalMaterial({ color: hue('--un'), metalness: .25, roughness: .18, clearcoat: 1, clearcoatRoughness: .14 });
    // MEANING — measured: the record train's own driving gear
    const measured = new T.MeshStandardMaterial({ color: hue('--inv'), metalness: .55, roughness: .30, bumpMap: grain, bumpScale: .009 });
    // MEANING — reporting: the seated jewel, a clearcoated bearing, which is
    // what a jewel IS, and the only part on the bridge that is not steel
    const violet = new T.MeshPhysicalMaterial({ color: hue('--btr'), metalness: .45, roughness: .16, clearcoat: 1 });
    // MEANING — finance
    const gold = new T.MeshPhysicalMaterial({ color: hue('--fin'), metalness: .80, roughness: .29, clearcoat: .3 });
    const glass = new T.MeshPhysicalMaterial({ color: hue('--dial-track'), metalness: .08, roughness: .12, transmission: .62, transparent: true, opacity: .44, thickness: .3, ior: 1.45, side: T.DoubleSide, depthWrite: false });
    const clear = new T.MeshPhysicalMaterial({ color: hue('--dial-track'), metalness: .08, roughness: .14, transmission: .55, transparent: true, opacity: .22, thickness: .2, ior: 1.45, side: T.DoubleSide, depthWrite: false });
    const ghost = new T.MeshStandardMaterial({ color: hue('--rule-strong'), metalness: .45, roughness: .40, transparent: true, opacity: .55 });
    const plateM = new T.MeshStandardMaterial({ color: hue('--paper-raised'), metalness: .55, roughness: .36, bumpMap: grain, bumpScale: .012 });
    const cotes = new T.MeshStandardMaterial({ color: hue('--dial-face'), metalness: .45, roughness: .34, bumpMap: grain, bumpScale: .016 });

    const parts = []; const gears = []; const hits = []; const labels = [];
    const topLabels = document.createElement('div');
    topLabels.className = 'projected-labels';
    topLabels.setAttribute('aria-hidden', 'true');
    el.appendChild(topLabels);
    const btrLayer = document.createElement('div');
    btrLayer.className = 'projected-labels btr-layer';
    el.appendChild(btrLayer);

    // Soft contact shadow on the paper under the base.
    const blob = document.createElement('canvas');
    blob.width = blob.height = 256;
    const bctx = blob.getContext('2d');
    // On the dark ground a grey contact shadow is invisible: the pool under
    // the object becomes the comps' ambient amber halo instead, which is what
    // seats the instrument in the frame (Main.dc.html's radial behind the
    // plate). Additive, so it lifts the ground rather than darkening it.
    const fall = bctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    fall.addColorStop(0, 'rgba(255,138,61,.26)'); fall.addColorStop(.38, 'rgba(255,138,61,.08)'); fall.addColorStop(.7, 'rgba(255,138,61,.015)'); fall.addColorStop(1, 'rgba(255,138,61,0)');
    bctx.fillStyle = fall; bctx.fillRect(0, 0, 256, 256);
    const blobTexture = new T.CanvasTexture(blob);
    blobTexture.colorSpace = T.SRGBColorSpace;
    textures.push(blobTexture);
    const floor = new T.Mesh(new T.PlaneGeometry(13.5, 13.5), new T.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false, toneMapped: false, blending: T.AdditiveBlending }));
    floor.position.set(.3, .2, -3.43);
    scene.add(floor);

    function mesh(geometry, material, parent, x = 0, y = 0, z = 0) {
      const m = new T.Mesh(geometry, material);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    }
    function cylinder(parent, r, h, z, mat = porcelain, x = 0, y = 0) {
      const m = mesh(new T.CylinderGeometry(r, r, h, 72), mat, parent, x, y, z);
      m.rotation.x = Math.PI / 2; return m;
    }
    function ring(parent, r, t, z, mat = edge, arc = Math.PI * 2) {
      return mesh(new T.TorusGeometry(r, t, 12, 140, arc), mat, parent, 0, 0, z);
    }
    function annulus(parent, r, inner, h, z, mat) {
      const shape = new T.Shape();
      shape.absarc(0, 0, r, 0, Math.PI * 2, false);
      const hole = new T.Path();
      hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      return mesh(new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: true, bevelSize: .04, bevelThickness: .04, bevelSegments: 3, curveSegments: 80 }), mat, parent, 0, 0, z);
    }
    function rounded(w, h, r) {
      const s = new T.Shape();
      s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
      s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
      s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
      s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
      return s;
    }
    function slab(parent, w, h, z, mat, depth = .16) {
      return mesh(new T.ExtrudeGeometry(rounded(w, h, .13), { depth, bevelEnabled: true, bevelSize: .035, bevelThickness: .035, bevelSegments: 3, curveSegments: 16 }), mat, parent, 0, 0, z);
    }
    function clickable(obj, id) { obj.userData.click = id; hits.push(obj); return obj; }
    function screw(parent, x, y, z, r = .07) {
      cylinder(parent, r, .055, z, edge, x, y);
      const cut = mesh(new T.BoxGeometry(r * 1.45, .013, .008), steel, parent, x, y, z + .03);
      cut.rotation.z = .6;
    }
    function ghost_(obj) {
      obj.traverse((o) => {
        if (o instanceof T.Mesh) {
          const m = o.material.clone();
          m.transparent = true; m.opacity = .23; m.depthWrite = false;
          o.material = m;
        }
      });
      return obj;
    }
    function part(id, phase, z) {
      const g = new T.Group();
      g.userData = { id, phase, home: z };
      g.position.z = z; world.add(g); parts.push(g);
      return g;
    }
    function cog(parent, x, y, r, count, mat, sign = 1, turn = 1) {
      const g = new T.Group(); g.position.set(x, y, .05); parent.add(g);
      const sh = new T.Shape();
      for (let i = 0; i < count * 4; i++) {
        const a = i / count / 4 * Math.PI * 2;
        const rr = r + (i % 4 === 1 || i % 4 === 2 ? 1 : -1) * r / count;
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
        if (i === 0) sh.moveTo(px, py); else sh.lineTo(px, py);
      }
      sh.closePath();
      for (let j = 0; j < 5; j++) {
        const a = j / 5 * Math.PI * 2;
        const hole = new T.Path();
        hole.absarc(Math.cos(a) * r * .55, Math.sin(a) * r * .55, r * .2, 0, Math.PI * 2, true);
        sh.holes.push(hole);
      }
      const hub = new T.Path();
      hub.absarc(0, 0, r * .17, 0, Math.PI * 2, true);
      sh.holes.push(hub);
      mesh(new T.ExtrudeGeometry(sh, { depth: .13, bevelEnabled: true, bevelSize: .015, bevelThickness: .017, bevelSegments: 2, curveSegments: 20 }), mat, g);
      ring(g, r * .78, .023, .155, edge);
      cylinder(g, r * .16, .2, .12, steel);
      screw(g, 0, 0, .25, r * .075);
      gears.push({ g, speed: sign * turn * 24 / count * .52, phase: parent.userData.phase ?? 2 });
      return g;
    }
    const font = data.font || 'Helvetica, Arial, sans-serif';
    function engraving(parent, text, color, w, h, z) {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 160;
      const ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, 512, 160);
      ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `600 66px ${font}`;
      ctx.fillText(String(text).toUpperCase(), 256, 80, 500); // maxWidth: long engravings condense, never clip
      const texture = new T.CanvasTexture(cv);
      texture.colorSpace = T.SRGBColorSpace;
      textures.push(texture);
      return mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }), parent, 0, 0, z);
    }
    // A callout as in a parts drawing: the part's number, its name, its reading.
    function label(anchor, title, value, color, phase, offset) {
      const div = document.createElement('div');
      div.className = 'component-label';
      div.style.setProperty('--component-color', color);
      const [no, name] = title.split(' / ');
      const index = document.createElement('i'); index.textContent = no;
      const strong = document.createElement('strong'); strong.textContent = name ?? title;
      const val = document.createElement('span'); val.textContent = value;
      div.appendChild(index); div.appendChild(strong); div.appendChild(val);
      topLabels.appendChild(div);
      labels.push({ el: div, anchor, offset, phase, color });
    }
    // The source document as a physical token riding with its component.
    function chip(parent, name, css, x, y, z, id) {
      const g = new T.Group(); g.position.set(x, y, z); parent.add(g);
      clickable(slab(g, 1.16, .86, 0, cotes, .14), id);
      slab(g, 1.00, .70, .18, shadowM, .04);
      engraving(g, name, css, .80, .28, .262);
      screw(g, -.38, -.24, .26, .028);
      screw(g, .38, .24, .26, .028);
      return g;
    }

    const L = data.labels || {};

    // The neutral chassis is the shared contract; it carries no claimed values.
    const chassis = part('treaty', 0, -.22);
    clickable(annulus(chassis, 2.96, 1.04, .22, 0, plateM), 'treaty');
    annulus(chassis, 3.07, 2.9, .14, -.12, silver);
    ring(chassis, 3.04, .032, .11, edge);
    ring(chassis, 2.94, .024, .25, white);
    cylinder(chassis, 1.03, .11, .09, white);
    ring(chassis, 1.07, .022, .19, silver);
    if (data.engravePlate) engraving(chassis, data.engravePlate, tok('--ink-2'), 1.75, .14, .29).position.y = -2.42;
    if (L.plate) {
      const anchorT = chip(chassis, L.plate.chip, tok('--dial-engrave'), -2.62, -2.62, .30, 'treaty');
      label(anchorT, L.plate.title, L.plate.value, tok('--un-ink'), 0, [-150, 26]);
    }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      screw(chassis, Math.cos(a) * 2.73, Math.sin(a) * 2.73, .28, .066);
    }

    // 1. The target ring. GHOSTED whole when no pledge figure was read — the
    // arc is only ever the size of a figure actually read from a filing.
    const promise = part('pledge', 1, .40);
    clickable(annulus(promise, 2.82, 2.4, .12, 0, clear), 'pledge');
    ring(promise, 2.85, .028, .12, edge);
    ring(promise, 2.37, .015, .13, edge);
    const ratio = data.pledge?.ratio ?? null;
    const pledgeUnknown = ratio == null;
    const segments = [];
    for (let i = 0; i < 50; i++) {
      // Ghost reads as ghost at a glance: a DASHED rim (alternate segments
      // omitted) with a window cut at bottom centre for the etched reason —
      // never mistakable for a full glass ring. A read figure keeps all 50.
      if (pledgeUnknown && (i % 2 === 1 || (i >= 23 && i <= 27))) continue;
      const g = new T.TorusGeometry(2.61, .082, 8, 8, Math.PI * 2 / 50 * .78);
      const m = mesh(g, pledgeUnknown ? ghost : i < Math.round(ratio * 50) ? blue : porcelain, promise, 0, 0, .17);
      m.rotation.z = Math.PI / 2 + i / 50 * Math.PI * 2;
      segments.push(m);
      clickable(m, 'pledge');
    }
    // The etched reason in the window (copy arrives as data — R1).
    if (pledgeUnknown && data.pledge?.etch) {
      engraving(promise, data.pledge.etch, tok('--dial-engrave'), 1.5, .19, .20).position.y = -2.58;
    }
    if (L.pledge) {
      const anchorN = chip(promise, L.pledge.chip, tok('--un-ink'), -1.86, 2.62, .37, 'pledge');
      label(anchorN, L.pledge.title, L.pledge.value, tok('--un-ink'), 1, [-110, -28]);
    }

    // 2. The record train: gear sizes and motion come only from what was
    // counted; a gear with nothing behind it is ghosted and stands still.
    const inventory = part('delivery', 2, .35);
    const seats = [[-1.05, -.30, .87, 1], [.55, -.30, .70, -1], [1.33, .75, .58, 1]];
    (data.gears || []).slice(0, 3).forEach((spec, i) => {
      const [x, y, r, sign] = seats[i];
      const teeth = Math.max(9, Math.min(64, spec.teeth || 9));
      const g = clickable(cog(inventory, x, y, r, teeth, i === 0 ? measured : steel, sign, spec.live ? 1 : 0), 'delivery');
      if (!spec.live) ghost_(g);
      const cap = new T.Group(); cap.position.set(x, y, .43); inventory.add(cap);
      if (spec.engrave) engraving(cap, spec.engrave, tok('--ink-2'), r * 1.22, r * .30, .02);
      clickable(cap, 'delivery');
    });
    const gearSupports = [[[-1.05, -.30], [.55, -.30]], [[.55, -.30], [1.33, .75]]];
    gearSupports.forEach(([a, b]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const bar = new T.Group();
      bar.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -.17);
      bar.rotation.z = Math.atan2(dy, dx);
      inventory.add(bar);
      slab(bar, Math.hypot(dx, dy), .13, 0, cotes, .065);
    });
    // One marker per hashed document actually held — never an invented series.
    const dataMarks = [];
    const pins = Math.max(0, data.pins | 0);
    for (let i = 0; i < pins; i++) {
      const a = Math.PI * .1 + i / Math.max(pins, 15) * Math.PI * 1.8;
      const m = cylinder(inventory, .075, .045, .25, blue, Math.cos(a) * 2.26, Math.sin(a) * 2.26);
      clickable(m, 'delivery');
      dataMarks.push(m);
    }
    if (L.inventory) {
      const anchorI = chip(inventory, L.inventory.chip, tok('--inv'), -2.28, -1.79, .30, 'delivery');
      label(anchorI, L.inventory.title, L.inventory.value, tok('--inv'), 2, [-144, 10]);
    }

    // 3. The reporting bridge and its eight sockets. A state nothing was read
    // for is an EMPTY BORE — machined, waiting, unmistakably not filled.
    const evidence = part('evidence', 3, .78);
    const bridge = new T.Group();
    bridge.position.set(.65, .72, 0);
    bridge.rotation.z = .16;
    evidence.add(bridge);
    clickable(slab(bridge, 2.0, .48, 0, cotes, .13), 'evidence');
    screw(bridge, -.81, 0, .19, .07);
    screw(bridge, .81, 0, .19, .07);
    if (data.bridge?.engrave) engraving(bridge, data.bridge.engrave, data.bridge.seated ? tok('--btr') : tok('--ink-4'), .7, .22, .174);
    const socketSpecs = (data.sockets || []).slice(0, 8);
    const sockets = [];
    socketSpecs.forEach((spec, i) => {
      const a = Math.PI * 2 * i / 8;
      const g = new T.Group();
      g.position.set(Math.cos(a) * 1.95, Math.sin(a) * 1.95, .12);
      evidence.add(g);
      g.userData.click = 'evidence:' + spec.key;
      const pad = mesh(new T.CylinderGeometry(.34, .34, .6, 8), new T.MeshBasicMaterial({ visible: false }), g, 0, 0, .1);
      pad.rotation.x = Math.PI / 2;
      pad.castShadow = pad.receiveShadow = false;
      clickable(pad, 'evidence:' + spec.key);
      clickable(ring(g, .13, .024, .02, edge), 'evidence:' + spec.key);
      if (spec.state === 'observed' || spec.state === 'pledged') {
        const jewel = mesh(new T.SphereGeometry(.112, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), spec.state === 'observed' ? violet : glass, g, 0, 0, .02);
        jewel.rotation.x = Math.PI / 2;
        jewel.scale.set(1, .62, 1);
      } else if (spec.state === 'absent') {
        cylinder(g, .098, .08, -.04, shadowM);
      } else {
        annulus(g, .124, .082, .055, -.075, edge);
        cylinder(g, .082, .012, -.105, shadowM);
      }
      sockets.push(g);
      g.userData.key = spec.key;
      // VOID, the predecessor's fourth motion: a part that was read seats and
      // locks; a part never read rises, FAILS TO SEAT, and leaves. The
      // machined bore stays. Carrying the state here is the whole point — the
      // old branchless lift gave an empty bore the same triumphant rise as a
      // seated jewel, which flattered the absence it exists to show.
      g.userData.seats = spec.state === 'observed' || spec.state === 'pledged' || spec.state === 'absent';
      // the bore that remains when the part leaves: drawn once, never moved
      if (!g.userData.seats) {
        const bore = new T.Group();
        bore.position.copy(g.position);
        evidence.add(bore);
        annulus(bore, .124, .082, .055, -.075, edge);
        cylinder(bore, .082, .012, -.105, shadowM);
        g.userData.bore = bore;
      }
    });
    // Nothing read at all: the bridge never seats — held off its posts.
    const btrUnread = socketSpecs.length > 0 && socketSpecs.every((c) => c.state === 'unknown');
    if (btrUnread) { bridge.position.z += .32; bridge.rotation.y = -.19; }
    if (L.evidence) {
      const anchorB = chip(evidence, L.evidence.chip, tok('--btr'), 2.18, 1.58, .27, 'evidence');
      label(anchorB, L.evidence.title, L.evidence.value, tok('--btr'), 3, [36, -42]);
    }

    // 4. Finance docks beside the mechanism; unknown never makes it mesh.
    const finance = part('conditions', 4, .44);
    finance.position.set(3.58, -.38, .44);
    const fg = cog(finance, 0, 0, .55, 23, gold, -1, data.finance?.live ? 1 : 0);
    clickable(fg, 'conditions');
    if (!data.finance?.live) ghost_(fg);
    ring(finance, .68, .018, .13, edge);
    cylinder(finance, .11, .15, .15, gold);
    if (L.finance) {
      const anchorF = chip(finance, L.finance.chip, tok('--fin-ink'), 0, 1.06, .04, 'conditions');
      label(anchorF, L.finance.title, L.finance.value, tok('--fin-ink'), 4, [32, 18]);
    }

    // 5. The assessment core seats only after the inputs.
    const core = part('assessment', 5, 1.02);
    const corePlate = slab(core, .89, .75, 0, porcelain, .13);
    clickable(corePlate, 'delivery');
    if (data.iso3) engraving(core, data.iso3, tok('--ink-2'), .63, .24, .174);
    ring(core, .48, .018, .05, edge);

    // Hover restyles a mesh by swapping its authored material for a lit twin,
    // made once per material and shared.
    const twins = new Map();
    const skins = [];
    function twin(base) {
      const had = twins.get(base);
      if (had) return had;
      let m = base;
      if (base instanceof T.MeshStandardMaterial) {
        const s = base.clone();
        s.emissive.copy(base.emissive).multiplyScalar(base.emissiveIntensity).add(base.color.clone().multiplyScalar(.18));
        s.emissiveIntensity = 1;
        m = s;
      }
      twins.set(base, m);
      return m;
    }
    const contextLost = (event) => { event.preventDefault(); fail(); };
    function disposeScene() {
      const materials = new Set();
      scene.traverse((o) => {
        if (o instanceof T.Mesh || o instanceof T.Points || o instanceof T.Line) {
          o.geometry.dispose();
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => materials.add(m));
          if (o instanceof T.InstancedMesh) o.dispose();
        }
      });
      for (const s of skins) materials.add(s.base);
      twins.forEach((m) => materials.add(m));
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      keyLight.shadow.dispose();
      env.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      topLabels.remove();
      btrLayer.remove();
    }
    cleanup = disposeScene;

    // The planet: land as instanced five-sided dots from the Natural Earth
    // base map; the country on the stage is the only land that lights up.
    const basemap = data.basemapUrl
      ? await fetch(data.basemapUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      : null;
    if (cancelled) { cleanup(); return () => {}; }
    const R = 2.9;
    let beacon = null;
    // the planet is a QUANTITY surface, so it takes the sequential blue ramp
    // and never a new hue: the deepest step for the body, the palest for the
    // land it carries, and the rim glow between them.
    const globeBase = new T.MeshStandardMaterial({ color: hue('--q4'), roughness: .55, metalness: .35, side: T.DoubleSide });
    const rimGlow = new T.ShaderMaterial({
      transparent: true, side: T.BackSide, depthWrite: false,
      uniforms: { glow: { value: hue('--q2') } },
      vertexShader: 'varying vec3 n; varying vec3 v; void main(){vec4 mv=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);v=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader: 'varying vec3 n; varying vec3 v; uniform vec3 glow; void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),2.4);gl_FragColor=vec4(glow,rim*.6);}',
    });
    const north = new T.Group(), south = new T.Group();
    world.add(north, south);
    for (const [g, start] of [[north, 0], [south, Math.PI / 2]]) {
      const shell = new T.SphereGeometry(R, 96, 48, 0, Math.PI * 2, start, Math.PI / 2);
      shell.rotateX(Math.PI / 2);
      const planet = clickable(mesh(shell, globeBase, g), 'planet');
      planet.castShadow = false; planet.receiveShadow = false;
      const halo = new T.SphereGeometry(R * 1.07, 96, 48, 0, Math.PI * 2, start, Math.PI / 2);
      halo.rotateX(Math.PI / 2);
      const glow = new T.Mesh(halo, rimGlow);
      glow.renderOrder = 4;
      g.add(glow);
      ring(g, R, .03, 0, edge);
    }
    if (basemap) {
      // Equal Earth constants matching the base map's own projection extent.
      const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, X0 = -2.655978697909926, Y1 = 1.3054284640211968, K = 188.2545219182164;
      const toMap = (lon, lat) => {
        const t = Math.asin(Math.sqrt(3) / 2 * Math.sin(lat)), t2 = t * t, t6 = t2 * t2 * t2;
        return [(2 * Math.sqrt(3) * lon * Math.cos(t) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)) - X0) * K, (Y1 - (A4 * t6 * t2 * t + A3 * t6 * t + A2 * t2 * t + A1 * t)) * K];
      };
      const mask = document.createElement('canvas');
      mask.width = 2000; mask.height = 988;
      const mc = mask.getContext('2d', { willReadFrequently: true });
      mc.scale(2, 2);
      for (const [iso, d] of Object.entries(basemap.shapes)) {
        // not a design colour: this canvas is never shown. It is a lookup
        // mask read back per pixel, and the green channel is the one bit that
        // says "this land is the record on the stage".
        mc.fillStyle = iso === data.iso3 ? '#ff0000' : '#ffffff';
        mc.fill(new Path2D(d));
      }
      const px = mc.getImageData(0, 0, 2000, 988).data;
      const dots = [];
      let homeLon = 0, homeN = 0;
      const rows = 180;
      for (let r = 0; r < rows; r++) {
        const lat = -Math.PI / 2 + (r + .5) / rows * Math.PI;
        const count = Math.max(1, Math.round(Math.cos(lat) * rows * 2));
        for (let i = 0; i < count; i++) {
          const lon = -Math.PI + (i + .5) / count * Math.PI * 2;
          const [x, y] = toMap(lon, lat);
          if (x < 0 || x >= 1000 || y < 0 || y >= 494) continue;
          const k = (Math.floor(y * 2) * 2000 + Math.floor(x * 2)) * 4;
          if (px[k + 3] < 90) continue;
          const home = px[k + 1] < 128;
          if (home) { homeLon += lon; homeN++; }
          dots.push({ lon, lat, home });
        }
      }
      const turnG = Math.atan2(-1, .2) + .13 - (homeN ? homeLon / homeN : 0);
      const landDot = new T.MeshBasicMaterial({ color: hue('--q1'), toneMapped: false });
      // the walked record is the one part of the world this screen is about,
      // so it carries the treaty hue the record's own held rows carry
      const homeDot = new T.MeshBasicMaterial({ color: hue('--un'), toneMapped: false });
      const place = new T.Object3D(), out = new T.Vector3();
      for (const [g, north_] of [[north, true], [south, false]]) {
        for (const home of [false, true]) {
          const mine = dots.filter((d) => (d.lat >= 0) === north_ && d.home === home);
          if (!mine.length) continue;
          const inst = new T.InstancedMesh(new T.CircleGeometry(home ? .021 : .0155, 5), home ? homeDot : landDot, mine.length);
          mine.forEach((d, i) => {
            const c = Math.cos(d.lat), a = d.lon + turnG;
            place.position.set((R + .006) * c * Math.cos(a), (R + .006) * c * Math.sin(a), (R + .006) * Math.sin(d.lat));
            out.copy(place.position).multiplyScalar(2);
            place.lookAt(out);
            place.updateMatrix();
            inst.setMatrixAt(i, place.matrix);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.renderOrder = 3;
          g.add(inst);
        }
      }
      const homes = dots.filter((d) => d.home);
      if (homes.length) {
        const n = new T.Vector3();
        for (const d of homes) {
          const c = Math.cos(d.lat), a = d.lon + turnG;
          n.x += c * Math.cos(a); n.y += c * Math.sin(a); n.z += Math.sin(d.lat);
        }
        n.normalize();
        const g = n.z >= 0 ? north : south;
        const beam_ = new T.MeshBasicMaterial({ color: hue('--un'), toneMapped: false, transparent: true });
        const beam = new T.Mesh(new T.CylinderGeometry(.009, .009, .55, 8), beam_);
        beam.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n);
        beam.position.copy(n).multiplyScalar(R + .28);
        g.add(beam);
        beacon = new T.Mesh(new T.RingGeometry(.05, .068, 40), beam_.clone());
        beacon.position.copy(n).multiplyScalar(R + .012);
        beacon.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), n);
        g.add(beacon);
      }
    }
    const equator = part('planet-label', 0, -.23);
    ring(equator, 3.11, .01, 0, steel);
    if (data.engraveRim) engraving(equator, data.engraveRim, tok('--dial-engrave'), 2.32, .17, .09).position.y = -2.82;
    const obligations = new T.Group();
    chassis.add(obligations);
    (data.slabs || []).slice(0, 4).forEach((name, i) => {
      const g = new T.Group();
      const a = i * Math.PI / 2 + .38;
      g.position.set(Math.cos(a) * 2.08, Math.sin(a) * 2.08, .22);
      g.rotation.z = a - Math.PI / 2;
      obligations.add(g);
      clickable(slab(g, .80, .27, 0, steel, .06), 'treaty');
      engraving(g, name, tok('--ink-3'), .68, .10, .094);
    });

    const familyOf = (o) => {
      for (let p = o; p; p = p.parent) {
        if (p === north || p === south) return 'planet';
        const id = p.userData.id;
        if (id) return id === 'assessment' ? 'delivery' : id === 'planet-label' ? 'planet' : id;
      }
      return null;
    };
    const clickOf = (o) => {
      for (let p = o; p; p = p.parent) if (p.userData.click) return String(p.userData.click);
      return null;
    };
    scene.traverse((o) => {
      if (o instanceof T.Mesh && !Array.isArray(o.material)) {
        const family = familyOf(o);
        if (family) skins.push({ m: o, base: o.material, family, click: clickOf(o) });
      }
    });

    // Resting pose: the earlier open-work instrument.
    north.position.set(0, .65, 3.8);
    camera.up.set(0, 0, 1);
    south.position.z = -.34;
    for (const g of parts) {
      if (g !== chassis && g !== equator) g.position.z += Math.min(4, g.userData.phase) * .28;
    }
    for (const { g } of gears) g.position.z += .32;

    world.rotation.z = 0;
    world.updateMatrixWorld(true);
    const assemblies = [...parts.filter((g) => g !== equator), north, south].map((g) => {
      const box = new T.Box3().setFromObject(g);
      const center = box.getCenter(new T.Vector3());
      const shell = g === north ? 'upper' : g === south ? 'lower' : null;
      return {
        g,
        id: shell ?? String(g.userData.id),
        layer: shell === 'upper' ? 4 : shell === 'lower' ? 0 : g === core ? 2 : Math.min(4, g.userData.phase),
        shell,
        home: g.position.clone(),
        shift: new T.Vector3(),
        box,
        center,
        bounds: [box.min.toArray(), box.max.toArray()],
      };
    });
    world.rotation.z = -.13;
    let layout = createExplosionLayout(assemblies, 1);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableZoom = false;
    renderer.domElement.style.touchAction = 'pan-y';
    orbit.enableDamping = true;
    orbit.dampingFactor = .085;
    orbit.minDistance = 3;
    orbit.maxDistance = 100;
    orbit.target.set(0, 0, .25);
    orbit.maxPolarAngle = 1.5; // never under the floor
    camera.position.set(5.2, -16, 10.8);
    camera.lookAt(orbit.target);
    orbit.update();

    // startAt lets a resting page (the country dial) open already assembled.
    // TICK: one discrete beat, the only permanent loop in the scene. `tick`
    // counts beats; TICK_STEP is how far the train advances on each one.
    const TICK_SEC = 1.2, TICK_STEP = .055;
    let tick = 0;
    let disposed = false, raf = 0, last = performance.now(), amount = Math.max(0, Math.min(1, opts.startAt ?? 0)), gearTime = 0, lastPhase = -1, lastPercent = -1;
    let liftScale = 1;
    let dirty = true, fitDirty = true, manualCamera = false, lastInset = controls.inset;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const pos = new T.Vector3(), pointer = new T.Vector2(), ray = new T.Raycaster(), tap = new PointerTap();
    const cameraGoal = new T.Vector3(), lookGoal = new T.Vector3(), cameraSpeed = new T.Vector3(), lookSpeed = new T.Vector3();
    const shots = new Map();
    const front = new T.Vector3(0, -.001, 1).normalize(), iso = new T.Vector3(.20, -1, .50).normalize();

    const svg = 'http://www.w3.org/2000/svg';
    const lines = document.createElementNS(svg, 'svg');
    lines.classList.add('assembly-leaders');
    topLabels.insertBefore(lines, topLabels.firstChild);
    const leaders = labels.map(() => {
      const line = document.createElementNS(svg, 'polyline');
      line.setAttribute('pathLength', '1');
      lines.appendChild(line);
      return line;
    });
    const dots2 = labels.map(({ color }) => {
      const dot = document.createElementNS(svg, 'circle');
      dot.setAttribute('r', '3');
      dot.style.stroke = color;
      lines.appendChild(dot);
      return dot;
    });
    const socketHomes = sockets.map((g) => g.position.clone());
    const gearHomes = gears.map(({ g }) => g.position.z);
    const btrTags = sockets.map((g, i) => {
      const spec = socketSpecs[i];
      const tag = document.createElement('button');
      tag.type = 'button';
      tag.className = 'btr-piece-label state-' + spec.state;
      const num = document.createElement('small');
      num.textContent = spec.index ?? '';
      const name = document.createElement('strong');
      name.textContent = spec.label;
      const read = document.createElement('span');
      read.textContent = spec.read;
      tag.appendChild(num); tag.appendChild(name); tag.appendChild(read);
      tag.addEventListener('click', () => opts.onSelect?.('evidence:' + spec.key));
      btrLayer.appendChild(tag);
      return tag;
    });
    const btrAnchors = sockets.map(() => ({ x: 0, y: 0, set: false }));
    const btrLeaders = sockets.map(() => {
      const line = document.createElementNS(svg, 'polyline');
      line.setAttribute('class', 'btr-leader');
      line.setAttribute('pathLength', '1');
      lines.appendChild(line);
      return line;
    });
    const threadPositions = new Float32Array(sockets.length * 6);
    const threadGeometry = new T.BufferGeometry();
    threadGeometry.setAttribute('position', new T.BufferAttribute(threadPositions, 3));
    const threads = new T.LineSegments(threadGeometry, new T.LineBasicMaterial({ color: hue('--q2'), transparent: true, opacity: .45 }));
    threads.frustumCulled = false;
    evidence.add(threads);

    function resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      liftScale = w > 700 ? 1 : Math.max(.5, Math.min(1, (h - 70) / 560));
      layout = createExplosionLayout(assemblies, w / Math.max(1, h - 90));
      manualCamera = false;
      shots.clear();
      warmShots();
      fitDirty = dirty = true;
    }
    // Measure every shot while the page is idle.
    let warming = 0;
    function warmShots() {
      globalThis.cancelIdleCallback?.(warming);
      warming = (globalThis.requestIdleCallback ?? ((f) => setTimeout(f, 120)))(() => {
        if (!disposed) for (const k of [0, 1, 2, 3, 4, 5, 6, 8]) shot(k);
      });
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    // Off the screen the loop idles.
    let visible = true;
    const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) dirty = true; });
    io.observe(el);
    const changed = () => { dirty = true; };
    const started = () => { manualCamera = true; fitDirty = false; dirty = true; cameraSpeed.set(0, 0, 0); lookSpeed.set(0, 0, 0); };
    orbit.addEventListener('change', changed);
    orbit.addEventListener('start', started);
    const motionChanged = () => { fitDirty = dirty = true; manualCamera = false; };
    reduced.addEventListener('change', motionChanged);
    renderer.domElement.addEventListener('webglcontextlost', contextLost);

    function castAt(x, y) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set((x - rect.left) / rect.width * 2 - 1, -(y - rect.top) / rect.height * 2 + 1);
      camera.updateMatrixWorld();
      ray.setFromCamera(pointer, camera);
      const result = ray.intersectObjects(hits.filter((o) => {
        let p = o;
        while (p) { if (!p.visible) return false; p = p.parent; }
        return true;
      }), true);
      if (!result.length) return null;
      let o = result[0].object;
      while (o && !o.userData.click) o = o.parent;
      return o ? String(o.userData.click) : null;
    }
    function pick(event) {
      const id = castAt(event.clientX, event.clientY);
      if (id) opts.onSelect?.(id);
    }
    let hovered = null, hoverAt = null, hoverDirty = false, pressed = false, lastHover = 0, shown = '';
    function setHover(id) {
      if (id === hovered) return;
      hovered = id;
      renderer.domElement.style.cursor = id ? 'pointer' : '';
      dirty = true;
    }
    function restyle() {
      const hoverFamily = hovered && !hovered.includes(':') ? hovered : null;
      const k = String(hovered);
      if (k === shown) return;
      shown = k;
      for (const s of skins) {
        const lit = hovered != null && (hoverFamily ? s.family === hoverFamily : s.click === hovered);
        s.m.material = lit ? twin(s.base) : s.base;
      }
      dirty = true;
    }
    const down = (e) => { pressed = true; setHover(null); tap.down(e.pointerId, e.clientX, e.clientY, e.pointerType === 'touch' ? 12 : 5); };
    const move = (e) => { tap.move(e.pointerId, e.clientX, e.clientY); if (e.pointerType !== 'touch') { hoverAt = { x: e.clientX, y: e.clientY }; hoverDirty = true; } };
    const up = (e) => { pressed = false; hoverDirty = true; if (tap.up(e.pointerId, e.clientX, e.clientY)) pick(e); };
    const cancel = (e) => { pressed = false; tap.cancel(e.pointerId); };
    const leave = () => { hoverAt = null; hoverDirty = true; };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', cancel);
    renderer.domElement.addEventListener('lostpointercapture', cancel);
    renderer.domElement.addEventListener('pointerleave', leave);
    const vis = () => { dirty = true; };
    document.addEventListener('visibilitychange', vis);

    function placeParts() {
      const story = narrativeAmount(amount);
      // Each assembly CLOSES before it lays flat: without this the screws,
      // sockets and data pins stay at their lifted offsets while their parent
      // travels to its cell, and the flat lay strews small parts across the
      // frame. The predecessor's own rule is re-seat, then spread.
      const internal = (layer) => story * (1 - returnAmount(amount, layer)) * (1 - deskAmount(amount));
      assemblies.forEach((p) => {
        const cell = layout.cells.get(p.id);
        const offset = cycleOffset(amount, p.layer, p.center, { x: cell.x, y: cell.y, z: 0 }, p.shell, liftScale);
        const float = 0;
        p.shift.set(offset.x, offset.y, offset.z);
        p.g.position.copy(p.home).add(pos.set(offset.x, offset.y, offset.z + float));
      });
      segments.forEach((m, i) => {
        const t = reveal(internal(1), .235 + i * .0014, .26 + i * .0014);
        m.position.z = .17 + t * .12;
      });
      dataMarks.forEach((m, i) => {
        const start = .375 + i / Math.max(1, dataMarks.length) * .065;
        m.position.z = .25 + .16 * reveal(internal(2), start, start + .025);
      });
      gears.forEach(({ g, speed, phase }, i) => {
        // TICK — the one permanent loop the predecessor allows, and the only
        // motion left when nothing is scrolling: the train advances in
        // discrete beats of the read cycle instead of spinning continuously.
        // Six smooth sinusoids used to run at once here, which is the loudest
        // "ambient 3D hero" tell there is; they are deleted, not retimed.
        g.rotation.z = tick * speed * TICK_STEP;
        g.position.z = gearHomes[i] + .18 * reveal(internal(phase === 4 ? 4 : 2), phase === 4 ? .94 : .395 + i * .018, phase === 4 ? .99 : .43 + i * .018);
      });
      sockets.forEach((g, i) => {
        const t = btrReveal(internal(3), i);
        g.position.copy(socketHomes[i]);
        // One lift height for every seat (the old `.82 + i * .035` made the
        // height mean array order, which in a product that forbids a figure
        // without a receipt is the same sin in another medium).
        if (g.userData.seats) {
          // ASSEMBLE: the part rises and seats, with the one-frame overshoot
          // the predecessor's motion sheet asks for, so it reads as a click
          // and not a slide.
          const over = t < 1 ? Math.sin(t * Math.PI) * .055 : 0;
          g.position.z += t * .9 + over;
          g.scale.setScalar(1 + t * .65);
          g.visible = true;
        } else {
          // VOID: it rises, fails to seat, and goes. The bore stays behind.
          const leave = Math.max(0, (t - .62) / .38);
          g.position.z += t * .9 + leave * .5;
          g.scale.setScalar((1 + t * .65) * (1 - leave));
          g.visible = leave < .999;
        }
        threadPositions.set([socketHomes[i].x, socketHomes[i].y, socketHomes[i].z, g.position.x, g.position.y, g.position.z], i * 6);
      });
      threadGeometry.attributes.position.needsUpdate = true;
      threads.visible = internal(3) > .615;
      north.rotation.z = south.rotation.z = tick * .02;
      if (beacon) {
        // the beacon marks the walked record on the same beat as the train,
        // and lands on it instead of restarting from a sawtooth's pop
        const t = Math.min(1, (gearTime - tick * TICK_SEC) / .42);
        beacon.scale.setScalar(1 + t * 2.4);
        beacon.material.opacity = (1 - t) * (1 - t);
      }
      world.rotation.z = -.13 * (1 - deskAmount(amount) * (1 - returnAmount(amount, 0)));
      floor.visible = amount < .7 || amount > .99;
      equator.visible = amount < .7 || amount > .99;
      world.updateMatrixWorld(true);
    }

    function measure(lidAway) {
      const bounds = new T.Box3();
      const story = narrativeAmount(amount);
      const deskView = deskAmount(amount) * (1 - reveal(amount, .84, .96));
      assemblies.forEach((p) => {
        if (lidAway && p.shell === 'upper') return;
        const box = p.box.clone().translate(p.shift);
        if (deskView < .001) {
          if (p.shell === 'upper') box.max.z = box.min.z + .45;
          if (p.shell === 'lower') box.min.z = box.max.z - 1.0;
        }
        if (p.g === evidence) box.max.z += 1.3 * btrReveal(story * (1 - returnAmount(amount, 3)), 7);
        box.applyMatrix4(world.matrixWorld);
        bounds.union(box);
      });
      return bounds;
    }
    // One shot per chapter; the camera travels only when the chapter changes.
    // Each entry samples the poses a chapter PASSES THROUGH, not only the one
    // it starts on: the camera travels once per chapter, so a chapter whose
    // box is measured at a single instant frames a pose the parts have
    // already left — which is how the lid came to climb out of the top of the
    // frame and into the heading strip during chapter 0.
    const SHOTS = { 0: [0, .026, .0519], 1: [.052, .1365], 2: [.1365, .234], 3: [.234, .3315], 4: [.3315, .5915], 5: [.5915, .6999], 6: [.8, .8399], 8: [1] };
    function shot(chapter) {
      let box = shots.get(chapter);
      if (box) return box;
      const now = amount;
      box = new T.Box3();
      for (const at of SHOTS[chapter]) {
        amount = at;
        placeParts();
        box.union(measure(chapter > 0 && chapter < 6));
      }
      amount = now;
      placeParts();
      shots.set(chapter, box);
      return box;
    }
    // Critically damped (the SmoothDamp form): leaves from rest, lands without overshoot.
    function glide(at, speed, goal, dt, time = .42) {
      const w = 2 / time, k = w * dt, e = 1 / (1 + k + .48 * k * k + .235 * k * k * k);
      const dx = at.x - goal.x, dy = at.y - goal.y, dz = at.z - goal.z;
      const tx = (speed.x + w * dx) * dt, ty = (speed.y + w * dy) * dt, tz = (speed.z + w * dz) * dt;
      speed.set((speed.x - w * tx) * e, (speed.y - w * ty) * e, (speed.z - w * tz) * e);
      at.set(goal.x + (dx + tx) * e, goal.y + (dy + ty) * e, goal.z + (dz + tz) * e);
    }
    function fit() {
      const deskView = deskAmount(amount) * (1 - reveal(amount, .84, .96));
      const chapter = cyclePhase(amount);
      // The homecoming (7) is measured live over EVERY part still out, so the
      // frame contains the whole spread at every travel point — a returning
      // shell is never outside the canvas while it flies home.
      const bounds = chapter === 7 ? measure(false) : shot(chapter);
      bounds.getCenter(lookGoal);
      const direction = iso.clone().lerp(front, deskView).normalize();
      const right = new T.Vector3().crossVectors(camera.up, direction).normalize();
      const up = new T.Vector3().crossVectors(direction, right).normalize();
      const tangent = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
      // THE FRAME. The comps' plate fills about three quarters of the frame's
      // height; this instrument was filling barely a quarter, because the fit
      // reserved 80px top-and-bottom plus 96px each side plus a 4% ring of
      // air — on a 900px stage that is a third of the frame given away before
      // the object is placed. The margins now only have to clear the stage's
      // own chrome (the heading strip and the affordance line).
      // Vertically the margin is NOT free: the stage's own chrome (the
      // heading strip at the top, the affordance line at the bottom) lives
      // inside the canvas, and the object must never cross either. Sideways
      // there is nothing to clear but the card column, which `inset` already
      // accounts for, so that margin comes down to a hairline of air.
      const padY = el.clientWidth > 700 ? 80 : Math.min(80, el.clientHeight * .12);
      const tanY = tangent * Math.max(.5, (el.clientHeight - padY) / el.clientHeight);
      const inset = Math.min(controls.inset ?? 0, el.clientWidth * .5);
      const edgePx = el.clientWidth > 700 ? 52 : 24;
      const tanX = tangent * camera.aspect * Math.max(.5, (el.clientWidth - edgePx - inset) / el.clientWidth);
      let distance = 0;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const corner = new T.Vector3(x, y, z).sub(lookGoal);
        const depth = corner.dot(direction);
        distance = Math.max(distance, depth + Math.abs(corner.dot(right)) / tanX, depth + Math.abs(corner.dot(up)) / tanY);
      }
      distance = distance * 1.015;
      lookGoal.addScaledVector(right, -(inset + 36 - edgePx) / el.clientWidth * distance * tangent * camera.aspect);
      cameraGoal.copy(direction).multiplyScalar(distance).add(lookGoal);
      camera.far = Math.max(150, distance + 80);
      camera.updateProjectionMatrix();
    }
    function updateLabels() {
      const story = narrativeAmount(amount);
      const step = btrStepAt(narrativeAmount(Math.round(amount * 100) / 100));
      const placed = [];
      const [padT, padB] = el.clientWidth > 700 ? [60, 44] : [12, 34];
      const keep = (controls.inset ?? 0) + 28;
      pos.set(0, 0, 0).applyMatrix4(world.matrixWorld).project(camera);
      const midX = (pos.x * .5 + .5) * el.clientWidth;
      labels.forEach(({ el: tag, anchor, offset, phase }, i) => {
        const p = assemblies.find((a) => a.g === anchor || a.g === anchor.parent);
        if (!p) return;
        const box = p.box.clone().translate(p.g.position.clone().sub(p.home));
        let inDepth = false;
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          pos.set(x, y, z).applyMatrix4(world.matrixWorld).project(camera);
          inDepth ||= pos.z >= -1 && pos.z <= 1;
        }
        anchor.getWorldPosition(pos).project(camera);
        const cx = (pos.x * .5 + .5) * el.clientWidth, cy = (-pos.y * .5 + .5) * el.clientHeight;
        // A callout clears BEFORE its chapter hands over (.02 of progress
        // early): the fade finishes on a stable camera, never riding the next
        // chapter's lift. Chapter p+1 ends at LAYER_WINDOWS[p+1][0]·.65 for
        // the first four parts; the finance chapter ends at the desk (.70).
        const handover = (phase < 4 ? LAYER_WINDOWS[phase + 1][0] * .65 : .70) - .02;
        const show = amount < handover && storyPhase(story) === phase + 1 && step < 0 && inDepth && cx >= 0 && cx <= el.clientWidth && cy >= 0 && cy <= el.clientHeight;
        tag.classList.toggle('is-shown', show);
        leaders[i].classList.toggle('is-shown', show);
        dots2[i].classList.toggle('is-shown', show);
        if (!show) return;
        const w = tag.offsetWidth, h = tag.offsetHeight;
        let x = Math.max(keep, Math.min(el.clientWidth - w - 12, cx + (cx < midX ? -w - 26 : 30)));
        let y = Math.max(padT, Math.min(el.clientHeight - h - padB, cy + offset[1]));
        let tries = 0;
        while (placed.some((r) => x < r.x + r.w + 8 && x + w + 8 > r.x && y < r.y + r.h + 8 && y + h + 8 > r.y) && tries++ < 40) {
          y += 22;
          if (y + h > el.clientHeight - padB) { y = padT; x = x < el.clientWidth / 2 ? el.clientWidth - w - 12 : keep; }
        }
        placed.push({ x, y, w, h });
        tag.style.transform = `translate(${x}px,${y}px)`;
        const edgeX = cx < x ? x : cx > x + w ? x + w : x + w / 2;
        leaders[i].setAttribute('points', `${cx},${cy} ${cx},${y + h / 2} ${edgeX},${y + h / 2}`);
        dots2[i].setAttribute('cx', String(cx));
        dots2[i].setAttribute('cy', String(cy));
      });
      btrTags.forEach((tag, i) => {
        sockets[i].getWorldPosition(pos);
        pos.project(camera);
        const show = amount < .70 && step === i && pos.z >= -1 && pos.z <= 1;
        tag.classList.toggle('is-shown', show);
        btrLeaders[i].classList.toggle('is-shown', show);
        if (!show) return;
        let cx = (pos.x * .5 + .5) * el.clientWidth, cy = (-pos.y * .5 + .5) * el.clientHeight;
        const anchor = btrAnchors[i];
        if (anchor.set && Math.hypot(cx - anchor.x, cy - anchor.y) < 4) { cx = anchor.x; cy = anchor.y; }
        else { anchor.x = cx; anchor.y = cy; anchor.set = true; }
        const w = tag.offsetWidth, h = tag.offsetHeight;
        let x = Math.max(keep, Math.min(el.clientWidth - w - 6, cx - w / 2)), y = cy - h - 16, free = false;
        for (const dx of [0, -w * .8, w * .8, -w * 1.6, w * 1.6]) {
          for (const s of [0, -1, -2, -3, 1, 2, 3, -4, 4]) {
            const ty = s <= 0 ? cy - h - 16 + s * (h + 8) : cy + 16 + (s - 1) * (h + 8);
            if (ty < padT || ty > el.clientHeight - h - padB) continue;
            x = Math.max(keep, Math.min(el.clientWidth - w - 6, cx - w / 2 + dx));
            y = ty;
            if (!placed.some((r) => x < r.x + r.w + 6 && x + w + 6 > r.x && y < r.y + r.h + 6 && y + h + 6 > r.y)) { free = true; break; }
          }
          if (free) break;
        }
        placed.push({ x, y, w, h });
        tag.style.transform = `translate(${x}px,${y}px)`;
        btrLeaders[i].setAttribute('points', `${cx},${cy} ${cx < x ? x : cx > x + w ? x + w : x + w / 2},${y < cy ? y + h : y}`);
      });
    }

    placeParts();
    fit();
    camera.position.copy(cameraGoal);
    orbit.target.copy(lookGoal);
    orbit.update();

    function frame(now) {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, .05);
      last = now;
      if (document.hidden || !visible) return;
      const still = reduced.matches;
      if (controls.inset !== lastInset) { lastInset = controls.inset; fitDirty = dirty = true; manualCamera = false; shots.clear(); }
      const target = controls.progress != null ? Math.max(0, Math.min(1, controls.progress / 100)) : 0;
      const previous = amount;
      if (still) amount = target;
      else amount = Math.abs(target - amount) < .0001 ? target : T.MathUtils.damp(amount, target, 8, dt);
      const moving = previous !== amount;
      if (moving) { dirty = true; if (!manualCamera) fitDirty = true; }
      const animate = !still && !controls.paused;
      if (animate) {
        gearTime += dt;
        const beat = Math.floor(gearTime / TICK_SEC);
        if (beat !== tick) { tick = beat; dirty = true; }
        // the pledge ring breathes with nothing: it is ghosted, and a ghost
        // that pulses reads as alive. Only the tick moves.
        if (gearTime - tick * TICK_SEC < .5) dirty = true;
      }
      if (moving || animate) placeParts();
      if (fitDirty) {
        fit();
        if (still) { camera.position.copy(cameraGoal); orbit.target.copy(lookGoal); }
        else { glide(camera.position, cameraSpeed, cameraGoal, dt, .42); glide(orbit.target, lookSpeed, lookGoal, dt, .42); }
        if (camera.position.distanceTo(cameraGoal) < .0001 && orbit.target.distanceTo(lookGoal) < .0001 && cameraSpeed.lengthSq() < 1e-8) {
          camera.position.copy(cameraGoal);
          orbit.target.copy(lookGoal);
          cameraSpeed.set(0, 0, 0);
          lookSpeed.set(0, 0, 0);
          fitDirty = false;
        }
        dirty = true;
      }
      orbit.update(dt);
      const phase = cyclePhase(amount);
      if (phase !== lastPhase) { lastPhase = phase; opts.onPhase?.(phase); dirty = true; }
      const percent = Math.round(amount * 100);
      if (percent !== lastPercent) { lastPercent = percent; opts.onProgress?.(percent); }
      if (!pressed && (hoverDirty || (hoverAt && dirty && now - lastHover > 120))) {
        hoverDirty = false;
        lastHover = now;
        setHover(hoverAt ? castAt(hoverAt.x, hoverAt.y) : null);
      }
      restyle();
      if (dirty) {
        camera.updateMatrixWorld();
        renderer.render(scene, camera);
        updateLabels();
        dirty = false;
      }
    }
    raf = requestAnimationFrame(frame);
    cleanup = () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      io.disconnect();
      reduced.removeEventListener('change', motionChanged);
      orbit.removeEventListener('change', changed);
      orbit.removeEventListener('start', started);
      orbit.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', cancel);
      renderer.domElement.removeEventListener('lostpointercapture', cancel);
      renderer.domElement.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', vis);
      disposeScene();
    };
    return () => { cancelled = true; cleanup(); };
  } catch (error) {
    console.error('3D layer unavailable', error);
    fail();
    return () => { cancelled = true; cleanup(); };
  }
}
