//+------------------------------------------------------------------+
//| XR_Verify.mqh - decisão em duas etapas e registro de motivos     |
//|                                                                  |
//| ETAPA 1 (análise): setup do leitor + hierarquia + confirmações + |
//|   notícias + sentimento + travas. Precisa passar em TODAS as     |
//|   verificações obrigatórias e atingir a certeza mínima.          |
//| ETAPA 2 (verificação ao vivo): o sinal precisa se sustentar por  |
//|   InpVerifySecs segundos no PREÇO de mercado: sem perseguir o    |
//|   preço, sem invalidar, R:R ao vivo, spread e nível estrutural.  |
//|                                                                  |
//| Toda decisão (entrou ou não) grava um evento DECISAO com a lista |
//| de verificações e os motivos.                                    |
//+------------------------------------------------------------------+
#property strict

struct XCheck { string name; bool ok; bool mandatory; string detail; };
XCheck g_ck[];

struct XPend
{
   bool     active;
   XSignal  sig;
   datetime t0;
   string   confText;
   string   stage1;
   string   stage1Ck;
   int      certainty;
   datetime barTime;
};
XPend    g_pend;

string   g_lastDecisionKey = "", g_lastDecisionText = "", g_lastDecisionTime = "", g_lastDecisionResult = "";
int      g_lastDecisionStage = 0;
datetime g_lastEntryBar = 0;

void CkClear() { ArrayResize(g_ck, 0); }

void CkAdd(const string name, const bool ok, const bool mandatory, const string detail)
{
   int n = ArraySize(g_ck); ArrayResize(g_ck, n + 1);
   g_ck[n].name = name; g_ck[n].ok = ok; g_ck[n].mandatory = mandatory; g_ck[n].detail = detail;
}

bool CkMandatoryOk() { for(int k = 0; k < ArraySize(g_ck); k++) if(g_ck[k].mandatory && !g_ck[k].ok) return false; return true; }

int CkCertainty()
{
   int n = ArraySize(g_ck), ok = 0;
   if(n == 0) return 0;
   for(int k = 0; k < n; k++) if(g_ck[k].ok) ok++;
   return (int)MathRound(100.0 * ok / n);
}

string Clean(const string s)                          // sem separadores do formato do diário
{
   string r = s;
   StringReplace(r, ";", ","); StringReplace(r, "|", "/"); StringReplace(r, ":", " -"); StringReplace(r, "\"", "'");
   return r;
}

//--- "nome:ok:detalhe;nome:FALHOU:detalhe" (o painel lê este formato)
string CkText()
{
   string t = "";
   for(int k = 0; k < ArraySize(g_ck); k++)
      t += (k > 0 ? ";" : "") + Clean(g_ck[k].name) + ":" + (g_ck[k].ok ? "ok" : (g_ck[k].mandatory ? "FALHOU" : "fraco")) + ":" + Clean(g_ck[k].detail);
   return t;
}

string CkFailedText()
{
   string t = "";
   for(int k = 0; k < ArraySize(g_ck); k++)
      if(!g_ck[k].ok && g_ck[k].mandatory) t += (t == "" ? "" : "; ") + g_ck[k].name + " (" + g_ck[k].detail + ")";
   return t;
}

string CkWeakText()                                   // verificações informativas que não passaram
{
   string t = "";
   for(int k = 0; k < ArraySize(g_ck); k++)
      if(!g_ck[k].ok && !g_ck[k].mandatory) t += (t == "" ? "" : "; ") + g_ck[k].name + " (" + g_ck[k].detail + ")";
   return t == "" ? "nenhum" : t;
}

string CkOkNames()
{
   string t = "";
   for(int k = 0; k < ArraySize(g_ck); k++) if(g_ck[k].ok) t += (t == "" ? "" : ", ") + g_ck[k].name;
   return t;
}

double ObstacleDistance(const int side, const double price)   // distância até o obstáculo mais próximo à frente
{
   double best = DBL_MAX; int n = ArraySize(g_obLo);
   for(int k = 0; k < n; k++)
   {
      if(side > 0 && g_obLo[k] > price + 0.3 * g_a) best = MathMin(best, g_obLo[k] - price);
      if(side < 0 && g_obHi[k] < price - 0.3 * g_a) best = MathMin(best, price - g_obHi[k]);
   }
   return best;
}

