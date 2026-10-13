//+------------------------------------------------------------------+
//| XR_Reader.mqh - porta do reader.py: estrutura, zonas, candles e  |
//| setups. Usa só candles FECHADOS e pivôs já confirmados.          |
//| Arrays em ordem cronológica (índice 0 = mais antigo).            |
//+------------------------------------------------------------------+
#property strict

// contexto da detecção atual (preenchido em DetectSignal)
double  g_a = 0, g_avgVol = 0, g_volI = 0, g_slope50 = 0;
int     g_trend = 0;
bool    g_hasH = false, g_hasL = false;
XPivot  g_lastH, g_lastL;
XZone   g_zones[];
double  g_obLo[], g_obHi[];

bool XValid(const double v) { return (v > 0.0 && v < 1.0e9); }

//--- topos e fundos (só quando as N barras seguintes já fecharam)
int FindPivots(const MqlRates &r[], const int nClosed, XPivot &out[], const int N = XR_PIV_N)
{
   ArrayResize(out, 0);
   for(int i = N; i < nClosed - N; i++)
   {
      bool isH = true, isL = true;
      for(int k = i - N; k <= i + N; k++)
      {
         if(k == i) continue;
         if(r[k].high >= r[i].high) isH = false;
         if(r[k].low  <= r[i].low)  isL = false;
      }
      if(isH) { int n = ArraySize(out); ArrayResize(out, n + 1); out[n].i = i; out[n].kind = 1;  out[n].price = r[i].high; }
      if(isL) { int n = ArraySize(out); ArrayResize(out, n + 1); out[n].i = i; out[n].kind = -1; out[n].price = r[i].low; }
   }
   return ArraySize(out);
}

//--- tendência pelos dois últimos topos e fundos
int Structure(const XPivot &piv[], bool &hasH, XPivot &lastH, bool &hasL, XPivot &lastL)
{
   hasH = false; hasL = false;
   double h1 = 0, h2 = 0, l1 = 0, l2 = 0; int nh = 0, nl = 0;
   for(int k = ArraySize(piv) - 1; k >= 0 && (nh < 2 || nl < 2); k--)
   {
      if(piv[k].kind == 1 && nh < 2)  { if(nh == 0) { h2 = piv[k].price; lastH = piv[k]; hasH = true; } else h1 = piv[k].price; nh++; }
      if(piv[k].kind == -1 && nl < 2) { if(nl == 0) { l2 = piv[k].price; lastL = piv[k]; hasL = true; } else l1 = piv[k].price; nl++; }
   }
   if(nh < 2 || nl < 2) return 0;
   if(h2 > h1 && l2 > l1) return 1;
   if(h2 < h1 && l2 < l1) return -1;
   return 0;
}

//--- zonas de suporte/resistência: agrupa pivôs (tolerância 0,7 ATR e largura máx. 1,5 ATR), 2+ toques
int BuildZones(const XPivot &piv[], const double a, XZone &zones[])
{
   ArrayResize(zones, 0);
   int np = ArraySize(piv), start = MathMax(0, np - 40), m = np - start;
   if(m < 2) return 0;
   double pr[]; int ix[];
   ArrayResize(pr, m); ArrayResize(ix, m);
   for(int k = 0; k < m; k++) { pr[k] = piv[start + k].price; ix[k] = piv[start + k].i; }
   for(int p = 1; p < m; p++)                       // ordena por preço (inserção)
   {
      double vp = pr[p]; int vi = ix[p]; int q = p - 1;
      while(q >= 0 && pr[q] > vp) { pr[q + 1] = pr[q]; ix[q + 1] = ix[q]; q--; }
      pr[q + 1] = vp; ix[q + 1] = vi;
   }
   int g0 = 0, cnt = 1; double sum = pr[0];
   for(int k = 1; k <= m; k++)
   {
      bool joins = false;
      if(k < m) joins = ((pr[k] - sum / cnt) <= 0.7 * a) && ((pr[k] - pr[g0]) <= 1.5 * a);
      if(joins) { sum += pr[k]; cnt++; continue; }
      if(cnt >= 2)
      {
         double lo = pr[g0], hi = pr[k - 1], mid = (lo + hi) / 2.0; int last = 0;
         for(int q = g0; q < k; q++) last = MathMax(last, ix[q]);
         if(hi - lo < 0.3 * a) { lo = mid - 0.15 * a; hi = mid + 0.15 * a; }
         int n = ArraySize(zones); ArrayResize(zones, n + 1);
         zones[n].lo = lo; zones[n].hi = hi; zones[n].mid = mid; zones[n].touches = cnt; zones[n].last = last;
      }
      g0 = k; if(k < m) { sum = pr[k]; cnt = 1; }
   }
   return ArraySize(zones);
}

