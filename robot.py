"""Leitura e controle do robô XAU Reader (MetaTrader 5).

O robô grava em MQL5\\Files:
  XAU_Reader_status.json     estado atual (conta, posição, travas, decisão, verificação, notícias), a cada ~5 s
  XAU_Reader_journal.csv     diário: INICIO, CONFIG, SINAL, DECISAO, ABRIU, FECHOU, COMANDO, TRAVA_*, FIM...
E lê:
  XAU_Reader_cmd.json        comandos do painel (pause, resume, close_all, stop)
  XAU_Reader_sentiment.json  nota de sentimento das manchetes (news.py)
"""
import csv
import io
import json
import math
import os
import re
import time
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_FILES = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL\MQL5\Files"
FILES = Path(os.environ.get("XAUR_FILES", DEFAULT_FILES))
CONFS = ("tendencia", "vwap", "perfil", "liquidez", "fluxo")
COMMANDS = {"pause", "resume", "close_all", "stop", "target", "reset_peak"}

RE_OPEN = re.compile(r"(COMPRA|VENDA) (.+?) lote=([\d.]+) preco=([\d.]+) sl=([\d.]+) tp=([\d.]+) R:R=([\d.]+) risco\$=([\d.]+) (?:pos=(\d+) )?"
                     r"confirmacoes=\[(\d+) ok: ([^|]*)\| faltaram: ([^\]]*)\] motivos=(.*)")
RE_SIGNAL = re.compile(r"(COMPRA|VENDA) (.+?) R:R=([\d.]+) fatores=(\d+) confirmacoes=(\d+) ok: ([^|]*)\| faltaram: (.*?)motivos=(.*)")
RE_CLOSE = re.compile(r"resultado=(-?[\d.]+) preco=([\d.]+)(?: pos=(\d+))?(?: saida=(.*?))?(?: entrada=([\d.]+) dur=(\d+) mae=(\S+) mfe=(\S+))?\s*$")
RE_CTX = re.compile(r"vwap=(\S+) poc=(\S+) val=(\S+) vah=(\S+) fluxo=(\S+) ticks=(\d+) volRatio=(\S+)")


DEFAULT_SYM = "XAUUSDm"
ASSETS = {"XAU": "Ouro", "BTC": "Bitcoin"}


def asset_name(sym):
    for k, v in ASSETS.items():
        if k in sym.upper():
            return v
    return sym


def _paths(sym, name):
    """Arquivos do ativo: Kairos_<ativo>_<nome>; o ouro também lê o histórico do nome antigo (XAU_Reader_<nome>)."""
    new = FILES / f"Kairos_{sym}_{name}"
    old = FILES / f"XAU_Reader_{name}" if "XAU" in sym.upper() else None
    return new, old


def symbols():
    """Ativos conhecidos (pelos arquivos de estado/diário). O ouro vem primeiro."""
    found = []
    for p in FILES.glob("Kairos_*_status.json"):
        found.append(p.name[len("Kairos_"):-len("_status.json")])
    if (FILES / "XAU_Reader_status.json").exists() and not any("XAU" in x.upper() for x in found):
        found.append(DEFAULT_SYM)
    return sorted(set(found), key=lambda x: (0 if "XAU" in x.upper() else 1, x))


def _ts(t):
    try:
        return datetime.strptime(t, "%Y.%m.%d %H:%M:%S")
    except Exception:
        return None


def read_status(sym=DEFAULT_SYM):
    new, old = _paths(sym, "status.json")
    p = new if (new.exists() or old is None or not old.exists()) else old
    if new.exists() and old is not None and old.exists():
        p = new if new.stat().st_mtime >= old.stat().st_mtime else old          # vale o mais recente (pode haver o robô antigo ainda ligado)
    if not p.exists():
        return {"found": False}
    for _ in range(4):
        try:
            d = json.loads(p.read_bytes().decode("cp1252", "replace"))
            age = max(0.0, time.time() - float(d.get("epoch_utc", 0)))
            d.update(found=True, age_s=round(age), alive=bool(d.get("running")) and age < 45)
            return d
        except Exception:
            time.sleep(0.05)
    return {"found": True, "error": "arquivo de estado ilegível"}


def _names(s):
    return [w for w in s.replace("|", " ").split() if w in CONFS]


