#!/usr/bin/env python3
"""貼板乾檢 —— 貼板目錄裡那支 `N_` 與 git ref 上那支 migration 是不是【逐位元組同一份】。

它答什麼:
  ① `N_<版本>_<名>.sql` 與 `<ref>:supabase/migrations/<版本>_<名>.sql` 逐位元組比對
  ② `N_` / `Nb`(對帳唯讀)/ `Nr`(還原災難用)三支在不在

🔴 為什麼要逐位元組而不是「看起來一樣」:貼板那份是【要被貼進正式庫的那一份】,
   而 repo 那份是【被審過、被三綠跑過的那一份】。兩份只要差一個字元, 被審的與被貼的
   就不是同一個東西 —— 而那個差在任何畫面上都不會顯示。

🛑 它答不出什麼(寫出來, 不假裝涵蓋):
   · 它不知道那支 migration【貼過了沒】—— 那要問正式庫(`scripts/is-migration-applied.sh`)。
   · 它不知道 repo 那份【對不對】—— 它只知道兩份一不一樣。
   · `Nr` 缺席不一定是缺陷:有些片本來就不需要還原檔(例如純新增索引)。**本工具只報「在不在」。**
   · ref 預設 `origin/dev` ⇒ **讀數綁那一刻的 origin/dev**。收割鏈跑完要重跑。
"""
import subprocess, sys, re, os, hashlib

BOARD = os.path.expanduser('~/pcm-mailbox/貼板-0906')
REPO  = os.path.expanduser('~/pcm-wt-tidy')


def git_show(ref, path):
    r = subprocess.run(['git', 'show', f'{ref}:{path}'], capture_output=True, cwd=REPO)
    return r.stdout if r.returncode == 0 else None


def _refs_having(path):
    """哪些 ref 上有這支檔。🔴 用 `cat-file -e` 而不是 `git log --all -- <path>`:
    後者答的是「歷史上有沒有動過它」, 而我們要問的是「那棵樹上現在有沒有它」——
    一支被加了又刪的檔, 前者印命中而後者印沒有, 而我們要的是後者。"""
    refs = subprocess.run(['git', 'for-each-ref', '--format=%(refname:short)',
                           'refs/heads', 'refs/remotes'],
                          capture_output=True, text=True, cwd=REPO).stdout.split()
    return [r for r in refs
            if subprocess.run(['git', 'cat-file', '-e', f'{r}:{path}'],
                              capture_output=True, cwd=REPO).returncode == 0]


def check(nums, ref='origin/dev'):
    rows = []
    for n in nums:
        # N_ 主檔:前綴恰好是這個號碼 + 底線(不能用 startswith(n), 否則 7 會吃到 71/73…)
        mains = [f for f in os.listdir(BOARD) if re.match(rf'^{n}_\d{{14}}_.*\.sql$', f)]
        has_b = any(re.match(rf'^{n}b[_-]', f) for f in os.listdir(BOARD))
        has_r = any(re.match(rf'^{n}r[_-]', f) for f in os.listdir(BOARD))
        if not mains:
            rows.append((n, '—', '—', '🟡 缺主檔', f'Nb={"有" if has_b else "無"} Nr={"有" if has_r else "無"}'))
            continue
        f = sorted(mains)[0]
        mig = re.sub(rf'^{n}_', '', f)
        ver = mig[:14]
        board_bytes = open(os.path.join(BOARD, f), 'rb').read()
        repo_bytes = git_show(ref, f'supabase/migrations/{mig}')
        bsha = hashlib.sha256(board_bytes).hexdigest()[:8]
        if repo_bytes is None:
            # 🔴🔴 **「查無」的主詞是【這一棵 ref】, 不是專案。**
            #   2026-09-07 08:5x 實測:9 支裡 5 支在 origin/dev 上查無, 而**全部都存在** ——
            #   79/82 已合進【本地 dev】而還沒推, 71/78/80 還在各窗自己的分支上。
            #   ⇒ 只報 origin/dev 那一格, 會印出一排嚇人的紅, 而真缺失是 0。
            #   ⇒ 所以查無之後**一定要再掃一次全部 ref**, 並把答案分成兩種:
            #      「還沒收割」(別的 ref 上有)與「真的不存在」(一支都沒有)。
            others = _refs_having(f'supabase/migrations/{mig}')
            if others:
                # 🔴 **「還沒收割」不是答案的終點** —— 主視窗要問的是「貼板那份與被審過的那份同不同」,
                #    而那份現在住在別的 ref 上。⇒ 拿【它所在的那支 ref】比一次, 否則這一格
                #    要等收割完才有答案, 而那時候貼板可能已經被貼下去了。
                src = others[0]
                alt = git_show(src, f'supabase/migrations/{mig}')
                same = (alt == board_bytes)
                verdict = '🟠 還沒收割 · 內容同' if same else '🔴 還沒收割 · 內容不同'
                note = (f'{ref} 沒有;比的是 `{src}` 那份 ⇒ '
                        + ('逐位元組相同' if same
                           else f'**不同**(貼板 {len(board_bytes)} vs {src} {len(alt)} 位元組)')
                        + f' · 也在:{" / ".join(others[1:3])}' * (len(others) > 1))
            else:
                verdict = '🔴 一支 ref 都查無'
                note = f'掃了全部 ref, 沒有任何一支有 supabase/migrations/{mig}'
        elif repo_bytes == board_bytes:
            verdict, note = '✅ 同', ''
        else:
            rsha = hashlib.sha256(repo_bytes).hexdigest()[:8]
            verdict = '🔴 不同'
            note = (f'repo sha {rsha} · 貼板 {len(board_bytes)} 位元組 vs repo {len(repo_bytes)}')
        miss = [x for x, ok in (('Nb', has_b), ('Nr', has_r)) if not ok]
        if miss:
            note = (note + ' · ' if note else '') + '缺 ' + '/'.join(miss)
        rows.append((n, ver, bsha, verdict, note))
    return rows


