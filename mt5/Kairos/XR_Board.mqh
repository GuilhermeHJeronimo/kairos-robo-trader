//+------------------------------------------------------------------+
//| XR_Board.mqh - levantamento do mercado: placar de indicadores    |
//|                                                                  |
//| Cada indicador dá um voto para a operação candidata:             |
//|   +1 concorda, -1 discorda, 0 sem opinião (não entra na conta).  |
//| Confluência = concordam / (concordam + discordam). A operação    |
//| só segue com a confluência mínima (padrão 75%). Nenhum           |
//| indicador decide sozinho, nem a hierarquia de Dow.               |
//|                                                                  |
//| Além dos votos, guarda os NÚMEROS de cada indicador (g_fn/g_fv)  |
//| para o "cérebro" (modelo treinado no histórico, XR_Brain.mqh).   |
//+------------------------------------------------------------------+
#property strict

double g_rsi[], g_macdM[], g_macdS[];                  // preenchidos a cada avaliação
string g_fn[];                                         // nomes das características da operação em análise
double g_fv[];                                         // valores

void FeatClear() { ArrayResize(g_fn, 0); ArrayResize(g_fv, 0); }
void FeatSet(const string name, const double v)
{
   int n = ArraySize(g_fn); ArrayResize(g_fn, n + 1); ArrayResize(g_fv, n + 1);
   g_fn[n] = name; g_fv[n] = v;
}

//--- gap: salto entre o fechamento de um candle e a abertura do seguinte (>= 0,5 ATR) nos últimos 48 candles, ainda não preenchido.
//    sizeSigned > 0 = gap na direção da operação (alta para compra, baixa para venda); age = candles desde o gap
bool GapInfo(const MqlRates &r[], const int iSig, const double a, const int sd, double &sizeSigned, int &age, string &txt)
{
   sizeSigned = 0; age = 48; txt = "sem gap relevante";
   if(a <= 0) return false;
   for(int k = iSig; k > iSig - 48 && k >= 1; k--)
   {
      double gap = r[k].open - r[k - 1].close;
      if(MathAbs(gap) < 0.5 * a) continue;
      bool up = gap > 0, filled = false;
      for(int q = k; q <= iSig; q++)
         if((up && r[q].low <= r[k - 1].close) || (!up && r[q].high >= r[k - 1].close)) { filled = true; break; }
      if(filled) continue;
      sizeSigned = (up ? 1 : -1) * sd * MathMin(MathAbs(gap) / a, 3.0);
      age = iSig - k;
      txt = StringFormat("gap de %s de %.1f ATR ha %d candles, ainda nao preenchido (%s)", up ? "alta" : "baixa", MathAbs(gap) / a, age, sizeSigned > 0 ? "na direcao da operacao" : "contra a operacao");
      return true;
   }
   return false;
}