def _stat(rs):
    n = len(rs)
    if n == 0:
        return {"n": 0}
    mean = sum(rs) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in rs) / (n - 1)) if n > 1 else 0.0
    ci = 1.96 * sd / math.sqrt(n) if n > 1 else None
    wins = sum(1 for r in rs if r > 0)
    return {"n": n, "wins": wins, "win_rate": round(100 * wins / n, 1), "sum_r": round(sum(rs), 2), "avg_r": round(mean, 3),
            "ci95": round(ci, 3) if ci is not None else None, "conclusive": bool(ci is not None and n >= 30 and abs(mean) > ci)}


def _parse_decision(msg):
    """RESULT|etapa=N|lado=X|setup=Y|certeza=N|checks=nome:status:detalhe;...|resumo=texto"""
    parts = msg.split("|")
    d = {"result": parts[0], "stage": None, "side": None, "setup": None, "certainty": None, "checks": [], "summary": ""}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        if k == "etapa":
            d["stage"] = int(v) if v.isdigit() else None
        elif k == "lado":
            d["side"] = v
        elif k == "setup":
            d["setup"] = v
        elif k == "certeza":
            d["certainty"] = int(v) if v.isdigit() else None
        elif k == "checks":
            for c in v.split(";"):
                bits = c.split(":", 2)
                if len(bits) == 3:
                    d["checks"].append({"name": bits[0], "status": bits[1], "detail": bits[2]})
        elif k == "resumo":
            d["summary"] = v
    return d


