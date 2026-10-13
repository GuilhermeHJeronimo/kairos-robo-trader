"""Cérebro do Kairos, versão 0: aprende com todos os sinais do histórico quais combinações de indicadores terminam em TAKE (1:3).

Regressão logística em Python puro (sem numpy), treinada em um período e testada em outro (nunca vista). O que importa é o desempenho FORA da amostra:
se os indicadores não preveem o resultado, o modelo não melhora nada e a conclusão honesta é essa.

Uso:  python cerebro/modelo.py            (usa cerebro/dados/*.csv)
"""
import glob
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dataset

BASE = os.path.dirname(os.path.abspath(__file__))


def padronizar(X, mu=None, sd=None):
    n, k = len(X), len(X[0])
    if mu is None:
        mu = [sum(r[j] for r in X) / n for j in range(k)]
        sd = [math.sqrt(sum((r[j] - mu[j]) ** 2 for r in X) / n) or 1.0 for j in range(k)]
    return [[(r[j] - mu[j]) / sd[j] for j in range(k)] for r in X], mu, sd


def treinar(X, y, l2=1.0, iters=400, lr=0.3):
    n, k = len(X), len(X[0])
    w, b = [0.0] * k, math.log(max(sum(y), 1) / max(n - sum(y), 1))
    for _ in range(iters):
        gw, gb = [0.0] * k, 0.0
        for xi, yi in zip(X, y):
            z = b + sum(wj * xj for wj, xj in zip(w, xi))
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            e = p - yi
            gb += e
            for j in range(k):
                gw[j] += e * xi[j]
        b -= lr * gb / n
        for j in range(k):
            w[j] -= lr * (gw[j] / n + l2 * w[j] / n)
    return w, b


def prever(X, w, b):
    return [1 / (1 + math.exp(-max(-30, min(30, b + sum(wj * xj for wj, xj in zip(w, xi)))))) for xi in X]


