"""Atualiza o cérebro do Kairos (rodar uma vez por semana, ou quando quiser):

  1. fecha o MT5 com calma (as posições abertas ficam com stop e alvo) e roda o Testador SEM filtro, para gerar todos os sinais do histórico;
  2. treina um modelo por ativo no tempo gráfico ao vivo (H1) e mede, semestre a semestre, se ele acerta FORA da amostra;
  3. grava Kairos_<ativo>_brain.txt na pasta do MT5 com a regra de confiança:
        usable=1 só se o AUC médio dos 4 últimos semestres for >= 0,55 e nenhum deles < 0,52. Senão o robô só mostra a probabilidade;
  4. reabre o MT5.

Uso:  python cerebro/atualizar.py            (completo)
      python cerebro/atualizar.py --so-treino   (reaproveita cerebro/dados e não mexe no MT5)
"""
import os
import subprocess
import sys
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, AQUI)
sys.path.insert(0, RAIZ)
import dataset
import modelo
import robot

TF_VIVO = "H1"
ATIVOS = ("XAUUSDm", "BTCUSDm")
MT5 = r"C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe"


def ps(cmd):
    return subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True).stdout.strip()


def fechar_mt5():
    ps("Get-Process terminal64 -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }")
    for _ in range(30):
        time.sleep(2)
        if not ps("Get-Process terminal64 -ErrorAction SilentlyContinue | Select -First 1 Id"):
            return True
    return False


def treinar_ativo(ativo):
    arq = os.path.join(AQUI, "dados", f"{ativo}_{TF_VIVO}.csv")
    rows = dataset.linhas(arq, ativo, TF_VIVO)
    if len(rows) < 800:
        print(ativo, "poucos dados:", len(rows))
        return None
    aucs = modelo.walk_forward(f"{ativo}_{TF_VIVO}", rows)
    ult = [a for _, a in aucs[-4:]]
    usable = len(ult) >= 3 and sum(ult) / len(ult) >= 0.55 and min(ult) >= 0.52
    X, mu, sd = modelo.padronizar([[r[f] for f in dataset.FEATURES] for r in rows])
    y = [r["win"] for r in rows]
    w, b = modelo.treinar(X, y)
    base = sum(y) / len(y)
    auc_med = sum(ult) / len(ult) if ult else 0.5
    linhas = [f"tf={TF_VIVO}", f"base={base:.4f}", f"auc={auc_med:.3f}", f"usable={1 if usable else 0}", f"b={b:.6f}",
              f"# gerado em {time.strftime('%Y-%m-%d %H:%M')} com {len(rows)} sinais; AUC dos ultimos semestres: " + ", ".join(f"{s}={a:.2f}" for s, a in aucs[-4:])]
    linhas += [f"f={n};{wi:.6f};{m:.6f};{s:.6f}" for n, wi, m, s in zip(dataset.FEATURES, w, mu, sd)]
    destino = robot.FILES / f"Kairos_{ativo}_brain.txt"
    destino.write_text("\n".join(linhas) + "\n", encoding="ascii")
    print(f"{ativo}: cérebro gravado em {destino.name} | AUC médio recente {auc_med:.3f} | confiável: {'SIM' if usable else 'NÃO (o robô só informa)'}")
    return {"ativo": ativo, "n": len(rows), "auc": auc_med, "usable": usable}


def main():
    so_treino = "--so-treino" in sys.argv
    if not so_treino:
        print("Fechando o MT5 (as posições abertas ficam com stop e alvo)…")
        if not fechar_mt5():
            print("Não consegui fechar o MT5; feche manualmente e rode de novo.")
            return
        print("Gerando os sinais no Testador (uns 5 minutos)…")
        r = subprocess.run([sys.executable, os.path.join(RAIZ, "mt5", "gerar_dataset.py"), "--so-h1"])
        if r.returncode != 0:
            print("gerar_dataset falhou")
    resultados = [treinar_ativo(a) for a in ATIVOS]
    if not so_treino:
        subprocess.Popen([MT5])
        print("MT5 reaberto.")
    print(resultados)


if __name__ == "__main__":
    main()
