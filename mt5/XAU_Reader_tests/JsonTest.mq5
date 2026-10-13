//+------------------------------------------------------------------+
//| JsonTest.mq5 - confere o leitor de JSON do robô com o JSON exato |
//| que o painel (Python) grava. Rodar no Testador de Estratégia.    |
//+------------------------------------------------------------------+
#property version "1.00"
#include "..\XAU_Reader\XR_Json.mqh"

int fails = 0;
void Expect(const string name, const string got, const string want)
{
   bool ok = (got == want);
   if(!ok) fails++;
   Print("[JSONTEST] ", ok ? "ok    " : "FALHOU", " | ", name, " | obtido='", got, "' esperado='", want, "'");
}

int OnInit()
{
   // formato do json.dumps padrão (com espaços) e do compacto
   string a = "{\"id\": 1790786777651, \"cmd\": \"pause\", \"ts\": 1790786777}";
   string b = "{\"id\":1790786777651,\"cmd\":\"close_all\",\"ts\":1790786777}";
   Expect("cmd (com espacos)", JStr(a, "cmd"), "pause");
   Expect("cmd (compacto)", JStr(b, "cmd"), "close_all");
   Expect("id (com espacos)", StringFormat("%I64d", (long)JNum(a, "id")), "1790786777651");
   Expect("id (compacto)", StringFormat("%I64d", (long)JNum(b, "id")), "1790786777651");
   Expect("ts", StringFormat("%I64d", (long)JNum(a, "ts")), "1790786777");
   string s = "{\"score\": -10, \"label\": \"neutro\", \"epoch_utc\": 1790786933, \"updated\": \"2026-09-30 13:48:54\", \"n_headlines\": 28}";
   Expect("score negativo", IntegerToString((int)JNum(s, "score")), "-10");
   Expect("label", JStr(s, "label"), "neutro");
   Expect("epoch_utc", StringFormat("%I64d", (long)JNum(s, "epoch_utc")), "1790786933");
   Expect("chave ausente (texto)", JStr(s, "nao_existe"), "");
   Expect("chave ausente (numero)", DoubleToString(JNum(s, "nao_existe"), 1), "0.0");
   Expect("valor numerico lido como texto", JStr(s, "score"), "");
   // ida e volta por arquivo
   int h = FileOpen("jsontest.json", FILE_WRITE | FILE_TXT | FILE_ANSI);
   FileWriteString(h, "{\"id\": 42, \"cmd\": \"resume\"}"); FileClose(h);
   string r = ReadTextFile("jsontest.json");
   Expect("arquivo: cmd", JStr(r, "cmd"), "resume");
   Expect("arquivo: id", IntegerToString((int)JNum(r, "id")), "42");
   Expect("arquivo inexistente", ReadTextFile("arquivo_que_nao_existe.json"), "");
   Print("[JSONTEST] RESULTADO: ", fails == 0 ? "TODOS OS TESTES PASSARAM" : IntegerToString(fails) + " FALHA(S)");
   return INIT_SUCCEEDED;
}
void OnTick() {}
