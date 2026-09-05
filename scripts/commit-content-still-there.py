#!/usr/bin/env python3
"""commit-content-still-there.py — 一顆 commit 加進去的字, 今天還在檔案裡嗎?

用法
  python3 scripts/commit-content-still-there.py <commit> [<commit>...]   # 逐顆檢查
  python3 scripts/commit-content-still-there.py --since 2026-09-04       # 掃一段時間內動過板子的所有 commit
  python3 scripts/commit-content-still-there.py --selftest

🔴🔴 **它答的問題, 與 `git merge-base --is-ancestor` 答的【不是同一個】**
```
--is-ancestor <c> <ref>   ⇒ 「那顆 commit 在不在祖先鏈上」
本工具                     ⇒ 「那顆 commit 【加進去的字】今天還在不在檔案裡」
```
🛑 **而兩者會給出相反的答案, 那正是本工具存在的理由**(2026-09-05 實錘):
   `d910c6afd` **在** `origin/dev` 的祖先鏈上, 而它加進 `docs/launch-todo.md` 的**整段內容不見了**
   —— 被 `scripts/board-merge-rows.py` 的衝突解法吃掉:該檔 `:90` 逐字
   `keep = other if len(other) > len(l) else l` ⇒ **同一個錨的兩版【取較長那份】, 另一份整列丟掉。**
   ⇒ 📌 **所以「我的 commit 已進 ✅」這個自查, 對這一族失效【結構上失明】。**

⚠️ **它證不到什麼(先讀這段, 它決定你能不能拿本工具的綠當結論)**
   · 🔴 **本工具只看【新增行裡的特徵字串】** —— 一顆 commit 若只刪東西、或只改行號/空白,
     它抽不出特徵 ⇒ 回報 `無特徵可驗`。**那不是通過, 是【它問不了】。**
   · 🔴 **字串還在 ≠ 語意還在**:別人可能把那段搬到另一列、或加了刪除線把它作廢
     ⇒ 本工具照樣印綠。**命中之後要不要開檔, 是人的判斷。**
   · 🔴 **一顆 commit 動好幾支檔時, 本工具逐檔問** —— 而它**不知道哪一支比較重要**。
   · ⚠️ 特徵字串取的是**新增行裡最長的中文/英數片段**;短行(<12 字)一律跳過
     ⇒ **短內容的 commit 天生比較不容易被驗到。**
   · 🔴🔴 **改名(`git mv`)會讓它印「⚪ 檔不在了 / 無特徵可驗」, 而內容可能【一個字都沒少】**
     (2026-09-05 實測:`79ff6bc58` 建的那支 traps 投稿, 被同一個人在 `e5ebfd7b9` 改了名
      ⇒ 本工具拿舊路徑去 `git show HEAD:<舊路徑>` ⇒ 撈不到 ⇒ 判無特徵)。
     🛑 **而「無特徵可驗」與「內容真的被吃掉」在輸出上【只差一個字】** —— 前者是 `⚪`、後者是 `🔴`,
        而**兩者都不是綠的** ⇒ 掃一長串時很容易被讀成同一種「有問題」, 或反過來被跳過。
     ✅ **撞到 `⚪` 時的下一步**:`git show --format='' --name-only <commit>` 對照今天樹上的檔名 ——
        **名字不一樣就是改名**, 那時要**自己拿一句舊字面去 grep**(並掛一個現造字串當負對照)。
     ⚠️ **本工具不自動追改名** —— `git log --follow` 只吃單一路徑, 而一顆 commit 可能動好幾支檔。
"""
import io, os, re, subprocess, sys

MIN_LEN = 12          # 🔴 太短的片段會在別的地方偶然命中 ⇒ 那是假綠。12 是「一句話」的下界。
MAX_FEATURES = 3      # 每支檔取幾個特徵字串:多取幾個, 因為單一字串可能剛好被改字


