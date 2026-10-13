"""Aprendizado do robô: autópsia de cada trade fechado + armazenamento (Obsidian e fila para o Notion) + estatística por fator.

Camadas (ver Mente: "Diário de trading completo"):
  1. autopsia(trade, anteriores): causas PROVÁVEIS (hipóteses, não provas) e lição em português, para loss e para take.
  2. sync(): grava uma nota por trade em C:\\Users\\SEU_USUARIO\\Mente\\08 Trades\\ e enfileira o trade para o diário do Notion.
  3. fatores(): R médio por fator com IC95%; só chama de "conclusivo" com n >= 30. Nunca altera o robô sozinho: só sugere.

Uso:  python learning.py            (sincroniza e mostra o resumo)
      python learning.py --marcar ID1,ID2   (marca trades como já enviados ao Notion)
"""
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

import robot

VAULT = Path(r"C:\Users\SEU_USUARIO\Mente\08 Trades")
STATE = Path(__file__).with_name("aprendizado_estado.json")
QUEUE = Path(__file__).with_name("notion_fila.json")
MIN_N = 30


def _num(txt, pat):
    m = re.search(pat, txt or "")
    return float(m.group(1)) if m else None


def _check(tr, name):
    for c in tr.get("checks", []):
        if c["name"] == name:
            return c
    return None


def sessao(open_t):
    h = datetime.strptime(open_t, "%Y.%m.%d %H:%M:%S").hour
    return "Londres" if 7 <= h < 12 else "Londres+NY" if 12 <= h < 16 else "Nova York" if 16 <= h < 21 else "Outra"


def autopsia(tr, anteriores):
    """tr: trade fechado (robot.read_journal). anteriores: trades fechados antes dele. Devolve dict com causas e lição."""
    risk_px = abs(tr["entry"] - tr["sl"]) or 1e-9
    win = tr["result"] > 0
    mae_r = round(tr["mae"] / risk_px, 2) if tr.get("mae") is not None else None
    mfe_r = round(tr["mfe"] / risk_px, 2) if tr.get("mfe") is not None else None
    hier = _check(tr, "hierarquia forte")
    n_hier = _num(hier["detail"], r"(\d) de 3") if hier else None
    vol = _check(tr, "volume acima da media")
    vol_x = _num(vol["detail"], r"([\d.]+)x") if vol else None
    sent = _check(tr, "sentimento a favor")
    weak = [f'{c["name"]} ({c["detail"]})' for c in tr.get("checks", []) if c["status"] == "fraco"]
    ctx = tr.get("ctx") or {}
    vwap = _num(ctx.get("vwap", ""), r"^([\d.]+)$") if ctx else None
    reent = None
    for p in reversed(anteriores):
        a, b = datetime.strptime(tr["open_t"], "%Y.%m.%d %H:%M:%S"), datetime.strptime(p["close_t"], "%Y.%m.%d %H:%M:%S")
        if 0 <= (a - b).total_seconds() <= 90 * 60 and p["side"] == tr["side"] and abs(p["entry"] - tr["entry"]) < 2 * risk_px and p["result"] < 0:
            reent = p
        break

    fatores = []           # o que estava presente (vale para take e loss)
    if n_hier is not None:
        fatores.append(f"hierarquia: {int(n_hier)} de 3 níveis a favor")
    if vol_x is not None:
        fatores.append(f"volume {vol_x:.2f}x a média")
    if vwap:
        d = (tr["entry"] - vwap) / risk_px
        fatores.append(f"entrada {abs(d):.1f}R {'abaixo' if d < 0 else 'acima'} do VWAP do dia")
    if sent:
        fatores.append(f"sentimento: {sent['detail']}")

    causas, texto = [], []
    if not win:
        if n_hier is not None and n_hier < 2:
            causas.append("contra tendencia maior"); texto.append(f"só {int(n_hier)} de 3 níveis da hierarquia estavam a favor (operou contra a correção)")
        if vol_x is not None and vol_x < 0.8:
            causas.append("volume fraco"); texto.append(f"volume de {vol_x:.2f}x a média (pouco interesse no movimento)")
        if sent and sent["status"] == "fraco":
            causas.append("sentimento contra"); texto.append(f"sentimento das manchetes sem apoio ({sent['detail']})")
        if vwap and ((tr["side"] == "COMPRA" and vwap - tr["entry"] > 3 * risk_px) or (tr["side"] == "VENDA" and tr["entry"] - vwap > 3 * risk_px)):
            if tr["side"] == "COMPRA": causas.append("abaixo do VWAP")
            texto.append(f"entrada longe do VWAP ({abs(tr['entry'] - vwap):.1f} pontos), contra a pressão do dia")
        if reent:
            causas.append("reentrada no mesmo nivel"); texto.append("reentrada no mesmo nível logo depois de um stop")
        if tr.get("minutes") is not None and tr["minutes"] <= 5 and (mfe_r is None or mfe_r < 0.3):
            causas.append("ruido"); texto.append(f"stop em {tr['minutes']} min" + (" sem nunca andar a favor: o preço não deu chance à ideia" if mfe_r is not None else " (MFE não registrado nesta operação)"))
        if mfe_r is not None and mfe_r >= 1.0:
            texto.append(f"chegou a andar {mfe_r:.1f}R a favor e devolveu tudo (saída sem proteção)")
        if not causas:
            causas.append("sem causa clara"); texto.append("nenhum fator fraco explica; pode ser só a variação normal (em 1:3 a maioria dos trades perde)")
        licao = ("Hipótese: " + "; ".join(texto) + ". Só vira regra se se repetir em amostra maior.")
    else:
        bons = []
        if n_hier is not None and n_hier >= 2: bons.append(f"hierarquia alinhada ({int(n_hier)} de 3)")
        if vol_x is not None and vol_x >= 1.0: bons.append(f"volume acima da média ({vol_x:.2f}x)")
        if tr.get("minutes") is not None: bons.append(f"andou a favor em {tr['minutes']} min")
        texto = bons or ["nenhum fator isolado se destaca"]
        licao = "Take: " + "; ".join(texto) + ". Com um take só não dá para saber se foi habilidade ou sorte; acumular trades."
    return {"win": win, "mae_r": mae_r, "mfe_r": mfe_r, "hier": n_hier, "vol_x": vol_x, "fracas": weak, "fatores": fatores,
            "causas": causas, "licao": licao, "reentrada": bool(reent), "sessao": sessao(tr["open_t"])}


