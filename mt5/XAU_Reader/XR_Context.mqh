//+------------------------------------------------------------------+
//| XR_Context.mqh - confirmações: VWAP com bandas, perfil de volume, |
//| liquidez (varredura) e fluxo de ticks.                            |
//|                                                                  |
//| ATENÇÃO: o ouro na Exness é CFD. Não há volume real, nem livro   |
//| de ofertas, nem "times and trades" com agressor. O volume usado  |
//| é o volume de TICKS e o fluxo é uma APROXIMAÇÃO (regra do tick:   |
//| alta do preço médio = pressão compradora).                        |
//+------------------------------------------------------------------+
#property strict

//--- VWAP do dia (servidor) ponderado por volume de ticks, com bandas de desvio padrão
bool ComputeVWAP(XContext &c)
{
   c.hasVwap = false;
   datetime now = TimeCurrent();
   datetime ds = now - (now % 86400);
   MqlRates m1[];
   int got = CopyRates(_Symbol, PERIOD_M1, ds, now, m1);
   if(got < 120) { got = CopyRates(_Symbol, PERIOD_M1, ds - 86400, now, m1); }   // começo do dia: usa desde ontem
   if(got < 60) return false;
   double sv = 0, spv = 0;
   for(int k = 0; k < got; k++)
   {
      double tp = (m1[k].high + m1[k].low + m1[k].close) / 3.0, w = (double)m1[k].tick_volume;
      sv += w; spv += w * tp;
   }
   if(sv <= 0) return false;
   double vw = spv / sv, var = 0;
   for(int k = 0; k < got; k++)
   {
      double tp = (m1[k].high + m1[k].low + m1[k].close) / 3.0, w = (double)m1[k].tick_volume;
      var += w * (tp - vw) * (tp - vw);
   }
   double sd = MathSqrt(var / sv);
   c.vwap = vw; c.u1 = vw + sd; c.l1 = vw - sd; c.u2 = vw + 2 * sd; c.l2 = vw - 2 * sd;
   c.hasVwap = true;
   return true;
}

//--- perfil de volume (volume de ticks distribuído entre mínima e máxima de cada M5): POC e área de valor de 70%
bool ComputeProfile(XContext &c, const double atr)
{
   c.hasProfile = false;
   datetime now = TimeCurrent();
   MqlRates m5[];
   int got = CopyRates(_Symbol, PERIOD_M5, now - (datetime)(InpProfileHours * 3600), now, m5);
   if(got < 50 || !XValid(atr)) return false;
   double lo = DBL_MAX, hi = -DBL_MAX;
   for(int k = 0; k < got; k++) { lo = MathMin(lo, m5[k].low); hi = MathMax(hi, m5[k].high); }
   double step = MathMax(atr / 12.0, _Point * 10);
   int nb = (int)MathCeil((hi - lo) / step) + 1;
   if(nb < 5 || nb > 4000) return false;
   double vol[]; ArrayResize(vol, nb); ArrayInitialize(vol, 0.0);
   double total = 0;
   for(int k = 0; k < got; k++)
   {
      int b0 = (int)((m5[k].low - lo) / step), b1 = (int)((m5[k].high - lo) / step);
      b0 = MathMax(0, MathMin(nb - 1, b0)); b1 = MathMax(b0, MathMin(nb - 1, b1));
      double w = (double)m5[k].tick_volume / (double)(b1 - b0 + 1);
      for(int b = b0; b <= b1; b++) vol[b] += w;
      total += (double)m5[k].tick_volume;
   }
   if(total <= 0) return false;
   int poc = 0;
   for(int b = 1; b < nb; b++) if(vol[b] > vol[poc]) poc = b;
   double va = vol[poc]; int L = poc, U = poc;
   while(va < 0.7 * total)
   {
      double up = (U + 1 < nb) ? vol[U + 1] : -1.0, dn = (L - 1 >= 0) ? vol[L - 1] : -1.0;
      if(up < 0 && dn < 0) break;
      if(up >= dn) { U++; va += up; } else { L--; va += dn; }
   }
   c.poc = lo + (poc + 0.5) * step; c.vah = lo + (U + 1) * step; c.val = lo + L * step;
   c.hasProfile = true;
   return true;
}

