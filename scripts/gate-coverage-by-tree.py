#!/usr/bin/env python3
"""一道閘上線之後, 它【只存在於合到它的那些 checkout 裡】—— 這支去數還有幾棵樹沒有。

🔴 **為什麼這支不能掛 pre-commit**(主視窗 `-f8` 2026-09-07 點頭時確認的理由):
   `core.hooksPath` 是相對路徑 `.husky/_` ⇒ **每棵 worktree 解析到自己樹裡的 `.husky`**
   ⇒ 📌 **一棵沒合到新閘的樹, 連「檢查我缺不缺新閘」這道閘也一起缺**
   ⇒ 🛑 **它會在最需要它的那些樹上不存在。**
   ✅ 所以掛 `harvest-chain.sh` 的 REPORT_ONLY:鏈跑在**主樹**, 而 `git worktree list`
      是 **repo 層級**的 ⇒ 它一個人看得到全部的樹, 且每批推之前都跑一次。

🔬 **來源讀數**(⟦tidy-GATECOVERAGEBYTREE⟧;`-tidy` 2026-09-07 11:4x 開列、`-ship` 15:5x 複量):
   tidy 量 16 棵 ⇒ 8 有 / 8 無(50%)· ship 複量 **21 棵**, 六道當天新閘各 **8–9 棵**(38%–43%)。
   ⇒ **分母自己會長, 所以本支【不寫死棵數】, 每次現算。**

🔴🔴 **兩個分母一起印(主視窗指定)** —— 「活樹缺 0」**不等於**「全部都有」。
   少了那一半, 下一個人會把一個【範圍縮小過的綠】讀成【全綠】。

退出碼:0 = 數完(不論缺幾支;本支是 REPORT_ONLY, 不擋)
        1 = selftest 失敗
        2 = **分母是 0**(閘清單空 or 一棵樹都掃不到)⇒ 尺沒接上, 不是「全都有」
"""
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALIVE_WINDOW_SEC = 24 * 3600
# 閘 = lint-staged 裡指向【單一檔案】的那些 key。glob key(`scripts/*-down.sql`)不算:
# 它們是資料/樣式, 不是「這棵樹有沒有這道閘」答得出來的東西。
# ⚠️ **天花板**(code-reviewer R1 nit):只認 `scripts/<單層檔名>`,
#    **子目錄型 `scripts/foo/bar.py` 會被靜默漏算**。今天 lint-staged 裡零命中
#    (reviewer 逐一核過 147 個 key)⇒ 不預先擴, 而**限制寫在這裡**,
#    免得未來加了子目錄腳本之後, 「缺 0 支」是因為它根本沒被數。
GATE_KEY = re.compile(r'scripts/[A-Za-z0-9._-]+\.(?:sh|py|ts|mjs)\Z')


def gate_files(pkg_json_text):
    """lint-staged 的單檔 key ⇒ 閘清單。純函式, 好餵測資。"""
    ls = json.loads(pkg_json_text).get('lint-staged', {})
    return sorted(k for k in ls if GATE_KEY.fullmatch(k))


def is_alive(dirty_count, last_commit_epoch, now):
    """活樹 = 有未 commit, 或近 24h 有 commit。兩個條件是 or, 不是 and ——
    一棵剛 commit 完、工作樹乾淨的窗仍然在做事。"""
    if dirty_count > 0:
        return True
    return last_commit_epoch is not None and (now - last_commit_epoch) < ALIVE_WINDOW_SEC


def classify(exists, ok_st, ok_ct, dirty, last, now):
    """一棵樹是哪一種 —— 🔴 **抽成純函式的理由是【它原本測不到】。**

    🔬 2026-09-07 `-ship` 拿 ⟦15-HALFREVERT⟧ 的判準回頭驗自己的 R1 修法:
       那顆改了**三處**(路徑不存在跳過 / 查不動保守當活 / 兩種活分標),
       ⇒ 跑**三發突變、每發只退回一處**(mktemp 副本, `PATH` 前置假 `say`/`osascript`/`open`):
       🛑 **三發【全部 0 紅】, 而基線也是 10 PASS。**
       ⇒ 📌 **不是「退一半也紅」那種弱, 是【退回任何一處都不紅】** ——
         因為那三處全住在 `scan()` 裡, 而自檢只測得到純函式。
       ⚠️ **而 code-reviewer R1 對那顆給了 PASS** ⇒ 🔴 **審查看得到邏輯, 看不到「誰在守它」。**
    ⇒ ✅ 把那三個決策搬出來, 它們才有格子守得住。行為與搬之前逐字相同。

    回 'gone'(路徑不在磁碟) / 'unknown'(查不動) / 'fresh'(近 24h 有 commit)
      / 'dirty-only'(只有未 commit 檔) / 'dead'。
    """
    if not exists:
        return 'gone'
    if not (ok_st and ok_ct):
        return 'unknown'
    if last is not None and (now - last) < ALIVE_WINDOW_SEC:
        return 'fresh'
    return 'dirty-only' if dirty > 0 else 'dead'


