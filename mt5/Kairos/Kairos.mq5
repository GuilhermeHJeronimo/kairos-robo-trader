//+------------------------------------------------------------------+
//| Kairos.mq5 - robô de leitura de gráfico para ouro e bitcoin      |
//| Versão 1.2                                                       |
//|  - opera no tempo gráfico do gráfico em que é anexado            |
//|  - hierarquia de análise de Dow (mensal > semanal > diário)      |
//|  - análise em tempo real (preço) ou por candle fechado           |
//|  - decisão em duas etapas: análise + verificação ao vivo         |
//|  - modelo de saída fixo (ex.: 1:3) ou pela estrutura             |
//|  - notícias (calendário do MT5) e sentimento das manchetes       |
//|  - painel web com relatório, gráficos e botões de controle       |
//|                                                                  |
//| AVISO: ferramenta educacional. Os testes do projeto não provam   |
//| vantagem estatística. Teste na demo antes de qualquer dinheiro.  |
//+------------------------------------------------------------------+
#property copyright "Day Trade Assistant"
#property version   "2.30"
#property description "Kairos: leitor de grafico + hierarquia de Dow + decisao em duas etapas (ouro e bitcoin)."

#include "XR_Inputs.mqh"
#include "XR_Types.mqh"
#include "XR_Reader.mqh"
#include "XR_Context.mqh"
#include "XR_Hierarchy.mqh"
#include "XR_Risk.mqh"
#include "XR_Track.mqh"
#include "XR_Json.mqh"
#include "XR_News.mqh"
#include "XR_Control.mqh"
#include "XR_Verify.mqh"
#include "XR_Board.mqh"
#include "XR_Brain.mqh"
#include "XR_Target.mqh"
#include "XR_Brake.mqh"
#include "XR_Status.mqh"
#include "XR_Export.mqh"

int       hATR = INVALID_HANDLE, hE21 = INVALID_HANDLE, hE50 = INVALID_HANDLE, hRSI = INVALID_HANDLE, hMACD = INVALID_HANDLE;
datetime  g_lastBar = 0, g_lastEval = 0;
long      g_timerCount = 0;
XContext  g_ctx;
string    g_lastNote = "aguardando o primeiro candle";
string    g_lastSigKey = "";

