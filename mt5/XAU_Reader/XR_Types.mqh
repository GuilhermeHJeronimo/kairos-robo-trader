//+------------------------------------------------------------------+
//| XR_Types.mqh - estruturas compartilhadas                          |
//+------------------------------------------------------------------+
#property strict

#define XR_PIV_N        3      // barras de cada lado para confirmar topo/fundo
#define XR_MIN_I        60     // histórico mínimo antes de analisar
#define XR_MAX_RISK_ATR 3.0    // stop máximo em ATR
#define XR_MIN_RR_ZONE  1.5    // R:R mínimo exigido pelo leitor

ENUM_TIMEFRAMES g_tf = PERIOD_H1;   // tempo gráfico em uso (o do gráfico, se InpTF = PERIOD_CURRENT)

struct XPivot { int i; int kind; double price; };   // kind: +1 topo, -1 fundo

struct XZone  { double lo; double hi; double mid; int touches; int last; };

struct XSignal
{
   bool   valid;
   int    side;        // +1 compra, -1 venda
   string setup;
   double price;       // referência (fechamento do candle de sinal)
   double stop;
   double target;
   double rr;
   bool   projected;
   int    score;       // fatores de apoio (não validado estatisticamente)
   string reasons;
   double level;       // nível estrutural que sustenta a entrada (borda da zona ou último fundo/topo)
   double atr;         // ATR no momento do sinal
};

struct XContext
{
   bool   hasVwap;   double vwap, u1, l1, u2, l2;
   bool   hasProfile;double poc, vah, val;
   bool   hasFlow;   double flowImb; int flowTicks;
   double volRatio;  // tick volume do último candle / média das últimas 20
};
