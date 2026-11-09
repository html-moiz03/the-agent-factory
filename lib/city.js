import * as THREE from 'three';

// 3D city. It does not run its own story: the page feeds it pipeline events through handle(event),
// and each event animates something (a robot starts working, a crate is carried, a verdict lands).
// Event types handled: run_start, agent_start, agent_done, agent_error, handoff, run_end.

const LAYOUT = {
  friday: { pad: [-10, -5], bld: [-10, -9.8], row: 'A', h: 5 },
  edith: { pad: [0, -5], bld: [0, -9.8], row: 'A', h: 6 },
  jarvis: { pad: [10, -5], bld: [10, -9.8], row: 'A', h: 6.5 },
  dume: { pad: [10, 5], bld: [10, 9.8], row: 'B', h: 5 },
  ultron: { pad: [0, 5], bld: [0, 9.8], row: 'B', h: 5.5 },
  vision: { pad: [-10, 5], bld: [-10, 9.8], row: 'B', h: 7 },
};
const PROP = { friday: 'research', edith: 'ui', jarvis: 'backend', dume: 'testing', ultron: 'security', vision: 'judge' };
const MIN_WORK = 2.4; // seconds a robot visibly works, even if the agent answers instantly
const ERROR_COLOR = 0xff4d4d;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexOf = (css) => parseInt(css.slice(1), 16);

