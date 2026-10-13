"""Testa a meta de ganho do dia no Testador (ouro H1, 2026.01 a 2026.09): sem meta e com metas de US$ 100 e US$ 300. MT5 FECHADO.
Confere: (1) o robô para ao bater a meta, (2) não abre posição depois da meta no mesmo dia, (3) volta no dia seguinte."""
import glob, os, re, shutil, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

AGENTS = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Tester\ID_DO_TERMINAL"
BASE = ["InpEvalMode=0", "InpTwoStep=false", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpBreakevenR=0", "InpStartHour=0", "InpEndHour=24", "InpMaxTradesPerDay=100000", "InpMinConf=0",
        "InpMaxPositions=10", "InpMaxTotalRiskPct=5", "InpCooldownMin=0", "InpSentimentMode=0", "InpMinFactors=6", "InpUseConfluence=true", "InpMinConfluence=75",
        "InpHierMandatory=false", "InpBrainMode=0", "InpMaxDailyLossPct=100", "InpMaxConsecLosses=100000", "InpHierWeight=1", "InpTargetAction=1"]
D0, D1 = (sys.argv[1], sys.argv[2]) if len(sys.argv) > 2 else ("2026.01.01", "2026.09.26")
for meta in (0, 100, 300, 600):
    t0 = time.time()
    r = rt.run(f"meta_{meta}", D0, D1, 1, 10000, "XAUUSDm", "H1", BASE + [f"InpDailyTargetUSD={meta}"], 1800)
    cands = glob.glob(os.path.join(AGENTS, "Agent-*", "MQL5", "Files", "Kairos_XAUUSDm_journal.csv"))
    best = max(cands, key=os.path.getmtime)
    linhas = open(best, encoding="cp1252", errors="replace").read().splitlines()
    metas, aberturas, dias_meta = [], {}, {}
    ops, usd = 0, 0.0
    for ln in linhas:
        p = ln.split(";", 2)
        if len(p) < 3:
            continue
        d = p[0][:10]
        if p[1] == "META":
            metas.append(p[0]); dias_meta[d] = p[0]
        elif p[1] == "ABRIU":
            ops += 1
            aberturas.setdefault(d, []).append(p[0])
        elif p[1] == "FECHOU":
            m = re.search(r"resultado=(-?[\d.]+)", p[2])
            usd += float(m.group(1)) if m else 0
    apos = sum(1 for d, t in dias_meta.items() for a in aberturas.get(d, []) if a > t)
    dias = len({p[0][:10] for p in (l.split(";", 2) for l in linhas) if len(p) > 1})
    print(f"meta US$ {meta:>3} | entradas={ops} | resultado US$ {usd:+.0f} | dias com meta batida={len(dias_meta)} | aberturas DEPOIS da meta no mesmo dia={apos} | {time.time() - t0:.0f}s")
    shutil.copy(best, os.path.join(os.path.dirname(os.path.abspath(__file__)), f"teste_meta_{meta}.csv"))