def _slug(tr):
    d = tr["open_t"].replace(".", "-").replace(":", "")[:15]
    pref = "" if "XAU" in tr.get("sym", "XAUUSDm").upper() else robot.asset_name(tr["sym"]).lower() + " "      # o ouro mantém o nome antigo das notas
    return f"{d} {pref}{tr['side'].lower()} {tr['setup']} {'take' if tr['result'] > 0 else 'loss'}"


SESSOES = Path(r"C:\Users\SEU_USUARIO\Mente\07 Sessões")


def ligacoes(tr):
    """Wikilinks de cada nota de trade: painel, projeto, método, histórico do ativo e a sessão do dia (se existir)."""
    ouro = "XAU" in tr.get("sym", "XAUUSDm").upper()
    out = ["- Painel com todos os trades e a estatística por fator: [[Painel de aprendizado]]",
           "- Projeto: [[Kairos (robô de ouro e bitcoin)]]" + (" (história do ouro em [[Robô XAU Reader (MetaTrader 5)]])" if ouro else ""),
           "- Método da autópsia: [[Aprendizado de robô de trading - autópsia por trade e estatística por fator]] · campos do diário: [[Diário de trading completo - campos, métricas e revisão]]",
           "- Regra de decisão em vigor: [[Decisão por confluência de indicadores no Kairos]]"]
    dia = tr["open_t"][:10].replace(".", "-")
    if (SESSOES / f"{dia}.md").exists():
        out.append(f"- Dia: [[{dia}]]")
    return out


