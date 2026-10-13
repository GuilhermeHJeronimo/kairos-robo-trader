//+------------------------------------------------------------------+
//| XR_Track.mqh - MAE/MFE por posição e pausa depois de um stop     |
//| (insumos do aprendizado: o que o preço fez depois da entrada)    |
//+------------------------------------------------------------------+
#ifndef XR_TRACK_MQH
#define XR_TRACK_MQH

struct XTrack { ulong id; double open; int side; double hi; double lo; datetime t0; bool be; };
XTrack   g_trk[];
datetime g_lastStopTime = 0;

int TrackFind(const ulong id) { for(int k = 0; k < ArraySize(g_trk); k++) if(g_trk[k].id == id) return k; return -1; }

//--- a cada tick: atualiza máxima e mínima do preço de saída de cada posição aberta do robô
void TrackUpdate()
{
   MqlTick t; if(!SymbolInfoTick(_Symbol, t)) return;
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      int side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
      double px = (side > 0) ? t.bid : t.ask;                 // preço em que a posição seria fechada
      int j = TrackFind(tk);
      if(j < 0)
      {
         j = ArraySize(g_trk); ArrayResize(g_trk, j + 1);
         g_trk[j].id = tk; g_trk[j].open = PositionGetDouble(POSITION_PRICE_OPEN); g_trk[j].side = side;
         g_trk[j].hi = px; g_trk[j].lo = px; g_trk[j].be = false; g_trk[j].t0 = (datetime)PositionGetInteger(POSITION_TIME);
      }
      if(px > g_trk[j].hi) g_trk[j].hi = px;
      if(px < g_trk[j].lo) g_trk[j].lo = px;
   }
}

//--- proteção de lucro (breakeven): leva o stop para a entrada quando o preço andou InpBreakevenR x R a favor
void ManageBreakeven()
{
   if(InpBreakevenR <= 0) return;
   MqlTick t; if(!SymbolInfoTick(_Symbol, t)) return;
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      int j = TrackFind(tk);
      if(j < 0 || g_trk[j].be) continue;
      int side = g_trk[j].side;
      double open = PositionGetDouble(POSITION_PRICE_OPEN), sl = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP);
      double risk0 = (InpRRMode == 1 && tp > 0) ? MathAbs(tp - open) / InpFixedRR : MathAbs(open - sl);
      if(risk0 <= 0) continue;
      double px = (side > 0) ? t.bid : t.ask;
      if((px - open) * side < InpBreakevenR * risk0) continue;
      double nsl = NormalizeDouble(open + side * InpBEOffsetR * risk0, _Digits);
      if((side > 0 && nsl <= sl) || (side < 0 && nsl >= sl)) { g_trk[j].be = true; continue; }   // já está melhor
      double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
      if(MathAbs(px - nsl) < minDist) continue;                                          // perto demais do preço: tenta no próximo tick
      g_trade.SetExpertMagicNumber(InpMagic);
      if(g_trade.PositionModify(tk, nsl, tp))
      {
         g_trk[j].be = true;
         Journal("BREAKEVEN", StringFormat("pos=%I64u stop movido para %.2f (entrada %.2f, preco %.2f, +%.1fR a favor)", tk, nsl, open, px, (px - open) * side / risk0));
      }
   }
}

//--- saída por tempo (ideia do triple-barrier do Hummingbot): posição parada além do limite é fechada a mercado
void ManageTimeExit()
{
   if(InpMaxHoldHours <= 0) return;
   datetime now = TimeCurrent();
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      datetime t0 = (datetime)PositionGetInteger(POSITION_TIME);
      if(now - t0 < (long)(InpMaxHoldHours * 3600)) continue;
      g_trade.SetExpertMagicNumber(InpMagic);
      if(g_trade.PositionClose(tk)) Journal("SAIDA_TEMPO", StringFormat("pos=%I64u aberta ha %.1f h (limite %.1f h), resultado aberto %.2f", tk, (now - t0) / 3600.0, InpMaxHoldHours, PositionGetDouble(POSITION_PROFIT)));
   }
}

bool TrackBE(const ulong id) { int j = TrackFind(id); return j >= 0 && g_trk[j].be; }

//--- texto para o FECHOU: entrada, duração, MAE e MFE em preço (o painel converte para R). Remove a posição da lista.
string TrackClosedText(const ulong id, const double exitPx)
{
   int j = TrackFind(id);
   if(j < 0) return " mae=n/d mfe=n/d";
   XTrack x = g_trk[j];
   if(exitPx > x.hi) x.hi = exitPx;
   if(exitPx < x.lo) x.lo = exitPx;
   double mae = (x.side > 0) ? x.open - x.lo : x.hi - x.open;
   double mfe = (x.side > 0) ? x.hi - x.open : x.open - x.lo;
   string s = StringFormat(" entrada=%.2f dur=%d mae=%.2f mfe=%.2f", x.open, (int)(TimeCurrent() - x.t0), MathMax(mae, 0.0), MathMax(mfe, 0.0));
   int n = ArraySize(g_trk);
   if(j < n - 1) g_trk[j] = g_trk[n - 1];
   ArrayResize(g_trk, n - 1);
   return s;
}

