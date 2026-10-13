"""Matriz de testes da v1.2 (Testador do MT5). Trava de queda máxima DESLIGADA no Testador (100%), para cada rodada cobrir o período inteiro.
Rodar com o MT5 fechado e sem robô nos gráficos:  python mt5/matriz_v12.py   -> mt5/resultados_v12.txt"""
import os, sys, io, contextlib, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados_v12.txt")
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false"]
H1 = ("H1", "2019.01.01", "2026.09.26", "2021.11.01,2023.09.01")
CASOS = [
    ("H1 estrutura, sem hierarquia", H1, ["InpRRMode=0", "InpUseHierarchy=false"]),
    ("H1 estrutura, hierarquia 1 nivel", H1, ["InpRRMode=0", "InpUseHierarchy=true", "InpHierLevels=1"]),
    ("H1 estrutura, hierarquia 2 niveis", H1, ["InpRRMode=0", "InpUseHierarchy=true", "InpHierLevels=2"]),
    ("H1 fixa 1:3, sem hierarquia", H1, ["InpRRMode=1", "InpUseHierarchy=false"]),
    ("H1 fixa 1:3, hierarquia 1 nivel", H1, ["InpRRMode=1", "InpUseHierarchy=true", "InpHierLevels=1"]),
    ("H1 fixa 1:3, hierarquia 2 niveis", H1, ["InpRRMode=1", "InpUseHierarchy=true", "InpHierLevels=2"]),
    ("H1 fixa 1:3, hier. 1 nivel, duas etapas (30 s)", H1, ["InpRRMode=1", "InpUseHierarchy=true", "InpHierLevels=1", "InpTwoStep=true"]),
    ("H1 fixa 1:3, hier. 1 nivel, duas etapas + certeza 70", H1, ["InpRRMode=1", "InpUseHierarchy=true", "InpHierLevels=1", "InpTwoStep=true", "InpMinCertainty=70"]),
]
with open(OUT, "a", encoding="utf-8") as f:
    f.write(f"# matriz iniciada {time.strftime('%Y-%m-%d %H:%M:%S')}\n"); f.flush()
    for k, (nome, (per, d0, d1, since), ov) in enumerate(CASOS):
        inputs = BASE + ov
        if "InpTwoStep=true" in ov:
            inputs = [i for i in inputs if not i.startswith("InpTwoStep=false")]
        if "InpMinCertainty=70" in ov:
            inputs = [i for i in inputs if not i.startswith("InpMinCertainty=0")]
        r = rt.run(f"m12_{k}", d0, d1, 1, 10000, "XAUUSDm", per, inputs, 1800)
        if not r:
            f.write(f"{nome} | TIMEOUT\n"); f.flush(); continue
        log, start, secs = r
        opened, results, sig, skip = rt.parse_log(log, start)
        lastd = opened[-1]["date"] if opened else "--"
        for cut in since.split(","):
            s = rt.summarize(opened, results, cut)
            if s.get("n"):
                linha = (f"{nome} | desde {cut} | ops={s['n']} (ultima {lastd}) | acerto={s['win']:.1f}% | R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} ±{s['ci']:.3f} | FP={s['pf']:.2f} | lucro=US$ {s['profit']:+.0f} | maior queda=US$ {s['mdd']:.0f}")
            else:
                linha = f"{nome} | desde {cut} | ops=0 (ultima {lastd})"
            print(linha); f.write(linha + "\n"); f.flush()
    f.write("# matriz concluida\n")
