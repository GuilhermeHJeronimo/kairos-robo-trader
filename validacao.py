"""Validação dos robôs (demo): separa a fase de ajuste (versões antigas) da fase de validação (configuração congelada), por ativo, e
resume o que os backtests do Testador (resultados_v*.txt) mostraram. Nada aqui altera os robôs."""
import json
import math
from pathlib import Path

import robot

BASE = Path(__file__).parent
CFG = BASE / "validacao.json"
PADRAO = {"inicio": {"XAUUSDm": "2026.10.01 00:00:00", "BTCUSDm": "2026.10.02 00:00:00"}, "versao": "2.0", "objetivo_n": 30,
          "regra": "Configuração congelada: só correção de bug muda o robô. Decisão só com 30 ou mais trades fechados por ativo."}


def config():
    if CFG.exists():
        try:
            c = {**PADRAO, **json.loads(CFG.read_text(encoding="utf-8"))}
            if not isinstance(c["inicio"], dict):                      # formato antigo: uma data só (ouro)
                c["inicio"] = {**PADRAO["inicio"], "XAUUSDm": c["inicio"]}
            return c
        except Exception:
            pass
    return dict(PADRAO)


def _stats(trs):
    rs = [t["r"] for t in trs]
    n = len(rs)
    if not n:
        return {"n": 0}
    m = sum(rs) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in rs) / (n - 1)) if n > 1 else 0
    ci = 1.96 * sd / math.sqrt(n) if n > 1 else None
    cum = peak = dd = 0.0
    for r in rs:
        cum += r; peak = max(peak, cum); dd = max(dd, peak - cum)
    return {"n": n, "wins": sum(1 for r in rs if r > 0), "sum_r": round(sum(rs), 2), "avg_r": round(m, 3), "ci95": round(ci, 3) if ci is not None else None,
            "usd": round(sum(t["result"] for t in trs), 2), "max_dd_r": round(dd, 2),
            "conclusive": bool(ci is not None and n >= 30 and abs(m) > ci)}


def backtests():
    linhas, ok = [], False
    for name in ("resultados_v15.txt", "resultados_v17.txt", "resultados_v17b.txt", "resultados_btc.txt", "resultados_confluencia.txt", "resultados_confluencia2.txt", "resultados_confluencia3.txt"):
        p = BASE / "mt5" / name
        if not p.exists():
            continue
        ls = [l.strip() for l in p.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip()]
        linhas += [l for l in ls if not l.startswith("#")]
        ok = ok or any("concluida" in l for l in ls)
    return {"linhas": linhas, "concluida": ok}


def dados():
    cfg = config()
    allt = robot.all_trades()
    por = {}
    for sym in robot.symbols() or [robot.DEFAULT_SYM]:
        ini = cfg["inicio"].get(sym, "2099.01.01 00:00:00")
        trs = [t for t in allt if t.get("sym") == sym]
        valid = [t for t in trs if t["open_t"] >= ini]
        por[sym] = {"asset": robot.asset_name(sym), "inicio": ini, "ajuste": _stats([t for t in trs if t["open_t"] < ini]), "validacao": _stats(valid),
                    "trades_validacao": [{"open_t": t["open_t"], "side": t["side"], "r": round(t["r"], 2), "exit": t["exit"]} for t in valid][::-1]}
    return {"config": cfg, "ativos": por, "backtests": backtests()}
