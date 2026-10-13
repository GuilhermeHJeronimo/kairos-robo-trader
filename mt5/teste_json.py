"""Roda o JsonTest (leitor de JSON do robô) no Testador do MT5 e mostra o resultado. MT5 deve estar FECHADO."""
import os, re, subprocess, time

D = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL"
ini = os.path.join(D, "MQL5", "Files", "tester_json.ini")
linhas = ["[Common]", "NewsEnable=0", "", "[Tester]", r"Expert=XAU_Reader_tests\JsonTest.ex5", "Symbol=XAUUSDm", "Period=H1", "Model=1",
          "FromDate=2026.09.01", "ToDate=2026.09.03", "ForwardMode=0", "Deposit=1000", "Currency=USD", "Leverage=500", "ExecutionMode=0",
          "Optimization=0", "Visual=0", r"Report=MQL5\Files\xaur_json", "ReplaceReport=1", "ShutdownTerminal=1"]
open(ini, "w", encoding="ascii").write("\n".join(linhas) + "\n")
log = os.path.join(D, "Tester", "logs", time.strftime("%Y%m%d") + ".log")
start = os.path.getsize(log)
p = subprocess.Popen([r"C:\Program Files\MetaTrader 5 EXNESS\terminal64.exe", f"/config:{ini}"])
p.wait(timeout=300)
raw = open(log, "rb").read()[start:]
txt = raw.decode("utf-16-le", errors="ignore") if b"\x00" in raw[:200] else raw.decode("utf-8", "ignore")
for l in txt.splitlines():
    if "[JSONTEST]" in l:
        print(re.sub(r"^.*\[JSONTEST\] ", "", re.sub(r"\s+", " ", l)))