def _git(args, cwd=None):
    """回 `(ok, out)` —— 🔴 **不可以回單一個 `None`**(code-reviewer R1 Important, 2026-09-07)。

    ⛔ ~~舊版失敗時回 `None`, 而呼叫端把 `None` 讀成 `dirty=0` / `last=None`~~
    ⇒ 📌 **「這棵樹查不動」與「這棵樹乾淨且沒 commit」印同一個東西**
    ⇒ 🛑 一棵**真的活著**的樹若剛好 `git status` 逾時/鎖檔, 會被**靜默**判成不活、
      整棵掉出分母 —— 而 `✅ 活樹全部齊備` 照樣印得出來。
      🎯 **那正是本支存在的理由(範圍縮小過的綠被讀成全綠)在本支自己身上發生一次。**
    🔬 而它**不是理論案例**:reviewer 實跑 `git worktree list --porcelain | grep prunable`,
      本 repo 現況**確有多棵 prunable 樹**(路徑已消失), 它們當時是靠這個洞「巧合地」被排除的。
    """
    try:
        r = subprocess.run(['git'] + args, cwd=cwd, capture_output=True, text=True, timeout=30)
        # 🔴 失敗時**不回 stdout** —— `git rev-parse <壞 ref>` 失敗時 stdout 仍有回顯,
        #    而那是一段**看起來像答案的垃圾**。回 '' 讓「失敗 ⇒ 沒有可信輸出」在型別上成立。
        return (True, r.stdout) if r.returncode == 0 else (False, '')
    except Exception:
        return (False, '')


def worktrees():
    ok, out = _git(['worktree', 'list', '--porcelain'], cwd=ROOT)
    if not ok:
        return []
    return [ln[len('worktree '):].strip() for ln in out.split('\n') if ln.startswith('worktree ')]


def scan():
    now = time.time()
    try:
        pkg = open(os.path.join(ROOT, 'package.json'), encoding='utf-8').read()
    except OSError:
        return None, None
    gates = gate_files(pkg)
    rows, gone, broken = [], [], []
    for w in worktrees():
        # 🔵 **路徑不在磁碟上(prunable)= 一個【乾淨的事實】, 不是查詢失敗** ⇒ 跳過並數出來。
        if not os.path.isdir(w):
            gone.append(w)
            continue
        ok_st, st = _git(['status', '--porcelain'], cwd=w)
        ok_ct, ct = _git(['log', '-1', '--format=%ct'], cwd=w)
        if not (ok_st and ok_ct):
            # 🔴 **查不動 ⇒ 保守當【活】並單獨列出來** —— 往「要有人看一眼」的方向失敗,
            #    不往「安靜地掉出分母」的方向。
            broken.append(w)
            rows.append({'tree': w, 'alive': True, 'missing':
                         [g for g in gates if not os.path.isfile(os.path.join(w, g))],
                         'unknown': True})
            continue
        dirty = len([x for x in st.split('\n') if x.strip()])
        last = int(ct.strip()) if ct.strip().isdigit() else None
        kind = classify(True, True, True, dirty, last, now)
        missing = [g for g in gates if not os.path.isfile(os.path.join(w, g))]
        rows.append({'tree': w, 'alive': kind in ('fresh', 'dirty-only'), 'missing': missing,
                     'unknown': False,
                     # 🟡 **兩種「活」要分得出來**(⟦ship-STALETREEREADSASALIVE⟧ 2026-09-07):
                     #    六棵「活樹」裡只有一棵近 24h 有 commit, 其餘五棵被判活
                     #    **只因為工作樹裡留著沒清的檔**(其中一個檔 17 天沒被碰過)。
                     #    🛑 判準不改(主視窗指定的), 而**輸出把兩種分開標** —— 不丟資訊, 讓讀的人分得出。
                     'fresh': kind == 'fresh'})
    return gates, rows, gone, broken


