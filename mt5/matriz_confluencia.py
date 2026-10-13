"""Matriz da confluência de indicadores (Kairos). MT5 FECHADO.  python mt5/matriz_confluencia.py [XAUUSDm|BTCUSDm] -> mt5/resultados_confluencia.txt"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados_confluencia.txt")
SYM = sys.argv[1] if len(sys.argv) > 1 else "XAUUSDm"
PER, D0, D1, SINCE = "M15", "2025.06.01", "2026.09.26", "2025.08.01"
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpBreakevenR=0", "InpStartHour=0", "InpEndHour=24", "InpMaxTradesPerDay=100", "InpMinConf=0",
        "InpMaxPositions=3", "InpMaxTotalRiskPct=1.5", "InpCooldownMin=30", "InpSentimentMode=0", "InpMinFactors=6"]
VAR = [("A regra antiga: hierarquia obrigatoria, sem confluencia", ["InpUseConfluence=false", "InpHierMandatory=true"]),
       ("B confluencia 75%, hierarquia so indicador", ["InpUseConfluence=true", "InpMinConfluence=75", "InpHierMandatory=false"]),
       ("C confluencia 75% + hierarquia obrigatoria", ["InpUseConfluence=true", "InpMinConfluence=75", "InpHierMandatory=true"]),
       ("D confluencia 65%, hierarquia so indicador", ["InpUseConfluence=true", "InpMinConfluence=65", "InpHierMandatory=false"]),
       ("E confluencia 55%, hierarquia so indicador", ["InpUseConfluence=true", "InpMinConfluence=55", "InpHierMandatory=false"]),
       ("F sem hierarquia e sem confluencia (tudo que o leitor acha)", ["InpUseConfluence=false", "InpHierMandatory=false"])]
with open(OUT, "a", encoding="utf-8") as f:
    f.write(f"# confluencia {SYM} {PER} iniciada {time.strftime('%Y-%m-%d %H:%M:%S')}\n"); f.flush()
    for k, (nome, ov) in enumerate(VAR):
        r = rt.run(f"cf_{SYM}_{k}", D0, D1, 1, 10000, SYM, PER, BASE + ov, 5400)
        if not r:
            f.write(f"{SYM} {PER} | {nome} | TIMEOUT\n"); f.flush(); continue
        log, start, secs = r
        opened, results, sig, skip = rt.parse_log(log, start)
        s = rt.summarize(opened, results, SINCE)
        if s.get("n"):
            dias = max(1, (time.mktime(time.strptime(D1, "%Y.%m.%d")) - time.mktime(time.strptime(SINCE, "%Y.%m.%d"))) / 86400 * (1 if "BTC" in SYM else 5 / 7))
            linha = (f"{SYM} {PER} | {nome} | ops={s['n']} | por dia={s['n']/dias:.2f} | acerto={s['win']:.1f}% | R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} ±{s['ci']:.3f} | FP={s['pf']:.2f} | tempo={secs:.0f}s")
        else:
            linha = f"{SYM} {PER} | {nome} | ops=0"
        print(linha); f.write(linha + "\n"); f.flush()
    f.write("# concluida\n")
