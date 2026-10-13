//+------------------------------------------------------------------+
//| XR_Json.mqh - leitura mínima de JSON simples (uma chave por vez) |
//+------------------------------------------------------------------+
#property strict

double JNum(const string s, const string key)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(s, pat);
   if(p < 0) return 0;
   p += StringLen(pat);
   while(p < StringLen(s) && StringGetCharacter(s, p) == ' ') p++;
   int e = p, L = StringLen(s);
   while(e < L)
   {
      ushort c = StringGetCharacter(s, e);
      if((c >= '0' && c <= '9') || c == '-' || c == '.' || c == '+' || c == 'e' || c == 'E') e++; else break;
   }
   return StringToDouble(StringSubstr(s, p, e - p));
}

string JStr(const string s, const string key)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(s, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   int L = StringLen(s);
   while(p < L && StringGetCharacter(s, p) == ' ') p++;          // tolera espaço depois dos dois-pontos
   if(p >= L || StringGetCharacter(s, p) != '"') return "";
   p++;
   int e = StringFind(s, "\"", p);
   if(e < 0) return "";
   return StringSubstr(s, p, e - p);
}

//--- lê um arquivo de texto inteiro de MQL5\Files ("" se não existir)
string ReadTextFile(const string name)
{
   int h = FileOpen(name, FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE) return "";
   string s = "";
   while(!FileIsEnding(h)) s += FileReadString(h);
   FileClose(h);
   return s;
}
