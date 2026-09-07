#!/usr/bin/env python3
"""late-helper-shadow-gate.py — 擋「函式定義在使用點之後, 而那個名字撞得到系統指令」。

🔴 為什麼有這一道(2026-09-07 實錘, 不是設計偏好):
   `harvest-chain.sh` 的 `say()` 定義在 `:442`, 而 `--selftest` 在 `:318` 就用到它
   ⇒ 那個時點 `say` 解析到 **`/usr/bin/say`** ⇒ **機器把 gate 訊息一句一句唸出來**,
   而 Sean 就在旁邊。🎯 執行者這一端【零訊號】:畫面與正常跑一模一樣, 差別在喇叭上,
   而聲音不留痕跡 ⇒ 事後也查不到。

🛑 本支【只讀不跑】—— 不執行任何被掃的腳本(那正是上一個坑)。
🟡 **只報不擋(rc 恆 0)**:跨檔定義會誤報 —— `scripts/b2s2b-tsync-cells.sh:28` 用 `log`,
   而入口 `scripts/b2s2b-verify.sh:288` 自己定義了 `log()`(`:1992` 才呼叫)⇒ 兩條路都安全。
   ⇒ 由人 triage。**答不出 / 會誤報的**(R1 逐項餵過):
     · 動態呼叫(eval / 變數當指令)· `source` 進來的定義 · `.py` / `.ts` 那一側
     · **heredoc 內文**:`cat <<EOF` 裡出現那個名字會被當成呼叫 ⇒ 誤報(R1 實測)
     · 🔵 而**前綴不會誤報**:`logger` 不會被當成 `log`、字串中間的字也不會(R1 實測)
   ⚠️ **射程**:`which()` 用的是**跑這支閘那台機器當下的 PATH** ⇒ 換一台機器可能給不同答案。
     那正好對應事故場景(執行者本機的 PATH 撞到 `/usr/bin/say`), 而它不是一個跨機器的斷言。

用法:`python3 scripts/late-helper-shadow-gate.py [--selftest]`
退出碼:0 = 掃完(不論幾處)· 1 = selftest 失敗 · 2 = 一支檔都沒掃到(尺沒接上)
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNC = re.compile(r'^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{')


def offends(lines, which=shutil.which):
    """回 [(名字, 使用行, 定義行)] —— 定義在使用點之後, 而那個名字撞得到 PATH。"""
    defs = {}
    for i, t in enumerate(lines, 1):
        m = FUNC.match(t)
        if m:
            defs.setdefault(m.group(1), i)
    out = []
    for name, dl in defs.items():
        if not which(name):
            continue          # 撞不到 PATH ⇒ 落到未定義會報錯 ⇒ 吵但不危險
        # 🔴 `^` 後面要允許縮排 —— 第一版沒有, 而那些呼叫都在函式體裡(有縮排),
        #    它因此漏掉了今晚那一個, 是正對照把讀數判作廢才發現的。
        use = re.compile(r'(^\s*|[;&|(]\s*|\$\(\s*|`\s*)' + re.escape(name) + r'(\s|$)')
        for i in range(dl - 1):
            st = lines[i].strip()
            if st and not st.startswith('#') and not FUNC.match(lines[i]) and use.search(lines[i]):
                out.append((name, i + 1, dl))
                break
    return out


WORLDS = [
    ('① 定義在使用點之後 + 撞 PATH ⇒ 要報', ['f() {', '  say "hi"', '}', 'say() { :; }'], 1),
    ('② 定義在使用點之前 ⇒ 不報(正對照)', ['say() { :; }', 'f() {', '  say "hi"', '}'], 0),
    ('③ 撞不到 PATH 的名字 ⇒ 不報(負對照)', ['f() {', '  zzqvx7719 x', '}', 'zzqvx7719() { :; }'], 0),
]

if '--selftest' in sys.argv[1:]:
    bad = 0
    for label, lines, want in WORLDS:
        got = len(offends(lines, which={'say': '/usr/bin/say'}.get))
        bad += 0 if got == want else 1
        print(f"  {'✅' if got == want else '🔴'} {label}(得 {got} 期望 {want})")
    print(f'  ⇒ {len(WORLDS) - bad} PASS / {bad} FAIL')
    sys.exit(1 if bad else 0)

hits, scanned = [], 0
for d in ('scripts', '.husky'):
    for dp, _, fs in os.walk(os.path.join(ROOT, d)):
        for fn in fs:
            if not (fn.endswith('.sh') or fn in ('pre-commit', 'pre-push')):
                continue
            p = os.path.join(dp, fn)
            scanned += 1
            for name, u, dl in offends(open(p, encoding='utf-8', errors='replace').read().split('\n')):
                hits.append(f'{os.path.relpath(p, ROOT)}:{u} 用了 `{name}`, 定義在 :{dl}'
                            f' ⇒ 那時解析到 {shutil.which(name)}')
# 🔴 掃到 0 支檔【不是乾淨】—— 那與「尺沒接上」印同一個 0
if scanned == 0:
    # 🔴 `sys.exit('字串')` 的 rc 是 **1** 不是 2(R1 實測)—— 而檔頭寫 2 ⇒ 字面與事實不符。
    #    修事實不是修字面:要分辨「尺沒接上」與其他失敗, 就得真的吐 2。
    print('🔴 一支檔都沒掃到 ⇒ 這不是乾淨, 是尺沒接上', file=sys.stderr)
    sys.exit(2)
print(f'late-helper 掃了 {scanned} 支檔(只讀不跑)· 命中 {len(hits)} 處')
for h in hits:
    print('  ' + h)
if hits:
    print('  🟡 只報不擋 —— 跨檔定義會誤報(見檔頭已知形狀), 由人 triage')
