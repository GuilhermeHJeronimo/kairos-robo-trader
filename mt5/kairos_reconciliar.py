r"""Kairos: reconcilia o histórico da conta com o diário. Posições fechadas enquanto o MT5/robô estava desligado (alvo ou stop no servidor)
ou em rajada (trava) não geravam FECHOU; agora o robô confere o histórico ao iniciar e a cada 30 s e grava o que faltou."""
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


# 1) diário com horário informado
rw("XR_Risk.mqh", [(
    r'''void Journal(const string ev, const string msg)
{
   Print("[XAUR] ", ev, " | ", msg);''',
    r'''void JournalAt(const datetime t, const string ev, const string msg)
{
   Print("[XAUR] ", ev, " | ", msg);'''),
    (r'''   FileWriteString(h, TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS) + ";" + ev + ";" + msg + "\r\n");
   FileClose(h);
}''', r'''   FileWriteString(h, TimeToString(t, TIME_DATE | TIME_SECONDS) + ";" + ev + ";" + msg + "\r\n");
   FileClose(h);
}

void Journal(const string ev, const string msg) { JournalAt(TimeCurrent(), ev, msg); }''')])

# 2) lista de posições já registradas + reconciliação
s = open(os.path.join(D, "XR_Track.mqh"), encoding="utf-8", newline="").read()
crlf = "\r\n" in s
s = s.replace("\r\n", "\n")
marca = "#endif"
assert marca in s
novo = r'''
//--- posições cujo FECHOU já está no diário (arquivo Kairos_<ativo>_fechados.txt). Na primeira vez, semeia com o que o diário (e o diário antigo do ouro) já tem.
ulong g_closedIds[];
bool  g_closedLoaded = false;

bool IsClosedLogged(const ulong id) { for(int k = 0; k < ArraySize(g_closedIds); k++) if(g_closedIds[k] == id) return true; return false; }

void MarkClosed(const ulong id)
{
   if(IsClosedLogged(id)) return;
   int n = ArraySize(g_closedIds); ArrayResize(g_closedIds, n + 1); g_closedIds[n] = id;
   int h = FileOpen(FN("fechados.txt"), FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   FileSeek(h, 0, SEEK_END); FileWriteString(h, IntegerToString((long)id) + "\r\n"); FileClose(h);
}

void SeedClosedFrom(const string text)
{
   int p = 0;
   while((p = StringFind(text, ";FECHOU;", p)) >= 0)
   {
      int q = StringFind(text, "pos=", p);
      if(q < 0) break;
      q += 4; int e = q;
      while(e < StringLen(text) && StringGetCharacter(text, e) >= '0' && StringGetCharacter(text, e) <= '9') e++;
      if(e > q) MarkClosed((ulong)StringToInteger(StringSubstr(text, q, e - q)));
      p = e;
   }
}

void ClosedLoad()
{
   if(g_closedLoaded) return;
   g_closedLoaded = true;
   bool had = FileIsExist(FN("fechados.txt"));
   if(had)
   {
      int h = FileOpen(FN("fechados.txt"), FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
      if(h != INVALID_HANDLE)
      {
         while(!FileIsEnding(h)) { string ln = FileReadString(h); StringTrimLeft(ln); StringTrimRight(ln); if(ln != "") { int n = ArraySize(g_closedIds); ArrayResize(g_closedIds, n + 1); g_closedIds[n] = (ulong)StringToInteger(ln); } }
         FileClose(h);
      }
      return;
   }
   SeedClosedFrom(ReadTextFile(FN("journal.csv")));
   if(IsGold()) SeedClosedFrom(ReadTextFile("XAU_Reader_journal.csv"));          // histórico do robô antigo do ouro
}

//--- confere o histórico da conta (últimos 21 dias) e grava FECHOU das posições que o diário não viu
void ReconcileClosed()
{
   if(MQLInfoInteger(MQL_TESTER)) return;
   ClosedLoad();
   datetime now = TimeCurrent();
   if(!HistorySelect(now - 21 * 86400, now + 60)) return;
   int total = HistoryDealsTotal();
   for(int k = 0; k < total; k++)
   {
      ulong tk = HistoryDealGetTicket(k);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(en != DEAL_ENTRY_OUT && en != DEAL_ENTRY_INOUT) continue;
      ulong pid = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
      if(IsClosedLogged(pid)) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP);
      long reason = HistoryDealGetInteger(tk, DEAL_REASON);
      string how = (reason == DEAL_REASON_SL) ? "stop atingido" : (reason == DEAL_REASON_TP) ? "alvo atingido" :
                   (reason == DEAL_REASON_CLIENT || reason == DEAL_REASON_EXPERT) ? "fechada pelo robo ou manualmente" : "outro motivo";
      datetime tc = (datetime)HistoryDealGetInteger(tk, DEAL_TIME), to = tc;
      double entry = 0;
      if(HistorySelectByPosition((long)pid))                                       // acha a abertura da mesma posição
      {
         for(int q = 0; q < HistoryDealsTotal(); q++)
         {
            ulong t2 = HistoryDealGetTicket(q);
            if(t2 != 0 && HistoryDealGetInteger(t2, DEAL_ENTRY) == DEAL_ENTRY_IN) { entry = HistoryDealGetDouble(t2, DEAL_PRICE); to = (datetime)HistoryDealGetInteger(t2, DEAL_TIME); break; }
         }
      }
      HistorySelect(now - 21 * 86400, now + 60);                                   // volta a seleção do laço
      JournalAt(tc, "FECHOU", StringFormat("resultado=%.2f preco=%.2f pos=%I64u saida=%s entrada=%.2f dur=%d mae=n/d mfe=n/d", p, HistoryDealGetDouble(tk, DEAL_PRICE), pid, how + " (registrado pela conferencia do historico)", entry, (int)(tc - to)));
      MarkClosed(pid);
      if(reason == DEAL_REASON_SL && p < 0 && tc > g_lastStopTime) g_lastStopTime = tc;
   }
}

'''
s = s.replace(marca, novo + marca, 1)
open(os.path.join(D, "XR_Track.mqh"), "w", encoding="utf-8", newline="").write(s.replace("\n", "\r\n") if crlf else s)

# 3) uso: evento ao vivo marca como registrado; temporizador confere o histórico
rw("Kairos.mq5", [
    (r'''      Journal("FECHOU", StringFormat("resultado=%.2f preco=%.2f pos=%I64u saida=%s%s", p, px, pid, how, TrackClosedText(pid, px)));''',
     r'''      ClosedLoad();
      if(!IsClosedLogged(pid))
      {
         Journal("FECHOU", StringFormat("resultado=%.2f preco=%.2f pos=%I64u saida=%s%s", p, px, pid, how, TrackClosedText(pid, px)));
         MarkClosed(pid);
      }'''),
    (r'''   if(g_timerCount % 2 == 0) PollExport();''', r'''   if(g_timerCount == 10 || g_timerCount % 30 == 0) ReconcileClosed();   // fechamentos que o robo nao viu (MT5 desligado, rajada de ordens)
   if(g_timerCount % 2 == 0) PollExport();'''),
])
print("reconciliacao aplicada")