def read_journal(limit=400, sym=DEFAULT_SYM):
    new, old = _paths(sym, "journal.csv")
    srcs = [x for x in (old, new) if x is not None and x.exists()]          # histórico antigo (ouro) + diário atual
    out = {"found": bool(srcs), "events": [], "trades": [], "stats": {}, "decisions": {}, "daily": [], "hours": [], "hist": []}
    if not srcs:
        return out
    lines = []
    for p in srcs:
        lines += p.read_bytes().decode("cp1252", "replace").splitlines()
    events, trades, open_q, last_open, ctx, hier = [], [], [], None, None, None
    last_ctx = None
    signals = 0
    dec_counts = {}
    fail_names, weak_names = {}, {}
    for ln in lines:
        parts = ln.split(";", 2)
        if len(parts) < 3:
            continue
        t, ev, msg = parts
        e = {"t": t, "ev": ev, "msg": msg, "sym": sym}
        if ev == "CONTEXTO":
            m = RE_CTX.search(msg)
            ctx = dict(zip(("vwap", "poc", "val", "vah", "flow", "ticks", "vol_ratio"), m.groups())) if m else None
            last_ctx = ctx
            continue
        if ev == "HIERARQUIA":
            hier = {"text": re.sub(r"\s*=>\s*(PERMITIDO|BLOQUEADO)\s*$", "", msg), "ok": msg.rstrip().endswith("PERMITIDO")}
            continue
        if ev == "SINAL":
            signals += 1
            m = RE_SIGNAL.search(msg)
            if m:
                e.update(side=m.group(1), setup=m.group(2), rr=float(m.group(3)), factors=int(m.group(4)), conf_n=int(m.group(5)),
                         conf_ok=_names(m.group(6)), conf_missing=_names(m.group(7)), reasons=m.group(8).strip())
            e["ctx"], e["hier"], ctx, hier = ctx, hier, None, None
        elif ev == "DECISAO":
            d = _parse_decision(msg)
            e["decision"] = d
            key = d["result"] + (f"_etapa{d['stage']}" if d["stage"] else "")
            dec_counts[key] = dec_counts.get(key, 0) + 1
            if d["result"] == "NAO_ENTROU":
                for c in d["checks"]:
                    if c["status"] == "FALHOU":
                        fail_names[c["name"]] = fail_names.get(c["name"], 0) + 1
                    elif c["status"] == "fraco":
                        weak_names[c["name"]] = weak_names.get(c["name"], 0) + 1
            if d["result"] == "ENTROU" and last_open is not None and "why" not in last_open:
                last_open["why"], last_open["checks"], last_open["certainty"] = d["summary"], d["checks"], d["certainty"]
        elif ev == "ABRIU":
            m = RE_OPEN.search(msg)
            if m:
                e.update(side=m.group(1), setup=m.group(2), lots=float(m.group(3)), price=float(m.group(4)), sl=float(m.group(5)), tp=float(m.group(6)),
                         rr=float(m.group(7)), risk=float(m.group(8)), pos=m.group(9), conf_ok=_names(m.group(11)), conf_missing=_names(m.group(12)), reasons=m.group(13).strip())
                e["ctx"] = last_ctx
                last_open = dict(e); open_q.append(last_open)
        elif ev == "FECHOU":
            m = RE_CLOSE.search(msg)
            if m:
                res = float(m.group(1)); e["result"] = res
                exit_how = (m.group(4) or "").strip()
                pos = m.group(3)
                opened = None
                if pos:
                    for q in open_q:
                        if q.get("pos") == pos:
                            opened = q; break
                if opened is None and open_q:
                    opened = open_q[0]                       # sem número da posição (diário antigo): primeiro que abriu
                if opened is not None:
                    open_q.remove(opened)
                if opened and opened.get("risk"):
                    r = res / opened["risk"]
                    e["r"] = round(r, 2)
                    a, b = _ts(opened["t"]), _ts(t)
                    trades.append({"open_t": opened["t"], "close_t": t, "side": opened["side"], "setup": opened["setup"], "lots": opened["lots"],
                                   "entry": opened["price"], "sl": opened["sl"], "tp": opened["tp"], "exit_price": float(m.group(2)), "result": res, "r": r,
                                   "risk": opened["risk"], "rr_plan": opened["rr"], "exit": exit_how, "minutes": round((b - a).total_seconds() / 60) if a and b else None,
                                   "conf_ok": opened["conf_ok"], "conf_missing": opened["conf_missing"], "why": opened.get("why", opened.get("reasons", "")),
                                   "checks": opened.get("checks", []), "certainty": opened.get("certainty"), "pos": opened.get("pos"), "ctx": opened.get("ctx"), "sym": sym,
                                   "dur_s": int(m.group(6)) if m.group(6) else None,
                                   "mae": float(m.group(7)) if m.group(7) not in (None, "n/d") else None,
                                   "mfe": float(m.group(8)) if m.group(8) not in (None, "n/d") else None})
        events.append(e)

    rs = [tr["r"] for tr in trades]
    cum, cum_r, curve, peak, mdd, peak_r, mdd_r = 0.0, 0.0, [], 0.0, 0.0, 0.0, 0.0
    daily, hours = {}, {}
    for tr in trades:
        cum += tr["result"]; cum_r += tr["r"]
        peak, peak_r = max(peak, cum), max(peak_r, cum_r)
        mdd, mdd_r = max(mdd, peak - cum), max(mdd_r, peak_r - cum_r)
        curve.append({"t": tr["close_t"], "usd": round(cum, 2), "r": round(cum_r, 2)})
        day = local_date(tr["close_t"])
        dd = daily.setdefault(day, {"day": day, "usd": 0.0, "r": 0.0, "n": 0}); dd["usd"] += tr["result"]; dd["r"] += tr["r"]; dd["n"] += 1
        a = _ts(tr["open_t"])
        if a:
            hh = hours.setdefault(a.hour, {"hour": a.hour, "n": 0, "r": 0.0, "wins": 0}); hh["n"] += 1; hh["r"] += tr["r"]; hh["wins"] += 1 if tr["r"] > 0 else 0
    gp = sum(tr["result"] for tr in trades if tr["result"] > 0)
    gl = -sum(tr["result"] for tr in trades if tr["result"] < 0)
    wins = [tr for tr in trades if tr["result"] > 0]; losses = [tr for tr in trades if tr["result"] < 0]
    by_conf = {}
    for name in CONFS:
        w = [tr["r"] for tr in trades if name in tr["conf_ok"]]
        wo = [tr["r"] for tr in trades if name in tr["conf_missing"]]
        if w or wo:
            by_conf[name] = {"with": _stat(w), "without": _stat(wo)}
    by_setup = {n: _stat([tr["r"] for tr in trades if tr["setup"] == n]) for n in sorted({tr["setup"] for tr in trades})}
    by_side = {n: _stat([tr["r"] for tr in trades if tr["side"] == n]) for n in sorted({tr["side"] for tr in trades})}
    by_exit = {}
    for tr in trades:
        k = tr["exit"] or "n/d"; by_exit[k] = by_exit.get(k, 0) + 1
    hist = {}
    for r in rs:
        b = max(-3.0, min(6.0, math.floor(r * 2) / 2))
        hist[b] = hist.get(b, 0) + 1
    out["events"] = list(reversed(events))[:limit]
    out["trades"] = trades[-500:]
    out["daily"] = [dict(v, usd=round(v["usd"], 2), r=round(v["r"], 2)) for _, v in sorted(daily.items())]
    out["hours"] = [dict(v, r=round(v["r"], 2)) for _, v in sorted(hours.items())]
    out["hist"] = [{"bin": k, "n": v} for k, v in sorted(hist.items())]
    out["decisions"] = {"counts": dec_counts, "fails": sorted(({"name": k, "n": v} for k, v in fail_names.items()), key=lambda x: -x["n"])[:10],
                        "weak": sorted(({"name": k, "n": v} for k, v in weak_names.items()), key=lambda x: -x["n"])[:8]}
    out["stats"] = {"signals": signals, "opened": sum(1 for e in events if e["ev"] == "ABRIU"), "closed": len(trades), "usd": round(cum, 2),
                    "profit_factor": round(gp / gl, 2) if gl else None, "curve": curve, "r": _stat(rs), "by_conf": by_conf, "by_setup": by_setup,
                    "by_side": by_side, "by_exit": by_exit, "max_dd_usd": round(mdd, 2), "max_dd_r": round(mdd_r, 2),
                    "avg_win": round(sum(t["result"] for t in wins) / len(wins), 2) if wins else None,
                    "avg_loss": round(sum(t["result"] for t in losses) / len(losses), 2) if losses else None,
                    "avg_minutes": round(sum(t["minutes"] for t in trades if t["minutes"] is not None) / max(1, sum(1 for t in trades if t["minutes"] is not None))) if trades else None,
                    "first_t": events[0]["t"] if events else None, "last_t": events[-1]["t"] if events else None}
    return out


