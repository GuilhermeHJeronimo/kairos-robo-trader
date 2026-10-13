"""Matriz v1.7: quantas entradas por dia e que R/op com mais posições simultâneas (risco total limitado) e pausa menor. M5 (tempo gráfico do robô ao vivo).
MT5 FECHADO e sem robô nos gráficos:  python mt5/matriz_v17.py  -> mt5/resultados_v17.txt"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados_v17b.txt")
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpBreakevenR=0", "InpStartHour=0", "InpEndHour=24", "InpMaxTradesPerDay=100"]
D0, D1, SINCE = "2025.06.01", "2026.09.26", "2025.08.01"
VAR = [(f"{p} | 1 posicao, pausa 30", p, ["InpMaxPositions=1", "InpMaxTotalRiskPct=0", "InpCooldownMin=30"]) for p in ("M15", "M30", "H1")] +       [(f"{p} | 3 posicoes (risco total 1,5%), pausa 30", p, ["InpMaxPositions=3", "InpMaxTotalRiskPct=1.5", "InpCooldownMin=30"]) for p in ("M15", "M30", "H1")]
with open(OUT, "a", encoding="utf-8") as f:
    f.write(f"# matriz v1.7 iniciada {time.strftime('%Y-%m-%d %H:%M:%S')}\n"); f.flush()
    for k, (nome, PER, ov) in enumerate(VAR):
        r = rt.run(f"m17b_{k}", D0, D1, 1, 10000, "XAUUSDm", PER, BASE + ov, 5400)
        if not r:
            f.write(f"{nome} | TIMEOUT\n"); f.flush(); continue
        log, start, secs = r
        opened, results, sig, skip = rt.parse_log(log, start)
        s = rt.summarize(opened, results, SINCE)
        if s.get("n"):
            dias = max(1, (time.mktime(time.strptime(D1, "%Y.%m.%d")) - time.mktime(time.strptime(SINCE, "%Y.%m.%d"))) / 86400 * 5 / 7)
            linha = (f"{nome} | desde {SINCE} | ops={s['n']} | por dia util={s['n']/dias:.2f} | acerto={s['win']:.1f}% | R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} ±{s['ci']:.3f} | FP={s['pf']:.2f} | tempo={secs:.0f}s")
        else:
            linha = f"{nome} | desde {SINCE} | ops=0"
        print(linha); f.write(linha + "\n"); f.flush()
    f.write("# concluida\n")
