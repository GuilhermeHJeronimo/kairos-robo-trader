//+------------------------------------------------------------------+
//| XR_Risk.mqh - gestão de risco, travas e envio de ordens          |
//| Regras: toda ordem tem stop e alvo; sem martingale, sem médio;   |
//| no máximo 1 posição; risco fixo em % do saldo.                   |
//+------------------------------------------------------------------+
#property strict
#include <Trade\Trade.mqh>

CTrade   g_trade;
int      g_dayKey = 0;
double   g_dayEq = 0, g_peak = 0;
bool     g_killed = false, g_dayBlocked = false;

string GVName(const string k) { return StringFormat("XAUR_%I64d_%s", InpMagic, k); }

int DayKey(const datetime t) { MqlDateTime d; TimeToStruct(t, d); return d.year * 10000 + d.mon * 100 + d.day; }

//--- diário: Experts + CSV em MQL5\Files\XAU_Reader_journal.csv
void Journal(const string ev, const string msg)
{
   Print("[XAUR] ", ev, " | ", msg);
   if(!InpJournal) return;
   int h = FileOpen("XAU_Reader_journal.csv", FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   FileSeek(h, 0, SEEK_END);
   FileWriteString(h, TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + ";" + ev + ";" + msg + "\r\n");
   FileClose(h);
}

void NewDay(const int key)
{
   g_dayKey = key; g_dayEq = AccountInfoDouble(ACCOUNT_EQUITY); g_dayBlocked = false;
   GlobalVariableSet(GVName("DAYKEY"), (double)key);
   GlobalVariableSet(GVName("DAYEQ"), g_dayEq);
}

bool RelaxLocks() { return InpDemoRelaxLocks && !MQLInfoInteger(MQL_TESTER) && AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO; }
double EffDailyLossPct() { return RelaxLocks() ? MathMax(InpMaxDailyLossPct, 100.0) : InpMaxDailyLossPct; }
int    EffMaxConsecLosses() { return RelaxLocks() ? MathMax(InpMaxConsecLosses, 20) : InpMaxConsecLosses; }

void RiskInit()
{
   g_dayBlocked = false;                 // trocar opções no MT5 não zera as variáveis do robô: recalcular a trava do dia a partir das opções atuais
   if(InpResetKill)
   {
      GlobalVariableDel(GVName("KILL"));
      GlobalVariableSet(GVName("PEAK"), AccountInfoDouble(ACCOUNT_EQUITY));
      Journal("trava_liberada", "InpResetKill usado; pico de equity reiniciado. Desmarque a opcao depois.");
   }
   g_killed = GlobalVariableCheck(GVName("KILL"));
   g_peak = GlobalVariableCheck(GVName("PEAK")) ? GlobalVariableGet(GVName("PEAK")) : AccountInfoDouble(ACCOUNT_EQUITY);
   GlobalVariableSet(GVName("PEAK"), g_peak);
   int today = DayKey(TimeCurrent());
   if(GlobalVariableCheck(GVName("DAYKEY")) && (int)GlobalVariableGet(GVName("DAYKEY")) == today)
   { g_dayKey = today; g_dayEq = GlobalVariableGet(GVName("DAYEQ")); }
   else NewDay(today);
}

//--- risco que as posições abertas ainda têm até o stop (% do saldo); stop no ponto de entrada ou melhor conta 0
double OpenRiskPct()
{
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), sum = 0;
   if(bal <= 0) return 0;
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      bool buy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double p = 0;
      if(OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, PositionGetDouble(POSITION_VOLUME), PositionGetDouble(POSITION_PRICE_OPEN), PositionGetDouble(POSITION_SL), p) && p < 0)
         sum += -p;
   }
   return sum / bal * 100.0;
}

int OpenPositions()
{
   int n = 0;
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) == InpMagic && PositionGetString(POSITION_SYMBOL) == _Symbol) n++;
   }
   return n;
}

void CloseAll(const string why)
{
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(g_trade.PositionClose(tk)) Journal("fechou_posicao", StringFormat("ticket=%I64u motivo=%s", tk, why));
      else Journal("erro_fechar", StringFormat("ticket=%I64u erro=%d", tk, g_trade.ResultRetcode()));
   }
}

