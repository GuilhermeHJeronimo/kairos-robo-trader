//+------------------------------------------------------------------+
//| XR_Inputs.mqh - parâmetros do robô Kairos (ouro e bitcoin)        |
//+------------------------------------------------------------------+
#property strict

input group "=== SEGURANÇA (leia antes de ligar) ==="
input bool   InpAllowRealAccount  = false;   // Permitir operar em conta REAL (marque só se souber o que faz)
input long   InpMagic             = 26093001; // Número mágico (identifica as ordens deste robô)
input double InpRiskPct           = 0.5;     // Risco por operação (% do saldo)
input double InpMaxDailyLossPct   = 2.0;     // Perda máxima no dia (% do equity) - trava até o dia seguinte
input double InpMaxDrawdownPct    = 10.0;    // Queda máxima desde o pico (%) - desliga o robô até você liberar
input int    InpMaxTradesPerDay   = 10;      // Máximo de operações por dia (fase de teste na demo)
input bool   InpDemoRelaxLocks    = true;    // Conta DEMO: perda diária e perdas seguidas deixam de bloquear (mínimo 100% e 20), para o robô acumular trades; a queda máxima segue valendo. Em conta real valem os limites acima.
input int    InpMaxConsecLosses   = 5;       // Para no dia após N perdas seguidas
input double InpMaxTotalRiskPct  = 1.5;     // Risco total aberto (soma dos stops, % do saldo) que o robô aceita ter ao mesmo tempo; 0 = sem limite (vale só o máximo de posições)
input int    InpMaxPositions      = 3;       // Máximo de posições abertas ao mesmo tempo (cada uma com o risco acima)
input double InpMaxSpread         = 0.60;    // Ouro: spread máximo aceito (US$)
input double InpMaxSpreadATRPct   = 15.0;    // Outros ativos (bitcoin): spread máximo como % do ATR do tempo gráfico
input double InpMaxCostToRisk     = 0.25;    // Spread não pode passar dessa fração do risco (stop)
input double InpMaxRiskOverrun    = 2.0;     // Se o lote mínimo arrisca mais que N x o planejado, NÃO opera
input double InpMaxMarginUsePct   = 50.0;    // Usa no máximo N% da margem livre
input bool   InpCloseOnKill       = true;    // Fecha posições ao acionar trava de perda diária/drawdown
input bool   InpResetKill         = false;   // Marque UMA vez para liberar o robô depois de um drawdown

input group "=== HORÁRIO (hora do servidor; na Exness = UTC) ==="
input int    InpStartHour         = 0;       // Início (0 = o dia todo; 7 = abertura de Londres)
input int    InpEndHour           = 24;      // Fim (24 = o dia todo; 21 = fecha Nova York)
input int    InpFridayLastHour    = 19;      // Sexta: última hora para abrir (usado só se a corretora não informar a sessão)
input int    InpFridayNoEntryHours= 3;       // Sexta: não abre operação nas N horas antes do fim da sessão
input bool   InpCloseBeforeWeekend= true;    // Fecha posições na sexta antes do fim de semana
input int    InpCloseMinutesBeforeEnd = 90;  // Sexta: fecha tudo N minutos antes do fim da sessão da corretora
input int    InpFridayCloseHour   = 19;      // Sexta: hora de fechar (usado só se a corretora não informar a sessão)

input group "=== MODELO DE SAÍDA (risco : retorno) ==="
input int    InpRRMode            = 1;       // 0 = alvo pela estrutura (próxima zona); 1 = relação fixa
input double InpFixedRR           = 3.0;     // Relação fixa: 3,0 = arrisca 1 para ganhar 3 (stop de 1 unidade, alvo de 3)

