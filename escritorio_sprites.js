/* Escritório do Kairos: sprites dos móveis "assados" a partir dos modelos 3D do Kenney (CC0).
   Na primeira visita o Three.js roda UMA vez: carrega os modelos, fotografa cada móvel do mesmo ângulo isométrico 2:1 do escritório e guarda as imagens
   no navegador (localStorage). Nas visitas seguintes as imagens vêm do cache em ~100 ms, sem baixar o Three.js nem os modelos 3D.
   Depois disso o painel só desenha imagens em 2D (leve). Se algo falhar, o escritório segue com os desenhos procedurais. */
(function () {
  'use strict';
  const SS = 1.5, FS = 1.0, PX = 32 / Math.SQRT1_2 * SS;   // 1 casa = 2 m; PX = pixels (com supersample) por unidade do modelo no eixo horizontal da tela
  const FURN = n => `/assets3d/furniture/Models/GLTF%20format/${n}.glb`;
  const deskParts = w => [{ n: 'desk', sx: w / (0.73 * FS), sz: 0.45 / (0.39 * FS) }, { n: 'computerKeyboard', dz: 0.06, dx: -w * 0.1, y: 0.38, s: 1.0 }, { n: 'computerMouse', dz: 0.06, dx: w * 0.2, y: 0.38, s: 1.0 }];
  const FURN_DEFS = {
    desk09: deskParts(0.8), desk15: deskParts(1.5), desk18: deskParts(1.8), desk26: deskParts(2.6),
    chair: [{ n: 'chairDesk', s: 0.78 }], plant: [{ n: 'pottedPlant', s: 0.95 }], plantS: [{ n: 'pottedPlant', s: 0.8 }],
    sofa: [{ n: 'loungeSofaLong', s: 1.0, rot: Math.PI }], sofaF: [{ n: 'loungeSofaLong', s: 1.0 }], coffeeTable: [{ n: 'tableCoffee', s: 0.95 }],
    tv: [{ n: 'cabinetTelevision', s: 1.0 }, { n: 'televisionModern', y: 0.38, s: 0.85 }], bookcase: [{ n: 'bookcaseOpen', s: 1.4, sy: 1.1 }], bookcaseW: [{ n: 'bookcaseClosedWide', s: 1.1 }],
    lamp: [{ n: 'lampRoundFloor', s: 0.95 }], rack: [{ n: 'coatRackStanding', s: 1.0 }], trash: [{ n: 'trashcan', s: 0.65 }], coffee: [{ n: 'sideTable', s: 1.0 }, { n: 'kitchenCoffeeMachine', y: 0.36, s: 1.0 }],
    meet: [{ n: 'table', sx: 3.9, sz: 1.5 }]
  };
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const KEY = 'ofSprites:' + hash(JSON.stringify(FURN_DEFS) + SS + 'v4');
  const api = { ready: false, progress: 0, SS, furn: {}, chars: {}, nChars: 0, error: null, fromCache: false, char() { return undefined; } };
  window.OfficeSprites = api;
  const done = () => { api.ready = true; api.progress = 1; if (window.Office && window.Office.spritesReady) window.Office.spritesReady(); };

  async function fromCache() {   // imagens já assadas numa visita anterior
    let raw = null; try { raw = localStorage.getItem(KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      const obj = JSON.parse(raw), names = Object.keys(FURN_DEFS);
      if (!names.every(k => obj[k])) return false;
      await Promise.all(names.map(k => new Promise((res, rej) => { const img = new Image(); img.onload = () => { api.furn[k] = { c: img, ax: obj[k].ax, ay: obj[k].ay, w: obj[k].w, h: obj[k].h }; res(); }; img.onerror = rej; img.src = obj[k].u; })));
      return true;
    } catch (e) { api.furn = {}; return false; }
  }

  async function bake() {   // primeira visita: carrega o Three.js e os modelos (em paralelo) e fotografa
    const THREE = await import('three'), { GLTFLoader } = await import('/assets3d/vendor/three/loaders/GLTFLoader.js');
    const loader = new GLTFLoader(), cache = new Map(), load = u => { if (!cache.has(u)) cache.set(u, loader.loadAsync(u)); return cache.get(u); };
    const names = [...new Set(Object.values(FURN_DEFS).flat().map(p => p.n))]; await Promise.all(names.map(n => load(FURN(n))));
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene(), hemi = new THREE.HemisphereLight(0xe6efff, 0x6a5a50, 1.7), sun = new THREE.DirectionalLight(0xfff1d6, 2.2); sun.position.set(7, 11, 3); scene.add(hemi, sun);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200), dir = new THREE.Vector3(Math.cos(Math.PI / 6) * Math.SQRT1_2, 0.5, Math.cos(Math.PI / 6) * Math.SQRT1_2).multiplyScalar(60);
    cam.position.copy(dir); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const shoot = (obj, ext) => { const w = Math.ceil(ext.l + ext.r), h = Math.ceil(ext.t + ext.b); renderer.setSize(w, h, false); cam.left = -ext.l / PX; cam.right = ext.r / PX; cam.top = ext.t / PX; cam.bottom = -ext.b / PX; cam.updateProjectionMatrix();
      scene.add(obj); renderer.render(scene, cam); scene.remove(obj); const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(renderer.domElement, 0, 0); return { c, ax: ext.l, ay: ext.t, w, h }; };
    const extentOf = (obj, pad = 3) => { obj.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(obj), inv = cam.matrixWorldInverse; let l = 0, r = 0, t = 0, bt = 0;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) { const v = new THREE.Vector3(x, y, z).applyMatrix4(inv); l = Math.max(l, -v.x * PX); r = Math.max(r, v.x * PX); t = Math.max(t, v.y * PX); bt = Math.max(bt, -v.y * PX); }
      return { l: l + pad, r: r + pad, t: t + pad, b: bt + pad }; };
    const part = async (n, o = {}) => { const g = (await load(FURN(n))).scene.clone(true), s = (o.s || 1) * FS, wrap = new THREE.Group(); g.scale.set(s * (o.sx || 1), s * (o.sy || 1), s * (o.sz || 1));
      const b = new THREE.Box3().setFromObject(g), c = b.getCenter(new THREE.Vector3()); g.position.set(-c.x, -b.min.y, -c.z); wrap.add(g); wrap.position.set(o.dx || 0, o.y || 0, o.dz || 0); wrap.rotation.y = o.rot || 0; return wrap; };
    const store = {};
    for (const k of Object.keys(FURN_DEFS)) {
      const g = new THREE.Group(); for (const p of FURN_DEFS[k]) g.add(await part(p.n, p)); const s = shoot(g, extentOf(g)); api.furn[k] = s; store[k] = { u: s.c.toDataURL('image/png'), ax: s.ax, ay: s.ay, w: s.w, h: s.h };
    }
    renderer.dispose(); renderer.forceContextLoss();
    try { Object.keys(localStorage).filter(x => x.startsWith('ofSprites:') && x !== KEY).forEach(x => localStorage.removeItem(x)); localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* sem espaço: só não guarda */ }
  }

  (async () => {
    try { if (await fromCache()) { api.fromCache = true; done(); return; } await bake(); done(); }
    catch (e) { api.error = String(e); console.warn('Sprites 3D indisponíveis, seguindo com os desenhos 2D:', e); }
  })();
})();