//--- iSig = candle em análise (em tempo real, o candle em formação)
void BoardEvaluate(const XSignal &sig, const MqlRates &r[], const int iSig, const double &atr[], const double &e21[], const double &e50[],
                   const XContext &c, const string confOk)
{
   FeatClear();
   int sd = sig.side;
   bool buy = (sd > 0);
   double cl = r[iSig].close;
   double a0 = atr[iSig] > 0 ? atr[iSig] : 1.0;
   double riskPx = MathMax(MathAbs(sig.price - sig.stop), 1e-9);

   // 1) estrutura de mercado do tempo gráfico (topos e fundos)
   int vEstr = g_trend == 0 ? 0 : (g_trend == sd ? 1 : -1);
   FacAdd("estrutura a favor", vEstr, g_trend == 0 ? "lateral" : (g_trend > 0 ? "topos e fundos de alta" : "topos e fundos de baixa"));

   // 2) hierarquia de Dow: mensal, semanal e diário (só um voto entre vários)
   int al = 0, ao = 0;
   for(int k = 0; k < 3; k++) { if(g_lv[k].trend == sd) al++; else if(g_lv[k].trend == -sd) ao++; }
   int vHier = al > ao ? 1 : (al < ao ? -1 : 0);
   FacAdd("hierarquia forte", vHier, StringFormat("%d de 3 niveis a favor (%d contra)", al, ao), MathMax(1, InpHierWeight));

   // 3) médias móveis 21 e 50
   int mv = 0;
   if(e21[iSig] > e50[iSig] && cl > e50[iSig]) mv = 1; else if(e21[iSig] < e50[iSig] && cl < e50[iSig]) mv = -1;
   int vMed = mv * sd;
   FacAdd("medias moveis 21/50", vMed, StringFormat("EMA21 %.2f, EMA50 %.2f, preco %.2f", e21[iSig], e50[iSig], cl));

   // 4) RSI: momentum a favor sem exaustão, ou repique saindo de sobrevenda/sobrecompra
   double rs = g_rsi[iSig], rp = g_rsi[iSig - 1];
   int rv = 0;
   if(buy) { if(rs >= 50 && rs <= 72) rv = 1; else if(rs < 35 && rs > rp) rv = 1; else if(rs > 75) rv = -1; else if(rs <= 45 && rs < rp) rv = -1; }
   else    { if(rs <= 50 && rs >= 28) rv = 1; else if(rs > 65 && rs < rp) rv = 1; else if(rs < 25) rv = -1; else if(rs >= 55 && rs > rp) rv = -1; }
   FacAdd("RSI " + IntegerToString(InpRsiPeriod), rv, StringFormat("RSI %.1f (%s)", rs, rs > rp ? "subindo" : "caindo"));

   // 5) MACD 12/26/9: linha acima ou abaixo do sinal
   double mh = g_macdM[iSig] - g_macdS[iSig];
   int vMacd = (mh > 0 ? 1 : (mh < 0 ? -1 : 0)) * sd;
   FacAdd("MACD 12/26/9", vMacd, StringFormat("histograma %.3f", mh));

   // 6) VWAP do dia
   int vVwap = 0;
   if(c.hasVwap) { vVwap = (cl > c.vwap ? 1 : -1) * sd; FacAdd("VWAP do dia", vVwap, StringFormat("preco %.2f, VWAP %.2f", cl, c.vwap)); }
   else          FacAdd("VWAP do dia", 0, "sem dados");

   // 7) perfil de volume (POC / VAH / VAL) e 8) varredura de liquidez: confirmam quando aparecem
   int vPerf = StringFind(confOk, "perfil") >= 0 ? 1 : 0, vLiq = StringFind(confOk, "liquidez") >= 0 ? 1 : 0;
   FacAdd("perfil de volume", vPerf, vPerf ? "preco em nivel do perfil" : "longe dos niveis do perfil");
   FacAdd("liquidez varrida", vLiq, vLiq ? "varreu stops e voltou" : "sem varredura");

   // 9) volume (interesse no movimento; projetado para o candle inteiro)
   double vr = (g_avgVol > 0) ? g_volI / g_avgVol : 0;
   int vVol = vr >= 1.0 ? 1 : (vr < 0.7 ? -1 : 0);
   FacAdd("volume acima da media", vVol, StringFormat("%.2fx a media", vr));

   // 10) volatilidade: ATR atual contra a média dos últimos 50 candles
   double sum = 0; int cnt = 0;
   for(int k = iSig - 50; k < iSig; k++) if(k >= 0 && atr[k] > 0) { sum += atr[k]; cnt++; }
   double avgAtr = (cnt > 0) ? sum / cnt : 0, ratio = (avgAtr > 0) ? atr[iSig] / avgAtr : 0;
   int vVola = (ratio >= 0.7 && ratio <= 1.8) ? 1 : ((ratio < 0.5 || ratio > 2.5) ? -1 : 0);
   FacAdd("volatilidade (ATR)", vVola, StringFormat("ATR %.2f = %.2fx a media de 50", atr[iSig], ratio));

   // 11) padrão de vela (candle em análise e o anterior)
   string n0, n1;
   int p0 = CandlePattern(r, iSig, n0), p1 = CandlePattern(r, iSig - 1, n1);
   int pv = 0; string pd = "sem padrao";
   if(p0 == sd) { pv = 1; pd = n0; } else if(p1 == sd) { pv = 1; pd = n1 + " (candle anterior)"; }
   else if(p0 == -sd) { pv = -1; pd = n0 + " (contra)"; } else if(p1 == -sd) { pv = -1; pd = n1 + " (contra, candle anterior)"; }
   FacAdd("padrao de vela", pv, pd);

   // 12) sentimento das manchetes
   if(g_sentHas && InpSentimentMode > 0) FacAdd("sentimento a favor", g_sentScore * sd >= 15 ? 1 : (g_sentScore * sd <= -15 ? -1 : 0), StringFormat("nota %d", g_sentScore));
   else FacAdd("sentimento a favor", 0, "sem nota");

   // 13) surpresa da agenda econômica (dado real contra previsão, últimas 3 h; só ao vivo: o Testador não tem calendário)
   string ct;
   int cs = CalendarSurpriseVote(sd, ct);
   FacAdd("surpresa da agenda economica", cs, ct);

   // 14) gap nao preenchido nos ultimos 48 candles: no historico do ouro em H1, sinais com gap a favor tiveram +0,45 R/op (n=224) e com gap contra -0,14 (n=181);
   //     achado preliminar (poucos dias independentes), por isso e so mais um voto
   double gs; int ga; string gt;
   GapInfo(r, iSig, a0, sd, gs, ga, gt);
   FacAdd("gap nao preenchido", gs > 0 ? 1 : (gs < 0 ? -1 : 0), gt);

   // características numéricas para o cérebro (mesmos nomes e contas de cerebro/dataset.py)
   FeatSet("v_estrutura", vEstr); FeatSet("v_hier", vHier); FeatSet("v_medias", vMed); FeatSet("v_rsi", rv); FeatSet("v_macd", vMacd);
   FeatSet("v_vwap", vVwap); FeatSet("v_perfil", vPerf); FeatSet("v_liquidez", vLiq); FeatSet("v_volume", vVol); FeatSet("v_vol", vVola); FeatSet("v_vela", pv);
   FeatSet("hier_al", al); FeatSet("hier_ao", ao);
   FeatSet("rsi", buy ? rs : 100.0 - rs); FeatSet("rsi_up", buy ? (rs > rp ? 1 : 0) : (rs > rp ? 0 : 1));
   FeatSet("macd_atr", mh * sd / a0); FeatSet("vwap_atr", c.hasVwap ? (cl - c.vwap) * sd / a0 : 0.0); FeatSet("ema50_atr", (cl - e50[iSig]) * sd / a0);
   FeatSet("vol_ratio", MathMin(vr, 5.0)); FeatSet("atr_ratio", MathMin(ratio, 4.0)); FeatSet("risk_atr", riskPx / a0);
   double od = ObstacleDistance(sd, sig.price);
   FeatSet("free_r", od == DBL_MAX ? 20.0 : MathMin(od / riskPx, 20.0));
   FeatSet("is_rej", StringFind(sig.setup, "Rejeicao") >= 0 ? 1 : 0); FeatSet("is_rompe", StringFind(sig.setup, "Rompimento") >= 0 ? 1 : 0); FeatSet("side", sd);
   FeatSet("gap_atr", gs); FeatSet("gap_age", MathMin(ga, 48));
}
