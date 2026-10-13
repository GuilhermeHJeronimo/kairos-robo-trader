//+------------------------------------------------------------------+
//| XR_Status.mqh - publica o estado do robô em MQL5\Files para o    |
//| painel web ler (somente leitura: o painel não controla o robô).  |
//| Escreve num arquivo temporário e troca por FileMove, para o      |
//| painel nunca ler um arquivo pela metade.                         |
//+------------------------------------------------------------------+
#property strict

string g_lastSig = "", g_lastSigTime = "";

string JS(const string s)                          // texto seguro para JSON
{
   string r = s;
   StringReplace(r, "\\", "/"); StringReplace(r, "\"", "'");
   StringReplace(r, "\r", " "); StringReplace(r, "\n", " "); StringReplace(r, "\t", " ");
   return r;
}
string JB(const bool v) { return v ? "true" : "false"; }
string JN(const double v, const int dg = 2) { return DoubleToString(v, dg); }

//--- force = escreve mesmo no Testador (só no fim); running=false marca "robô parado"
void WriteStatus(const string lastNote, const bool force = false, const bool running = true)
{
   if(MQLInfoInteger(MQL_TESTER) && !force) return;   // no Testador só o estado final (evita milhões de gravações)

   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string modeS = (mode == ACCOUNT_TRADE_MODE_REAL) ? "REAL" : (mode == ACCOUNT_TRADE_MODE_DEMO) ? "DEMO" : "CONCURSO";
   double eq = AccountInfoDouble(ACCOUNT_EQUITY), bal = AccountInfoDouble(ACCOUNT_BALANCE);
   int tr, consec; double pnl; TodayStats(tr, consec, pnl);
   string why = ""; bool ses = InSession(why);
   double ddPct = (g_peak > 0) ? (g_peak - eq) / g_peak * 100.0 : 0;
   double dayLoss = (g_dayEq > 0) ? (g_dayEq - eq) / g_dayEq * 100.0 : 0;
   MqlTick t; bool hasTick = SymbolInfoTick(_Symbol, t);

   string s = "{";
   s += "\"running\":" + JB(running) + ",\"version\":\"2.3\",\"robot\":\"Kairos\",\"symbol\":\"" + _Symbol + "\",\"asset\":\"" + AssetName() + "\",\"h24\":" + JB(Is24x7()) + "";
   s += ",\"time_utc\":\"" + TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS) + "\",\"epoch_utc\":" + IntegerToString((long)TimeGMT());
   s += ",\"server_time\":\"" + TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + "\"";
   s += ",\"symbol\":\"" + _Symbol + "\",\"tf\":\"" + EnumToString(g_tf) + "\",\"tester\":" + JB((bool)MQLInfoInteger(MQL_TESTER));
   s += ",\"algo_allowed\":" + JB((bool)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && (bool)MQLInfoInteger(MQL_TRADE_ALLOWED));
   s += ",\"account\":{\"mode\":\"" + modeS + "\",\"server\":\"" + JS(AccountInfoString(ACCOUNT_SERVER)) + "\",\"currency\":\"" + JS(AccountInfoString(ACCOUNT_CURRENCY)) + "\"";
   s += ",\"balance\":" + JN(bal) + ",\"equity\":" + JN(eq) + ",\"margin_free\":" + JN(AccountInfoDouble(ACCOUNT_MARGIN_FREE)) + "}";
   s += ",\"guards\":{\"killed\":" + JB(g_killed) + ",\"day_blocked\":" + JB(g_dayBlocked) + ",\"day_start_equity\":" + JN(g_dayEq) + ",\"peak_equity\":" + JN(g_peak);
   s += ",\"drawdown_pct\":" + JN(ddPct) + ",\"day_loss_pct\":" + JN(dayLoss) + ",\"trades_today\":" + IntegerToString(tr);
   s += ",\"consec_losses\":" + IntegerToString(consec) + ",\"pnl_today\":" + JN(pnl) + ",\"in_session\":" + JB(ses) + ",\"session_note\":\"" + JS(why) + "\"}";
   s += ",\"limits\":{\"risk_pct\":" + JN(InpRiskPct) + ",\"max_daily_loss_pct\":" + JN(EffDailyLossPct()) + ",\"max_drawdown_pct\":" + JN(InpMaxDrawdownPct);
   s += ",\"max_trades_day\":" + IntegerToString(EffMaxTradesPerDay()) + ",\"max_consec_losses\":" + IntegerToString(EffMaxConsecLosses());
   s += ",\"max_positions\":" + IntegerToString(EffMaxPositions()) + ",\"min_conf\":" + IntegerToString(InpMinConf) + ",\"max_spread\":" + JN(IsGold() ? InpMaxSpread : InpMaxSpreadATRPct) + ",\"min_confluence\":" + IntegerToString(InpUseConfluence ? MinConfEff() : 0) + ",\"min_rr\":" + JN(InpMinRR) + "}";
   if(hasTick) s += ",\"market\":{\"bid\":" + JN(t.bid, _Digits) + ",\"ask\":" + JN(t.ask, _Digits) + ",\"spread\":" + JN(t.ask - t.bid, 2) + "}";

   if(InpUseHierarchy)
   {
      string tb, ts2; bool okb = HierarchyAllows(1, tb), oks = HierarchyAllows(-1, ts2);
      int p = g_lv[0].trend, sc = g_lv[1].trend, te = g_lv[2].trend;
      s += ",\"hierarchy\":{\"enabled\":true,\"mandatory\":" + JB(InpHierMandatory) + ",\"levels_required\":" + IntegerToString(InpHierLevels);
      s += ",\"primary\":{\"tf\":\"" + TfName(InpHierPrimaryTF) + "\",\"trend\":" + IntegerToString(p) + ",\"text\":\"" + TrendName(p) + "\",\"how\":\"" + JS(g_lv[0].how) + "\"}";
      s += ",\"secondary\":{\"tf\":\"" + TfName(InpHierSecondaryTF) + "\",\"trend\":" + IntegerToString(sc) + ",\"text\":\"" + TrendName(sc) + "\",\"how\":\"" + JS(g_lv[1].how) + "\"}";
      s += ",\"tertiary\":{\"tf\":\"" + TfName(InpHierTertiaryTF) + "\",\"trend\":" + IntegerToString(te) + ",\"text\":\"" + TrendName(te) + "\",\"how\":\"" + JS(g_lv[2].how) + "\"}";
      s += ",\"buy\":{\"allowed\":" + JB(okb) + ",\"text\":\"" + JS(tb) + "\"},\"sell\":{\"allowed\":" + JB(oks) + ",\"text\":\"" + JS(ts2) + "\"}}";
   }
   else s += ",\"hierarchy\":{\"enabled\":false}";

   // controle pelo painel, modo de operação, decisão, verificação em andamento, notícias e sentimento
   s += ",\"control\":{\"allowed\":" + JB(InpAllowPanelControl) + ",\"paused\":" + JB(g_paused) + ",\"last_cmd\":\"" + JS(g_cmdLast) + "\",\"last_id\":" + IntegerToString(g_cmdId)
        + ",\"last_when\":\"" + JS(g_cmdWhen) + "\",\"result\":\"" + JS(g_cmdResult) + "\"}";
   s += ",\"mode\":{\"rr_mode\":" + IntegerToString(InpRRMode) + ",\"fixed_rr\":" + JN(InpFixedRR) + ",\"eval_mode\":" + IntegerToString(InpEvalMode) + ",\"realtime_secs\":" + IntegerToString(InpRealtimeSecs)
        + ",\"two_step\":" + JB(InpTwoStep) + ",\"verify_secs\":" + IntegerToString(InpVerifySecs) + ",\"min_certainty\":" + IntegerToString(InpMinCertainty)
        + ",\"news\":" + JB(InpNewsBlackout) + ",\"sentiment_mode\":" + IntegerToString(InpSentimentMode) + ",\"sentiment_veto\":" + IntegerToString(InpSentimentVeto) + "}";
   if(g_pend.active)
      s += ",\"pending\":{\"active\":true,\"side\":\"" + (g_pend.sig.side > 0 ? "COMPRA" : "VENDA") + "\",\"setup\":\"" + JS(g_pend.sig.setup) + "\",\"elapsed\":" + IntegerToString((int)(TimeCurrent() - g_pend.t0))
           + ",\"needed\":" + IntegerToString(InpVerifySecs) + ",\"certainty\":" + IntegerToString(g_pend.certainty) + "}";
   else s += ",\"pending\":{\"active\":false}";
   s += ",\"decision\":{\"time\":\"" + JS(g_lastDecisionTime) + "\",\"result\":\"" + JS(g_lastDecisionResult) + "\",\"stage\":" + IntegerToString(g_lastDecisionStage) + ",\"text\":\"" + JS(g_lastDecisionText) + "\"}";
   {
      string nwhy; bool blk = NewsBlackout(nwhy);
      ReadSentiment();
      datetime nowc = TimeCurrent();
      s += ",\"news\":{\"calendar_ok\":" + JB(g_calendarOK) + ",\"blackout\":" + JB(blk) + ",\"blackout_why\":\"" + JS(nwhy) + "\",\"events\":[";
      for(int k = 0; k < g_nEvts; k++)
         s += (k > 0 ? "," : "") + "{\"time\":\"" + TimeToString(g_evts[k].t, TIME_DATE | TIME_MINUTES) + "\",\"name\":\"" + JS(g_evts[k].name) + "\",\"in_min\":" + IntegerToString((int)((g_evts[k].t - nowc) / 60)) + "}";
      s += "],\"sentiment\":{\"has\":" + JB(g_sentHas) + ",\"score\":" + IntegerToString(g_sentScore) + ",\"label\":\"" + JS(g_sentLabel) + "\",\"age_min\":"
           + IntegerToString(g_sentEpoch > 0 ? (int)(((long)TimeGMT() - (long)g_sentEpoch) / 60) : -1) + "}}";
   }

   string pos = "{\"open\":false}", plist = "";
   for(int k = PositionsTotal() - 1; k >= 0; k--)
   {
      ulong tk = PositionGetTicket(k);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      bool buy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      string one = "{\"open\":true,\"ticket\":" + IntegerToString((long)tk) + ",\"side\":\"" + (buy ? "COMPRA" : "VENDA") + "\"";
      one += ",\"lots\":" + JN(PositionGetDouble(POSITION_VOLUME)) + ",\"price_open\":" + JN(PositionGetDouble(POSITION_PRICE_OPEN), _Digits);
      one += ",\"sl\":" + JN(PositionGetDouble(POSITION_SL), _Digits) + ",\"tp\":" + JN(PositionGetDouble(POSITION_TP), _Digits);
      one += ",\"profit\":" + JN(PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP));
      one += ",\"open_time\":\"" + TimeToString((datetime)PositionGetInteger(POSITION_TIME), TIME_DATE | TIME_SECONDS) + "\"";
      one += ",\"comment\":\"" + JS(PositionGetString(POSITION_COMMENT)) + "\"}";
      if(plist == "") pos = one;                                   // "position" = a primeira (compatibilidade); "positions" = todas
      plist += (plist == "" ? "" : ",") + one;
   }
   s += ",\"position\":" + pos + ",\"positions\":[" + plist + "]";
   s += ",\"target\":{\"usd\":" + JN(g_targetUSD) + ",\"gain\":" + JN(g_dayGain) + ",\"hit\":" + JB(g_targetHit) + ",\"action\":" + IntegerToString(InpTargetAction) + "}" +
        ",\"brain\":{\"mode\":" + IntegerToString(InpBrainMode) + ",\"loaded\":" + JB(g_bOk) + ",\"usable\":" + JB(g_bUsable) + ",\"auc\":" + JN(g_bAuc) + ",\"base\":" + JN(g_bBase) + "}" +
        ",\"last_note\":\"" + JS(lastNote) + "\",\"last_signal\":{\"time\":\"" + JS(g_lastSigTime) + "\",\"text\":\"" + JS(g_lastSig) + "\"}}";

   string tmp = FN("status.tmp"), dst = FN("status.json");
   int h = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) return;
   FileWriteString(h, s);
   FileClose(h);
   FileMove(tmp, 0, dst, FILE_REWRITE);
}
