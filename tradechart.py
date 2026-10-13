"""Gráfico de cada trade (candles de 1 min + entrada, stop, alvo, zona, VWAP, saída) em SVG e em HTML interativo (tooltip por candle).

O HTML é autocontido (sem CDN) para poder ser anexado ao Notion (<embed>) e aberto no Obsidian/navegador.
"""
import calendar
import html
from datetime import datetime

W, H = 980, 440
PAD_L, PAD_R, PAD_T, PAD_B = 70, 130, 46, 40
UP, DOWN, BLUE, YELLOW, GRID, BG, FG = "#26a69a", "#ef5350", "#4fc3f7", "#ffca28", "#2a3142", "#0f1420", "#d7dce8"


def epoch(t):
    return calendar.timegm(datetime.strptime(t, "%Y.%m.%d %H:%M:%S").timetuple())


def read_bars(path):
    rows = []
    for ln in open(path, encoding="cp1252", errors="replace").read().splitlines()[1:]:
        p = ln.split(";")
        if len(p) >= 6:
            rows.append({"t": int(p[0]), "o": float(p[1]), "h": float(p[2]), "l": float(p[3]), "c": float(p[4]), "v": int(p[5])})
    return rows


def _fmt_t(e):
    return datetime.utcfromtimestamp(e).strftime("%H:%M")