def all_trades():
    """Trades fechados de todos os ativos, em ordem de fechamento."""
    out = []
    for sym in symbols() or [DEFAULT_SYM]:
        out += read_journal(limit=1, sym=sym)["trades"]
    return sorted(out, key=lambda t: t["close_t"])


def trades_csv(sym=None):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["ativo", "abertura", "fechamento", "duracao_min", "lado", "setup", "lote", "entrada", "stop", "alvo", "saida_preco", "saida_motivo",
                "resultado_usd", "resultado_R", "risco_usd", "rr_planejado", "certeza_%", "confirmacoes_ok", "confirmacoes_faltaram", "por_que_entrou"])
    for tr in all_trades():
        if sym and tr.get("sym") != sym:
            continue
        w.writerow([asset_name(tr.get("sym", DEFAULT_SYM)), tr["open_t"], tr["close_t"], tr["minutes"], tr["side"], tr["setup"], tr["lots"], tr["entry"], tr["sl"], tr["tp"], tr["exit_price"], tr["exit"],
                    str(tr["result"]).replace(".", ","), str(round(tr["r"], 2)).replace(".", ","), tr["risk"], tr["rr_plan"], tr["certainty"] if tr["certainty"] is not None else "",
                    " ".join(tr["conf_ok"]), " ".join(tr["conf_missing"]), tr["why"]])
    return "﻿" + buf.getvalue()


def send_command(cmd, sym=DEFAULT_SYM, value=None):
    """Grava um comando para o robô do ativo ('all' = todos). Ele confere o id e o carimbo de tempo. Só comandos conhecidos."""
    if cmd not in COMMANDS:
        raise ValueError("comando desconhecido")
    targets = (symbols() or [DEFAULT_SYM]) if sym == "all" else [sym]
    known = set(symbols() or [DEFAULT_SYM])
    cid = int(time.time() * 1000)
    for t in targets:
        if t not in known:
            raise ValueError("ativo desconhecido")
        new, old = _paths(t, "cmd.json")
        payload = {"id": cid, "cmd": cmd, "ts": int(time.time())}
        if cmd == "target":
            v = float(value if value is not None else 0)
            if not (0 <= v <= 1_000_000):
                raise ValueError("meta fora do intervalo")
            payload["value"] = round(v, 2)
        body = json.dumps(payload, separators=(",", ":"))
        for p in [new] + ([old] if old is not None else []):          # o robô antigo (XAU_Reader) lê o nome antigo
            p.write_text(body, encoding="ascii")
    return cid


# ---------------------------------------------------------------- o dia do painel (00:00 a 23:59 no relógio do PC)
BRASILIA = timedelta(hours=-3)      # o dia do painel vira às 00:00 de Brasília (UTC-3 fixo), seja qual for o fuso do PC


def _utc_offset():
    return BRASILIA


def hoje_br():
    return datetime.utcnow() + BRASILIA


def day_window(ref=None):
    """(início, fim) do dia local de `ref` (padrão: agora) em horário do servidor/UTC (naive), que é o dos diários."""
    now = ref or (datetime.utcnow() + BRASILIA)
    ini_local = now.replace(hour=0, minute=0, second=0, microsecond=0)
    ini = ini_local - _utc_offset()
    return ini, ini + timedelta(days=1)