//--- padrão de candle: +1 comprador, -1 vendedor, 0 nenhum
int CandlePattern(const MqlRates &r[], const int i, string &name)
{
   name = "";
   double rng = r[i].high - r[i].low;
   if(i < 1 || rng <= 0) return 0;
   double o = r[i].open, c = r[i].close, po = r[i - 1].open, pc = r[i - 1].close;
   double body = MathAbs(c - o), pbody = MathAbs(pc - po);
   double upW = r[i].high - MathMax(o, c), loW = MathMin(o, c) - r[i].low;
   if(c > o && pc < po && c >= po && o <= pc && body > pbody) { name = "Engolfo de alta"; return 1; }
   if(c < o && pc > po && c <= po && o >= pc && body > pbody) { name = "Engolfo de baixa"; return -1; }
   if(loW >= 2 * MathMax(body, 0.05 * rng) && loW >= 0.55 * rng && c >= r[i].low + 0.6 * rng)  { name = "Martelo"; return 1; }
   if(upW >= 2 * MathMax(body, 0.05 * rng) && upW >= 0.55 * rng && c <= r[i].high - 0.6 * rng) { name = "Estrela cadente"; return -1; }
   return 0;
}

//--- alvo: antes do obstáculo mais próximo; sem obstáculo = 2R projetado. false = caminho bloqueado
bool CalcTarget(const int side, const double entry, const double risk, double &tgt, bool &proj)
{
   int n = ArraySize(g_obLo);
   if(side > 0)
   {
      double best = DBL_MAX;
      for(int k = 0; k < n; k++) if(g_obLo[k] > entry + 0.3 * g_a) best = MathMin(best, g_obLo[k]);
      if(best < DBL_MAX) { tgt = best - 0.1 * g_a; proj = false; return ((tgt - entry) / risk >= XR_MIN_RR_ZONE); }
      tgt = entry + 2 * risk; proj = true; return true;
   }
   double best = -DBL_MAX;
   for(int k = 0; k < n; k++) if(g_obHi[k] < entry - 0.3 * g_a) best = MathMax(best, g_obHi[k]);
   if(best > -DBL_MAX) { tgt = best + 0.1 * g_a; proj = false; return ((entry - tgt) / risk >= XR_MIN_RR_ZONE); }
   tgt = entry - 2 * risk; proj = true; return true;
}

void AddCand(XSignal &cands[], const int side, const string setup, const double entry, const double stop0,
             const int touches, const string why, const bool strong, const double level)
{
   double risk = MathMax(MathAbs(entry - stop0), 0.4 * g_a);
   if(risk > XR_MAX_RISK_ATR * g_a) return;
   double stop = (side > 0) ? entry - risk : entry + risk;
   double tgt; bool proj;
   if(InpRRMode == 1) { tgt = (side > 0) ? entry + InpFixedRR * risk : entry - InpFixedRR * risk; proj = true; }   // relação fixa (ex.: 1:3)
   else if(!CalcTarget(side, entry, risk, tgt, proj)) return;
   double rr = MathAbs(tgt - entry) / risk;
   int score = 0; string reasons = why;
   bool aligned = (g_trend > 0 && side > 0) || (g_trend < 0 && side < 0);
   if(aligned) { score++; reasons += " | a favor da estrutura"; }
   else if(g_trend != 0) reasons += " | CONTRA a estrutura";
   if(touches >= 3) { score++; reasons += StringFormat(" | zona testada %dx", touches); }
   if(g_volI >= 1.2 * g_avgVol) { score++; reasons += " | volume acima da média"; }
   if(rr >= 2.0) { score++; reasons += StringFormat(" | R:R %.1f", rr); }
   if((g_slope50 > 0 && side > 0) || (g_slope50 < 0 && side < 0)) { score++; reasons += " | EMA50 a favor"; }
   if(strong) score++;
   XSignal s;
   s.valid = true; s.side = side; s.setup = setup; s.price = entry; s.stop = stop; s.target = tgt;
   s.rr = rr; s.projected = proj; s.score = score; s.reasons = reasons; s.level = level; s.atr = g_a;
   int n = ArraySize(cands); ArrayResize(cands, n + 1); cands[n] = s;
}