//+------------------------------------------------------------------+
int OnInit()
{
   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_REAL && !InpAllowRealAccount)
   {
      string m = "Kairos BLOQUEADO: conta REAL detectada e InpAllowRealAccount = false. "
                 "Para operar em conta real, marque essa opcao conscientemente. Recomendado: teste antes na conta demo.";
      Print(m); Alert(m);
      return INIT_FAILED;
   }
   if(!IsGold() && StringFind(_Symbol, "BTC") < 0) Print("[KAIROS] AVISO: o robo foi testado so em ouro e bitcoin; simbolo atual: ", _Symbol);
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) Print("[XAUR] AVISO: negociacao algoritmica desligada no terminal (botao 'Algo Trading').");
   if(InpRiskPct <= 0 || InpRiskPct > 2.0) { Print("[XAUR] InpRiskPct fora do intervalo seguro (0 a 2%)."); return INIT_PARAMETERS_INCORRECT; }
   if(InpRRMode == 1 && (InpFixedRR < 1.0 || InpFixedRR > 10.0)) { Print("[XAUR] InpFixedRR deve ficar entre 1 e 10."); return INIT_PARAMETERS_INCORRECT; }

   g_tf = (InpTF == PERIOD_CURRENT) ? (ENUM_TIMEFRAMES)Period() : InpTF;   // opera no tempo gráfico em que foi anexado
   hATR = iATR(_Symbol, g_tf, 14);
   hE21 = iMA(_Symbol, g_tf, 21, 0, MODE_EMA, PRICE_CLOSE);
   hE50 = iMA(_Symbol, g_tf, 50, 0, MODE_EMA, PRICE_CLOSE);
   hRSI = iRSI(_Symbol, g_tf, InpRsiPeriod, PRICE_CLOSE);
   hMACD = iMACD(_Symbol, g_tf, 12, 26, 9, PRICE_CLOSE);
   if(hATR == INVALID_HANDLE || hE21 == INVALID_HANDLE || hE50 == INVALID_HANDLE || hRSI == INVALID_HANDLE || hMACD == INVALID_HANDLE) { Print("[XAUR] falha ao criar indicadores"); return INIT_FAILED; }

   g_pend.active = false;
   RiskInit();
   TargetInit();
   ControlInit();
   if(!MQLInfoInteger(MQL_TESTER)) EventSetTimer(1);
   Journal("INICIO", StringFormat("simbolo=%s tf=%s conta=%s saldo=%.2f risco=%.2f%% confirmacoes>=%d",
           _Symbol, EnumToString(g_tf), (mode == ACCOUNT_TRADE_MODE_REAL ? "REAL" : mode == ACCOUNT_TRADE_MODE_DEMO ? "DEMO" : "CONCURSO"),
           AccountInfoDouble(ACCOUNT_BALANCE), InpRiskPct, InpMinConf));
   Journal("CONFIG", StringFormat("saida=%s analise=%s duas_etapas=%s verificacao=%ds certeza>=%d%% hierarquia=%s(%d niveis) noticias=%s sentimento=%d pausado=%s",
           (InpRRMode == 1 ? StringFormat("fixa 1:%.1f", InpFixedRR) : "pela estrutura"), (InpEvalMode == 1 ? "tempo real" : "candle fechado"),
           (InpTwoStep ? "sim" : "nao"), InpVerifySecs, InpMinCertainty, (InpUseHierarchy ? "ligada" : "desligada"), InpHierLevels,
           (InpNewsBlackout ? "bloqueio" : "desligado"), InpSentimentMode, (g_paused ? "sim" : "nao")));
   if(InpUseHierarchy)
   {
      string tb; HierarchyAllows(1, tb);                                   // força a leitura dos três níveis
      Journal("HIERARQUIA_INFO", StringFormat("primaria %s: %s (%s) | secundaria %s: %s (%s) | terciaria %s: %s (%s)",
              TfName(InpHierPrimaryTF), TrendName(g_lv[0].trend), g_lv[0].how, TfName(InpHierSecondaryTF), TrendName(g_lv[1].trend), g_lv[1].how,
              TfName(InpHierTertiaryTF), TrendName(g_lv[2].trend), g_lv[2].how));
   }
   Journal("ESPECIFICACOES", StringFormat("ativo=%s simbolo=%s contrato=%.4f lote_min=%.4f lote_passo=%.4f lote_max=%.2f tick=%.5f valor_tick=%.4f casas=%d stops_level=%d spread_pts=%d sabado=%s", AssetName(), _Symbol, SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS), (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL), (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), Is24x7() ? "opera" : "fechado"));
   WriteStatus(g_lastNote);
   return INIT_SUCCEEDED;
}

string ReasonText(const int r)
{
   switch(r)
   {
      case REASON_PROGRAM:     return "o robo terminou sozinho";
      case REASON_REMOVE:      return "robo removido do grafico";
      case REASON_RECOMPILE:   return "robo recompilado";
      case REASON_CHARTCHANGE: return "simbolo ou tempo grafico do grafico mudou";
      case REASON_CHARTCLOSE:  return "grafico fechado";
      case REASON_PARAMETERS:  return "parametros alterados";
      case REASON_ACCOUNT:     return "outra conta conectada";
      case REASON_TEMPLATE:    return "modelo (template) aplicado";
      case REASON_INITFAILED:  return "falha na inicializacao";
      case REASON_CLOSE:       return "MetaTrader 5 fechado";
   }
   return "codigo " + IntegerToString(r);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(hATR != INVALID_HANDLE) IndicatorRelease(hATR);
   if(hE21 != INVALID_HANDLE) IndicatorRelease(hE21);
   if(hE50 != INVALID_HANDLE) IndicatorRelease(hE50);
   if(hRSI != INVALID_HANDLE) IndicatorRelease(hRSI);
   if(hMACD != INVALID_HANDLE) IndicatorRelease(hMACD);
   Comment("");
   WriteStatus(g_lastNote, true, false);          // marca "robo parado" para o painel
   Journal("FIM", StringFormat("motivo=%d (%s)", reason, ReasonText(reason)));
}

