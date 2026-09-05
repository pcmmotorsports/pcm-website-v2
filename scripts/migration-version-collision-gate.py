#!/usr/bin/env python3
"""兩支 migration 用同一個版本號 ⇒ 紅。

══ 為什麼要有它(2026-09-04, 一天撞兩次)══════════════════════════════════════

`supabase/migrations/` 的檔名前 14 碼是版本號。兩支同號時:
  · `supabase db push` 的套用順序**在兩支之間是未定義的**
  · 帳本(`APPLIED.tsv`)與 `supabase_migrations.schema_migrations` 用版本號當鍵
    ⇒ 兩支只會留下一筆紀錄 ⇒ **另一支【貼過了沒】永遠答不出來**
🔴 而它今天在人身上被抓到兩次, 兩次都是「兩個窗同時取號」⇒ 那不是紀律問題, 是機制缺口。

══ 🔴 判準:**只數 `.sql`** —— 這一格是量出來的, 不是設計出來的 ══════════════

主視窗派工時逐字說「既有的 `20260820030000` 那對是【已知重複】⇒ 豁免要具名」。
**而那不成立**:那一對是
```
20260820030000_ERRATUM.md                      ← 一份【勘誤文件】
20260820030000_m4b_e10_a8a3_cancel_gate_noncard.sql
```
⇒ 一支 `.md` 配它自己的 `.sql`, **不是兩支 migration**。
✅ 只數 `.sql` ⇒ **今天的樹零撞號**(292 支 `.sql`, 0 組重複)⇒ **不需要任何豁免。**

🛑 **而「加一個具名豁免」在這裡會是【純負面】的**:
   它會讓這道閘對 `20260820030000` 這個版本號**永久失明** ——
   而那正是這道閘唯一要看的東西。
   📌 **⇒ 為一個不存在的問題開的豁免, 比沒開閘還糟:它看起來像有守著。**

══ 天花板:它證不到什麼 ═══════════════════════════════════════════════════════

  ① 它只看**檔名**。兩支不同版本號而**內容互相衝突**, 它一句話都不會說。
  ② 它只在 `--staged` 模式擋**這一次 commit 帶進來的**撞號;
     若兩支同號的檔【已經都在 HEAD 裡】, 只有 `--audit` 掃得到。
  ③ 非 `.sql`(`.md` 勘誤、`.txt` 草稿)**刻意不算** —— 見上面那段量測。
"""

import os
import subprocess
import sys
from collections import defaultdict

MIG_DIR = 'supabase/migrations'


def _git_free_env():
    """🔴 剝掉繼承來的 git 環境。

    本檔會呼叫 `git`, 而它掛在 pre-commit 底下 ⇒ `lint-staged` 給的
    `GIT_INDEX_FILE` / `GIT_DIR` 會被繼承。
    🛑 `git -C <路徑>` **擋不住它**(那兩個變數的優先權比 `-C` 高)。
    ⚠️ 而**本檔的 `--staged` 模式【需要】那個 index** —— 所以剝只用在 selftest
       造拋棄式 repo 的時候, 不是全域。這一格與 `design-ref-check.sh` 相反,
       而差別是:那支【量的是別人的樹】, 這支【量的是當下這個 index】。
    """
    env = dict(os.environ)
    for k in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        env.pop(k, None)
    return env


def version_of(name):
    """檔名前 14 碼數字 = 版本號;不是那個形狀就回 None(不歸本閘管)。"""
    base = os.path.basename(name)
    head = base[:14]
    return head if len(base) > 14 and head.isdigit() and base[14] == '_' else None


def collisions(names):
    """回 {版本號: [檔名…]}, 只含出現 ≥2 支的。**只數 .sql** —— 理由見檔頭。"""
    by = defaultdict(list)
    for n in names:
        if not n.endswith('.sql'):
            continue
        v = version_of(n)
        if v:
            by[v].append(os.path.basename(n))
    return {v: sorted(f) for v, f in by.items() if len(f) > 1}


def _run(args, cwd=None, env=None):
    """🔴 `env` 一定要傳得進來。

    2026-09-04 實測:selftest 裡造拋棄式 repo 的六發 `git init/add/commit` 原本
    **沒有帶剝過的環境** ⇒ 掛在 lint-staged 底下時它們繼承 `GIT_INDEX_FILE`
    ⇒ **寫進了【真的】那個 index**, 而本閘在我自己樹上手跑是綠的。
    📌 這正是 `.husky/selftest-git-isolation-gate.sh` 存在的理由, 而我照樣踩了。
    🛑 而我原本【有】剝 —— 只剝在最後那一發跑閘本體上。**六發裡剝了一發。**
       ⇒ 同一支檔的舊註解自己寫過:**「漏掉一發就等於沒做」**。
    """
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env)


def staged_names(cwd=None):
    r = _run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACR'], cwd)
    if r.returncode != 0:
        print(f'🔴 量具失效:git diff --cached 回 rc={r.returncode} ⇒ 這【不是】「沒有撞號」')
        sys.exit(2)
    return [l for l in r.stdout.split('\n') if l.startswith(MIG_DIR + '/')]


