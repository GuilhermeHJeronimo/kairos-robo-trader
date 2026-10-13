"""Protege a conta enquanto o Testador roda.

O terminal aberto pelo Testador (terminal64.exe /config:...) também liga os robôs que estão anexados aos gráficos do usuário: durante a matriz
da confluência (2026-10-02) o Kairos ao vivo abriu 3 ordens na demo. Este módulo desliga [Experts] Enabled em config\\common.ini só enquanto o
Testador roda e devolve o arquivo exatamente como estava.
"""
import os
import re

DATA = r"C:\Users\SEU_USUARIO\AppData\Roaming\MetaQuotes\Terminal\ID_DO_TERMINAL"
PATH = os.path.join(DATA, "config", "common.ini")
RX = re.compile(r"(\[Experts\][^\[]*?\r?\n\s*Enabled=)\d", re.S | re.I)


BACKUP = PATH + ".kairos_original"


def recuperar():
    """Se uma rodada anterior foi interrompida sem restaurar, devolve o arquivo original agora."""
    if os.path.exists(BACKUP):
        open(PATH, "wb").write(open(BACKUP, "rb").read())
        os.remove(BACKUP)


def ligar():
    """Desliga os robôs ao vivo. Devolve o conteúdo original (bytes) para restaurar, ou None se nada mudou. O original fica também em disco (BACKUP)."""
    recuperar()
    try:
        raw = open(PATH, "rb").read()
    except OSError:
        return None
    utf16 = raw[:2] in (b"\xff\xfe", b"\xfe\xff")
    txt = raw.decode("utf-16" if utf16 else "utf-8", errors="ignore").lstrip("\ufeff")
    new, n = RX.subn(r"\g<1>0", txt, count=1)
    if n == 0 or new == txt:
        return None
    out = ("\ufeff" + new).encode("utf-16-le") if utf16 else new.encode("utf-8")
    if utf16:
        out = b"\xff\xfe" + out[2:] if out[:2] != b"\xff\xfe" else out
    open(BACKUP, "wb").write(raw)
    open(PATH, "wb").write(out)
    return raw


def restaurar(raw):
    if raw is not None:
        open(PATH, "wb").write(raw)
    if os.path.exists(BACKUP):
        os.remove(BACKUP)