//+------------------------------------------------------------------+
void OnTick()
{
   WeekendGuard();
   TrackUpdate();
   ManageTimeExit();
   ManageBreakeven();                                     // MAE/MFE das posicoes abertas (aprendizado)
   string why;
   RiskGuards(why);                                   // travas (a cada tick)
   TargetCheck();                                     // meta de ganho do dia
   LogLevelsDaily();                                  // uma vez por dia: o que cada nivel da hierarquia enxerga

   if(g_pend.active)                                  // ETAPA 2: verificação ao vivo, a cada tick
   {
      string w2;
      if(PendTick(w2)) FinishPending();
   }

   if(InpEvalMode == 0)                               // candle fechado: uma leitura por candle
   {
      datetime t0 = iTime(_Symbol, g_tf, 0);
      if(t0 == 0 || t0 == g_lastBar) return;
      g_lastBar = t0;
      Evaluate(false);
      Dashboard();
   }
   else                                               // tempo real: reavalia o preço a cada N segundos
   {
      datetime now = TimeCurrent();
      if(g_lastEval != 0 && now - g_lastEval < InpRealtimeSecs) return;
      g_lastEval = now;
      Evaluate(true);
   }
}

datetime g_lastD1 = 0;
void LogLevelsDaily()
{
   if(!InpUseHierarchy) return;
   datetime d1 = iTime(_Symbol, PERIOD_D1, 0);
   if(d1 == 0 || d1 == g_lastD1) return;
   g_lastD1 = d1;
   string tb; HierarchyAllows(1, tb);
   Journal("HIERARQUIA_INFO", StringFormat("primaria %s: %s (%s) | secundaria %s: %s (%s) | terciaria %s: %s (%s)",
           TfName(InpHierPrimaryTF), TrendName(g_lv[0].trend), g_lv[0].how, TfName(InpHierSecondaryTF), TrendName(g_lv[1].trend), g_lv[1].how,
           TfName(InpHierTertiaryTF), TrendName(g_lv[2].trend), g_lv[2].how));
}

void OnTimer()
{
   if(PollCommands())                                 // comando "desligar" vindo do painel
   {
      WriteStatus(g_lastNote, true, false);
      ExpertRemove();
      return;
   }
   g_timerCount++;
   if(g_timerCount == 10 || g_timerCount % 30 == 0) ReconcileClosed();   // fechamentos que o robo nao viu (MT5 desligado, rajada de ordens)
   if(g_timerCount % 2 == 0) PollExport();            // pedidos de candles do diario (app Python)
   if(g_timerCount % 5 == 0) Dashboard();
}

//+------------------------------------------------------------------+
bool SameSignal(const XSignal &a, const XSignal &b)
{
   return a.side == b.side && a.setup == b.setup && MathAbs(a.level - b.level) < 0.25 * MathMax(a.atr, 0.01);
}

string SideName(const int side) { return side > 0 ? "COMPRA" : "VENDA"; }

