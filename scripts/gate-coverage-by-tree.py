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


def _git(args, cwd=None):
    try:
        r = subprocess.run(['git'] + args, cwd=cwd, capture_output=True, text=True, timeout=30)
        return r.stdout if r.returncode == 0 else None
    except Exception:
        return None


def worktrees():
    out = _git(['worktree', 'list', '--porcelain'], cwd=ROOT)
    if out is None:
        return []
    return [ln[len('worktree '):].strip() for ln in out.split('\n') if ln.startswith('worktree ')]


def scan():
    now = time.time()
    try:
        pkg = open(os.path.join(ROOT, 'package.json'), encoding='utf-8').read()
    except OSError:
        return None, None
    gates = gate_files(pkg)
    rows = []
    for w in worktrees():
        st = _git(['status', '--porcelain'], cwd=w)
        dirty = 0 if st is None else len([x for x in st.split('\n') if x.strip()])
        ct = _git(['log', '-1', '--format=%ct'], cwd=w)
        last = None
        if ct and ct.strip().isdigit():
            last = int(ct.strip())
        missing = [g for g in gates if not os.path.isfile(os.path.join(w, g))]
        rows.append({'tree': w, 'alive': is_alive(dirty, last, now), 'missing': missing})
    return gates, rows


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
    print(f'  ⇒ {7 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


def main():
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    gates, rows = scan()
    if not gates or not rows:
        print(f'🔴 分母是 0(閘 {len(gates or [])} 支 · 樹 {len(rows or [])} 棵)⇒ 尺沒接上, 不是「全都有」',
              file=sys.stderr)
        sys.exit(2)
    alive = [r for r in rows if r['alive']]
    bad = [r for r in alive if r['missing']]
    # 🔴 兩個分母一起印 —— 「活樹缺 0」不等於「全部都有」。
    print(f'[gate-coverage] 閘 {len(gates)} 支 · 活樹 {len(alive)} / 全部 {len(rows)} 棵')
    for r in bad:
        n = len(r['missing'])
        print(f'  🟡 {os.path.basename(r["tree"])} 缺 {n} 支,例:'
              + ', '.join(os.path.basename(g) for g in r['missing'][:3]))
    if not bad:
        # 🛑 這句刻意帶著兩個分母 —— 一句沒有分母的「全有」就是本支要防的東西。
        print(f'  ✅ 活樹({len(alive)} 棵)全部齊備'
              f' —— ⚠️ 而非活樹 {len(rows) - len(alive)} 棵【沒有問】, 那不是「全部都有」')
    sys.exit(0)


if __name__ == '__main__':
    main()