//--- segundos que faltam da pausa depois do último stop (lê o histórico, então sobrevive a reinício)
int CooldownLeftSecs()
{
   if(InpCooldownMin <= 0) return 0;
   datetime now = TimeCurrent();
   if(g_lastStopTime == 0 && HistorySelect(now - 6 * 3600, now + 60))
   {
      for(int k = HistoryDealsTotal() - 1; k >= 0; k--)
      {
         ulong tk = HistoryDealGetTicket(k);
         if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
         if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_OUT && HistoryDealGetInteger(tk, DEAL_REASON) == DEAL_REASON_SL &&
            HistoryDealGetDouble(tk, DEAL_PROFIT) < 0)
         { g_lastStopTime = (datetime)HistoryDealGetInteger(tk, DEAL_TIME); break; }
      }
      if(g_lastStopTime == 0) g_lastStopTime = 1;             // marca "já procurei, não há stop recente"
   }
   if(g_lastStopTime <= 1) return 0;
   int left = (int)(g_lastStopTime + InpCooldownMin * 60 - now);
   return MathMax(left, 0);
}


//--- posições cujo FECHOU já está no diário (arquivo Kairos_<ativo>_fechados.txt). Na primeira vez, semeia com o que o diário (e o diário antigo do ouro) já tem.
ulong g_closedIds[];
bool  g_closedLoaded = false;

bool IsClosedLogged(const ulong id) { for(int k = 0; k < ArraySize(g_closedIds); k++) if(g_closedIds[k] == id) return true; return false; }

void MarkClosed(const ulong id)
{
   if(IsClosedLogged(id)) return;
   int n = ArraySize(g_closedIds); ArrayResize(g_closedIds, n + 1); g_closedIds[n] = id;
   int h = FileOpen(FN("fechados.txt"), FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   FileSeek(h, 0, SEEK_END); FileWriteString(h, IntegerToString((long)id) + "\r\n"); FileClose(h);
}

void SeedClosedFrom(const string text)
{
   int p = 0;
   while((p = StringFind(text, ";FECHOU;", p)) >= 0)
   {
      int q = StringFind(text, "pos=", p);
      if(q < 0) break;
      q += 4; int e = q;
      while(e < StringLen(text) && StringGetCharacter(text, e) >= '0' && StringGetCharacter(text, e) <= '9') e++;
      if(e > q) MarkClosed((ulong)StringToInteger(StringSubstr(text, q, e - q)));
      p = e;
   }
}

void ClosedLoad()
{
   if(g_closedLoaded) return;
   g_closedLoaded = true;
   bool had = FileIsExist(FN("fechados.txt"));
   if(had)
   {
      int h = FileOpen(FN("fechados.txt"), FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
      if(h != INVALID_HANDLE)
      {
         while(!FileIsEnding(h)) { string ln = FileReadString(h); StringTrimLeft(ln); StringTrimRight(ln); if(ln != "") { int n = ArraySize(g_closedIds); ArrayResize(g_closedIds, n + 1); g_closedIds[n] = (ulong)StringToInteger(ln); } }
         FileClose(h);
      }
      return;
   }
   SeedClosedFrom(ReadTextFile(FN("journal.csv")));
   if(IsGold()) SeedClosedFrom(ReadTextFile("XAU_Reader_journal.csv"));          // histórico do robô antigo do ouro
}

//--- confere o histórico da conta (últimos 21 dias) e grava FECHOU das posições que o diário não viu
void ReconcileClosed()
{
   if(MQLInfoInteger(MQL_TESTER)) return;
   ClosedLoad();
   datetime now = TimeCurrent();
   if(!HistorySelect(now - 21 * 86400, now + 60)) return;
   int total = HistoryDealsTotal();
   for(int k = 0; k < total; k++)
   {
      ulong tk = HistoryDealGetTicket(k);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(en != DEAL_ENTRY_OUT && en != DEAL_ENTRY_INOUT) continue;
      ulong pid = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
      if(IsClosedLogged(pid)) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP);
      long reason = HistoryDealGetInteger(tk, DEAL_REASON);
      string how = (reason == DEAL_REASON_SL) ? "stop atingido" : (reason == DEAL_REASON_TP) ? "alvo atingido" :
                   (reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT) ? "fechada pelo robo ou manualmente" : "outro motivo";
      datetime tc = (datetime)HistoryDealGetInteger(tk, DEAL_TIME), to = tc;
      double entry = 0;
      if(HistorySelectByPosition((long)pid))                                       // acha a abertura da mesma posição
      {
         for(int q = 0; q < HistoryDealsTotal(); q++)
         {
            ulong t2 = HistoryDealGetTicket(q);
            if(t2 != 0 && HistoryDealGetInteger(t2, DEAL_ENTRY) == DEAL_ENTRY_IN) { entry = HistoryDealGetDouble(t2, DEAL_PRICE); to = (datetime)HistoryDealGetInteger(t2, DEAL_TIME); break; }
         }
      }
      HistorySelect(now - 21 * 86400, now + 60);                                   // volta a seleção do laço
      JournalAt(tc, "FECHOU", StringFormat("resultado=%.2f preco=%.2f pos=%I64u saida=%s entrada=%.2f dur=%d mae=n/d mfe=n/d", p, HistoryDealGetDouble(tk, DEAL_PRICE), pid, how + " (registrado pela conferencia do historico)", entry, (int)(tc - to)));
      MarkClosed(pid);
      if(reason == DEAL_REASON_SL && p < 0 && tc > g_lastStopTime) g_lastStopTime = tc;
   }
}

#endif