//--- ETAPA 1: análise. Preenche g_ck com as verificações. true = pode ir para a etapa 2.
bool Stage1(const XSignal &sig, const MqlRates &r[], const int iSig, const XPivot &piv[], const double &atr[],
            const double &e21[], const double &e50[], string &confText, int &certainty)
{
   // contexto (mais pesado: só calculado quando há sinal)
   ComputeVWAP(g_ctx); ComputeProfile(g_ctx, atr[iSig]); ComputeFlow(g_ctx);
   g_ctx.volRatio = (g_avgVol > 0) ? g_volI / g_avgVol : 0;
   string okN, noN;
   int conf = CountConfirmations(sig, g_ctx, r, iSig, piv, atr[iSig], e21[iSig], e50[iSig], okN, noN);
   confText = StringFormat("%d ok: %s| faltaram: %s", conf, okN, noN);

   string sigKey = StringFormat("%s|%d|%s|%s", TimeToString(g_pend.barTime), sig.side, sig.setup, DoubleToString(sig.level, 1));
   bool newSig = (sigKey != g_lastSigKey);
   if(newSig)                                         // registra o sinal uma vez por candle/nível
   {
      g_lastSigKey = sigKey;
      g_lastSig = StringFormat("%s %s | R:R %.2f | %s", SideName(sig.side), sig.setup, sig.rr, confText);
      g_lastSigTime = TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS);
      Journal("CONTEXTO", StringFormat("vwap=%s poc=%s val=%s vah=%s fluxo=%s ticks=%d volRatio=%.2f",
              g_ctx.hasVwap ? DoubleToString(g_ctx.vwap, 2) : "n/d", g_ctx.hasProfile ? DoubleToString(g_ctx.poc, 2) : "n/d",
              g_ctx.hasProfile ? DoubleToString(g_ctx.val, 2) : "n/d", g_ctx.hasProfile ? DoubleToString(g_ctx.vah, 2) : "n/d",
              g_ctx.hasFlow ? DoubleToString(g_ctx.flowImb, 3) : "n/d", g_ctx.flowTicks, g_ctx.volRatio));
   }

   CkClear();
   double risk = MathAbs(sig.price - sig.stop);

   // --- TRAVAS obrigatórias (segurança da conta; não são indicadores)
   string hTxt = "desligada"; bool hOk = true;
   if(InpUseHierarchy) { hOk = HierarchyAllows(sig.side, hTxt); if(newSig) Journal("HIERARQUIA", hTxt + (hOk ? " => PERMITIDO" : " => BLOQUEADO")); }
   CkAdd("hierarquia de Dow", hOk, InpUseHierarchy && InpHierMandatory, hTxt);      // só informa; vira regra se InpHierMandatory
   CkAdd("relacao retorno/risco", sig.rr >= InpMinRR, true, StringFormat("%.2f (minimo %.2f)", sig.rr, InpMinRR));
   string why;
   bool ses = InSession(why);
   CkAdd("horario", ses, true, ses ? StringFormat("%02d:00 a %02d:00 UTC", InpStartHour, InpEndHour) : why);
   MqlTick tk; double spread = 0; if(SymbolInfoTick(_Symbol, tk)) spread = tk.ask - tk.bid;
   CkAdd("spread e custo", spread <= MaxSpreadEff(atr[iSig]) && (risk <= 0 || spread / risk <= InpMaxCostToRisk), true,
         StringFormat("spread %.2f = %.0f%% do risco", spread, risk > 0 ? spread / risk * 100.0 : 0.0));
   string nw; bool blk = NewsBlackout(nw);
   CkAdd("sem noticia forte", !blk, InpNewsBlackout, blk ? nw : (g_calendarOK ? "sem noticia de alto impacto perto" : "calendario indisponivel"));
   string rg; bool guards = RiskGuards(rg);
   CkAdd("travas de risco", guards, true, guards ? "livres" : rg);
   int tr, consec; double pnl; TodayStats(tr, consec, pnl);
   double openRisk = OpenRiskPct();
   bool riskOk = (EffMaxTotalRiskPct() <= 0) || (openRisk + InpRiskPct <= EffMaxTotalRiskPct() + 1e-9);
   bool lim = OpenPositions() < EffMaxPositions() && riskOk && tr < EffMaxTradesPerDay() && consec < EffMaxConsecLosses();
   CkAdd("limites do dia", lim, true, StringFormat("%d/%d posicoes (risco aberto %.2f%% de %.2f%%), %d/%d operacoes, %d/%d perdas seguidas", OpenPositions(), EffMaxPositions(), openRisk, EffMaxTotalRiskPct(), tr, EffMaxTradesPerDay(), consec, EffMaxConsecLosses()));
   int cdLeft = CooldownLeftSecs();
   CkAdd("pausa depois de stop", cdLeft <= 0, InpCooldownMin > 0, cdLeft > 0 ? StringFormat("faltam %d min depois do ultimo stop", (cdLeft + 59) / 60) : "sem stop recente");
   int brakeCons = 0, brakeLeft = BrakeLeftSecs(brakeCons);
   CkAdd("freio de desempenho", brakeLeft <= 0, InpBrakeEvents > 0, brakeLeft > 0 ? StringFormat("%d perdas seguidas neste ativo: parado por mais %d min", brakeCons, (brakeLeft + 59) / 60) : StringFormat("%d perda(s) seguida(s) (freia em %d)", brakeCons, InpBrakeEvents));
   bool opp = HasOppositePosition(sig.side);
   CkAdd("sem posicao contraria", !opp, InpNoHedge, opp ? "ha posicao aberta no sentido oposto" : "livre");
   CkAdd("meta do dia", !g_targetHit, g_targetUSD > 0, g_targetUSD > 0 ? StringFormat("ganho do dia US$ %.2f de US$ %.2f%s", g_dayGain, g_targetUSD, g_targetHit ? " - META ATINGIDA" : "") : "sem meta definida");

   // --- informações do alvo (não entram na confluência)
   double od = ObstacleDistance(sig.side, sig.price);
   CkAdd("caminho livre ate 1,5R", od == DBL_MAX || od >= 1.5 * risk, false, od == DBL_MAX ? "sem zona a frente" : StringFormat("zona a %.2f (1,5R = %.2f)", od, 1.5 * risk));

   // --- LEVANTAMENTO DO MERCADO: placar de indicadores
   BoardEvaluate(sig, r, iSig, atr, e21, e50, g_ctx, okN);
   double pBrain = -1; string bd = "";
   if(InpBrainMode > 0 && BrainReady()) pBrain = BrainPredict(bd);
   if(pBrain >= 0)
   {
      if(InpBrainMode == 1) CkAdd("cerebro (so informa)", pBrain >= g_bBase, false, bd);
      else if(InpBrainMode == 2) FacAdd("cerebro", pBrain >= g_bBase + 0.05 ? 1 : (pBrain <= g_bBase - 0.05 ? -1 : 0), bd);
      else { double thr = InpBrainMinP > 0 ? InpBrainMinP : g_bBase * 1.1; CkAdd("cerebro (filtro)", pBrain >= thr, true, bd + StringFormat("; minimo %.0f%%", thr * 100)); }
   }
   int agree, against, neutral;
   int pct = Confluence(agree, against, neutral);
   bool enough = (agree + against) >= InpMinFactors;
   bool confOK = !InpUseConfluence || (enough && pct >= MinConfEff());
   CkAdd("confluencia dos indicadores", confOK, InpUseConfluence,
         StringFormat("%d%%: %d a favor, %d contra, %d sem opiniao (minimo %d%% com pelo menos %d opinioes)", pct, agree, against, neutral, MinConfEff(), InpMinFactors));
   g_confShown = pct;
   certainty = pct;
   return CkMandatoryOk();
}