export function createCity({ canvas, labelsEl, agents, onBanner }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (err) {
    return null;
  }
  const stage = canvas.parentElement;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1a2b);
  scene.fog = new THREE.Fog(0x0e1a2b, 70, 140);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);

  /* ---------- data ---------- */
  const S = agents.map((a) => ({
    ...a,
    ...LAYOUT[a.id],
    kind: PROP[a.id],
    colorHex: hexOf(a.color),
    state: 'idle',
    progress: 0,
    t0: 0,
  }));
  const byId = {};
  S.forEach((s, i) => {
    byId[s.id] = i;
  });

  /* ---------- helpers ---------- */
  function lam(c, extra) {
    const o = { color: c };
    if (extra) Object.assign(o, extra);
    return new THREE.MeshLambertMaterial(o);
  }
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, y || 0, z || 0);
    m.castShadow = true;
    return m;
  }

  /* ---------- lights ---------- */
  scene.add(new THREE.HemisphereLight(0x6f8fc8, 0x0b1424, 0.75));
  const sun = new THREE.DirectionalLight(0xcfe0ff, 0.85);
  sun.position.set(-18, 34, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  scene.add(sun);

  /* ---------- ground and roads ---------- */
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 70), lam(0x142238));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = lam(0x0b1424);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x3c5a85 });
  function road(x1, z1, x2, z2) {
    const w = 3.2;
    const horiz = Math.abs(z1 - z2) < 0.01;
    const len = horiz ? Math.abs(x2 - x1) : Math.abs(z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : w, 0.06, horiz ? w : len), roadMat);
    m.position.set((x1 + x2) / 2, 0.03, (z1 + z2) / 2);
    m.receiveShadow = true;
    scene.add(m);
    const n = Math.floor(len / 2.2);
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + 1.1 + i * 2.2;
      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(horiz ? 1.1 : 0.12, 0.02, horiz ? 0.12 : 1.1),
        lineMat
      );
      dash.position.set(horiz ? (x1 + x2) / 2 + t : x1, 0.07, horiz ? z1 : (z1 + z2) / 2 + t);
      scene.add(dash);
    }
  }
  road(-22, -5, 22, -5);
  road(-22, 5, 22, 5);
  road(-10, -5, -10, 5);
  road(10, -5, 10, 5);
  road(-22, -14.5, 22, -14.5);
  road(-22, 14.5, 22, 14.5);
  road(-22, -14.5, -22, 14.5);
  road(22, -14.5, 22, 14.5);

  /* ---------- buildings ---------- */
  function winCanvas() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if (Math.random() < 0.5) {
          g.fillStyle = Math.random() < 0.65 ? '#ffd98a' : '#8fc7ff';
          g.fillRect(x * 16 + 4, y * 16 + 4, 8, 9);
        }
      }
    }
    return c;
  }
  const winBases = [new THREE.CanvasTexture(winCanvas()), new THREE.CanvasTexture(winCanvas()), new THREE.CanvasTexture(winCanvas())];
  function winMats(w, h, d, color) {
    function mk(rw, v) {
      const t = winBases[v % 3].clone();
      t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.max(1, Math.round(rw / 2.5)), Math.max(1, Math.round(h / 2.5)));
      return new THREE.MeshLambertMaterial({ color, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.85 });
    }
    const top = new THREE.MeshLambertMaterial({ color: 0x16263d });
    const v = Math.floor(Math.random() * 3);
    const sx = mk(d, v);
    const sz = mk(w, v + 1);
    return [sx, sx, top, top, sz, sz];
  }
  function filler(x, z, w, d, h) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), winMats(w, h, d, 0x1a2e4a));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  filler(-17, -9.8, 5, 5, 4);
  filler(17, -9.8, 5, 5, 5);
  filler(-17, 9.8, 5, 5, 5);
  filler(17, 9.8, 5, 5, 4);
  filler(-16.5, 0, 6, 5, 3.4);
  filler(16.5, 0, 6, 5, 3.8);

  function signTexture(text, css) {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 112;
    const g = c.getContext('2d');
    g.fillStyle = css;
    g.fillRect(0, 0, 512, 112);
    g.fillStyle = '#0B1424';
    g.font = '700 50px "Chakra Petch", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 58);
    return new THREE.CanvasTexture(c);
  }
  function makeStation(st) {
    const w = 7;
    const d = 5;
    const h = st.h;
    const x = st.bld[0];
    const z = st.bld[1];
    const side = st.row === 'A' ? 1 : -1;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), winMats(w, h, d, 0x1d3352));
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const roofMat = lam(0x16263d, { emissive: st.colorHex, emissiveIntensity: 0.18 });
    g.add(box(w + 0.4, 0.35, d + 0.4, roofMat, 0, h + 0.175, 0));
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(5.6, 1.1),
      new THREE.MeshBasicMaterial({ map: signTexture(st.station, st.color) })
    );
    sign.position.set(0, h - 1, side * (d / 2 + 0.03));
    if (side < 0) sign.rotation.y = Math.PI;
    g.add(sign);
    const doorMat = new THREE.MeshBasicMaterial({ color: st.colorHex });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.1), doorMat);
    door.position.set(0, 1.1, side * (d / 2 + 0.04));
    g.add(door);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), lam(0xc8d4e6));
    mast.position.set(0, h + 0.8, 0);
    g.add(mast);
    const beaconMat = new THREE.MeshBasicMaterial({ color: st.colorHex });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 16), beaconMat);
    beacon.position.set(0, h + 1.35, 0);
    g.add(beacon);
    scene.add(g);
    const ringMat = new THREE.MeshBasicMaterial({ color: st.colorHex, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.4, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(st.pad[0], 0.09, st.pad[1]);
    scene.add(ring);
    st.roofMat = roofMat;
    st.beacon = beacon;
    st.beaconMat = beaconMat;
    st.ring = ring;
    st.ringMat = ringMat;
    st.doorMat = doorMat;
  }
  S.forEach(makeStation);

  /* fountain plaza */
  (function () {
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.4, 32), lam(0x1d3352));
    basin.position.set(0, 0.2, 0);
    basin.castShadow = true;
    basin.receiveShadow = true;
    scene.add(basin);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.05, 32), new THREE.MeshBasicMaterial({ color: 0x2e6fa8 }));
    water.position.set(0, 0.42, 0);
    scene.add(water);
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.4, 10), new THREE.MeshBasicMaterial({ color: 0x8fc7ff }));
    jet.position.set(0, 1.1, 0);
    scene.add(jet);
  })();

  /* trees and lamps */
  function tree(x, z, s) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(s || 1);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.9, 8), lam(0x3b2a1e));
    t.position.y = 0.45;
    t.castShadow = true;
    g.add(t);
    const a = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.8, 8), lam(0x1e5a44));
    a.position.y = 1.7;
    a.castShadow = true;
    g.add(a);
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.4, 8), lam(0x24684f));
    b.position.y = 2.6;
    b.castShadow = true;
    g.add(b);
    scene.add(g);
  }
  [[-5, -9.8], [5, -9.8], [-5, 9.8], [5, 9.8], [-20.5, -9.8], [20.5, -9.8], [-20.5, 9.8], [20.5, 9.8], [-13, 0], [13, 0], [-5, -2.8], [5, 2.8], [-20, -12], [20, 12], [-6, -12.2], [6, 12.2]].forEach((p, i) => {
    tree(p[0], p[1], 0.85 + (i % 3) * 0.12);
  });
  function lampPost(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3, 8), lam(0x5b6f8c));
    pole.position.set(x, 1.5, z);
    pole.castShadow = true;
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffe3a0 }));
    head.position.set(x, 3.1, z);
    scene.add(head);
  }
  [[-5, -3.2], [5, -3.2], [-5, 3.2], [5, 3.2], [-19, -3.2], [19, -3.2], [-19, 3.2], [19, 3.2]].forEach((p) => lampPost(p[0], p[1]));

  /* ---------- robots ---------- */
  function addProp(hand, st) {
    const light = lam(0xeaf0f8);
    const acc = lam(st.colorHex, { emissive: st.colorHex, emissiveIntensity: 0.25 });
    const k = st.kind;
    let m;
    if (k === 'research') {
      hand.add(box(0.07, 0.42, 0.07, light, 0, -0.2, 0));
      m = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 8, 22), light);
      m.position.set(0, -0.62, 0);
      m.castShadow = true;
      hand.add(m);
      m = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), new THREE.MeshBasicMaterial({ color: st.colorHex, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      m.position.set(0, -0.62, 0);
      hand.add(m);
    } else if (k === 'ui') {
      hand.add(box(0.1, 0.8, 0.1, light, 0, -0.4, 0));
      m = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 8), acc);
      m.rotation.x = Math.PI;
      m.position.set(0, -0.9, 0);
      hand.add(m);
    } else if (k === 'backend') {
      hand.add(box(0.08, 0.62, 0.08, light, 0, -0.3, 0));
      hand.add(box(0.5, 0.24, 0.24, acc, 0, -0.66, 0));
    } else if (k === 'testing') {
      hand.add(box(0.46, 0.58, 0.05, light, 0, -0.35, 0.14));
      hand.add(box(0.26, 0.07, 0.06, acc, 0, -0.3, 0.18));
      hand.add(box(0.26, 0.07, 0.06, acc, 0, -0.45, 0.18));
    } else if (k === 'security') {
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.07, 6), acc);
      m.rotation.x = Math.PI / 2;
      m.position.set(0.05, -0.32, 0.2);
      m.castShadow = true;
      hand.add(m);
    } else {
      hand.add(box(0.08, 0.64, 0.08, light, 0, -0.3, 0));
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.5, 14), acc);
      m.rotation.z = Math.PI / 2;
      m.position.set(0, -0.66, 0);
      m.castShadow = true;
      hand.add(m);
    }
  }
  function makeRobot(st, idx) {
    const root = new THREE.Group();
    const rig = new THREE.Group();
    root.add(rig);
    const mat = lam(st.colorHex);
    const dark = lam(0x0b1424);
    const metal = lam(0xc8d4e6);
    const eye = new THREE.MeshBasicMaterial({ color: 0xffb84d });
    rig.add(box(0.95, 0.95, 0.6, mat, 0, 1.2, 0));
    rig.add(box(0.5, 0.3, 0.05, dark, 0, 1.25, 0.31));
    const head = new THREE.Group();
    head.position.set(0, 2.0, 0);
    rig.add(head);
    head.add(box(1, 0.78, 0.82, mat, 0, 0, 0));
    head.add(box(0.78, 0.48, 0.05, dark, 0, 0.02, 0.42));
    head.add(box(0.14, 0.14, 0.05, eye, -0.18, 0.04, 0.46));
    head.add(box(0.14, 0.14, 0.05, eye, 0.18, 0.04, 0.46));
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), metal);
    ant.position.set(0, 0.55, 0);
    head.add(ant);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffb84d }));
    bulb.position.set(0, 0.78, 0);
    head.add(bulb);
    function limb(x, y, w, h, m) {
      const g = new THREE.Group();
      g.position.set(x, y, 0);
      g.add(box(w, h, w, m, 0, -h / 2 + 0.05, 0));
      rig.add(g);
      return g;
    }
    const armL = limb(-0.64, 1.6, 0.22, 0.78, mat);
    const armR = limb(0.64, 1.6, 0.22, 0.78, mat);
    const legL = limb(-0.24, 0.78, 0.28, 0.78, metal);
    const legR = limb(0.24, 0.78, 0.28, 0.78, metal);
    const hand = new THREE.Group();
    hand.position.set(0, -0.75, 0.12);
    armR.add(hand);
    addProp(hand, st);
    const hold = new THREE.Group();
    hold.position.set(0, 1.35, 0.8);
    rig.add(hold);
    const faceHome = st.row === 'A' ? Math.PI : 0;
    root.position.set(st.pad[0], 0, st.pad[1]);
    root.rotation.y = faceHome;
    scene.add(root);
    return {
      st, idx, root, rig, head, armL, armR, legL, legR, hold,
      pad: { x: st.pad[0], z: st.pad[1] },
      face: faceHome, faceHome, heading: faceHome, phase: 0,
      motion: null, carrying: false, working: false, strike: false,
    };
  }
  const R = S.map(makeRobot);

  /* ---------- cars ---------- */
  const lane = [[-21.2, -13.7], [21.2, -13.7], [21.2, 13.7], [-21.2, 13.7]];
  const segLen = [];
  let loopLen = 0;
  for (let li = 0; li < 4; li++) {
    const a = lane[li];
    const b = lane[(li + 1) % 4];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segLen.push(l);
    loopLen += l;
  }
  function lanePoint(s0) {
    let s = ((s0 % loopLen) + loopLen) % loopLen;
    for (let i = 0; i < 4; i++) {
      if (s <= segLen[i]) {
        const a = lane[i];
        const b = lane[(i + 1) % 4];
        const t = s / segLen[i];
        return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(b[0] - a[0], b[1] - a[1]) };
      }
      s -= segLen[i];
    }
    return { x: 0, z: 0, h: 0 };
  }
  const cars = [0xffb84d, 0x4cc9f0, 0xf78fb3, 0xa78bfa].map((c, i) => {
    const g = new THREE.Group();
    g.add(box(0.95, 0.5, 1.9, lam(c), 0, 0.45, 0));
    g.add(box(0.8, 0.4, 1.0, lam(0x0b1424), 0, 0.9, -0.1));
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0xfff2c8 }));
    hl.position.set(0, 0.5, 0.96);
    g.add(hl);
    scene.add(g);
    return { g, s: (i * loopLen) / 4, v: 4.5 + i * 0.4 };
  });

  /* ---------- confetti ---------- */
  const confetti = [];
  (function () {
    const cols = [0xffb84d, 0x4cc9f0, 0xf78fb3, 0x5fd3a0, 0xa78bfa, 0xff7b72];
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.16), new THREE.MeshBasicMaterial({ color: cols[i % 6] }));
      m.visible = false;
      scene.add(m);
      confetti.push({ m, vx: 0, vy: 0, vz: 0, life: 0 });
    }
  })();
  function burst() {
    const j = S[S.length - 1];
    confetti.forEach((c) => {
      c.m.position.set(j.pad[0], 3.2, j.pad[1]);
      c.vx = (Math.random() - 0.5) * 7;
      c.vy = 4 + Math.random() * 5;
      c.vz = (Math.random() - 0.5) * 7;
      c.life = 2.4 + Math.random() * 0.8;
      c.m.visible = true;
    });
  }

  /* ---------- clock, timers, tweens ---------- */
  let simTime = 0;
  let timers = [];
  let tweens = [];
  const crates = new Set();
  function sleep(s) {
    return new Promise((res) => timers.push({ t: simTime + s, res }));
  }
  function tween(dur, fn) {
    return new Promise((res) => tweens.push({ t0: simTime, dur, fn, res }));
  }
  function moveTo(r, x, z) {
    return new Promise((res) => {
      r.motion = { x, z, res };
    });
  }

  /* ---------- labels ---------- */
  S.forEach((st) => {
    const el = document.createElement('div');
    el.className = 'lab';
    const b = document.createElement('b');
    b.textContent = st.station;
    const sp = document.createElement('span');
    sp.textContent = st.name + ' · waiting';
    const bar = document.createElement('i');
    bar.style.color = st.color;
    const u = document.createElement('u');
    bar.appendChild(u);
    el.appendChild(b);
    el.appendChild(sp);
    el.appendChild(bar);
    labelsEl.appendChild(el);
    st.lab = { el, sp, u, txt: '' };
  });
  R.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'tag';
    el.style.color = r.st.color;
    const dot = document.createElement('s');
    const tx = document.createElement('span');
    tx.textContent = r.st.name;
    el.appendChild(dot);
    el.appendChild(tx);
    labelsEl.appendChild(el);
    r.tag = el;
  });
  const v3 = new THREE.Vector3();
  function place(el, x, y, z, W, H) {
    v3.set(x, y, z).project(camera);
    if (v3.z > 1) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.transform = 'translate(' + ((v3.x * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((-v3.y * 0.5 + 0.5) * H).toFixed(1) + 'px) translate(-50%,-100%)';
  }

  /* ---------- event handlers ---------- */
  function resetStations() {
    S.forEach((st) => {
      st.state = 'idle';
      st.progress = 0;
    });
    R.forEach((r) => {
      r.face = r.faceHome;
    });
  }

  // Waypoints for a robot walking from a's pad to b's pad, staying on the roads and off the
  // other robots. Stations that are neighbours in a row, or share a connector road, walk straight.
  // Anything farther (a revision walking back across the city) cuts through the lane just inside
  // the row and crosses at one of the two connector roads, whichever is shorter.
  function route(a, b) {
    const ax = a.pad.x;
    const az = a.pad.z;
    const bx = b.pad.x;
    const bz = b.pad.z;
    const lane = (z) => z - Math.sign(z) * 1.3;
    if (ax === bx || (az === bz && Math.abs(ax - bx) <= 10.5)) return [];
    if (az === bz) return [[ax, lane(az)], [bx, lane(az)]];
    let best = null;
    [-10, 10].forEach((cx) => {
      const pts = [[cx, lane(az)], [cx, lane(bz)]];
      let len = 0;
      let px = ax;
      let pz = az;
      pts.concat([[bx, bz]]).forEach((p) => {
        len += Math.hypot(p[0] - px, p[1] - pz);
        px = p[0];
        pz = p[1];
      });
      if (!best || len < best.len) best = { len, pts };
    });
    return best.pts;
  }

  async function handoff(i, j) {
    const a = R[i];
    const b = R[j];
    const crate = new THREE.Group();
    crate.add(box(0.5, 0.5, 0.5, lam(S[i].colorHex), 0, 0, 0));
    crate.add(box(0.52, 0.1, 0.52, lam(0xeaf0f8), 0, 0, 0));
    crates.add(crate);
    a.hold.add(crate);
    a.carrying = true;
    const via = route(a, b);
    const from = via.length ? via[via.length - 1] : [a.pad.x, a.pad.z];
    const dx = b.pad.x - from[0];
    const dz = b.pad.z - from[1];
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d;
    const uz = dz / d;
    const path = via.concat([[b.pad.x - ux * 1.9, b.pad.z - uz * 1.9]]);
    b.face = Math.atan2(-ux, -uz);
    for (const p of path) await moveTo(a, p[0], p[1]);
    a.face = Math.atan2(ux, uz);
    await sleep(0.4);
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    a.hold.getWorldPosition(p1);
    b.hold.getWorldPosition(p2);
    a.hold.remove(crate);
    scene.add(crate);
    crate.position.copy(p1);
    a.carrying = false;
    await tween(0.8, (p) => {
      crate.position.lerpVectors(p1, p2, p);
      crate.position.y += Math.sin(Math.PI * p) * 1.1;
      crate.rotation.y = p * 6;
      crate.scale.setScalar(p > 0.8 ? 1 - ((p - 0.8) / 0.2) * 0.9 : 1);
    });
    scene.remove(crate);
    crates.delete(crate);
    const back = via.slice().reverse().concat([[a.pad.x, a.pad.z]]);
    (async () => {
      for (const p of back) await moveTo(a, p[0], p[1]);
      a.face = a.faceHome;
    })();
  }

  async function celebrate(verdict, info) {
    const r = R[R.length - 1];
    r.strike = true;
    r.working = true;
    await sleep(1.6);
    r.working = false;
    r.strike = false;
    if (verdict && verdict.decision === 'SHIP') {
      burst();
      if (onBanner) onBanner({ text: 'SHIPPED', tone: 'good' });
    } else if (verdict && verdict.decision === 'REVISE') {
      // a REVISE verdict only reaches the end of the run when no further round was possible
      const text =
        info && info.reason === 'round_limit'
          ? 'STILL NOT READY AFTER ' + info.rounds + ' ROUNDS'
          : 'COULD NOT ROUTE THE REVISION';
      if (onBanner) onBanner({ text, tone: 'warn' });
    } else if (onBanner) {
      onBanner({ text: 'NO CLEAR VERDICT', tone: 'warn' });
    }
    await sleep(4.5);
    if (onBanner) onBanner(null);
  }

  async function handle(e) {
    switch (e.type) {
      case 'run_start':
        resetStations();
        return;
      case 'agent_start': {
        const i = byId[e.agent];
        if (i === undefined) return;
        S[i].state = 'working';
        S[i].t0 = simTime;
        S[i].progress = 0;
        R[i].face = R[i].faceHome;
        R[i].working = true;
        return;
      }
      case 'agent_done': {
        const i = byId[e.agent];
        if (i === undefined) return;
        const wait = MIN_WORK - (simTime - S[i].t0);
        if (wait > 0) await sleep(wait);
        R[i].working = false;
        S[i].state = 'done';
        S[i].progress = 1;
        return;
      }
      case 'agent_error': {
        const i = byId[e.agent];
        if (i === undefined) return;
        R[i].working = false;
        S[i].state = 'error';
        return;
      }
      case 'handoff': {
        const i = byId[e.from];
        const j = byId[e.to];
        if (i === undefined || j === undefined) return;
        await handoff(i, j);
        return;
      }
      case 'revise': {
        // VISION sends the work back: stations from the target onward go back to waiting,
        // and VISION's robot carries a crate to the target along the roads.
        const from = byId[e.from];
        const to = byId[e.to];
        if (from === undefined || to === undefined) return;
        (e.reset || []).forEach((id) => {
          const k = byId[id];
          if (k === undefined) return;
          S[k].state = 'idle';
          S[k].progress = 0;
          R[k].working = false;
        });
        if (onBanner) onBanner({ text: 'REVISION ROUND ' + e.round + ' OF ' + e.maxRounds, tone: 'warn' });
        await handoff(from, to);
        if (onBanner) onBanner(null);
        return;
      }
      case 'run_end':
        if (e.status === 'complete') await celebrate(e.verdict, e);
        else if (onBanner) {
          onBanner({ text: 'RUN FAILED', tone: 'bad' });
          await sleep(4);
          onBanner(null);
        }
        return;
      default:
    }
  }

  function reset() {
    timers = [];
    tweens = [];
    crates.forEach((c) => scene.remove(c));
    crates.clear();
    R.forEach((r) => {
      r.motion = null;
      r.carrying = false;
      r.working = false;
      r.strike = false;
      while (r.hold.children.length) r.hold.remove(r.hold.children[0]);
      r.root.position.set(r.pad.x, 0, r.pad.z);
      r.face = r.faceHome;
      r.heading = r.faceHome;
      r.root.rotation.y = r.faceHome;
    });
    resetStations();
    confetti.forEach((c) => {
      c.m.visible = false;
    });
    if (onBanner) onBanner(null);
  }

  /* ---------- per-frame updates ---------- */
  function approach(obj, want, ds, k) {
    obj.rotation.x += (want - obj.rotation.x) * Math.min(1, ds * k);
  }
  function updateRobot(r, ds) {
    let moving = false;
    const speed = 4.5;
    if (r.motion) {
      const m = r.motion;
      const dx = m.x - r.root.position.x;
      const dz = m.z - r.root.position.z;
      const d = Math.hypot(dx, dz);
      const step = speed * ds;
      if (d <= step + 1e-4) {
        r.root.position.x = m.x;
        r.root.position.z = m.z;
        const res = m.res;
        r.motion = null;
        res();
      } else {
        r.root.position.x += (dx / d) * step;
        r.root.position.z += (dz / d) * step;
        r.heading = Math.atan2(dx, dz);
        moving = true;
      }
    }
    if (moving) r.phase += ds * 9;
    const target = moving ? r.heading : r.face;
    const diff = ((target - r.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    r.root.rotation.y += diff * Math.min(1, ds * 10);
    const sw = Math.sin(r.phase) * 0.7;
    if (moving) {
      approach(r.legL, sw, ds, 20);
      approach(r.legR, -sw, ds, 20);
    } else {
      approach(r.legL, 0, ds, 10);
      approach(r.legR, 0, ds, 10);
    }
    if (r.carrying) {
      approach(r.armL, -1.25, ds, 12);
      approach(r.armR, -1.25, ds, 12);
    } else if (r.working) {
      const amp = r.strike ? 0.9 : 0.5;
      const fr = r.strike ? 7 : 9;
      approach(r.armR, -1.2 + Math.sin(simTime * fr) * amp, ds, 25);
      approach(r.armL, -0.3, ds, 12);
    } else if (moving) {
      approach(r.armL, -sw * 0.8, ds, 20);
      approach(r.armR, sw * 0.8, ds, 20);
    } else {
      approach(r.armL, 0, ds, 10);
      approach(r.armR, 0, ds, 10);
    }
    r.rig.position.y = r.working ? Math.abs(Math.sin(simTime * 6)) * 0.07 : moving ? Math.abs(Math.sin(r.phase)) * 0.09 : 0;
    const hy = r.working && r.st.kind === 'security' ? Math.sin(simTime * 2.4) * 0.9 : 0;
    r.head.rotation.y += (hy - r.head.rotation.y) * Math.min(1, ds * 10);
  }
  function updateStations() {
    S.forEach((st) => {
      if (st.state === 'working') st.progress = clamp(1 - Math.exp(-(simTime - st.t0) / 5), 0, 0.92);
      const failed = st.state === 'error';
      const want = st.state === 'working' ? 0.95 : st.state === 'done' ? 0.6 : failed ? 0.9 : 0.28;
      st.ringMat.opacity += (want - st.ringMat.opacity) * 0.15;
      const col = failed ? ERROR_COLOR : st.colorHex;
      st.ringMat.color.setHex(col);
      st.beaconMat.color.setHex(col);
      st.doorMat.color.setHex(col);
      st.beacon.scale.setScalar(st.state === 'working' ? 1 + Math.sin(simTime * 8) * 0.25 : 1);
      st.roofMat.emissiveIntensity = st.state === 'working' ? 0.55 : st.state === 'done' ? 0.3 : 0.18;
      const label = st.state === 'working' ? Math.round(st.progress * 100) + '%' : st.state === 'done' ? 'done' : failed ? 'failed' : 'waiting';
      const txt = st.name + ' · ' + label;
      if (st.lab.txt !== txt) {
        st.lab.txt = txt;
        st.lab.sp.textContent = txt;
        st.lab.u.style.width = Math.round(st.progress * 100) + '%';
      }
    });
  }
  function updateCars(ds) {
    cars.forEach((c) => {
      c.s += c.v * ds;
      const p = lanePoint(c.s);
      c.g.position.set(p.x, 0, p.z);
      c.g.rotation.y = p.h;
    });
  }
  function updateConfetti(ds) {
    confetti.forEach((c) => {
      if (!c.m.visible) return;
      c.vy -= 9 * ds;
      c.m.position.x += c.vx * ds;
      c.m.position.y += c.vy * ds;
      c.m.position.z += c.vz * ds;
      c.m.rotation.x += ds * 6;
      c.m.rotation.z += ds * 5;
      if (c.m.position.y < 0.1) {
        c.m.position.y = 0.1;
        c.vx *= 0.9;
        c.vz *= 0.9;
        c.vy = 0;
      }
      c.life -= ds;
      if (c.life <= 0) c.m.visible = false;
    });
  }

  /* ---------- camera orbit ---------- */
  const view = { az: 0.28, pol: 0.95, dist: 44 };
  function homeDist() {
    const a = stage.clientWidth / Math.max(1, stage.clientHeight);
    return a > 1.5 ? 42 : a > 1 ? 50 : 68;
  }
  function applyCam() {
    const s = Math.sin(view.pol);
    camera.position.set(view.dist * s * Math.sin(view.az), view.dist * Math.cos(view.pol), view.dist * s * Math.cos(view.az));
    camera.lookAt(0, 0.5, 0);
  }
  const ptrs = new Map();
  let pinch = 0;
  function pdist() {
    const a = Array.from(ptrs.values());
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1;
  }
  function onDown(e) {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) pinch = pdist();
  }
  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (ptrs.size === 1) {
      view.az -= dx * 0.006;
      view.pol = clamp(view.pol - dy * 0.005, 0.3, 1.4);
    } else if (ptrs.size === 2) {
      const d = pdist();
      view.dist = clamp((view.dist * pinch) / d, 14, 95);
      pinch = d;
    }
  }
  function onUp(e) {
    ptrs.delete(e.pointerId);
  }
  function onWheel(e) {
    e.preventDefault();
    view.dist = clamp(view.dist * (1 + Math.sign(e.deltaY) * 0.08), 14, 95);
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  function resize() {
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / Math.max(1, H);
    camera.updateProjectionMatrix();
  }
  let ro = null;
  if (window.ResizeObserver) {
    ro = new ResizeObserver(resize);
    ro.observe(stage);
  } else {
    window.addEventListener('resize', resize);
  }
  resize();
  view.dist = homeDist();

  /* ---------- main loop ---------- */
  let last = performance.now();
  let raf = 0;
  let alive = true;
  function frame(now) {
    if (!alive) return;
    // cap a single step so a hidden tab does not jump, but allow slow frames to keep real time
    const ds = Math.min(0.25, (now - last) / 1000);
    last = now;
    simTime += ds;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].t <= simTime) {
        const t = timers.splice(i, 1)[0];
        t.res();
      }
    }
    for (let j = tweens.length - 1; j >= 0; j--) {
      const tw = tweens[j];
      const p = clamp((simTime - tw.t0) / tw.dur, 0, 1);
      tw.fn(p);
      if (p >= 1) {
        tweens.splice(j, 1);
        tw.res();
      }
    }
    R.forEach((r) => updateRobot(r, ds));
    updateStations();
    updateCars(ds);
    updateConfetti(ds);
    applyCam();
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    S.forEach((st) => place(st.lab.el, st.bld[0], st.h + 2.0, st.bld[1], W, H));
    R.forEach((r) => place(r.tag, r.root.position.x, 3.3, r.root.position.z, W, H));
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    handle,
    reset,
    resetView() {
      view.az = 0.28;
      view.pol = 0.95;
      view.dist = homeDist();
    },
    dispose() {
      alive = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
      while (labelsEl.firstChild) labelsEl.removeChild(labelsEl.firstChild);
      renderer.dispose();
    },
  };
}
