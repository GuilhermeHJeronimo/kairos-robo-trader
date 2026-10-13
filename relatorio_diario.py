"""Relatório diário: o dia vai de 00:00 a 23:59 no relógio do PC. Cada dia com entradas vira um arquivo (relatorios/AAAA-MM-DD.json) e uma nota
no Obsidian (Mente/08 Trades/Dias/Dia AAAA-MM-DD.md) ligada aos trades, ao painel de aprendizado e ao projeto. O de hoje é atualizado a cada minuto;
quando vira o dia o relatório do dia anterior fica fechado (é o "reinício das 00h": o painel passa a mostrar só o dia novo e o histórico fica guardado)."""
import json
import os
from datetime import datetime
from pathlib import Path

import learning
import robot

AQUI = Path(__file__).parent
PASTA = AQUI / "relatorios"
NOTAS = learning.VAULT / "Dias"


def _dias():
    por = {}
    for t in robot.all_trades():
        d = robot.local_date(t["close_t"])
        por.setdefault(d, {"fechados": [], "abertos": 0})["fechados"].append(t)
    for sym in robot.symbols() or [robot.DEFAULT_SYM]:
        for e in robot.read_journal(limit=100000, sym=sym)["events"]:
            if e["ev"] == "ABRIU":
                por.setdefault(robot.local_date(e["t"]), {"fechados": [], "abertos": 0})["abertos"] += 1
    return por


def gerar():
    PASTA.mkdir(exist_ok=True)
    NOTAS.mkdir(parents=True, exist_ok=True)
    hoje = robot.hoje_br().strftime("%Y-%m-%d")
    feitos = []
    for dia, d in sorted(_dias().items()):
        trs = d["fechados"]
        ativos = {}
        for t in trs:
            ativos.setdefault(robot.asset_name(t.get("sym", "XAUUSDm")), []).append(t)
        resumo = {"dia": dia, "fechado": dia != hoje, "entradas": d["abertos"], "fechados": len(trs), "takes": sum(1 for t in trs if t["r"] > 0),
                  "usd": round(sum(t["result"] for t in trs), 2), "r": round(sum(t["r"] for t in trs), 2),
                  "por_ativo": {a: {"fechados": len(v), "takes": sum(1 for t in v if t["r"] > 0), "usd": round(sum(t["result"] for t in v), 2), "r": round(sum(t["r"] for t in v), 2)} for a, v in ativos.items()}}
        arq = PASTA / f"{dia}.json"
        novo = json.dumps(resumo, ensure_ascii=False, indent=1)
        if not arq.exists() or arq.read_text(encoding="utf-8") != novo:
            arq.write_text(novo, encoding="utf-8")
        linhas = ["---", "tipo: trade", f"resumo: Dia {dia}: {d['abertos']} entradas, {len(trs)} fechados, {resumo['takes']} takes, {resumo['r']:+.2f}R (US$ {resumo['usd']:+.2f})",
                  'projetos: ["[[Kairos (robô de ouro e bitcoin)]]"]', "tags: [trade, dia, relatorio]", f"criado: {dia}", f"atualizado: {datetime.now():%Y-%m-%d}", "---", "",
                  f"# Dia {dia}" + ("" if dia != hoje else " (em andamento)"), "",
                  f"- **Entradas abertas:** {d['abertos']} · **Fechados:** {len(trs)} · **Takes:** {resumo['takes']} · **Resultado:** {resumo['r']:+.2f}R · US$ {resumo['usd']:+.2f}",
                  "- O dia vai de 00:00 a 23:59 no relógio do PC (horário do servidor da corretora = UTC).", ""]
        for a, v in ativos.items():
            linhas += [f"## {a}", ""] + [f"- [[{learning._slug(t)}]] · {t['side']} · {'TAKE' if t['r'] > 0 else 'LOSS'} {t['r']:+.2f}R · {t['minutes']} min" for t in sorted(v, key=lambda x: x["close_t"])] + [""]
        if not trs:
            linhas += ["_Nenhum trade fechado neste dia._", ""]
        linhas += ["Ver [[Painel de aprendizado]] e [[Kairos (robô de ouro e bitcoin)]]."]
        nota = NOTAS / f"Dia {dia}.md"
        texto = "\n".join(linhas) + "\n"
        if not nota.exists() or nota.read_text(encoding="utf-8") != texto:
            nota.write_text(texto, encoding="utf-8")
        feitos.append(dia)
    return feitos


if __name__ == "__main__":
    print(gerar())
