//+------------------------------------------------------------------+
//| XR_Control.mqh - comandos vindos do painel web                   |
//|                                                                  |
//| O painel grava MQL5\Files\XAU_Reader_cmd.json:                   |
//|   {"id": 1790790000123, "cmd": "pause", "ts": 1790790000}        |
//| O robô só executa se o id for MAIOR que o último processado e o  |
//| carimbo de tempo tiver menos de 3 minutos (evita comando velho). |
//| Comandos: pause, resume, close_all, stop (remove o robô).        |
//+------------------------------------------------------------------+
#property strict

bool     g_paused = false;
long     g_cmdId = 0;
string   g_cmdLast = "", g_cmdWhen = "", g_cmdResult = "";

void ControlInit()
{
   g_paused = GlobalVariableCheck(GVName("PAUSED"));
   g_cmdId = GlobalVariableCheck(GVName("CMDID")) ? (long)GlobalVariableGet(GVName("CMDID")) : 0;
}

void SetPaused(const bool p)
{
   g_paused = p;
   if(p) GlobalVariableSet(GVName("PAUSED"), 1.0); else GlobalVariableDel(GVName("PAUSED"));
}

//--- chamado pelo temporizador (1 s). Retorna true se pediu para remover o robô.
bool PollCommands()
{
   if(!InpAllowPanelControl || MQLInfoInteger(MQL_TESTER)) return false;
   string s = ReadTextFile("XAU_Reader_cmd.json");
   if(s == "") return false;
   long id = (long)JNum(s, "id"), ts = (long)JNum(s, "ts");
   string cmd = JStr(s, "cmd");
   if(id <= g_cmdId) return false;
   g_cmdId = id;
   GlobalVariableSet(GVName("CMDID"), (double)id);
   long age = (long)TimeGMT() - ts; if(age < 0) age = -age;
   g_cmdWhen = TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS);
   g_cmdLast = cmd;
   if(age > 180) { g_cmdResult = "ignorado: comando antigo"; Journal("COMANDO", StringFormat("%s ignorado (comando com %d s de idade)", cmd, (int)age)); return false; }

   if(cmd == "pause")
   {
      SetPaused(true); g_cmdResult = "robo pausado";
      Journal("COMANDO", "PAUSAR recebido do painel: o robo nao abre novas operacoes (posicoes abertas seguem com stop e alvo)");
   }
   else if(cmd == "resume")
   {
      SetPaused(false); g_cmdResult = "robo retomado";
      Journal("COMANDO", "RETOMAR recebido do painel: o robo volta a analisar e operar");
   }
   else if(cmd == "close_all")
   {
      int n = OpenPositions();
      CloseAll("comando do painel");
      g_cmdResult = StringFormat("fechou %d posicao(oes)", n);
      Journal("COMANDO", StringFormat("FECHAR TUDO recebido do painel: %d posicao(oes) aberta(s) encerrada(s) a mercado", n));
   }
   else if(cmd == "stop")
   {
      g_cmdResult = "robo removido do grafico";
      Journal("COMANDO", "DESLIGAR recebido do painel: o robo sera removido do grafico (posicoes abertas mantem stop e alvo). Para ligar de novo, anexe o robo pelo MT5.");
      return true;
   }
   else { g_cmdResult = "comando desconhecido"; Journal("COMANDO", "comando desconhecido: " + cmd); }
   return false;
}
