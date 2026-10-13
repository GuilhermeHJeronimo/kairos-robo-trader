//+------------------------------------------------------------------+
//| XR_Brake.mqh - proteções que o robô "aprendeu" com as próprias   |
//| entradas                                                         |
//|                                                                  |
//| 1) Sem posição contrária: compra e venda abertas ao mesmo tempo  |
//|    no mesmo ativo (visto no ouro em 08/10) perdem as duas.       |
//| 2) Freio de desempenho: se as últimas N "ocorrências" de         |
//|    fechamento do ativo foram todas perdas, o ativo pausa por X   |
//|    horas. Perdas fechadas em até 10 min contam como UMA          |
//|    ocorrência (um stop em rajada não conta 10 vezes). É a regra  |
//|    que impediria 24 perdas seguidas no ouro com 1 take.          |
//+------------------------------------------------------------------+
#property strict

bool HasOppositePosition(const int side)
{
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      bool buy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      if((side > 0 && !buy) || (side < 0 && buy)) return true;
   }
   return false;
}

//--- segundos que faltam do freio (0 = livre); consec = perdas seguidas (em ocorrências)
int BrakeLeftSecs(int &consec)
{
   consec = 0;
   if(InpBrakeEvents <= 0) return 0;
   datetime now = TimeCurrent();
   if(!HistorySelect(now - 14 * 86400, now + 60)) return 0;
   int total = HistoryDealsTotal();
   bool have = false, stop = false;
   datetime evTop = 0, evLast = 0, newestLoss = 0;
   double evSum = 0;
   for(int k = total - 1; k >= 0 && !stop; k--)
   {
      ulong tk = HistoryDealGetTicket(k);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(en != DEAL_ENTRY_OUT && en != DEAL_ENTRY_INOUT) continue;
      datetime t = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP);
      if(!have) { have = true; evTop = t; evLast = t; evSum = p; continue; }
      if(evLast - t <= 600) { evSum += p; evLast = t; continue; }                 // mesma ocorrência
      if(evSum < 0) { consec++; if(newestLoss == 0) newestLoss = evTop; } else { stop = true; have = false; break; }
      evTop = t; evLast = t; evSum = p;
   }
   if(have && !stop && evSum < 0) { consec++; if(newestLoss == 0) newestLoss = evTop; }
   if(consec < InpBrakeEvents || newestLoss == 0) return 0;
   int left = (int)(newestLoss + (datetime)(InpBrakeHours * 3600) - now);
   return left > 0 ? left : 0;
}