input group "=== ANÁLISE EM TEMPO REAL E VERIFICAÇÃO EM DUAS ETAPAS ==="
input int    InpEvalMode          = 0;       // 0 = candle fechado (o modo TESTADO: padrão desde 08/10); 1 = tempo real (preço atual; nunca validado em M5/H1)
input int    InpRealtimeSecs      = 5;       // Tempo real: reavalia a cada N segundos
input bool   InpTwoStep           = true;    // Só entra depois da verificação em duas etapas
input int    InpVerifySecs        = 30;      // Etapa 2: o sinal precisa se sustentar por N segundos no preço de mercado
input double InpMaxChaseATR       = 0.5;     // Etapa 2: não entra se o preço já andou mais que N ATR desde o sinal
input double InpBreakevenR       = 0.0;     // Proteção de lucro: quando o preço andar N x R a favor, leva o stop para a entrada (0 = desligado)
input double InpMaxHoldHours      = 0.0;     // Saída por tempo: fecha a posição que passar de N horas aberta, com lucro ou prejuízo (0 = desligado)
input double InpBEOffsetR        = 0.05;    // Proteção de lucro: o stop fica em entrada + N x R (cobre spread e comissão)
input int    InpCooldownMin       = 30;      // Pausa (minutos) sem novas entradas depois de um stop atingido (0 = desligado)
input group "=== PROTEÇÕES APRENDIDAS COM AS ENTRADAS (v2.3) ==="
input bool   InpNoHedge           = true;    // Não abre posição contrária a uma já aberta no mesmo ativo (compra e venda juntas perdem as duas em mercado lateral)
input int    InpBrakeEvents       = 0;       // Freio de desempenho: depois de N eventos de perda seguidos neste ativo (perdas fechadas em até 10 min contam como 1), o ativo para de abrir (0 = desligado)
input int    InpBrakeHours        = 3;       // Freio de desempenho: por quantas horas o ativo fica parado
input group "=== META DO DIA ==="
input double InpDailyTargetUSD    = 0.0;     // Meta de ganho do dia em US$ (0 = sem meta). Pode ser trocada pelo painel sem reanexar o robô
input int    InpTargetAction      = 1;       // Ao bater a meta: 0 = só para de abrir; 1 = fecha as posições e para até o dia seguinte
input group "=== CÉREBRO (modelo treinado no histórico) ==="
input int    InpBrainMode         = 1;       // 0 = desligado; 1 = só informa a probabilidade; 2 = entra no placar como voto; 3 = filtro obrigatório
input double InpBrainMinP         = 0.0;     // Modo 3: probabilidade mínima de TAKE (0 = média histórica + 10%)
input bool   InpUseConfluence     = true;    // Decide pela CONFLUÊNCIA dos indicadores (a hierarquia de Dow é só mais um indicador)
input int    InpMinConfluenceGold = 0;       // Só no OURO: confluência mínima própria (ex.: 90). 0 = usa a mesma do outro ativo. No teste H1 2021-2026 o ouro melhorou por operação com 90%, mas entra menos
input int    InpMinConfluence     = 75;      // % mínimo dos indicadores (com opinião) que precisam concordar com a operação
input int    InpMinFactors        = 6;       // Mínimo de indicadores com opinião para a confluência valer
input int    InpRsiPeriod         = 14;      // RSI: período
input int    InpHierWeight        = 1;       // Peso do voto da hierarquia de Dow no placar (1 = igual aos demais indicadores)
input bool   InpHierMandatory     = false;   // Hierarquia de Dow como REGRA obrigatória (false = só um indicador entre vários)
input int    InpMinCertainty      = 60;      // (em desuso: substituída pela confluência)      // Certeza mínima da etapa 1 (% de verificações aprovadas; obrigatórias sempre valem)

input group "=== NOTÍCIAS E SENTIMENTO FORA DO GRÁFICO ==="
input bool   InpNewsBlackout      = true;    // Não abre operação perto de notícia de alto impacto (calendário do MT5, USD)
input int    InpNewsBeforeMin     = 30;      // Minutos de bloqueio antes da notícia
input int    InpNewsAfterMin      = 30;      // Minutos de bloqueio depois da notícia
input int    InpSentimentMode     = 1;       // Sentimento das manchetes (app web): 0 = desligado; 1 = veta contra sentimento extremo; 2 = também conta como verificação
input int    InpSentimentVeto     = 50;      // Nota mínima (0 a 100, em módulo) para vetar
input int    InpSentimentMaxAgeMin= 240;     // Ignora nota mais velha que N minutos

