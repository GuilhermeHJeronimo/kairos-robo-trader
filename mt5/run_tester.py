"""Executor do Testador de Estratégia do MT5 pela linha de comando.

Uso (MT5 precisa estar FECHADO):
    python mt5/run_tester.py --name conf2 --from 2024.01.01 --to 2026.09.26 --model 1 --deposit 10000 InpMinConf=2

Roda o robô XAU_Reader no XAUUSDm, espera terminar e resume: nº de operações, acerto, resultado em R
(lucro dividido pelo risco planejado de cada operação, lido do diário do robô), fator de lucro e drawdown.
O testador é uma simulação: não envia ordens à conta.
"""
import argparse, glob, os, re, subprocess, sys, math, time

# O testador do MT5 reaproveita os valores da execução ANTERIOR para opções que não forem enviadas.
# Por isso todas as opções do robô são enviadas em toda execução (padrões abaixo = padrões do XAU_Reader).
DEFAULTS = dict(InpAllowRealAccount="true", InpMagic="26093001", InpRiskPct="0.5", InpMaxDailyLossPct="2.0", InpMaxDrawdownPct="10.0",
                InpMaxTradesPerDay="10", InpMaxConsecLosses="5", InpMaxPositions="3", InpMaxTotalRiskPct="1.5", InpMaxSpreadATRPct="15.0", InpCooldownMin="30", InpBreakevenR="0", InpBEOffsetR="0.05", InpDemoRelaxLocks="true", InpDailyTargetUSD="0", InpTargetAction="1", InpBrainMode="0", InpBrainMinP="0", InpUseConfluence="true", InpMinConfluence="75", InpMinFactors="6", InpRsiPeriod="14", InpHierMandatory="false", InpMaxSpread="0.60", InpMaxCostToRisk="0.25", InpMaxRiskOverrun="2.0",
                InpMaxMarginUsePct="50.0", InpCloseOnKill="true", InpResetKill="false", InpStartHour="7", InpEndHour="21",
                InpFridayLastHour="19", InpFridayNoEntryHours="3", InpCloseBeforeWeekend="true", InpCloseMinutesBeforeEnd="90", InpFridayCloseHour="19", InpTF="0", InpUseHierarchy="true", InpHierPrimaryTF="49153", InpHierSecondaryTF="32769", InpHierTertiaryTF="16408", InpHierLevels="1", InpUseBreakout="true",
                InpBreakoutRetest="false", InpUseRejection="true", InpUsePullback="true", InpMinRR="1.5", InpSlippagePts="30",
                InpMinConf="1", InpConfTrend="true", InpConfVWAP="true", InpConfProfile="true", InpConfLiquidity="true", InpConfFlow="false",
                InpRRMode="1", InpFixedRR="3.0", InpEvalMode="1", InpRealtimeSecs="5", InpTwoStep="true", InpVerifySecs="30", InpMaxChaseATR="0.5",
                InpMinCertainty="70", InpNewsBlackout="true", InpNewsBeforeMin="30", InpNewsAfterMin="30", InpSentimentMode="1", InpSentimentVeto="50",
                InpSentimentMaxAgeMin="240", InpAllowPanelControl="true", InpProfileHours="24", InpFlowMinutes="10", InpFlowThreshold="0.10", InpJournal="true", InpDashboard="false")

DATA = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL"
TERMINAL = r"C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe"


def run(name, dfrom, dto, model, deposit, symbol, period, inputs, timeout):
    """Roda o Testador com os robôs ao vivo desligados (live_guard) e devolve (log, início, segundos)."""
    import live_guard
    g = live_guard.ligar()
    try:
        return _run(name, dfrom, dto, model, deposit, symbol, period, inputs, timeout)
    finally:
        live_guard.restaurar(g)


def _run(name, dfrom, dto, model, deposit, symbol, period, inputs, timeout):
    files = os.path.join(DATA, "MQL5", "Files")
    ini = os.path.join(files, f"tester_{name}.ini")
    lines = ["[Common]", "NewsEnable=0", "", "[Tester]", r"Expert=Kairos\Kairos.ex5", f"Symbol={symbol}", f"Period={period}",
             f"Model={model}", f"FromDate={dfrom}", f"ToDate={dto}", "ForwardMode=0", f"Deposit={deposit}", "Currency=USD", "Leverage=500",
             "ExecutionMode=0", "Optimization=0", "Visual=0", rf"Report=MQL5\Files\xaur_{name}", "ReplaceReport=1", "ShutdownTerminal=1", "",
             "[TesterInputs]", "InpAllowRealAccount=true||false||0||true||N"]
    over = dict(DEFAULTS)
    for kv in inputs:                      # a última definição de cada opção vence
        k, v = kv.split("=", 1)
        over[k] = v
    lines = [l for l in lines if not l.startswith("InpAllowRealAccount")]
    lines += [f"{k}={v}||0||0||0||N" for k, v in over.items()]
    open(ini, "w", encoding="ascii").write("\n".join(lines) + "\n")
    log = os.path.join(DATA, "Tester", "logs", time.strftime("%Y%m%d") + ".log")
    start = os.path.getsize(log) if os.path.exists(log) else 0
    t0 = time.time()
    p = subprocess.Popen([TERMINAL, f"/config:{ini}"])
    try:
        p.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill(); print("TIMEOUT"); return None
    return log, start, time.time() - t0


