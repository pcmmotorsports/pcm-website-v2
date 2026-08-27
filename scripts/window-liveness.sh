#!/bin/sh
# window-liveness.sh — 一行印出各施工窗「最後一次有動靜」是多久以前。
#
# 🔴 射程(先讀這段,否則會被誤用):
#   本腳本答的是「這個 session 最後一次【產生對話輪次或 tool call】是多久以前」。
#   它【不是】「這個窗有沒有在工作」——
#     · 一個窗可以正在【想】(模型推理中、還沒吐出任何一筆)⇒ 本腳本看它是靜的
#     · 一個窗可以正在跑一支 10 分鐘的測試 ⇒ 那 10 分鐘內它也是靜的
#   ⇒ 所以「靜」的正確讀法是【要去問一下】,不是【它死了】。
#
# 🔴 為什麼不用 git log / 檔案 mtime:
#   commit 只在收工那一刻動;唯讀複驗窗可以整輪不動任何檔(2026-08-18 V 窗自己就是這樣)。
#   ⇒ 那兩個訊號會把「認真在唯讀量測的窗」判成死的。
#   transcript(~/.claude/projects/<專案>/<sessionId>.jsonl)則是【每一輪都 append】,
#   含唯讀 tool call ⇒ 靈敏度足夠。
#
# 用法: sh scripts/window-liveness.sh [靜的門檻分鐘數,預設 10]
#
# 兩個世界實跑對照(建立本腳本時,2026-08-18 01:1x;可重跑):
#   ● 動 9 個 —— 與 `ListAgents` 當下列出的 9 個 peer **數量一致**;
#              且本腳本【看得見自己】(跑它的那個 session 動作欄就是 `Bash sh scripts/window-liveness.sh`)
#   ○ 靜 7 個 —— 動作欄全是「交接信寫好了,停手」「[Request interrupted by user]」
#              = 已 clear / 已結束的前任 session(其中 a1f6e2d6 就是本窗的前任),96 分鐘沒動
#   ⇒ 兩個世界印出不同的東西,不是恆真。
#
# ⚠️ **沒有活體樣本可測的那一格(誠實缺口)**:
#   「程序卡死但看起來還在跑」(2026-08-18 曾有四隻卡在 `uptime` 各 90% CPU)——
#   設計上它會被判「靜」(jsonl 停在發出那道命令的時刻、不再 append),**但我沒有活體可驗**。
#   要驗:找一個當場卡住的 session,看它是不是真的落到 ○。

set -u
THRESHOLD_MIN="${1:-10}"
DIR="$HOME/.claude/projects/-Users-sean-1-pcm-website-v2"

[ -d "$DIR" ] || { echo "找不到 transcript 目錄: $DIR"; exit 1; }

python3 - "$DIR" "$THRESHOLD_MIN" <<'PY'
import json, os, subprocess, sys, time

directory, threshold_min = sys.argv[1], int(sys.argv[2])
now = time.time()
rows = []

for name in os.listdir(directory):
    if not name.endswith('.jsonl'):
        continue
    path = os.path.join(directory, name)
    age_min = (now - os.path.getmtime(path)) / 60
    if age_min > 6 * 60:           # 6 小時以上不列,那是歷史檔不是窗(要看全部改這個數)
        continue
    # 🔴 認窗【不能用 cwd】—— 實測全部 session 的 cwd 都是主樹 pcm-website-v2/dev
    #    (各窗操作不同 worktree,但 session 本身是從主樹啟動的)⇒ 那一欄零辨識力。
    #    改印「最後一個動作」:主視窗看動作就認得出是哪個窗在做什麼。
    tail = subprocess.run(['tail', '-40', path], capture_output=True, text=True).stdout
    action = '?'
    for line in reversed(tail.splitlines()):
        try:
            d = json.loads(line)
        except Exception:
            continue
        content = (d.get('message') or {}).get('content')
        if not isinstance(content, list):
            continue
        for c in reversed(content):
            if c.get('type') == 'tool_use':
                inp = c.get('input') or {}
                hint = inp.get('command') or inp.get('file_path') or inp.get('summary') or inp.get('pattern') or ''
                action = f"{c.get('name')} {str(hint)[:42]}"
                break
            if c.get('type') == 'text' and c.get('text', '').strip():
                action = '(文字) ' + c['text'].strip().replace('\n', ' ')[:42]
                break
        if action != '?':
            break
    rows.append((age_min, action, name[:8]))

rows.sort()
print(f"{'狀態':<6}{'幾分前':>7}  {'session':<10}最後一個動作")
for age, action, sid in rows:
    state = '● 動' if age <= threshold_min else '○ 靜'
    print(f"{state:<6}{age:>7.1f}  {sid:<10}{action}")

quiet = sum(1 for r in rows if r[0] > threshold_min)
print(f"\n共 {len(rows)} 個 session:動 {len(rows) - quiet} / 靜 {quiet}(門檻 {threshold_min} 分鐘)")
print("🔴 「靜」= 要去問一下,不等於死了(可能正在想、或正在跑長測試)")
PY
