"""Gera Experts\\Kairos a partir de Experts\\XAU_Reader (multi-ativo: ouro e bitcoin). Rodar de novo sempre que o XAU_Reader mudar."""
import os, shutil, re

E = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL\MQL5\Experts"
SRC, DST = os.path.join(E, "XAU_Reader"), os.path.join(E, "Kairos")
os.makedirs(DST, exist_ok=True)
for f in os.listdir(SRC):
    if f.endswith((".mq5", ".mqh")):
        shutil.copy(os.path.join(SRC, f), os.path.join(DST, "Kairos.mq5" if f == "XAU_Reader.mq5" else f))


def rw(f, pairs):
    p = os.path.join(DST, f)
    s = open(p, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    s = s.replace("\r\n", "\n")
    for a, b in pairs:
        assert a in s, (f, a[:70])
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s.replace("\n", "\r\n") if crlf else s)


# --- padrões do Kairos: até 3 posições, risco total aberto limitado a 1,5% (testado: mais entradas sem empilhar risco)
rw("XR_Inputs.mqh", [
    ("input double InpMaxTotalRiskPct  = 0.0;", "input double InpMaxTotalRiskPct  = 1.5;"),
    ("input int    InpMaxPositions      = 1;", "input int    InpMaxPositions      = 3;"),
])

# --- nomes de arquivo por ativo + ajudantes
rw("XR_Inputs.mqh", [
    ("//| XR_Inputs.mqh - parâmetros do robô XAU Reader                    |", "//| XR_Inputs.mqh - parâmetros do robô Kairos (ouro e bitcoin)        |"),
    ("input double InpMaxSpread         = 0.60;    // Spread máximo aceito (US$)",
     "input double InpMaxSpread         = 0.60;    // Ouro: spread máximo aceito (US$)\ninput double InpMaxSpreadATRPct   = 15.0;    // Outros ativos (bitcoin): spread máximo como % do ATR do tempo gráfico"),
])
s = open(os.path.join(DST, "XR_Inputs.mqh"), encoding="utf-8", newline="").read()
nl = "\r\n" if "\r\n" in s else "\n"
s = s.rstrip() + nl + nl + nl.join([
    "//--- nome dos arquivos de comunicação com o painel: um conjunto por ativo (Kairos_<ativo>_status.json etc.)",
    'string FN(const string base) { return "Kairos_" + _Symbol + "_" + base; }',
    'bool   IsGold() { return StringFind(_Symbol, "XAU") >= 0; }',
    'string AssetName() { return IsGold() ? "Ouro" : (StringFind(_Symbol, "BTC") >= 0 ? "Bitcoin" : _Symbol); }',
    "//--- ativos que negociam no fim de semana (bitcoin): a corretora informa sessão no sábado",
    "bool Is24x7()",
    "{",
    "   datetime a, b;",
    "   return SymbolInfoSessionTrade(_Symbol, SATURDAY, 0, a, b) && b > a;",
    "}",
    "//--- spread máximo: valor fixo no ouro, % do ATR nos demais",
    "double MaxSpreadEff(const double atr) { return IsGold() ? InpMaxSpread : (atr > 0 ? InpMaxSpreadATRPct / 100.0 * atr : InpMaxSpread); }",
    "",
])
open(os.path.join(DST, "XR_Inputs.mqh"), "w", encoding="utf-8", newline="").write(s)

rw("XR_Control.mqh", [('"XAU_Reader_cmd.json"', 'FN("cmd.json")'), ("MQL5\\Files\\XAU_Reader_cmd.json", "MQL5\\Files\\Kairos_<ativo>_cmd.json")])
rw("XR_Export.mqh", [('"XAU_Reader_barsreq.json"', 'FN("barsreq.json")'), ('"XAU_Reader_bars_" + name + ".tmp", dst = "XAU_Reader_bars_" + name + ".csv"', 'FN("bars_" + name + ".tmp"), dst = FN("bars_" + name + ".csv")'),
                     ("(XAU_Reader_barsreq.json)", "(Kairos_<ativo>_barsreq.json)")])