def parse_log(log, start):
    raw = open(log, "rb").read()[start:]
    txt = raw.decode("utf-16-le", errors="ignore") if raw[:2] in (b"\xff\xfe",) or b"\x00" in raw[:200] else raw.decode("utf-8", errors="ignore")
    opened, results = [], []
    for ln in txt.splitlines():
        m = re.search(r"Core 01\s+(\d{4}\.\d\d\.\d\d)[ \d:]*\s+\[XAUR\] ABRIU \| (COMPRA|VENDA) (.+?) lote=([\d.]+).*?risco\$=([\d.]+) (?:pos=\d+ )?confirmacoes=\[(\d+) ok", ln)
        if m:
            opened.append({"date": m.group(1), "side": m.group(2), "setup": m.group(3), "risk": float(m.group(5)), "conf": int(m.group(6))})
        m = re.search(r"\[XAUR\] FECHOU \| resultado=(-?[\d.]+)", ln)
        if m:
            results.append(float(m.group(1)))
    sig = len(re.findall(r"\[XAUR\] SINAL", txt)); skip = len(re.findall(r"\[XAUR\] NAO_ABRIU", txt))
    return opened, results, sig, skip


def summarize(opened, results, since=None):
    n = min(len(opened), len(results))
    if since:                                            # só operações abertas a partir de "since" (AAAA.MM.DD); o começo serve de aquecimento
        keep = [k for k in range(n) if opened[k].get("date", "0") >= since]
        opened = [opened[k] for k in keep]; results = [results[k] for k in keep]; n = len(keep)
    rs = [results[k] / opened[k]["risk"] for k in range(n)]
    if n == 0:
        return dict(n=0)
    wins = sum(1 for r in rs if r > 0)
    mean = sum(rs) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in rs) / (n - 1)) if n > 1 else 0.0
    gp = sum(x for x in results[:n] if x > 0); gl = -sum(x for x in results[:n] if x < 0)
    cum = peak = mdd = 0.0
    for x in results[:n]:
        cum += x; peak = max(peak, cum); mdd = max(mdd, peak - cum)
    return dict(n=n, mdd=mdd, win=100 * wins / n, R=sum(rs), avgR=mean, ci=1.96 * sd / math.sqrt(n) if n > 1 else 0.0,
                pf=(gp / gl if gl else float("inf")), profit=sum(results[:n]), rs=rs, opened=opened[:n])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True); ap.add_argument("--from", dest="dfrom", default="2024.01.01"); ap.add_argument("--to", default="2026.09.26")
    ap.add_argument("--model", type=int, default=1); ap.add_argument("--deposit", type=int, default=10000)
    ap.add_argument("--symbol", default="XAUUSDm"); ap.add_argument("--period", default="H1"); ap.add_argument("--timeout", type=int, default=900)
    ap.add_argument("--since", default=None)
    ap.add_argument("inputs", nargs="*")
    a = ap.parse_args()
    out = run(a.name, a.dfrom, a.to, a.model, a.deposit, a.symbol, a.period, a.inputs, a.timeout)
    if out:
        log, start, secs = out
        opened, results, sig, skip = parse_log(log, start)
        cuts = (a.since or "").split(",") if a.since else [None]
        lastd = opened[-1]["date"] if opened else "--"
        for cut in cuts:
            s = summarize(opened, results, cut)
            tag = f"[{a.name}]" + (f" desde {cut}" if cut else "")
            print(f"{tag} {secs:.0f}s | sinais={sig} | operacoes={s.get('n')} (ultima em {lastd})", end="")
            if s.get("n"):
                print(f" | acerto={s['win']:.1f}% | R total={s['R']:+.1f} | R/op={s['avgR']:+.3f} +-{s['ci']:.3f} | fator lucro={s['pf']:.2f} | lucro=US$ {s['profit']:+.0f} | maior queda=US$ {s['mdd']:.0f}")
            else:
                print()
