"""Sentimento das manchetes sobre o ouro, fora do MetaTrader.

Busca manchetes em feeds RSS públicos (Google Notícias, Yahoo Finanças, FXStreet), mantém só as que mexem com o
preço do ouro (sobre o próprio ouro, ou sobre Fed/dólar/juros dos EUA), pontua cada uma por palavras-chave típicas
do ouro (alta/baixa) com peso maior para as mais recentes, e grava MQL5\\Files\\XAU_Reader_sentiment.json, que o
robô lê para vetar operações contra um sentimento extremo. Também alimenta o painel (/api/news).

LIMITES (importante): é uma leitura por palavras-chave, simples, sem entender contexto ou ironia; não existe
histórico de manchetes para testar se ela ajuda a prever preço. Trate como um filtro de segurança, nunca como gatilho.
"""
import json
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import robot

FEEDS = [
    ("Google Notícias: ouro", "https://news.google.com/rss/search?q=gold+price+XAUUSD&hl=en-US&gl=US&ceid=US:en"),
    ("Google Notícias: Fed e dólar", "https://news.google.com/rss/search?q=Fed+dollar+gold+yields&hl=en-US&gl=US&ceid=US:en"),
    ("Yahoo Finanças: GC=F", "https://feeds.finance.yahoo.com/rss/2.0/headline?s=GC=F&region=US&lang=en-US"),
    ("FXStreet", "https://www.fxstreet.com/rss/news"),
]
FLAGS = re.IGNORECASE
GOLD = re.compile(r"\b(gold|xau|bullion|precious metals?)\b", FLAGS)
USMACRO = re.compile(r"\b(fed|fomc|powell|dxy|dollar index|treasury yields?|10-year yields?|pce|payrolls?|"
                     r"(us|u\.s\.|american) (dollar|inflation|cpi|jobs|yields?|economy|data))\b", FLAGS)
OTHERFX = re.compile(r"\b(canadian|australian|new zealand|kiwi|aussie|indian|rupee|yen|euro|sterling|pound|swiss|franc|peso|"
                     r"rand|lira|yuan|rouble|ruble|won|krona|ringgit|baht)\b", FLAGS)
MINERS = re.compile(r"\b(intercepts?|drill(ing)?|mining|miners?|explorers?|resources|corp|ltd|inc|shares|earnings|dividend|"
                    r"announces|reports? (results|earnings)|project|discover(y|ies)|ipo)\b", FLAGS)


def relevant(title):
    """Só manchetes que mexem com o preço do ouro."""
    if GOLD.search(title):
        return not MINERS.search(title)
    return bool(USMACRO.search(title)) and not OTHERFX.search(title)


# Palavras ESPECÍFICAS (valem em qualquer manchete relevante): (padrão, peso), + a favor do ouro, − contra
SPECIFIC = [
    (r"record high|all-time high|fresh (record )?high", 2.0), (r"safe[- ]haven|haven demand|flight to safety", 1.5),
    (r"rate cuts?|cuts? rates|dovish|easing|stimulus", 1.5),
    (r"weak(er|ens|ening)? (us )?dollar|dollar (index )?(falls?|slips?|drops?|weakens?|declines?|retreats?|slides?)", 1.5),
    (r"yields? (fall|drop|slip|decline|retreat|slide|tumble)|lower yields", 1.2),
    (r"geopolitic|tensions?|\bwar\b|conflict|crisis", 1.0), (r"central banks? (buy|buying|purchase)|etf inflows?", 1.5),
    (r"sell[- ]?off|profit[- ]taking", -1.5), (r"rate hikes?|hikes? rates|hawkish|higher for longer|tightening", -1.5),
    (r"strong(er)? (us )?dollar|dollar (index )?(rises?|gains?|strengthens?|jumps?|climbs?|rallies|surges?)", -1.5),
    (r"yields? (rise|jump|climb|surge|spike|gain)|higher yields", -1.2), (r"cease[- ]?fire|peace (deal|talks)|de-escalat|risk[- ]on", -1.0),
    (r"strong (jobs|payrolls|data)|hot (cpi|inflation)", -0.8),
]
# Palavras GENÉRICAS de movimento: só valem quando a manchete é sobre o próprio ouro
GENERIC = [
    (r"\b(rall(y|ies|ied)|surg(e|es|ed|ing)|soar(s|ed|ing)?|jump(s|ed)?|climb(s|ed)?|gain(s|ed)?|advance(s|d)?|rebound(s|ed)?|higher|bullish|upside)\b", 1.0),
    (r"breaks? above|support holds?", 1.0),
    (r"\b(drop(s|ped)?|fall(s|en)?|slump(s|ed)?|tumbl(e|es|ed)|plung(e|es|ed)|slid(e|es)|declin(e|es|ed)|lower|loses?|lost|weaker|retreat(s|ed)?|bearish|downside)\b", -1.0),
    (r"breaks? below|resistance", -1.0),
]
SPECIFIC = [(re.compile(p, FLAGS), w) for p, w in SPECIFIC]
GENERIC = [(re.compile(p, FLAGS), w) for p, w in GENERIC]
_lock = threading.Lock()
_cache = {"t": 0, "data": None}