def nota_obsidian(tr, a):
    win = a["win"]
    titulo = _slug(tr)
    fm = ["---", "tipo: trade", f"resumo: {'TAKE' if win else 'LOSS'} {tr['side']} {tr['setup']} {tr['r']:+.2f}R em {tr['minutes']} min; {a['licao'][:110]}",
          'projetos: ["[[Kairos (robô de ouro e bitcoin)]]"]', "tags: [trade, diario, " + ("take" if win else "loss") + "]",
          f"pos: {tr.get('pos')}", f"ativo: {robot.asset_name(tr.get('sym', 'XAUUSDm'))}", f"criado: {tr['open_t'][:10].replace('.', '-')}", f"atualizado: {datetime.now():%Y-%m-%d}", "---", ""]
    corpo = [f"# {'TAKE' if win else 'LOSS'} · {tr['side']} · {tr['setup']} · {tr['r']:+.2f}R", "",
             f"- **Abertura:** {tr['open_t']} (servidor UTC) · **Fechamento:** {tr['close_t']} · **Duração:** {tr['minutes']} min · **Sessão:** {a['sessao']}",
             f"- **Entrada** {tr['entry']} · **Stop** {tr['sl']} · **Alvo** {tr['tp']} · **Saída** {tr['exit_price']} ({tr['exit']}) · lote {tr['lots']}",
             f"- **Resultado:** US$ {tr['result']:+.2f} ({tr['r']:+.2f}R) · risco planejado US$ {tr['risk']:.2f} · certeza do robô {tr.get('certainty')}%",
             f"- **MAE:** {str(a['mae_r']) + 'R' if a['mae_r'] is not None else 'n/d'} (quanto foi contra) · **MFE:** {str(a['mfe_r']) + 'R' if a['mfe_r'] is not None else 'n/d'} (quanto foi a favor)", "",
             "## Por que o robô entrou", tr.get("why", ""), "",
             "## Fatores presentes", *(f"- {f}" for f in a["fatores"]), "",
             "## Checagens fracas na hora da entrada", *(f"- {w}" for w in a["fracas"]), "",
             "## " + ("Por que deu take (autópsia)" if win else "Por que deu loss (autópsia)"), a["licao"], "",
             "## Causas prováveis", ", ".join(a["causas"]), "",
             "## Ligações", *ligacoes(tr), "",
             "> Autópsia automática (`learning.py`). Causas são hipóteses: com poucos trades não há prova."]
    return titulo, "\n".join(fm + corpo) + "\n"


def linha_notion(tr, a):
    return {"Trade": f"{robot.asset_name(tr.get('sym', 'XAUUSDm'))} {tr['side']} {tr['setup']} {tr['open_t'][:16]}", "Ativo": robot.asset_name(tr.get("sym", "XAUUSDm")), "date:Abertura:start": tr["open_t"][:10].replace(".", "-") + "T" + tr["open_t"][11:] + "Z",
            "date:Abertura:is_datetime": 1, "Lado": tr["side"], "Setup": tr["setup"], "Resultado": "TAKE" if a["win"] else ("LOSS" if tr["result"] < 0 else "MANUAL"),
            "Saida": tr["exit"], "R": round(tr["r"], 2), "USD": tr["result"], "Risco USD": tr["risk"], "MAE em R": a["mae_r"], "MFE em R": a["mfe_r"],
            "Minutos": tr["minutes"], "Certeza": tr.get("certainty"), "Hierarquia a favor": a["hier"], "Volume x media": a["vol_x"], "Sessao": a["sessao"],
            "Seguiu o plano": "__YES__", "Causas provaveis": json.dumps(a["causas"], ensure_ascii=False), "Checagens fracas": "; ".join(a["fracas"]),
            "Licao": a["licao"], "ID posicao": str(tr.get("pos")), "Nota Obsidian": _slug(tr)}


def fatores(trades, ans):
    """R médio por fator, com IC95%. Só 'conclusivo' com n >= 30 por grupo. Devolve lista de dicts."""
    def grupo(nome, f):
        a = [t["r"] for t, x in zip(trades, ans) if f(t, x)]
        b = [t["r"] for t, x in zip(trades, ans) if not f(t, x)]
        def st(v):
            n = len(v)
            if n == 0: return {"n": 0, "media": None, "ic": None}
            m = sum(v) / n
            sd = math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1)) if n > 1 else 0
            return {"n": n, "media": round(m, 3), "ic": round(1.96 * sd / math.sqrt(n), 3) if n > 1 else None}
        sa, sb = st(a), st(b)
        concl = all(s["n"] >= MIN_N and s["ic"] is not None for s in (sa, sb)) and abs((sa["media"] or 0) - (sb["media"] or 0)) > (sa["ic"] or 0) + (sb["ic"] or 0)
        return {"fator": nome, "com": sa, "sem": sb, "conclusivo": concl}
    return [grupo("hierarquia >= 2 de 3", lambda t, x: (x["hier"] or 0) >= 2),
            grupo("volume >= 0,8x a média", lambda t, x: (x["vol_x"] or 0) >= 0.8),
            grupo("Londres+NY", lambda t, x: x["sessao"] == "Londres+NY"),
            grupo("compra", lambda t, x: t["side"] == "COMPRA"),
            grupo("ouro (contra bitcoin)", lambda t, x: "XAU" in t.get("sym", "XAUUSDm").upper()),
            grupo("não é reentrada", lambda t, x: not x["reentrada"])]


