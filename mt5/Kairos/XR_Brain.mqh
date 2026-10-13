//+------------------------------------------------------------------+
//| XR_Brain.mqh - "cérebro": modelo treinado no histórico (Python)  |
//|                                                                  |
//| Lê Kairos_<ativo>_brain.txt (escrito por cerebro/atualizar.py):  |
//|   tf=H1  base=0.285  auc=0.57  usable=1  b=-0.93                 |
//|   f=nome;peso;media;desvio   (uma linha por característica)      |
//| e calcula a probabilidade de TAKE (1:3) da operação em análise.  |
//| InpBrainMode: 0 desligado, 1 só informa, 2 vota, 3 filtro.       |
//| Só vale se o arquivo for do mesmo tempo gráfico do robô.         |
//+------------------------------------------------------------------+
#property strict

bool     g_bOk = false, g_bUsable = false;
string   g_bTf = "", g_bN[];
double   g_bW[], g_bMu[], g_bSd[], g_bB = 0, g_bBase = 0, g_bAuc = 0;
datetime g_bRead = 0;

void BrainLoad()
{
   if(g_bRead != 0 && TimeCurrent() - g_bRead < 600) return;
   g_bRead = TimeCurrent();
   g_bOk = false;
   int h = FileOpen(FN("brain.txt"), FILE_READ | FILE_TXT | FILE_ANSI | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE) return;
   ArrayResize(g_bN, 0); ArrayResize(g_bW, 0); ArrayResize(g_bMu, 0); ArrayResize(g_bSd, 0);
   g_bUsable = false; g_bB = 0; g_bBase = 0; g_bAuc = 0; g_bTf = "";
   while(!FileIsEnding(h))
   {
      string ln = FileReadString(h);
      StringTrimLeft(ln); StringTrimRight(ln);
      if(ln == "") continue;
      int eq = StringFind(ln, "=");
      if(eq < 0) continue;
      string k = StringSubstr(ln, 0, eq), v = StringSubstr(ln, eq + 1);
      if(k == "tf") g_bTf = v;
      else if(k == "base") g_bBase = StringToDouble(v);
      else if(k == "auc") g_bAuc = StringToDouble(v);
      else if(k == "usable") g_bUsable = (StringToInteger(v) == 1);
      else if(k == "b") g_bB = StringToDouble(v);
      else if(k == "f")
      {
         string p[]; if(StringSplit(v, ';', p) < 4) continue;
         int n = ArraySize(g_bN); ArrayResize(g_bN, n + 1); ArrayResize(g_bW, n + 1); ArrayResize(g_bMu, n + 1); ArrayResize(g_bSd, n + 1);
         g_bN[n] = p[0]; g_bW[n] = StringToDouble(p[1]); g_bMu[n] = StringToDouble(p[2]); g_bSd[n] = StringToDouble(p[3]);
      }
   }
   FileClose(h);
   g_bOk = (ArraySize(g_bN) > 0 && g_bTf == TfName(g_tf));
}

bool BrainReady() { BrainLoad(); return g_bOk; }

//--- probabilidade de TAKE com as características atuais (g_fn/g_fv); -1 se faltar alguma
double BrainPredict(string &detail)
{
   double z = g_bB; int miss = 0;
   for(int k = 0; k < ArraySize(g_bN); k++)
   {
      double x = 0; bool f = false;
      for(int q = 0; q < ArraySize(g_fn); q++) if(g_fn[q] == g_bN[k]) { x = g_fv[q]; f = true; break; }
      if(!f) { miss++; continue; }
      z += g_bW[k] * (x - g_bMu[k]) / (g_bSd[k] > 1e-9 ? g_bSd[k] : 1.0);
   }
   double p = 1.0 / (1.0 + MathExp(-MathMax(-30.0, MathMin(30.0, z))));
   detail = StringFormat("probabilidade de TAKE %.0f%% (media historica %.0f%%; poder de previsao fora da amostra AUC %.2f%s)", p * 100, g_bBase * 100, g_bAuc,
                         g_bUsable ? "" : ", ainda nao confiavel") + (miss > 0 ? StringFormat(" [%d caracteristicas ausentes]", miss) : "");
   return p;
}