def tree_names(cwd=None):
    r = _run(['git', 'ls-files', MIG_DIR], cwd)
    if r.returncode != 0:
        print(f'🔴 量具失效:git ls-files 回 rc={r.returncode}')
        sys.exit(2)
    return [l for l in r.stdout.split('\n') if l.strip()]


def report(hits, scope):
    if not hits:
        return 0
    print(f'🔴 {scope}:有 {len(hits)} 個版本號被兩支以上的 migration 佔用')
    for v, files in sorted(hits.items()):
        print(f'   {v} ⇒ ' + ' · '.join(files))
    print('   ── 為什麼這是錯的:`supabase db push` 對同號兩支的套用順序【未定義】,')
    print('      而帳本用版本號當鍵 ⇒ 只留一筆 ⇒ 另一支【貼過了沒】永遠答不出來。')
    print('   ── 修法:把【還沒推上去的】那一支改成一個沒有人用的版本號。')
    print('      取號前先看空位:ls supabase/migrations/ | tail -5')
    print('   ⚠️ 本閘只看【檔名】—— 兩支不同版本號而內容互相衝突, 它一句話都不會說。')
    return 1


def main(argv):
    if '--audit' in argv:
        return report(collisions(tree_names()), '全樹稽核')
    names = set(staged_names()) | set(tree_names())
    # 只報「這次 staged 有份」的那些, 免得舊帳擋住不相干的 commit
    staged_versions = {version_of(n) for n in staged_names() if n.endswith('.sql')}
    hits = {v: f for v, f in collisions(names).items() if v in staged_versions}
    if not hits:
        n = len([x for x in staged_names() if x.endswith('.sql')])
        print(f'  ✅ migration 版本號:本次 staged {n} 支 .sql, 無撞號'
              f'(⚠️ 只看檔名, 不看內容衝突)')
        return 0
    return report(hits, '本次 commit')


def selftest():
    import tempfile
    ok = True
    env = _git_free_env()

    def world(files, staged, label, want):
        nonlocal ok
        d = tempfile.mkdtemp()
        os.makedirs(os.path.join(d, MIG_DIR))
        for f in files:
            open(os.path.join(d, MIG_DIR, f), 'w').write('-- x\n')
        _run(['git', 'init', '-q'], d, env)
        _run(['git', 'config', 'user.email', 'x@y.z'], d, env)
        _run(['git', 'config', 'user.name', 'x'], d, env)
        _run(['git', 'add', '-A'], d, env)
        _run(['git', 'commit', '-q', '-m', 'base'], d, env)
        for f in staged:
            open(os.path.join(d, MIG_DIR, f), 'w').write('-- y\n')
        _run(['git', 'add', '-A'], d, env)
        r = subprocess.run([sys.executable, os.path.abspath(__file__)],
                           cwd=d, capture_output=True, text=True, env=env)
        good = r.returncode == want
        print(('  ✅ ' if good else '  🔴 ') + f'{label}  期望 rc={want} 實得 rc={r.returncode}')
        if not good:
            print('     ' + r.stdout.strip()[:200])
            ok = False

    world(['20260101000000_a.sql'], ['20260102000000_b.sql'],
          '世界①該綠必綠 · staged 一支新號', 0)
    world(['20260101000000_a.sql'], ['20260101000000_b.sql'],
          '世界②該紅必紅 · staged 撞到【已 commit】那支的號', 1)
    world([], ['20260101000000_a.sql', '20260101000000_b.sql'],
          '世界③該紅必紅 · 同一次 staged 兩支同號', 1)
    # 🔴 這一格的方向【是刻意的】:.md 已 commit、.sql 是這次 staged 的。
    #    反過來寫(.sql 已 commit、staged 的是 .md)⇒ 那個 .md 根本進不了 staged_versions
    #    ⇒ 它綠的原因是【被上游過濾掉】而不是【只數 .sql】⇒ **那樣寫這一格是假證人**:
    #    我實測過 —— 把「只數 .sql」那兩行突變掉, 反向寫的那一格【照樣綠】。
    world(['20260101000000_ERRATUM.md'], ['20260101000000_a.sql'],
          '世界④該綠必綠 · 同號的是 .md 勘誤 ⇒ 不是兩支 migration(今天的樹就是這一格)', 0)
    world(['20260101000000_a.sql', '20260101000000_b.sql'], ['20260202000000_c.sql'],
          '世界⑤該綠必綠 · 舊帳撞號而本次沒碰那個號 ⇒ 不擋不相干的 commit', 0)
    world(['README.md'], ['notes.txt'],
          '世界⑥該綠必綠 · 沒有任何 .sql ⇒ 不歸本閘管', 0)

    # 🔴 真樹上跑一發 —— selftest 造的世界都是我造的, 而真樹是別人造的
    r = _run([sys.executable, os.path.abspath(__file__), '--audit'])
    good = r.returncode == 0
    print(('  ✅ ' if good else '  🔴 ')
          + f'世界⑦·真樹 --audit 現在應為綠(292 支 .sql 零撞號)實得 rc={r.returncode}')
    if not good:
        print('     ' + r.stdout.strip()[:300])
        ok = False

    print('全部通過。' if ok else '🔴 有格沒過。')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main(sys.argv[1:]))