void KillSwitch(const string why)
{
   if(g_killed) return;
   g_killed = true;
   GlobalVariableSet(GVName("KILL"), 1.0);
   Journal("TRAVA_DRAWDOWN", why + " | robo desligado ate voce marcar InpResetKill");
   Alert("XAU Reader: trava de drawdown acionada. ", why);
   if(InpCloseOnKill) CloseAll("trava de drawdown");
}

//--- verificação a cada tick: false = proibido abrir novas operações
bool RiskGuards(string &why)
{
   why = "";
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   int key = DayKey(TimeCurrent());
   if(key != g_dayKey) NewDay(key);
   if(!g_killed && eq > g_peak) { g_peak = eq; GlobalVariableSet(GVName("PEAK"), g_peak); }
   if(g_killed) { why = "trava de drawdown ativa"; return false; }
   if(g_peak > 0 && (g_peak - eq) / g_peak * 100.0 >= InpMaxDrawdownPct)
   { KillSwitch(StringFormat("equity %.2f caiu %.1f%% desde o pico %.2f", eq, (g_peak - eq) / g_peak * 100.0, g_peak)); why = "trava de drawdown ativa"; return false; }
   if(!g_dayBlocked && g_dayEq > 0 && (g_dayEq - eq) / g_dayEq * 100.0 >= EffDailyLossPct())
   {
      g_dayBlocked = true;
      Journal("TRAVA_DIARIA", StringFormat("perda do dia %.2f%% (equity %.2f, inicio %.2f); sem novas ordens ate amanha", (g_dayEq - eq) / g_dayEq * 100.0, eq, g_dayEq));
      if(InpCloseOnKill) CloseAll("perda diaria");
   }
   if(g_dayBlocked) { why = "perda diaria atingida"; return false; }
   return true;
}

//--- operações de hoje e sequência de perdas (lidas do histórico da conta, sobrevivem a reinício)
void TodayStats(int &trades, int &consec, double &pnl)
{
   trades = 0; consec = 0; pnl = 0;
   datetime now = TimeCurrent(), ds = now - (now % 86400);
   if(!HistorySelect(ds, now + 60)) return;
   int total = HistoryDealsTotal();
   bool streak = true;
   for(int k = total - 1; k >= 0; k--)
   {
      ulong tk = HistoryDealGetTicket(k);
      if(tk == 0) continue;
      if(HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(en == DEAL_ENTRY_IN) trades++;
      if(en == DEAL_ENTRY_OUT || en == DEAL_ENTRY_INOUT)
      {
         double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP);
         pnl += p;
         if(streak) { if(p < 0) consec++; else streak = false; }
      }
   }
}

//--- fim da última sessão de negociação de sexta (segundos desde 00:00, hora do servidor); -1 se a corretora não informa
int FridaySessionEndSec()
{
   int best = -1; datetime from, to;
   for(uint k = 0; k < 10; k++)
   {
      if(!SymbolInfoSessionTrade(_Symbol, FRIDAY, k, from, to)) break;
      int e = (int)to; if(e == 0) e = 86400;
      best = MathMax(best, e);
   }
   return best;
}

bool InSession(string &why)
{
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   if(d.day_of_week == 0 || d.day_of_week == 6) { why = "fim de semana"; return false; }
   if(d.hour < InpStartHour || d.hour >= InpEndHour) { why = "fora do horario configurado"; return false; }
   if(d.day_of_week == 5)
   {
      int nowSec = d.hour * 3600 + d.min * 60 + d.sec, endSec = FridaySessionEndSec();
      int cutoff = (endSec > 0) ? endSec - InpFridayNoEntryHours * 3600 : InpFridayLastHour * 3600;
      if(nowSec >= cutoff) { why = "sexta: perto do fechamento do mercado"; return false; }
   }
   return true;
}

datetime g_lastWeekendTry = 0;
//--- sexta: fecha tudo InpCloseMinutesBeforeEnd minutos ANTES do fim real da sessão (evita gap do fim de semana)
void WeekendGuard()
{
   if(!InpCloseBeforeWeekend || OpenPositions() == 0) return;
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   if(d.day_of_week != 5) return;
   int nowSec = d.hour * 3600 + d.min * 60 + d.sec, endSec = FridaySessionEndSec();
   int closeAt = (endSec > 0) ? endSec - InpCloseMinutesBeforeEnd * 60 : InpFridayCloseHour * 3600;
   if(nowSec < closeAt) return;
   if(TimeCurrent() - g_lastWeekendTry < 60) return;      // no máximo uma tentativa por minuto
   g_lastWeekendTry = TimeCurrent();
   CloseAll("fim de semana");
}

