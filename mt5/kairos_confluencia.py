"""Aplica a decisão por CONFLUÊNCIA DE INDICADORES no Kairos (Experts\\Kairos): a hierarquia de Dow vira um indicador entre vários e a
operação só segue com 75% ou mais de concordância. Roda uma vez (edita os fontes do Kairos no lugar)."""
import os

D = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL\MQL5\Experts\Kairos"


def rw(f, pairs):
    p = os.path.join(D, f)
    s = open(p, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    s = s.replace("\r\n", "\n")
    for a, b in pairs:
        assert a in s, (f, a[:80])
        s = s.replace(a, b, 1)
    open(p, "w", encoding="utf-8", newline="").write(s.replace("\n", "\r\n") if crlf else s)


# ---------------------------------------------------------------- opções
rw("XR_Inputs.mqh", [(
    "input int    InpMinCertainty      = 60;",
    """input bool   InpUseConfluence     = true;    // Decide pela CONFLUÊNCIA dos indicadores (a hierarquia de Dow é só mais um indicador)
input int    InpMinConfluence     = 75;      // % mínimo dos indicadores (com opinião) que precisam concordar com a operação
input int    InpMinFactors        = 6;       // Mínimo de indicadores com opinião para a confluência valer
input int    InpRsiPeriod         = 14;      // RSI: período
input bool   InpHierMandatory     = false;   // Hierarquia de Dow como REGRA obrigatória (false = só um indicador entre vários)
input int    InpMinCertainty      = 60;      // (em desuso: substituída pela confluência)""")])

# ---------------------------------------------------------------- verificações
rw("XR_Verify.mqh", [
    ("struct XCheck { string name; bool ok; bool mandatory; string detail; };", "struct XCheck { string name; bool ok; bool mandatory; string detail; int vote; };   // vote: 1 a favor, -1 contra, 0 neutro, 2 = não é indicador"),
    ("g_ck[n].name = name; g_ck[n].ok = ok; g_ck[n].mandatory = mandatory; g_ck[n].detail = detail;\n}",
     "g_ck[n].name = name; g_ck[n].ok = ok; g_ck[n].mandatory = mandatory; g_ck[n].detail = detail; g_ck[n].vote = 2;\n}\n\n//--- indicador: voto +1 (a favor), -1 (contra) ou 0 (sem opinião)\nvoid FacAdd(const string name, const int vote, const string detail)\n{\n   int n = ArraySize(g_ck); ArrayResize(g_ck, n + 1);\n   g_ck[n].name = name; g_ck[n].ok = (vote > 0); g_ck[n].mandatory = false; g_ck[n].detail = detail; g_ck[n].vote = vote;\n}\n\nint g_confShown = 0;                                   // última confluência calculada (para o diário)\n\n//--- confluência: % dos indicadores COM opinião que concordam\nint Confluence(int &agree, int &against, int &neutral)\n{\n   agree = 0; against = 0; neutral = 0;\n   for(int k = 0; k < ArraySize(g_ck); k++)\n   {\n      if(g_ck[k].vote == 1) agree++; else if(g_ck[k].vote == -1) against++; else if(g_ck[k].vote == 0) neutral++;\n   }\n   return (agree + against > 0) ? (int)MathRound(100.0 * agree / (agree + against)) : 0;\n}"),
    ('(g_ck[k].ok ? "ok" : (g_ck[k].mandatory ? "FALHOU" : "fraco"))', '(g_ck[k].ok ? "ok" : (g_ck[k].mandatory ? "FALHOU" : (g_ck[k].vote == 0 ? "neutro" : "fraco")))'),
    ('      if(!g_ck[k].ok && !g_ck[k].mandatory) t += (t == "" ? "" : "; ") + g_ck[k].name', '      if(!g_ck[k].ok && !g_ck[k].mandatory && g_ck[k].vote != 0) t += (t == "" ? "" : "; ") + g_ck[k].name'),
    ("Clean(s.setup), CkCertainty(), CkText()", "Clean(s.setup), g_confShown, CkText()"),
])

# ---------------------------------------------------------------- placar de indicadores
open(os.path.join(D, "XR_Board.mqh"), "w", encoding="utf-8", newline="").write(r'''//+------------------------------------------------------------------+
//| XR_Board.mqh - levantamento do mercado: placar de indicadores    |
//|                                                                  |
//| Cada indicador dá um voto para a operação candidata:             |
//|   +1 concorda, -1 discorda, 0 sem opinião (não entra na conta).  |
//| Confluência = concordam / (concordam + discordam). A operação    |
//| só segue com a confluência mínima (padrão 75%). Nenhum           |
//| indicador decide sozinho, nem a hierarquia de Dow.               |
//+------------------------------------------------------------------+
#property strict

double g_rsi[], g_macdM[], g_macdS[];                  // preenchidos a cada avaliação

//--- iSig = candle em análise (em tempo real, o candle em formação)
void BoardEvaluate(const XSignal &sig, const MqlRates &r[], const int iSig, const double &atr[], const double &e21[], const double &e50[],
                   const XContext &c, const string confOk)
{
   int sd = sig.side;
   bool buy = (sd > 0);
   double cl = r[iSig].close;

   // 1) estrutura de mercado do tempo gráfico (topos e fundos)
   FacAdd("estrutura a favor", g_trend == 0 ? 0 : (g_trend == sd ? 1 : -1), g_trend == 0 ? "lateral" : (g_trend > 0 ? "topos e fundos de alta" : "topos e fundos de baixa"));

   // 2) hierarquia de Dow: mensal, semanal e diário (só um voto entre vários)
   int al = 0, ao = 0;
   for(int k = 0; k < 3; k++) { if(g_lv[k].trend == sd) al++; else if(g_lv[k].trend == -sd) ao++; }
   FacAdd("hierarquia forte", al > ao ? 1 : (al < ao ? -1 : 0), StringFormat("%d de 3 niveis a favor (%d contra)", al, ao));

   // 3) médias móveis 21 e 50
   int mv = 0;
   if(e21[iSig] > e50[iSig] && cl > e50[iSig]) mv = 1; else if(e21[iSig] < e50[iSig] && cl < e50[iSig]) mv = -1;
   FacAdd("medias moveis 21/50", mv * sd, StringFormat("EMA21 %.2f, EMA50 %.2f, preco %.2f", e21[iSig], e50[iSig], cl));

   // 4) RSI: momentum a favor sem exaustão, ou repique saindo de sobrevenda/sobrecompra
   double rs = g_rsi[iSig], rp = g_rsi[iSig - 1];
   int rv = 0;
   if(buy) { if(rs >= 50 && rs <= 72) rv = 1; else if(rs < 35 && rs > rp) rv = 1; else if(rs > 75) rv = -1; else if(rs <= 45 && rs < rp) rv = -1; }
   else    { if(rs <= 50 && rs >= 28) rv = 1; else if(rs > 65 && rs < rp) rv = 1; else if(rs < 25) rv = -1; else if(rs >= 55 && rs > rp) rv = -1; }
   FacAdd("RSI " + IntegerToString(InpRsiPeriod), rv, StringFormat("RSI %.1f (%s)", rs, rs > rp ? "subindo" : "caindo"));

   // 5) MACD 12/26/9: linha acima ou abaixo do sinal
   double mh = g_macdM[iSig] - g_macdS[iSig];
   FacAdd("MACD 12/26/9", (mh > 0 ? 1 : (mh < 0 ? -1 : 0)) * sd, StringFormat("histograma %.3f", mh));

   // 6) VWAP do dia
   if(c.hasVwap) FacAdd("VWAP do dia", (cl > c.vwap ? 1 : -1) * sd, StringFormat("preco %.2f, VWAP %.2f", cl, c.vwap));
   else          FacAdd("VWAP do dia", 0, "sem dados");

   // 7) perfil de volume (POC / VAH / VAL) e 8) varredura de liquidez: confirmam quando aparecem
   FacAdd("perfil de volume", StringFind(confOk, "perfil") >= 0 ? 1 : 0, StringFind(confOk, "perfil") >= 0 ? "preco em nivel do perfil" : "longe dos niveis do perfil");
   FacAdd("liquidez varrida", StringFind(confOk, "liquidez") >= 0 ? 1 : 0, StringFind(confOk, "liquidez") >= 0 ? "varreu stops e voltou" : "sem varredura");

   // 9) volume (interesse no movimento; projetado para o candle inteiro)
   double vr = (g_avgVol > 0) ? g_volI / g_avgVol : 0;
   FacAdd("volume acima da media", vr >= 1.0 ? 1 : (vr < 0.7 ? -1 : 0), StringFormat("%.2fx a media", vr));

   // 10) volatilidade: ATR atual contra a média dos últimos 50 candles
   double sum = 0; int cnt = 0;
   for(int k = iSig - 50; k < iSig; k++) if(k >= 0 && atr[k] > 0) { sum += atr[k]; cnt++; }
   double avgAtr = (cnt > 0) ? sum / cnt : 0, ratio = (avgAtr > 0) ? atr[iSig] / avgAtr : 0;
   FacAdd("volatilidade (ATR)", (ratio >= 0.7 && ratio <= 1.8) ? 1 : ((ratio < 0.5 || ratio > 2.5) ? -1 : 0), StringFormat("ATR %.2f = %.2fx a media de 50", atr[iSig], ratio));

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
}
''')

# ---------------------------------------------------------------- robô principal
rw("Kairos.mq5", [
    ('#include "XR_Verify.mqh"', '#include "XR_Verify.mqh"\n#include "XR_Board.mqh"'),
    ("int       hATR = INVALID_HANDLE, hE21 = INVALID_HANDLE, hE50 = INVALID_HANDLE;", "int       hATR = INVALID_HANDLE, hE21 = INVALID_HANDLE, hE50 = INVALID_HANDLE, hRSI = INVALID_HANDLE, hMACD = INVALID_HANDLE;"),
    ("   hE50 = iMA(_Symbol, g_tf, 50, 0, MODE_EMA, PRICE_CLOSE);", "   hE50 = iMA(_Symbol, g_tf, 50, 0, MODE_EMA, PRICE_CLOSE);\n   hRSI = iRSI(_Symbol, g_tf, InpRsiPeriod, PRICE_CLOSE);\n   hMACD = iMACD(_Symbol, g_tf, 12, 26, 9, PRICE_CLOSE);"),
    ("hE50 == INVALID_HANDLE) { Print(", "hE50 == INVALID_HANDLE || hRSI == INVALID_HANDLE || hMACD == INVALID_HANDLE) { Print("),
    ("   if(hE50 != INVALID_HANDLE) IndicatorRelease(hE50);", "   if(hE50 != INVALID_HANDLE) IndicatorRelease(hE50);\n   if(hRSI != INVALID_HANDLE) IndicatorRelease(hRSI);\n   if(hMACD != INVALID_HANDLE) IndicatorRelease(hMACD);"),
    ("   if(CopyBuffer(hATR, 0, 0, n, atr) != n || CopyBuffer(hE21, 0, 0, n, e21) != n || CopyBuffer(hE50, 0, 0, n, e50) != n)",
     "   if(CopyBuffer(hATR, 0, 0, n, atr) != n || CopyBuffer(hE21, 0, 0, n, e21) != n || CopyBuffer(hE50, 0, 0, n, e50) != n ||\n      CopyBuffer(hRSI, 0, 0, n, g_rsi) != n || CopyBuffer(hMACD, 0, 0, n, g_macdM) != n || CopyBuffer(hMACD, 1, 0, n, g_macdS) != n)"),
])

# Stage1 novo
p = os.path.join(D, "Kairos.mq5")
s = open(p, encoding="utf-8", newline="").read()
crlf = "\r\n" in s
s = s.replace("\r\n", "\n")
a = s.index("   CkClear();\n   bool aligned = (g_trend > 0")
b = s.index("//--- procura sinal e decide")
novo = '''   CkClear();
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
   bool riskOk = (InpMaxTotalRiskPct <= 0) || (openRisk + InpRiskPct <= InpMaxTotalRiskPct + 1e-9);
   bool lim = OpenPositions() < InpMaxPositions && riskOk && tr < InpMaxTradesPerDay && consec < EffMaxConsecLosses();
   CkAdd("limites do dia", lim, true, StringFormat("%d/%d posicoes (risco aberto %.2f%% de %.2f%%), %d/%d operacoes, %d/%d perdas seguidas", OpenPositions(), InpMaxPositions, openRisk, InpMaxTotalRiskPct, tr, InpMaxTradesPerDay, consec, EffMaxConsecLosses()));
   int cdLeft = CooldownLeftSecs();
   CkAdd("pausa depois de stop", cdLeft <= 0, InpCooldownMin > 0, cdLeft > 0 ? StringFormat("faltam %d min depois do ultimo stop", (cdLeft + 59) / 60) : "sem stop recente");

   // --- informações do alvo (não entram na confluência)
   double od = ObstacleDistance(sig.side, sig.price);
   CkAdd("caminho livre ate 1,5R", od == DBL_MAX || od >= 1.5 * risk, false, od == DBL_MAX ? "sem zona a frente" : StringFormat("zona a %.2f (1,5R = %.2f)", od, 1.5 * risk));

   // --- LEVANTAMENTO DO MERCADO: placar de indicadores
   BoardEvaluate(sig, r, iSig, atr, e21, e50, g_ctx, okN);
   int agree, against, neutral;
   int pct = Confluence(agree, against, neutral);
   bool enough = (agree + against) >= InpMinFactors;
   bool confOK = !InpUseConfluence || (enough && pct >= InpMinConfluence);
   CkAdd("confluencia dos indicadores", confOK, InpUseConfluence,
         StringFormat("%d%%: %d a favor, %d contra, %d sem opiniao (minimo %d%% com pelo menos %d opinioes)", pct, agree, against, neutral, InpMinConfluence, InpMinFactors));
   g_confShown = pct;
   certainty = pct;
   return CkMandatoryOk();
}

'''
s = s[:a] + novo + s[b:]
# a mensagem de reprovação da etapa 1: mostra a confluência
open(p, "w", encoding="utf-8", newline="").write(s.replace("\n", "\r\n") if crlf else s)

rw("XR_Status.mqh", [('JN(IsGold() ? InpMaxSpread : InpMaxSpreadATRPct)', 'JN(IsGold() ? InpMaxSpread : InpMaxSpreadATRPct) + ",\\"min_confluence\\":" + IntegerToString(InpUseConfluence ? InpMinConfluence : 0)')])
print("confluencia aplicada")
