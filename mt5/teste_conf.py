"""Testa a saida por tempo (InpMinConfluence) no Testador. MT5 FECHADO. Uso: python teste_tempo.py SIMBOLO TF DE ATE h1,h2,..."""
import glob, os, re, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt
AG = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Tester\ID_DO_TERMINAL"
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpBreakevenR=0", "InpStartHour=0", "InpEndHour=24", "InpMaxTradesPerDay=100000", "InpMinConf=0",
        "InpMaxPositions=4", "InpMaxTotalRiskPct=2", "InpCooldownMin=0", "InpSentimentMode=0", "InpMinFactors=6", "InpUseConfluence=true", "InpMinConfluence=75",
        "InpHierMandatory=false", "InpBrainMode=0", "InpMaxDailyLossPct=100", "InpMaxConsecLosses=100000", "InpHierWeight=1", "InpTargetAction=1", "InpDailyTargetUSD=0", "InpMaxHoldHours=0"]
sym, tf, d0, d1, hs = sys.argv[1:6]
for h in hs.split(","):
    t0 = time.time()
    rt.run(f"conf_{sym}_{h}", d0, d1, 1, 10000, sym, tf, BASE + [f"InpMinConfluence={h}"], 3000)
    best = max(glob.glob(os.path.join(AG, "Agent-*", "MQL5", "Files", f"Kairos_{sym}_journal.csv")), key=os.path.getmtime)
    risco, ops, takes, tempo, soma_r, soma_usd = {}, 0, 0, 0, 0.0, 0.0
    for ln in open(best, encoding="cp1252", errors="replace"):
        p = ln.split(";", 2)
        if len(p) < 3: continue
        if p[1] == "ABRIU":
            m = re.search(r"pos=(\d+).*risco\$=([\d.]+)", p[2]) or re.search(r"risco\$=([\d.]+).*pos=(\d+)", p[2])
            mm = re.search(r"risco\$=([\d.]+)", p[2]); pp = re.search(r"pos=(\d+)", p[2])
            if mm and pp: risco[pp.group(1)] = float(mm.group(1)); ops += 1
        elif p[1] == "SAIDA_TEMPO": tempo += 1
        elif p[1] == "FECHOU":
            r = float(re.search(r"resultado=(-?[\d.]+)", p[2]).group(1)); pid = re.search(r"pos=(\d+)", p[2]).group(1)
            soma_usd += r; soma_r += r / risco[pid] if risco.get(pid) else 0
            takes += "alvo" in p[2]
    print(f"{sym} {tf} conf={h:>4} | ops={ops} takes={takes} saidas_tempo={tempo} | R total={soma_r:+.1f} R/op={soma_r/max(ops,1):+.3f} | US$ {soma_usd:+.0f} | {time.time()-t0:.0f}s", flush=True)
