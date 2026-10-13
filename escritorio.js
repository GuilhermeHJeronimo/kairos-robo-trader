/* Escritório do Kairos: o painel como um jogo (v4, escritório ampliado).
   Cada indicador é um analista na sua mesa, cada posição aberta tem um trader (até 4 por ativo), a diretoria cuida de macro, notícias, risco e cérebro,
   quem fechou operação hoje relaxa na sala de jogos, e a equipe anda pelos corredores sem atravessar mesas nem uns aos outros.
   Só lê dados que o painel já tem (/api/robot, /api/robots, /api/robot/diary): não envia comando nenhum. */
(function () {
  'use strict';
  const SYMS = [
    { sym: 'XAUUSDm', name: 'Ouro', icon: '🥇', col: '#e8b64c', rowY: [4.6, 6.9] },
    { sym: 'BTCUSDm', name: 'Bitcoin', icon: '₿', col: '#f7931a', rowY: [10.3, 12.6] }
  ];
  const IND = [['estrutura a favor', 'Estrut.'], ['hierarquia forte', 'Hierarq.'], ['medias moveis 21/50', 'Médias'], ['RSI 14', 'RSI'], ['MACD 12/26/9', 'MACD'],
    ['VWAP do dia', 'VWAP'], ['perfil de volume', 'Perfil'], ['liquidez varrida', 'Liquid.'], ['volume acima da media', 'Volume'], ['volatilidade (ATR)', 'ATR'],
    ['padrao de vela', 'Vela'], ['sentimento a favor', 'Sentim.'], ['surpresa da agenda economica', 'Agenda'], ['gap nao preenchido', 'Gap']];
  const W = 1560, H = 980, HW = 32, HH = 16, OX = 636, OY = 152, WALL = 124, SLOTS = 4, GX = 27, GY = 21;
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  function sky() { const h = new Date().getHours() + new Date().getMinutes() / 60; if (h >= 6 && h < 17) return ['#3f7fd0', '#a8d6ff', 0.55]; if (h >= 17 && h < 19) return ['#35306b', '#e58a5c', 0.4]; if (h >= 19 || h < 5) return ['#050a18', '#14264d', 0.0]; return ['#1c2450', '#d98a6a', 0.2]; }
  const UP = '#2ebd85', DN = '#f6465d', NEU = '#5b677a';
  const cv = document.getElementById('ofCanvas'), ctx = cv.getContext('2d');
  let showLabels = true; try { showLabels = localStorage.getItem('ofLabels') !== '0'; } catch (e) { /* sem armazenamento */ }
  let OV = null, view = { z: 1, x: 0, y: 0 }, HEADLESS = false, lastSeen = {}, ambientT = 5, motes = [], timer = null, data = {}, robots = [], diary = null, running = false, T = 0, last = 0, parts = [], seen = null, hits = [], hud = {}, flash = 0, flashCol = UP, banner = null, labelQ = [];

  const P = (x, y, z) => [OX + (x - y) * HW, OY + (x + y) * HH - (z || 0)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const money = v => (v > 0 ? '+$' : v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function shade(hex, f) { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))); return `rgb(${c[0]},${c[1]},${c[2]})`; }
  function poly(pts, fill, stroke) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); } }
  function box(x, y, z, w, d, h, c) {
    poly([P(x, y, z + h), P(x + w, y, z + h), P(x + w, y + d, z + h), P(x, y + d, z + h)], shade(c, 1.25));
    poly([P(x, y + d, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x, y + d, z + h)], shade(c, 0.78));
    poly([P(x + w, y, z), P(x + w, y + d, z), P(x + w, y + d, z + h), P(x + w, y, z + h)], shade(c, 0.58));
    ctx.strokeStyle = 'rgba(0,0,0,.32)'; ctx.lineWidth = 0.8; ctx.beginPath(); const a = P(x, y + d, z + h), b = P(x + w, y + d, z + h), c2 = P(x + w, y, z + h), e = P(x + w, y + d, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c2[0], c2[1]); ctx.moveTo(b[0], b[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
  }
  function wallPlane(kind, x0) { return kind === 'y' ? [1, 0.5, 0, -1, OX, OY] : [-1, 0.5, 0, -1, OX + x0 * HW, OY + x0 * HH]; }
  function wt(text, x, y, col, font, align, mirror) { ctx.save(); ctx.translate(x, y); ctx.scale(mirror ? -1 : 1, -1); ctx.fillStyle = col; ctx.font = font; ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, 0, 0); ctx.restore(); }

  /* ---------- sprites assados dos modelos 3D (escritorio_sprites.js); sem eles, tudo cai nos desenhos procedurais ---------- */
  const SP = () => (window.OfficeSprites && window.OfficeSprites.ready) ? window.OfficeSprites : null;
  function drawSpr(s, sx, sy) { const k = SP().SS; ctx.drawImage(s.c, sx - s.ax / k, sy - s.ay / k, s.w / k, s.h / k); }
  function furnSpr(key, x, y, shadow) { const sp = SP(), s = sp && sp.furn[key]; if (!s) return false; const p = P(x, y, 0); if (shadow) { ctx.fillStyle = 'rgba(0,0,0,.26)'; ctx.beginPath(); ctx.ellipse(p[0] + 2, p[1] + 3, shadow, shadow * 0.45, 0, 0, 7); ctx.fill(); } drawSpr(s, p[0], p[1]); return true; }
  function charSpr(o, walking, f) {   // escolhe a imagem do personagem pela animação, direção (0:+x 1:-x 2:+y 3:-y) e quadro
    const sp = SP(); if (!sp || o.ci == null) return null; let dir = o.dir != null ? o.dir : (o.sit ? 2 : f > 0 ? 0 : 1), anim = 'idle', fr = Math.floor(T * 2 + (o.ph || 0)) % 4;
    if (walking) { anim = 'walk'; fr = Math.floor(((o.wp || 0) / 6.2832) * 8) % 8; if (fr < 0) fr += 8; }
    else if (o.paddle) { anim = 'interact-right'; fr = Math.floor(T * 7 + (o.ph || 0)) % 6; dir = f > 0 ? 0 : 1; }
    else if (o.emo) { anim = o.mood > 0 ? 'emote-yes' : 'emote-no'; fr = Math.floor(T * 7 + (o.ph || 0)) % 6; dir = 2; }
    else if (o.sit) { anim = 'sit'; fr = 0; }
    return sp.char(o.ci, anim, dir, fr) || sp.char(o.ci, 'idle', 2, 0);
  }

  /* ---------- rótulos sem sobreposição: tudo passa por aqui e se acomoda sozinho ---------- */
  function tag(prio, sx, sy, text, col, size, opt) { if (!showLabels && prio < 9) return; labelQ.push({ prio, sx, sy, text, col, size: size || 10, plain: opt && opt.plain, bg: opt && opt.bg }); }
  function flushTags() {
    const placed = [];
    labelQ.sort((a, b) => b.prio - a.prio).forEach(l => {
      ctx.font = `700 ${l.size}px system-ui,Segoe UI,sans-serif`;
      const w = ctx.measureText(l.text).width + (l.plain ? 4 : 14), h = l.size + (l.plain ? 4 : 8);
      let y = l.sy, ok = false;
      for (let t = 0; t < 5 && !ok; t++) { const r = { x: l.sx - w / 2, y: y - h / 2, w, h }; if (!placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y)) { ok = true; placed.push(r); } else y -= h + 2; }
      if (!ok) { if (l.prio < 9) return; y = l.sy; }
      if (l.plain) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.roundRect(l.sx - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.fillStyle = l.col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(l.text, l.sx, y + 0.5); }
      else { ctx.fillStyle = l.bg || 'rgba(8,12,18,.88)'; ctx.strokeStyle = l.col; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.roundRect(l.sx - w / 2, y - h / 2, w, h, h / 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = l.col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(l.text, l.sx, y + 0.5); }
    });
    labelQ = [];
  }

  /* ---------- personagem ---------- */
  function person(x, y, z, o) {
    const p = P(x, y, z), sx = p[0], base = p[1], walking = !!o.walk, f = o.face || 1, wp = o.wp || 0;
    const bob = walking ? Math.abs(Math.sin(wp)) * 2.2 : Math.sin(T * 2.2 + (o.ph || 0)) * (o.mood > 0 ? 1.8 : 0.9), sy = walking ? base - bob : base + bob;
    const spr = charSpr(o, walking, f);
    if (spr) {
      ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.beginPath(); ctx.ellipse(sx, base, 9.5, 4, 0, 0, 7); ctx.fill();
      drawSpr(spr, sx, walking ? base - Math.abs(Math.sin(wp)) * 1.2 : base);
      const cf = (o.dir === 0 || o.dir === 3) ? 1 : (o.dir != null ? -1 : f), hy0 = (walking ? base - 15 : base - 17);
      if (o.carry === 'coffee') { const hx = sx + 9 * cf; ctx.fillStyle = '#f2f4f8'; ctx.fillRect(hx - 2.5, hy0 - 5, 5, 6); ctx.fillStyle = '#6b4a2b'; ctx.fillRect(hx - 2.5, hy0 - 5, 5, 1.6); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx - 1, hy0 - 7); ctx.quadraticCurveTo(hx - 3, hy0 - 10 - Math.sin(T * 4) * 1.5, hx, hy0 - 13); ctx.stroke(); }
      if (o.carry === 'paper') { const hx = sx + 9 * cf; ctx.save(); ctx.translate(hx, hy0); ctx.rotate(-0.15 * cf); ctx.fillStyle = '#f7f9fc'; ctx.fillRect(-4.5, -9, 9, 11); ctx.fillStyle = '#9fb0c8'; ctx.fillRect(-3, -7, 6, 1); ctx.fillRect(-3, -4.5, 6, 1); ctx.fillRect(-3, -2, 4, 1); ctx.restore(); }
      if (o.mood < 0 && !walking) { ctx.fillStyle = '#6cc4ff'; ctx.beginPath(); ctx.ellipse(sx + 8.5, base - 38 + (T * 6 % 5), 1.6, 2.4, 0, 0, 7); ctx.fill(); }
      if (o.mood > 0 && !walking && Math.sin(T * 3 + (o.ph || 0)) > 0.7) { ctx.fillStyle = '#e8b64c'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', sx + 12, base - 44 - (T * 20 % 8)); }
      return [sx, base - 42];
    }
    ctx.fillStyle = 'rgba(0,0,0,.38)'; ctx.beginPath(); ctx.ellipse(sx, base, 9.5, 4, 0, 0, 7); ctx.fill();
    if (!o.sit) {
      const sw = walking ? Math.sin(wp) * 4.5 : 0;
      ctx.lineCap = 'round'; ctx.strokeStyle = o.pants || '#2a3042'; ctx.lineWidth = 3.6;
      ctx.beginPath(); ctx.moveTo(sx - 2.4, sy - 9); ctx.lineTo(sx - 2.4 + sw * f, sy - 1.5); ctx.moveTo(sx + 2.4, sy - 9); ctx.lineTo(sx + 2.4 - sw * f, sy - 1.5); ctx.stroke();
      ctx.fillStyle = '#10131a'; ctx.fillRect(sx - 4.6 + sw * f, sy - 2, 4.4, 2.2); ctx.fillRect(sx + 0.4 - sw * f, sy - 2, 4.4, 2.2);
    }
    const armUp = o.mood > 0 && !walking ? Math.sin(T * 6 + (o.ph || 0)) * 3 + 9 : 0, asw = walking ? Math.sin(wp) * 5 : 0, typ = o.sit && !o.noType ? Math.sin(T * 14 + (o.ph || 0) * 3) * 1.4 : 0;
    ctx.strokeStyle = o.skin; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath();
    ctx.moveTo(sx - 6, sy - 18); ctx.lineTo(sx - 9 + (o.sit ? 3 : 0), sy - 11 - armUp + asw + (o.sit ? 2 + typ : 0));
    if (o.carry) { ctx.moveTo(sx + 6, sy - 18); ctx.lineTo(sx + 10 * f, sy - 17); }
    else if (o.paddle) { ctx.moveTo(sx + 6, sy - 18); ctx.lineTo(sx + 11, sy - 15 - (o.swing != null ? (o.swing * 2 - 1) * 5 : Math.sin(T * 5 + (o.ph || 0)) * 5)); }
    else { ctx.moveTo(sx + 6, sy - 18); ctx.lineTo(sx + 9 - (o.sit ? 3 : 0), sy - 11 - (o.mood > 0 && !walking ? 3 : 0) - asw + (o.sit ? 2 - typ : 0)); }
    ctx.stroke();
    if (o.carry === 'coffee') { const hx = sx + 10 * f, hy = sy - 18; ctx.fillStyle = '#f2f4f8'; ctx.fillRect(hx - 2.5, hy - 5, 5, 6); ctx.fillStyle = '#6b4a2b'; ctx.fillRect(hx - 2.5, hy - 5, 5, 1.6); ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx - 1, hy - 7); ctx.quadraticCurveTo(hx - 3, hy - 10 - Math.sin(T * 4) * 1.5, hx, hy - 13); ctx.stroke(); }
    if (o.carry === 'paper') { const hx = sx + 10 * f, hy = sy - 19; ctx.save(); ctx.translate(hx, hy); ctx.rotate(-0.15 * f); ctx.fillStyle = '#f7f9fc'; ctx.fillRect(-4.5, -9, 9, 11); ctx.fillStyle = '#9fb0c8'; ctx.fillRect(-3, -7, 6, 1); ctx.fillRect(-3, -4.5, 6, 1); ctx.fillRect(-3, -2, 4, 1); ctx.restore(); }
    if (o.cue) { const hx = sx + 11, hy = sy - 15, k = o.cue; ctx.strokeStyle = '#d8b878'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(hx - k.dx * k.pull, hy - k.dy * k.pull); ctx.lineTo(hx + k.dx * 27, hy + k.dy * 27); ctx.stroke(); ctx.fillStyle = '#7a4b2b'; ctx.beginPath(); ctx.arc(hx - k.dx * k.pull, hy - k.dy * k.pull, 1.8, 0, 7); ctx.fill(); }
    if (o.paddle && !o.cue) { const hx = sx + 11, hy = sy - 15 - (o.swing != null ? (o.swing * 2 - 1) * 5 : Math.sin(T * 5 + (o.ph || 0)) * 5); ctx.fillStyle = '#d63f3f'; ctx.beginPath(); ctx.arc(hx + 2, hy - 3, 3.6, 0, 7); ctx.fill(); }
    ctx.fillStyle = o.shirt; ctx.beginPath(); ctx.roundRect(sx - 6.5, sy - 23, 13, 16, 4); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(sx + (f > 0 ? 1.5 : -6.5), sy - 23, 5, 16);
    if (o.tie) { ctx.fillStyle = o.tie; ctx.beginPath(); ctx.moveTo(sx, sy - 22); ctx.lineTo(sx + 2, sy - 18); ctx.lineTo(sx, sy - 12); ctx.lineTo(sx - 2, sy - 18); ctx.closePath(); ctx.fill(); }
    if (o.badge) { ctx.fillStyle = '#e8edf5'; ctx.fillRect(sx - 5 + (f > 0 ? 6 : 0), sy - 18, 3, 4); }
    ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(sx, sy - 29, 6.6, 0, 7); ctx.fill();
    ctx.fillStyle = o.hair; ctx.beginPath();
    if ((o.style || 0) % 3 === 1) { ctx.arc(sx, sy - 30.5, 7, Math.PI * 0.92, Math.PI * 2.08); ctx.fill(); ctx.fillRect(sx - 7, sy - 31, 3, 9); ctx.fillRect(sx + 4, sy - 31, 3, 9); }
    else if ((o.style || 0) % 3 === 2) { ctx.arc(sx, sy - 30.5, 6.9, Math.PI, 0); ctx.fill(); ctx.fillRect(sx - 7.4, sy - 31.5, 14.8, 2.4); }
    else { ctx.arc(sx, sy - 30.5, 6.8, Math.PI, 0); ctx.fill(); }
    if (o.cap) { ctx.fillStyle = o.cap; ctx.beginPath(); ctx.arc(sx, sy - 31, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(sx - 7 + (f > 0 ? 2 : -6), sy - 31.5, 11, 2); }
    const ex = f * 1.4;
    ctx.fillStyle = '#1a1f2b'; ctx.fillRect(sx - 3.3 + ex, sy - 29, 1.8, 1.8); ctx.fillRect(sx + 1.5 + ex, sy - 29, 1.8, 1.8);
    if (o.glasses) { ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 1; ctx.strokeRect(sx - 4.4 + ex, sy - 30.4, 3.8, 3.6); ctx.strokeRect(sx + 0.6 + ex, sy - 30.4, 3.8, 3.6); }
    ctx.strokeStyle = '#3a2a2a'; ctx.lineWidth = 1.2; ctx.beginPath();
    if (o.mood > 0) ctx.arc(sx + ex, sy - 27.2, 2.6, 0.15, Math.PI - 0.15); else if (o.mood < 0) ctx.arc(sx + ex, sy - 24.2, 2.6, Math.PI + 0.3, -0.3); else { ctx.moveTo(sx - 2 + ex, sy - 25.5); ctx.lineTo(sx + 2 + ex, sy - 25.5); }
    ctx.stroke();
    if (o.mood < 0) { ctx.fillStyle = '#6cc4ff'; ctx.beginPath(); ctx.ellipse(sx + 8.5, sy - 33 + (T * 6 % 5), 1.6, 2.4, 0, 0, 7); ctx.fill(); }
    if (o.mood > 0 && !walking && Math.sin(T * 3 + (o.ph || 0)) > 0.7) { ctx.fillStyle = '#e8b64c'; ctx.font = '700 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('$', sx + 12, sy - 40 - (T * 20 % 8)); }
    return [sx, sy - 38];
  }
  function chair(x, y, col) {
    if (SP() && furnSpr('chair', x, y, 9)) return;
    const p = P(x, y, 0), sx = p[0], b = p[1];
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(sx, b + 1, 9, 3.6, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = '#11151d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, b - 2); ctx.lineTo(sx, b - 8); ctx.stroke();
    ctx.fillStyle = shade(col || '#2b3550', 0.8); ctx.beginPath(); ctx.roundRect(sx - 7.5, b - 29, 15, 17, 5); ctx.fill();
    ctx.fillStyle = col || '#2b3550'; ctx.beginPath(); ctx.ellipse(sx, b - 8, 8.5, 3.6, 0, 0, 7); ctx.fill();
  }
  const SHIRTS = ['#7b6cf6', '#e86aa6', '#f59e42', '#3ec1d3', '#8bd450', '#e8b64c', '#5b9dff', '#ef6f6c'], SKINS = ['#f1c9a5', '#d9a07a', '#a96f4b', '#7a4b32', '#f4d7b8'], HAIR = ['#2b2118', '#5a3b22', '#1b1b1f', '#c8963e', '#7a2d2d'], PANTS = ['#2a3042', '#3a3148', '#26343f', '#3b3b3b'];
  const pick = (arr, i) => arr[Math.abs(Math.floor(i)) % arr.length];
  const looks = i => ({ ci: i * 5 + 2, shirt: pick(SHIRTS, i), skin: pick(SKINS, i * 3 + 1), hair: pick(HAIR, i * 2 + 1), pants: pick(PANTS, i), style: i + (i >> 2), glasses: i % 5 === 2 });

  /* ---------- corredores e gente andando ---------- */
  // Os corredores ficam entre as mesas: quem anda só segue estas linhas, então não atravessa móveis.
  const NODES = { a: [0.6, 3.4], t1: [7.0, 3.4], b: [14.6, 3.4], t2: [18.2, 3.4], c: [21.6, 3.4], d: [25.6, 3.4], e: [0.6, 9.0], m1: [7.0, 9.0], f: [14.6, 9.0], m2: [18.2, 9.0], g: [21.6, 9.0], h: [25.2, 9.0],
    i: [0.6, 14.7], b1: [7.0, 14.7], meetOut: [13.2, 14.7], j: [14.6, 14.7], b2: [18.2, 14.7], k: [21.6, 14.7], f1: [14.6, 5.4], f2: [14.6, 7.6], j1: [14.6, 10.9], j2: [14.6, 13.0],
    coffee: [25.6, 8.2], cooler: [19.0, 2.7], board: [23.6, 2.0], recep: [4.4, 15.6], meetDoor: [13.2, 15.7], meetIn: [13.4, 17.2] };
  const EDGES = [['a', 't1'], ['t1', 'b'], ['b', 't2'], ['t2', 'c'], ['c', 'd'], ['e', 'm1'], ['m1', 'f'], ['f', 'm2'], ['m2', 'g'], ['g', 'h'], ['i', 'b1'], ['b1', 'meetOut'], ['meetOut', 'j'], ['j', 'b2'], ['b2', 'k'], ['a', 'e'], ['e', 'i'],
    ['b', 'f1'], ['f1', 'f2'], ['f2', 'f'], ['f', 'j1'], ['j1', 'j2'], ['j2', 'j'], ['c', 'g'], ['g', 'k'], ['h', 'coffee'], ['t2', 'cooler'], ['c', 'board'], ['b1', 'recep'], ['meetOut', 'meetDoor'], ['meetDoor', 'meetIn']];
  const ADJ = {}; Object.keys(NODES).forEach(k => { ADJ[k] = []; });
  EDGES.forEach(([p, q]) => { const d = Math.hypot(NODES[p][0] - NODES[q][0], NODES[p][1] - NODES[q][1]); ADJ[p].push([q, d]); ADJ[q].push([p, d]); });
  function route(from, to) {
    const dist = {}, prev = {}, todo = new Set(Object.keys(NODES)); todo.forEach(k => { dist[k] = Infinity; }); dist[from] = 0;
    while (todo.size) { let u = null; todo.forEach(k => { if (u === null || dist[k] < dist[u]) u = k; }); if (u === to || dist[u] === Infinity) break; todo.delete(u); ADJ[u].forEach(([v, d]) => { if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; } }); }
    const path = [to]; let c = to; while (c !== from && prev[c]) { c = prev[c]; path.unshift(c); } return path;
  }
  const WALKERS = [
    { name: 'Estagiário', ci: 3, desc: 'busca café e leva para as mesas', look: { shirt: '#f59e42', skin: '#d9a07a', hair: '#2b2118', pants: '#2a3042', style: 2 }, pois: ['coffee', 'f1', 'coffee', 'j1', 'cooler', 'f2', 'j2'], speed: 1.5, carry: 'coffee', at: 'coffee' },
    { name: 'Gerente', ci: 6, desc: 'faz a ronda pelas mesas e anota no quadro', look: { shirt: '#e8edf5', skin: '#f1c9a5', hair: '#5a3b22', pants: '#1b1f2b', style: 0, tie: '#f6465d', glasses: true, badge: true }, pois: ['board', 'f1', 'meetIn', 't1', 'j1', 'b1', 'meetIn', 'board', 'cooler', 'f2'], speed: 1.1, at: 'board' },
    { name: 'Analista em pausa', ci: 1, desc: 'esticando as pernas entre uma análise e outra', look: { shirt: '#3ec1d3', skin: '#7a4b32', hair: '#1b1b1f', pants: '#3a3148', style: 1 }, pois: ['cooler', 'm1', 'g', 'coffee', 'e', 'b2'], speed: 1.25, at: 'm1' },
    { name: 'Estagiária', ci: 9, desc: 'entrega documentos', look: { shirt: '#e86aa6', skin: '#f4d7b8', hair: '#c8963e', pants: '#26343f', style: 1, glasses: true }, pois: ['a', 'board', 'j', 'f2', 't2', 'cooler'], speed: 1.35, carry: 'paper', at: 'a' },
    { name: 'Suporte de TI', ci: 7, desc: 'confere os computadores das mesas', look: { shirt: '#5b9dff', skin: '#a96f4b', hair: '#1b1b1f', pants: '#3b3b3b', style: 0, cap: '#1d3a6e', badge: true }, pois: ['j1', 'm1', 'b1', 'f1', 'e', 'j2'], speed: 1.2, at: 'e' },
    { name: 'Visitante', ci: 4, desc: 'veio conhecer o escritório', look: { shirt: '#2a3042', skin: '#f1c9a5', hair: '#7a2d2d', pants: '#1b1f2b', style: 1, tie: '#e8b64c' }, pois: ['recep', 'g', 'board', 'coffee', 'recep', 'c'], speed: 1.05, at: 'recep' }
  ];
  let walkers = [], couriers = [], cid = 0;
  function initWalkers() { walkers = WALKERS.map((cfg, i) => ({ id: i, cfg, x: NODES[cfg.at][0], y: NODES[cfg.at][1], ox: 0, oy: 0, at: cfg.at, path: [], pi: 0, idle: 0.5 + i * 1.3, wp: i * 2, face: 1, emote: null, carryNow: null, dest: null, wait: 0, free: 0 })); }
  function arrive(w) {
    const cfg = w.cfg || {}, d = w.dest;
    if (w.courier) { w.idle = 2.6; w.emote = '📄'; w.phase = 'wait'; for (let i = 0; i < 10 && !RM; i++) { const q = P(w.x, w.y, 30); parts.push({ x: q[0], y: q[1], vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3, life: 1, c: '#f7f9fc', s: 3, coin: false }); } return; }
    if (d === 'coffee') { w.idle = 3.5; w.emote = '☕'; if (cfg.carry === 'coffee') w.carryNow = 'coffee'; }
    else if (d === 'cooler') { w.idle = 3; w.emote = '💧'; }
    else if (d === 'board') { w.idle = 4.5; w.emote = '💡'; }
    else if (d === 'recep') { w.idle = 3.5; w.emote = '👋'; }
    else if (d === 'meetIn') { w.idle = 6; w.emote = '🗓️'; }
    else if (d === 'f1' || d === 'f2' || d === 'j1' || d === 'j2') { w.idle = 3.2; w.emote = '💬'; if (cfg.carry === 'coffee') w.carryNow = null; }
    else w.idle = 1.5 + Math.random() * 2;
    if (cfg.carry === 'paper') w.carryNow = (d === 'board' || d === 'a') ? 'paper' : (w.carryNow ? null : 'paper');
  }
  function stepWalker(w, dt, all) {
    if (w.idle > 0) { w.idle -= dt; if (w.idle <= 0) { w.emote = null; if (w.courier && w.phase === 'wait') { w.phase = 'back'; w.path = route(w.at, w.home); w.pi = 1; w.dest = w.home; w.carryNow = null; } } return; }
    if (w.pi >= w.path.length) {
      if (w.courier) { w.done = true; return; }
      let dest, tries = 0; do { dest = pick(w.cfg.pois, Math.floor(Math.random() * 999)); tries++; } while ((dest === w.at || all.some(o => o !== w && (o.dest === dest || Math.hypot(o.x - NODES[dest][0], o.y - NODES[dest][1]) < 0.9))) && w.cfg.pois.length > 1 && tries < 14);
      w.path = route(w.at, dest); w.pi = 1; w.dest = dest; if (w.path.length < 2) { w.idle = 1; return; }
    }
    const tg = NODES[w.path[w.pi]], dx = tg[0] - w.x, dy = tg[1] - w.y, dd = Math.hypot(dx, dy) || 1, hx = dx / dd, hy = dy / dd;
    // mão direita: cada um anda um pouco ao lado da linha do corredor, então quem vem no sentido contrário passa sem se sobrepor
    // quem está à frente faz esperar; se for alguém parado, desvia pela esquerda; se a espera passar de 5 s, segue assim mesmo
    let blocker = null, Lt = 0.27;
    if (w.free > 0) w.free -= dt;
    for (const o of all) { if (o === w) continue; const px = (o.x + o.ox) - (w.x + w.ox), py = (o.y + o.oy) - (w.y + w.oy), along = px * hx + py * hy, lat = Math.abs(px * hy - py * hx);
      if (o.idle > 0 && along > -0.9 && along < 1.3) { const lr = -(((o.x + o.ox) - w.x) * hy - ((o.y + o.oy) - w.y) * hx); if (Math.abs(lr) < 0.95) Lt = lr >= 0 ? -0.3 : 0.3; }
      if (w.free <= 0 && !blocker && ((along > 0.05 && along < 0.95 && lat < 0.3) || (Math.hypot(px, py) < 0.45 && o.id < w.id && !(o.idle > 0)))) blocker = o; }
    w.L = (w.L === undefined ? 0.27 : w.L) + (Lt - (w.L === undefined ? 0.27 : w.L)) * Math.min(1, dt * 7);
    w.ox += (-hy * w.L - w.ox) * Math.min(1, dt * 12); w.oy += (hx * w.L - w.oy) * Math.min(1, dt * 12);
    if (blocker) { w.wait += dt; if (w.wait > 5) { w.free = 1.4; w.wait = 0; } return; }
    w.wait = 0;
    const sp = (w.courier ? 1.9 : w.cfg.speed) * dt;
    w.face = (dx - dy) >= 0 ? 1 : -1; w.wp += dt * 9; w.dir = Math.abs(hx) >= Math.abs(hy) ? (hx > 0 ? 0 : 1) : (hy > 0 ? 2 : 3);
    if (dd <= sp) { w.x = tg[0]; w.y = tg[1]; w.at = w.path[w.pi]; w.pi++; if (w.pi >= w.path.length) arrive(w); } else { w.x += hx * sp; w.y += hy * sp; }
  }
  function spawnCourier(si) {
    if (couriers.length > 3) return;
    const home = si ? 'm1' : 't1', dest = si ? 'j1' : 'f1', look = looks(si * 5 + 21);
    couriers.push({ id: 100 + (cid++), courier: true, cfg: { name: 'Mensageiro do ' + SYMS[si].name, desc: 'leva o relatório dos analistas para a mesa dos traders', look: { ...look, tie: SYMS[si].col, badge: true } }, x: NODES[home][0], y: NODES[home][1], ox: 0, oy: 0, at: home, home, path: route(home, dest), pi: 1, idle: 0, wp: 0, face: 1, carryNow: 'paper', dest, phase: 'go', emote: null, col: SYMS[si].col, wait: 0, free: 0 });
  }

  /* ---------- dados ---------- */
  function lastDecision(js) { const ev = (js && js.journal && js.journal.events) || []; for (const e of ev) if (e.decision && e.decision.checks && e.decision.checks.length > 6) return e; return null; }
  function votes(dec) { const m = {}; if (!dec) return m; (dec.decision.checks || []).forEach(c => { m[c.name] = c; }); return m; }
  const BR = -3 * 3600;   // dia de Brasília (UTC-3 fixo, sem horário de verão): vira às 00:00 de Brasília em qualquer fuso do PC
  function brKey(sec) { const d = new Date((sec + BR) * 1000); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
  function localDay(t) { const e = epoch(t); return e ? brKey(e) : ''; }
  const todayKey = () => brKey(Date.now() / 1000);
  function goldOpen() { const d = new Date(), wd = d.getUTCDay(), h = d.getUTCHours() + d.getUTCMinutes() / 60; if (wd === 6) return false; if (wd === 0 && h < 22) return false; if (wd === 5 && h >= 21) return false; return true; }
  const arrow = t => t > 0 ? '▲' : t < 0 ? '▼' : '▬';
  function openPositions(S) { if (!S) return []; const l = Array.isArray(S.positions) ? S.positions : (S.position && S.position.open ? [S.position] : []); return l.filter(p => p && p.open !== false); }

  async function refresh() {
    const [a, b, r] = await Promise.all(SYMS.map(s => fetch('/api/robot?sym=' + s.sym).then(x => x.json())).concat([fetch('/api/robots').then(x => x.json())]));
    SYMS.forEach((s, i) => { const d0 = lastDecision(i ? b : a); if (d0 && lastSeen[s.sym] && lastSeen[s.sym] !== d0.t) spawnCourier(i); lastSeen[s.sym] = d0 ? d0.t : lastSeen[s.sym]; });
    data = { XAUUSDm: a, BTCUSDm: b }; robots = (r && r.robots) || [];
    if (!diary || Date.now() - (diary._at || 0) > 15000) { const d = await fetch('/api/robot/diary').then(x => x.json()); if (d && d.trades) { d._at = Date.now(); diary = d; onTrades(d.trades); } }
    updateHud();
  }
  function onTrades(trades) {
    if (seen === null) { seen = new Set(trades.map(t => t.pos)); return; }
    trades.forEach(t => {
      if (seen.has(t.pos)) return; seen.add(t.pos);
      const sd = SYMS.find(s => s.sym === t.sym) || SYMS[0], w = t.win, p = P(18.0, sd.rowY[0] + 1, 40);
      flash = 1; flashCol = w ? UP : DN; banner = { t: 3.2, text: w ? '🎉 TAKE! ' + money(t.usd) : '💥 STOP ' + money(t.usd), col: w ? UP : DN, sub: sd.name + ' · ' + t.side + ' · ' + (t.r > 0 ? '+' : '') + t.r + ' R' };
      for (let i = 0; i < (RM ? 0 : w ? 90 : 24); i++) parts.push({ x: p[0], y: p[1], vx: (Math.random() - 0.5) * (w ? 8 : 3.5), vy: -Math.random() * (w ? 9 : 3) - 1, life: 1.8 + Math.random(), c: w ? ['#e8b64c', '#2ebd85', '#5b9dff', '#fff', '#f7931a'][i % 5] : '#f6465d', s: 2 + Math.random() * 3, coin: w && i % 4 === 0 });
      toast((w ? '🎉 TAKE no ' : '💥 Stop no ') + sd.name + ': ' + money(t.usd) + ' (' + (t.r > 0 ? '+' : '') + t.r + ' R)', w ? 'ok' : 'err');
    });
  }
  function updateHud() {
    const st = SYMS.map(s => data[s.sym] && data[s.sym].status).filter(s => s && s.found !== false && s.account);
    if (!st.length) return;
    const alive = st.find(s => s.alive) || st[0], acc = alive.account, tg = alive.target || {};
    const flo = st.reduce((s, x) => s + openPositions(x).reduce((q, p) => q + (p.profit || 0), 0), 0), nOpen = st.reduce((s, x) => s + openPositions(x).length, 0);
    const closed = (diary ? diary.trades : []).filter(t => localDay(t.close_t) === todayKey());
    const fecha = closed.reduce((s, t) => s + (t.usd || 0), 0), takes = closed.filter(t => t.win).length;
    hud = { eq: acc.equity, gain: tg.gain || 0, usd: tg.usd || 0, hit: tg.hit, flo, fecha, takes, n: closed.length, closed, nOpen };
    cv.setAttribute('aria-label', `Escritório do Kairos: ${nOpen} posição(ões) aberta(s), ${takes} take(s) em ${hud.n} operação(ões) fechada(s) hoje, resultado do dia US$ ${hud.gain.toFixed(2)}.`);
    const set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };
    const pct = hud.usd > 0 ? clamp(100 * hud.gain / hud.usd, 0, 100) : 0;
    set('ofEq', `<span>Patrimônio</span><b>US$ ${f2(hud.eq)}</b>`);
    set('ofDay', `<span>Hoje (fechado + aberto)</span><b class="${cl(hud.gain)}">US$ ${sg(hud.gain)}</b>`);
    set('ofGoal', `<span>Meta do dia ${hud.usd > 0 ? 'US$ ' + f2(hud.usd) : '(sem meta)'}</span><div class="ofbar"><i style="width:${pct}%"></i></div><b>${pct.toFixed(0)}%${hud.hit ? ' ✅' : ''}</b>`);
    set('ofTk', `<span>Posições abertas · takes hoje</span><b>${nOpen} · ${takes}/${hud.n}</b>`);
    const tk = document.getElementById('ofTicker');
    if (tk) tk.innerHTML = `RESULTADO FECHADO HOJE <b class="${cl(fecha)}">${money(fecha)}</b> · RESULTADO FLUTUANTE <b class="${cl(flo)}">${money(flo)}</b> · OURO: <b>${goldOpen() ? 'MERCADO ABERTO' : 'MERCADO FECHADO'}</b> · BITCOIN: <b>MERCADO ABERTO 24H</b> · ATUALIZADO ÀS ${new Date().toLocaleTimeString('pt-BR')}`;
  }

  /* ---------- cenário ---------- */
  /* ---------- planta do escritório (1 casa = 2 m) ---------- */
  const LY = { T: 3.4, M: 9.0, B: 14.7 };                       // corredores horizontais (y); verticais: x = 0.6, 14.6 e 21.6
  const REST = { wx: 22.2, x1: 27, y0: 4.4, y1: 17.6 };         // sala de descanso (só para quem tomou stop)
  const MEET = { x0: 7.0, x1: 14.4, y0: 15.3, y1: 17.9, d0: 12.6, d1: 13.8 };   // sala de reunião (porta na parede norte)
  const TAKES = { x0: 15.8, x1: 21.4, y0: 15.3, y1: 20.8, d0: 17.5, d1: 18.8 };   // sala dos takes (porta na parede norte)
  const RECEP = { x0: 0.6, x1: 5.8, y0: 15.3, y1: 17.9 };
  const IX = i => 1.2 + (i % 7) * 1.9, TXJ = j => 15.8 + (j % 2) * 3.2;

  function floorText(text, x, y, col, size, alpha) {   // texto "pintado" no chão, lendo ao longo do eixo x
    const o = P(x, y, 0); ctx.save(); ctx.transform(0.894, 0.447, -0.894, 0.447, o[0], o[1]); ctx.globalAlpha = alpha == null ? 0.6 : alpha; ctx.fillStyle = col; ctx.font = `800 ${size || 13}px system-ui,Segoe UI,sans-serif`; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, 0, 0); ctx.restore();
  }
  function fitFont(text, maxW, px, weight) { ctx.font = `${weight || 700} ${px}px system-ui`; const w = ctx.measureText(text).width; return w > maxW ? Math.max(5, Math.floor(px * maxW / w * 10) / 10) : px; }
  function wtFit(text, cx, y, col, px, weight, maxW) { const p = fitFont(text, maxW, px, weight); wt(text, cx, y, col, `${weight || 700} ${p}px system-ui`, 'center'); }
  const money0 = v => (v > 0 ? '+$' : v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
  function tile(u, v0, w, h, title, value, col, sub, bar) {   // painel pequeno na parede (plano y); nenhum texto passa da moldura
    ctx.fillStyle = '#05080d'; ctx.fillRect(u - 3, v0 - 3, w + 6, h + 6); ctx.fillStyle = '#0e1521'; ctx.fillRect(u, v0, w, h); ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.strokeRect(u + 0.5, v0 + 0.5, w - 1, h - 1); ctx.globalAlpha = 1;
    const cx = u + w / 2, mw = w - 10;
    wtFit(title, cx, v0 + h - 10, '#8a96a8', 8, 700, mw);
    wtFit(value, cx, v0 + h / 2 + 2, col, 16, 800, mw);
    if (bar != null) { ctx.fillStyle = '#1b2333'; ctx.fillRect(u + 6, v0 + 17, w - 12, 5); ctx.fillStyle = col; ctx.fillRect(u + 6, v0 + 17, (w - 12) * bar, 5); }
    wtFit(sub, cx, v0 + 8, '#7b889c', 7, 600, mw);
  }

  function drawStatic() {
    ctx.fillStyle = '#080b11'; ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < GX; x++) for (let y = 0; y < GY; y++) poly([P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)], (x + y) % 2 ? '#141b29' : '#10161f');
    SYMS.forEach((s, i) => {
      const c = i ? '247,147,26' : '232,182,76', z0 = s.rowY[0] - 1.3, z1 = s.rowY[1] + 2.2;
      poly([P(0.2, z0), P(21.2, z0), P(21.2, z1), P(0.2, z1)], `rgba(${c},.07)`, `rgba(${c},.34)`);
      for (let k = 0; k < 5; k++) { const q = P(2.2 + k * 4.5, s.rowY[0] + 1.2); ctx.fillStyle = `rgba(${c},.045)`; ctx.beginPath(); ctx.ellipse(q[0], q[1] + 4, 62, 26, 0, 0, 7); ctx.fill(); }
      ctx.strokeStyle = `rgba(${c},.06)`; ctx.lineWidth = 1; for (let k = 0; k < 16; k++) { const a = P(0.2 + k * 1.4, z0), b = P(0.2 + k * 1.4, z1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      floorText(`${s.icon}  MESA ${s.name.toUpperCase()}  ·  14 INDICADORES`, 1.2, s.rowY[0] - 1.05, s.col, 12, 0.7);
      floorText(`TRADERS ${s.name.toUpperCase()}  ·  ATÉ ${SLOTS} POSIÇÕES`, 15.8, s.rowY[0] - 1.05, s.col, 10, 0.55);
    });
    ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 14;
    [[0.6, LY.T, 21.6, LY.T], [0.6, LY.M, 25.2, LY.M], [0.6, LY.B, 21.6, LY.B], [14.6, LY.T, 14.6, LY.B], [21.6, LY.T, 21.6, LY.B], [0.6, LY.T, 0.6, LY.B]].forEach(([x1, y1, x2, y2]) => { const a = P(x1, y1), b = P(x2, y2); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
    // paredes externas, rodapé e sombra no pé da parede
    poly([P(0, 0, 0), P(GX, 0, 0), P(GX, 0, WALL), P(0, 0, WALL)], '#171f2f'); poly([P(0, 0, 0), P(0, GY, 0), P(0, GY, WALL), P(0, 0, WALL)], '#12192a');
    poly([P(0, 0, WALL), P(GX, 0, WALL), P(GX, 0, WALL + 6), P(0, 0, WALL + 6)], '#222c40'); poly([P(0, 0, WALL), P(0, GY, WALL), P(0, GY, WALL + 6), P(0, 0, WALL + 6)], '#1a2234');
    poly([P(0, 0, 0), P(GX, 0, 0), P(GX, 0, 7), P(GX, 0, 7), P(0, 0, 7)], '#0e1420'); poly([P(0, 0, 0), P(0, GY, 0), P(0, GY, 7), P(0, 0, 7)], '#0b101a');
    poly([P(0, 0, 0), P(GX, 0, 0), P(GX, 0.5, 0), P(0, 0.5, 0)], 'rgba(0,0,0,.28)'); poly([P(0, 0, 0), P(0.5, 0, 0), P(0.5, GY, 0), P(0, GY, 0)], 'rgba(0,0,0,.28)');
    { const sk0 = sky(); if (sk0[2] > 0) for (let i = 0; i < 4; i++) { const y0 = 1.4 + i * 3.9; poly([P(0, y0 + 0.1), P(0, y0 + 2.5), P(5.5, y0 + 5.2), P(5.5, y0 + 2.8)], `rgba(255,236,190,${0.045 * sk0[2]})`); } }
    ctx.save(); let m = wallPlane('x', 0); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);   // parede esquerda: janelas, cortinas, luminárias e porta
    for (let i = 0; i < 4; i++) {
      const u = (1.4 + i * 3.9) * HW, sk = sky(), g = ctx.createLinearGradient(0, 106, 0, 50); g.addColorStop(0, sk[0]); g.addColorStop(1, sk[1]); ctx.fillStyle = g; ctx.fillRect(u, 50, 2.6 * HW, 56);
      for (let k = 0; k < 9; k++) { const hh = 8 + (k * 37 % 30); ctx.fillStyle = '#0a1226'; ctx.fillRect(u + 6 + k * 22, 50, 13, hh); ctx.fillStyle = sk[2] > 0.3 ? 'rgba(255,255,255,0)' : 'rgba(255,214,120,.85)'; for (let q = 0; q < hh / 7; q++) if (Math.sin(T * 0.4 + k * 3 + q * 7 + i) > -0.2) ctx.fillRect(u + 9 + k * 22, 54 + q * 7, 2, 2); }
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(u, 50 + 53, 2.6 * HW, 3); ctx.strokeStyle = '#2b3752'; ctx.lineWidth = 2.5; ctx.strokeRect(u, 50, 2.6 * HW, 56); ctx.beginPath(); ctx.moveTo(u + 1.3 * HW, 50); ctx.lineTo(u + 1.3 * HW, 106); ctx.stroke();
      ctx.fillStyle = 'rgba(70,86,126,.75)'; ctx.fillRect(u - 7, 46, 7, 64); ctx.fillRect(u + 2.6 * HW, 46, 7, 64); ctx.fillStyle = '#2b3752'; ctx.fillRect(u - 9, 108, 2.6 * HW + 18, 4);
      const lx = u + 1.3 * HW + 1.95 * HW; ctx.fillStyle = '#3a4560'; ctx.fillRect(lx - 2, 70, 4, 16); const gl = ctx.createRadialGradient(lx, 80, 1, lx, 80, 26); gl.addColorStop(0, 'rgba(255,214,140,.35)'); gl.addColorStop(1, 'rgba(255,214,140,0)'); ctx.fillStyle = gl; ctx.fillRect(lx - 26, 54, 52, 52);
    }
    const dr = 16.4 * HW; ctx.fillStyle = '#1b2233'; ctx.fillRect(dr, 7, 1.3 * HW, 92); ctx.strokeStyle = '#3a4560'; ctx.lineWidth = 2; ctx.strokeRect(dr, 7, 1.3 * HW, 92); ctx.fillStyle = '#2ebd85'; ctx.fillRect(dr + 5, 104, 1.3 * HW - 10, 11); wt('SAÍDA', dr + 0.65 * HW, 110, '#04140d', '800 7px system-ui', 'center', true);
    ctx.restore();
    ctx.save(); m = wallPlane('y', 0); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);   // parede do fundo: um painel por vez, com folga entre eles
    wt('KAIROS', 0.8 * HW, 92, '#e8b64c', '800 26px system-ui,Segoe UI'); wt('O MOMENTO OPORTUNO', 0.8 * HW + 2, 70, '#8a96a8', '600 10px system-ui');
    const cx = 5.7 * HW, cy = 92, d = new Date(); ctx.fillStyle = '#e8edf5'; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 7); ctx.fill(); ctx.strokeStyle = '#222c40'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 2; const ha = (d.getHours() % 12 + d.getMinutes() / 60) / 12 * 6.283, ma = d.getMinutes() / 60 * 6.283; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(ha) * 8, cy + Math.cos(ha) * 8); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.sin(ma) * 12, cy + Math.cos(ma) * 12); ctx.stroke();
    const sx0 = 7.6 * HW, sw = 8.8 * HW, sy0 = 40, sh = 76;
    ctx.fillStyle = '#05080d'; ctx.fillRect(sx0 - 6, sy0 - 6, sw + 12, sh + 12); ctx.strokeStyle = '#26324a'; ctx.lineWidth = 2; ctx.strokeRect(sx0 - 6, sy0 - 6, sw + 12, sh + 12);
    ctx.fillStyle = '#0b1a14'; ctx.fillRect(sx0, sy0, sw, sh); ctx.strokeStyle = '#17261f'; ctx.lineWidth = 1; for (let k = 1; k < 5; k++) { ctx.beginPath(); ctx.moveTo(sx0, sy0 + sh * k / 5); ctx.lineTo(sx0 + sw, sy0 + sh * k / 5); ctx.stroke(); }
    for (let k = 1; k < 9; k++) { ctx.beginPath(); ctx.moveTo(sx0 + sw * k / 9, sy0); ctx.lineTo(sx0 + sw * k / 9, sy0 + sh); ctx.stroke(); }
    drawEquity(sx0, sy0, sw, sh);
    const pct = hud.usd > 0 ? clamp(hud.gain / hud.usd, 0, 1) : 0, tw = 1.75 * HW;
    tile(17.7 * HW, 44, tw, 66, 'HOJE', money0(hud.gain || 0), (hud.gain || 0) >= 0 ? UP : DN, 'fechado+aberto', null);
    tile(19.7 * HW, 44, tw, 66, 'META', hud.usd > 0 ? `${(pct * 100).toFixed(0)}%` : '--', pct >= 1 ? UP : '#e8b64c', hud.usd > 0 ? `US$ ${(hud.gain || 0).toFixed(0)} / ${hud.usd.toFixed(0)}` : 'sem meta', hud.usd > 0 ? pct : null);
    tile(21.7 * HW, 44, tw, 66, 'POSIÇÕES', String(hud.nOpen || 0), '#5b9dff', `${hud.takes || 0} takes · ${Math.max(0, (hud.n || 0) - (hud.takes || 0))} stops`, null);
    const px = 23.9 * HW; ctx.fillStyle = '#1b2233'; ctx.fillRect(px, 44, 1.5 * HW, 66); ctx.strokeStyle = '#e8b64c'; ctx.lineWidth = 2; ctx.strokeRect(px, 44, 1.5 * HW, 66); ctx.fillStyle = '#e8b64c'; ctx.beginPath(); ctx.arc(px + 0.75 * HW, 82, 14, 0, 7); ctx.fill(); wt('$', px + 0.75 * HW, 82, '#3a2a07', '800 18px system-ui', 'center'); wt('GOAL', px + 0.75 * HW, 54, '#e8b64c', '800 9px system-ui', 'center');
    ctx.restore();
    drawRooms();
  }
  function drawEquity(x0, y0, w, h) {   // x0,y0,w,h no plano da parede (px); cabeçalho no topo, gráfico abaixo e recortado
    const HD = 15, cx0 = x0 + 26, cw = w - 34, cy0 = y0 + 5, ch = h - HD - 9;
    ctx.fillStyle = '#0f241b'; ctx.fillRect(x0, y0 + h - HD, w, HD);
    wt('RENTABILIDADE AO VIVO', x0 + 7, y0 + h - 7.5, '#8fb3a0', '700 8px system-ui');
    const tr = diary ? diary.trades.slice().sort((a, b) => (a.close_t < b.close_t ? -1 : 1)) : [];
    if (tr.length < 2) { wt('aguardando operações…', x0 + w / 2, y0 + h / 2 - 4, '#5f7a6c', '600 9px system-ui', 'center'); return; }
    let c = 0; const pts = tr.map(t => (c += t.usd || 0)), n = pts.length, lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), rg = (hi - lo) || 1;
    const X = i => cx0 + cw * i / (n - 1), Y = v => cy0 + ch * (v - lo) / rg, up = pts[n - 1] >= 0;
    const fmt = v => (Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + 'k' : Math.round(v)) + '';
    ctx.font = '600 6.5px system-ui';
    [hi, 0, lo].forEach((v, k) => { if (k === 2 && lo === 0) return; wt(fmt(v), cx0 - 4, Y(v), '#6f8a7b', '600 6.5px system-ui', 'right'); });
    ctx.strokeStyle = 'rgba(143,179,160,.4)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx0, Y(0)); ctx.lineTo(cx0 + cw, Y(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.save(); ctx.beginPath(); ctx.rect(cx0 - 1, cy0 - 2, cw + 3, ch + 4); ctx.clip();
    ctx.strokeStyle = up ? UP : DN; ctx.lineWidth = 2; ctx.beginPath(); pts.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))); ctx.stroke();
    ctx.lineTo(X(n - 1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.fillStyle = up ? 'rgba(46,189,133,.16)' : 'rgba(246,70,93,.16)'; ctx.fill();
    ctx.fillStyle = up ? UP : DN; ctx.beginPath(); ctx.arc(X(n - 1), Y(pts[n - 1]), 2.4 + Math.sin(T * 5) * 0.7, 0, 7); ctx.fill(); ctx.restore();
    const last = money0(pts[n - 1]); wt(last, x0 + w - 7, y0 + h - 7.5, up ? UP : DN, `800 ${fitFont(last, w * 0.4, 10, 800)}px system-ui`, 'right');
  }

  function desk(x, y, w, c) {
    const dk = w < 1 ? 'desk09' : w < 1.6 ? 'desk15' : w < 2 ? 'desk18' : 'desk26';
    if (SP() && SP().furn[dk]) { furnSpr(dk, x + w / 2, y + 0.3, w * HW * 0.8); return; }
    const sh = P(x + w / 2, y + 0.3, 0); ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(sh[0] + 3, sh[1] + 3, w * HW * 0.85, 8, 0, 0, 7); ctx.fill();
    box(x, y, 0, w, 0.55, 12, c || '#2a3347');
    const ms = P(x + w * 0.72, y + 0.3, 12.2); ctx.fillStyle = '#e8edf5'; ctx.beginPath(); ctx.ellipse(ms[0], ms[1], 2.2, 1.4, 0, 0, 7); ctx.fill();
    const k = P(x + w * 0.5, y + 0.28, 12.2); ctx.fillStyle = '#0c1018'; ctx.fillRect(k[0] - 6, k[1] - 2, 12, 3);
    const m = P(x + w * 0.1, y + 0.3, 12.2); ctx.fillStyle = '#e8edf5'; ctx.fillRect(m[0] - 2, m[1] - 5, 4, 5); ctx.fillStyle = '#6b4a2b'; ctx.fillRect(m[0] - 1.5, m[1] - 4.5, 3, 1.4);
    const p = P(x + w * 0.9, y + 0.3, 12.2); ctx.fillStyle = '#d9dee8'; ctx.fillRect(p[0] - 4, p[1] - 2, 8, 2); ctx.fillStyle = '#b8c0d0'; ctx.fillRect(p[0] - 3, p[1] - 3.5, 7, 1.5);
  }
  function plant(x, y, big) { if (SP() && furnSpr(big ? 'plant' : 'plantS', x + 0.25, y + 0.25, 8)) return; box(x, y, 0, 0.5, 0.5, big ? 9 : 7, '#5a3b22'); const q = P(x + 0.25, y + 0.25, big ? 16 : 13); ctx.fillStyle = '#1f8f5f'; ctx.beginPath(); ctx.arc(q[0], q[1], big ? 10 : 8, 0, 7); ctx.fill(); ctx.fillStyle = '#2ebd85'; ctx.beginPath(); ctx.arc(q[0] - 4, q[1] - 3, big ? 6 : 5, 0, 7); ctx.fill(); }

  /* ---------- salas: recepção, reunião, descanso e pódio ---------- */
  function wallSeg(xa, ya, xb, yb, h, col, cap) { poly([P(xa, ya, 0), P(xb, yb, 0), P(xb, yb, h), P(xa, ya, h)], col); poly([P(xa, ya, h), P(xb, yb, h), P(xb, yb, h + 4), P(xa, ya, h + 4)], cap || '#34425e'); }
  function drawRooms() {
    const closed = hud.closed || [], stops = closed.filter(t => !t.win), WH = 56;
    // recepção
    poly([P(RECEP.x0, RECEP.y0), P(RECEP.x1, RECEP.y0), P(RECEP.x1, RECEP.y1), P(RECEP.x0, RECEP.y1)], 'rgba(91,157,255,.07)', 'rgba(91,157,255,.28)');
    drawTakesRoom();
    // sala de reunião: paredes norte (com porta) e oeste opacas; leste e sul são de vidro (glassMeeting)
    poly([P(MEET.x0, MEET.y0), P(MEET.x1, MEET.y0), P(MEET.x1, MEET.y1), P(MEET.x0, MEET.y1)], '#17283a', 'rgba(120,200,160,.4)');
    ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.lineWidth = 1; for (let k = 1; k < 8; k++) { const a = P(MEET.x0 + k * 0.92, MEET.y0), b = P(MEET.x0 + k * 0.92, MEET.y1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    wallSeg(MEET.x0, MEET.y0, MEET.d0, MEET.y0, WH, '#1f2a3d'); wallSeg(MEET.d1, MEET.y0, MEET.x1, MEET.y0, WH, '#1f2a3d'); poly([P(MEET.d0, MEET.y0, WH - 7), P(MEET.d1, MEET.y0, WH - 7), P(MEET.d1, MEET.y0, WH), P(MEET.d0, MEET.y0, WH)], '#34425e'); wallSeg(MEET.x0, MEET.y0, MEET.x0, MEET.y1, WH, '#1a2538');
    ctx.save(); let o = P(MEET.x0, MEET.y0, 0); ctx.transform(1, 0.5, 0, -1, o[0], o[1]);
    const u0 = 1.1 * HW, w = 3.9 * HW; ctx.fillStyle = '#05080d'; ctx.fillRect(u0 - 4, 8, w + 8, 40); ctx.strokeStyle = '#26324a'; ctx.lineWidth = 1.5; ctx.strokeRect(u0 - 4, 8, w + 8, 40); ctx.fillStyle = '#0d1b2a'; ctx.fillRect(u0, 12, w, 32);
    wt('REUNIÃO DO DIA', u0 + 8, 36, '#e8b64c', '800 8px system-ui'); const tr = diary ? diary.trades.slice(-14) : [];
    if (tr.length > 1) { let c = 0; const pts = tr.map(t => (c += t.usd || 0)), lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), rg = (hi - lo) || 1; ctx.strokeStyle = pts[pts.length - 1] >= 0 ? UP : DN; ctx.lineWidth = 1.6; ctx.beginPath(); pts.forEach((v, i) => { const X = u0 + 8 + (w - 16) * i / (pts.length - 1), Y = 16 + 14 * (v - lo) / rg; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.stroke(); }
    if (Math.floor(T * 2) % 2 === 0) { ctx.fillStyle = '#e8b64c'; ctx.fillRect(u0 + w - 12, 34, 4, 5); }
    ctx.restore();
    ctx.save(); const wp = wallPlane('x', MEET.x0); ctx.transform(wp[0], wp[1], wp[2], wp[3], wp[4], wp[5]);
    ctx.fillStyle = '#f2f4f8'; ctx.fillRect(16.4 * HW, 12, 1.4 * HW, 30); ctx.strokeStyle = '#8a96a8'; ctx.lineWidth = 2; ctx.strokeRect(16.4 * HW, 12, 1.4 * HW, 30); ctx.strokeStyle = '#2ebd85'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(16.5 * HW, 20); ctx.lineTo(16.9 * HW, 30); ctx.lineTo(17.2 * HW, 24); ctx.lineTo(17.65 * HW, 38); ctx.stroke(); ctx.restore();
    // sala de descanso: piso de madeira, divisória a oeste (porta no corredor y = 9), parede norte com o quadro de stops
    poly([P(REST.wx + 0.1, REST.y0), P(REST.x1, REST.y0), P(REST.x1, REST.y1), P(REST.wx + 0.1, REST.y1)], '#3a2c22', 'rgba(255,200,140,.3)');
    ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.lineWidth = 1; for (let yy = REST.y0; yy < REST.y1; yy += 0.5) { const a = P(REST.wx + 0.1, yy), b = P(REST.x1, yy); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,220,170,.06)'; for (let yy = REST.y0 + 0.25; yy < REST.y1; yy += 1.0) { const a = P(REST.wx + 0.1, yy), b = P(REST.x1, yy); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    poly([P(23.0, 6.6), P(26.4, 6.6), P(26.4, 8.2), P(23.0, 8.2)], 'rgba(232,90,120,.14)'); poly([P(22.8, 13.4), P(26.8, 13.4), P(26.8, 17.0), P(22.8, 17.0)], 'rgba(91,157,255,.10)');
    wallSeg(REST.wx, REST.y0, REST.wx, 8.5, 34, '#33261b', '#4a3828'); wallSeg(REST.wx, 9.5, REST.wx, REST.y1, 34, '#33261b', '#4a3828'); poly([P(REST.wx, 8.5, 34), P(REST.wx, 9.5, 34), P(REST.wx, 9.5, 40), P(REST.wx, 8.5, 40)], '#4a3828');
    wallSeg(REST.wx, REST.y0, REST.x1, REST.y0, 58, '#1f2a3d');
    ctx.save(); o = P(REST.wx, REST.y0, 0); ctx.transform(1, 0.5, 0, -1, o[0], o[1]);
    const bu = 0.9 * HW, bw = 3.5 * HW; ctx.fillStyle = '#05080d'; ctx.fillRect(bu - 4, 8, bw + 8, 46); ctx.strokeStyle = '#3a2024'; ctx.lineWidth = 1.5; ctx.strokeRect(bu - 4, 8, bw + 8, 46); ctx.fillStyle = '#1a0f12'; ctx.fillRect(bu, 12, bw, 38);
    wt('STOPS DE HOJE', bu + 8, 44, DN, '800 9px system-ui');
    stops.slice(0, 4).forEach((t, k) => wt(`${money(t.usd || 0)}  ${t.side === 'COMPRA' ? '▲' : '▼'}  ${String(t.close_t || '').slice(11, 16)}`, bu + 8, 32 - k * 8, '#f2b6bf', '600 7px system-ui'));
    if (!stops.length) wt('nenhum stop hoje', bu + 8, 30, '#7fe0b4', '600 8px system-ui');
    ctx.restore();
  }
  function glassMeeting() {   // paredes de vidro (leste e sul), desenhadas por cima de quem está dentro
    const H1 = 56, glass = 'rgba(150,205,255,.11)';
    poly([P(MEET.x1, MEET.y0, 0), P(MEET.x1, MEET.y1, 0), P(MEET.x1, MEET.y1, H1), P(MEET.x1, MEET.y0, H1)], glass, 'rgba(190,225,255,.35)'); poly([P(MEET.x0, MEET.y1, 0), P(MEET.x1, MEET.y1, 0), P(MEET.x1, MEET.y1, H1), P(MEET.x0, MEET.y1, H1)], glass, 'rgba(190,225,255,.35)');
    ctx.strokeStyle = 'rgba(190,225,255,.5)'; ctx.lineWidth = 1.6; [[MEET.x1, MEET.y0, MEET.x1, MEET.y1], [MEET.x0, MEET.y1, MEET.x1, MEET.y1]].forEach(([xa, ya, xb, yb]) => { const a = P(xa, ya, H1), b = P(xb, yb, H1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
    [[MEET.x1, MEET.y0], [MEET.x1, (MEET.y0 + MEET.y1) / 2], [MEET.x1, MEET.y1], [(MEET.x0 + MEET.x1) / 2, MEET.y1], [MEET.x0, MEET.y1]].forEach(([x, y]) => { const a = P(x, y, 0), b = P(x, y, H1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 3; [[0, 15.8, 16.2], [0, 17.0, 17.4], [1, 8.4, 8.9], [1, 11.6, 12.2]].forEach(([east, a0, b0]) => { const p = east === 0 ? [P(MEET.x1, a0, 6), P(MEET.x1, b0, H1 - 8)] : [P(a0, MEET.y1, 6), P(b0, MEET.y1, H1 - 8)]; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo(p[1][0], p[1][1]); ctx.stroke(); });
  }

  function drawTakesRoom() {
    const wins = (hud.closed || []).filter(t => t.win), WH = 56, T0 = TAKES;
    poly([P(T0.x0, T0.y0), P(T0.x1, T0.y0), P(T0.x1, T0.y1), P(T0.x0, T0.y1)], '#2a2114', 'rgba(232,182,76,.55)');
    ctx.strokeStyle = 'rgba(232,182,76,.07)'; ctx.lineWidth = 1; for (let k = 0; k < 14; k++) { const a = P(T0.x0 + k * 0.45, T0.y0), b = P(T0.x0, T0.y0 + k * 0.45); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
    poly([P(16.5, 16.2), P(20.7, 16.2), P(20.7, 20.1), P(16.5, 20.1)], 'rgba(150,30,50,.22)', 'rgba(232,182,76,.35)');
    wallSeg(T0.x0, T0.y0, T0.d0, T0.y0, WH, '#2b2414', '#6a5628'); wallSeg(T0.d1, T0.y0, T0.x1, T0.y0, WH, '#2b2414', '#6a5628'); poly([P(T0.d0, T0.y0, WH - 7), P(T0.d1, T0.y0, WH - 7), P(T0.d1, T0.y0, WH), P(T0.d0, T0.y0, WH)], '#6a5628'); wallSeg(T0.x0, T0.y0, T0.x0, T0.y1, WH, '#241d10', '#6a5628');
    ctx.save(); let o = P(T0.x0, T0.y0, 0); ctx.transform(1, 0.5, 0, -1, o[0], o[1]);
    const bu = (T0.d1 - T0.x0 + 0.25) * HW, bw = (T0.x1 - T0.d1 - 0.5) * HW; ctx.fillStyle = '#05080d'; ctx.fillRect(bu - 4, 8, bw + 8, 46); ctx.strokeStyle = '#5a4a22'; ctx.lineWidth = 1.5; ctx.strokeRect(bu - 4, 8, bw + 8, 46); ctx.fillStyle = '#0c1a12'; ctx.fillRect(bu, 12, bw, 38);
    wt('TAKES DE HOJE', bu + 6, 44, UP, '800 8px system-ui');
    wins.slice(0, 4).forEach((t, k) => wt(`${money(t.usd || 0)} ${t.side === 'COMPRA' ? '▲' : '▼'} ${String(t.close_t || '').slice(11, 16)}`, bu + 6, 32 - k * 8, '#b8f0d4', '600 7px system-ui'));
    if (!wins.length) wt('nenhum take ainda', bu + 6, 30, '#6f8a7b', '600 7.5px system-ui');
    ctx.restore();
    ctx.save(); o = wallPlane('x', T0.x0); ctx.transform(o[0], o[1], o[2], o[3], o[4], o[5]);
    const vu = 16.4 * HW, vw = 3.6 * HW; ctx.fillStyle = '#05080d'; ctx.fillRect(vu - 4, 6, vw + 8, 44); ctx.strokeStyle = '#6a5628'; ctx.lineWidth = 2; ctx.strokeRect(vu - 4, 6, vw + 8, 44); ctx.fillStyle = '#16120a'; ctx.fillRect(vu, 10, vw, 36);
    for (let k = 0; k < 5; k++) { const cx = vu + 14 + k * (vw - 28) / 4, big = k === 2, h = big ? 18 : 12; ctx.fillStyle = k < wins.length || big ? '#ffd66b' : '#4a4026'; ctx.beginPath(); ctx.moveTo(cx - 5, 14 + h); ctx.lineTo(cx + 5, 14 + h); ctx.lineTo(cx + 3, 14 + h * 0.4); ctx.lineTo(cx - 3, 14 + h * 0.4); ctx.closePath(); ctx.fill(); ctx.fillRect(cx - 1, 12, 2, 6); ctx.fillRect(cx - 4, 12, 8, 2); }
    ctx.restore();
  }
  function glassTakes() {
    const T0 = TAKES, H1 = 56, glass = 'rgba(255,220,150,.08)';
    poly([P(T0.x1, T0.y0, 0), P(T0.x1, T0.y1, 0), P(T0.x1, T0.y1, H1), P(T0.x1, T0.y0, H1)], glass, 'rgba(255,225,160,.35)'); poly([P(T0.x0, T0.y1, 0), P(T0.x1, T0.y1, 0), P(T0.x1, T0.y1, H1), P(T0.x0, T0.y1, H1)], glass, 'rgba(255,225,160,.35)');
    ctx.strokeStyle = 'rgba(255,225,160,.5)'; ctx.lineWidth = 1.6; [[T0.x1, T0.y0, T0.x1, T0.y1], [T0.x0, T0.y1, T0.x1, T0.y1]].forEach(([xa, ya, xb, yb]) => { const a = P(xa, ya, H1), b = P(xb, yb, H1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
    [[T0.x1, T0.y0], [T0.x1, (T0.y0 + T0.y1) / 2], [T0.x1, T0.y1], [(T0.x0 + T0.x1) / 2, T0.y1], [T0.x0, T0.y1]].forEach(([x, y]) => { const a = P(x, y, 0), b = P(x, y, H1); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); });
  }

  /* ---------- quadro ---------- */
  function frame(now) {
    if (!running) return;
    const pg = document.getElementById('p-office');
    if (!pg || !pg.classList.contains('on')) { running = false; return; }
    if (document.hidden) { requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; if (!RM) T += dt;
    if (!RM) { const all = walkers.concat(couriers); all.forEach(w => stepWalker(w, dt, all)); couriers = couriers.filter(c => !c.done); ambientT -= dt; if (ambientT <= 0) { ambientT = 16 + Math.random() * 12; spawnCourier(Math.random() < 0.5 ? 0 : 1); } }
    if (HEADLESS) {   // 3D ativo: aqui só roda a simulação (equipe, mensageiros, avisos)
      parts = parts.filter(p => (p.life -= dt) > 0); if (flash > 0) flash = Math.max(0, flash - dt * 1.4); if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
      requestAnimationFrame(frame); return;
    }
    if (OV) hud.closed = OV;
    const k = cv.width / W; ctx.setTransform(k, 0, 0, k, 0, 0); ctx.fillStyle = '#080b11'; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(k * view.z, 0, 0, k * view.z, k * view.x, k * view.y); hits = [];
    drawStatic();
    const items = [], add = (d, f) => items.push([d, f]);

    // diretoria: ícone de estado sobre a cabeça; detalhes só ao passar o mouse
    const DIRI = ['🧭', '📰', '🛡️', '🧠'];
    directors().forEach((r, i) => {
      const x = 2.6 + i * 3.6, y = 1.0, lk = looks(i + 4), icon = i === 1 && r.mood < 0 ? '🚨' : i === 2 && r.mood < 0 ? '🛑' : DIRI[i];
      add(x + y + 0.12, () => chair(x + 0.9, y + 0.0, '#3a2f4d'));
      add(x + y + 0.2, () => { person(x + 0.9, y + 0.1, 0, { ...lk, tie: i % 2 ? '#e8b64c' : '#f6465d', mood: r.mood, ph: i * 1.7, sit: true }); });
      add(x + y + 1.4, () => { if (SP()) desk(x, y + 0.5, 1.8); else box(x, y + 0.4, 0, 1.8, 0.8, 13, '#2a3347'); box(x + 0.4, y + 0.5, 13, 1.0, 0.1, 11, '#0c1018'); const g = r.mood > 0 ? UP : r.mood < 0 ? DN : '#e8b64c'; poly([P(x + 0.45, y + 0.6, 14), P(x + 1.4, y + 0.6, 14), P(x + 1.4, y + 0.6, 22), P(x + 0.45, y + 0.6, 22)], g);
        ctx.save(); const o = P(x, y + 1.3, 0); ctx.transform(1, 0.5, 0, -1, o[0], o[1]); wt(r.title, 0.9 * HW, 5, '#e8edf5', '800 8px system-ui', 'center'); ctx.restore(); });
      const pp = P(x + 0.9, y + 0.1, 46); tag(6, pp[0], pp[1] - 8, icon, r.mood > 0 ? UP : r.mood < 0 ? DN : '#e8b64c', 12);
      const q = P(x + 0.9, y + 0.7, 20); hits.push({ x: q[0] - 40, y: q[1] - 60, w: 80, h: 80, html: `<b>${r.title}</b> · ${esc(r.say)}<br>${r.tip}` });
    });
    add(1, () => plant(0.3, 0.3, true)); add(28, () => plant(GX - 1.0, 0.3, true));

    // recepção
    add(RECEP.x0 + 16, () => desk(1.2, 15.8, 2.6, '#3a4a68')); add(18.2, () => chair(2.5, 15.65, '#3a2f4d')); add(18.3, () => person(2.5, 15.7, 0, { ...looks(31), mood: 1, ph: 3, sit: true }));
    add(17, () => plant(0.7, 17.2)); add(19, () => plant(5.2, 15.6));
    { const rc = P(2.5, 15.7, 54); tag(3, rc[0], rc[1], '☎️', '#8a96a8', 11, { plain: true }); const rs = P(3.2, 17.7, 22); tag(4, rs[0], rs[1], 'RECEPÇÃO', '#5b9dff', 9); }
    // sala de reunião: mesa, cadeiras, quatro pessoas (uma apresenta; quem fala muda a cada 4 s)
    const speaker = Math.floor(T / 4) % 4, MX = [9.0, 10.6, 12.2];
    add(27.5, () => { if (!(SP() && furnSpr('meet', 10.6, 16.8, 60))) box(8.7, 16.5, 0, 3.8, 0.7, 10, '#5a3b22');
      [[9.6, 16.75], [10.8, 16.7], [11.8, 16.85]].forEach(([x, y]) => { const p = P(x, y, 14); ctx.fillStyle = '#f2f4f8'; ctx.fillRect(p[0] - 4, p[1] - 2, 8, 3); ctx.fillStyle = '#9fb0c8'; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 1); });
      const mg = P(10.6, 16.8, 14); ctx.fillStyle = '#e8b64c'; ctx.fillRect(mg[0] - 2, mg[1] - 7, 4, 7); });
    MX.forEach((cx, q) => { add(cx + 16.1, () => chair(cx, 16.1, '#2b3550')); add(cx + 16.15, () => person(cx, 16.17, 0, { ...looks(40 + q), mood: speaker === q ? 1 : 0, ph: q * 2, sit: true, noType: true })); add(cx + 17.5, () => chair(cx, 17.55, '#2b3550')); });
    add(7.8 + 16.0, () => person(7.8, 16.0, 0, { ...looks(44), mood: speaker === 3 ? 1 : 0, ph: 5, face: 1, tie: '#f6465d' }));
    { const sp = [[9.0, 16.17], [10.6, 16.17], [12.2, 16.17], [7.8, 16.0]][speaker], q = P(sp[0], sp[1], 50); if (!RM) tag(4, q[0], q[1] - 6, '💬', '#e8b64c', 11, { plain: true }); }
    add(21, () => plant(7.3, 17.4)); add(31, () => plant(13.9, 17.3));
    add(MEET.x1 + MEET.y1, () => glassMeeting());
    { const q = P(MEET.x1, (MEET.y0 + MEET.y1) / 2, 66); tag(5, q[0], q[1], 'SALA DE REUNIÃO', '#78c8a0', 9); }

    SYMS.forEach((s, si) => {
      const js = data[s.sym], S = js && js.status && js.status.found !== false ? js.status : null, dec = lastDecision(js), vt = votes(dec), poss = openPositions(S);
      IND.forEach((ind, i) => {
        const row = i < 7 ? 0 : 1, x = IX(i), y = s.rowY[row], c = vt[ind[0]];
        const mood = !c ? 0 : c.status === 'ok' ? 1 : c.status === 'neutro' ? 0 : -1, col = !c ? '#2a3446' : mood > 0 ? UP : mood < 0 ? DN : NEU, lk = looks(i + si * 7 + 2);
        add(x + y + 0.04, () => chair(x + 0.45, y - 0.02, shade(lk.shirt, 0.45)));
        add(x + y + 0.1, () => { person(x + 0.45, y + 0.05, 0, { ...lk, mood, ph: i * 0.9 + si, sit: true }); });
        add(x + y + 1.2, () => { desk(x, y + 0.25, 0.9); poly([P(x + 0.04, y + 0.8, 13), P(x + 0.86, y + 0.8, 13), P(x + 0.86, y + 0.8, 24), P(x + 0.04, y + 0.8, 24)], col); ctx.save(); const o = P(x, y + 0.8, 0); ctx.transform(1, 0.5, 0, -1, o[0], o[1]);
          wt(ind[1], 0.45 * HW, 21.6, '#fff', '700 6.8px system-ui', 'center'); ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 1; ctx.beginPath(); for (let q = 0; q < 10; q++) { const u = 3.2 + q * 2.6, v = 14.6 + 3 * (0.5 + 0.5 * Math.sin(T * 1.3 + q * 0.75 + i * 1.9 + si)) * (c ? 1 : 0.3); q ? ctx.lineTo(u, v) : ctx.moveTo(u, v); } ctx.stroke(); ctx.restore();
          if (mood > 0) { const g = P(x + 0.45, y + 0.8, 24); ctx.fillStyle = 'rgba(46,189,133,.10)'; ctx.beginPath(); ctx.arc(g[0], g[1] + 6, 20, 0, 7); ctx.fill(); } });
        if (Math.floor(T / 4.5 + i * 1.7 + si * 3) % 13 === 0 && !RM) { const cp = P(x + 0.45, y + 0.05, 50); tag(2, cp[0], cp[1] - 4, mood > 0 ? '👍' : mood < 0 ? '🤔' : '…', '#8a96a8', 11, { plain: true }); }
        const lp = P(x + 0.45, y + 1.15, 0);
        hits.push({ x: lp[0] - 28, y: lp[1] - 52, w: 56, h: 60, html: c ? `<b>${s.name} · ${ind[1]}</b><br><span class="${mood > 0 ? 'buy' : mood < 0 ? 'sell' : 'mut'}">${mood > 0 ? 'concorda' : mood < 0 ? 'discorda' : 'sem opinião'}</span><br>${esc(c.detail)}` : `<b>${s.name} · ${ind[1]}</b><br>sem análise ainda` });
      });
      // traders: um por posição aberta (até 4 vagas por ativo)
      const stopped = S && !S.alive, sorted = poss.slice().sort((a, b) => (a.open_time < b.open_time ? -1 : 1));
      for (let j = 0; j < SLOTS; j++) {
        const tx = TXJ(j), ty = s.rowY[Math.floor(j / 2)], pos = sorted[j] || null, mood = pos ? (pos.profit > 0 ? 1 : pos.profit < 0 ? -1 : 0) : 0, lk = looks(si * 9 + j + (pos ? pos.ticket % 7 : 3));
        if (pos) { add(tx + ty + 0.04, () => chair(tx + 0.7, ty - 0.02, '#2b3550')); add(tx + ty + 0.1, () => { person(tx + 0.7, ty + 0.05, 0, { ...lk, shirt: s.col, mood, ph: si * 2.2 + j, sit: true }); }); }
        add(tx + ty + 1.5, () => { desk(tx, ty + 0.3, 1.5, pos ? '#33405a' : '#232b3c'); box(tx + 0.25, ty + 0.35, 12, 0.5, 0.1, 10, '#0c1018'); box(tx + 0.85, ty + 0.35, 12, 0.5, 0.1, 10, '#0c1018');
          const gc = pos ? (pos.profit >= 0 ? UP : DN) : '#1d2536'; poly([P(tx + 0.28, ty + 0.9, 14), P(tx + 0.8, ty + 0.9, 14), P(tx + 0.8, ty + 0.9, 20), P(tx + 0.28, ty + 0.9, 20)], gc); poly([P(tx + 0.9, ty + 0.9, 14), P(tx + 1.35, ty + 0.9, 14), P(tx + 1.35, ty + 0.9, 20), P(tx + 0.9, ty + 0.9, 20)], pos ? s.col : '#1d2536'); });
        const tp = P(tx + 0.7, ty + 0.05, 52);
        if (pos) tag(10, tp[0], tp[1] - 8, `${money(pos.profit || 0)} ${pos.side === 'COMPRA' ? '▲' : '▼'}`, pos.profit >= 0 ? UP : DN, 11);
        else if (j === 0 && (stopped || !S)) tag(9, tp[0], tp[1] + 14, stopped ? '😴 robô parado' : '… sem dados', '#e8b64c', 10);
        if (pos) hits.push({ x: tp[0] - 40, y: tp[1] - 22, w: 80, h: 100, html: `<b>${s.icon} ${s.name} · ${pos.side === 'COMPRA' ? '<span class="buy">COMPRA</span>' : '<span class="sell">VENDA</span>'}</b> ${pos.lots} lote<br>Entrada ${pos.price_open} · stop ${pos.sl} · alvo ${pos.tp}<br>Flutuante <b class="${cl(pos.profit)}">${money(pos.profit || 0)}</b><br><span class="mut">aberta às ${esc(String(pos.open_time || '').slice(11, 16))} (servidor) · ${esc(pos.comment || '')}</span>` });
      }
      if (sorted.length > SLOTS) { const q = P(TXJ(0), s.rowY[1] + 1.6, 0); tag(7, q[0], q[1], `+${sorted.length - SLOTS} posição(ões) fora da vista`, '#e8b64c', 10); }
      const dd = dec ? dec.decision : null, rb = robots.find(r => r.sym === s.sym) || {}, info = P(0.6, s.rowY[0] - 0.4, 24);
      hits.push({ x: info[0] - 40, y: info[1] - 40, w: 80, h: 70, html: `<b>${s.icon} ${s.name}</b> · ${S ? esc((S.tf || '').replace('PERIOD_', '')) : '--'} · ${S && S.alive ? 'robô ativo' : 'robô parado'}<br>${poss.length} posição(ões) aberta(s) · hoje ${rb.takes_today || 0} take(s), ${money(rb.pnl_today || 0)} fechado` + (dd ? `<br><span class="mut">Última análise: ${esc(dd.side || '')} ${esc(dd.setup || '')} · ${dd.certainty != null ? dd.certainty + '% · ' : ''}${esc(dd.result === 'ENTROU' ? 'entrou' : dd.result === 'NAO_ENTROU' ? 'não entrou' : 'em verificação')}</span>` : '') });
    });

    walkers.concat(couriers).forEach(w => {
      const wx = w.x + w.ox, wy = w.y + w.oy;
      add(wx + wy + 0.12, () => { person(wx, wy, 0, { ...w.cfg.look, ci: w.cfg.ci != null ? w.cfg.ci : w.cfg.look.ci, dir: w.dir, walk: w.idle <= 0 && !w.wait, wp: w.wp, face: w.face, carry: w.carryNow, mood: 0, ph: w.wp }); });
      const q = P(wx, wy, 52); if (w.emote) tag(4, q[0], q[1] - 6, w.emote, '#e8b64c', 12, { plain: true });
      hits.push({ x: q[0] - 14, y: q[1] - 8, w: 28, h: 52, html: `<b>${esc(w.cfg.name)}</b><br><span class="mut">${esc(w.cfg.desc)}</span>` });
    });
    if (SP()) { add(19.0, () => furnSpr('lamp', 21.2, 0.8, 8)); add(22, () => furnSpr('rack', 0.6, 2.4, 8)); }

    // sala de descanso: quem tomou stop vem para cá (ping-pong, sinuca, café, sofá); o quadro na parede lista os stops de hoje
    const pongPhase = (T / 1.8) % 1, hitPulse = h => { const d = Math.abs(pongPhase - h), dd = Math.min(d, 1 - d); return Math.max(0, 1 - dd / 0.1); }, pongSwing = i => hitPulse(i === 0 ? 0 : 0.5);
    add(30, () => { box(23.6, 5.1, 0, 1.9, 1.1, 11, '#245bb3'); box(23.6, 5.1, 11, 1.9, 1.1, 1.5, '#2f74d8'); ctx.strokeStyle = '#e8edf5'; ctx.lineWidth = 1.2; const a = P(23.6, 5.65, 12.6), b = P(25.5, 5.65, 12.6); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      const tri = pongPhase < 0.5 ? pongPhase * 2 : 2 - pongPhase * 2, bx = 23.4 + tri * 2.3, bz = 13 + 17 * Math.sin(Math.PI * ((pongPhase * 2) % 1)), bp2 = P(bx, 5.65, bz), sh = P(bx, 5.65, 12.6); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(sh[0], sh[1], 2.6, 1.2, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bp2[0], bp2[1], 2.4, 0, 7); ctx.fill(); });
    const poolTurn = Math.floor(T / 3) % 2, poolP = (T % 3) / 3, poolCue = i => { const left = i === 2, active = (poolTurn === 0) === left, dx = left ? 0.894 : -0.894, dy = left ? 0.447 : -0.447; return { dx, dy, pull: active ? Math.max(0, Math.sin(Math.min(1, poolP / 0.5) * Math.PI)) * 7 : -5 }; };
    add(36, () => { box(23.4, 10.6, 0, 2.2, 1.2, 11, '#5a3b22'); box(23.4, 10.6, 11, 2.2, 1.2, 1.5, '#2e8f5b');
      const fromLeft = poolTurn === 0, hit = clamp((poolP - 0.5) / 0.4, 0, 1), ease = 1 - (1 - hit) * (1 - hit), wx = (fromLeft ? 23.7 : 25.3) + ((fromLeft ? 24.7 : 24.3) - (fromLeft ? 23.7 : 25.3)) * ease;
      [[24.85, 11.0, '#e8b64c'], [25.0, 11.25, '#f6465d'], [24.85, 11.5, '#5b9dff']].forEach(([x, y, c], k) => { const mv = hit > 0.6 ? (hit - 0.6) * 0.5 * (fromLeft ? 1 : -1) * (k - 1 === 0 ? 1 : 0.6) : 0, q = P(x + mv, y + (k - 1) * mv * 0.4, 13); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(q[0], q[1], 2, 0, 7); ctx.fill(); });
      const wq = P(wx, 11.2, 13); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(wq[0], wq[1], 2.1, 0, 7); ctx.fill(); });
    add(39, () => { box(26.1, 12.3, 0, 0.7, 0.6, 34, '#2b3a6b'); const f = P(26.6, 12.9, 28); ctx.fillStyle = '#9fd0ff'; ctx.fillRect(f[0] - 6, f[1] - 18, 10, 14); ctx.fillStyle = '#f6465d'; ctx.fillRect(f[0] - 6, f[1] - 2, 10, 2); });
    add(39.5, () => { if (SP() && SP().furn.sofaF) { furnSpr('sofaF', 23.8, 14.7, 24); furnSpr('sofaF', 25.7, 14.7, 24); furnSpr('coffeeTable', 24.8, 16.1, 18); } else { box(22.8, 14.4, 0, 3.8, 0.9, 8, '#7a4b6b'); box(22.8, 15.1, 8, 3.8, 0.3, 10, '#8f5a7e'); } });
    add(21.5, () => { box(19.2, 1.5, 0, 0.5, 0.6, 14, '#cfd6e4'); box(19.2, 1.5, 14, 0.5, 0.6, 5, '#3ec1d3'); });
    add(34.5, () => { if (SP() && furnSpr('coffee', 26.3, 8.3, 14)) return; box(25.9, 8.0, 0, 0.9, 0.7, 12, '#3a3f4d'); box(25.95, 8.02, 12, 0.8, 0.6, 5, '#d63f3f'); });
    add(40, () => plant(26.4, 17.0)); add(39, () => plant(22.7, 17.0)); add(35, () => plant(26.4, 10.2));
    { const q = P(REST.wx, LY.M, 58); tag(6, q[0], q[1], '☕ SALA DE DESCANSO', '#e8a05c', 10); }
    const closedAll = hud.closed || [], stopsL = closedAll.filter(t => !t.win), winsL = closedAll.filter(t => t.win);
    const rslots = [[23.0, 5.65, 'pong'], [26.1, 5.65, 'pong'], [22.9, 11.2, 'pool'], [26.1, 11.2, 'pool'], [23.4, 7.4, 'stand'], [24.6, 7.4, 'stand'], [23.55, 14.55, 'sofa'], [24.05, 14.55, 'sofa'], [25.45, 14.55, 'sofa'], [25.95, 14.55, 'sofa']];
    const person1 = (t, sl, i, kind) => {
      const sd = SYMS.find(s => s.sym === t.sym) || SYMS[0], z = kind === 'sofa' ? 7 : (typeof sl[2] === 'number' ? sl[2] : 0);
      add(sl[0] + sl[1] + 0.3, () => { person(sl[0], sl[1], z, { ...looks(i + 11), shirt: sd.col, mood: t.win ? 1 : -1, ph: i * 1.3, paddle: kind === 'pong' || kind === 'pool', swing: kind === 'pong' ? pongSwing(i) : null, cue: kind === 'pool' ? poolCue(i) : null, face: sl[0] > 24.8 ? -1 : 1, noType: true, sit: kind === 'sofa' }); });
      const q = P(sl[0], sl[1], z + 46); tag(9, q[0], q[1] - 4, money(t.usd || 0), t.win ? UP : DN, 10);
      hits.push({ x: q[0] - 25, y: q[1] - 8, w: 50, h: 60, html: `<b>${sd.icon} ${esc(t.side)} · ${esc(t.setup)}</b><br>${t.win ? '<span class="buy">TAKE</span>' : '<span class="sell">stop</span>'} ${money(t.usd || 0)} (${t.r > 0 ? '+' : ''}${t.r} R) em ${t.minutes} min<br><span class="mut">${esc(t.exit || '')}</span>` });
    };
    stopsL.slice(0, rslots.length).forEach((t, i) => person1(t, rslots[i], i, rslots[i][2]));
    if (stopsL.length > rslots.length) { const q = P(24.5, 8.3, 30); tag(7, q[0], q[1], `+${stopsL.length - rslots.length} stops na fila do café`, '#f6465d', 9); }
    if (!stopsL.length) { const q = P(24.5, 9.8, 34); tag(5, q[0], q[1], 'ninguém tomou stop hoje', '#8a96a8', 9); }
    // sala dos takes: pódio de três degraus, troféu, holofote, balões, confete e mesa de brinde
    add(44, () => {
      const sp = P(18.6, 18.4, 0), g = ctx.createRadialGradient(sp[0], sp[1] - 30, 4, sp[0], sp[1] - 30, 70); g.addColorStop(0, `rgba(255,226,140,${0.22 + 0.06 * Math.sin(T * 2)})`); g.addColorStop(1, 'rgba(255,226,140,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sp[0], sp[1] - 30, 70, 70, 0, 0, 7); ctx.fill();
      box(17.05, 18.3, 0, 1.1, 0.9, 12, '#c0c7d4'); box(19.45, 18.35, 0, 1.1, 0.9, 8, '#b87333'); box(18.05, 17.9, 0, 1.3, 1.1, 19, '#e8b64c');
      const tc = P(18.7, 18.45, 19), bob = Math.sin(T * 3) * 0.6; ctx.fillStyle = '#ffd66b'; ctx.beginPath(); ctx.moveTo(tc[0] - 6, tc[1] - 14 + bob); ctx.lineTo(tc[0] + 6, tc[1] - 14 + bob); ctx.lineTo(tc[0] + 3, tc[1] - 5 + bob); ctx.lineTo(tc[0] - 3, tc[1] - 5 + bob); ctx.closePath(); ctx.fill(); ctx.fillRect(tc[0] - 1.5, tc[1] - 5 + bob, 3, 5); ctx.fillRect(tc[0] - 4, tc[1] - 1 + bob, 8, 2);
      [['1', 18.7, 18.45, 19], ['2', 17.6, 18.75, 12], ['3', 20.0, 18.8, 8]].forEach(([n, x, y, z]) => { const p = P(x, y + 0.5, z - 4); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.font = '800 8px system-ui'; ctx.textAlign = 'center'; ctx.fillText(n, p[0], p[1]); });
      if (!RM && winsL.length) for (let k = 0; k < 18; k++) { const t = (T * 0.55 + k * 0.37) % 1, p = P(16.3 + (k * 0.97) % 4.6, 16.0 + (k * 1.3) % 4.2, 70 - t * 70); ctx.fillStyle = ['#ffd66b', '#2ebd85', '#f6465d', '#5b9dff', '#fff'][k % 5]; ctx.fillRect(p[0] + Math.sin(T * 3 + k) * 3, p[1], 3, 5); }
      ['#f6465d', '#5b9dff', '#2ebd85', '#e8b64c'].forEach((c, k) => { const bxx = [16.2, 21.0, 16.2, 21.0][k], byy = [16.0, 16.0, 20.3, 20.3][k], p = P(bxx, byy, 24 + Math.sin(T * 1.4 + k) * 3 + 12), sw = Math.sin(T * 1.6 + k) * 2; ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p[0], p[1] + 8); ctx.lineTo(p[0] + sw, p[1] + 24); ctx.stroke(); ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(p[0], p[1], 6, 8, 0, 0, 7); ctx.fill(); });
    });
    add(38, () => { box(20.2, 16.4, 0, 0.9, 0.5, 11, '#5a3b22'); [[20.45, 16.6, '#2e8f5b'], [20.75, 16.6, '#e8b64c']].forEach(([x, y, c]) => { const q = P(x, y, 11); ctx.fillStyle = c; ctx.fillRect(q[0] - 1.5, q[1] - 10, 3, 10); ctx.fillStyle = '#e8edf5'; ctx.fillRect(q[0] - 1, q[1] - 12, 2, 3); }); [[20.35, 16.75], [20.95, 16.75]].forEach(([x, y]) => { const q = P(x, y, 11); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(q[0] - 2, q[1] - 5); ctx.lineTo(q[0], q[1]); ctx.lineTo(q[0] + 2, q[1] - 5); ctx.stroke(); }); });
    add(43, () => plant(16.3, 20.2)); add(41, () => plant(21.0, 15.6));
    add(TAKES.x1 + TAKES.y1, () => glassTakes());
    const tslots = [[18.7, 18.45, 19], [17.6, 18.75, 12], [20.0, 18.8, 8], [16.7, 16.9, 0], [20.6, 17.5, 0], [17.3, 20.0, 0], [20.2, 20.0, 0], [18.8, 20.1, 0]];
    winsL.slice(0, tslots.length).forEach((t, i) => person1(t, tslots[i], i + 30, 'win'));
    if (winsL.length > tslots.length) { const q = P(18.6, 20.7, 30); tag(7, q[0], q[1], `+${winsL.length - tslots.length} takes na festa`, '#2ebd85', 9); }
    { const q = P(18.15, TAKES.y0, 60); tag(6, q[0], q[1], '🏆 SALA DOS TAKES', '#e8b64c', 10); }
    if (!winsL.length) { const q = P(18.6, 17.2, 44); tag(5, q[0], q[1], 'nenhum take hoje', '#8a96a8', 9); }

    items.sort((a, b) => a[0] - b[0]).forEach(i => i[1]());
    flushTags();

    if (!motes.length) for (let i = 0; i < 34; i++) motes.push({ x: Math.random() * (GX - 2), y: Math.random() * (GY - 2), z: 10 + Math.random() * 60, sp: 0.1 + Math.random() * 0.2, ph: Math.random() * 6 });
    if (!RM) { motes.forEach(m => { m.x += m.sp * dt * 0.6; m.y += Math.sin(T * 0.3 + m.ph) * dt * 0.15; if (m.x > GX - 1) m.x = 0.3; const q = P(m.x, m.y, m.z + Math.sin(T * 0.7 + m.ph) * 4); ctx.fillStyle = `rgba(255,236,190,${0.12 + 0.1 * Math.sin(T + m.ph)})`; ctx.beginPath(); ctx.arc(q[0], q[1], 1.2, 0, 7); ctx.fill(); });
      for (let i = 0; i < 3; i++) { const t = (T * 0.6 + i / 3) % 1, q = P(26.3, 8.3, 18 + t * 22); ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - t)})`; ctx.beginPath(); ctx.arc(q[0] + Math.sin(T * 3 + i) * 2, q[1], 2 + t * 3, 0, 7); ctx.fill(); } }
    parts = parts.filter(p => p.life > 0);
    parts.forEach(p => { p.life -= dt; p.vy += 14 * dt; p.x += p.vx * 60 * dt; p.y += p.vy * 60 * dt; ctx.globalAlpha = clamp(p.life, 0, 1); ctx.fillStyle = p.c; ctx.beginPath(); if (p.coin) ctx.ellipse(p.x, p.y, p.s + 1, p.s + 2, 0, 0, 7); else ctx.rect(p.x, p.y, p.s, p.s * 1.6); ctx.fill(); ctx.globalAlpha = 1; });
    ctx.setTransform(k, 0, 0, k, 0, 0);   // avisos e vinheta ficam na tela, sem zoom
    if (flash > 0) { ctx.fillStyle = flashCol; ctx.globalAlpha = flash * 0.18; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; flash = Math.max(0, flash - dt * 1.4); }
    if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; else { ctx.globalAlpha = clamp(banner.t, 0, 1); ctx.fillStyle = 'rgba(5,8,13,.82)'; ctx.beginPath(); ctx.roundRect(W / 2 - 230, 70, 460, 86, 18); ctx.fill(); ctx.strokeStyle = banner.col; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = banner.col; ctx.font = '800 34px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(banner.text, W / 2, 105); ctx.font = '600 14px system-ui'; ctx.fillStyle = '#c3cde0'; ctx.fillText(banner.sub, W / 2, 137); ctx.globalAlpha = 1; } }
    const vg = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.38, W / 2, H * 0.52, H * 0.98); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    requestAnimationFrame(frame);
  }

  function directors() {
    const g = n => data[n] && data[n].status && data[n].status.found !== false ? data[n].status : null, X = g('XAUUSDm'), B = g('BTCUSDm'), any = X || B;
    const hier = s => s && s.hierarchy && s.hierarchy.primary ? arrow(s.hierarchy.primary.trend) + arrow(s.hierarchy.secondary.trend) + arrow(s.hierarchy.tertiary.trend) : '--';
    const sentOf = s => s && s.news && s.news.sentiment && s.news.sentiment.has ? s.news.sentiment.score : null;
    const black = [X, B].some(s => s && s.news && s.news.blackout), dd = Math.max((X && X.guards ? X.guards.drawdown_pct : 0) || 0, (B && B.guards ? B.guards.drawdown_pct : 0) || 0);
    const killed = [X, B].some(s => s && s.guards && s.guards.killed), br = any && any.brain;
    const ev = [X, B].map(s => s && s.news && s.news.events && s.news.events[0]).filter(Boolean)[0];
    return [
      { title: 'MACRO', mood: 0, say: `Ouro ${hier(X)} · BTC ${hier(B)}`, tip: `Hierarquia de Dow: mensal / semanal / diário (▲ alta, ▼ baixa)<br>Ouro ${hier(X)} · Bitcoin ${hier(B)}<br><span class="mut">É só um indicador entre vários, nunca a regra.</span>` },
      { title: 'NOTÍCIAS', mood: black ? -1 : 1, say: black ? 'bloqueio de notícia' : `sentimento ${sentOf(X) == null ? '--' : sentOf(X)} / ${sentOf(B) == null ? '--' : sentOf(B)}`, tip: `Sentimento Ouro ${sentOf(X) == null ? '--' : sentOf(X)} · Bitcoin ${sentOf(B) == null ? '--' : sentOf(B)}<br>${black ? 'Bloqueio ativo: sem novas entradas' : 'Sem notícia forte perto'}` + (ev ? `<br><span class="mut">Próxima: ${esc(ev.name)} em ${Math.round(ev.in_min / 60)} h</span>` : '') },
      { title: 'RISCO', mood: killed ? -1 : dd > 5 ? -1 : 1, say: killed ? 'trava de queda!' : `queda ${dd.toFixed(1).replace('.', ',')}% de 10%`, tip: `Queda máxima atual ${dd.toFixed(1)}% (trava em 10%)<br>${killed ? 'TRAVA DISPARADA' : 'Travas livres'}<br><span class="mut">Risco por operação 0,5% · máx. 4 posições por ativo</span>` },
      { title: 'CÉREBRO', mood: br && br.usable ? 1 : 0, say: br && br.usable ? 'modelo confiável' : 'ainda não confiável', tip: `${br && br.usable ? 'Pode influenciar a decisão' : 'Só informa: poder de previsão fora da amostra fraco (AUC ~0,54)'}<br><span class="mut">Treino semanal: Atualizar_cerebro.bat</span>` }
    ];
  }

  function size() { const w = cv.parentElement.clientWidth || W, dpr = Math.min(2, window.devicePixelRatio || 1); cv.style.width = '100%'; cv.style.height = 'auto'; cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr * H / W); cv.style.aspectRatio = W + '/' + H; }
  cv.setAttribute('data-tip', '1');
  let pan = null;
  const clampView = () => { view.z = clamp(view.z, 1, 3); view.x = clamp(view.x, W * (1 - view.z), 0); view.y = clamp(view.y, H * (1 - view.z), 0); };
  function zoomAt(f, mx, my) { const z0 = view.z; view.z = clamp(view.z * f, 1, 3); view.x = mx - (mx - view.x) * view.z / z0; view.y = my - (my - view.y) * view.z / z0; clampView(); }
  cv.addEventListener('mousemove', e => {
    const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * W / r.width, my = (e.clientY - r.top) * H / r.height;
    if (pan) { view.x = pan.vx + (e.clientX - pan.x) * W / r.width; view.y = pan.vy + (e.clientY - pan.y) * H / r.height; clampView(); tip.style.display = 'none'; return; }
    const x = (mx - view.x) / view.z, y = (my - view.y) / view.z; const h = hits.slice().reverse().find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); if (h) showTip(e, h.html); else tip.style.display = 'none';
  });
  cv.addEventListener('pointerdown', e => { if (view.z > 1) { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; } });
  cv.addEventListener('pointerup', () => { pan = null; cv.style.cursor = ''; });
  cv.addEventListener('wheel', e => { if (!e.ctrlKey && !e.shiftKey) return; e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0018), (e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height); }, { passive: false });
  cv.addEventListener('dblclick', () => { view.z = 1; view.x = 0; view.y = 0; });
  [['ofZin', () => zoomAt(1.35, W / 2, H / 2)], ['ofZout', () => zoomAt(1 / 1.35, W / 2, H / 2)], ['ofZre', () => { view.z = 1; view.x = 0; view.y = 0; }]].forEach(([id, fn]) => { const b = document.getElementById(id); if (b) b.onclick = fn; });
  cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  window.addEventListener('resize', () => { if (running) size(); });
  const lblBtn = document.getElementById('ofLbl');
  if (lblBtn) { const sync = () => { lblBtn.setAttribute('aria-pressed', String(showLabels)); lblBtn.textContent = showLabels ? '🏷️ Rótulos: ligados' : '🏷️ Rótulos: só resultados'; }; sync(); lblBtn.onclick = () => { showLabels = !showLabels; try { localStorage.setItem('ofLabels', showLabels ? '1' : '0'); } catch (e) { /* sem armazenamento */ } sync(); }; }

  window.Office = {
    start(o) { HEADLESS = !!(o && o.headless); if (!HEADLESS) size(); if (!walkers.length) initWalkers(); if (!timer) { refresh().catch(() => {}); timer = setInterval(() => refresh().catch(() => {}), 5000); } if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
    stop() { running = false; clearInterval(timer); timer = null; },
    setHeadless(b) { HEADLESS = !!b; },
    api: { SYMS, IND, SLOTS, lastDecision, votes, openPositions, directors, money, goldOpen, arrow, localDay, todayKey, showLabels: () => showLabels, setShowLabels: v => { showLabels = !!v; } },
    once() { size(); if (!walkers.length) initWalkers(); running = true; frame(performance.now()); },
    sim(n) {   // teste: roda a equipe n passos e mede o mais perto que dois andaram e quantas vezes alguém pisou em móvel
      if (!walkers.length) initWalkers();
      const rects = []; SYMS.forEach(sy => { IND.forEach((q, i) => { const x = IX(i), y = sy.rowY[i < 7 ? 0 : 1]; rects.push([x - 0.1, x + 1.0, y - 0.35, y + 0.9]); }); for (let j = 0; j < SLOTS; j++) { const tx = TXJ(j), ty = sy.rowY[Math.floor(j / 2)]; rects.push([tx - 0.1, tx + 1.6, ty - 0.35, ty + 1.0]); } });
      [[2.4, 17.0, 0.6, 2.4], [23.5, 25.6, 5.0, 6.3], [23.3, 25.7, 10.5, 11.9], [22.7, 26.8, 14.3, 15.3], [26.0, 26.9, 12.2, 13.1], [25.9, 26.9, 7.9, 8.7], [1.1, 3.9, 15.7, 16.5], [8.2, 12.6, 15.9, 17.7], [22.1, 22.3, 4.4, 8.45], [22.1, 22.3, 9.55, 17.6], [16.9, 20.7, 17.7, 19.4], [20.1, 21.1, 16.3, 17.0], [19.1, 19.8, 1.4, 2.2]].forEach(r => rects.push(r));
      let minD = 9, onFurn = 0, close = 0, pairs = 0; const samples = [];
      for (let i = 0; i < n; i++) { const all = walkers.concat(couriers); all.forEach(w => stepWalker(w, 0.05, all)); couriers = couriers.filter(c => !c.done); if (i % 400 === 0) spawnCourier(i % 2);
        const pts = walkers.concat(couriers).map(w => [w.x + w.ox, w.y + w.oy]);
        pts.forEach((p, qi) => { if (rects.some(r => p[0] > r[0] && p[0] < r[1] && p[1] > r[2] && p[1] < r[3])) { onFurn++; if (samples.length < 6) samples.push([+p[0].toFixed(2), +p[1].toFixed(2), qi]); } });
        for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) { const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]); pairs++; if (d < minD) minD = d; if (d < 0.35) { close++; if (samples.length < 12) { const A = walkers.concat(couriers); samples.push([A[a].cfg.name.slice(0, 8) + (A[a].idle > 0 ? '*' : ''), A[b].cfg.name.slice(0, 8) + (A[b].idle > 0 ? '*' : ''), +pts[a][0].toFixed(1), +pts[a][1].toFixed(1), A[a].at, A[b].at]); } } } }
      return { minD: +minD.toFixed(2), onFurn, closeSteps: close, pairs, samples };
    },
    setClosed(list) { OV = list; }, refresh, state: () => ({ data, robots, diary, hud, hits, walkers, couriers, banner, flash, running, T, RM, view }), celebrate(win) { seen = seen || new Set(); onTrades([{ pos: 'teste' + Math.random(), sym: 'BTCUSDm', win, usd: win ? 55.5 : -44, r: win ? 3 : -1, side: 'VENDA' }]); }
  };
  if (document.getElementById('p-office').classList.contains('on')) Office.start();
})();
