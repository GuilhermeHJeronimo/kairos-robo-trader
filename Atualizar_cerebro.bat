@echo off
rem Fecha o MT5, refaz os dados do Testador, treina o cerebro do Kairos e reabre o MT5 (posicoes abertas ficam com stop e alvo).
cd /d "%~dp0"
python cerebro\atualizar.py
pause