//--- fluxo de ticks: desequilíbrio entre altas e baixas do preço médio na janela (aproximação de order flow)
bool ComputeFlow(XContext &c)
{
   c.hasFlow = false; c.flowImb = 0; c.flowTicks = 0;
   MqlTick ticks[];
   ulong to = (ulong)TimeCurrent() * 1000 + 999;
   ulong from = to - (ulong)InpFlowMinutes * 60 * 1000;
   int got = CopyTicksRange(_Symbol, ticks, COPY_TICKS_INFO, from, to);
   if(got < 50) return false;
   int up = 0, dn = 0;
   double prev = (ticks[0].bid + ticks[0].ask) / 2.0;
   for(int k = 1; k < got; k++)
   {
      double mid = (ticks[k].bid + ticks[k].ask) / 2.0;
      if(mid > prev + _Point * 0.5) up++;
      else if(mid < prev - _Point * 0.5) dn++;
      prev = mid;
   }
   if(up + dn < 20) return false;
   c.flowImb = (double)(up - dn) / (double)(up + dn);
   c.flowTicks = got;
   c.hasFlow = true;
   return true;
}

//--- varredura de liquidez: candle recente varreu um topo/fundo confirmado e fechou de volta (stop hunt)
bool LiquiditySweep(const int side, const MqlRates &r[], const int iClosed, const XPivot &piv[], const double a)
{
   int np = ArraySize(piv);
   for(int b = iClosed; b > iClosed - 4 && b > 0; b--)
   {
      for(int k = np - 1; k >= 0 && k >= np - 30; k--)
      {
         if(piv[k].i >= b - 1) continue;                      // o pivô precisa existir antes do candle que varre
         if(side > 0 && piv[k].kind == -1 && r[b].low < piv[k].price - 0.05 * a && r[b].close > piv[k].price) return true;
         if(side < 0 && piv[k].kind == 1  && r[b].high > piv[k].price + 0.05 * a && r[b].close < piv[k].price) return true;
      }
   }
   return false;
}

//--- conta as confirmações alinhadas com o sinal; devolve os nomes das que valeram e das que faltaram
int CountConfirmations(const XSignal &s, const XContext &c, const MqlRates &r[], const int iClosed, const XPivot &piv[],
                       const double a, const double e21, const double e50, string &okNames, string &noNames)
{
   int n = 0; okNames = ""; noNames = "";
   double cl = r[iClosed].close, lo = r[iClosed].low, hi = r[iClosed].high;
   bool buy = (s.side > 0);

   if(InpConfTrend)
   {
      bool ok = buy ? (g_trend > 0 || (e21 > e50 && cl > e50)) : (g_trend < 0 || (e21 < e50 && cl < e50));
      if(ok) { n++; okNames += "tendencia "; } else noNames += "tendencia ";
   }
   if(InpConfVWAP)
   {
      bool ok = false;
      if(c.hasVwap)
         ok = buy ? (cl > c.vwap || (lo <= c.l1 && cl > c.l1)) : (cl < c.vwap || (hi >= c.u1 && cl < c.u1));
      if(ok) { n++; okNames += "vwap "; } else noNames += "vwap ";
   }
   if(InpConfProfile)
   {
      bool ok = false;
      if(c.hasProfile)
      {
         if(buy) ok = (cl > c.vah) || (MathAbs(lo - c.val) <= 0.3 * a && cl > c.val) || (MathAbs(lo - c.poc) <= 0.3 * a && cl > c.poc);
         else    ok = (cl < c.val) || (MathAbs(hi - c.vah) <= 0.3 * a && cl < c.vah) || (MathAbs(hi - c.poc) <= 0.3 * a && cl < c.poc);
      }
      if(ok) { n++; okNames += "perfil "; } else noNames += "perfil ";
   }
   if(InpConfLiquidity)
   {
      if(LiquiditySweep(s.side, r, iClosed, piv, a)) { n++; okNames += "liquidez "; } else noNames += "liquidez ";
   }
   if(InpConfFlow)
   {
      bool ok = c.hasFlow && c.volRatio >= 1.0 && (buy ? c.flowImb >= InpFlowThreshold : c.flowImb <= -InpFlowThreshold);
      if(ok) { n++; okNames += "fluxo "; } else noNames += "fluxo ";
   }
   return n;
}
