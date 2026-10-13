"""Sentimento das manchetes sobre o bitcoin (mesma ideia do news.py, léxico de cripto). Grava Kairos_BTCUSDm_sentiment.json.

Mesmos limites do ouro: leitura por palavras-chave, sem histórico para provar que ajuda; serve só como veto de segurança.
"""
import json
import re
import threading
import time

import news
import robot

FEEDS = [
    ("Google Notícias: bitcoin", "https://news.google.com/rss/search?q=bitcoin+price+BTC&hl=en-US&gl=US&ceid=US:en"),
    ("Google Notícias: ETF e SEC", "https://news.google.com/rss/search?q=bitcoin+ETF+SEC&hl=en-US&gl=US&ceid=US:en"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Cointelegraph", "https://cointelegraph.com/rss"),
    ("Decrypt", "https://decrypt.co/feed"),
]
F = re.IGNORECASE
BTC = re.compile(r"\b(bitcoin|btc)\b", F)
CRYPTO = re.compile(r"\b(crypto(currenc(y|ies))?|spot (bitcoin )?etfs?|digital assets?)\b", F)
OTHERCOIN = re.compile(r"\b(solana|xrp|ripple|dogecoin|doge|cardano|ada|shiba|pepe|memecoin|altcoins?|polkadot|avalanche|chainlink|litecoin|bnb|tron|sui)\b", F)
SPECIFIC = [
    (r"etf (inflows?|approval|approved)|inflows?", 1.5), (r"record high|all-time high|new (ath|high)", 2.0), (r"institutional (adoption|demand|buying)|treasury (buys|purchase)|strategic reserve", 1.5),
    (r"rate cuts?|dovish|easing|liquidity", 1.0), (r"halving|accumulat", 0.8),
    (r"hack(ed)?|exploit|stolen|theft", -2.0), (r"\bban(s|ned)?\b|crackdown|lawsuit|sues?|charges|investigation|probe", -1.5), (r"outflows?|sell[- ]?off|liquidations?|crash|plunge", -1.5),
    (r"bankrupt|insolven|collapse|fraud", -2.0), (r"rate hikes?|hawkish|higher for longer", -1.2),
]
GENERIC = [
    (r"\b(rall(y|ies|ied)|surg(e|es|ed|ing)|soar(s|ed|ing)?|jump(s|ed)?|climb(s|ed)?|gain(s|ed)?|rebound(s|ed)?|higher|bullish|breakout|upside)\b", 1.0),
    (r"\b(drop(s|ped)?|fall(s|en)?|slump(s|ed)?|tumbl(e|es|ed)|slid(e|es)|declin(e|es|ed)|lower|loses?|lost|weaker|retreat(s|ed)?|bearish|downside|dip(s)?)\b", -1.0),
]
SPECIFIC = [(re.compile(p, F), w) for p, w in SPECIFIC]
GENERIC = [(re.compile(p, F), w) for p, w in GENERIC]
_lock = threading.Lock()
_cache = {"t": 0, "data": None}


def relevant(title):
    if OTHERCOIN.search(title) and not BTC.search(title):
        return False
    return bool(BTC.search(title) or CRYPTO.search(title))


def score_headline(title):
    s = sum(w for rx, w in SPECIFIC if rx.search(title))
    if BTC.search(title):
        s += sum(w for rx, w in GENERIC if rx.search(title))
    return max(-3.0, min(3.0, s))


def label_for(score):
    return ("muito positivo para o bitcoin" if score >= 50 else "positivo para o bitcoin" if score >= 20 else
            "muito negativo para o bitcoin" if score <= -50 else "negativo para o bitcoin" if score <= -20 else "neutro")


def build():
    now = time.time()
    items, ok, bad = [], [], []
    for name, url in FEEDS:
        try:
            items += news._parse(news._fetch(url), name); ok.append(name)
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
        w = 0.5 ** (age_h / 12.0)
        it["score"] = score_headline(it["title"]); it["age_h"] = round(age_h, 1)
        num += it["score"] * w; den += w
    avg = num / den if den else 0.0
    score = int(round(100 * max(-1.0, min(1.0, avg / 2.0))))
    top = sorted(uniq, key=lambda i: (-abs(i["score"]) * (0.5 ** (i["age_h"] / 12.0)), i["age_h"]))[:14]
    return {"score": score, "label": label_for(score), "epoch_utc": int(now), "updated": time.strftime("%Y-%m-%d %H:%M:%S"),
            "n_headlines": len(uniq), "n_scored": sum(1 for i in uniq if i["score"] != 0), "sources_ok": ok, "sources_failed": bad,
            "headlines": [{"title": i["title"], "source": i["source"], "age_h": i["age_h"], "score": i["score"]} for i in top]}


def get(max_age=600):
    with _lock:
        if _cache["data"] is None or time.time() - _cache["t"] > max_age:
            d = build()
            _cache.update(t=time.time(), data=d)
            try:
                slim = {k: d[k] for k in ("score", "label", "epoch_utc", "updated", "n_headlines")}
                (robot.FILES / "Kairos_BTCUSDm_sentiment.json").write_text(json.dumps(slim, ensure_ascii=True, separators=(",", ":")), encoding="ascii")
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
    print(f"nota {d['score']:+d} ({d['label']}) com {d['n_headlines']} manchetes; fontes ok: {d['sources_ok']}; falharam: {d['sources_failed']}")
    for h in d["headlines"][:8]:
        print(f"  {h['score']:+.1f} | {h['age_h']:>4}h | {h['title'][:100]}")