def auc(y, p):
    pos = [pi for yi, pi in zip(y, p) if yi == 1]
    neg = [pi for yi, pi in zip(y, p) if yi == 0]
    if not pos or not neg:
        return float("nan")
    pairs = sorted([(pi, 1) for pi in pos] + [(pi, 0) for pi in neg])
    rank, s, i = 0, 0.0, 0
    while i < len(pairs):
        j = i
        while j < len(pairs) and pairs[j][0] == pairs[i][0]:
            j += 1
        avg = (i + j - 1) / 2 + 1
        s += avg * sum(1 for q in pairs[i:j] if q[1] == 1)
        i = j
    return (s - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def resumo_r(rs):
    n = len(rs)
    if n == 0:
        return "n=0"
    m = sum(rs) / n
    sd = math.sqrt(sum((r - m) ** 2 for r in rs) / (n - 1)) if n > 1 else 0
    ci = 1.96 * sd / math.sqrt(n) if n > 1 else 0
    return f"n={n:>5} acerto={100 * sum(1 for r in rs if r > 0) / n:5.1f}% R/op={m:+.3f} ±{ci:.3f}"


def avaliar(nome, rows, corte):
    """Treina até a data de corte e testa depois."""
    tr = [r for r in rows if r["t"] < corte]
    te = [r for r in rows if r["t"] >= corte]
    if len(tr) < 200 or len(te) < 100:
        print(f"{nome}: poucos dados (treino {len(tr)}, teste {len(te)})")
        return None
    Xtr, mu, sd = padronizar([[r[f] for f in dataset.FEATURES] for r in tr])
    Xte, _, _ = padronizar([[r[f] for f in dataset.FEATURES] for r in te], mu, sd)
    ytr, yte = [r["win"] for r in tr], [r["win"] for r in te]
    w, b = treinar(Xtr, ytr)
    p_tr, p_te = prever(Xtr, w, b), prever(Xte, w, b)
    print(f"\n=== {nome} | treino até {corte[:10]}: {len(tr)} trades ({100 * sum(ytr) / len(ytr):.1f}% TAKE) | teste: {len(te)} trades ({100 * sum(yte) / len(yte):.1f}% TAKE)")
    print(f"AUC treino {auc(ytr, p_tr):.3f} | AUC TESTE {auc(yte, p_te):.3f}   (0,500 = nenhuma capacidade de previsão)")
    print("sem filtro (teste):                ", resumo_r([r["r"] for r in te]))
    order = sorted(range(len(te)), key=lambda i: -p_te[i])
    for frac in (0.5, 0.3, 0.2, 0.1):
        k = max(1, int(len(te) * frac))
        print(f"cérebro: só o {int(frac * 100):>2}% melhor (teste):  ", resumo_r([te[i]["r"] for i in order[:k]]))
    # aleatório com o mesmo tamanho (controle)
    random.seed(7)
    k = max(1, int(len(te) * 0.2))
    print("controle: 20% ao acaso (teste):    ", resumo_r([te[i]["r"] for i in random.sample(range(len(te)), k)]))
    imp = sorted(zip(dataset.FEATURES, w), key=lambda x: -abs(x[1]))[:6]
    print("pesos maiores:", ", ".join(f"{f} {c:+.2f}" for f, c in imp))
    return {"w": w, "b": b, "mu": mu, "sd": sd, "features": dataset.FEATURES, "auc_teste": auc(yte, p_te)}


def walk_forward(nome, rows, frac=0.3):
    """Treina com tudo até o fim de cada semestre e testa no semestre seguinte (varias vezes), para ver se o ganho se repete."""
    semestres = sorted({r["t"][:4] + ("S1" if int(r["t"][5:7]) <= 6 else "S2") for r in rows})
    print(f"--- {nome}: teste semestre a semestre (treina só com o passado; filtro = {int(frac * 100)}% melhores) ---")
    tot_all, tot_f, aucs = [], [], []
    for k in range(3, len(semestres)):
        alvo = semestres[k]
        tr = [r for r in rows if (r["t"][:4] + ("S1" if int(r["t"][5:7]) <= 6 else "S2")) < alvo]
        te = [r for r in rows if (r["t"][:4] + ("S1" if int(r["t"][5:7]) <= 6 else "S2")) == alvo]
        if len(tr) < 300 or len(te) < 60:
            continue
        Xtr, mu, sd = padronizar([[r[f] for f in dataset.FEATURES] for r in tr])
        Xte, _, _ = padronizar([[r[f] for f in dataset.FEATURES] for r in te], mu, sd)
        w, b = treinar(Xtr, [r["win"] for r in tr])
        p = prever(Xte, w, b)
        order = sorted(range(len(te)), key=lambda i: -p[i])[:max(1, int(len(te) * frac))]
        ra = [r["r"] for r in te]; rf = [te[i]["r"] for i in order]
        tot_all += ra; tot_f += rf
        aucs.append((alvo, auc([r["win"] for r in te], p)))
        print(f"{alvo}: AUC {auc([r['win'] for r in te], p):.3f} | todos {resumo_r(ra)} | cérebro {resumo_r(rf)}")
    print(f"JUNTANDO TODOS OS SEMESTRES  sem filtro: {resumo_r(tot_all)}")
    print(f"                             cérebro:    {resumo_r(tot_f)}")
    return aucs


def main():
    arqs = sorted(glob.glob(os.path.join(BASE, "dados", "*.csv")))
    if not arqs:
        print("sem dados em cerebro/dados")
        return
    todos = {}
    for a in arqs:
        nome = os.path.splitext(os.path.basename(a))[0]
        ativo, tf = nome.split("_")
        rows = dataset.linhas(a, ativo, tf)
        todos[nome] = rows
        print(f"{nome}: {len(rows)} trades, de {rows[0]['t'][:10] if rows else '-'} a {rows[-1]['t'][:10] if rows else '-'}")
    saida = {}
    for nome, rows in todos.items():
        if not rows:
            continue
        ini, fim = rows[0]["t"][:10], rows[-1]["t"][:10]
        # corte: 70% do período mais antigo para treino
        corte = rows[int(len(rows) * 0.7)]["t"]
        r = avaliar(nome, rows, corte)
        if r:
            saida[nome] = r
        walk_forward(nome, rows)
    json.dump(saida, open(os.path.join(BASE, "modelos.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