def svg(tr, bars, zone=None, vwap=None):
    """tr: trade (robot.read_journal). bars: candles M1. zone: (lo, hi) da zona de suporte/resistência; vwap: float."""
    t_open, t_close = epoch(tr["open_t"]), epoch(tr["close_t"])
    bars = [b for b in bars if t_open - 45 * 60 <= b["t"] <= t_close + 25 * 60]
    if not bars:
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 80"><text x="10" y="40" fill="#999">sem candles para este trade</text></svg>'
    side = 1 if tr["side"] == "COMPRA" else -1
    win = tr["result"] > 0
    lo = min([b["l"] for b in bars] + [tr["sl"], tr["tp"]] + ([zone[0]] if zone else []))
    hi = max([b["h"] for b in bars] + [tr["sl"], tr["tp"]] + ([zone[1]] if zone else []))
    pad = (hi - lo) * 0.06
    lo, hi = lo - pad, hi + pad
    n = len(bars)
    pw, ph = W - PAD_L - PAD_R, H - PAD_T - PAD_B
    bw = pw / n
    X = lambda i: PAD_L + (i + 0.5) * bw
    Y = lambda p: PAD_T + (hi - p) / (hi - lo) * ph
    idx = lambda e: min(range(n), key=lambda i: abs(bars[i]["t"] - e))
    i_o, i_c = idx(t_open), idx(t_close)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="100%" font-family="Segoe UI,Arial,sans-serif" font-size="12">',
         f'<rect width="{W}" height="{H}" rx="10" fill="{BG}"/>']
    asset = {"XAU": "Ouro", "BTC": "Bitcoin"}.get(next((k for k in ("XAU", "BTC") if k in tr.get("sym", "XAU").upper()), "XAU"), "")
    title = f'{asset} · {tr["side"]} · {tr["setup"]} · {"TAKE" if win else "LOSS"} {tr["r"]:+.2f}R (US$ {tr["result"]:+.2f})'
    o.append(f'<text x="{PAD_L}" y="26" fill="{FG}" font-size="15" font-weight="600">{html.escape(title)}</text>')
    # grade de preços
    step = max(round((hi - lo) / 6, 1), 0.5)
    p = int(lo / step) * step
    while p <= hi:
        if p >= lo:
            o.append(f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{Y(p):.1f}" y2="{Y(p):.1f}" stroke="{GRID}" stroke-width="1"/>'
                     f'<text x="{PAD_L - 6}" y="{Y(p) + 4:.1f}" fill="#8892a6" text-anchor="end">{p:.1f}</text>')
        p += step
    # zonas de risco (vermelho) e alvo (verde) a partir da entrada
    e = tr["entry"]
    o.append(f'<rect x="{X(i_o):.1f}" y="{Y(max(e, tr["sl"])):.1f}" width="{W - PAD_R - X(i_o):.1f}" height="{abs(Y(e) - Y(tr["sl"])):.1f}" fill="{DOWN}" opacity="0.16"/>')
    o.append(f'<rect x="{X(i_o):.1f}" y="{Y(max(e, tr["tp"])):.1f}" width="{W - PAD_R - X(i_o):.1f}" height="{abs(Y(e) - Y(tr["tp"])):.1f}" fill="{UP}" opacity="0.14"/>')
    if zone:
        o.append(f'<rect x="{PAD_L}" y="{Y(zone[1]):.1f}" width="{pw}" height="{abs(Y(zone[0]) - Y(zone[1])):.1f}" fill="{YELLOW}" opacity="0.13"/>'
                 f'<text x="{W - PAD_R + 6}" y="{Y((zone[0] + zone[1]) / 2) + 4:.1f}" fill="{YELLOW}">zona {zone[0]:.1f}–{zone[1]:.1f}</text>')
    if vwap and lo <= vwap <= hi:
        o.append(f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{Y(vwap):.1f}" y2="{Y(vwap):.1f}" stroke="#ab47bc" stroke-dasharray="6 4"/>'
                 f'<text x="{W - PAD_R + 6}" y="{Y(vwap) + 4:.1f}" fill="#ce93d8">VWAP {vwap:.1f}</text>')
    for name, price, col in (("ALVO", tr["tp"], UP), ("ENTRADA", e, BLUE), ("STOP", tr["sl"], DOWN)):
        o.append(f'<line x1="{PAD_L}" x2="{W - PAD_R}" y1="{Y(price):.1f}" y2="{Y(price):.1f}" stroke="{col}" stroke-width="1.4" stroke-dasharray="{"0" if name == "ENTRADA" else "8 4"}"/>'
                 f'<text x="{W - PAD_R + 6}" y="{Y(price) + 4:.1f}" fill="{col}" font-weight="600">{name} {price:.2f}</text>')
    # candles
    for i, b in enumerate(bars):
        col = UP if b["c"] >= b["o"] else DOWN
        x = X(i)
        tip = f'{_fmt_t(b["t"])} UTC  O {b["o"]:.2f}  H {b["h"]:.2f}  L {b["l"]:.2f}  C {b["c"]:.2f}  vol {b["v"]}'
        bt, bb = Y(max(b["o"], b["c"])), Y(min(b["o"], b["c"]))
        o.append(f'<g class="c"><title>{tip}</title><line x1="{x:.1f}" x2="{x:.1f}" y1="{Y(b["h"]):.1f}" y2="{Y(b["l"]):.1f}" stroke="{col}"/>'
                 f'<rect x="{x - bw * 0.35:.1f}" y="{bt:.1f}" width="{max(bw * 0.7, 1):.1f}" height="{max(bb - bt, 1):.1f}" fill="{col}"/></g>')
    # marcadores de entrada e saída
    xe, xs = X(i_o), X(i_c)
    up = side > 0
    o.append(f'<path d="M{xe:.1f} {Y(e) + (14 if up else -14):.1f} l-7 {14 if up else -14} h14 z" transform="translate(0,{-14 if up else 14})" fill="{BLUE}" stroke="#fff" stroke-width="1"/>')
    o.append(f'<text x="{xe:.1f}" y="{Y(e) + (34 if up else -26):.1f}" fill="{BLUE}" text-anchor="middle" font-weight="600">ENTRADA {_fmt_t(t_open)}</text>')
    xc = DOWN if not win else UP
    o.append(f'<circle cx="{xs:.1f}" cy="{Y(tr["exit_price"]):.1f}" r="6" fill="none" stroke="{xc}" stroke-width="2.5"/>'
             f'<text x="{xs:.1f}" y="{Y(tr["exit_price"]) + (-12 if not win else 20):.1f}" fill="{xc}" text-anchor="middle" font-weight="600">SAÍDA {_fmt_t(t_close)} ({html.escape(tr["exit"])})</text>')
    # eixo do tempo
    for i in range(0, n, max(n // 8, 1)):
        o.append(f'<text x="{X(i):.1f}" y="{H - 14}" fill="#8892a6" text-anchor="middle">{_fmt_t(bars[i]["t"])}</text>')
    o.append("</svg>")
    return "".join(o)


def page(tr, bars, zone, vwap, entrada_txt, resultado_txt, causas):
    chips = "".join(f'<span class="chip">{html.escape(c)}</span>' for c in causas)
    win = tr["result"] > 0
    col = UP if win else DOWN
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{margin:0;background:{BG};color:{FG};font-family:Segoe UI,Arial,sans-serif;padding:12px}}
.c:hover rect{{stroke:#fff;stroke-width:1}} .c:hover line{{stroke-width:2}}
.box{{border-radius:10px;padding:12px 14px;margin-top:10px;line-height:1.5;font-size:14px}}
.in{{background:#13263a;border-left:4px solid {BLUE}}} .out{{background:{'#10281f' if win else '#2c1519'};border-left:4px solid {col}}}
h3{{margin:0 0 4px;font-size:14px;letter-spacing:.3px}} .chip{{display:inline-block;background:#232b3d;border-radius:12px;padding:2px 10px;margin:2px 4px 0 0;font-size:12px}}
.hint{{color:#8892a6;font-size:12px;margin-top:6px}}</style></head><body>
{svg(tr, bars, zone, vwap)}
<div class="hint">Passe o mouse sobre um candle para ver horário (UTC), abertura, máxima, mínima, fechamento e volume.</div>
<div class="box in"><h3 style="color:{BLUE}">POR QUE O ROBÔ ENTROU</h3>{html.escape(entrada_txt)}</div>
<div class="box out"><h3 style="color:{col}">{'POR QUE DEU TAKE' if win else 'POR QUE DEU LOSS'}</h3>{html.escape(resultado_txt)}<div>{chips}</div></div>
</body></html>"""