//--- procura sinal e decide; realtime = usa o candle em formação (preço atual)
void Evaluate(const bool realtime)
{
   if(g_paused) { g_lastNote = "pausado pelo painel (nao abre novas operacoes)"; if(g_pend.active) PendClear(); return; }
   MqlRates r[]; double atr[], e21[], e50[];
   int n = CopyRates(_Symbol, g_tf, 0, 500, r);
   if(n < XR_MIN_I + 30) { g_lastNote = "poucos candles carregados"; return; }
   if(CopyBuffer(hATR, 0, 0, n, atr) != n || CopyBuffer(hE21, 0, 0, n, e21) != n || CopyBuffer(hE50, 0, 0, n, e50) != n ||
      CopyBuffer(hRSI, 0, 0, n, g_rsi) != n || CopyBuffer(hMACD, 0, 0, n, g_macdM) != n || CopyBuffer(hMACD, 1, 0, n, g_macdS) != n)
   { g_lastNote = "indicadores ainda calculando"; return; }

   int iSig = realtime ? n - 1 : n - 2;               // tempo real: candle em formação; senão: último fechado
   datetime barT = r[n - 1].time;
   g_pend.barTime = barT;
   XPivot piv[];
   FindPivots(r, n - 1, piv);
   XSignal sig;
   if(!DetectSignal(iSig, r, atr, e21, e50, piv, sig))
   {
      if(g_pend.active && realtime)
      {
         CkClear(); CkAdd("sinal ainda existe", false, true, "o padrao que gerou o sinal desapareceu do candle atual");
         Decide("NAO_ENTROU", 2, g_pend.sig, StringFormat("Nao entrou em %s (%s): o sinal deixou de existir antes do fim da verificacao ao vivo.", SideName(g_pend.sig.side), g_pend.sig.setup));
         PendClear();
      }
      g_lastNote = realtime ? "sem entrada valida no preco atual" : "sem entrada valida neste candle";
      return;
   }
   if(g_pend.active)
   {
      if(SameSignal(sig, g_pend.sig)) return;         // o mesmo sinal segue em verificação
      CkClear(); CkAdd("mesmo sinal", false, true, "o sinal mudou de lado, setup ou nivel");
      Decide("NAO_ENTROU", 2, g_pend.sig, StringFormat("Nao entrou em %s (%s): o sinal mudou durante a verificacao.", SideName(g_pend.sig.side), g_pend.sig.setup));
      PendClear();
   }
   if(g_lastEntryBar == barT) { g_lastNote = "ja operou neste candle"; return; }

   string cs; int cert;
   bool pass = Stage1(sig, r, iSig, piv, atr, e21, e50, cs, cert);
   if(!pass)
   {
      string fails = CkFailedText();
      string expl = (fails != "")
         ? StringFormat("Nao entrou em %s (%s) na etapa 1 (analise). Falhou: %s. Certeza %d%%.", SideName(sig.side), sig.setup, fails, cert)
         : StringFormat("Nao entrou em %s (%s) na etapa 1 (analise): certeza de %d%%, abaixo do minimo de %d%%. Pontos fracos: %s.", SideName(sig.side), sig.setup, cert, InpMinCertainty, CkWeakText());
      g_lastNote = expl;
      Decide("NAO_ENTROU", 1, sig, expl);
      return;
   }

   if(InpTwoStep)
   {
      g_pend.active = true; g_pend.sig = sig; g_pend.t0 = TimeCurrent(); g_pend.confText = cs; g_pend.certainty = cert;
      g_pend.stage1 = CkOkNames(); g_pend.stage1Ck = CkText();
      string expl = StringFormat("Etapa 1 aprovada para %s (%s), certeza %d%%. Aguardando %d s de verificacao ao vivo no preco de mercado.", SideName(sig.side), sig.setup, cert, InpVerifySecs);
      g_lastNote = expl;
      Decide("EM_VERIFICACAO", 1, sig, expl, true);
      return;
   }

   // sem duas etapas: entra direto
   g_pend.certainty = cert; g_pend.stage1 = CkOkNames(); g_pend.stage1Ck = "";
   string why;
   if(ExecuteSignal(sig, cs, why))
   {
      g_lastEntryBar = barT; g_lastNote = "ABRIU " + sig.setup;
      Decide("ENTROU", 1, sig, StringFormat("Entrou em %s (%s). Motivos do leitor: %s. Analise aprovou: %s (certeza %d%%). Verificacao em duas etapas desligada.", SideName(sig.side), sig.setup, sig.reasons, CkOkNames(), cert), true);
   }
   else { g_lastNote = "nao abriu: " + why; Journal("NAO_ABRIU", why); Decide("NAO_ENTROU", 1, sig, StringFormat("Nao entrou em %s (%s): %s", SideName(sig.side), sig.setup, why)); }
}