//--- registra a decisão (só quando muda, para não lotar o diário no modo tempo real)
void Decide(const string result, const int stage, const XSignal &s, const string explain, const bool force = false, const string extraCk = "")
{
   string side = (s.side > 0) ? "COMPRA" : "VENDA";
   string key = StringFormat("%s|%d|%s|%s|%s|%s", result, stage, side, s.setup, CkFailedText(), TimeToString(g_pend.barTime));
   g_lastDecisionText = explain;
   g_lastDecisionResult = result; g_lastDecisionStage = stage;
   g_lastDecisionTime = TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS);
   if(!force && key == g_lastDecisionKey) return;
   g_lastDecisionKey = key;
   Journal("DECISAO", StringFormat("%s|etapa=%d|lado=%s|setup=%s|certeza=%d|checks=%s|resumo=%s",
           result, stage, side, Clean(s.setup), CkCertainty(), CkText() + (extraCk != "" ? ";" + extraCk : ""), Clean(explain)));
}

void PendClear() { g_pend.active = false; }

//--- ETAPA 2: chamado a cada tick enquanto há sinal aguardando verificação
//    retorna true se deve abrir a ordem agora
bool PendTick(string &why)
{
   why = "";
   if(!g_pend.active) return false;
   if(g_paused) { PendClear(); return false; }
   MqlTick t;
   if(!SymbolInfoTick(_Symbol, t)) return false;
   XSignal s = g_pend.sig;
   double p = (s.side > 0) ? t.ask : t.bid;
   double risk = MathAbs(p - s.stop), spread = t.ask - t.bid;
   double tgt = (InpRRMode == 1) ? ((s.side > 0) ? p + InpFixedRR * risk : p - InpFixedRR * risk) : s.target;
   double reward = MathAbs(tgt - p);

   CkClear();
   double moved = (s.side > 0) ? p - s.price : s.price - p;            // >0 = preço andou a favor
   CkAdd("sem perseguir o preco", MathAbs(p - s.price) <= InpMaxChaseATR * s.atr, true,
         StringFormat("preco andou %.2f desde o sinal, limite %.2f (%.1f ATR)", p - s.price, InpMaxChaseATR * s.atr, InpMaxChaseATR));
   bool notInv = (s.side > 0) ? (p > s.stop) : (p < s.stop);
   CkAdd("stop nao violado", notInv, true, StringFormat("preco %.2f, stop %.2f", p, s.stop));
   CkAdd("retorno/risco ao vivo", risk > 0 && reward / risk >= InpMinRR, true, StringFormat("%.2f (minimo %.2f)", risk > 0 ? reward / risk : 0.0, InpMinRR));
   CkAdd("spread e custo", spread <= InpMaxSpread && (risk <= 0 || spread / risk <= InpMaxCostToRisk), true,
         StringFormat("spread %.2f = %.0f%% do risco", spread, risk > 0 ? spread / risk * 100.0 : 0.0));
   if(s.level > 0)
   {
      bool held = (s.side > 0) ? (p > s.level) : (p < s.level);
      CkAdd("nivel estrutural mantido", held, true, StringFormat("nivel %.2f, preco %.2f", s.level, p));
   }
   string nw; bool blk = NewsBlackout(nw);
   CkAdd("sem noticia forte", !blk, InpNewsBlackout, blk ? nw : "livre");
   string rg; bool guards = RiskGuards(rg) && !g_paused;
   CkAdd("travas de risco", guards, true, guards ? "livres" : rg);
   CkAdd("limite de posicoes", OpenPositions() < InpMaxPositions, true, StringFormat("%d de %d abertas", OpenPositions(), InpMaxPositions));

   if(!CkMandatoryOk())
   {
      why = CkFailedText();
      Decide("NAO_ENTROU", 2, s, StringFormat("Nao entrou em %s (%s) na etapa 2 (verificacao ao vivo): %s", (s.side > 0 ? "COMPRA" : "VENDA"), s.setup, why));
      PendClear();
      return false;
   }
   int elapsed = (int)(TimeCurrent() - g_pend.t0);
   if(elapsed < InpVerifySecs) return false;                            // ainda dentro da janela de verificação
   return true;
}

//--- texto para explicar POR QUE entrou (etapa 1 + etapa 2)
string EntryExplanation(const XSignal &s, const string stage1ok)
{
   return StringFormat("Entrou em %s (%s). Motivos do leitor: %s. Etapa 1 aprovou: %s (certeza %d%%). Etapa 2 (%d s ao vivo): %s.",
                       (s.side > 0 ? "COMPRA" : "VENDA"), s.setup, s.reasons, stage1ok, g_pend.certainty, InpVerifySecs, CkOkNames());
}
