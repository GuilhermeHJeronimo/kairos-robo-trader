"""Diário do robô: junta autópsia (learning.py) + candles do MT5 (pedidos ao robô) + gráfico do trade (tradechart.py).

Gera por trade:  graficos/<pos>.html (interativo), graficos/<pos>.svg, nota no Obsidian (com o gráfico) e um item na fila do Notion
(notion_fila.json) com propriedades, texto colorido e o caminho do HTML. O envio ao Notion é feito pelo assistente (conector).

Uso:  python diario.py            (processa todos os trades)
"""
import json
import re
import shutil
import time
from datetime import datetime
from pathlib import Path

import learning
import robot
import tradechart as tc

BASE = Path(__file__).parent
GRAF = BASE / "graficos"
VAULT_G = learning.VAULT / "graficos"
FILES = robot.FILES


def _journal_now():
    """Hora do servidor da corretora = a do evento mais recente de qualquer robô (o relógio do PC é diferente)."""
    ts = []
    for sym in robot.symbols() or [robot.DEFAULT_SYM]:
        ts += [robot._ts(e["t"]) for e in robot.read_journal(limit=30, sym=sym)["events"][:30] if robot._ts(e["t"])]
    return max(ts) if ts else datetime.utcnow()


def _bars_path(sym, pos):
    new = FILES / f"Kairos_{sym}_bars_pos{pos}.csv"
    old = FILES / f"XAU_Reader_bars_pos{pos}.csv"
    return old if (not new.exists() and old.exists()) else new


def pedir_candles(sym, pos, t_open, t_close):
    """Pede ao robô (MT5) do ativo os candles M1 do trade. Devolve o caminho do CSV ou None se o robô não respondeu."""
    dst = _bars_path(sym, pos)
    if dst.exists():
        return dst
    dst = FILES / f"Kairos_{sym}_bars_pos{pos}.csv"
    req = {"id": int(time.time() * 1000), "from": tc.epoch(t_open) - 50 * 60, "to": tc.epoch(t_close) + 70 * 60, "name": f"pos{pos}"}
    (FILES / f"Kairos_{sym}_barsreq.json").write_text(json.dumps(req, separators=(",", ":")), encoding="ascii")
    if "XAU" in sym.upper():                                               # o robô antigo (XAU_Reader) lê o nome antigo
        (FILES / "XAU_Reader_barsreq.json").write_text(json.dumps(req, separators=(",", ":")), encoding="ascii")
    for _ in range(12):
        time.sleep(1)
        if dst.exists():
            return dst
    return None


def _zona(why):
    m = re.search(r"(\d{4,6}\.\d+)-(\d{4,6}\.\d+)", why or "")
    return (float(m.group(1)), float(m.group(2))) if m else None


def descricao_entrada(tr, a):
    why = (tr.get("why") or "").replace(" R -R ", " R:R ")
    m = re.search(r"Motivos do leitor - (.*?)\. Etapa 1", why)
    motivos = m.group(1).replace(" / ", "; ") if m else ""
    hora = tr["open_t"][11:16]
    mc = re.search(r"\(certeza (\d+)%\)", why); cert1 = mc.group(1) if mc else tr.get('certainty')
    risk_pts = abs(tr["entry"] - tr["sl"])
    txt = (f"{tr['side']} em {tr['setup']} às {hora} (UTC), a {tr['entry']}. Leitura do gráfico: {motivos}. "
           f"A análise (etapa 1) aprovou com certeza de {cert1}% e a verificação ao vivo de 30 s confirmou o sinal. "
           f"Stop em {tr['sl']} ({risk_pts:.2f} pontos, risco de US$ {tr['risk']:.2f}) e alvo em {tr['tp']} (1:{tr['rr_plan']:.0f}).")
    if a["fracas"]:
        txt += " Pontos fracos já conhecidos na entrada: " + "; ".join(a["fracas"]) + "."
    return txt