rw("XR_News.mqh", [('"XAU_Reader_sentiment.json"', 'FN("sentiment.json")'), ("MQL5\\Files\\XAU_Reader_sentiment.json", "MQL5\\Files\\Kairos_<ativo>_sentiment.json")])
rw("XR_Status.mqh", [('"XAU_Reader_status.tmp", dst = "XAU_Reader_status.json"', 'FN("status.tmp"), dst = FN("status.json")'),
                     ('\\"version\\":\\"1.6\\"', '\\"version\\":\\"2.0\\",\\"robot\\":\\"Kairos\\",\\"symbol\\":\\"" + _Symbol + "\\",\\"asset\\":\\"" + AssetName() + "\\",\\"h24\\":" + JB(Is24x7()) + "'),
                     ("JN(InpMaxSpread)", "JN(IsGold() ? InpMaxSpread : InpMaxSpreadATRPct)")])
rw("XR_Risk.mqh", [
    ('FileOpen("XAU_Reader_journal.csv"', 'FileOpen(FN("journal.csv")'),
    ("MQL5\\Files\\XAU_Reader_journal.csv", "MQL5\\Files\\Kairos_<ativo>_journal.csv"),
    ('Alert("XAU Reader: trava', 'Alert("Kairos: trava'),
    ('"XAUR " + s.setup', '"KAIROS " + s.setup'),
    ("   if(spread > InpMaxSpread) { why = StringFormat(\"spread %.2f acima do maximo %.2f\", spread, InpMaxSpread); return false; }",
     "   double maxSp = MaxSpreadEff(s.atr);\n   if(spread > maxSp) { why = StringFormat(\"spread %.2f acima do maximo %.2f\", spread, maxSp); return false; }"),
    ('   if(d.day_of_week == 0 || d.day_of_week == 6) { why = "fim de semana"; return false; }\n   if(d.hour < InpStartHour',
     '   bool h24 = Is24x7();                                  // bitcoin: sem fim de semana e sem regra de sexta\n   if(!h24 && (d.day_of_week == 0 || d.day_of_week == 6)) { why = "fim de semana"; return false; }\n   if(d.hour < InpStartHour'),
    ("   if(d.day_of_week == 5)\n   {\n      int nowSec", "   if(!h24 && d.day_of_week == 5)\n   {\n      int nowSec"),
    ("   if(!InpCloseBeforeWeekend || OpenPositions() == 0) return;", "   if(!InpCloseBeforeWeekend || OpenPositions() == 0 || Is24x7()) return;"),
])
rw("XR_Verify.mqh", [("spread <= InpMaxSpread &&", "spread <= MaxSpreadEff(s.atr) &&")])
rw("Kairos.mq5", [
    ("//| XAU_Reader.mq5 - robô de leitura de gráfico para XAU/USD         |", "//| Kairos.mq5 - robô de leitura de gráfico para ouro e bitcoin      |"),
    ('#property description "Leitor de grafico + hierarquia de Dow + decisao em duas etapas para XAU/USD."', '#property description "Kairos: leitor de grafico + hierarquia de Dow + decisao em duas etapas (ouro e bitcoin)."'),
    ('"XAU Reader BLOQUEADO', '"Kairos BLOQUEADO'),
    ('   if(StringFind(_Symbol, "XAU") < 0) Print("[XAUR] AVISO: este robo foi feito para XAU/USD (na Exness: XAUUSDm); simbolo atual: ", _Symbol);',
     '   if(!IsGold() && StringFind(_Symbol, "BTC") < 0) Print("[KAIROS] AVISO: o robo foi testado so em ouro e bitcoin; simbolo atual: ", _Symbol);'),
    ('"XAU Reader v1.60 | "', '"KAIROS v2.0 | " + AssetName() + " | "'),
    ("   CkAdd(\"spread e custo\", spread <= InpMaxSpread &&", "   CkAdd(\"spread e custo\", spread <= MaxSpreadEff(atr[iSig]) &&"),
    ('#property version   "1.60"', '#property version   "2.00"'),
    ("""   WriteStatus(g_lastNote);
   return INIT_SUCCEEDED;""", """   Journal(\"ESPECIFICACOES\", StringFormat(\"ativo=%s simbolo=%s contrato=%.4f lote_min=%.4f lote_passo=%.4f lote_max=%.2f tick=%.5f valor_tick=%.4f casas=%d stops_level=%d spread_pts=%d sabado=%s\", AssetName(), _Symbol, SymbolInfoDouble(_Symbol, SYMBOL_TRADE_CONTRACT_SIZE), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE), SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS), (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL), (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), Is24x7() ? \"opera\" : \"fechado\"));
   WriteStatus(g_lastNote);
   return INIT_SUCCEEDED;"""),
])
print("Kairos gerado")
