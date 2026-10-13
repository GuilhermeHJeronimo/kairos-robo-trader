/* Vila do Kairos: o painel como uma vila em pixel art, vista de lado (inspirada em Terraria).
   Casa do Ouro e Casa do Bitcoin (um analista por indicador + um trader por posição aberta) e a Casa Central (macro, notícias, risco e cérebro).
   Analista com opinião fica no posto; sem opinião (mercado neutro) levanta e passeia pela vila. Quem fechou operação hoje passeia: take na Praça dos Takes, stop no Cantinho do Stop.
   Clicar num bonequinho abre o relatório do que ele está analisando. Só lê dados que o painel já tem (/api/robot, /api/robots, /api/robot/diary): não envia comando nenhum. */
(function () {
  'use strict';
  const SYMS = [
    { sym: 'XAUUSDm', name: 'Ouro', icon: '🥇', col: '#e8b64c' },
    { sym: 'BTCUSDm', name: 'Bitcoin', icon: '₿', col: '#f7931a' }
  ];
  const IND = [['estrutura a favor', 'Estrut.'], ['hierarquia forte', 'Hierarq.'], ['medias moveis 21/50', 'Médias'], ['RSI 14', 'RSI'], ['MACD 12/26/9', 'MACD'],
    ['VWAP do dia', 'VWAP'], ['perfil de volume', 'Perfil'], ['liquidez varrida', 'Liquid.'], ['volume acima da media', 'Volume'], ['volatilidade (ATR)', 'ATR'],
    ['padrao de vela', 'Vela'], ['sentimento a favor', 'Sentim.'], ['surpresa da agenda economica', 'Agenda'], ['gap nao preenchido', 'Gap']];
  const INFO = {
    'estrutura a favor': 'Olha o desenho do gráfico: topos e fundos cada vez mais altos (alta) ou mais baixos (baixa). Concorda quando a estrutura aponta para o mesmo lado do sinal.',
    'hierarquia forte': 'Confere a hierarquia de Dow: tendência mensal, semanal e diária. Quanto mais níveis a favor do sinal, mais forte; é só um indicativo, nunca a regra.',
    'medias moveis 21/50': 'Compara o preço com as médias das últimas 21 e 50 velas. Preço acima das duas e média curta acima da longa indica força de alta (o contrário, de baixa).',
    'RSI 14': 'Mede a velocidade das últimas 14 velas, de 0 a 100. Muito alto = esticado (pode cair); muito baixo = cansado (pode subir). No meio, não opina forte.',
    'MACD 12/26/9': 'Compara duas médias para saber se o impulso do preço está crescendo ou perdendo força. O histograma positivo e subindo favorece a compra.',
    'VWAP do dia': 'Preço médio do dia ponderado pelo volume. Preço acima do VWAP: compradores dominam o dia; abaixo: vendedores.',
    'perfil de volume': 'Mostra em quais preços mais se negociou. Esses níveis funcionam como ímãs e como suporte ou resistência.',
    'liquidez varrida': 'Procura o pavio que furou um topo ou fundo anterior (pegou os stops da turma) e voltou. Costuma ser armadilha desfeita e favorece a volta.',
    'volume acima da media': 'Confere se há mais gente negociando que o normal. Movimento com volume é mais confiável que movimento vazio.',
    'volatilidade (ATR)': 'Mede o tamanho médio das velas. Ajuda a saber se o mercado está calmo demais, normal ou agitado demais para entrar.',
    'padrao de vela': 'Reconhece formatos de vela (martelo, engolfo, estrela…) que costumam indicar reversão ou continuação.',
    'sentimento a favor': 'Lê as manchetes e dá uma nota de humor de -100 a +100. Concorda se a notícia aponta para o mesmo lado do sinal.',
    'surpresa da agenda economica': 'Compara o dado econômico divulgado com o esperado. Surpresa grande move o preço na hora.',
    'gap nao preenchido': 'Procura buracos de preço (gaps) ainda abertos, que o preço costuma voltar para fechar.'
  };
  const W = 1880, OFFX = 100, H = 940, FY = { 1: 700, 2: 570, 3: 440 }, CEIL3 = 312, LANE = [738, 762], SURF = 712, UNDER = 776;
  const RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const UP = '#2ebd85', DN = '#f6465d', NEU = '#7a8599';
  const cv = document.getElementById('ofCanvas'), main = cv.getContext('2d');
  let g = main;
  let showLabels = true; try { showLabels = localStorage.getItem('ofLabels') !== '0'; } catch (e) { /* sem armazenamento */ }
  let view = { z: 1, x: 0, y: 0 }, HEADLESS = false, timer = null, data = {}, diary = null, running = false, T = 0, last = 0, hits = [], hud = {}, parts = [], banner = null, flash = 0, flashCol = UP;
  let OV = null, seen = null, loaded = false, chars = [], selId = null, bg = null, bgS = 1, clouds = [], birds = [], flies = [], lastRep = 0, cid = 0;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const money = v => (v > 0 ? '+$' : v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = v => (v > 0 ? '+$' : v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 });
  const FONT = 'system-ui,"Segoe UI",sans-serif', EMO = '"Segoe UI Emoji","Apple Color Emoji",system-ui,sans-serif';
  function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { const A = hexRGB(a), B = hexRGB(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; }
  function shade(h, f) { const c = hexRGB(h).map(v => Math.round(f < 1 ? v * f : v + (255 - v) * (f - 1))); return `rgb(${c[0]},${c[1]},${c[2]})`; }
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function text(t, x, y, col, px, weight, align, font) { g.font = `${weight || 700} ${px}px ${font || FONT}`; g.fillStyle = col; g.textAlign = align || 'left'; g.textBaseline = 'middle'; g.fillText(t, x, y); }
  function fit(t, maxW, px, weight) { g.font = `${weight || 700} ${px}px ${FONT}`; const w = g.measureText(t).width; return w > maxW ? Math.max(6, px * maxW / w) : px; }
  function emoji(e, x, y, px) { g.font = `${px}px ${EMO}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(e, x, y); }

  /* ---------- sprites 2D do Open Pixel Project (domínio público): papel de parede, telhado, janelas, barracas, fonte ---------- */
  const IMGS = {}, TC = {}, IMG_N = ['tile_wall', 'tile_village_house', 'tile_village_objects', 'obj_indoors', 'tile_room', 'tile_village_fountain'];
  IMG_N.forEach(n => { const im = new Image(); im.onload = () => { IMGS[n] = im; if (Object.keys(IMGS).length === IMG_N.length && bg) { buildStatic(); } }; im.src = '/assets2d/opp/' + n + '.png'; });
  function crop(n, sx, sy, sw, sh) { const k = [n, sx, sy, sw, sh].join(); if (!TC[k] && IMGS[n]) { const c = document.createElement('canvas'); c.width = sw; c.height = sh; c.getContext('2d').drawImage(IMGS[n], sx, sy, sw, sh, 0, 0, sw, sh); TC[k] = c; } return TC[k]; }
  function spr(n, sx, sy, sw, sh, dx, dy, dw, dh, flip) { const c = crop(n, sx, sy, sw, sh); if (!c) return false; g.imageSmoothingEnabled = false; dw = dw || sw; dh = dh || sh; if (flip) { g.save(); g.translate(dx + dw, dy); g.scale(-1, 1); g.drawImage(c, 0, 0, dw, dh); g.restore(); } else g.drawImage(c, dx, dy, dw, dh); return true; }
  function fillPat(n, sx, sy, sw, sh, x, y, w, h) { const c = crop(n, sx, sy, sw, sh); if (!c) return false; g.fillStyle = g.createPattern(c, 'repeat'); g.fillRect(x, y, w, h); return true; }
  const LAMPS = [];

  /* ---------- hora de Brasília (UTC-3 fixo) e céu ---------- */
  const BR = -3 * 3600;
  function brKey(sec) { const d = new Date((sec + BR) * 1000); return d.getUTCFullYear() + '-' + (d.getUTCMonth() + 1) + '-' + d.getUTCDate(); }
  const todayKey = () => brKey(Date.now() / 1000);
  function brHour() { const d = new Date(Date.now() + BR * 1000); return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600; }
  const SKY = [[0, '#050a1c', '#0e1a3a'], [5, '#1c2450', '#d98a6a'], [7, '#4a8fe0', '#c4e6ff'], [12, '#3f86dc', '#b4e3ff'], [17, '#4a6fc0', '#f0b070'], [19, '#35306b', '#e58a5c'], [21, '#050a1c', '#0e1a3a'], [24, '#050a1c', '#0e1a3a']];
  function skyAt(h) { for (let i = 0; i < SKY.length - 1; i++) { const a = SKY[i], b = SKY[i + 1]; if (h >= a[0] && h <= b[0]) { const t = (h - a[0]) / (b[0] - a[0]); return [mix(a[1], b[1], t), mix(a[2], b[2], t)]; } } return [SKY[0][1], SKY[0][2]]; }
  const nightF = h => h < 5 || h >= 20 ? 1 : h < 7 ? 1 - (h - 5) / 2 : h >= 18 ? (h - 18) / 2 : 0;

  /* ---------- planta da vila ---------- */
  const CW = 112;   // largura da coluna da escada
  const HOUSES = [
    { id: 'gold', name: 'CASA DO OURO', ico: '🥇', x0: 44, x1: 550, side: 1, col: '#e8b64c', roof: '#c58a1c', wall: '#4d4128', wall2: '#43381f', doors: [1], si: 0, wp: 192, tint: 'rgba(40,24,6,.30)', rp: [96, 125] },
    { id: 'core', name: 'CENTRAL', ico: '🏛️', x0: 676, x1: 1006, side: 1, col: '#5b9dff', roof: '#3d6fb3', wall: '#2f3b55', wall2: '#283249', doors: [-1, 1], si: -1, wp: 128, tint: 'rgba(20,34,90,.46)', rp: [224, 29] },
    { id: 'btc', name: 'CASA DO BITCOIN', ico: '₿', x0: 1132, x1: 1638, side: -1, col: '#f7931a', roof: '#d9640f', wall: '#53382a', wall2: '#472f23', doors: [-1], si: 1, wp: 0, tint: 'rgba(130,56,0,.42)', rp: [96, 29] }
  ];
  HOUSES.forEach(h => {
    h.cL = h.side > 0 ? h.x1 - 8 - CW : h.x0 + 8; h.cR = h.cL + CW;
    h.aL = h.side > 0 ? h.x0 + 8 : h.cR; h.aR = h.side > 0 ? h.cL : h.x1 - 8;
    h.A1 = h.side > 0 ? h.cL + 6 : h.cR - 6; h.B1 = h.side > 0 ? h.cR - 12 : h.cL + 12; h.C = h.side > 0 ? h.cL + 12 : h.cR - 12;
    h.nst = h.id === 'core' ? 2 : 7; h.cx = (h.x0 + h.x1) / 2;
  });
  const HG = { gold: HOUSES[0], core: HOUSES[1], btc: HOUSES[2] };
  const stX = (h, k, n) => { const sp = (h.aR - h.aL) / (n || h.nst); return h.aL + sp * (k + 0.5) - 7; };
  const PODIUM = { cx: 613, y: 744 }, BENCH = { x: 1020, w: 66 }, FIRE = { x: 1108, y: 748 };
  const POIS = [-60, -10, 40, 120, 230, 330, 430, 520, 590, 640, 700, 790, 880, 950, 1030, 1100, 1160, 1250, 1340, 1430, 1530, 1620, 1700, 1760];

  /* ---------- dados ---------- */
  function lastDecision(js) { const ev = (js && js.journal && js.journal.events) || []; for (const e of ev) if (e.decision && e.decision.checks && e.decision.checks.length > 6) return e; return null; }
  function votes(dec) { const m = {}; if (!dec) return m; (dec.decision.checks || []).forEach(c => { m[c.name] = c; }); return m; }
  const epoch = t => { if (!t) return 0; const m = String(t).match(/(\d{4})\D(\d\d)\D(\d\d)\D+(\d\d):(\d\d)(?::(\d\d))?/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) / 1000 : 0; };
  const localDay = t => { const e = epoch(t); return e ? brKey(e) : ''; };
  function goldOpen() { const d = new Date(), wd = d.getUTCDay(), h = d.getUTCHours() + d.getUTCMinutes() / 60; if (wd === 6) return false; if (wd === 0 && h < 22) return false; if (wd === 5 && h >= 21) return false; return true; }
  const arrow = t => t > 0 ? '▲' : t < 0 ? '▼' : '▬';
  const stOf = sym => { const js = data[sym]; return js && js.status && js.status.found !== false ? js.status : null; };
  function openPositions(S) { if (!S) return []; const l = Array.isArray(S.positions) ? S.positions : (S.position && S.position.open ? [S.position] : []); return l.filter(p => p && p.open !== false); }
  const hierTxt = s => s && s.hierarchy && s.hierarchy.primary ? arrow(s.hierarchy.primary.trend) + arrow(s.hierarchy.secondary.trend) + arrow(s.hierarchy.tertiary.trend) : '--';

  function directors() {
    const X = stOf('XAUUSDm'), B = stOf('BTCUSDm'), any = X || B;
    const sentOf = s => s && s.news && s.news.sentiment && s.news.sentiment.has ? s.news.sentiment.score : null;
    const black = [X, B].some(s => s && s.news && s.news.blackout), dd = Math.max((X && X.guards ? X.guards.drawdown_pct : 0) || 0, (B && B.guards ? B.guards.drawdown_pct : 0) || 0);
    const killed = [X, B].some(s => s && s.guards && s.guards.killed), br = any && any.brain;
    const ev = [X, B].map(s => s && s.news && s.news.events && s.news.events[0]).filter(Boolean)[0];
    const lv = s => s && s.hierarchy && s.hierarchy.primary ? [s.hierarchy.primary, s.hierarchy.secondary, s.hierarchy.tertiary].map(l => `<li><b>${esc(l.tf)}</b> ${arrow(l.trend)} ${esc(l.text)} <span class="mut">${esc(l.how || '')}</span></li>`).join('') : '<li class="mut">sem leitura</li>';
    return [
      { key: 'macro', title: 'Analista Macro', short: 'MACRO', ico: '🌎', mood: any ? 0 : 0, floor: 2, k: 0, hat: 'cap', shirt: '#2f4f8f', say: `Ouro ${hierTxt(X)} · BTC ${hierTxt(B)}`,
        what: 'Olha o quadro grande pela hierarquia de Dow: tendência mensal, semanal e diária (▲ alta, ▼ baixa). É só um indicativo entre vários, nunca a regra.',
        html: `<b>Ouro</b> ${hierTxt(X)}<ul>${lv(X)}</ul><b>Bitcoin</b> ${hierTxt(B)}<ul>${lv(B)}</ul>` },
      { key: 'news', title: 'Analista de Notícias', short: 'NOTÍCIAS', ico: '📰', mood: black ? -1 : 1, floor: 2, k: 1, hat: 'press', shirt: '#2e7d5b', say: black ? 'bloqueio de notícia' : `sentimento ${sentOf(X) == null ? '--' : sentOf(X)} / ${sentOf(B) == null ? '--' : sentOf(B)}`,
        what: 'Lê manchetes e o calendário econômico. Se um dado forte está perto, bloqueia novas entradas para o robô não operar no susto.',
        html: `Sentimento: Ouro <b>${sentOf(X) == null ? '--' : sentOf(X)}</b> · Bitcoin <b>${sentOf(B) == null ? '--' : sentOf(B)}</b><br>${black ? '<b class="sell">Bloqueio ativo:</b> sem novas entradas.' : 'Sem notícia forte por perto: liberado.'}` + (ev ? `<br><span class="mut">Próxima: ${esc(ev.name)} em ${ev.in_min >= 90 ? Math.round(ev.in_min / 60) + ' h' : ev.in_min + ' min'}</span>` : '') },
      { key: 'risk', title: 'Gerente de Risco', short: 'RISCO', ico: '🛡️', mood: killed ? -1 : dd > 5 ? -1 : 1, floor: 1, k: 0, hat: 'helmet', shirt: '#a33a3a', say: killed ? 'trava de queda!' : `queda ${dd.toFixed(1).replace('.', ',')}% de 10%`,
        what: 'Protege a conta: limita risco por operação, perdas seguidas, queda do dia e queda máxima. Se uma trava dispara, o robô para de abrir posições.',
        html: `Queda máxima atual <b>${dd.toFixed(1).replace('.', ',')}%</b> (trava em 10%)<br>${killed ? '<b class="sell">TRAVA DISPARADA</b>' : 'Travas livres'}<br><span class="mut">Risco por operação 0,5% · máx. 4 posições por ativo</span>` },
      { key: 'brain', title: 'Cérebro (modelo)', short: 'CÉREBRO', ico: '🧠', mood: br && br.usable ? 1 : 0, floor: 1, k: 1, hat: 'wizard', shirt: '#6a4bb0', say: br && br.usable ? 'modelo confiável' : 'ainda não confiável',
        what: 'Modelo estatístico treinado com o histórico dos 14 indicadores. Se o poder de previsão fora da amostra for fraco, ele só informa e não influencia a decisão.',
        html: br ? `Modo ${br.mode} · carregado ${br.loaded ? 'sim' : 'não'} · ${br.usable ? '<b class="buy">pode influenciar</b>' : '<b>só informa</b>'}<br>AUC fora da amostra: <b>${br.auc == null ? '--' : Number(br.auc).toFixed(2).replace('.', ',')}</b> (0,50 = chute)<br><span class="mut">Treino semanal: Atualizar_cerebro.bat</span>` : 'sem dados do cérebro' }
    ];
  }

  async function refresh() {
    const [a, b] = await Promise.all(SYMS.map(s => fetch('/api/robot?sym=' + s.sym).then(x => x.json())));
    data = { XAUUSDm: a, BTCUSDm: b };
    if (!diary || Date.now() - (diary._at || 0) > 15000) { const d = await fetch('/api/robot/diary').then(x => x.json()); if (d && d.trades) { d._at = Date.now(); diary = d; onTrades(d.trades); } }
    loaded = true; updateHud(); syncChars(); if (selId) renderReport();
  }
  function onTrades(trades) {
    if (seen === null) { seen = new Set(trades.map(t => t.pos)); return; }
    trades.forEach(t => {
      if (seen.has(t.pos)) return; seen.add(t.pos);
      const sd = SYMS.find(s => s.sym === t.sym) || SYMS[0], w = t.win;
      flash = 1; flashCol = w ? UP : DN; banner = { t: 3.4, text: w ? '🎉 TAKE! ' + money(t.usd) : '💥 STOP ' + money(t.usd), col: w ? UP : DN, sub: sd.name + ' · ' + t.side + ' · ' + (t.r > 0 ? '+' : '') + t.r + ' R' };
      const o = w ? { x: PODIUM.cx, y: 700 } : { x: FIRE.x, y: 720 };
      for (let i = 0; i < (RM ? 0 : w ? 90 : 26); i++) parts.push({ x: o.x, y: o.y, vx: (Math.random() - 0.5) * (w ? 260 : 90), vy: -Math.random() * (w ? 330 : 120) - 40, life: 1.8 + Math.random(), c: w ? ['#e8b64c', '#2ebd85', '#5b9dff', '#fff', '#f7931a'][i % 5] : '#8a94a6', s: 3 + Math.random() * 3, coin: w && i % 4 === 0, g: w ? 520 : 200 });
      if (typeof toast === 'function') toast((w ? '🎉 TAKE no ' : '💥 Stop no ') + sd.name + ': ' + money(t.usd) + ' (' + (t.r > 0 ? '+' : '') + t.r + ' R)', w ? 'ok' : 'err');
    });
  }
  function updateHud() {
    const st = SYMS.map(s => stOf(s.sym)).filter(s => s && s.account);
    if (!st.length) return;
    const alive = st.find(s => s.alive) || st[0], acc = alive.account, tg = alive.target || {};
    const flo = st.reduce((s, x) => s + openPositions(x).reduce((q, p) => q + (p.profit || 0), 0), 0), nOpen = st.reduce((s, x) => s + openPositions(x).length, 0);
    const closed = OV || (diary ? diary.trades : []).filter(t => localDay(t.close_t) === todayKey());
    const fecha = closed.reduce((s, t) => s + (t.usd || 0), 0), takes = closed.filter(t => t.win).length;
    hud = { eq: acc.equity, gain: tg.gain || 0, usd: tg.usd || 0, hit: tg.hit, flo, fecha, takes, n: closed.length, closed, nOpen };
    cv.setAttribute('aria-label', `Vila do Kairos: ${nOpen} posição(ões) aberta(s), ${takes} take(s) em ${hud.n} operação(ões) fechada(s) hoje, resultado do dia US$ ${hud.gain.toFixed(2)}.`);
    const set = (id, h) => { const el = document.getElementById(id); if (el) el.innerHTML = h; };
    const pct = hud.usd > 0 ? clamp(100 * hud.gain / hud.usd, 0, 100) : 0;
    set('ofEq', `<span>Patrimônio</span><b>US$ ${f2(hud.eq)}</b>`);
    set('ofDay', `<span>Hoje (fechado + aberto)</span><b class="${cl(hud.gain)}">US$ ${sg(hud.gain)}</b>`);
    set('ofGoal', `<span>Meta do dia ${hud.usd > 0 ? 'US$ ' + f2(hud.usd) : '(sem meta)'}</span><div class="ofbar"><i style="width:${pct}%"></i></div><b>${pct.toFixed(0)}%${hud.hit ? ' ✅' : ''}</b>`);
    set('ofTk', `<span>Posições abertas · takes hoje</span><b>${nOpen} · ${takes}/${hud.n}</b>`);
    const tk = document.getElementById('ofTicker');
    if (tk) tk.innerHTML = `RESULTADO FECHADO HOJE <b class="${cl(fecha)}">${money(fecha)}</b> · RESULTADO FLUTUANTE <b class="${cl(flo)}">${money(flo)}</b> · OURO: <b>${goldOpen() ? 'MERCADO ABERTO' : 'MERCADO FECHADO'}</b> · BITCOIN: <b>MERCADO ABERTO 24H</b> · ATUALIZADO ÀS ${new Date().toLocaleTimeString('pt-BR')}`;
  }

  /* ---------- moradores ---------- */
  const SKIN = ['#f1c9a5', '#e0a77d', '#c58a5f', '#8d5a3b', '#f6d9bd'], HAIR = ['#2a1d14', '#6b3b1d', '#c9a227', '#7a2d2d', '#1a1a22', '#a8561f', '#d8d8de', '#3b2a5a'];
  function mkLook(seed, shirt, o) { return Object.assign({ skin: SKIN[Math.floor(hash(seed) * SKIN.length)], hair: HAIR[Math.floor(hash(seed + 5) * HAIR.length)], shirt, pants: pick(['#232a3b', '#3a3350', '#2f3b2f', '#40372a']), style: Math.floor(hash(seed + 9) * 4), glasses: hash(seed + 3) > 0.7 }, o || {}); }
  function mkChar(o) { const c = Object.assign({ id: 'c' + (cid++), x: 0, y: 0, dir: 1, path: [], state: 'work', t: 0, timer: 0, ph: Math.random() * 6, emote: null, emT: 0, mood: null, speed: rnd(40, 50), lane: rnd(LANE[0], LANE[1]), away: false, sit: false }, o); chars.push(c); return c; }
  const home = c => ({ x: c.hx, y: FY[c.floor] });
  function laneY() { return rnd(LANE[0], LANE[1]); }
  function pathOut(c, tx) {   // do posto até a rua (ponto na rua em tx)
    const h = c.house, pts = []; if (c.floor >= 3) { pts.push({ x: h.C, y: FY[3] }); pts.push({ x: h.B1, y: FY[2] }); } else if (c.floor === 2) pts.push({ x: h.B1, y: FY[2] });
    if (c.floor >= 2) pts.push({ x: h.A1, y: FY[1] });
    return pts.concat(doorOut(h, tx));
  }
  function doorOut(h, tx) { const d = h.doors.slice().sort((a, b) => Math.abs((h.id === 'core' ? (a === 1 ? h.x1 : h.x0) : (a === 1 ? h.x1 : h.x0)) + a * 30 - tx) - Math.abs((b === 1 ? h.x1 : h.x0) + b * 30 - tx))[0], wx = d === 1 ? h.x1 : h.x0; return [{ x: wx - d * 16, y: FY[1] }, { x: wx + d * 12, y: FY[1] }, { x: wx + d * 34, y: laneY() }]; }
  function pathIn(c, fromX) {   // da rua até o posto
    const h = c.house, d = h.doors.slice().sort((a, b) => Math.abs((a === 1 ? h.x1 : h.x0) + a * 30 - fromX) - Math.abs((b === 1 ? h.x1 : h.x0) + b * 30 - fromX))[0], wx = d === 1 ? h.x1 : h.x0;
    const pts = [{ x: wx + d * 34, y: laneY() }, { x: wx + d * 12, y: FY[1] }, { x: wx - d * 16, y: FY[1] }];
    pts.push({ x: h.A1, y: FY[1] }); if (c.floor >= 2) pts.push({ x: h.B1, y: FY[2] }); if (c.floor >= 3) pts.push({ x: h.C, y: FY[3] });
    pts.push({ x: c.hx, y: FY[c.floor] }); return pts;
  }
  function outsideNow(c) { return c.y > 725; }
  function moveTo(c, pts) { c.path = pts.slice(); }
  function strollTo(c) { c.path = [{ x: clamp(pick(POIS) + rnd(-30, 30), 24 - OFFX, W - OFFX - 24), y: laneY() }]; }

  function syncChars() {
    // analistas e diretores (criados uma vez)
    if (!chars.some(c => c.kind === 'an')) {
      SYMS.forEach((s, si) => { const h = HOUSES[si * 2]; IND.forEach((ind, i) => { const floor = i < 7 ? 1 : 2, k = i % 7; mkChar({ kind: 'an', si, ind: i, house: h, floor, hx: stX(h, k, 7), x: stX(h, k, 7), y: FY[floor], look: mkLook(si * 40 + i + 1, mix(s.col, ['#2f5fa8', '#7a2d4a', '#2a7d5b', '#4a3f8f', '#8a4a2a'][i % 5], 0.12 + 0.22 * hash(i + si * 9)), { glasses: i % 5 === 1 }), timer: rnd(3, 16), role: 'analista' }); }); });
      directors().forEach((d, i) => { const h = HG.core; mkChar({ kind: 'dir', dkey: d.key, house: h, floor: d.floor, hx: stX(h, d.k, 2), x: stX(h, d.k, 2), y: FY[d.floor], look: mkLook(200 + i, d.shirt, { hat: d.hat, glasses: d.key !== 'risk' }), timer: rnd(8, 30), role: d.title }); });
    }
    // traders: um por posição aberta
    SYMS.forEach((s, si) => {
      const S = stOf(s.sym), pos = openPositions(S), h = HOUSES[si * 2];
      pos.forEach(p => {
        let c = chars.find(q => q.kind === 'tr' && q.tk === String(p.ticket));
        if (!c) { const used = chars.filter(q => q.kind === 'tr' && q.si === si).map(q => q.slot); let slot = 0; while (used.includes(slot)) slot++; const hx = stX(h, slot, 4);
          c = mkChar({ kind: 'tr', si, tk: String(p.ticket), slot, house: h, floor: 3, hx, x: hx, y: FY[3], look: mkLook(si * 30 + slot + 61, '#27324a', { tie: s.col, hat: 'head' }), timer: rnd(6, 16), role: 'trader' });
          if (loaded && seen) { c.x = h.x0 + (h.doors[0] === 1 ? h.x1 - h.x0 + 34 : -34); c.y = laneY(); c.state = 'comeIn'; c.path = pathIn(c, c.x); }
        } c.pos = p; });
      chars.filter(q => q.kind === 'tr' && q.si === si && !pos.some(p => String(p.ticket) === q.tk) && q.state !== 'fin').forEach(q => { q.gone = (q.gone || 0) + 1; });
    });
    // finalizados de hoje
    const closed = hud.closed || [], wins = closed.filter(t => t.win).sort((a, b) => b.usd - a.usd), loss = closed.filter(t => !t.win).sort((a, b) => (a.close_t < b.close_t ? 1 : -1));
    const keep = new Set();
    [wins.slice(0, 14), loss.slice(0, 14)].forEach(list => list.forEach((t, i) => {
      keep.add(String(t.pos)); let c = chars.find(q => q.fk === String(t.pos));
      if (!c) { c = chars.find(q => q.kind === 'tr' && q.tk === String(t.pos)); if (c) { c.kind = 'fin'; c.fk = String(t.pos); c.state = 'fin'; } }
      if (!c) { const sd = SYMS.findIndex(s => s.sym === t.sym), x = rnd(60 - OFFX, W - OFFX - 60); c = mkChar({ kind: 'fin', fk: String(t.pos), si: Math.max(0, sd), x, y: laneY(), look: mkLook(t.pos % 997, (SYMS[Math.max(0, sd)] || SYMS[0]).col, { tie: '#fff' }), state: 'fin', timer: rnd(0, 6), role: t.win ? 'take' : 'stop' }); }
      c.t = t; c.win = !!t.win; c.rank = i; c.look.shirt = c.win ? mix(SYMS[c.si].col, '#2ebd85', 0.35) : mix('#5b6577', SYMS[c.si].col, 0.15); c.speed = c.win ? rnd(46, 58) : rnd(24, 32);
      if (c.house) { c.house = null; c.floor = 0; }
      if (!c.fstate) { c.fstate = 'stroll'; if (c.rank < 3) c.fstate = 'perch'; c.timer = rnd(0, 4); }
      if (c.fresh === undefined && loaded && c.fresh !== false) c.fresh = false;
    }));
    chars.filter(q => q.kind === 'fin' && !keep.has(q.fk)).forEach(q => { q.dead = true; });
    chars.filter(q => q.kind === 'tr' && q.gone > 12).forEach(q => { q.dead = true; });
    chars = chars.filter(q => !q.dead); if (selId && !chars.some(q => q.id === selId)) closeReport();
  }

  /* ---------- humor de quem analisa ---------- */
  function analystMood(c) {
    if (!loaded) return null;
    const s = SYMS[c.si], S = stOf(s.sym); if (!S || !S.alive) return 0; if (c.si === 0 && !goldOpen()) return 0;
    const dec = lastDecision(data[s.sym]), v = dec ? votes(dec)[IND[c.ind][0]] : null; if (!v) return 0;
    return v.status === 'ok' ? 1 : v.status === 'neutro' ? 0 : -1;
  }
  const dirMood = c => { const d = directors().find(x => x.key === c.dkey); return d ? d.mood : 0; };

  /* ---------- movimento ---------- */
  function follow(c, dt) {
    if (!c.path.length) return false;
    const p = c.path[0], dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy), sp = c.speed * dt;
    if (Math.abs(dx) > 0.5) c.dir = dx > 0 ? 1 : -1;
    if (d <= sp) { c.x = p.x; c.y = p.y; c.path.shift(); } else { c.x += dx / d * sp; c.y += dy / d * sp; }
    c.ph += dt * 10; return true;
  }
  function step(c, dt) {
    c.t += dt; c.timer -= dt; if (c.emT > 0) { c.emT -= dt; if (c.emT <= 0) c.emote = null; }
    const moving = c.path.length > 0; c.walking = false;
    if (c.kind === 'an' || c.kind === 'dir') {
      const mood = c.kind === 'an' ? analystMood(c) : dirMood(c); const prev = c.mood; if (mood !== null) c.mood = mood;
      if (prev !== null && prev !== undefined && mood !== null && prev !== mood && c.state === 'work') { c.emote = mood > 0 ? '✔' : mood < 0 ? '✖' : '…'; c.emT = 3; }
      if (c.state === 'work') {
        if (c.mood === 0 && c.timer <= 0 && loaded) { c.state = 'out'; c.speed = rnd(42, 52); const tx = pick(POIS); moveTo(c, pathOut(c, tx)); c.strollEnd = T + rnd(14, 34); c.timer = 0; c.emote = pick(['☕', '🚶', '💭']); c.emT = 2; }
        else if (c.mood !== 0 && c.timer <= 0) c.timer = rnd(4, 12);
      } else if (c.state === 'out' || c.state === 'stroll') {
        if (follow(c, dt)) { c.walking = true; if (c.state === 'out' && outsideNow(c)) c.state = 'stroll'; }
        else if (c.state === 'stroll') {
          if (c.idleT === undefined) c.idleT = rnd(1.5, 5), c.emote = pick(['💬', '🌼', '☀️', '🎵', '🙂', null]), c.emT = 2;
          c.idleT -= dt; if (c.idleT <= 0) { c.idleT = undefined; if ((c.mood !== 0 && c.mood !== null) || T > c.strollEnd) { c.state = 'back'; moveTo(c, pathIn(c, c.x)); } else strollTo(c); }
        }
        if (c.state === 'stroll' && c.mood !== 0 && c.mood !== null && c.path.length) { c.state = 'back'; moveTo(c, pathIn(c, c.x)); }
      } else if (c.state === 'back') {
        if (follow(c, dt)) c.walking = true; else { c.state = 'work'; c.x = c.hx; c.y = FY[c.floor]; c.timer = rnd(5, 14); c.dir = 1; }
      }
    } else if (c.kind === 'tr') {
      if (c.state === 'comeIn') { if (follow(c, dt)) c.walking = true; else { c.state = 'work'; c.timer = rnd(6, 14); } }
      else { c.sit = true; if (c.timer <= 0 && !c.path.length) { if (c.wander) { c.wander = false; c.path = [{ x: c.hx, y: FY[3] }]; c.timer = rnd(8, 16); } else { c.wander = true; c.sit = false; c.path = [{ x: c.hx + rnd(-26, 26), y: FY[3] }]; c.timer = 1.6; } }
        if (c.path.length) { c.sit = false; follow(c, dt); c.walking = true; } else if (c.wander) c.sit = false; }
    } else if (c.kind === 'fin') {
      if (c.fstate === 'perch') {
        if (!c.perchOK) { if (!c.perchSet) { c.path = perchPath(c); c.perchSet = true; c.sit = false; } if (follow(c, dt)) c.walking = true; else { c.perchOK = true; c.timer = rnd(20, 40); c.dir = 1; } }
        else { perchPose(c, dt); if (c.timer <= 0) { c.fstate = 'stroll'; c.perchOK = false; c.perchSet = false; c.sit = false; c.jump = 0; c.timer = rnd(25, 50); strollTo(c); } }
      } else {
        if (follow(c, dt)) c.walking = true; else { if (c.idleT === undefined) c.idleT = rnd(1.5, 5), c.emote = c.win ? pick(['🪙', '😄', '🎉', null]) : pick(['😔', '☁️', null, null]), c.emT = 2.2; c.idleT -= dt; if (c.idleT <= 0) { c.idleT = undefined; strollTo(c); } }
        if (c.timer <= 0 && c.rank < 3 && !c.path.length) { c.fstate = 'perch'; c.perchOK = false; c.perchSet = false; }
        else if (c.timer <= 0 && c.rank >= 3) c.timer = rnd(20, 40);
      }
    }
  }
  function perchPath(c) {
    if (c.win) { const bx = [PODIUM.cx, PODIUM.cx - 33, PODIUM.cx + 33][c.rank], hh = [34, 22, 12][c.rank]; return [{ x: bx, y: PODIUM.y + 6 }, { x: bx, y: PODIUM.y + 6 - hh }]; }
    return [{ x: BENCH.x + 14 + c.rank * 22, y: 740 }];
  }
  function perchPose(c, dt) { c.walking = false; if (c.win) { c.jump = Math.max(0, Math.sin(c.t * 5 + c.rank)) * 10; c.dir = 1; } else { c.sit = true; c.dir = 1; } }

  /* ---------- desenho: cenário estático (pré-renderizado) ---------- */
  function pixCloud(x, y, s, a) { g.globalAlpha = a; R(x, y + 8 * s, 44 * s, 8 * s, '#fff'); R(x + 6 * s, y + 2 * s, 14 * s, 8 * s, '#fff'); R(x + 18 * s, y, 16 * s, 12 * s, '#fff'); R(x + 30 * s, y + 5 * s, 10 * s, 6 * s, '#fff'); g.globalAlpha = 1; }
  function drawHills() {
    [['#4f6b9a', 0.9, 120, 520, 0.011], ['#3c6b5a', 0.8, 90, 560, 0.017]].forEach(([c, , amp, base, f], li) => {
      g.fillStyle = c; for (let x = 0; x < W; x += 12) { const hgt = amp * (0.55 + 0.45 * Math.sin(x * f + li * 2.1) * Math.cos(x * f * 0.37 + li)) + 50; const top = SURF - Math.round(hgt / 12) * 12; g.fillRect(x, top, 12, SURF - top); }
    });
  }
  function drawTree(x, base, k, kind) {
    const h = 90 + hash(k) * 50;
    if (kind === 'pine') { R(x - 4, base - 30, 8, 30, '#6b4423'); for (let i = 0; i < 5; i++) { const w = 48 - i * 8; R(x - w / 2, base - 26 - i * 17, w, 17, i % 2 ? '#2f7d3f' : '#276a35'); } R(x - 4, base - 112, 8, 6, '#3a8f4b'); return; }
    R(x - 5, base - h * 0.55, 10, h * 0.55, '#6b4423'); R(x - 5, base - h * 0.55, 3, h * 0.55, '#8a5a30'); R(x - 8, base - 6, 16, 6, '#6b4423');
    const cy = base - h * 0.55; [[-34, -2, 68, 26], [-26, -26, 52, 26], [-16, -46, 32, 22], [-38, 14, 76, 14]].forEach(([dx, dy, w, hh], i) => R(x + dx, cy + dy, w, hh, i % 2 ? '#3f9b3a' : '#4caf3b'));
    R(x - 22, cy - 18, 10, 8, '#6ad04a'); R(x + 8, cy - 4, 12, 8, '#6ad04a');
  }
  function drawGround() {
    R(0, SURF, W, 30, '#4caf3b'); R(0, SURF, W, 5, '#6ad04a');
    for (let x = 0; x < W; x += 8) { const hh = 2 + Math.floor(hash(x) * 5); R(x, SURF - hh, 3, hh, '#5cc04a'); }
    R(0, 742 - 8, W, 38, '#a9824f'); R(0, 742 - 8, W, 3, '#c29a63'); R(0, 772, W, 4, '#8b6a3c');
    for (let i = 0; i < 90; i++) { const x = hash(i * 3) * W, y = 738 + hash(i * 7) * 28; R(x, y, 4 + hash(i) * 5, 2 + hash(i + 1) * 2, hash(i + 2) > 0.5 ? '#8f6b3d' : '#c7a06a'); }
    for (let i = 0; i < 46; i++) { const x = hash(i + 50) * W, y = SURF + 6 + hash(i + 9) * 12; if (x > 30 && (y < 730)) { R(x, y, 3, 6, hash(i) > 0.5 ? '#ff6b9a' : '#ffe14d'); R(x, y + 6, 1.5, 4, '#2f8f2f'); } }
    R(0, UNDER, W, H - UNDER, '#6e4a2c');
    for (let y = UNDER; y < H; y += 14) for (let x = 0; x < W; x += 14) { const q = hash(x * 0.37 + y * 1.13); R(x, y, 14, 14, q < 0.18 ? '#5f3f25' : q < 0.4 ? '#7a5333' : q < 0.5 ? '#6a4529' : '#6e4a2c'); }
    for (let i = 0; i < 34; i++) { const x = Math.floor(hash(i * 5 + 1) * W / 14) * 14, y = UNDER + 20 + Math.floor(hash(i * 11) * (H - UNDER - 30) / 14) * 14, w = 14 * (1 + Math.floor(hash(i) * 3)); R(x, y, w, 14, '#757a85'); R(x, y, w, 3, '#8b919d'); }
    const ores = [['#ffd24a', 40], ['#f08a2b', 28], ['#6fe3ff', 12]]; ores.forEach(([c, n], oi) => { for (let i = 0; i < n; i++) { const x = Math.floor(hash(i * 13 + oi * 71) * W / 14) * 14 + 3, y = UNDER + 18 + Math.floor(hash(i * 17 + oi * 31) * (H - UNDER - 30) / 14) * 14 + 3; R(x, y, 8, 8, c); R(x + 1, y + 1, 3, 3, 'rgba(255,255,255,.6)'); } });
    R(0, 872, W, 52, '#241810'); for (let x = 0; x < W; x += 60) { R(x, 872, 8, 52, '#7a5430'); R(x, 872, 60, 8, '#7a5430'); } R(0, 920, W, 4, '#9a9aa5'); R(0, 912, W, 2, '#6b6b75');
    for (let x = 12; x < W; x += 28) R(x, 922, 14, 3, '#5a3a20');
  }
  function drawPlaza() {
    // Praça dos Takes: pódio, bandeirinhas e troféu
    const p = PODIUM; R(p.cx - 52, p.y - 4, 104, 3, 'rgba(0,0,0,.18)');
    R(p.cx - 17, p.y + 6 - 34, 34, 34, '#d4a62a'); R(p.cx - 17, p.y + 6 - 34, 34, 4, '#f4cf5e'); text('1', p.cx, p.y - 12, '#7a5a10', 16, 800, 'center');
    R(p.cx - 50, p.y + 6 - 22, 33, 22, '#b9bfca'); R(p.cx - 50, p.y + 6 - 22, 33, 4, '#dfe3ea'); text('2', p.cx - 33, p.y - 6, '#5a6070', 14, 800, 'center');
    R(p.cx + 17, p.y + 6 - 12, 33, 12, '#c0804a'); R(p.cx + 17, p.y + 6 - 12, 33, 4, '#e0a46c'); text('3', p.cx + 33, p.y + 1, '#6b4020', 11, 800, 'center');
    R(p.cx - 3, 590, 6, 62, '#7a5a30'); R(p.cx - 3, 590, 6, 4, '#a8803f'); for (let i = 0; i < 9; i++) { const x = p.cx - 56 + i * 14, y = 596 + Math.sin(i * 0.8) * 4 + (i % 2) * 2; R(x, y, 10, 12, ['#e8b64c', '#2ebd85', '#5b9dff', '#f6465d', '#fff'][i % 5]); }
    R(p.cx - 56, 596, 112, 2, '#4a3520');
    R(p.cx - 60, 640, 120, 22, '#5a3a20'); R(p.cx - 58, 642, 116, 18, '#7a5430'); text('PRAÇA DOS TAKES', p.cx, 651, '#ffe9a8', fit('PRAÇA DOS TAKES', 108, 11, 800), 800, 'center'); R(p.cx - 3, 662, 6, 36, '#5a3a20');
    emoji('🏆', p.cx, 570, 24);
    // Cantinho do Stop: banco, fogueira e árvore murcha
    const b = BENCH; R(b.x, 730, b.w, 6, '#7a5430'); R(b.x, 724, b.w, 4, '#8a6238'); R(b.x + 3, 736, 5, 10, '#5a3a20'); R(b.x + b.w - 8, 736, 5, 10, '#5a3a20'); R(b.x, 712, 4, 14, '#5a3a20'); R(b.x + b.w - 4, 712, 4, 14, '#5a3a20'); R(b.x, 712, b.w, 3, '#7a5430');
    R(FIRE.x - 16, FIRE.y - 4, 32, 6, '#5d5d68'); R(FIRE.x - 12, FIRE.y - 8, 24, 5, '#7a7a86'); R(FIRE.x - 14, FIRE.y - 4, 28, 3, '#4a3520');
    R(1052, 640, 130, 22, '#4a3a3a'); R(1054, 642, 126, 18, '#5e4a4a'); text('CANTINHO DO STOP', 1117, 651, '#f2b6bf', fit('CANTINHO DO STOP', 118, 11, 800), 800, 'center'); R(1114, 662, 6, 36, '#4a3520');
    R(1118, 560, 6, 70, '#4a3a2a'); R(1108, 566, 14, 4, '#4a3a2a'); R(1124, 586, 16, 4, '#4a3a2a'); R(1100, 580, 10, 3, '#4a3a2a');
  }
  function drawHouse(h) {
    const wx0 = h.x0, wx1 = h.x1, top = CEIL3, bot = 712;
    if (!fillPat('tile_village_house', 52, 987, 32, 16, wx0 - 5, 700, wx1 - wx0 + 10, 16)) { R(wx0 - 5, 700, wx1 - wx0 + 10, 14, '#6b6f7a'); for (let x = wx0 - 5; x < wx1 + 5; x += 20) R(x, 700, 18, 6, '#7e838f'); }
    R(wx0 - 5, 700, wx1 - wx0 + 10, 2, 'rgba(255,255,255,.25)');
    if (fillPat('tile_wall', 128, h.wp, 32, 32, wx0, top, wx1 - wx0, 700 - top)) R(wx0, top, wx1 - wx0, 700 - top, h.tint);
    else { R(wx0, top, wx1 - wx0, 700 - top, h.wall); for (let x = wx0 + 8; x < wx1 - 8; x += 26) R(x, top, 2, 700 - top, h.wall2); }
    // rodapé de madeira em cada andar
    [1, 2, 3].forEach(f => { R(wx0 + 8, FY[f] - 9, wx1 - wx0 - 16, 9, '#5a3a20'); R(wx0 + 8, FY[f] - 9, wx1 - wx0 - 16, 2, '#8a5f2f'); });
    for (let f = 1; f <= 3; f++) { const y = FY[f]; R(wx0 + 8, y - 128, wx1 - wx0 - 16, 4, 'rgba(0,0,0,.18)'); }
    [wx0 - 4, wx1 - 12].forEach(px => { const t0 = top, hh = 700 - top; if (IMGS.tile_room) { spr('tile_room', 6, 17, 32, 16, px - 2, t0, 20, 16); spr('tile_room', 6, 144, 32, 48, px - 2, 700 - 48, 20, 48); spr('tile_room', 6, 40, 32, 90, px - 2, t0 + 16, 20, hh - 64); } else { R(px, t0, 8, hh, '#2e2014'); } });
    // lajes (com abertura onde passa a escada)
    [2, 3].forEach(f => { const y = FY[f], gl = f === 2 ? (h.side > 0 ? h.cL : h.cR - 0) : 0; let a = wx0 + 8, b = wx1 - 8; if (f === 2) { if (h.side > 0) b = h.cL - 0; else a = h.cR; } else { if (h.side > 0) b = h.cL + 22; else a = h.cR - 22; }
      R(a, y, b - a, 10, '#8a5f2f'); R(a, y, b - a, 3, '#b07d40'); for (let x = a; x < b; x += 30) R(x, y + 3, 2, 7, '#6b4723');
      if (f === 3) { const pa = h.side > 0 ? h.cL + 22 : h.cR - 22; } });
    // aterrissagem (patamar) do andar 2 no lado da coluna
    { const y = FY[2]; if (h.side > 0) { R(h.cR - 22, y, 22, 10, '#8a5f2f'); R(h.cR - 22, y, 22, 3, '#b07d40'); } else { R(h.cL, y, 22, 10, '#8a5f2f'); R(h.cL, y, 22, 3, '#b07d40'); } }
    // escadas em zigue-zague
    function flight(xa, ya, xb, yb) { const n = 10; for (let i = 0; i <= n; i++) { const x = xa + (xb - xa) * i / n, y = ya + (yb - ya) * i / n; R(x - 7, y, 14, 4, '#b07d40'); R(x - 7, y + 4, 14, 3, '#6b4723'); R(x - 2, y + 7, 4, Math.max(0, ya - y) * 0 + 0, '#5a3a20'); } R(xa - 6, ya - 28, 3, 28, '#4a3520'); R(xb - 6, yb - 28, 3, 28, '#4a3520'); g.strokeStyle = '#4a3520'; g.lineWidth = 3; g.beginPath(); g.moveTo(xa - 5, ya - 28); g.lineTo(xb - 5, yb - 28); g.stroke(); }
    flight(h.A1, FY[1], h.B1, FY[2]); flight(h.B1, FY[2], h.C, FY[3]);
    // porta(s)
    h.doors.forEach(d => { const wx = d === 1 ? wx1 : wx0; R(wx - (d === 1 ? 12 : -4), 700 - 54, 8, 54, '#1a1208'); R(wx - 12 + (d === 1 ? 0 : 16), 700 - 58, 20, 6, '#6b4723'); R(wx - 6 + (d === 1 ? 0 : 0), 700 - 52, 4, 52, '#7a5a30'); });
    // andares decorados
    if (h.si >= 0) drawAssetFloors(h); else drawCoreFloors(h);
    // telhado
    const roofB = CEIL3 + 2, rows = 10, steps = (wx1 - wx0 + 40) / 2 / rows;
    for (let r = 0; r < rows; r++) { const a = wx0 - 20 + r * steps, b = wx1 + 20 - r * steps, y = roofB - (r + 1) * 12; if (fillPat('tile_village_house', h.rp[0], h.rp[1], 32, 17, a, y, b - a, 12)) { R(a, y, b - a, 12, r % 2 ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.06)'); R(a, y + 10, b - a, 2, 'rgba(0,0,0,.35)'); } else { R(a, y, b - a, 12, r % 2 ? shade(h.roof, 0.9) : h.roof); for (let x = a + 6; x < b - 6; x += 22) R(x, y + 3, 2, 9, 'rgba(0,0,0,.2)'); } R(a, y, b - a, 2, shade(h.roof, 1.25)); }
    R(wx0 - 24, roofB, wx1 - wx0 + 48, 8, shade(h.roof, 0.7)); if (!spr('tile_village_house', 256, 14, 32, 50, h.cx + 80, roofB - 138, 32, 50)) { R(h.cx + 90, roofB - 150, 18, 60, '#7b4a38'); R(h.cx + 86, roofB - 154, 26, 8, '#5a3226'); }
    const sx = h.cx - 105; R(sx, roofB - 108, 210, 36, '#4a3018'); R(sx + 3, roofB - 105, 204, 30, '#8a5f2f'); R(sx + 3, roofB - 105, 204, 3, '#b07d40');
    text(h.name, h.cx, roofB - 89, '#fff3d0', fit(h.name, 160, 17, 800), 800, 'center'); emoji(h.ico, sx + 20, roofB - 89, 20); emoji(h.ico, sx + 190, roofB - 89, 20);
    R(sx + 20, roofB - 72, 4, 14, '#4a3018'); R(sx + 186, roofB - 72, 4, 14, '#4a3018');
  }
  function floorPlate(h, f, label) { if (!showLabels && false) return; const y = FY[f]; R(h.aL + 4, y - 122, 128, 15, 'rgba(0,0,0,.35)'); text(label, h.aL + 10, y - 114.5, '#ffe9a8', 10, 800); }
  function drawAssetFloors(h) {
    const s = SYMS[h.si];
    for (let f = 1; f <= 2; f++) for (let k = 0; k < 7; k++) { const x = stX(h, k, 7), y = FY[f]; R(x + 12, y - 22, 30, 22, '#6b4723'); R(x + 12, y - 22, 30, 3, '#8f6431'); R(x + 14, y - 10, 26, 2, '#4a3018'); R(x + 18, y - 40, 22, 17, '#1a2030'); R(x + 20, y - 38, 18, 13, '#0b1018'); R(x + 26, y - 23, 6, 3, '#3a3a45'); }
    floorPlate(h, 1, 'ANALISTAS 1 a 7'); floorPlate(h, 2, 'ANALISTAS 8 a 14');
    // sala dos traders (andar 3)
    const y3 = FY[3]; for (let k = 0; k < 4; k++) { const x = stX(h, k, 4), y = y3; R(x - 14, y - 4, 4, 4, '#2a1c10'); R(x + 8, y - 20, 50, 20, '#6b4723'); R(x + 8, y - 20, 50, 3, '#8f6431'); R(x + 4, y - 4, 4, 4, '#2a1c10'); R(x + 14, y - 46, 38, 24, '#1a2030'); R(x + 16, y - 44, 34, 20, '#0b1018'); R(x + 30, y - 22, 6, 3, '#3a3a45'); R(x - 10, y - 24, 4, 24, '#3a3a45'); R(x - 14, y - 24, 12, 4, '#4a4a58'); }
    floorPlate(h, 3, 'SALA DOS TRADERS');
    const bx = h.aL + (h.aR - h.aL) / 2; [1, 2, 3].forEach(f => { R(bx - 1, FY[f] - 122, 2, 14, '#2a2a30'); R(bx - 9, FY[f] - 110, 18, 8, '#f5d48a'); });
    if (IMGS.obj_indoors) [1, 2].forEach(f => spr('obj_indoors', 0, 2, 64, 62, h.side > 0 ? h.aL + 2 : h.aR - 66, FY[f] - 62, 64, 62, h.side < 0));
    if (IMGS.tile_village_house) [1, 2].forEach(f => { [2.55, 5.1].forEach(q => { const wx = h.aL + 54 * q - 2; spr('tile_village_house', 219, 320, 69, 64, wx - 10, FY[f] - 118, 69, 64); }); });
    const ITM = [[367, 24, 12, 19], [288, 21, 10, 22], [304, 27, 15, 16], [352, 32, 10, 11], [416, 21, 9, 22], [480, 33, 9, 10], [496, 33, 11, 10], [464, 35, 13, 8]];
    [1, 2].forEach(f => { for (let k = 0; k < 7; k++) { const x = stX(h, k, 7), it = ITM[(k * 3 + f + h.si) % ITM.length]; spr('obj_indoors', it[0], it[1], it[2], it[3], x + 28 + (k % 2) * 4, FY[f] - 22 - it[3], it[2], it[3]); } });
    for (let k = 0; k < 4; k++) { const x = stX(h, k, 4), it = ITM[(k * 2 + h.si) % ITM.length]; spr('obj_indoors', it[0], it[1], it[2], it[3], x + 44, FY[3] - 20 - it[3], it[2], it[3]); }
    // vasos e quadros para dar vida
    [1, 2].forEach(f => { const px = h.side > 0 ? h.aL + 14 : h.aR - 14; R(px - 6, FY[f] - 10, 12, 10, '#a05a2c'); R(px - 8, FY[f] - 26, 16, 16, '#2f8f3f'); R(px - 3, FY[f] - 34, 8, 10, '#3fb04f'); });
  }
  function drawCoreFloors(h) {
    for (let f = 1; f <= 2; f++) for (let k = 0; k < 2; k++) { const x = stX(h, k, 2), y = FY[f]; R(x + 14, y - 22, 34, 22, '#44527a'); R(x + 14, y - 22, 34, 3, '#5f6fa0'); R(x + 18, y - 44, 26, 20, '#1a2030'); R(x + 20, y - 42, 22, 16, '#0b1018'); }
    floorPlate(h, 1, 'RISCO e CÉREBRO'); floorPlate(h, 2, 'MACRO e NOTÍCIAS'); floorPlate(h, 3, 'PAINEL CENTRAL');
    // mapa-múndi no andar 2 e cofre no 1
    R(h.aL + 10, FY[2] - 100, 80, 46, '#1d2c4a'); R(h.aL + 14, FY[2] - 96, 72, 38, '#2b4a7a'); [[22, 20, 12, 8], [38, 26, 16, 10], [58, 18, 10, 12], [30, 36, 10, 6]].forEach(([a, b, w, hh]) => R(h.aL + a, FY[2] - 96 + b - 12, w, hh, '#4f9a5a'));
    R(h.aL + 10, FY[1] - 100, 20, 22, '#7a7f8a'); R(h.aL + 12, FY[1] - 98, 16, 18, '#5a5f6a'); emoji('🛡️', h.aL + 20, FY[1] - 89, 14);
  }

  function drawVillageExtras() {
    const lamp = x => { if (!spr('tile_village_objects', 0, 130, 32, 126, x - 16, 604, 32, 126)) { R(x - 2, 620, 4, 100, '#2f5a3a'); R(x - 8, 610, 16, 14, '#f5f0d8'); } LAMPS.push([x, 618]); };
    LAMPS.length = 0;
    // bairro da esquerda: fonte e lampiões
    if (IMGS.tile_village_fountain) spr('tile_village_fountain', 32, 12, 160, 212, -112, 588, 96, 127); lamp(-124 + 8);
    // bairro da direita: barraca e lampiões
    if (IMGS.tile_village_objects) { spr('tile_village_objects', 1, 9, 91, 119, 1676, 604, 91, 119); } lamp(1790);
    lamp(566); lamp(660); lamp(1018); lamp(1122);
    if (IMGS.tile_village_objects) { spr('tile_village_objects', 34, 140, 94, 116, 1806, 614, 70, 86); spr('tile_village_objects', 34, 140, 94, 116, -148 + 8, 626, 40, 70); }
  }
  function buildStatic() {
    const w = cv.parentElement.clientWidth || W, dpr = Math.min(2, window.devicePixelRatio || 1); bgS = clamp(w * dpr / W * 1.6, 1.2, 2);
    bg = document.createElement('canvas'); bg.width = Math.round(W * bgS); bg.height = Math.round(H * bgS);
    g = bg.getContext('2d'); g.setTransform(bgS, 0, 0, bgS, 0, 0);
    drawHills(); drawGround(); g.translate(OFFX, 0);
    [[-88, 718, 1, 'oak'], [1700, 718, 3, 'oak'], [1112, 712, 6, 'oak'], [-30, 716, 7, 'pine'], [1770, 718, 8, 'pine']].forEach(([x, b, k, kind]) => drawTree(x, b, k, kind));
    HOUSES.forEach(drawHouse); drawPlaza(); drawVillageExtras();
    for (let x = 30; x < W; x += 24) if (!HOUSES.some(h => x > h.x0 - 20 && x < h.x1 + 20) || false) { /* cerca só nos vãos */ }
    g = main;
  }

  /* ---------- desenho: bonequinho ---------- */
  /* bonequinho em pixels 1:1 (altura ~28 px, como os personagens do OPP): montado numa tela pequena, contornado e guardado em cache por aparência e pose */
  const SPC = new Map(), CS = 1.5;   // ampliação do boneco (1,5x: um pouco maior que a arte, ainda nítido)
  const dk = (hex, f) => shade(hex, f);
  function charSprite(L, o) {
    const key = [L.skin, L.hair, L.shirt, L.pants, L.style, L.glasses ? 1 : 0, L.tie || '', L.hat || '', o.crown ? 1 : 0, o.sit ? 1 : 0, o.step, o.a1, o.a2, o.mood].join('|');
    let hit = SPC.get(key); if (hit) return hit;
    const CW_ = 26, CH_ = 46, OX_ = 12, FY_ = 41, raw = document.createElement('canvas'); raw.width = CW_; raw.height = CH_; const t = raw.getContext('2d');
    const rc = (x, y, w, h, c) => { t.fillStyle = c; t.fillRect(OX_ + x, FY_ + y, w, h); };
    const dy = o.sit ? 3 : 0, skinD = dk(L.skin, 0.82), shirtD = dk(L.shirt, 0.72), shirtL = dk(L.shirt, 1.18), pantsD = dk(L.pants, 0.7), hairD = dk(L.hair, 0.7);
    const arm = (ang, sleeve, back) => { const sx = 0, sy = -18 + dy; for (let k = 0; k <= 8; k++) { const px = Math.round(sx - Math.sin(ang) * k), py = Math.round(sy + Math.cos(ang) * k); rc(px - 1, py, 2, 2, k < 6 ? sleeve : (back ? skinD : L.skin)); } };
    // braço de trás
    arm(o.a2, shirtD, true);
    // pernas
    if (o.sit) { rc(-4, -6, 9, 3, L.pants); rc(-4, -6, 9, 1, dk(L.pants, 1.2)); rc(4, -4, 3, 4, L.pants); rc(-3, -3, 7, 1, pantsD); rc(4, -2, 5, 2, '#1a1a22'); }
    else { const s = o.step; rc(-3 - s, -9, 3, 7, pantsD); rc(-3 - s, -2, 5, 2, '#14141c'); rc(0 + s, -9, 3, 7, L.pants); rc(0 + s, -2, 5, 2, '#1a1a22'); rc(1 + s, -2, 3, 1, '#34344a'); }
    // tronco
    rc(-4, -19 + dy, 8, 10, L.shirt); rc(-4, -19 + dy, 2, 10, shirtD); rc(3, -19 + dy, 1, 10, shirtL); rc(-4, -10 + dy, 8, 1, '#2a2030'); rc(0, -10 + dy, 2, 1, '#e8c94a');
    if (L.style % 2 === 0) rc(-4, -15 + dy, 8, 1, shirtL); rc(0, -19 + dy, 4, 1, dk(L.shirt, 1.4));
    if (L.tie) { rc(2, -18 + dy, 1, 7, L.tie); rc(1, -12 + dy, 3, 2, L.tie); }
    // pescoço e cabeça
    rc(0, -20 + dy, 3, 1, skinD);
    rc(-3, -29 + dy, 8, 9, L.skin); rc(-3, -22 + dy, 8, 2, L.skin); rc(-3, -25 + dy, 1, 2, skinD); rc(5, -24 + dy, 1, 1, skinD); rc(4, -21 + dy, 2, 1, skinD);
    rc(3, -26 + dy, 1, 2, '#12151c'); rc(2, -26 + dy, 1, 1, '#fff'); rc(2, -28 + dy, 3, 1, hairD);
    const m = o.mood; if (m > 0) { rc(3, -22 + dy, 2, 1, '#8a3b2b'); rc(5, -23 + dy, 1, 1, '#8a3b2b'); } else if (m < 0) { rc(3, -22 + dy, 2, 1, '#8a3b2b'); rc(5, -21 + dy, 1, 1, '#8a3b2b'); } else rc(3, -22 + dy, 2, 1, '#8a3b2b');
    // cabelo
    const st = L.style;
    if (st === 0) { rc(-4, -31 + dy, 9, 3, L.hair); rc(-4, -29 + dy, 2, 6, L.hair); rc(2, -29 + dy, 3, 1, L.hair); rc(-4, -31 + dy, 9, 1, dk(L.hair, 1.3)); }
    else if (st === 1) { rc(-4, -31 + dy, 9, 3, L.hair); rc(-5, -29 + dy, 3, 13, L.hair); rc(2, -29 + dy, 3, 2, L.hair); rc(-4, -31 + dy, 9, 1, dk(L.hair, 1.3)); }
    else if (st === 2) { rc(-4, -30 + dy, 9, 2, L.hair); rc(-3, -33 + dy, 2, 3, L.hair); rc(0, -34 + dy, 2, 4, L.hair); rc(3, -33 + dy, 2, 3, L.hair); rc(-4, -28 + dy, 1, 4, L.hair); }
    else { rc(-4, -30 + dy, 9, 2, L.hair); rc(-4, -28 + dy, 1, 3, L.hair); rc(1, -21 + dy, 5, 2, L.hair); rc(2, -22 + dy, 3, 1, hairD); }
    if (L.glasses) { rc(1, -27 + dy, 5, 3, '#2a3042'); rc(2, -26 + dy, 3, 1, '#a8dcff'); }
    // chapéus
    const hat = L.hat;
    if (hat === 'cap') { rc(-4, -32 + dy, 10, 4, '#e8e8f0'); rc(-4, -29 + dy, 10, 1, '#a8a8b8'); rc(4, -29 + dy, 5, 1, '#e8e8f0'); }
    else if (hat === 'press') { rc(-4, -32 + dy, 10, 4, '#6b6b3a'); rc(4, -29 + dy, 5, 1, '#4a4a28'); rc(-1, -35 + dy, 1, 3, '#f6465d'); rc(0, -36 + dy, 1, 2, '#f6465d'); }
    else if (hat === 'helmet') { rc(-4, -33 + dy, 10, 5, '#ffcc33'); rc(-5, -29 + dy, 12, 1, '#d9a512'); rc(-1, -34 + dy, 3, 1, '#ffe680'); rc(-3, -32 + dy, 2, 1, '#fff0b0'); }
    else if (hat === 'wizard') { rc(-5, -30 + dy, 12, 2, '#3a2370'); rc(-3, -33 + dy, 8, 3, '#4b2f8a'); rc(-1, -36 + dy, 5, 3, '#4b2f8a'); rc(0, -39 + dy, 3, 3, '#5a3aa0'); rc(1, -41 + dy, 2, 2, '#5a3aa0'); rc(-3, -31 + dy, 8, 1, '#ffd24a'); }
    else if (hat === 'head') { rc(-4, -30 + dy, 10, 1, '#2a2a33'); rc(-4, -29 + dy, 1, 6, '#2a2a33'); rc(-5, -25 + dy, 2, 3, '#4a4a58'); rc(3, -21 + dy, 4, 1, '#2a2a33'); }
    if (o.crown) { rc(-3, -33 + dy, 9, 2, '#ffd24a'); rc(-3, -35 + dy, 1, 2, '#ffd24a'); rc(1, -36 + dy, 1, 3, '#ffd24a'); rc(5, -35 + dy, 1, 2, '#ffd24a'); rc(1, -33 + dy, 1, 1, '#f6465d'); rc(-3, -32 + dy, 9, 1, '#d9a512'); }
    // braço da frente
    arm(o.a1, L.shirt, false);
    // contorno de 1 pixel
    const out = document.createElement('canvas'); out.width = CW_; out.height = CH_; const u = out.getContext('2d');
    const id = t.getImageData(0, 0, CW_, CH_), od = u.createImageData(CW_, CH_), A = id.data, B = od.data, col = [29, 22, 38];
    for (let yy = 0; yy < CH_; yy++) for (let xx = 0; xx < CW_; xx++) { const p = (yy * CW_ + xx) * 4;
      if (A[p + 3] > 20) { B[p] = A[p]; B[p + 1] = A[p + 1]; B[p + 2] = A[p + 2]; B[p + 3] = 255; continue; }
      const nb = (xx > 0 && A[p - 4 + 3] > 20) || (xx < CW_ - 1 && A[p + 4 + 3] > 20) || (yy > 0 && A[p - CW_ * 4 + 3] > 20) || (yy < CH_ - 1 && A[p + CW_ * 4 + 3] > 20);
      if (nb) { B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; B[p + 3] = 255; } }
    u.putImageData(od, 0, 0); hit = { c: out, ox: OX_, fy: FY_ }; SPC.set(key, hit); return hit;
  }
  function drawChar(c, x, y, o) {
    const d = c.dir || 1, walk = c.walking, sw = walk ? Math.sin(c.ph) : 0, jump = c.jump || 0, q = v => Math.round(v * 4) / 4;
    const sp = charSprite(c.look, { sit: !!c.sit, step: walk ? Math.round(sw * 3) : 0, a1: q(o.arm != null ? o.arm : -sw * 0.9), a2: q(o.armBack != null ? o.armBack : sw * 0.9), mood: o.mood > 0 ? 1 : o.mood < 0 ? -1 : 0, crown: !!o.crown });
    const bob = walk && Math.abs(sw) > 0.75 ? -1 : 0;
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(Math.round(x - 10 - jump * 0.1), Math.round(y - 1), 20, 3);
    g.imageSmoothingEnabled = false; g.save(); g.translate(Math.round(x), Math.round(y - jump + bob)); g.scale(d * CS, CS); g.drawImage(sp.c, -sp.ox, -sp.fy); g.restore();
  }
  function bubble(x, y, e, col) { const w = 22; g.fillStyle = 'rgba(255,255,255,.94)'; g.fillRect(x - w / 2, y - 22, w, 20); g.fillRect(x - 2, y - 2, 4, 4); g.strokeStyle = col || 'rgba(0,0,0,.25)'; g.lineWidth = 1.5; g.strokeRect(x - w / 2, y - 22, w, 20); emoji(e, x, y - 12, 14); }
  function rainCloud(x, y) { g.fillStyle = '#7d8798'; g.fillRect(x - 11, y - 4, 22, 6); g.fillRect(x - 7, y - 9, 14, 6); g.fillStyle = '#9aa4b5'; g.fillRect(x - 7, y - 9, 14, 2); g.fillStyle = '#6fb6ff'; for (let i = 0; i < 3; i++) { const q = (T * 2 + i * 0.37) % 1; g.fillRect(x - 7 + i * 7, y + 2 + q * 14, 1.6, 4); } }

  function drawChars() {
    hits = hits.filter(q => q.post); const list = chars.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    list.forEach(c => {
      const o = { mood: c.kind === 'fin' ? (c.win ? 1 : -1) : (c.mood == null ? 0 : c.mood), crown: c.kind === 'fin' && c.win && c.rank < 3 };
      const atPost = (c.kind === 'an' || c.kind === 'dir') && c.state === 'work', tr = c.kind === 'tr' && c.state !== 'comeIn';
      if (atPost) { c.dir = 1; c.walking = false; const typing = c.mood !== 0 && c.mood !== null; if (typing) { o.arm = -1.1 + Math.sin(T * 14 + c.ph) * 0.35; o.armBack = -1.0 + Math.cos(T * 11 + c.ph) * 0.3; } if (c.mood < 0 && c.mood !== null) { o.armBack = -0.4; o.arm = 0.2; } }
      if (tr && c.sit) { c.dir = 1; o.arm = -1.2 + Math.sin(T * 9 + c.ph) * 0.3; R(c.x - 14, c.y - 28, 4, 28, '#5a3a20'); R(c.x - 14, c.y - 6, 17, 4, '#7a5430'); R(c.x - 10, c.y - 4, 3, 4, '#4a3018'); }
      if (c.kind === 'fin' && c.win && c.perchOK) { o.arm = -2.6 + Math.sin(T * 8) * 0.4; o.armBack = 2.6 - Math.sin(T * 8) * 0.4; }
      if (c.kind === 'fin' && !c.win && c.sit) { o.arm = 0.2; o.armBack = 0.1; }
      if (c.kind === 'fin' && c.win && c.walking && Math.random() < 0.02 && !RM) c.jump = 6; if (c.jump && !c.perchOK) c.jump = Math.max(0, c.jump - 30 * 0.016);
      const px = c.x, py = c.y; drawChar(c, px, py, o);
      if (c.kind === 'fin') { if (c.win && c.rank < 3) { /* coroa já desenhada */ } if (!c.win) rainCloud(px, py - 62); else if (!RM && Math.random() < 0.05) parts.push({ x: px, y: py - 46, vx: rnd(-20, 20), vy: -rnd(30, 70), life: 0.9, c: '#ffd24a', s: 3, coin: true, g: 200 }); }
      if (c.emote) bubble(px, py - 54 - (c.kind === 'fin' && !c.win ? 12 : 0), c.emote);
      if (c.kind === 'tr' && c.pos && c.state !== 'comeIn') { const pr = c.pos.profit || 0, col = pr >= 0 ? UP : DN, t = money0(pr), px2 = fit(t, 60, 13, 800); g.font = `800 ${px2}px ${FONT}`; const w = g.measureText(t).width + 14; g.fillStyle = 'rgba(5,8,13,.88)'; g.fillRect(px - w / 2, py - 80, w, 17); g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(px - w / 2, py - 80, w, 17); text(t, px, py - 71.5, col, px2, 800, 'center'); text(c.pos.side === 'COMPRA' ? '▲' : '▼', px, py - 86, col, 11, 800, 'center'); }
      if (c.id === selId) { const b = Math.sin(T * 6) * 3; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(px - 7, py - 90 + b); g.lineTo(px + 7, py - 90 + b); g.lineTo(px, py - 80 + b); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(px, py + 1, 16, 5, 0, 0, 7); g.stroke(); }
      hits.push({ c, x: px - 16 + OFFX, y: py - 58, w: 32, h: 60 });
    });
  }

  /* ---------- desenho: tudo que muda ---------- */
  function drawSky(h) {
    const [a, b] = skyAt(h), gr = g.createLinearGradient(0, 0, 0, SURF); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const n = nightF(h);
    if (n > 0.05) { g.globalAlpha = n; for (let i = 0; i < 70; i++) { const tw = 0.5 + 0.5 * Math.sin(T * 2 + i); R(hash(i) * W, hash(i + 3) * 380, 2, 2, `rgba(255,255,255,${(0.45 + 0.5 * tw).toFixed(2)})`); } g.globalAlpha = 1; }
    const sunT = (h - 6) / 12, moonT = ((h + 6) % 24) / 12 - 1 + 0.0; if (h >= 6 && h <= 18) { const x = 80 + sunT * (W - 160), y = 300 - Math.sin(sunT * Math.PI) * 230; g.fillStyle = 'rgba(255,230,120,.25)'; g.fillRect(x - 40, y - 40, 80, 80); R(x - 24, y - 24, 48, 48, '#ffe27a'); R(x - 18, y - 30, 36, 60, '#ffe27a'); R(x - 30, y - 18, 60, 36, '#ffe27a'); }
    else { const t = h > 18 ? (h - 18) / 12 : (h + 6) / 12; const x = 80 + t * (W - 160), y = 300 - Math.sin(t * Math.PI) * 220; R(x - 22, y - 22, 44, 44, '#e9eefc'); R(x - 16, y - 28, 32, 56, '#e9eefc'); R(x - 28, y - 16, 56, 32, '#e9eefc'); R(x - 8, y - 10, 8, 8, '#c4cde6'); R(x + 6, y + 6, 10, 10, '#c4cde6'); }
    clouds.forEach(c => pixCloud(c.x, c.y, c.s, 0.55 + 0.35 * (1 - n)));
    birds.forEach(b => { const f = Math.sin(T * 10 + b.x) > 0; R(b.x, b.y + (f ? 0 : 3), 6, 2, '#2a3042'); R(b.x + 6, b.y + (f ? 3 : 0), 6, 2, '#2a3042'); });
  }
  function glow(x, y, r, a, rgb) { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  function drawLive(h) {
    const n = nightF(h);
    // telas dos postos e das mesas de trader
    HOUSES.forEach(hh => {
      if (hh.si >= 0) {
        for (let i = 0; i < 14; i++) { const c = chars.find(q => q.kind === 'an' && q.si === hh.si && q.ind === i); const f = i < 7 ? 1 : 2, k = i % 7, x = stX(hh, k, 7), y = FY[f]; const mood = c ? (c.mood == null ? 0 : c.mood) : 0, away = c && c.state !== 'work'; const col = away ? '#2a3446' : mood > 0 ? UP : mood < 0 ? DN : NEU;
          R(x + 20, y - 38, 18, 13, '#0b1018'); R(x + 20, y - 38, 18, 13, col.length === 7 ? col + (away ? '' : '55') : col); if (!away) { for (let q = 0; q < 3; q++) R(x + 22, y - 36 + q * 4, 6 + ((T * 3 + q * 2 + i) % 7), 2, col); }
          if (showLabels) { R(x + 12, y - 8, 30, 9, 'rgba(0,0,0,.5)'); text(IND[i][1], x + 27, y - 3.5, away ? '#7b889c' : '#fff3d0', fit(IND[i][1], 28, 9, 800), 800, 'center'); }
          if (c) hits.push({ c, x: x + 10 + OFFX, y: y - 42, w: 34, h: 44, post: true }); }
        for (let k = 0; k < 4; k++) { const x = stX(hh, k, 4), y = FY[3], c = chars.find(q => q.kind === 'tr' && q.si === hh.si && q.slot === k && q.state !== 'fin'); const col = c && c.pos ? ((c.pos.profit || 0) >= 0 ? UP : DN) : '#2a3446'; R(x + 16, y - 44, 34, 20, col.length === 7 ? col + '33' : col);
          if (c && c.pos) { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); for (let q = 0; q < 12; q++) { const px = x + 18 + q * 2.6, py = y - 30 + Math.sin(q * 0.9 + T + k) * 4 - (c.pos.profit >= 0 ? q * 0.5 : -q * 0.5); q ? g.lineTo(px, py) : g.moveTo(px, py); } g.stroke(); } else text('livre', x + 33, y - 34, '#4d5a70', 10, 700, 'center'); }
      } else {
        const ds = directors(); for (const d of ds) { const x = stX(hh, d.k, 2), y = FY[d.floor], c = chars.find(q => q.kind === 'dir' && q.dkey === d.key), away = c && c.state !== 'work'; const col = away ? '#2a3446' : d.mood > 0 ? UP : d.mood < 0 ? DN : NEU; R(x + 20, y - 42, 22, 16, col.length === 7 ? col + (away ? '' : '66') : col); emoji(d.ico, x + 31, y - 34, 12);
          if (showLabels) { R(x + 14, y - 8, 36, 9, 'rgba(0,0,0,.5)'); text(d.short, x + 32, y - 3.5, '#cfe0ff', fit(d.short, 34, 9, 800), 800, 'center'); }
          if (c) hits.push({ c, x: x + 12 + OFFX, y: y - 46, w: 38, h: 48, post: true }); }
        // painel central (andar 3)
        const bx = hh.aL + 8, by = FY[3] - 110, bw = hh.aR - hh.aL - 16, bh = 100; R(bx - 3, by - 3, bw + 6, bh + 6, '#05080d'); R(bx, by, bw, bh, '#0e1521'); g.strokeStyle = (hud.gain || 0) >= 0 ? UP : DN; g.globalAlpha = 0.55; g.lineWidth = 1.5; g.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1); g.globalAlpha = 1;
        text('HOJE', bx + 8, by + 11, '#8a96a8', 10, 700); text(money0(hud.gain || 0), bx + bw - 8, by + 11, (hud.gain || 0) >= 0 ? UP : DN, fit(money0(hud.gain || 0), bw - 56, 15, 800), 800, 'right');
        const pct = hud.usd > 0 ? clamp(hud.gain / hud.usd, 0, 1) : 0; R(bx + 8, by + 24, bw - 16, 6, '#1b2333'); R(bx + 8, by + 24, (bw - 16) * pct, 6, '#e8b64c'); text(hud.usd > 0 ? `meta ${(pct * 100).toFixed(0)}%` : 'sem meta', bx + 8, by + 38, '#7b889c', 9, 600);
        text(`${hud.takes || 0} takes · ${Math.max(0, (hud.n || 0) - (hud.takes || 0))} stops · ${hud.nOpen || 0} abertas`, bx + bw - 8, by + 38, '#7b889c', fit(`${hud.takes || 0} takes · ${Math.max(0, (hud.n || 0) - (hud.takes || 0))} stops · ${hud.nOpen || 0} abertas`, bw - 70, 9, 600), 600, 'right');
        const tr = diary ? diary.trades.slice().sort((a, b) => (a.close_t < b.close_t ? -1 : 1)) : [];
        if (tr.length > 1) { let c2 = 0; const pts = tr.map(t => (c2 += t.usd || 0)), nn = pts.length, lo = Math.min(0, ...pts), hi = Math.max(0, ...pts), rg = (hi - lo) || 1, cy0 = by + 48, ch = bh - 56, up = pts[nn - 1] >= 0; g.save(); g.beginPath(); g.rect(bx + 6, cy0 - 2, bw - 12, ch + 4); g.clip(); g.strokeStyle = up ? UP : DN; g.lineWidth = 2; g.beginPath(); pts.forEach((v, i) => { const px = bx + 8 + (bw - 16) * i / (nn - 1), py = cy0 + ch - ch * (v - lo) / rg; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); g.restore(); text('equity (histórico)', bx + 8, by + bh - 6, '#5f7a6c', 8, 600); } else text('aguardando operações…', bx + bw / 2, by + 70, '#5f7a6c', 10, 600, 'center');
      }
    });
    LAMPS.forEach(([lx, ly]) => { if (n > 0.1) glow(lx, ly, 70, 0.5 * n, '255,233,168'); });
    // fogueira
    const fl = Math.sin(T * 14) * 2; R(FIRE.x - 6, FIRE.y - 20 + fl, 12, 14, '#ff8a1f'); R(FIRE.x - 3, FIRE.y - 28 + fl * 1.4, 7, 14, '#ffd24a'); R(FIRE.x - 1, FIRE.y - 16, 3, 8, '#fff3b0');
    if (!RM && Math.random() < 0.2) parts.push({ x: FIRE.x + rnd(-4, 4), y: FIRE.y - 24, vx: rnd(-10, 10), vy: -rnd(30, 60), life: 0.8, c: '#ffb347', s: 2, g: -20 });
    // tochas nas paredes
    HOUSES.forEach(hh => [1, 2, 3].forEach(f => { [hh.x0 + 18, hh.x1 - 18].forEach(x => { if (hh.si >= 0 || true) { const y = FY[f] - 70; R(x - 2, y, 4, 12, '#5a3a20'); R(x - 3, y - 8 + Math.sin(T * 12 + x) * 1.5, 6, 8, '#ffb347'); R(x - 1, y - 6, 2, 5, '#fff3b0'); glow(x, y - 4, 46, 0.1 + n * 0.22, '255,179,71'); } }); }));
    // tesouro do dia no subsolo
    const cx = 840, cy = 892; R(cx - 22, cy - 18, 44, 22, '#8a5a2a'); R(cx - 22, cy - 18, 44, 6, '#b07d40'); R(cx - 3, cy - 12, 6, 8, '#ffd24a'); const gn = Math.max(0, hud.gain || 0), nc = Math.min(14, Math.floor(gn / 8) + (gn > 0 ? 2 : 0));
    for (let i = 0; i < nc; i++) R(cx - 20 + (i % 7) * 6, cy - 24 - Math.floor(i / 7) * 5, 5, 4, i % 2 ? '#ffd24a' : '#f2b035'); text('Tesouro do dia', cx, cy + 14, '#ffe9a8', 11, 800, 'center');
    // partículas
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; if (p.life <= 0) { parts.splice(i, 1); continue; } g.globalAlpha = clamp(p.life, 0, 1); if (p.coin) { R(p.x, p.y, p.s, p.s * 0.8, '#ffd24a'); } else R(p.x, p.y, p.s, p.s, p.c); g.globalAlpha = 1; }
  }
  function drawBanner() {
    if (banner && banner.t > 0) { const a = clamp(banner.t, 0, 1), y = 120 - (1 - a) * 20; g.globalAlpha = a; g.fillStyle = 'rgba(5,8,13,.9)'; g.fillRect(W / 2 - 230, y - 36, 460, 72); g.strokeStyle = banner.col; g.lineWidth = 3; g.strokeRect(W / 2 - 230, y - 36, 460, 72); text(banner.text, W / 2, y - 8, banner.col, 30, 800, 'center'); text(banner.sub, W / 2, y + 20, '#cfd6e4', 14, 700, 'center'); g.globalAlpha = 1; }
    if (flash > 0) { g.globalAlpha = flash * 0.22; R(0, 0, W, H, flashCol); g.globalAlpha = 1; flash = Math.max(0, flash - 0.025); }
  }
  function drawNight(h) { const n = nightF(h); if (n > 0.02) { g.fillStyle = `rgba(10,16,52,${(0.34 * n).toFixed(3)})`; g.fillRect(0, 0, W, H); } }

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.06, (now - last) / 1000 || 0.016); last = now; T += dt;
    if (!cv.width || !bg) { size(); }
    const h = brHour();
    clouds.forEach(c => { c.x += c.v * dt; if (c.x > W + 60) c.x = -120; }); birds.forEach(b => { b.x += b.v * dt; b.y += Math.sin(T + b.v) * 0.2; if (b.x > W + 20) { b.x = -30; b.y = rnd(120, 300); } });
    parts.forEach(p => { p.life -= dt; p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt; p.vy = (p.vy || 0) + (p.g == null ? 300 : p.g) * dt; });
    if (banner) banner.t -= dt;
    chars.forEach(c => step(c, dt));
    const S = cv.width / W; main.setTransform(S * view.z, 0, 0, S * view.z, S * view.x, S * view.y); g = main;
    main.imageSmoothingEnabled = true; drawSky(h); main.drawImage(bg, 0, 0, W, H);
    hits = []; main.save(); main.translate(OFFX, 0); drawLive(h); drawChars(); main.restore(); drawBanner(); drawNight(h);
    if (!HEADLESS) requestAnimationFrame(frame); else requestAnimationFrame(frame);
  }

  /* ---------- relatório ao clicar ---------- */
  const repBox = document.getElementById('vilaRep');
  function closeReport() { selId = null; if (repBox) { repBox.style.display = 'none'; repBox.innerHTML = ''; } }
  const chk = (v, s) => !v ? '<span class="mut">sem leitura</span>' : v.status === 'ok' ? `<b class="buy">✔ concorda</b>` : v.status === 'neutro' ? '<b>… neutro</b>' : `<b class="sell">✖ discorda</b>`;
  function indChips(si, cur) { const vt = votes(lastDecision(data[SYMS[si].sym])); return `<div class="vchips">${IND.map((q, i) => { const v = vt[q[0]], k = !v ? 'n' : v.status === 'ok' ? 'u' : v.status === 'neutro' ? 'n' : 'd'; return `<span class="vc ${k}${i === cur ? ' me' : ''}" title="${esc(q[0])}">${esc(q[1])}</span>`; }).join('')}</div>`; }
  function reportHTML(c) {
    if (c.kind === 'an') {
      const s = SYMS[c.si], S = stOf(s.sym), dec = lastDecision(data[s.sym]), v = dec ? votes(dec)[IND[c.ind][0]] : null, d = dec && dec.decision, name = IND[c.ind][0];
      const where = c.state === 'work' ? 'no posto, trabalhando' : c.state === 'back' ? 'voltando para o posto' : 'passeando pela vila (mercado neutro para ele)';
      const closed = c.si === 0 && !goldOpen();
      return `<h4>${s.icon} Analista · ${esc(name)} <small>${s.name}</small></h4><p class="mut">${esc(INFO[name] || '')}</p>
        <div class="vrow"><span>Opinião agora</span>${closed ? '<b>mercado fechado</b>' : chk(v)}</div>
        ${v ? `<div class="vdet">${esc(v.detail || '')}</div>` : ''}
        <div class="vrow"><span>Onde está</span><b>${where}</b></div>
        ${d ? `<div class="vrow"><span>Sinal analisado</span><b>${esc(d.side || '')} · ${esc(d.setup || '')}</b></div><div class="vrow"><span>Resultado da decisão</span><b>${esc(d.result || '')}${d.certainty != null ? ' · certeza ' + d.certainty + '%' : ''}</b></div><div class="vrow"><span>Decisão às</span><b>${esc(dec.t || '')}</b></div>` : '<p class="mut">Ainda sem decisão com os 14 indicadores neste ativo.</p>'}
        <div class="vrow"><span>Todos os votos de ${s.name}</span></div>${indChips(c.si, c.ind)}
        <p class="mut" style="margin-top:8px">${S ? '' : 'Robô deste ativo sem dados agora.'}</p>`;
    }
    if (c.kind === 'dir') { const d = directors().find(x => x.key === c.dkey); if (!d) return ''; const where = c.state === 'work' ? 'no posto, trabalhando' : c.state === 'back' ? 'voltando para o posto' : 'passeando pela vila';
      return `<h4>${d.ico} ${esc(d.title)}</h4><p class="mut">${esc(d.what)}</p><div class="vrow"><span>Situação</span><b class="${d.mood > 0 ? 'buy' : d.mood < 0 ? 'sell' : ''}">${d.mood > 0 ? '✔ tranquilo' : d.mood < 0 ? '⚠ atenção' : '… neutro'} · ${esc(d.say)}</b></div><div class="vdet">${d.html}</div><div class="vrow"><span>Onde está</span><b>${where}</b></div>`; }
    if (c.kind === 'tr') {
      const s = SYMS[c.si], p = c.pos || {}, S = stOf(s.sym), mk = S && S.market ? S.market : null, buy = p.side === 'COMPRA', px = mk ? (buy ? mk.bid : mk.ask) : null;
      let prog = null; if (px != null && p.tp && p.price_open) prog = clamp((px - p.price_open) / ((p.tp - p.price_open) || 1), -1, 1);
      const oT = epoch(p.open_time), mins = oT ? Math.max(0, Math.round((Date.now() / 1000 - (oT - 0)) / 60 - 0)) : null;
      return `<h4>${s.icon} Trader · posição #${esc(c.tk)} <small>${s.name}</small></h4><p class="mut">Segura esta posição aberta e vigia stop e alvo até ela fechar.</p>
        <div class="vrow"><span>Resultado agora</span><b class="${cl(p.profit)}">${money(p.profit || 0)}</b></div>
        <div class="vrow"><span>Direção</span><b>${esc(p.side || '')} · ${p.lots} lote(s)</b></div><div class="vrow"><span>Entrada</span><b>${esc(p.price_open)}</b></div>
        <div class="vrow"><span>Stop (perde)</span><b class="sell">${esc(p.sl)}</b></div><div class="vrow"><span>Alvo (ganha)</span><b class="buy">${esc(p.tp)}</b></div>
        ${px != null ? `<div class="vrow"><span>Preço agora</span><b>${esc(px)}</b></div>` : ''}
        ${prog != null ? `<div class="vrow"><span>Caminho até o alvo</span><b>${prog >= 0 ? (prog * 100).toFixed(0) + '%' : 'contra ' + (-prog * 100).toFixed(0) + '% (rumo ao stop)'}</b></div><div class="ofbar"><i style="width:${Math.max(2, prog * 100)}%;${prog < 0 ? 'background:#f6465d' : ''}"></i></div>` : ''}
        <div class="vrow"><span>Setup</span><b>${esc((p.comment || '').replace(/^KAIROS\s*/i, ''))}</b></div><div class="vrow"><span>Aberta às</span><b>${esc(p.open_time || '')} (servidor)</b></div>`;
    }
    if (c.kind === 'fin') {
      const t = c.t || {}, s = SYMS[c.si];
      return `<h4>${c.win ? '🏆 Take' : '🌧️ Stop'} · ${s.icon} ${s.name} <small>${esc(t.side || '')} · ${esc(t.setup || '')}</small></h4>
        <div class="vrow"><span>Resultado</span><b class="${cl(t.usd)}">${money(t.usd || 0)} · ${(t.r > 0 ? '+' : '') + t.r} R</b></div><div class="vrow"><span>Duração</span><b>${t.minutes} min · saiu por ${esc(t.exit || '')}</b></div>
        <div class="vrow"><span>Entrada → saída</span><b>${esc(t.entry)} → ${esc(t.exit_price)}</b></div>
        ${t.mfe_r != null ? `<div class="vrow"><span>Foi a favor até</span><b>${t.mfe_r} R</b></div><div class="vrow"><span>Foi contra até</span><b>${t.mae_r} R</b></div>` : ''}
        ${t.entrada_txt ? `<div class="vdet"><b>Por que entrou</b><br>${esc(t.entrada_txt)}</div>` : ''}${t.resultado_txt ? `<div class="vdet"><b>O que aconteceu</b><br>${esc(t.resultado_txt)}</div>` : ''}
        ${(t.causas && t.causas.length) ? `<div class="vrow"><span>Causas apontadas</span><b>${t.causas.map(esc).join(', ')}</b></div>` : ''}`;
    }
    return '';
  }
  function renderReport() { const c = chars.find(q => q.id === selId); if (!c || !repBox) return closeReport(); repBox.innerHTML = '<button type="button" class="vx" aria-label="Fechar relatório">✕</button>' + reportHTML(c); repBox.style.display = 'block'; const x = repBox.querySelector('.vx'); if (x) x.onclick = closeReport; }

  /* ---------- tamanho, mouse, zoom ---------- */
  function size() { const w = cv.parentElement.clientWidth || W, dpr = Math.min(2, window.devicePixelRatio || 1); cv.style.width = '100%'; cv.style.height = 'auto'; cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr * H / W); cv.style.aspectRatio = W + '/' + H; buildStatic(); }
  cv.setAttribute('data-tip', '1');
  let pan = null, moved = 0;
  const clampView = () => { view.z = clamp(view.z, 1, 3); view.x = clamp(view.x, W * (1 - view.z), 0); view.y = clamp(view.y, H * (1 - view.z), 0); };
  function zoomAt(f, mx, my) { const z0 = view.z; view.z = clamp(view.z * f, 1, 3); view.x = mx - (mx - view.x) * view.z / z0; view.y = my - (my - view.y) * view.z / z0; clampView(); }
  const toWorld = e => { const r = cv.getBoundingClientRect(), mx = (e.clientX - r.left) * W / r.width, my = (e.clientY - r.top) * H / r.height; return [(mx - view.x) / view.z, (my - view.y) / view.z, mx, my]; };
  const hitAt = e => { const [x, y] = toWorld(e); const chs = hits.filter(q => !q.post).reverse().find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); return chs || hits.filter(q => q.post).find(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); };
  const who = c => c.kind === 'an' ? `${SYMS[c.si].icon} ${IND[c.ind][0]} (${SYMS[c.si].name})` : c.kind === 'dir' ? c.role : c.kind === 'tr' ? `${SYMS[c.si].icon} trader da posição #${c.tk}` : `${c.win ? '🏆 take' : '🌧️ stop'} de hoje (${SYMS[c.si].name})`;
  cv.addEventListener('mousemove', e => {
    const [, , mx, my] = toWorld(e);
    if (pan) { const r = cv.getBoundingClientRect(); moved += Math.abs(e.movementX) + Math.abs(e.movementY); view.x = pan.vx + (e.clientX - pan.x) * W / r.width; view.y = pan.vy + (e.clientY - pan.y) * H / r.height; clampView(); tip.style.display = 'none'; return; }
    const h = hitAt(e); cv.style.cursor = h ? 'pointer' : ''; if (h) showTip(e, `<b>${esc(who(h.c))}</b><br><span class="mut">clique para abrir o relatório</span>`); else tip.style.display = 'none';
  });
  cv.addEventListener('pointerdown', e => { moved = 0; if (view.z > 1) { pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; cv.setPointerCapture(e.pointerId); } });
  cv.addEventListener('pointerup', () => { pan = null; });
  cv.addEventListener('click', e => { if (moved > 5) return; const h = hitAt(e); if (h) { selId = h.c.id; renderReport(); } else closeReport(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && selId) closeReport(); });
  cv.addEventListener('wheel', e => { if (!e.ctrlKey && !e.shiftKey) return; e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0018), (e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height); }, { passive: false });
  cv.addEventListener('dblclick', () => { view.z = 1; view.x = 0; view.y = 0; });
  [['ofZin', () => zoomAt(1.35, W / 2, H / 2)], ['ofZout', () => zoomAt(1 / 1.35, W / 2, H / 2)], ['ofZre', () => { view.z = 1; view.x = 0; view.y = 0; }]].forEach(([id, fn]) => { const b = document.getElementById(id); if (b) b.onclick = fn; });
  cv.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  window.addEventListener('resize', () => { if (running) size(); });
  const lblBtn = document.getElementById('ofLbl');
  if (lblBtn) { const sync = () => { lblBtn.setAttribute('aria-pressed', String(showLabels)); lblBtn.textContent = showLabels ? '🏷️ Rótulos: ligados' : '🏷️ Rótulos: desligados'; }; sync(); lblBtn.onclick = () => { showLabels = !showLabels; try { localStorage.setItem('ofLabels', showLabels ? '1' : '0'); } catch (e) { /* sem armazenamento */ } sync(); }; }

  function initScene() { if (clouds.length) return; for (let i = 0; i < 7; i++) clouds.push({ x: rnd(0, W), y: rnd(40, 240), s: rnd(1.4, 2.6), v: rnd(5, 14) }); for (let i = 0; i < 3; i++) birds.push({ x: rnd(0, W), y: rnd(120, 300), v: rnd(30, 55) }); }
  const API = {
    start(o) { HEADLESS = !!(o && o.headless); initScene(); if (!bg) size(); if (!timer) { refresh().catch(() => {}); timer = setInterval(() => refresh().catch(() => {}), 5000); } if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); } },
    stop() { running = false; clearInterval(timer); timer = null; },
    setHeadless(b) { HEADLESS = !!b; },
    once() { initScene(); size(); running = true; const n = performance.now(); last = n - 16; frame(n); },
    advance(sec) { for (let i = 0; i < sec * 20; i++) { T += 0.05; chars.forEach(c => step(c, 0.05)); } },
    api: { SYMS, IND, directors, money, goldOpen, openPositions, lastDecision, votes, localDay, todayKey },
    setClosed(list) { OV = list; updateHud(); syncChars(); }, refresh, state: () => ({ data, diary, hud, hits, chars, banner, flash, running, T, view, loaded }),
    select(id) { selId = id; renderReport(); }, close: closeReport,
    celebrate(win) { seen = seen || new Set(); onTrades([{ pos: 'teste' + Math.random(), sym: 'BTCUSDm', win, usd: win ? 55.5 : -44, r: win ? 3 : -1, side: 'VENDA' }]); }
  };
  window.Vila = API; window.Office = API;
  if (document.getElementById('p-office').classList.contains('on')) API.start();
})();