//--- fim da etapa 2: abre a ordem no preço atual
void FinishPending()
{
   XSignal s = g_pend.sig;
   string why, stage2 = CkOkNames();
   string ck1 = g_pend.stage1Ck;
   if(ExecuteSignal(s, g_pend.confText, why))
   {
      g_lastEntryBar = g_pend.barTime; g_lastNote = "ABRIU " + s.setup;
      Decide("ENTROU", 2, s, EntryExplanation(s, g_pend.stage1), true, ck1);
   }
   else
   {
      g_lastNote = "nao abriu: " + why; Journal("NAO_ABRIU", why);
      Decide("NAO_ENTROU", 2, s, StringFormat("Nao entrou em %s (%s): a ordem foi recusada na hora de abrir: %s", SideName(s.side), s.setup, why));
   }
   PendClear();
}

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   ulong tk = trans.deal;
   if(!HistoryDealSelect(tk)) return;
   if(HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) return;
   long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
   if(en == DEAL_ENTRY_OUT || en == DEAL_ENTRY_INOUT)
   {
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP);
      long reason = HistoryDealGetInteger(tk, DEAL_REASON);
      string how = (reason == DEAL_REASON_SL) ? "stop atingido" : (reason == DEAL_REASON_TP) ? "alvo atingido" :
                   (reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT) ? "fechada pelo robo ou manualmente" : "outro motivo";
      ulong pid = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
      double px = HistoryDealGetDouble(tk, DEAL_PRICE);
      if(reason == DEAL_REASON_SL && p < 0) g_lastStopTime = TimeCurrent();
      if(reason == DEAL_REASON_SL && TrackBE(pid)) how = (p >= 0) ? "stop no ponto de entrada (protecao de lucro)" : "stop de protecao atingido";
      ClosedLoad();
      if(!IsClosedLogged(pid))
      {
         Journal("FECHOU", StringFormat("resultado=%.2f preco=%.2f pos=%I64u saida=%s%s", p, px, pid, how, TrackClosedText(pid, px)));
         MarkClosed(pid);
      }
   }
   WriteStatus(g_lastNote);
}

