//+------------------------------------------------------------------+
//| XR_Hierarchy.mqh - hierarquia de análise (teoria de Dow)         |
//|                                                                  |
//|  Primária   (padrão: mensal)  - dura meses/anos: direção principal|
//|  Secundária (padrão: semanal) - correções da primária            |
//|  Terciária  (padrão: diário)  - movimentos de curto prazo        |
//|                                                                  |
//| Regra: a operação só é permitida se for a favor da direção       |
//| principal E se pelo menos InpHierLevels níveis (contando a       |
//| primária) apontarem para o mesmo lado. Com 2 níveis, uma         |
//| correção semanal contra a primária é aceita quando o diário já   |
//| voltou a favor (correção terminando).                            |
//| Cada nível usa só barras FECHADAS.                               |
//+------------------------------------------------------------------+
#property strict

struct XLevel { ENUM_TIMEFRAMES tf; datetime barTime; int trend; string how; int bars; };
XLevel g_lv[3];

string TfName(const ENUM_TIMEFRAMES tf) { return StringSubstr(EnumToString(tf), 7); }
string TrendName(const int t) { return t > 0 ? "ALTA" : t < 0 ? "BAIXA" : "SEM DIRECAO"; }

double EmaOfCloses(const MqlRates &r[], const int n, const int period)
{
   if(n < period) return 0;
   double sum = 0; for(int k = 0; k < period; k++) sum += r[k].close;
   double e = sum / period, a = 2.0 / (period + 1.0);
   for(int k = period; k < n; k++) e = r[k].close * a + e * (1.0 - a);
   return e;
}

//--- monta barras semanais (kind=1) ou mensais (kind=2) a partir das diárias (histórico diário é bem mais longo que o gerado pelo Testador)
int AggregateFromD1(const MqlRates &d[], const int n, const int kind, MqlRates &out[])
{
   ArrayResize(out, 0);
   long lastKey = -1;
   for(int i = 0; i < n; i++)
   {
      MqlDateTime dt; TimeToStruct(d[i].time, dt);
      long key = (kind == 2) ? (long)dt.year * 100 + dt.mon : (long)(((long)d[i].time / 86400 + 3) / 7);   // semana começando na segunda
      if(key != lastKey)
      {
         int m = ArraySize(out); ArrayResize(out, m + 1); out[m] = d[i]; lastKey = key;
      }
      else
      {
         int m = ArraySize(out) - 1;
         out[m].high = MathMax(out[m].high, d[i].high); out[m].low = MathMin(out[m].low, d[i].low); out[m].close = d[i].close;
      }
   }
   return ArraySize(out);
}

//--- tendência de um nível: topos e fundos (2 barras de cada lado); se indefinida, EMA 21/50
int LevelTrend(const int idx, const ENUM_TIMEFRAMES tf)
{
   bool agg = (tf == PERIOD_MN1 || tf == PERIOD_W1);                 // mensal/semanal saem do diário
   datetime bt = agg ? iTime(_Symbol, PERIOD_D1, 0) : iTime(_Symbol, tf, 0);
   if(bt != 0 && g_lv[idx].tf == tf && g_lv[idx].barTime == bt) return g_lv[idx].trend;   // cache: só recalcula quando abre um candle novo
   MqlRates r[];
   int n = 0; string src = "nativo";
   if(agg)
   {
      MqlRates d[];
      int nd = CopyRates(_Symbol, PERIOD_D1, 0, 3500, d);
      if(nd >= 300) { n = AggregateFromD1(d, nd, tf == PERIOD_MN1 ? 2 : 1, r); src = "agregado do diario"; }
   }
   if(n < 20) { n = CopyRates(_Symbol, tf, 0, 150, r); src = "nativo"; }
   int trend = 0; string how = "sem dados";
   if(n >= 20)
   {
      int nc = n - 1;                                  // descarta a barra em formação
      XPivot piv[]; bool hH, hL; XPivot lH, lL;
      FindPivots(r, nc, piv, 2);
      trend = Structure(piv, hH, lH, hL, lL);
      how = "topos e fundos";
      if(trend == 0)
      {
         double e21 = EmaOfCloses(r, nc, 21), e50 = EmaOfCloses(r, nc, 50), c = r[nc - 1].close;
         how = "medias 21/50";
         if(e21 > 0 && e50 > 0)
         {
            if(c > e21 && e21 > e50) trend = 1;
            else if(c < e21 && e21 < e50) trend = -1;
         }
         else how = "sem barras para as medias";
      }
   }
   g_lv[idx].tf = tf; g_lv[idx].barTime = bt; g_lv[idx].trend = trend; g_lv[idx].bars = n;
   g_lv[idx].how = StringFormat("%s, %s, %d barras", how, src, n);
   return trend;
}

//--- resultado para um lado (+1 compra, -1 venda); txt descreve os três níveis e o veredito
bool HierarchyAllows(const int side, string &txt)
{
   int p = LevelTrend(0, InpHierPrimaryTF), s = LevelTrend(1, InpHierSecondaryTF), t = LevelTrend(2, InpHierTertiaryTF);
   int dir = (p != 0) ? p : (s != 0 ? s : t);           // sem primária definida, segue o nível seguinte
   string d = StringFormat("primaria %s=%s | secundaria %s=%s%s | terciaria %s=%s",
                           TfName(InpHierPrimaryTF), TrendName(p),
                           TfName(InpHierSecondaryTF), TrendName(s), (p != 0 && s == -p) ? " (correcao)" : "",
                           TfName(InpHierTertiaryTF), TrendName(t));
   if(dir == 0) { txt = d + " | sem direcao definida em nenhum nivel"; return false; }
   int aligned = (p == side ? 1 : 0) + (s == side ? 1 : 0) + (t == side ? 1 : 0);
   string sd = side > 0 ? "compra" : "venda";
   if(side != dir) { txt = StringFormat("%s | %s contra a direcao principal (%s)", d, sd, TrendName(dir)); return false; }
   if(aligned < InpHierLevels) { txt = StringFormat("%s | %s com so %d de %d niveis alinhados (minimo %d)", d, sd, aligned, 3, InpHierLevels); return false; }
   txt = StringFormat("%s | %s permitida (%d de 3 niveis alinhados)", d, sd, aligned);
   return true;
}