def local_date(server_t):
    """'2026.10.10 21:30:00' (horário do servidor) -> '2026-10-10' no relógio do PC."""
    d = _ts(server_t)
    return (d + _utc_offset()).strftime("%Y-%m-%d") if d else server_t[:10]


def today_stats(sym, events=None):
    """Entradas e resultado DE HOJE (dia local) a partir do diário: confiável mesmo com o robô parado."""
    j = read_journal(limit=100000, sym=sym) if events is None else events
    a, b = day_window()
    opened = sum(1 for e in j["events"] if e["ev"] == "ABRIU" and (_ts(e["t"]) and a <= _ts(e["t"]) < b))
    closed = [t for t in j["trades"] if _ts(t["close_t"]) and a <= _ts(t["close_t"]) < b]
    return {"opened": opened, "closed": len(closed), "takes": sum(1 for t in closed if t["r"] > 0), "usd": round(sum(t["result"] for t in closed), 2),
            "r": round(sum(t["r"] for t in closed), 2), "day": hoje_br().strftime("%Y-%m-%d")}


def _fmt_age(s):
    s = int(s or 0)
    return f"{s // 3600} h {s % 3600 // 60} min" if s >= 3600 else f"{s // 60} min"


def _fresh_alive(skip=None):
    for s in symbols() or [DEFAULT_SYM]:
        if s == skip:
            continue
        st = read_status(s)
        if st.get("alive"):
            return s, st
    return None, None


def _normalize(st, sym, tstats):
    """Robô parado não mostra os números do dia anterior como se fossem de hoje; a conta vem do robô que está ligado."""
    g = st.setdefault("guards", {})
    g["pnl_today"] = tstats["usd"]
    g["trades_today"] = tstats["opened"]
    st["today"] = tstats
    if not st.get("alive"):
        st["stale"] = True
        st["stale_for"] = _fmt_age(st.get("age_s"))
        g["day_loss_pct"] = 0.0
        if isinstance(st.get("target"), dict):
            st["target"]["gain"] = 0.0
            st["target"]["hit"] = False
        if isinstance(st.get("position"), dict) and st["position"].get("open"):
            st["position"] = {"open": False, "note": "ultimo estado do robo parado"}
        other, ost = _fresh_alive(skip=sym)
        if ost and ost.get("account"):
            st["account"] = ost["account"]; st["account_from"] = asset_name(other)
            for k in ("peak_equity", "drawdown_pct", "day_start_equity", "day_loss_pct"):
                if k in (ost.get("guards") or {}):
                    g[k] = ost["guards"][k]
            if isinstance(st.get("target"), dict) and isinstance(ost.get("target"), dict):
                st["target"]["gain"] = ost["target"].get("gain", 0.0); st["target"]["usd"] = ost["target"].get("usd", st["target"].get("usd"))
                st["target"]["hit"] = ost["target"].get("hit", False)
    return st


def snapshot(sym=DEFAULT_SYM):
    st = read_status(sym)
    j = read_journal(sym=sym)
    if st.get("found") and not st.get("error"):
        _normalize(st, sym, today_stats(sym))
    return {"status": st, "journal": j, "files_dir": str(FILES), "sym": sym, "asset": asset_name(sym), "dia": hoje_br().strftime("%Y-%m-%d")}


def overview():
    """Resumo de cada robô (para a barra de ativos e o cartão 'Robôs' da tela inicial)."""
    out = []
    for sym in symbols() or [DEFAULT_SYM]:
        st = read_status(sym)
        j = read_journal(limit=1, sym=sym)
        ts = today_stats(sym)
        alive = bool(st.get("alive"))
        out.append({"sym": sym, "asset": asset_name(sym), "found": st.get("found", False), "alive": alive, "version": st.get("version"),
                    "tf": st.get("tf"), "paused": (st.get("control") or {}).get("paused"), "position": (st.get("position") or {}).get("open") if alive else False,
                    "pnl_today": ts["usd"], "trades_today": ts["opened"], "takes_today": ts["takes"], "stale_for": None if alive else _fmt_age(st.get("age_s")),
                    "note": ((st.get("last_note") or "")[:140] if alive else "robô parado: sem decisões novas"),
                    "closed": len(j["trades"]), "sum_r": round(sum(t["r"] for t in j["trades"]), 2), "h24": st.get("h24")})
    return {"robots": out}
