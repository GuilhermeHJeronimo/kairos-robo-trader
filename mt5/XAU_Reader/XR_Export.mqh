//+------------------------------------------------------------------+
//| XR_Export.mqh - exporta candles de 1 minuto sob demanda          |
//| O app Python pede (XAU_Reader_barsreq.json) para desenhar o      |
//| gráfico de cada trade no diário. Só leitura de histórico.        |
//+------------------------------------------------------------------+
#ifndef XR_EXPORT_MQH
#define XR_EXPORT_MQH

long g_expLast = 0;

void PollExport()
{
   string t = ReadTextFile("XAU_Reader_barsreq.json");
   if(t == "") return;
   long id = (long)JNum(t, "id");
   if(id <= g_expLast) return;
   g_expLast = id;
   datetime from = (datetime)(long)JNum(t, "from"), to = (datetime)(long)JNum(t, "to");
   string raw = JStr(t, "name"), name = "";
   for(int k = 0; k < StringLen(raw); k++)
   {
      ushort c = StringGetCharacter(raw, k);
      if((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_') name += ShortToString(c);
   }
   if(name == "" || to <= from || to - from > 3 * 86400) { Journal("EXPORT", "pedido invalido ignorado"); return; }
   MqlRates r[];
   int n = CopyRates(_Symbol, PERIOD_M1, from, to, r);
   string tmp = "XAU_Reader_bars_" + name + ".tmp", dst = "XAU_Reader_bars_" + name + ".csv";
   int h = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) { Journal("EXPORT", "nao abriu arquivo " + tmp); return; }
   FileWriteString(h, "time;open;high;low;close;vol\n");
   for(int k = 0; k < n && k < 4000; k++)
      FileWriteString(h, StringFormat("%I64d;%.2f;%.2f;%.2f;%.2f;%I64d\n", (long)r[k].time, r[k].open, r[k].high, r[k].low, r[k].close, r[k].tick_volume));
   FileClose(h);
   FileMove(tmp, 0, dst, FILE_REWRITE);
   Journal("EXPORT", StringFormat("%s: %d candles M1", name, n));
}

#endif
