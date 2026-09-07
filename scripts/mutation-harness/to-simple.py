import io
# 🔴 把那一格【降級回我第一版】(codex 說「保留標題與說明也會過」的那一版)
#    ⚠️ 這是【重建的】—— 它沒有被 commit 過(我在同一輪裡就加強了)
#    ⇒ 所以下面的「修前」數字是【對一個重建的基準】量的, 不是對一個歷史版本
import sys, os

p = 'apps/admin/src/app/orders/[id]/refund-wiring.test.tsx'

# ── --selftest ────────────────────────────────────────────────────────────────
# 🔴 本支的失敗形狀是【切點對不上而它安靜地什麼都沒做】——
#    那會讓「簡版」其實是現版 ⇒ 前後對照印出兩組一樣的數 ⇒ 而那看起來像「加強沒有用」。
#    ⇒ 所以自檢問的是【兩個切點各在不在, 而且順序對】, 不是「檔案在不在」。
if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
    A = "    // 🔴🔴 **codex `gpt-6-astra` 2026-09-08 打掉了上面那兩行的宣稱**"
    B = "    // 🔵 **保留原本那行內文斷言**"
    if not os.path.exists(p):
        print('selftest 跳過:找不到目標檔(可能從別的 cwd 呼叫)—— 不冒稱通過')
        sys.exit(0)
    t = io.open(p, encoding='utf-8').read()
    problems = []
    if t.count(A) != 1:
        problems.append('起點 anchor 命中 %d 處(期望 1)' % t.count(A))
    if t.count(B) != 1:
        problems.append('終點 anchor 命中 %d 處(期望 1)' % t.count(B))
    if not problems and t.index(A) >= t.index(B):
        problems.append('起點排在終點之後 ⇒ 切出來的範圍是空的或反的')
    if problems:
        print('🔴 selftest 失敗:')
        for x in problems:
            print('  · ' + x)
        sys.exit(1)
    print('selftest 通過:兩個切點各命中 1 處而且順序正確')
    sys.exit(0)
s = io.open(p, encoding='utf-8').read()
a = s.index("    // 🔴🔴 **codex `gpt-6-astra` 2026-09-08 打掉了上面那兩行的宣稱**")
b = s.index("    // 🔵 **保留原本那行內文斷言**", a)
io.open(p, 'w', encoding='utf-8').write(s[:a] + s[b:])
print('降級成簡版:只剩兩行字串斷言')
