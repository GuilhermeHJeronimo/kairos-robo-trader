//+------------------------------------------------------------------+
//| XR_Target.mqh - meta de ganho do dia                             |
//|                                                                  |
//| "Hoje seu objetivo é ganhar X": o robô opera quantas vezes for   |
//| preciso (sem limite de entradas) até o ganho do DIA (equity de   |
//| agora menos o equity do início do dia, somando todos os ativos)  |
//| chegar a X. Ao chegar: InpTargetAction 0 = só para de abrir,     |
//| 1 = fecha as posições e fica parado até o dia seguinte.          |
//|                                                                  |
//| O que NÃO faz: aumentar o risco ou baixar o nível de exigência   |
//| para alcançar a meta. A meta decide quando PARAR, não o quanto   |
//| arriscar. A meta pode ser trocada pelo painel sem reanexar.      |
//+------------------------------------------------------------------+
#property strict

double g_targetUSD = 0, g_dayGain = 0;
bool   g_targetHit = false;
double g_dayGainCache = 0; datetime g_dayGainAt = 0;

//--- ganho do DIA da conta = resultado já realizado desde 00:00 do relógio do PC (histórico, todos os ativos) + resultado aberto de agora.
//    Não depende de o robô estar ligado à meia-noite: antes era equity - equity do início, e o início era fixado só no 1º tick depois de ligar
//    (MT5 desligado de madrugada = perdas do início do dia ficavam de fora).
double DayGainNow()
{
   if(TimeCurrent() - g_dayGainAt < 3) return g_dayGainCache;
   double sum = 0;
   if(HistorySelect(DayStartServer(), TimeCurrent() + 60))
      for(int k = HistoryDealsTotal() - 1; k >= 0; k--)
      {
         ulong tk = HistoryDealGetTicket(k);
         if(tk == 0) continue;
         long ty = HistoryDealGetInteger(tk, DEAL_TYPE);
         if(ty != DEAL_TYPE_BUY && ty != DEAL_TYPE_SELL) continue;
         sum += HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_FEE);
      }
   for(int k = PositionsTotal() - 1; k >= 0; k--)
      if(PositionGetTicket(k) != 0) sum += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   g_dayGainCache = sum; g_dayGainAt = TimeCurrent();
   return sum;
}

int TargetDayHit() { return GlobalVariableCheck(GVName("TARGETHIT")) ? (int)GlobalVariableGet(GVName("TARGETHIT")) : 0; }

void TargetInit()
{
   g_targetUSD = GlobalVariableCheck(GVName("TARGET")) ? GlobalVariableGet(GVName("TARGET")) : InpDailyTargetUSD;
   g_targetHit = (TargetDayHit() == DayKeyNow());
}

void SetTarget(const double v)
{
   g_targetUSD = v > 0 ? v : 0;
   if(v > 0) GlobalVariableSet(GVName("TARGET"), v); else GlobalVariableDel(GVName("TARGET"));
   if(g_targetHit && (v <= 0 || DayGainNow() < v)) { g_targetHit = false; GlobalVariableDel(GVName("TARGETHIT")); }
}

//--- a cada tick (depois de RiskGuards, que mantém o equity do início do dia)
void TargetCheck()
{
   g_dayGain = DayGainNow();
   int key = DayKeyNow();
   if(g_targetHit && TargetDayHit() != key) g_targetHit = false;                    // virou o dia: meta zerada
   if(g_targetUSD <= 0) return;
   if(!g_targetHit && TargetDayHit() == key)                                        // o robô do outro ativo já bateu a meta da conta
   {
      g_targetHit = true;
      if(InpTargetAction == 1 && OpenPositions() > 0) CloseAll("meta do dia");
      return;
   }
   if(g_targetHit || g_dayGain < g_targetUSD) return;
   g_targetHit = true;
   GlobalVariableSet(GVName("TARGETHIT"), key);
   Journal("META", StringFormat("meta do dia atingida: ganho de US$ %.2f (meta US$ %.2f). %s", g_dayGain, g_targetUSD,
           InpTargetAction == 1 ? "Fechando as posicoes e parando ate amanha." : "Sem novas entradas ate amanha (posicoes abertas seguem com stop e alvo)."));
   if(InpTargetAction == 1) CloseAll("meta do dia");
}