//--- lote pelo risco: perda no stop = InpRiskPct do saldo. Recusa se o lote mínimo arrisca demais.
double LotsForRisk(const int side, const double price, const double sl, string &why)
{
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0;
   double p = 0;
   ENUM_ORDER_TYPE ot = (side > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(!OrderCalcProfit(ot, _Symbol, 1.0, price, sl, p) || p == 0) { why = "OrderCalcProfit falhou"; return 0; }
   double lossPerLot = MathAbs(p);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lots = MathFloor(riskMoney / lossPerLot / step) * step;
   if(lots < vmin)
   {
      double riskMin = vmin * lossPerLot;
      if(riskMin > InpMaxRiskOverrun * riskMoney)
      {
         why = StringFormat("lote minimo %.2f arrisca %.2f, %.1fx o planejado (%.2f): saldo pequeno para este stop", vmin, riskMin, riskMin / riskMoney, riskMoney);
         return 0;
      }
      lots = vmin;
   }
   lots = MathMin(lots, vmax);
   return NormalizeDouble(lots, 2);
}

//--- envia a ordem com todas as verificações; devolve true se abriu
bool ExecuteSignal(const XSignal &s, const string conf, string &why)
{
   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) { why = "sem cotacao"; return false; }
   double price = (s.side > 0) ? t.ask : t.bid;
   double spread = t.ask - t.bid;
   double sl = NormalizeDouble(s.stop, _Digits), tp = NormalizeDouble(s.target, _Digits);
   if(spread > InpMaxSpread) { why = StringFormat("spread %.2f acima do maximo %.2f", spread, InpMaxSpread); return false; }
   if(s.side > 0 && !(sl < price && price < tp)) { why = "preco fora da faixa stop/alvo (compra)"; return false; }
   if(s.side < 0 && !(tp < price && price < sl)) { why = "preco fora da faixa stop/alvo (venda)"; return false; }
   double risk = MathAbs(price - sl);
   if(InpRRMode == 1 && risk > 0)                       // relação fixa: alvo recalculado sobre o preço real de entrada
      tp = NormalizeDouble((s.side > 0) ? price + InpFixedRR * risk : price - InpFixedRR * risk, _Digits);
   double reward = MathAbs(tp - price);
   if(risk <= 0 || reward / risk < InpMinRR) { why = StringFormat("R:R real %.2f abaixo de %.2f (preco andou)", risk > 0 ? reward / risk : 0.0, InpMinRR); return false; }
   if(spread / risk > InpMaxCostToRisk) { why = StringFormat("spread %.2f = %.0f%% do risco (max %.0f%%)", spread, spread / risk * 100.0, InpMaxCostToRisk * 100.0); return false; }
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(risk < minDist || reward < minDist) { why = "stop/alvo mais perto que o minimo da corretora"; return false; }
   if(InpMaxTotalRiskPct > 0 && OpenRiskPct() + InpRiskPct > InpMaxTotalRiskPct + 1e-9) { why = "risco total aberto acima do limite"; return false; }
   double lots = LotsForRisk(s.side, price, sl, why);
   if(lots <= 0) return false;
   double margin = 0;
   if(OrderCalcMargin((s.side > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lots, price, margin) &&
      margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * InpMaxMarginUsePct / 100.0)
   { why = StringFormat("margem %.2f acima de %.0f%% da margem livre", margin, InpMaxMarginUsePct); return false; }

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpSlippagePts);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   string cm = StringSubstr("XAUR " + s.setup, 0, 30);
   bool ok = (s.side > 0) ? g_trade.Buy(lots, _Symbol, price, sl, tp, cm) : g_trade.Sell(lots, _Symbol, price, sl, tp, cm);
   if(!ok) { why = StringFormat("ordem recusada: %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()); return false; }
   Journal("ABRIU", StringFormat("%s %s lote=%.2f preco=%.2f sl=%.2f tp=%.2f R:R=%.2f risco$=%.2f pos=%I64u confirmacoes=[%s] motivos=%s",
           (s.side > 0 ? "COMPRA" : "VENDA"), s.setup, lots, price, sl, tp, reward / risk,
           AccountInfoDouble(ACCOUNT_BALANCE) * InpRiskPct / 100.0, g_trade.ResultOrder(), conf, s.reasons));
   return true;
}