def descricao_resultado(tr, a, pos_saida):
    if a["win"]:
        txt = f"O alvo foi atingido em {tr['minutes']} min (+{tr['r']:.2f}R). " + a["licao"]
    else:
        txt = f"O stop foi atingido em {tr['minutes']} min ({tr['r']:+.2f}R). " + a["licao"]
    partes = []
    if a["mae_r"] is not None:
        partes.append(f"o preço andou até {a['mae_r']:.2f}R contra a posição")
    if a["mfe_r"] is not None:
        partes.append(f"e até {a['mfe_r']:.2f}R a favor")
    if partes:
        txt += " Durante o trade " + " ".join(partes) + "."
    if pos_saida == "Teria dado alvo":
        txt += " Depois da saída o preço chegou ao alvo: o stop foi tirado por ruído, a ideia estava certa (vale estudar stop maior)."
    elif pos_saida == "Ideia falhou":
        txt += " Depois da saída o preço não chegou ao alvo: a leitura não se confirmou."
    return txt


def pos_saida(tr, bars):
    t_close = tc.epoch(tr["close_t"])
    depois = [b for b in bars if b["t"] > t_close]
    if not depois or depois[-1]["t"] < t_close + 30 * 60:
        return "Sem dados"
    depois = [b for b in depois if b["t"] <= t_close + 60 * 60]
    side = 1 if tr["side"] == "COMPRA" else -1
    best = max((b["h"] - tr["entry"]) if side > 0 else (tr["entry"] - b["l"]) for b in depois)
    return "Teria dado alvo" if best >= abs(tr["tp"] - tr["entry"]) else "Ideia falhou"


def excursao(tr, bars):
    t0, t1 = tc.epoch(tr["open_t"]), tc.epoch(tr["close_t"])
    seg = [b for b in bars if t0 - 60 <= b["t"] <= t1]
    if not seg:
        return None, None
    if tr["side"] == "COMPRA":
        return max(tr["entry"] - min(b["l"] for b in seg), 0), max(max(b["h"] for b in seg) - tr["entry"], 0)
    return max(max(b["h"] for b in seg) - tr["entry"], 0), max(tr["entry"] - min(b["l"] for b in seg), 0)


def notion_md(it, embed="(o gráfico aparece aqui assim que o robô fornecer os candles do trade)"):
    win = it["win"]
    cor, ico, tit = ("green_bg", "🟩", "POR QUE DEU TAKE") if win else ("red_bg", "🟥", "POR QUE DEU LOSS")
    esc = lambda x: x.replace("<", "&lt;")
    causas = " · ".join(f"`{c}`" for c in it["causas"])
    tab = lambda l, v: f"		<tr><td>**{l}**</td><td>{v}</td></tr>"
    mae = f"{it['mae']:.2f}R" if it["mae"] is not None else "n/d"
    mfe = f"{it['mfe']:.2f}R" if it["mfe"] is not None else "n/d"
    NL = chr(10)
    return NL.join([
        f'<callout icon="🔵" color="blue_bg">', f"	**POR QUE O ROBÔ ENTROU**", f"	{esc(it['entrada'])}", "</callout>",
        f'<callout icon="{ico}" color="{cor}">', f"	**{tit}**", f"	{esc(it['resultado'])}", f"	Causas prováveis (hipóteses): {causas}", "</callout>",
        "## 📊 Gráfico do trade (passe o mouse nos candles)", embed,
        "## 📋 Números do trade", '<table header-column="true" fit-page-width="true">',
        tab("Lado / setup", f"{it['side']} · {it['setup']}"), tab("Abertura (UTC)", it["hora"]), tab("Entrada / stop / alvo", f"{it['props']['Preco entrada']} / {it['props']['Stop']} / {it['props']['Alvo']}"),
        tab("Saída", f"{it['props']['Preco saida']} ({it['saida']})"), tab("Resultado", f"{it['r']:+.2f}R · US$ {it['usd']:+.2f}"),
        tab("MAE / MFE", f"{mae} contra · {mfe} a favor"), tab("Depois da saída", it["pos_saida"]), "</table>",
        "> Autópsia automática. As causas são hipóteses: só viram regra com 30+ trades. Nota no Obsidian: " + it["props"]["Nota Obsidian"]])