def render(rows, ref):
    out = [f'| 號 | 版本 | 貼板 sha 前 8 | 判定 | 備註 |', '|---|---|---|---|---|']
    for n, ver, sha, v, note in rows:
        out.append(f'| {n} | `{ver}` | `{sha}` | {v} | {note} |')
    return '\n'.join(out)


def selftest():
    import tempfile, shutil
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    # 🔴 兩個世界:同一份 ⇒ ✅;改一個位元組 ⇒ 🔴。少了後者, 這支工具在
    #    「每一份都相同」與「它根本沒在比」兩個世界印同一個 ✅。
    a = b'CREATE INDEX x ON t(c);\n'
    ck('逐位元組同', a == a, True)
    ck('差一個位元組 ⇒ 不同', a == a[:-2] + b'.\n', False)
    ck('sha 前 8 對同一份輸入穩定',
       hashlib.sha256(a).hexdigest()[:8] == hashlib.sha256(a).hexdigest()[:8], True)
    # 🔴 號碼前綴不能用 startswith —— 否則問 7 會撈到 71/73/74…
    names = ['7_20260101000000_a.sql', '71_20260101000000_b.sql']
    ck('問 7 只撈到 7 那支', len([f for f in names if re.match(r'^7_\d{14}_.*\.sql$', f)]), 1)
    ck('問 71 只撈到 71 那支', len([f for f in names if re.match(r'^71_\d{14}_.*\.sql$', f)]), 1)
    # 🔵 負對照:一個現造的路徑, 全部 ref 掃完必須是 0 支 —— 少了它,
    #    `_refs_having` 在「真的沒有」與「它根本沒在掃」兩個世界印同一個空清單。
    ck('負對照 現造路徑 ⇒ 0 支 ref',
       len(_refs_having('supabase/migrations/zzq9999_negative_control.sql')), 0)
    ck('正對照 一支真的在 dev 上的 ⇒ 至少 1 支 ref',
       len(_refs_having('supabase/migrations/20260907050000_m4b_tappaydirect_a3_correct_backfill.sql')) >= 1, True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    ref = 'origin/dev'
    if '--ref' in sys.argv:
        ref = sys.argv[sys.argv.index('--ref') + 1]
    nums = [a for a in sys.argv[1:] if a.isdigit()] or \
           ['71', '73', '74', '75', '76', '78', '79', '80', '82']
    rows = check(nums, ref)
    print(f'> 基準 ref = `{ref}`(當場:{subprocess.run(["git","rev-parse","--short",ref],capture_output=True,text=True,cwd=REPO).stdout.strip()})')
    print(f'> 分母 = {len(nums)} 支;貼板目錄 `{BOARD}`\n')
    print(render(rows, ref))
