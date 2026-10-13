# Robô XAU Reader (MetaTrader 5)

Robô (Expert Advisor) em MQL5 para XAU/USD (na Exness: símbolo `XAUUSDm`). É a porta do leitor de gráfico
deste projeto: estrutura de mercado, zonas de suporte/resistência, rompimento, rejeição e pullback, mais
confirmações (tendência, VWAP, perfil de volume, liquidez) e gestão de risco.

> **Leia isto primeiro:** nos testes deste projeto o robô **não mostrou vantagem estatística**. O resultado
> médio por operação ficou perto de zero (veja "Resultados"). Não há garantia de lucro. Use conta **demo**
> antes de qualquer dinheiro real.

## Onde está

- Instalado e compilado em: `C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL\MQL5\Experts\XAU_Reader\`
- Cópia do código-fonte: `mt5\XAU_Reader\` (esta pasta do projeto)
- Diário de operações: `MQL5\Files\XAU_Reader_journal.csv` (todo sinal, confirmação, recusa e resultado)

## Como ligar (recomendado: conta DEMO)

1. No MT5: **Arquivo → Abrir uma conta → Exness → conta Demo**. Prefira saldo parecido com o real.
2. Abra o gráfico **XAUUSDm**, tempo gráfico **H1**.
3. No **Navegador** (Ctrl+N), em *Expert Advisors*, arraste **XAU_Reader** para o gráfico.
4. Na aba *Comum*, marque *Permitir negociação algorítmica*. Ligue o botão **Algo Trading** da barra superior.
5. Confira o painel no canto do gráfico (conta, travas, horário, última leitura).

## Conta real: trava de segurança

Se o robô detectar conta **real** e a opção `InpAllowRealAccount` estiver desmarcada, ele **se recusa a iniciar**
e avisa. Para operar em real você precisa marcar essa opção de propósito. É uma proteção de um clique, não um bloqueio.

## Versão 1.2: o que o robô faz agora

Cada item da sua lista de funcionalidades e como ficou:

| Pedido | Como foi feito | Limite honesto |
|---|---|---|
| Analisar o valor de mercado, não candles | `InpEvalMode = 1` (padrão): reavalia o **preço atual** a cada `InpRealtimeSecs` (5 s), lendo o candle em formação. `0` = só candle fechado (o modo testado até aqui). | O modo tempo real é novo e foi testado menos; sinais podem aparecer e sumir dentro do candle, por isso a etapa 2 exige que o sinal se sustente. |
| Sentimento fora do MetaTrader (notícias) | (1) **Calendário econômico do próprio MT5**: bloqueia operações 30 min antes e depois de notícia de alto impacto em USD (Non-Farm Payrolls, Fed etc.). (2) **Manchetes**: o app (`news.py`) busca feeds públicos (Google Notícias, Yahoo, FXStreet), pontua por palavras-chave do ouro e grava a nota para o robô, que **veta** operação contra um sentimento extremo. | O sentimento é por palavras-chave, sem entender contexto, e **não existe histórico para testá-lo**: só vale como veto de segurança. O calendário não funciona no Testador de Estratégia (só ao vivo). |
| Modelo 1 para 3 | `InpRRMode = 1` e `InpFixedRR = 3.0`: o stop define o risco (1) e o alvo fica a 3 vezes essa distância, recalculado sobre o preço real de entrada. `0` = alvo na próxima zona. | Com 1:3 só é preciso acertar ~25% para empatar (antes do custo), mas o alvo é longe e muitas operações terminam no stop. |
| Painel com relatório de atividades e de operações | `/robo`, abas **Atividade** (tudo que o robô fez) e **Operações** (tabela com entrada, saída, R, duração, como saiu, certeza e o motivo de cada entrada; exporta CSV e imprime). | |
| O robô não entra em tudo: verificação em duas etapas, explicando entradas e recusas | **Etapa 1 (análise):** hierarquia, confirmações, relação retorno/risco, horário, spread, notícias, sentimento, travas e limites (obrigatórias) mais sinais de qualidade (estrutura a favor, volume, caminho livre etc.). Precisa passar em todas as obrigatórias e atingir `InpMinCertainty` (70%). **Etapa 2 (verificação ao vivo):** o sinal precisa se sustentar por `InpVerifySecs` (30 s) no preço de mercado: sem perseguir o preço (máx. 0,5 ATR), sem invalidar o stop, retorno/risco ao vivo, spread e nível estrutural mantidos. Toda decisão grava um evento **DECISAO** com a lista de verificações e um texto explicando por que entrou ou não. | "Certeza" é a **porcentagem de verificações aprovadas**, não a probabilidade de ganhar. Nenhuma regra garante acerto. |
| Dashboard interativo e bonito | `/robo`: abas Visão geral, Decisões, Operações, Gráficos (resultado acumulado em R ou US$, resultado por dia, distribuição de R, resultado por hora, por tipo de entrada e confirmação, preço com as operações marcadas), Notícias, Atividade e Configuração. | O gráfico de preço usa o perpétuo da Binance como aproximação do ouro da Exness. |
| Botão de ligar e desligar | No topo do painel: **Pausar/Retomar** (o robô para de abrir operações; posições abertas seguem com stop e alvo), **Fechar tudo** (fecha a mercado, com confirmação) e **Desligar** (remove o robô do gráfico; para religar é preciso anexá-lo no MT5, porque um robô removido não escuta comandos). | O painel grava um arquivo de comando que o robô lê a cada segundo. O servidor só aceita comandos do próprio computador, com cabeçalho de proteção e comandos destrutivos com confirmação. Precisa do MT5 aberto e do robô ativo. |

## Tempo gráfico e hierarquia de análise (versão 1.1)

**Tempo gráfico:** o robô opera no tempo gráfico em que for anexado (`InpTF = PERIOD_CURRENT`). Anexado a um gráfico M5, lê e opera
em M5; em H1, em H1. Para trocar, remova o robô (ou anexe um novo) no gráfico do tempo desejado. Depois de mudar o tempo gráfico de um
gráfico que já tem o robô, ele reinicia sozinho no novo tempo.

**Hierarquia de análise (teoria de Dow):** antes de qualquer operação o robô consulta três níveis e só opera se a hierarquia permitir:

| Nível | Gráfico (padrão) | Papel |
|---|---|---|
| Primária | mensal (MN1) | meses ou anos: define a **direção principal** |
| Secundária | semanal (W1) | movimentos de correção da primária |
| Terciária | diário (D1) | movimentos de curto prazo |

Cada nível é lido só com barras fechadas: topos e fundos (2 barras de cada lado) e, se ficar indefinido, as médias 21/50.
Regra: a operação precisa ser **a favor da direção principal** (a da primária; se ela estiver indefinida, a do nível seguinte) e ter pelo
menos `InpHierLevels` níveis apontando para o mesmo lado:

- `1` (padrão da fase de teste): só a primária manda. Compra quando o mensal está em alta, mesmo com semanal e diário em correção.
- `2`: a primária mais pelo menos mais um. Aceita compra com o semanal em correção **se o diário já voltou a favor** (correção terminando).
- `3`: os três alinhados (mais seletivo, poucas operações).

Os tempos dos três níveis podem ser trocados (`InpHierPrimaryTF`, `InpHierSecondaryTF`, `InpHierTertiaryTF`), e a hierarquia pode ser
desligada (`InpUseHierarchy`). O painel (**/robo**) mostra os três níveis, se compra e venda estão permitidas, e cada sinal traz o porquê.

**Mais operações na fase de teste** (padrões desta versão, todos editáveis): confirmações mínimas 1, até 10 operações por dia, pausa
após 5 perdas seguidas, até 2 posições ao mesmo tempo, hierarquia com 1 nível. Continuam valendo: risco de 0,5% por operação, perda
diária de 2%, queda máxima de 10%, stop e alvo em toda ordem. Cada posição arrisca 0,5%, então com 2 abertas o risco somado é de 1%.
Operar em M5 ou M15 gera muito mais sinais, mas o stop fica pequeno e o spread pesa mais.

**O que os testes dizem sobre a hierarquia** (`estudos/estudo_hierarquia.py`, ouro, custo US$ 0,60, R líquido por operação com IC95%):

| Teste | Sem hierarquia | Só primária | Primária + 1 | Três níveis |
|---|---|---|---|---|
| Gráfico diário, 25 anos | +0,023 ±0,201 (226) | +0,146 ±0,249 (142) | +0,252 ±0,274 (119) | +0,490 ±0,380 (60) |
| H1, 2 anos | +0,124 ±0,173 (285) | +0,257 ±0,234 (168) | +0,324 ±0,251 (149) | +0,391 ±0,284 (119) |

- Nos 25 anos diários a melhora é consistente (nos três terços do período), mas os intervalos ainda incluem zero: **sugestivo, não provado**.
- **Cuidado com o H1:** nos últimos 2 anos o ouro esteve em alta forte, e com a hierarquia todas as entradas viraram compras
  (0 vendas). O ganho é o mesmo de "só comprar" (+0,257). Não prova nada sobre a hierarquia.
- Nos 25 anos, grande parte do efeito vem de **evitar vendas contra a alta primária** (vendas sem filtro: −0,29 R por operação).
- Em M5 e M15 há poucos dados (60 dias): com 2 níveis passam só 10% a 14% das entradas. Sem conclusão.
- **Situação de hoje:** mensal em alta, semanal em baixa, diário em baixa (correção). Com 2 níveis o robô ficaria parado até a correção
  terminar; com 1 nível ele aceita compras a favor da primária.

## Painel do robô (web, somente leitura)

Com o app rodando (`python server.py`), abra **http://localhost:8000/robo**. O robô grava seu estado em
`MQL5\Files\XAU_Reader_status.json` (a cada ~5 s) e o diário em `XAU_Reader_journal.csv`; o painel só lê esses arquivos.
Ele **não controla** o robô e não envia nada ao MT5.

O painel mostra: se o robô está ativo, conta DEMO/REAL, equity, resultado do dia, perda do dia e queda desde o pico contra os
limites, posição aberta com stop/alvo e resultado em R, última leitura, saúde e travas, linha do tempo de tudo que o robô
fez (cada sinal com as confirmações que valeram e, se não abriu, o motivo) e as estatísticas com intervalo de confiança.

## Passo a passo na conta demo

1. Confirme no MT5 que a conta é a **demo** (`Exness-MT5Trial...`). Saldo da demo: use um valor parecido com o do seu real, e
   **pelo menos ~US$ 5.000** para o robô conseguir operar em H1 (veja "Saldo mínimo").
2. Abra o gráfico **XAUUSDm** no tempo gráfico em que quer operar (M5, M15, H1...).
3. Navegador (Ctrl+N) → Expert Advisors → **XAU_Reader** (se não aparecer: botão direito → Atualizar). Arraste para o gráfico.
4. Aba *Comum*: marque **Permitir negociação algorítmica**. Deixe as opções padrão. OK.
5. Ligue o botão **Algo Trading** na barra superior (fica verde). No canto do gráfico deve aparecer um rostinho sorrindo.
6. Em *Caixa de Ferramentas → Especialistas* deve aparecer `[XAUR] INICIO ... conta=DEMO`. O painel do gráfico mostra o estado.
7. Abra **http://localhost:8000/robo**: deve dizer "robô ativo".
8. Deixe o MT5 aberto e o computador acordado (para 24h/5 dias, o ideal é um VPS).

**O que esperar:** nos testes o robô abriu cerca de 2 operações por semana. Para chegar a 30 operações fechadas (mínimo para
qualquer conclusão) são cerca de 3 a 4 meses. Nas primeiras semanas use a demo para conferir a **mecânica**: ordens com stop e
alvo, lote calculado, spread, fechamento de sexta e travas. O resultado só diz algo depois de dezenas de operações.

## Regras de risco (sempre ativas)

| Regra | Padrão |
|---|---|
| Risco por operação (% do saldo) | 0,5% |
| Toda ordem com stop e alvo; sem martingale, sem médio, sem inverter posição | fixo |
| Máximo de posições abertas | 1 |
| Perda máxima no dia (equity) | 2% → para até o dia seguinte e fecha posições |
| Queda máxima desde o pico | 10% → **desliga** até você marcar `InpResetKill` |
| Máximo de operações por dia | 3 |
| Perdas seguidas | 3 → pausa até o dia seguinte |
| Spread máximo | US$ 0,60 e no máximo 25% do risco da operação |
| Lote mínimo arrisca mais que 2x o planejado | **não opera** |
| Horário | seg–sex, 07h–21h (servidor = UTC na Exness). Sexta: não abre nas 3 h finais e **fecha tudo 90 min antes do fim real da sessão**, lido da corretora (a Exness fecha o ouro às 21h de sexta) |

**Saldo mínimo:** com stop de H1 típico de US$ 15 a 45 e lote mínimo (0,01 = 1 onça), cada operação arrisca esse
valor em dólares. Para arriscar 0,5% você precisa de cerca de US$ 3.000 a 9.000. Com saldo menor o robô recusa
os sinais (foi o que aconteceu com US$ 1.000 nos testes: 47 de 71 sinais recusados). Não aumente `InpRiskPct`
ou `InpMaxRiskOverrun` só para "forçar" entradas: é assim que contas pequenas quebram.

## Confirmações (`InpMinConf`, padrão 2)

O sinal do leitor só vira ordem se pelo menos N confirmações estiverem alinhadas:

| Confirmação | O que verifica | Observação |
|---|---|---|
| Tendência | topos/fundos e EMA 21/50 a favor | validou ~75% dos sinais |
| VWAP | preço do lado certo do VWAP do dia (ou retomada da banda) | validou ~90%: quase não filtra |
| Perfil de volume | preço acima da área de valor, ou reagindo em VAL/POC/VAH | usa volume de **ticks** |
| Liquidez | varredura de topo/fundo confirmado seguida de retorno (stop hunt) | validou ~60% |
| Fluxo | desequilíbrio de ticks | **desligada**: veja abaixo |

**Limite dos dados:** o ouro na Exness é CFD. Não existe volume real, livro de ofertas (DOM) nem "times and
trades" com agressor. O que o robô usa é volume de ticks e uma aproximação de fluxo. Nos testes com 18,9 milhões
de ticks reais o desequilíbrio ficou entre −0,05 e +0,06 (ruído), então essa confirmação vem desligada.
Para order flow de verdade seria preciso outro ativo/corretora com volume real (por exemplo futuros de ouro).

## Resultados da versão 1.2 (Testador do MT5, dados reais da Exness)

Testes refeitos com a **trava de queda máxima desligada no Testador** (ela desligava o robô no meio dos testes antigos). Por isso os
resultados da versão 1.0 mais abaixo ficam **suspeitos**: cada configuração parava em uma data diferente. Conta de teste de US$ 10.000,
H1, 2021.11 a 2026.09, candle fechado, sem notícias (o calendário não funciona no Testador). R líquido por operação com intervalo de
confiança de 95%.

| Saída | Hierarquia | Operações | Acerto | R por operação | Maior queda |
|---|---|---|---|---|---|
| Pela estrutura | desligada | 720 | 38,5% | +0,039 ±0,093 | US$ 1.182 |
| Pela estrutura | 1 nível | 406 | 41,6% | +0,155 ±0,132 | US$ 973 |
| Pela estrutura | 2 níveis | 281 | 40,9% | +0,121 ±0,154 | US$ 829 |
| Fixa 1:3 | desligada | 2.402 | 29,7% | −0,006 ±0,057 | US$ 2.589 |
| Fixa 1:3 | 1 nível | 1.547 | 33,9% | **+0,126 ±0,078** | US$ 4.999 |
| Fixa 1:3 | 2 níveis | 982 | 34,7% | +0,162 ±0,099 | US$ 3.654 |
| Fixa 1:3, 1 nível, duas etapas (30 s) | 1 nível | 1.518 | 33,9% | +0,115 ±0,078 | US$ 5.348 |
| Fixa 1:3, 1 nível, duas etapas + certeza 70% | 1 nível | 1.505 | 33,8% | +0,108 ±0,078 | US$ 5.150 |

**O que isso mostra**
- **A hierarquia melhora o resultado de forma consistente.** Com 1:3, por período: 2021–2023 de −0,004 para +0,116 (±0,121) e 2024–2026
  de −0,009 para +0,134 (±0,103). Melhora compras (+0,050 para +0,124) e vendas (−0,069 para +0,136, mas só 320 vendas).
- **Limite dos testes:** o Testador só tinha cerca de 60 candles mensais. O nível mensal ficou "sem direção" até 2023 (valeu na prática a
  tendência semanal) e marcou "ALTA" em todos os dias de 2024 a 2026 (hierarquia = só compras). A hierarquia completa em mercado de baixa
  ainda não foi testada.
- **A verificação em duas etapas e a certeza mínima não melhoraram o resultado** no H1 (barram só cerca de 2% das operações). Servem de
  proteção e transparência, não de filtro de qualidade.
- **Fixa 1:3 sem hierarquia dá zero:** com ~30% de acerto é o ponto de equilíbrio matemático. O ganho vem da hierarquia.
- **Modo tempo real (M15, ticks reais, 6 semanas):** +0,043 ±0,211 em 204 operações, contra −0,124 ±0,230 em 126 no candle fechado.
  Amostra curta, inconclusiva; sem erros e com mais operações, como pedido.
- **Risco real:** a maior queda chegou a **metade do depósito** (US$ 4.999 de 10.000) com 0,5% de risco, 2 posições e até 10 operações por
  dia. Na demo serve para estudo. Em conta real reduza `InpRiskPct` (0,25%) e `InpMaxPositions` (1); a trava de 10% pararia o robô antes.
- Os intervalos de confiança mostram vantagem estatística no 1:3 com 1 nível (limite inferior acima de zero), mas é **um** conjunto de
  testes em uma corretora e um período de ouro em alta. Continue na demo antes de qualquer dinheiro real.

## Resultados da versão 1.0 (suspeitos: a trava de queda interrompia os testes)

Resultados abaixo: versão 1.0, tempo gráfico H1, custo de spread real do histórico, risco 0,5%, conta de teste US$ 10.000. R = lucro dividido
pelo risco planejado da operação. "±" é o intervalo de confiança de 95%: quando inclui zero, o resultado não se
distingue de sorte.

| Período | Configuração | Operações | Acerto | R por operação | Fator de lucro |
|---|---|---|---|---|---|
| 2024-01 a 2026-09 | sem filtro (0 confirmações) | 304 | 34,5% | +0,008 ±0,142 | 1,01 |
| 2024-01 a 2026-09 | 2 confirmações | 288 | 35,1% | +0,019 ±0,145 | 1,03 |
| 2024-01 a 2026-09 | 3 confirmações | 247 | 34,8% | +0,012 ±0,154 | 1,01 |
| 2024-01 a 2026-09 | só tendência | 237 | 36,7% | +0,054 ±0,161 | 1,09 |
| 2024-01 a 2026-09 | só VWAP | 286 | 35,0% | +0,022 ±0,146 | 1,03 |
| 2024-01 a 2026-09 | só perfil de volume | 239 | 35,1% | +0,018 ±0,158 | 1,02 |
| 2024-01 a 2026-09 | só liquidez | 186 | 37,1% | +0,105 ±0,196 | 1,18 |
| **2021-01 a 2023-12 (fora da amostra)** | sem filtro | 133 | 29,3% | −0,081 ±0,241 | 0,87 |
| **2021-01 a 2023-12 (fora da amostra)** | 2 confirmações | 131 | 29,0% | −0,088 ±0,243 | 0,86 |
| **2021-01 a 2023-12 (fora da amostra)** | só liquidez | 152 | 32,2% | −0,030 ±0,221 | 0,95 |

| **Versão final** (fechamento de sexta corrigido), 2024-01 a 2026-09 | 2 confirmações (padrão) | 299 | 38,5% | +0,017 ±0,135 | 1,02 |

**Leitura honesta:**
- Em todas as configurações o intervalo de confiança inclui zero: **sem vantagem demonstrada**.
- As confirmações não melhoraram o resultado de forma mensurável. A "liquidez", que parecia a melhor em 2024–2026,
  **não se repetiu** em 2021–2023: era ruído.
- Somando os dois períodos sem filtro: 437 operações, média de aproximadamente −0,02 R por operação.
- Ticks reais (jul–set/2026, 31 operações): +0,025 ±0,429 R por operação. Amostra pequena demais para concluir.

## Defeitos encontrados e corrigidos durante os testes

- **Fechamento de fim de semana:** a 1ª versão tentava fechar as posições às 21h de sexta, mas o mercado do ouro na Exness já está
  fechado nesse horário; todas as tentativas falhavam ("Market closed") e a posição ficaria exposta ao gap do fim de semana. Agora o
  robô lê o horário de sessão da corretora e fecha 90 minutos antes (33 fechamentos bem-sucedidos no teste, 0 falhas).
- **Trava de lote mínimo:** evitou 47 de 71 entradas com saldo de US$ 1.000, que arriscariam 2% a 9% por operação.
- **Fluxo de ticks:** desligado por padrão (ruído, veja acima).
- **Testador do MT5:** reaproveita opções da rodada anterior; o executor agora envia todas.

## Como rodar os testes de novo

Com o MT5 **fechado**, na pasta do projeto:

```
python mt5\run_tester.py --name meu_teste --from 2024.01.01 --to 2026.09.26 --model 1 --deposit 10000 InpMinConf=2
```

`--model 1` usa candles de 1 minuto (rápido); `--model 4` usa ticks reais (lento, exato). O testador é uma
simulação e não envia ordens à sua conta. O executor manda todas as opções do robô a cada rodada, porque o
testador do MT5 reaproveita os valores da rodada anterior para opções que faltam.

## Próximos passos sensatos

1. Rodar **semanas na conta demo** e ler o diário CSV: ele registra todo sinal com as confirmações que valeram e o motivo de cada recusa.
2. Só aumentar confiança se o resultado da demo, somado aos testes, mostrar intervalo de confiança acima de zero.
3. Buscar vantagem em outro lugar (outros setups, filtros de regime, outros tempos gráficos), sempre validando em período que não foi usado para escolher a regra.

*Ferramenta educacional. Não é recomendação de investimento. Day trade em ouro, principalmente alavancado, tem alto risco de perda.*
