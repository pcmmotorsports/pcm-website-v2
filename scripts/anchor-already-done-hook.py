#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""anchor-already-done-hook — 有人【開始做一件事】的那一刻, 自動問「它是不是已經被做掉了」。

🔴 成因(2026-09-02, 寫它的人自己就是病人):
   我接下 ⟦b4-SHIPUNVOID1⟧, 花一小時寫了一支 probe 證明那個缺陷不存在。
   而 `scripts/shipunvoid1-apply-probe.sh` **早就存在**、實跑 PASS=14 FAIL=0,
   涵蓋的世界比我多四個;修它的 commit `7d2be3be` 也在 log 裡, 碼裡 12 個落點。
   ⇒ 一發 `bash scripts/is-this-still-true.sh SHIPUNVOID` 就會全部印出來。
   🛑 **機制全部都在。缺的只有【我沒跑那一發】。**

📌 而我為什麼不會想到要跑它:我的入口是板上一列, 而它是 `open` ——
   **`open` 這個字本身就是「還沒有人做」這個假設, 所以它不會觸發我去驗它。**
   ⇒ ⇒ 所以這件事不能靠「記得跑」, 也不能靠在派工單寫一行(那是【提醒】不是【機制】,
      而 CLAUDE.md §4 機制優先律逐字說提醒無效、實證復發 9+ 次)。

🎯 本 hook 的形狀:**不問人, 自己跑。**
   看到文字裡出現板上錨 ⟦xx-XXXX⟧ ⇒ 當場跑 is-this-still-true.sh ⇒ 把結果貼回脈絡。
   每個錨每個 session 只跑一次(快取), 所以它不會變成雜訊。

🛑 射程(照實寫, 不要讀寬):
   · 它只認【⟦…⟧ 形狀的錨】。用白話派的工("去看看出貨信那件")一律漏掉。
   · 🔴 **它分不出「修了它」與「講了它」** —— 一顆只是在 commit body 裡【講述】這個錨的
     `feat`/`fix`, 會與真正做掉它的那一顆一起掛 ⭐, 而且可能排在前面。
     📌 **實例:本檔自己那顆 `feat(config)` commit 之後 12 分鐘, 就排到 `7d2be3be` 前面了。**
     ⇒ ⇒ 型別排序比時間排序好, 而它仍然只是【把候選集縮小】, 不是【給答案】。
     🛑 **所以那幾行的用途是「去開這幾顆看看」, 不是「這件已經做完了」。**
     ⇒ 而輸出裡那句「開工前先看這幾顆是不是已經把它做掉了」就是照這個界線寫的, 不要改成斷言句。
   · UserPromptSubmit 只涵蓋【打字/貼進來的】—— 跨 session 訊息派工不走這個事件 ⇒ 漏。
     ⇒ 所以同時掛 Write|Edit:那涵蓋「他開始寫東西了」, 較晚但補得到上面那個洞。
   · 它只【印出來】, 不擋。⇒ 一個人可以照樣無視它。**這道是照明, 不是閘。**
   · is-this-still-true.sh 自己的射程(掃不到別的 session 的對話 / 正式庫 / OD 稿 / 別的 repo)照舊。