def selftest():
    # 🔴 剝掉繼承來的 git 環境(`git -C` 擋不住它們);本支的 selftest 不碰 git,
    #    而剝它是便宜的, 且下一個人若在這裡加了 git 呼叫就不必記得補。
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    bad = 0

    def ck(name, got, want):
        nonlocal bad
        ok = got == want
        if not ok:
            bad += 1
        print(f'  {"✅" if ok else "🔴"} {name}' + ('' if ok else f'  得 {got!r} 期望 {want!r}'))

    pkg = '{"lint-staged":{"scripts/a.sh":"x","scripts/b.py":"y","scripts/*-down.sql":"z","*.ts":"w"}}'
    ck('① 只收單檔 key, glob 與非 scripts 都不算', gate_files(pkg), ['scripts/a.sh', 'scripts/b.py'])
    ck('② 沒有 lint-staged ⇒ 空清單(而呼叫端要把它當【尺沒接上】)', gate_files('{}'), [])
    # ③④ 活樹判準的兩個條件各自成立就夠 —— 寫死它, 因為「改成 and」在真實資料上多半仍是綠的。
    ck('③ 乾淨但剛 commit ⇒ 活', is_alive(0, 1000, 1000 + 60), True)
    ck('④ 髒但很久沒 commit ⇒ 活', is_alive(3, 0, 10 ** 9), True)
    ck('⑤ 乾淨且超過 24h ⇒ 不活', is_alive(0, 0, ALIVE_WINDOW_SEC + 1), False)
    ck('⑥ 邊界:恰好 24h ⇒ 不活(嚴格小於)', is_alive(0, 0, ALIVE_WINDOW_SEC), False)
    # ⑦ 負對照:沒有 commit 紀錄又乾淨的樹, 不得因為 last=None 就被當成活的。
    ck('⑦ 負對照:無 commit 紀錄且乾淨 ⇒ 不活', is_alive(0, None, 10 ** 9), False)
    # 🔴 ⑧⑨⑩ 釘住 R1 那條 Important:失敗與「乾淨」不可以印同一個東西。
    ck('⑧ _git 成功 ⇒ (True, 輸出)', _git(['--version'])[0], True)
    ck('⑨ _git 失敗 ⇒ (False, "") 而【不是】None',
       _git(['rev-parse', 'zqx8never-not-a-ref'], cwd=ROOT), (False, ''))
    # 🔴 ⛔ ~~原本這一格寫成 `is_alive(...) is False and True`~~ —— **那是恆真的**,
    #    它在【碼對】與【碼被改壞】兩個世界都印綠 ⇒ 📌 一格沒有咬合力的自檢比沒有更糟,
    #    因為它讓計數器看起來更飽。換成一個**真的殺得掉東西**的:
    #    路徑不存在的 cwd ⇒ subprocess 會丟例外 ⇒ 若有人拿掉 except, 這格會炸給你看。
    ck('⑩ cwd 不存在 ⇒ (False, "") 而不是當掉',
       _git(['status', '--porcelain'], cwd='/zqx8never/no/such/dir'), (False, ''))
    # 🔴 ⑪〜⑭ 是 2026-09-07 那三發【全 0 紅】的突變逼出來的格子。
    #    少了它們, `scan()` 裡的三個決策**退回任何一處都不會紅**(見 classify 的 docstring)。
    ck('⑪ 路徑不在磁碟 ⇒ gone(不是「乾淨」也不是「不活」)',
       classify(False, True, True, 0, None, 10 ** 9), 'gone')
    ck('⑫ 查不動 ⇒ unknown(而呼叫端要把它當【活】, 往有人看一眼失敗)',
       classify(True, False, True, 0, None, 10 ** 9), 'unknown')
    ck('⑬ 近 24h 有 commit ⇒ fresh(🟢 那一堆)',
       classify(True, True, True, 0, 1000, 1000 + 60), 'fresh')
    ck('⑭ 只有未 commit 檔 ⇒ dirty-only(🟡 那一堆)—— 🔴 **它與 fresh 分開才是本片的重點**',
       classify(True, True, True, 3, 0, 10 ** 9), 'dirty-only')
    print(f'  ⇒ {14 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    gates, rows, gone, broken = scan()
    if not gates or not rows:
        print(f'🔴 分母是 0(閘 {len(gates or [])} 支 · 樹 {len(rows or [])} 棵)⇒ 尺沒接上, 不是「全都有」',
              file=sys.stderr)
        sys.exit(2)
    alive = [r for r in rows if r['alive']]
    bad = [r for r in alive if r['missing']]
    # 🔴 兩個分母一起印 —— 「活樹缺 0」不等於「全部都有」。
    print(f'[gate-coverage] 閘 {len(gates)} 支 · 活樹 {len(alive)} / 全部 {len(rows)} 棵'
          + (f' · 路徑已消失 {len(gone)} 棵(跳過)' if gone else '')
          + (f' · 🔴 查不動 {len(broken)} 棵(保守當活)' if broken else ''))
    for r in bad:
        n = len(r['missing'])
        # 🟡 vs 🟢:兩種「活」分開標 —— 只有未 commit 檔的樹, 把 HEAD 停在哪天印出來。
        if r.get('unknown'):
            tag = '🔴 查不動'
        elif r.get('fresh'):
            tag = '🟢 近 24h 有 commit'
        else:
            tag = '🟡 只有未 commit 檔'
        print(f'  {tag}  {os.path.basename(r["tree"])} 缺 {n} 支,例:'
              + ', '.join(os.path.basename(g) for g in r['missing'][:3]))
    if not bad:
        # 🛑 這句刻意帶著兩個分母 —— 一句沒有分母的「全有」就是本支要防的東西。
        print(f'  ✅ 活樹({len(alive)} 棵)全部齊備'
              f' —— ⚠️ 而非活樹 {len(rows) - len(alive)} 棵【沒有問】, 那不是「全部都有」')
    sys.exit(0)


if __name__ == '__main__':
    main()
