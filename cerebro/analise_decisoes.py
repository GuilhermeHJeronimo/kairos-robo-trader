"""Cruza o que o robô DECIDIU (placar de indicadores) com o que o preço FEZ, no histórico em que todo sinal virou trade (sem filtro de confluência).
Responde: a confluência de 75% filtra de verdade? Quais faixas de confluência/opiniões ganham em cada período? Só com n alto e dois períodos."""
import glob, os, sys, statistics as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dataset

V = ["v_estrutura", "v_hier", "v_medias", "v_rsi", "v_macd", "v_vwap", "v_perfil", "v_liquidez", "v_volume", "v_vol", "v_vela"]
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dados")


def conf(r):
    a = sum(1 for k in V if r[k] > 0); c = sum(1 for k in V if r[k] < 0)
    return (a / (a + c) if a + c else None), a + c


def resumo(rs):
    if not rs: return "n=0"
    m = sum(r["r"] for r in rs) / len(rs); w = sum(r["win"] for r in rs) / len(rs)
    e = (st.pstdev([r["r"] for r in rs]) / len(rs) ** .5) if len(rs) > 1 else 0
    return f"n={len(rs):>5} R/op={m:+.3f} (±{e:.3f}) acerto={w*100:4.1f}%"


out = []
for f in sorted(glob.glob(os.path.join(D, "*_H1.csv"))):
    ativo = os.path.basename(f).split("_")[0]
    rows = dataset.linhas(f, ativo, "H1")
    for r in rows: r["c"], r["op"] = conf(r)
    rows = [r for r in rows if r["c"] is not None]
    out.append(f"\n=== {ativo} H1 | {len(rows)} sinais, todos executados no teste ({rows[0]['t'][:10]} a {rows[-1]['t'][:10]}) ===")
    metade = [r for r in rows if r["t"] < "2024"], [r for r in rows if r["t"] >= "2024"]
    out.append(f"{'faixa de confluência':<26}{'2021-2023':<44}{'2024-2026'}")
    for lo, hi, nome in [(0, .5, "< 50%"), (.5, .75, "50% a 74%"), (.75, .9, "75% a 89%"), (.9, 1.01, "90% a 100%"), (.75, 1.01, ">= 75% (regra atual)")]:
        a = [resumo([r for r in m if lo <= r["c"] < hi]) for m in metade]
        out.append(f"{nome:<26}{a[0]:<44}{a[1]}")
    out.append("-- por número de indicadores com opinião --")
    for lo, hi, nome in [(0, 5, "< 6 opiniões"), (6, 8, "6 a 7"), (8, 12, "8 ou mais")]:
        a = [resumo([r for r in m if lo <= r["op"] < hi]) for m in metade]
        out.append(f"{nome:<26}{a[0]:<44}{a[1]}")
    out.append("-- todos os sinais (referência) --")
    out.append(f"{'sem filtro':<26}{resumo(metade[0]):<44}{resumo(metade[1])}")
    # correlação confluência x resultado
    xs = [r["c"] for r in rows]; ys = [r["r"] for r in rows]
    mx, my = st.mean(xs), st.mean(ys)
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / len(xs)
    out.append(f"correlação confluência x R = {cov / (st.pstdev(xs) * st.pstdev(ys)):+.3f} (0 = sem relação)")
txt = "\n".join(out)
print(txt)
open(os.path.join(os.path.dirname(D), "resultados_decisoes.txt"), "w", encoding="utf-8").write(txt)