//+------------------------------------------------------------------+
void Dashboard()
{
   WriteStatus(g_lastNote);                           // estado para o painel web
   if(!InpDashboard || MQLInfoInteger(MQL_TESTER)) return;
   string why, ses = "dentro do horario";
   if(!InSession(why)) ses = why;
   int tr, consec; double pnl; TodayStats(tr, consec, pnl);
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   string guard = g_paused ? "PAUSADO PELO PAINEL" : g_killed ? "TRAVA DE DRAWDOWN ATIVA" : g_dayBlocked ? "TRAVA DIARIA ATIVA" : "ok";
   string s = "KAIROS v2.3 | " + AssetName() + " | " + EnumToString(g_tf) + " | " + (InpEvalMode == 1 ? "tempo real" : "candle fechado") + "\n";
   s += StringFormat("Conta: %s | Equity %.2f | Pico %.2f\n", (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL ? "REAL" : "DEMO"), eq, g_peak);
   s += StringFormat("Hoje: %d op | resultado %.2f | perdas seguidas %d\n", tr, pnl, consec);
   s += StringFormat("Travas: %s | Horario: %s\n", guard, ses);
   s += StringFormat("Posicoes abertas: %d | Em verificacao: %s\n", OpenPositions(), g_pend.active ? "sim" : "nao");
   s += "Ultima leitura: " + g_lastNote;
   Comment(s);
}