def sh(args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def features_of(commit, path):
    """從那顆 commit 對某支檔的【新增行】裡, 抽最長的幾個片段當特徵。"""
    diff = sh(['git', 'show', '--format=', '-U0', commit, '--', path])
    cands = []
    for line in diff.split('\n'):
        if not line.startswith('+') or line.startswith('+++'):
            continue
        body = line[1:]
        # 切掉 markdown 與表格的裝飾, 留下人寫的字
        for seg in re.split(r'[|`*~<>\[\]()（）「」【】]+', body):
            seg = seg.strip()
            if len(seg) >= MIN_LEN:
                cands.append(seg)
    cands.sort(key=len, reverse=True)
    out, seen = [], set()
    for c in cands:
        k = c[:24]
        if k in seen:
            continue
        seen.add(k)
        out.append(c[:60])
        if len(out) >= MAX_FEATURES:
            break
    return out


def files_of(commit):
    return [f for f in sh(['git', 'show', '--format=', '--name-only', commit]).split('\n') if f.strip()]


def check(commit, ref='HEAD'):
    """回傳 (狀態, 明細)。狀態 = ok / gone / partial / nofeature / missingfile"""
    rows = []
    for path in files_of(commit):
        feats = features_of(commit, path)
        if not feats:
            rows.append((path, 'nofeature', 0, 0))
            continue
        try:
            now = sh(['git', 'show', f'{ref}:{path}'])
        except Exception:
            now = ''
        if not now:
            rows.append((path, 'missingfile', 0, len(feats)))
            continue
        hit = sum(1 for f in feats if f in now)
        st = 'ok' if hit == len(feats) else ('gone' if hit == 0 else 'partial')
        rows.append((path, st, hit, len(feats)))
    if not rows:
        return 'nofeature', rows
    if any(r[1] == 'gone' for r in rows):
        return 'gone', rows
    if any(r[1] == 'partial' for r in rows):
        return 'partial', rows
    if all(r[1] in ('nofeature', 'missingfile') for r in rows):
        return 'nofeature', rows
    return 'ok', rows


ICON = {'ok': '🟢 還在', 'gone': '🔴 不見了', 'partial': '🟡 只剩一部分',
        'nofeature': '⚪ 無特徵可驗', 'missingfile': '⚪ 檔不在了'}


def main(argv):
    ref = 'HEAD'
    if argv and argv[0] == '--since':
        since = argv[1]
        commits = [c for c in sh(['git', 'log', '--since', since, '--format=%H', '--no-merges',
                                  '--', 'docs/launch-todo.md']).split('\n') if c.strip()]
        print(f'掃 --since {since} 動過 docs/launch-todo.md 的 commit ⇒ {len(commits)} 顆')
    else:
        commits = argv
    print('🛑 先讀:本工具答的是「那些字還在不在」, 不是「commit 在不在」——')
    print('   而 `--is-ancestor` 答的是後者, 兩者會給出相反的答案(2026-09-05 實錘 d910c6afd)。')
    print('   ⚠️ 字串還在 ≠ 語意還在(可能被搬走或加了刪除線)⇒ 命中之後要不要開檔是人的判斷。\n')
    bad = 0
    for c in commits:
        st, rows = check(c, ref)
        subj = sh(['git', 'log', '-1', '--format=%h %s', c]).strip()[:78]
        print(f'{ICON[st]:<12} {subj}')
        for path, s, hit, tot in rows:
            if s != 'ok':
                print(f'             ↳ {ICON[s]} {path} ({hit}/{tot} 個特徵命中)')
        if st in ('gone', 'partial'):
            bad += 1
    print(f'\n合計 {len(commits)} 顆 · 內容有缺的 {bad} 顆')
    return 1 if bad else 0


def selftest():
    import tempfile
    checks = []
    # 造一個小 repo:一顆 commit 加一段字, 之後另一顆把整檔覆蓋掉 ⇒ 該判 gone
    d = tempfile.mkdtemp()
    # 🔴 剝掉繼承來的 git 環境 —— 否則這個「拋棄式 repo」會在呼叫者的 repo 裡動手腳
    #    (`git -C` 擋不住 GIT_DIR;本 repo 有一道 selftest-git-isolation-gate 就是為這件事立的)
    # 🛑 **而要【刪掉】不是設成空字串** —— 2026-09-05 我第一版寫成 `'GIT_DIR': ''`,
    #    git 把空字串當成一個【非法路徑】⇒ `fatal: The empty string is not a valid path`
    #    ⇒ selftest 三格全紅, 而**紅的原因是我的 harness 壞了, 不是被測的東西壞了**。
    #    📌 一個為了隔離而寫的防護, 用錯形式之後把整支自檢弄成假紅。
    env = {k: v for k, v in os.environ.items()
           if k not in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
                        'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE')}
    def g(*a):
        return subprocess.run(['git', '-C', d, *a], capture_output=True, text=True, env=env)
    g('init', '-q'); g('config', 'user.email', 'x@y'); g('config', 'user.name', 'x')
    io.open(os.path.join(d, 'a.md'), 'w', encoding='utf-8').write('起始內容一行\n')
    g('add', 'a.md'); g('commit', '-qm', 'base')
    io.open(os.path.join(d, 'a.md'), 'a', encoding='utf-8').write('這是一段夠長的特徵文字會被檢查\n')
    g('add', 'a.md'); g('commit', '-qm', 'add')
    c_add = g('rev-parse', 'HEAD').stdout.strip()
    io.open(os.path.join(d, 'a.md'), 'w', encoding='utf-8').write('別人整支覆蓋掉了\n')
    g('add', 'a.md'); g('commit', '-qm', 'clobber')

    old = os.getcwd()
    os.chdir(d)
    try:
        st_gone, _ = check(c_add, 'HEAD')
        # 🟢 正對照:回到那顆 commit 自己, 內容當然還在
        st_ok, _ = check(c_add, c_add)
        checks = [
            ('🔴 被整檔覆蓋 ⇒ 判 gone(而 --is-ancestor 會說「在」)', st_gone == 'gone'),
            ('🟢 正對照:對它自己 ⇒ 判 ok ⇒ 尺不是恆回 gone', st_ok == 'ok'),
        ]
        anc = subprocess.run(['git', '-C', d, 'merge-base', '--is-ancestor', c_add, 'HEAD'],
                             capture_output=True, env=env).returncode
        checks.append(('🔴 而同一顆 commit 的 --is-ancestor 回「在」⇒ 兩把尺答相反', anc == 0))
    finally:
        os.chdir(old)
        subprocess.run(['rm', '-rf', d])
    bad = 0
    for name, ok in checks:
        print(f'   {"PASS" if ok else "FAIL"}  {name}')
        bad += 0 if ok else 1
    print(f'\n{"selftest 全過" if not bad else f"selftest 有 {bad} 格紅"}  共 {len(checks)} 格')
    return 1 if bad else 0


if __name__ == '__main__':
    a = sys.argv[1:]
    sys.exit(selftest() if a[:1] == ['--selftest'] else main(a))
