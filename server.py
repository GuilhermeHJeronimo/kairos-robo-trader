"""Servidor local do painel do Kairos (robô de ouro e bitcoin no MetaTrader 5).

Rodar:  python server.py   ->  http://localhost:8000
(O antigo leitor de gráfico está em legado/.)
"""
import json
import os
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import diario
import relatorio_diario
import learning
import news
import news_btc
import robot
import validacao

BASE = Path(__file__).parent


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, fn):
        try:
            return self._send(200, json.dumps(fn(), ensure_ascii=False).encode(), "application/json")
        except Exception as e:
            return self._send(500, json.dumps({"error": str(e)}).encode(), "application/json")

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        p = u.path
        q = urllib.parse.parse_qs(u.query)
        sym = (q.get("sym", [robot.DEFAULT_SYM])[0] or robot.DEFAULT_SYM)
        if sym not in set(robot.symbols() or [robot.DEFAULT_SYM]):
            sym = robot.DEFAULT_SYM
        if p == "/api/robots":
            return self._json(robot.overview)
        if p == "/api/robot":
            return self._json(lambda: robot.snapshot(sym))
        if p == "/api/robot/diary":
            return self._json(diario.cartoes)
        if p == "/api/robot/validation":
            return self._json(validacao.dados)
        if p == "/api/robot/learning":
            return self._json(learning.sync)
        if p == "/api/news":
            return self._json(news_btc.get if "BTC" in sym.upper() else news.get)
        m = re.match(r"^/graficos/(\d{3,20})\.(html|svg)$", p)
        if m:
            fp = BASE / "graficos" / f"{m.group(1)}.{m.group(2)}"
            if not fp.exists():
                return self._send(404, b"sem grafico ainda", "text/plain")
            return self._send(200, fp.read_bytes(), "text/html; charset=utf-8" if m.group(2) == "html" else "image/svg+xml")
        if p == "/api/robot/trades.csv":
            body = robot.trades_csv().encode("utf-8")
            self.send_response(200); self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="operacoes_robo.csv"'); self.send_header("Content-Length", str(len(body)))
            self.end_headers(); self.wfile.write(body); return
        if p in ("/", "/robo", "/robo.html", "/index.html"):
            return self._send(200, (BASE / "robo.html").read_bytes(), "text/html; charset=utf-8")
        if p.startswith("/assets3d/"):                       # modelos 3D (Kenney, CC0) e Three.js, só leitura e só dentro da pasta assets3d
            rel = urllib.parse.unquote(p[len("/assets3d/"):])
            f = (BASE / "assets3d" / rel).resolve()
            ok = str(f).startswith(str((BASE / "assets3d").resolve())) and f.is_file() and f.suffix.lower() in (".glb", ".js", ".png", ".txt")
            if not ok:
                return self._send(404, b"nao encontrado", "text/plain")
            ct = {".glb": "model/gltf-binary", ".js": "application/javascript", ".png": "image/png", ".txt": "text/plain"}[f.suffix.lower()]
            return self._send(200, f.read_bytes(), ct)
        if p.startswith("/assets2d/"):                       # sprites 2D (OPP, domínio público), só leitura e só imagens
            rel = urllib.parse.unquote(p[len("/assets2d/"):])
            f = (BASE / "assets2d" / rel).resolve()
            if not (str(f).startswith(str((BASE / "assets2d").resolve())) and f.is_file() and f.suffix.lower() == ".png"):
                return self._send(404, b"nao encontrado", "text/plain")
            return self._send(200, f.read_bytes(), "image/png")
        if p == "/escritorio_sprites.js":
            return self._send(200, (BASE / "escritorio_sprites.js").read_bytes(), "application/javascript; charset=utf-8")
        if p == "/escritorio3d.js":
            return self._send(200, (BASE / "escritorio3d.js").read_bytes(), "application/javascript; charset=utf-8")
        if p == "/vila.js":
            return self._send(200, (BASE / "vila.js").read_bytes(), "application/javascript; charset=utf-8")
        if p == "/escritorio.js":
            return self._send(200, (BASE / "escritorio.js").read_bytes(), "application/javascript; charset=utf-8")
        if p == "/lightweight-charts.js":
            return self._send(200, (BASE / "lightweight-charts.js").read_bytes(), "application/javascript")
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        host = (self.headers.get("Host") or "").split(":")[0]
        if u.path != "/api/robot/command":
            return self._send(404, b"not found", "text/plain")
        if host not in ("localhost", "127.0.0.1") or self.headers.get("X-XAUR") != "1":
            return self._send(403, b'{"error":"acesso negado"}', "application/json")     # protege contra páginas de outros sites
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            cmd = body.get("cmd")
            if cmd in ("close_all", "stop") and body.get("confirm") is not True:
                return self._send(400, b'{"error":"este comando exige confirmacao"}', "application/json")
            target = body.get("sym") or robot.DEFAULT_SYM
            cid = robot.send_command(cmd, target, body.get("value"))
            return self._send(200, json.dumps({"ok": True, "id": cid, "cmd": cmd, "sym": target}).encode(), "application/json")
        except Exception as e:
            return self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    def _learn_loop():                                                # autópsia dos trades novos -> notas do Obsidian + fila do Notion
        while True:
            try:
                diario.processar()
                relatorio_diario.gerar()                 # relatório do dia (00:00 a 23:59 no relógio do PC) e arquivo dos dias anteriores
            except Exception as e:
                print("[aprendizado]", e)
            time.sleep(60)
    threading.Thread(target=_learn_loop, daemon=True).start()
    threading.Thread(target=news.loop, daemon=True).start()          # sentimento das manchetes do ouro, a cada 10 min
    threading.Thread(target=news_btc.loop, daemon=True).start()      # e do bitcoin
    port = int(os.environ.get("XAUR_PORT", "8000"))
    class _Srv6(ThreadingHTTPServer):          # "localhost" costuma tentar ::1 primeiro; sem ouvir nele cada pedido perdia ~0,2 s
        address_family = __import__("socket").AF_INET6
    try:
        threading.Thread(target=_Srv6(("::1", port), Handler).serve_forever, daemon=True).start()
    except OSError as e:
        print("[aviso] sem escuta em ::1:", e)
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Painel do Kairos em http://localhost:8000  (Ctrl+C para parar)")
    srv.serve_forever()
