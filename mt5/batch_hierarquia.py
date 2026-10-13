"""Compara a hierarquia de Dow (desligada, 1, 2 e 3 níveis) no Testador do MT5, em vários tempos gráficos.

Rodar com o MT5 FECHADO e sem robô salvo nos gráficos:
    python mt5/batch_hierarquia.py
Resultados em mt5/resultados_hierarquia.txt (uma linha por rodada).
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados_hierarquia.txt")
PLANOS = [("H1", "2021.01.01", "2026.09.26"), ("M15", "2024.01.01", "2026.09.26"), ("M5", "2024.01.01", "2026.09.26")]
MODOS = [("sem hierarquia", ["InpUseHierarchy=false"]), ("1 nível", ["InpUseHierarchy=true", "InpHierLevels=1"]),
         ("2 níveis", ["InpUseHierarchy=true", "InpHierLevels=2"]), ("3 níveis", ["InpUseHierarchy=true", "InpHierLevels=3"])]

with open(OUT, "a", encoding="utf-8") as f:
    f.write(f"# lote iniciado {time.strftime('%Y-%m-%d %H:%M:%S')}\n"); f.flush()
    for period, dfrom, dto in PLANOS:
        for nome, inp in MODOS:
            tag = f"h_{period}_{nome.replace(' ', '').replace('í', 'i')}"
            r = rt.run(tag, dfrom, dto, 1, 10000, "XAUUSDm", period, inp, 1500)
            if not r:
                f.write(f"{period} | {nome} | TIMEOUT\n"); f.flush(); continue
            log, start, secs = r
            opened, results, sig, skip = rt.parse_log(log, start)
            s = rt.summarize(opened, results)
            if s.get("n"):
                linha = (f"{period} | {dfrom}..{dto} | {nome:14s} | sinais={sig} | operações={s['n']} | acerto={s['win']:.1f}% | "
                         f"R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} ±{s['ci']:.3f} | fator lucro={s['pf']:.2f} | lucro=US$ {s['profit']:+.0f} | {secs:.0f}s")
            else:
                linha = f"{period} | {dfrom}..{dto} | {nome:14s} | sinais={sig} | operações=0 | {secs:.0f}s"
            print(linha); f.write(linha + "\n"); f.flush()
    f.write("# lote concluído\n")
