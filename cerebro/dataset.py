"""Lê o diário do Testador (sem filtro de confluência) e monta uma linha por trade: características do momento da entrada + resultado em R."""
import math
import re

NUM = r"(-?\d+(?:\.\d+)?)"


def _votes(checks):
    out = {}
    for c in checks.split(";"):
        b = c.split(":", 2)
        if len(b) == 3:
            out[b[0]] = (b[1], b[2])
    return out


def _vote(st):
    return {"ok": 1, "fraco": -1, "neutro": 0}.get(st, 0)


def _f(rx, s, default=None, g=1):
    m = re.search(rx, s or "")
    return float(m.group(g)) if m else default


def linhas(path, ativo, tf):
    """Gera dicionários de features + 'r' (resultado em R) + 'win'. Pareia ABRIU, DECISAO ENTROU e FECHOU pela posição e pelo horário."""
    rows, pend, abriu = {}, {}, {}
    for ln in open(path, encoding="cp1252", errors="replace"):
        p = ln.rstrip("\r\n").split(";", 2)
        if len(p) < 3:
            continue
        t, ev, msg = p
        if ev == "ABRIU":
            m = re.search(r"(COMPRA|VENDA) (.+?) lote=([\d.]+) preco=([\d.]+) sl=([\d.]+) tp=([\d.]+) R:R=([\d.]+) risco\$=([\d.]+) pos=(\d+)", msg)
            if m:
                abriu[t] = dict(t=t, side=m.group(1), setup=m.group(2), price=float(m.group(4)), sl=float(m.group(5)), tp=float(m.group(6)), risk_usd=float(m.group(8)), pos=m.group(9))
        elif ev == "DECISAO" and msg.startswith("ENTROU") and t in abriu:
            a = abriu.pop(t)
            parts = msg.split("|")
            ck = ""
            for q in parts:
                if q.startswith("checks="):
                    ck = q[7:]
            rows[a["pos"]] = {**a, "checks": ck}
        elif ev == "FECHOU":
            m = re.search(r"resultado=(-?[\d.]+) .*?pos=(\d+)", msg)
            if m and m.group(2) in rows:
                rows[m.group(2)]["result"] = float(m.group(1))
    out = []
    for pos, r in rows.items():
        if "result" not in r or not r["risk_usd"]:
            continue
        v = _votes(r["checks"])
        sd = 1 if r["side"] == "COMPRA" else -1
        atr = _f(r"ATR " + NUM, v.get("volatilidade (ATR)", ("", ""))[1])
        ratio = _f(r"= " + NUM + "x", v.get("volatilidade (ATR)", ("", ""))[1])
        if not atr:
            continue
        price = _f(r"preco " + NUM, v.get("medias moveis 21/50", ("", ""))[1], r["price"])
        e50 = _f(r"EMA50 " + NUM, v.get("medias moveis 21/50", ("", ""))[1])
        vw = _f(r"VWAP " + NUM, v.get("VWAP do dia", ("", ""))[1])
        rsi = _f(r"RSI " + NUM, v.get("RSI 14", ("", ""))[1])
        rsi_up = 1 if "subindo" in v.get("RSI 14", ("", ""))[1] else 0
        macd = _f(r"histograma " + NUM, v.get("MACD 12/26/9", ("", ""))[1])
        hier = v.get("hierarquia forte", ("", ""))[1]
        al, ao = _f(r"(\d) de 3", hier, 0), _f(r"\((\d) contra", hier, 0)
        vol = _f(r"" + NUM + r"x a media", v.get("volume acima da media", ("", ""))[1])
        free = v.get("caminho livre ate 1,5R", ("", ""))[1]
        dz = _f(r"zona a " + NUM, free)
        gtxt = v.get("gap nao preenchido", ("", ""))[1]
        gm = re.search(r"de ([\d.]+) ATR ha (\d+) candles", gtxt)
        gap_atr = max(-3.0, min(3.0, float(gm.group(1)) * (1 if "na direcao" in gtxt else -1))) if gm else 0.0
        gap_age = int(gm.group(2)) if gm else 48
        risk_px = abs(r["price"] - r["sl"])
        hh, mm = int(r["t"][11:13]), r["t"][:10]
        y, mo, d = int(mm[:4]), int(mm[5:7]), int(mm[8:10])
        wd = _weekday(y, mo, d)
        R = r["result"] / r["risk_usd"]
        row = {
            "ativo": ativo, "tf": tf, "t": r["t"], "side": sd, "setup": r["setup"], "r": R, "win": 1 if R > 0 else 0,
            # votos (+1 concorda, -1 discorda, 0 neutro)
            "v_estrutura": _vote(v.get("estrutura a favor", ("neutro",))[0]), "v_hier": _vote(v.get("hierarquia forte", ("neutro",))[0]),
            "v_medias": _vote(v.get("medias moveis 21/50", ("neutro",))[0]), "v_rsi": _vote(v.get("RSI 14", ("neutro",))[0]),
            "v_macd": _vote(v.get("MACD 12/26/9", ("neutro",))[0]), "v_vwap": _vote(v.get("VWAP do dia", ("neutro",))[0]),
            "v_perfil": _vote(v.get("perfil de volume", ("neutro",))[0]), "v_liquidez": _vote(v.get("liquidez varrida", ("neutro",))[0]),
            "v_volume": _vote(v.get("volume acima da media", ("neutro",))[0]), "v_vol": _vote(v.get("volatilidade (ATR)", ("neutro",))[0]),
            "v_vela": _vote(v.get("padrao de vela", ("neutro",))[0]),
            # números normalizados (já do lado da operação)
            "hier_al": al, "hier_ao": ao, "rsi": (rsi if sd > 0 else 100 - rsi) if rsi is not None else 50.0, "rsi_up": rsi_up if sd > 0 else 1 - rsi_up,
            "macd_atr": (macd or 0) * sd / atr, "vwap_atr": ((price - vw) * sd / atr) if vw else 0.0, "ema50_atr": ((price - e50) * sd / atr) if e50 else 0.0,
            "vol_ratio": min(vol or 0, 5.0), "atr_ratio": min(ratio or 1, 4.0), "risk_atr": risk_px / atr, "free_r": min((dz / risk_px) if (dz and risk_px) else 20.0, 20.0),
            "hora": hh, "dow": wd, "gap_atr": gap_atr, "gap_age": gap_age, "is_rej": 1 if "Rejeicao" in r["setup"] else 0, "is_rompe": 1 if "Rompimento" in r["setup"] else 0,
        }
        out.append(row)
    out.sort(key=lambda x: x["t"])
    return out


def _weekday(y, m, d):
    t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
    y -= m < 3
    return (y + y // 4 - y // 100 + y // 400 + t[m - 1] + d + 6) % 7        # 0 = segunda


FEATURES = ["v_estrutura", "v_hier", "v_medias", "v_rsi", "v_macd", "v_vwap", "v_perfil", "v_liquidez", "v_volume", "v_vol", "v_vela",
            "hier_al", "hier_ao", "rsi", "rsi_up", "macd_atr", "vwap_atr", "ema50_atr", "vol_ratio", "atr_ratio", "risk_atr", "free_r",
            "is_rej", "is_rompe", "side", "gap_atr", "gap_age"]