//--- procura a melhor entrada no candle FECHADO i (índice cronológico)
bool DetectSignal(const int i, const MqlRates &r[], const double &atr[], const double &e21[], const double &e50[],
                  const XPivot &piv[], XSignal &best)
{
   best.valid = false;
   if(i < XR_MIN_I) return false;
   g_a = atr[i];
   if(!XValid(g_a) || !XValid(e50[i]) || !XValid(e50[i - 10]) || !XValid(e21[i])) return false;

   g_trend = Structure(piv, g_hasH, g_lastH, g_hasL, g_lastL);
   BuildZones(piv, g_a, g_zones);
   int nz = ArraySize(g_zones), no = nz + (g_hasH ? 1 : 0) + (g_hasL ? 1 : 0);
   ArrayResize(g_obLo, no); ArrayResize(g_obHi, no);
   int q = 0;
   for(int k = 0; k < nz; k++) { g_obLo[q] = g_zones[k].lo; g_obHi[q] = g_zones[k].hi; q++; }
   if(g_hasH) { g_obLo[q] = g_lastH.price; g_obHi[q] = g_lastH.price; q++; }
   if(g_hasL) { g_obLo[q] = g_lastL.price; g_obHi[q] = g_lastL.price; q++; }

   double sv = 0; for(int k = i - 20; k < i; k++) sv += (double)r[k].tick_volume;
   g_avgVol = sv / 20.0; g_volI = (double)r[i].tick_volume;
   {  // candle em formação tem só parte do volume: projeta para o candle inteiro (mínimo 25% do tempo decorrido, para não explodir no começo)
      int per = PeriodSeconds(g_tf); long el = (long)(TimeCurrent() - r[i].time);
      if(per > 0 && el >= 0 && el < per) g_volI = g_volI * (double)per / (double)MathMax(el, per / 4);
   }
   g_slope50 = e50[i] - e50[i - 10];

   double a = g_a, o = r[i].open, h = r[i].high, l = r[i].low, c = r[i].close;
   double rng = h - l, body = MathAbs(c - o);
   string pname; int pat = CandlePattern(r, i, pname);
   XSignal cands[];

   //--- 1) rompimento
   if(InpUseBreakout)
   {
      for(int z = 0; z < nz; z++)
      {
         double zlo = g_zones[z].lo, zhi = g_zones[z].hi; int tz = g_zones[z].touches;
         if(!InpBreakoutRetest)
         {
            if(c > o && c > zhi + 0.1 * a && r[i - 1].close <= zhi + 0.1 * a && body >= 0.6 * rng && body >= 0.8 * a)
               AddCand(cands, 1, "Rompimento", c, zlo - 0.2 * a, tz, StringFormat("fechou acima da zona %.2f-%.2f", zlo, zhi), true, zhi);
            if(c < o && c < zlo - 0.1 * a && r[i - 1].close >= zlo - 0.1 * a && body >= 0.6 * rng && body >= 0.8 * a)
               AddCand(cands, -1, "Rompimento", c, zhi + 0.2 * a, tz, StringFormat("fechou abaixo da zona %.2f-%.2f", zlo, zhi), true, zlo);
         }
         else
         {
            for(int k = 2; k < 8; k++)
            {
               int j = i - k; if(j < 1) break;
               double bj = MathAbs(r[j].close - r[j].open), rj = r[j].high - r[j].low;
               bool strong = (rj > 0 && bj >= 0.6 * rj && bj >= 0.8 * a);
               if(strong && r[j].close > r[j].open && r[j].close > zhi + 0.1 * a && r[j - 1].close <= zhi + 0.1 * a)
               {
                  bool held = true; for(int m = j + 1; m < i; m++) if(r[m].close <= zlo) held = false;
                  if(held && l <= zhi + 0.2 * a && c > zhi && c > o)
                     AddCand(cands, 1, "Reteste de rompimento", c, MathMin(l, zlo) - 0.2 * a, tz, StringFormat("rompeu %.2f-%.2f ha %d candles e o reteste segurou", zlo, zhi, k), true, zhi);
                  break;
               }
               if(strong && r[j].close < r[j].open && r[j].close < zlo - 0.1 * a && r[j - 1].close >= zlo - 0.1 * a)
               {
                  bool held = true; for(int m = j + 1; m < i; m++) if(r[m].close >= zhi) held = false;
                  if(held && h >= zlo - 0.2 * a && c < zlo && c < o)
                     AddCand(cands, -1, "Reteste de rompimento", c, MathMax(h, zhi) + 0.2 * a, tz, StringFormat("rompeu %.2f-%.2f ha %d candles e o reteste segurou", zlo, zhi, k), true, zlo);
                  break;
               }
            }
         }
      }
   }

   //--- 2) rejeição em zona
   if(InpUseRejection && pat != 0)
   {
      int bz = -1, bt = -1;
      for(int z = 0; z < nz; z++)
      {
         bool ok = (pat > 0) ? (l <= g_zones[z].hi + 0.15 * a && c >= g_zones[z].lo && g_zones[z].mid < c)
                             : (h >= g_zones[z].lo - 0.15 * a && c <= g_zones[z].hi && g_zones[z].mid > c);
         if(ok && g_zones[z].touches > bt) { bt = g_zones[z].touches; bz = z; }
      }
      if(bz >= 0)
      {
         if(pat > 0) AddCand(cands, 1, "Rejeicao em suporte", c, MathMin(l, g_zones[bz].lo) - 0.25 * a, bt,
                             StringFormat("%s no suporte %.2f-%.2f", pname, g_zones[bz].lo, g_zones[bz].hi), false, g_zones[bz].lo);
         else        AddCand(cands, -1, "Rejeicao em resistencia", c, MathMax(h, g_zones[bz].hi) + 0.25 * a, bt,
                             StringFormat("%s na resistencia %.2f-%.2f", pname, g_zones[bz].lo, g_zones[bz].hi), false, g_zones[bz].hi);
      }
   }

   //--- 3) pullback na tendência
   if(InpUsePullback)
   {
      if(g_trend > 0 && g_hasL && l > g_lastL.price && c > o && c > e50[i] && l <= e21[i] + 0.3 * a && c > e21[i] && (MathMin(o, c) - l) >= 0.3 * rng)
         AddCand(cands, 1, "Pullback na tendencia", c, MathMin(l, g_lastL.price) - 0.25 * a, 2, "retorno a EMA21 em tendencia de alta", false, g_lastL.price);
      if(g_trend < 0 && g_hasH && h < g_lastH.price && c < o && c < e50[i] && h >= e21[i] - 0.3 * a && c < e21[i] && (h - MathMax(o, c)) >= 0.3 * rng)
         AddCand(cands, -1, "Pullback na tendencia", c, MathMax(h, g_lastH.price) + 0.25 * a, 2, "retorno a EMA21 em tendencia de baixa", false, g_lastH.price);
   }

   int nc = ArraySize(cands);
   if(nc == 0) return false;
   int bi = 0;
   for(int k = 1; k < nc; k++)
      if(cands[k].score > cands[bi].score || (cands[k].score == cands[bi].score && cands[k].rr > cands[bi].rr)) bi = k;
   best = cands[bi];
   return true;
}
