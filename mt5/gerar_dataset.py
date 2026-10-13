"""Gera dados para o 'cérebro' do Kairos: roda o Testador SEM filtro de confluência (todo sinal vira trade) e guarda o diário completo de cada rodada
(cada trade com os votos dos 12 indicadores e o resultado em R). MT5 FECHADO.   python mt5/gerar_dataset.py"""
import glob, os, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cerebro", "dados")
os.makedirs(OUT, exist_ok=True)
AGENTS = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Tester\ID_DO_TERMINAL"
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpBreakevenR=0", "InpStartHour=0", "InpEndHour=24", "InpMaxTradesPerDay=100000", "InpMinConf=0",
        "InpMaxPositions=50", "InpMaxTotalRiskPct=0", "InpCooldownMin=0", "InpSentimentMode=0", "InpMinFactors=6", "InpUseConfluence=false",
        "InpHierMandatory=false", "InpDailyTargetUSD=0", "InpTargetAction=1", "InpBrainMode=0", "InpBrainMinP=0", "InpMaxDailyLossPct=100", "InpMaxConsecLosses=100000", "InpHierWeight=1"]
RUNS = [("XAUUSDm", "H1", "2019.01.01", "2026.09.26"), ("BTCUSDm", "H1", "2019.01.01", "2026.09.26"),
        ("XAUUSDm", "M15", "2023.01.01", "2026.09.26"), ("BTCUSDm", "M15", "2023.01.01", "2026.09.26")]
if "--so-h1" in sys.argv:                                  # atualizacao semanal: so o tempo grafico ao vivo (rapido)
    RUNS = [x for x in RUNS if x[1] == "H1"]
for sym, per, d0, d1 in RUNS:
    name = f"{sym}_{per}"
    t0 = time.time()
    r = rt.run(f"ds_{name}", d0, d1, 1, 10000, sym, per, BASE, 5400)
    if not r:
        print(name, "TIMEOUT"); continue
    cands = glob.glob(os.path.join(AGENTS, "Agent-*", "MQL5", "Files", f"Kairos_{sym}_journal.csv"))
    best = max(cands, key=os.path.getmtime) if cands else None
    if best and os.path.getmtime(best) >= t0:
        shutil.copy(best, os.path.join(OUT, f"{name}.csv"))
        print(name, "ok", round(os.path.getsize(best) / 1e6, 1), "MB", round(time.time() - t0), "s")
    else:
        print(name, "diario do agente nao encontrado")
print("concluido")
