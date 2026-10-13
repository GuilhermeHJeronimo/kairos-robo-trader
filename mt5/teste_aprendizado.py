"""Testes ligados ao que o Kairos viveu ao vivo (outubro/2026). MT5 FECHADO.
   python mt5/teste_aprendizado.py replica     -> repete no Testador os dias de 08 a 10/10 (candle fechado, M5) para comparar com o ao vivo
   python mt5/teste_aprendizado.py variantes   -> compara proteções (sem posição contrária, freio de desempenho) em M5, 2026.01 a 2026.10"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import run_tester as rt

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados_aprendizado.txt")
LIVE = ["InpEvalMode=0", "InpTwoStep=true", "InpMinCertainty=0", "InpMaxDrawdownPct=100", "InpNewsBlackout=false", "InpRRMode=1", "InpFixedRR=3.0",
        "InpUseHierarchy=true", "InpHierLevels=1", "InpBreakevenR=0", "InpStartHour=0", "InpEndHour=24", "InpMaxTradesPerDay=100000", "InpMinConf=0",
        "InpMaxPositions=10", "InpMaxTotalRiskPct=5", "InpCooldownMin=30", "InpSentimentMode=0", "InpMinFactors=6", "InpUseConfluence=true", "InpMinConfluence=75",
        "InpHierMandatory=false", "InpBrainMode=0", "InpMaxDailyLossPct=100", "InpMaxConsecLosses=100000", "InpHierWeight=1", "InpDailyTargetUSD=0", "InpTargetAction=1"]
modo = sys.argv[1] if len(sys.argv) > 1 else "replica"
if modo == "replica":
    RUNS = [(s, "M5", "2026.10.07", "2026.10.10", "ao vivo (sem protecoes)", ["InpNoHedge=false", "InpBrakeEvents=0"]) for s in ("XAUUSDm", "BTCUSDm")]
else:
    V = [("A base: como estava ao vivo", ["InpNoHedge=false", "InpBrakeEvents=0"]),
         ("B sem posicao contraria", ["InpNoHedge=true", "InpBrakeEvents=0"]),
         ("C freio: 5 perdas seguidas, 3 h", ["InpNoHedge=false", "InpBrakeEvents=5", "InpBrakeHours=3"]),
         ("D sem posicao contraria + freio", ["InpNoHedge=true", "InpBrakeEvents=5", "InpBrakeHours=3"]),
         ("E D + no maximo 4 posicoes e 2% de risco aberto", ["InpNoHedge=true", "InpBrakeEvents=5", "InpBrakeHours=3", "InpMaxPositions=4", "InpMaxTotalRiskPct=2"])]
    RUNS = [(s, "M5", "2026.01.01", "2026.10.09", n, o) for s in ("XAUUSDm", "BTCUSDm") for n, o in V]
with open(OUT, "a", encoding="utf-8") as f:
    f.write(f"# {modo} iniciado {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    for k, (sym, per, d0, d1, nome, ov) in enumerate(RUNS):
        r = rt.run(f"ap_{modo}_{k}", d0, d1, 1, 10000, sym, per, LIVE + ov, 5400)
        if not r:
            f.write(f"{sym} {per} | {nome} | TIMEOUT\n"); f.flush(); continue
        log, start, secs = r
        opened, results, sig, skip = rt.parse_log(log, start)
        s = rt.summarize(opened, results, None)
        linha = (f"{sym} {per} {d0}..{d1} | {nome} | ops={s['n']} | acerto={s['win']:.1f}% | R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} ±{s['ci']:.3f} | FP={s['pf']:.2f} | {secs:.0f}s"
                 if s.get("n") else f"{sym} {per} | {nome} | ops=0")
        print(linha); f.write(linha + "\n"); f.flush()
    f.write("# concluida\n")