def sync():
    trades = robot.all_trades()
    st = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {"notas": [], "notion": []}
    VAULT.mkdir(parents=True, exist_ok=True)
    ans, novas = [], []
    for i, tr in enumerate(trades):
        a = autopsia(tr, trades[:i]); ans.append(a)
        key = str(tr.get("pos") or tr["open_t"])
        if key not in st["notas"]:
            titulo, md = nota_obsidian(tr, a)
            (VAULT / f"{titulo}.md").write_text(md, encoding="utf-8")
            st["notas"].append(key); novas.append(titulo)
    # a fila do Notion é montada por diario.processar()
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    fs = fatores(trades, ans) if trades else []
    n = len(trades)
    if n:
        med = sum(t["r"] for t in trades) / n
        wins = sum(1 for x in trades if x["result"] > 0)
        md = ["---", "tipo: aprendizado", f"resumo: Painel de aprendizado do Kairos: {n} trades, R médio {med:+.2f}; conclusões só com n>={MIN_N}",
              'projetos: ["[[Kairos (robô de ouro e bitcoin)]]"]', "tags: [aprendizado, trade, diario]", "criado: 2026-09-30", f"atualizado: {datetime.now():%Y-%m-%d}", "---", "",
              "# Painel de aprendizado do Kairos", "",
              f"{n} trades fechados · R médio {med:+.2f} · takes {wins} · loss {n - wins}", "",
              f"Regra: nada aqui muda o robô sozinho. Um fator só é chamado de conclusivo com pelo menos {MIN_N} trades em cada grupo e diferença maior que o IC95%. Até lá, são hipóteses.", "",
              "Ligações: [[Kairos (robô de ouro e bitcoin)]] · [[Robô XAU Reader (MetaTrader 5)]] · método em [[Aprendizado de robô de trading - autópsia por trade e estatística por fator]] · "
              "diário e campos em [[Diário de trading completo - campos, métricas e revisão]] · regra de decisão em [[Decisão por confluência de indicadores no Kairos]] · "
              "resultados dos testes em [[Confluência de indicadores muda entradas e resultado - teste no ouro e bitcoin]] · lista de todas as notas de trade em [[Índice de Trades]].", "",
              "## Estatística por fator", "",
              "| Fator | Com (n · R médio ± IC95) | Sem (n · R médio ± IC95) | Veredito |", "|---|---|---|---|"]
        for f in fs:
            c, s = f["com"], f["sem"]
            fmt = lambda x: f"{x['n']} · {x['media']:+.2f} ± {x['ic']}" if x["n"] and x["ic"] is not None else (f"{x['n']} · {x['media']:+.2f}" if x["n"] else "0")
            md.append(f"| {f['fator']} | {fmt(c)} | {fmt(s)} | {'conclusivo' if f['conclusivo'] else 'amostra pequena' if min(c['n'], s['n']) < MIN_N else 'inconclusivo'} |")
        por = {}
        for x in trades:
            por.setdefault(robot.asset_name(x.get("sym", "XAUUSDm")), []).append(x)
        md += ["", "## Por ativo", ""]
        for nome, lst in por.items():
            md.append(f"- **{nome}:** {len(lst)} trades · {sum(1 for x in lst if x['result'] > 0)} takes · {sum(x['r'] for x in lst):+.2f}R")
        md += ["", "## Trades (do mais recente ao mais antigo)", ""]
        for x, a in reversed(list(zip(trades, ans))):
            md.append(f"- [[{_slug(x)}]] · {robot.asset_name(x.get('sym', 'XAUUSDm'))} · {'TAKE' if x['result'] > 0 else 'LOSS'} {x['r']:+.2f}R · causas: {', '.join(a['causas'])}")
        md += ["", "## Lições acumuladas (hipóteses)", ""]
        md += [f"- [[{_slug(x)}]]: {a['licao']}" for x, a in reversed(list(zip(trades, ans)))]
        (VAULT / "Painel de aprendizado.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    return {"trades": n, "notas_novas": novas, "fatores": fs}


def marcar(ids):
    st = json.loads(STATE.read_text(encoding="utf-8"))
    st["notion"] = sorted(set(st["notion"]) | set(ids))
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=1), encoding="utf-8")
    fila = [f for f in json.loads(QUEUE.read_text(encoding="utf-8")) if f["ID posicao"] not in ids]
    QUEUE.write_text(json.dumps(fila, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--marcar":
        marcar(set(sys.argv[2].split(",")))
        print("marcados")
    else:
        r = sync()
        print(json.dumps({k: v for k, v in r.items() if k != "fatores"}, ensure_ascii=False))