def _fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _parse(xml_bytes, feed_name):
    out = []
    root = ET.fromstring(xml_bytes)
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        if not title:
            continue
        try:
            ts = parsedate_to_datetime(it.findtext("pubDate")).timestamp()
        except Exception:
            ts = time.time()
        src = (it.findtext("source") or "").strip() or feed_name
        out.append({"title": re.sub(r"\s+", " ", title), "ts": ts, "source": src})
    return out


def score_headline(title):
    s = sum(w for rx, w in SPECIFIC if rx.search(title))
    if GOLD.search(title):
        s += sum(w for rx, w in GENERIC if rx.search(title))
    return max(-3.0, min(3.0, s))


def label_for(score):
    return ("muito positivo para o ouro" if score >= 50 else "positivo para o ouro" if score >= 20 else
            "muito negativo para o ouro" if score <= -50 else "negativo para o ouro" if score <= -20 else "neutro")


def build():
    now = time.time()
    items, ok, bad = [], [], []
    for name, url in FEEDS:
        try:
            items += _parse(_fetch(url), name); ok.append(name)
        except Exception as e:
            bad.append(f"{name}: {type(e).__name__}")
    seen, uniq = set(), []
    for it in sorted(items, key=lambda x: -x["ts"]):
        key = re.sub(r"\W+", "", it["title"].lower())[:80]
        if key in seen or not relevant(it["title"]) or now - it["ts"] > 48 * 3600:
            continue
        seen.add(key); uniq.append(it)
    num = den = 0.0
    for it in uniq:
        age_h = max(0.0, (now - it["ts"]) / 3600)
        w = 0.5 ** (age_h / 12.0)                       # meia-vida de 12 horas
        it["score"] = score_headline(it["title"]); it["age_h"] = round(age_h, 1)
        num += it["score"] * w; den += w
    avg = num / den if den else 0.0
    score = int(round(100 * max(-1.0, min(1.0, avg / 2.0))))
    top = sorted(uniq, key=lambda i: (-abs(i["score"]) * (0.5 ** (i["age_h"] / 12.0)), i["age_h"]))[:14]
    return {"score": score, "label": label_for(score), "epoch_utc": int(now), "updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "n_headlines": len(uniq), "n_scored": sum(1 for i in uniq if i["score"] != 0), "sources_ok": ok, "sources_failed": bad,
            "headlines": [{"title": i["title"], "source": i["source"], "age_h": i["age_h"], "score": i["score"]} for i in top]}


def get(max_age=600):
    """Resultado em cache (recalcula depois de max_age segundos) e grava o arquivo lido pelo robô."""
    with _lock:
        if _cache["data"] is None or time.time() - _cache["t"] > max_age:
            d = build()
            _cache.update(t=time.time(), data=d)
            try:                                        # o robô lê só os campos simples (ASCII)
                slim = {k: d[k] for k in ("score", "label", "epoch_utc", "updated", "n_headlines")}
                txt = json.dumps(slim, ensure_ascii=True, separators=(",", ":"))
                for fn in ("XAU_Reader_sentiment.json", "Kairos_XAUUSDm_sentiment.json"):      # nome antigo (XAU_Reader) e do Kairos
                    (robot.FILES / fn).write_text(txt, encoding="ascii")
            except Exception:
                pass
        return _cache["data"]


def loop(every=600):
    while True:
        try:
            get(max_age=0)
        except Exception:
            pass
        time.sleep(every)


if __name__ == "__main__":
    d = build()
    print(f"nota {d['score']:+d} ({d['label']}) com {d['n_headlines']} manchetes relevantes; fontes ok: {d['sources_ok']}; falharam: {d['sources_failed']}")
    for h in d["headlines"][:10]:
        print(f"  {h['score']:+.1f} | {h['age_h']:>4}h | {h['title'][:105]}")
