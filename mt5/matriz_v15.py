"""Matriz da v1.5 (proteção de lucro/breakeven e 1 posição por vez) no ouro. MT5 FECHADO e sem robô nos gráficos:
    python mt5/matriz_v15.py  -> mt5/resultados_v15.txt   (H1 = amostra longa e rápida; M5 = parecido com o robô ao vivo)
Trava de queda desligada no Testador (InpMaxDrawdownPct=100). Calendário de notícias não existe no Testador."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados_v15.txt")
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpCooldownMin=30", "InpBEOffsetR=0.05"]
H1 = ("H1", "2019.01.01", "2026.09.26", ["2021.11.01", "2023.09.01"])
M5 = ("M5", "2025.01.01", "2026.09.26", ["2025.03.01"])
VAR = [("base: 2 posicoes, sem protecao", ["InpMaxPositions=2", "InpBreakevenR=0"]),
       ("1 posicao, sem protecao", ["InpMaxPositions=1", "InpBreakevenR=0"]),
       ("1 posicao + breakeven em 1,0R", ["InpMaxPositions=1", "InpBreakevenR=1.0"]),
       ("1 posicao + breakeven em 1,5R", ["InpMaxPositions=1", "InpBreakevenR=1.5"]),
       ("1 posicao + breakeven em 2,0R", ["InpMaxPositions=1", "InpBreakevenR=2.0"])]
which = sys.argv[1:] or ["H1", "M5"]
with open(OUT, "a", encoding="utf-8") as f:
    f.write(f"# matriz v1.5 iniciada {time.strftime('%Y-%m-%d %H:%M:%S')}\n"); f.flush()
    for per, d0, d1, since in [x for x in (H1, M5) if x[0] in which]:
        for k, (nome, ov) in enumerate(VAR):
            r = rt.run(f"m15_{per}_{k}", d0, d1, 1, 10000, "XAUUSDm", per, BASE + ov, 3600)
            if not r:
                f.write(f"{per} {nome} | TIMEOUT\n"); f.flush(); continue
            log, start, secs = r
            opened, results, sig, skip = rt.parse_log(log, start)
            for cut in since:
                s = rt.summarize(opened, results, cut)
                if s.get("n"):
                    linha = (f"{per} | {nome} | desde {cut} | ops={s['n']} | acerto={s['win']:.1f}% | R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} ±{s['ci']:.3f} | FP={s['pf']:.2f} | tempo={secs:.0f}s")
                else:
                    linha = f"{per} | {nome} | desde {cut} | ops=0"
                print(linha); f.write(linha + "\n"); f.flush()
    f.write("# concluida\n")
