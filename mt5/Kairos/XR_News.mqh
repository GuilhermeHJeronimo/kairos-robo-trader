//+------------------------------------------------------------------+
//| XR_News.mqh - notícias e sentimento fora do gráfico              |
//|                                                                  |
//| 1) Calendário econômico do próprio MT5 (CalendarValueHistory):   |
//|    janela de bloqueio ao redor de notícias de ALTO impacto (USD).|
//| 2) Sentimento de manchetes: o app web (news.py) grava            |
//|    MQL5\Files\Kairos_<ativo>_sentiment.json e o robô lê. É uma       |
//|    leitura por palavras-chave, NÃO validada em histórico; por    |
//|    isso só serve como veto/confirmação, nunca como gatilho.      |
//+------------------------------------------------------------------+
#property strict

struct XNewsEvt { datetime t; string name; };
XNewsEvt g_evts[6];
int      g_nEvts = 0;
bool     g_calendarOK = false;
datetime g_calLast = 0;

bool     g_sentHas = false;
int      g_sentScore = 0;
string   g_sentLabel = "";
datetime g_sentEpoch = 0, g_sentRead = 0;

//--- atualiza a lista de notícias de alto impacto (a cada 5 minutos)
void RefreshCalendar()
{
   datetime now = TimeCurrent();
   if(g_calLast != 0 && now - g_calLast < 300) return;
   g_calLast = now;
   g_nEvts = 0;
   MqlCalendarValue v[];
   ResetLastError();
   int n = CalendarValueHistory(v, now - (InpNewsAfterMin + 5) * 60, now + 24 * 3600, NULL, "USD");
   g_calendarOK = (n >= 0);
   if(n <= 0) return;
   for(int k = 0; k < n && g_nEvts < 6; k++)
   {
      MqlCalendarEvent ev;
      if(!CalendarEventById(v[k].event_id, ev)) continue;
      if(ev.importance < CALENDAR_IMPORTANCE_HIGH) continue;
      // mantém em ordem de horário
      int pos = g_nEvts;
      while(pos > 0 && g_evts[pos - 1].t > v[k].time) { g_evts[pos] = g_evts[pos - 1]; pos--; }
      g_evts[pos].t = v[k].time; g_evts[pos].name = ev.name;
      g_nEvts++;
   }
}

//--- true = dentro da janela de bloqueio de uma notícia forte
bool NewsBlackout(string &why)
{
   why = "";
   if(!InpNewsBlackout) return false;
   RefreshCalendar();
   datetime now = TimeCurrent();
   for(int k = 0; k < g_nEvts; k++)
      if(now >= g_evts[k].t - InpNewsBeforeMin * 60 && now <= g_evts[k].t + InpNewsAfterMin * 60)
      { why = StringFormat("noticia de alto impacto '%s' as %s", g_evts[k].name, TimeToString(g_evts[k].t, TIME_MINUTES)); return true; }
   return false;
}

//--- lê a nota de sentimento gravada pelo app (a cada 60 s)
void ReadSentiment()
{
   if(InpSentimentMode == 0) return;
   datetime now = TimeCurrent();
   if(g_sentRead != 0 && now - g_sentRead < 60) return;
   g_sentRead = now;
   string s = ReadTextFile(FN("sentiment.json"));
   if(s == "") { g_sentHas = false; return; }
   g_sentScore = (int)JNum(s, "score");
   g_sentLabel = JStr(s, "label");
   g_sentEpoch = (datetime)(long)JNum(s, "epoch_utc");
   g_sentHas = (g_sentEpoch > 0 && (long)TimeGMT() - (long)g_sentEpoch <= (long)InpSentimentMaxAgeMin * 60);
}

//--- o sentimento das manchetes não pode estar extremo CONTRA a operação
bool SentimentAllows(const int side, string &detail)
{
   ReadSentiment();
   if(InpSentimentMode == 0) { detail = "desligado"; return true; }
   if(!g_sentHas) { detail = "sem dado recente (app de noticias desligado): nao vetou"; return true; }
   detail = StringFormat("nota %d (%s)", g_sentScore, g_sentLabel);
   if(side > 0 && g_sentScore <= -InpSentimentVeto) { detail += ": manchetes muito negativas para o ouro contra a compra"; return false; }
   if(side < 0 && g_sentScore >= InpSentimentVeto)  { detail += ": manchetes muito positivas para o ouro contra a venda"; return false; }
   return true;
}

//--- surpresa da agenda: eventos de alto impacto em USD já divulgados nas últimas 3 h. Dado melhor que o esperado para o dólar
//    (impacto positivo) pesa contra ouro e bitcoin; pior que o esperado a favor. Retorna o voto para o lado sd (+1/-1/0).
//    NÃO funciona no Testador (sem calendário) e não foi validada no histórico: é só mais um voto entre vários.
int CalendarSurpriseVote(const int sd, string &txt)
{
   txt = "sem divulgacao relevante nas ultimas 3 h";
   if(MQLInfoInteger(MQL_TESTER)) { txt = "indisponivel no Testador"; return 0; }
   datetime now = TimeCurrent();
   MqlCalendarValue v[];
   if(CalendarValueHistory(v, now - 3 * 3600, now, NULL, "USD") <= 0) return 0;
   int score = 0, n = 0; string names = "";
   for(int k = 0; k < ArraySize(v); k++)
   {
      MqlCalendarEvent ev;
      if(!CalendarEventById(v[k].event_id, ev) || ev.importance < CALENDAR_IMPORTANCE_HIGH || !v[k].HasActualValue()) continue;
      if(v[k].impact_type == CALENDAR_IMPACT_POSITIVE) score--;          // bom para o dólar = ruim para ouro/bitcoin
      else if(v[k].impact_type == CALENDAR_IMPACT_NEGATIVE) score++;
      else continue;
      n++; names += (names == "" ? "" : ", ") + ev.name;
   }
   if(n == 0) return 0;
   int dir = score > 0 ? 1 : (score < 0 ? -1 : 0);
   txt = StringFormat("%d divulgacao(oes) (%s): %s", n, names, dir > 0 ? "a favor de ouro/bitcoin" : (dir < 0 ? "contra ouro/bitcoin" : "empatadas"));
   return dir * sd;
}