def processar():
    trades = robot.all_trades()
    now = _journal_now()
    learning.sync()
    st = json.loads(learning.STATE.read_text(encoding="utf-8"))
    if isinstance(st.get("notion"), list):
        st["notion"] = {}
    st.setdefault("graficos", {})
    GRAF.mkdir(exist_ok=True); VAULT_G.mkdir(parents=True, exist_ok=True)
    fila, cum = [], 0.0
    for i, tr in enumerate(trades):
        cum += tr["r"]
        pos = str(tr.get("pos") or tr["open_t"])
        idade_min = (now - robot._ts(tr["close_t"])).total_seconds() / 60
        a = learning.autopsia(tr, trades[:i])
        bars, sai = [], "Sem dados"
        csv = _bars_path(tr.get("sym", robot.DEFAULT_SYM), pos)
        if not csv.exists() and idade_min >= 35 and pos not in st["graficos"]:
            try:
                pedir_candles(tr.get("sym", robot.DEFAULT_SYM), pos, tr["open_t"], tr["close_t"])
            except Exception as e:
                print("[diario] pedido de candles falhou:", e)
        if csv.exists():
            shutil.copy(csv, GRAF / f"bars_{pos}.csv")
            bars = tc.read_bars(csv)
            sai = pos_saida(tr, bars)
            if tr.get("mae") is None:
                mae, mfe = excursao(tr, bars)
                if mae is not None:
                    risk_px = abs(tr["entry"] - tr["sl"]) or 1e-9
                    a["mae_r"], a["mfe_r"] = round(mae / risk_px, 2), round(mfe / risk_px, 2)
            if sai == "Teria dado alvo" and not a["win"] and "stop curto demais" not in a["causas"]:
                a["causas"] = [c for c in a["causas"] if c != "sem causa clara"] + ["stop curto demais"]
        entrada_txt, res_txt = descricao_entrada(tr, a), descricao_resultado(tr, a, sai)
        a["licao_completa"] = res_txt
        chave = f"{len(bars)}|{sai}|{a['mae_r']}|{a['mfe_r']}|{','.join(a['causas'])}"
        if bars:
            ctx = tr.get("ctx") or {}
            vw = learning._num(ctx.get("vwap", ""), r"^([\d.]+)$") if ctx else None
            html_page = tc.page(tr, bars, _zona(tr.get("why")), vw, entrada_txt, res_txt, a["causas"])
            (GRAF / f"{pos}.html").write_text(html_page, encoding="utf-8")
            sv = tc.svg(tr, bars, _zona(tr.get("why")), vw)
            (GRAF / f"{pos}.svg").write_text(sv, encoding="utf-8")
            shutil.copy(GRAF / f"{pos}.svg", VAULT_G / f"{pos}.svg")
            st["graficos"][pos] = chave
        # nota do Obsidian (reescrita com gráfico e descrições)
        titulo, md = learning.nota_obsidian(tr, a)
        extra = ["", "## Gráfico do trade", f"![[{pos}.svg]]" if bars else "(gráfico indisponível: o robô precisa estar ligado para fornecer os candles)", "",
                 "## Descrição da entrada", entrada_txt, "", "## Descrição do resultado", res_txt, ""]
        md = md.replace("\n> Autópsia automática", "\n".join(extra) + "\n> Autópsia automática")
        (learning.VAULT / f"{titulo}.md").write_text(md, encoding="utf-8")
        # item da fila do Notion
        props = learning.linha_notion(tr, a)
        props.update({"Preco entrada": tr["entry"], "Stop": tr["sl"], "Alvo": tr["tp"], "Preco saida": tr["exit_price"], "Depois da saida": sai,
                      "Motivo da entrada": entrada_txt, "Licao": res_txt, "R acumulado": round(cum, 2),
                      "MAE em R": a["mae_r"], "MFE em R": a["mfe_r"], "Causas provaveis": json.dumps(a["causas"], ensure_ascii=False)})
        nid = st["notion"].get(pos)
        if not (isinstance(nid, dict) and nid.get("chave") == chave):
            fila.append({"pos": pos, "chave": chave, "page_id": nid.get("id") if isinstance(nid, dict) else None, "props": props,
                         "html": str(GRAF / f"{pos}.html") if bars else None, "win": a["win"], "r": tr["r"], "usd": tr["result"],
                         "entrada": entrada_txt, "resultado": res_txt, "causas": a["causas"], "mae": a["mae_r"], "mfe": a["mfe_r"],
                         "side": tr["side"], "setup": tr["setup"], "hora": tr["open_t"], "saida": tr["exit"], "pos_saida": sai})
    learning.STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    learning.QUEUE.write_text(json.dumps(fila, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"trades": len(trades), "fila": len(fila), "graficos": len(st["graficos"])}


def cartoes():
    """Dados do Diário para o painel: um cartão por trade + estatística por fator."""
    trades = robot.all_trades()
    out, ans, cum = [], [], 0.0
    for i, tr in enumerate(trades):
        pos = str(tr.get("pos") or tr["open_t"])
        a = learning.autopsia(tr, trades[:i])
        sai = "Sem dados"
        csv = GRAF / f"bars_{pos}.csv"
        if csv.exists():
            bars = tc.read_bars(csv)
            sai = pos_saida(tr, bars)
            if tr.get("mae") is None:
                mae, mfe = excursao(tr, bars)
                if mae is not None:
                    rp = abs(tr["entry"] - tr["sl"]) or 1e-9
                    a["mae_r"], a["mfe_r"] = round(mae / rp, 2), round(mfe / rp, 2)
            if sai == "Teria dado alvo" and not a["win"] and "stop curto demais" not in a["causas"]:
                a["causas"] = [c for c in a["causas"] if c != "sem causa clara"] + ["stop curto demais"]
        cum += tr["r"]
        ans.append(a)
        out.append({"pos": pos, "sym": tr.get("sym", robot.DEFAULT_SYM), "asset": robot.asset_name(tr.get("sym", robot.DEFAULT_SYM)), "side": tr["side"], "setup": tr["setup"], "open_t": tr["open_t"], "close_t": tr["close_t"], "minutes": tr["minutes"],
                    "r": round(tr["r"], 2), "usd": tr["result"], "win": a["win"], "exit": tr["exit"], "entry": tr["entry"], "sl": tr["sl"], "tp": tr["tp"],
                    "exit_price": tr["exit_price"], "certainty": tr.get("certainty"), "sessao": a["sessao"], "mae_r": a["mae_r"], "mfe_r": a["mfe_r"],
                    "causas": a["causas"], "fracas": a["fracas"], "pos_saida": sai, "cum_r": round(cum, 2),
                    "entrada_txt": descricao_entrada(tr, a), "resultado_txt": descricao_resultado(tr, a, sai),
                    "chart": (GRAF / f"{pos}.html").exists()})
    fat = learning.fatores(trades, ans) if trades else []
    return {"trades": out[::-1], "fatores": fat, "min_n": learning.MIN_N, "bars_pending": sum(1 for c in out if not c["chart"])}


def marcar(pos, page_id, chave):
    st = json.loads(learning.STATE.read_text(encoding="utf-8"))
    st.setdefault("notion", {})[pos] = {"id": page_id, "chave": chave}
    learning.STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    import sys
    if len(sys.argv) == 5 and sys.argv[1] == "--marcar":
        marcar(sys.argv[2], sys.argv[3], sys.argv[4]); print("ok")
    else:
        print(processar())
