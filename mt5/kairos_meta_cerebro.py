"""Aplica no Kairos (Experts\\Kairos): meta de ganho do dia, gaps, surpresa da agenda e cérebro. Roda uma vez."""
import os

D = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL\MQL5\Experts\Kairos"


def rw(f, pairs):
    p = os.path.join(D, f)
    s = open(p, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    s = s.replace("\r\n", "\n")
    for a, b in pairs:
        assert a in s, (f, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w", encoding="utf-8", newline="").write(s.replace("\n", "\r\n") if crlf else s)


rw("XR_Inputs.mqh", [(
    "input bool   InpUseConfluence     = true;",
    """input group "=== META DO DIA ==="
input double InpDailyTargetUSD    = 0.0;     // Meta de ganho do dia em US$ (0 = sem meta). Pode ser trocada pelo painel sem reanexar o robô
input int    InpTargetAction      = 1;       // Ao bater a meta: 0 = só para de abrir; 1 = fecha as posições e para até o dia seguinte
input group "=== CÉREBRO (modelo treinado no histórico) ==="
input int    InpBrainMode         = 1;       // 0 = desligado; 1 = só informa a probabilidade; 2 = entra no placar como voto; 3 = filtro obrigatório
input double InpBrainMinP         = 0.0;     // Modo 3: probabilidade mínima de TAKE (0 = média histórica + 10%)
input bool   InpUseConfluence     = true;""")])

rw("XR_Risk.mqh", [
    ("int    EffMaxTradesPerDay() { return RelaxLocks() ? MathMax(InpMaxTradesPerDay, 100) : InpMaxTradesPerDay; }",
     "int    EffMaxTradesPerDay() { return RelaxLocks() ? MathMax(InpMaxTradesPerDay, 100000) : InpMaxTradesPerDay; }"),
    ("""void NewDay(const int key)
{
   g_dayKey = key; g_dayEq = AccountInfoDouble(ACCOUNT_EQUITY); g_dayBlocked = false;
   GlobalVariableSet(GVName("DAYKEY"), (double)key);
   GlobalVariableSet(GVName("DAYEQ"), g_dayEq);
}""", """void NewDay(const int key)
{
   g_dayKey = key; g_dayBlocked = false;
   if(GlobalVariableCheck(GVName("DAYKEY")) && (int)GlobalVariableGet(GVName("DAYKEY")) == key && GlobalVariableCheck(GVName("DAYEQ")))
   { g_dayEq = GlobalVariableGet(GVName("DAYEQ")); return; }          // o robô do outro ativo já fixou o equity de início do dia (mesma conta, mesma base)
   g_dayEq = AccountInfoDouble(ACCOUNT_EQUITY);
   GlobalVariableSet(GVName("DAYKEY"), (double)key);
   GlobalVariableSet(GVName("DAYEQ"), g_dayEq);
}"""),
])

rw("XR_Control.mqh", [(
    """   else if(cmd == "stop")""",
    """   else if(cmd == "target")
   {
      double v = JNum(s, "value");
      SetTarget(v);
      g_cmdResult = v > 0 ? StringFormat("meta do dia: US$ %.2f", v) : "meta do dia removida";
      Journal("COMANDO", v > 0 ? StringFormat("META DO DIA definida pelo painel: ganhar US$ %.2f hoje (ganho atual US$ %.2f)", v, AccountInfoDouble(ACCOUNT_EQUITY) - g_dayEq) : "META DO DIA removida pelo painel");
   }
   else if(cmd == "stop")"""),
    ("//| Comandos: pause, resume, close_all, stop (remove o robô).        |", "//| Comandos: pause, resume, close_all, target (value), stop.        |")])

rw("Kairos.mq5", [
    ('#include "XR_Board.mqh"', '#include "XR_Board.mqh"\n#include "XR_Brain.mqh"\n#include "XR_Target.mqh"'),
    ("   RiskInit();\n", "   RiskInit();\n   TargetInit();\n"),
    ("   RiskGuards(why);                                   // travas (a cada tick)", "   RiskGuards(why);                                   // travas (a cada tick)\n   TargetCheck();                                     // meta de ganho do dia"),
    ("""   CkAdd("pausa depois de stop", cdLeft <= 0, InpCooldownMin > 0, cdLeft > 0 ? StringFormat("faltam %d min depois do ultimo stop", (cdLeft + 59) / 60) : "sem stop recente");""",
     """   CkAdd("pausa depois de stop", cdLeft <= 0, InpCooldownMin > 0, cdLeft > 0 ? StringFormat("faltam %d min depois do ultimo stop", (cdLeft + 59) / 60) : "sem stop recente");
   CkAdd("meta do dia", !g_targetHit, g_targetUSD > 0, g_targetUSD > 0 ? StringFormat("ganho do dia US$ %.2f de US$ %.2f%s", g_dayGain, g_targetUSD, g_targetHit ? " - META ATINGIDA" : "") : "sem meta definida");"""),
    ("""   BoardEvaluate(sig, r, iSig, atr, e21, e50, g_ctx, okN);
   int agree, against, neutral;""",
     """   BoardEvaluate(sig, r, iSig, atr, e21, e50, g_ctx, okN);
   double pBrain = -1; string bd = "";
   if(InpBrainMode > 0 && BrainReady()) pBrain = BrainPredict(bd);
   if(pBrain >= 0)
   {
      if(InpBrainMode == 1) CkAdd("cerebro (so informa)", pBrain >= g_bBase, false, bd);
      else if(InpBrainMode == 2) FacAdd("cerebro", pBrain >= g_bBase + 0.05 ? 1 : (pBrain <= g_bBase - 0.05 ? -1 : 0), bd);
      else { double thr = InpBrainMinP > 0 ? InpBrainMinP : g_bBase * 1.1; CkAdd("cerebro (filtro)", pBrain >= thr, true, bd + StringFormat("; minimo %.0f%%", thr * 100)); }
   }
   int agree, against, neutral;"""),
    ('   string s = "KAIROS v2.0 | " + AssetName() + " | "', '   string s = "KAIROS v2.2 | " + AssetName() + " | "'),
    ('#property version   "2.00"', '#property version   "2.20"'),
])

rw("XR_Status.mqh", [
    (',\\"last_note\\":\\"" + JS(lastNote)', ',\\"target\\":{\\"usd\\":" + JN(g_targetUSD) + ",\\"gain\\":" + JN(g_dayGain) + ",\\"hit\\":" + JB(g_targetHit) + ",\\"action\\":" + IntegerToString(InpTargetAction) + "}" +\n        ",\\"brain\\":{\\"mode\\":" + IntegerToString(InpBrainMode) + ",\\"loaded\\":" + JB(g_bOk) + ",\\"usable\\":" + JB(g_bUsable) + ",\\"auc\\":" + JN(g_bAuc) + ",\\"base\\":" + JN(g_bBase) + "}" +\n        ",\\"last_note\\":\\"" + JS(lastNote)'),
    ('\\"version\\":\\"2.0\\"', '\\"version\\":\\"2.2\\"'),
])
print("meta + cerebro aplicados")