"""
import json, os, re, subprocess, sys, hashlib

ANCHOR = re.compile(r'⟦([A-Za-z0-9][A-Za-z0-9\-_]{2,40})⟧')
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(REPO, 'scripts', 'is-this-still-true.sh')


def texts_from(ev):
    """把這一發 hook 事件裡【人寫的字】收集起來。"""
    out = []
    for k in ('prompt',):
        v = ev.get(k)
        if isinstance(v, str):
            out.append(v)
    ti = ev.get('tool_input') or {}
    for k in ('content', 'new_string', 'command'):
        v = ti.get(k)
        if isinstance(v, str):
            out.append(v)
    return out


def cache_path(ev):
    sid = str(ev.get('session_id') or os.environ.get('CLAUDE_SESSION_ID') or 'nosession')
    d = os.environ.get('TMPDIR', '/tmp')
    return os.path.join(d, 'anchor-hook-' + hashlib.sha256(sid.encode()).hexdigest()[:16] + '.seen')


def already_seen(path):
    try:
        with open(path, encoding='utf-8') as f:
            return set(x.strip() for x in f if x.strip())
    except OSError:
        return set()


def probe(anchor):
    """跑 is-this-still-true.sh, 只留【會改變下一步】的兩段:修掉它的 commit / 板上的態。"""
    try:
        # 🔴 errors='replace':那支工具的輸出會在中文字中間被截斷(實測 0xe6 續位元組)
        #    ⇒ 嚴格解碼會讓整發 hook 變成「探測失敗」, 而那與「查無」在畫面上是兩回事, 但都沒用。
        r = subprocess.run(['bash', TOOL, anchor], capture_output=True, timeout=60)
        out = r.stdout.decode('utf-8', 'replace')
    except Exception as e:                      # noqa: BLE001 —— hook 絕不可以把主流程弄死
        return '(探測失敗: %s)' % e
    fixes, states, sec = [], [], None
    for ln in out.splitlines():
        if '① 有人已經修掉了嗎' in ln:
            sec = 'fix'; continue
        if '② 板子上那一列' in ln:
            sec = 'state'; continue
        if ln.startswith('═══') or ln.startswith('###'):
            sec = None; continue
        s = ln.strip()
        if not s or s.startswith('指令:'):
            continue
        if sec == 'fix' and re.match(r'^[0-9a-f]{7,40}\s', s):
            fixes.append(s)
        elif sec == 'state' and '態=' in s:
            states.append(s)
    return fixes, states


def main():
    try:
        ev = json.load(sys.stdin)
    except Exception:                            # noqa: BLE001
        return 0
    if not os.path.exists(TOOL):
        return 0

    anchors, seenpath = [], cache_path(ev)
    seen = already_seen(seenpath)
    for t in texts_from(ev):
        for m in ANCHOR.finditer(t):
            a = m.group(1)
            if a not in seen and a not in anchors:
                anchors.append(a)
    if not anchors:
        return 0
    anchors = anchors[:3]                        # 一發最多查三個錨, 免得變成延遲

    lines = []
    for a in anchors:
        got = probe(a)
        if isinstance(got, str):
            lines.append('  ⟦%s⟧ %s' % (a, got))
            continue
        fixes, states = got
        if not fixes and not states:
            lines.append('  ⟦%s⟧ 沒撈到修掉它的 commit, 板上也沒有那一列 ⇒ 這一格【它答不出來】, 不是「還沒做」'
                         % a)
            continue
        lines.append('  ⟦%s⟧' % a)
        if fixes:
            # 🔴 排序不是時間, 是【型別】——「最近四顆」會把 docs 排在前面, 而
            #    真正把事情做掉的那一顆是 fix/feat/refactor。實測 ⟦b4-SHIPUNVOID1⟧:
            #    照時間排 ⇒ 前四顆全是 docs, 而 `7d2be3be fix(adapters)` 被擠掉
            #    ⇒ **一個「有人修過了」的訊號, 被四筆記錄它的訊號蓋掉。**
            code = [f for f in fixes if re.search(r'\b(fix|feat|refactor|perf)\(', f)]
            docs = [f for f in fixes if f not in code]
            lines.append('    🔴 有 commit 提到它 —— 開工前先看這幾顆是不是已經把它做掉了:')
            for f in (code[:3] + docs[:2]):
                lines.append('       ' + ('⭐ ' if f in code else '   ') + f)
            if code:
                lines.append('       ⭐ = 改了碼的那幾顆(docs 只是記錄它)')
        else:
            lines.append('    🔵 沒有 commit 提到它')
        # 板上那幾列同理:只留【真的含這個錨】的, 否則印的是鄰居
        own = [x for x in states if a in x or a.split('-')[-1] in x]
        for x in (own or states)[:4]:
            lines.append('    板上 ' + x[:110])
        if not own and states:
            lines.append('    ⚠️ 上面那幾列【不含這個錨】⇒ 它們是鄰居, 不是你這一件')

    try:
        with open(seenpath, 'a', encoding='utf-8') as f:
            for a in anchors:
                f.write(a + '\n')
    except OSError:
        pass

    sys.stderr.write(
        '\n🔴 【這件是不是已經被做掉了?】—— 本 session 第一次看到這些錨, 自動跑了一發:\n'
        + '\n'.join(lines)
        + '\n  ⇒ 完整五段:bash scripts/is-this-still-true.sh "<錨>"\n'
        + '  🛑 板上的態是 open【不代表】還沒有人做 —— 那正是本 hook 存在的理由。\n\n')
    return 0


def selftest():
    """四格, 正 1 負 3。🔴 而它跑的是【本檔自己】, 不是重寫一份像它的邏輯。"""
    import tempfile
    me = os.path.abspath(__file__)
    ok = True

    def run(payload, env=None):
        e = dict(os.environ)
        if env:
            e.update(env)
        r = subprocess.run([sys.executable, me], input=json.dumps(payload).encode(),
                           capture_output=True, env=e)
        return r.stderr.decode('utf-8', 'replace'), r.returncode

    with tempfile.TemporaryDirectory() as td:
        env = {'TMPDIR': td}
        # 🟢 P1 正對照:一個【已經被 fix commit 做掉】的錨 ⇒ 要撈到那顆, 而且要排在最前面
        o, rc = run({'session_id': 'p1', 'prompt': '接手 \u27e6b4-SHIPUNVOID1\u27e7'}, env)
        # 🔴 **這一條斷言【放寬過一次, 而理由要留著】**:原本斷言 `7d2be3be` 在【第一顆】,
        #    而它 commit 之後 12 分鐘就自己紅了 —— 因為 **本檔自己那顆 `feat(config)` 排到它前面**。
        #    📌 那顆 commit 只是【講述】這個錨(它的成因故事), 它一個字都沒有修那件事。
        #    ⇒ ⇒ **型別排序比時間排序好, 而它仍然分不出「修了它」與「講了它」。**
        #    🛑 而這一格不是缺陷、是這把尺的界線 ⇒ 寫進檔頭「它擋不住什麼」, 斷言改成
        #      【`7d2be3be` 要出現在 ⭐ 那幾行裡】—— 那是它真正保證得了的事。
        stars = [l for l in o.splitlines() if '⭐' in l]
        good = any('7d2be3be' in l for l in stars)
        print(('✅' if good else '🔴') + ' P1 已被做掉的錨 ⇒ fix commit 在 ⭐ 群裡 (rc=%d)' % rc)
        ok &= good

        # 🟢 N1 負對照:現造的錨 ⇒ 不可以說「還沒做」
        o, rc = run({'session_id': 'n1', 'prompt': '\u27e6zz-NOSUCH0902X\u27e7'}, env)
        good = ('答不出來' in o) and ('還沒做' not in o.replace('不是「還沒做」', ''))
        print(('✅' if good else '🔴') + ' N1 現造的錨 ⇒ 說「它答不出來」而不是「還沒做」')
        ok &= good

        # 🟢 N2 負對照:沒有錨 ⇒ 一個字都不印(否則它會變成雜訊而被關掉)
        o, rc = run({'session_id': 'n2', 'prompt': '幫我看一下這支檔'}, env)
        good = (o.strip() == '')
        print(('✅' if good else '🔴') + ' N2 沒有錨 ⇒ 零輸出')
        ok &= good

        # 🟢 N3 快取:同 session 同錨第二次 ⇒ 不再印
        run({'session_id': 'n3', 'prompt': '\u27e6b4-MAILDEAD\u27e7'}, env)
        o, rc = run({'session_id': 'n3', 'prompt': '\u27e6b4-MAILDEAD\u27e7 再一次'}, env)
        good = (o.strip() == '')
        print(('✅' if good else '🔴') + ' N3 同錨第二次 ⇒ 零輸出(快取)')
        ok &= good

    print('\n射程:只認 ⟦…⟧ 形狀 · 白話派工漏掉 · 只照明不擋 · '
          'is-this-still-true.sh 自己掃不到的(別的 session 對話/正式庫/OD 稿/別的 repo)照舊掃不到')
    return 0 if ok else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