input group "=== CONTROLE PELO PAINEL WEB ==="
input bool   InpAllowPanelControl = true;    // Aceita comandos do painel: pausar, retomar, fechar tudo, desligar

input group "=== ESTRATÉGIA (porta do leitor de gráfico) ==="
input ENUM_TIMEFRAMES InpTF       = PERIOD_CURRENT; // Tempo gráfico de operação (PERIOD_CURRENT = o gráfico em que o robô foi anexado)
input bool   InpUseBreakout       = true;    // Setup: rompimento de zona
input bool   InpBreakoutRetest    = false;   // Rompimento espera o reteste (false = simples)
input bool   InpUseRejection      = true;    // Setup: rejeição em suporte/resistência
input bool   InpUsePullback       = true;    // Setup: pullback na tendência
input double InpMinRR             = 1.5;     // Relação retorno/risco mínima no momento da entrada
input int    InpSlippagePts       = 30;      // Desvio máximo aceito (pontos)

input group "=== HIERARQUIA DE ANÁLISE (teoria de Dow): decide se a operação é permitida ==="
input bool   InpUseHierarchy      = true;    // Só opera se a hierarquia de tendências permitir
input ENUM_TIMEFRAMES InpHierPrimaryTF   = PERIOD_MN1; // Primária (meses/anos): dá a direção principal
input ENUM_TIMEFRAMES InpHierSecondaryTF = PERIOD_W1;  // Secundária (correções): semanas/meses
input ENUM_TIMEFRAMES InpHierTertiaryTF  = PERIOD_D1;  // Terciária (curto prazo): dias
input int    InpHierLevels        = 1;       // Níveis alinhados: 1 = só a primária manda (mais operações); 2 = primária + mais um; 3 = os três (mais seletivo)

input group "=== CONFIRMAÇÕES (o robô só entra com o mínimo) ==="
input int    InpMinConf           = 1;       // Mínimo de confirmações alinhadas (0 = desliga o filtro)
input bool   InpConfTrend         = true;    // Tendência/estrutura (topos e fundos + EMA 21/50)
input bool   InpConfVWAP          = true;    // VWAP do dia e bandas
input bool   InpConfProfile       = true;    // Perfil de volume (POC, área de valor)
input bool   InpConfLiquidity     = true;    // Varredura de liquidez (stop hunt)
input bool   InpConfFlow          = false;   // Fluxo de ticks (DESLIGADO: em CFD não há agressor; nos testes o desequilíbrio ficou ~0)
input int    InpProfileHours      = 24;      // Janela do perfil de volume (horas)
input int    InpFlowMinutes       = 10;      // Janela do fluxo de ticks (minutos)
input double InpFlowThreshold     = 0.10;    // Desequilíbrio mínimo de fluxo (0 a 1)

input group "=== DIÁRIO E PAINEL ==="
input bool   InpJournal           = true;    // Grava diário CSV em MQL5\Files
input bool   InpDashboard         = true;    // Mostra painel no gráfico

//--- nome dos arquivos de comunicação com o painel: um conjunto por ativo (Kairos_<ativo>_status.json etc.)
string FN(const string base) { return "Kairos_" + _Symbol + "_" + base; }
bool   IsGold() { return StringFind(_Symbol, "XAU") >= 0; }
string AssetName() { return IsGold() ? "Ouro" : (StringFind(_Symbol, "BTC") >= 0 ? "Bitcoin" : _Symbol); }
//--- ativos que negociam no fim de semana (bitcoin): a corretora informa sessão no sábado
bool Is24x7()
{
   datetime a, b;
   return SymbolInfoSessionTrade(_Symbol, SATURDAY, 0, a, b) && b > a;
}
//--- spread máximo: valor fixo no ouro, % do ATR nos demais
int MinConfEff() { return (IsGold() && InpMinConfluenceGold > 0) ? InpMinConfluenceGold : InpMinConfluence; }
double MaxSpreadEff(const double atr) { return IsGold() ? InpMaxSpread : (atr > 0 ? InpMaxSpreadATRPct / 100.0 * atr : InpMaxSpread); }
