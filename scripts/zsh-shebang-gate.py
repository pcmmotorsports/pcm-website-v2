#!/usr/bin/env python3
"""zsh-shebang-gate.py — repo 裡不得出現 zsh shebang。

══ 天花板:它做不到什麼 ══════════════════════════════════════════════
① 🔴 **它只擋 shebang, 擋不住【被 zsh 執行】的其他方式**:
   `zsh <script>` / `source <script>` 進互動 zsh / `SHELL=zsh` 的 CI runner。
   ⇒ 本閘綠, **不代表**沒有腳本在 zsh 下跑。
② 🔴 **它擋不住真正的病灶** —— 那個坑住在【人打進互動 zsh 的一次性指令】裡,
   而那些指令不留在任何檔案上 ⇒ **沒有載體 ⇒ 沒有東西掃得到, 連事後都查不到。**
   (b4 2026-08-27 量:repo 179 支腳本、55 處 `for X in $VAR`, 而**沒有一支被 zsh 跑**
    ⇒ 55/55 以現行方式不壞。**本閘守的是那個「以現行方式」的到期條件, 不是那個坑。**)
③ 它不判「這支腳本裡有沒有 `for X in $VAR`」—— 那是語意, 而本閘只看 shebang 那一行。
④ 只看前 3 行。shebang 寫在第 4 行以後的檔案本閘看不到(那種檔 shebang 本來就無效)。
═════════════════════════════════════════════════════════════════════

## 為什麼要它(病灶,量到的不是推的)
`for X in $VAR`(未加引號)在 **bash 會斷詞、zsh 不會**。
b4 2026-08-27 拋棄式實測:`V=$'a\\nb\\nc'` ⇒ `for x in $V` 在 zsh 5.9 跑 **1** 次、
bash 與 /bin/sh 跑 **3** 次;`while IFS= read -r` 三個殼都 **3** 次。

🔴 **而 repo 裡那 55 處現在是對的, 靠的是「沒有一支用 zsh 跑」** ——
⇒ **那一天不會有任何東西紅**:有人在某支腳本頂端寫 `#!/usr/bin/env zsh`,
   55 處會同時開始只跑一次, **而每一次都印一個乾淨、合理的結論。**
📌 **本閘存在的理由不是那個坑, 是那個【安靜的到期條件】。**

## rc 三態(工具自壞不得被說成「有 zsh shebang」)
  0 = 沒有 zsh shebang
  1 = 🔴 有(逐支列出)
  2 = 🔴 本閘【沒有跑】(掃描目錄不存在 / 本閘自己丟例外)
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# 🔴 只掃會被當成腳本執行的副檔名 + .husky 底下的無副檔名檔。
#    ⚠️ 分母寫在這裡, 而它就是本閘的射程 —— 不在這個集合裡的檔, 本閘是瞎的。
EXTS = ('.sh', '.zsh', '.bash')
SCAN_DIRS = ('scripts', '.husky', 'supabase', 'docs')
SKIP_DIRS = {'node_modules', '.git', '.next', 'dist', '.turbo'}

ZSH_SHEBANG = re.compile(r'^#!.*\bzsh\b')


def candidates(root):
    """回 [(絕對路徑, repo 相對路徑)]。前 3 行讀得到就算候選。"""
    out = []
    for d in SCAN_DIRS:
        base = os.path.join(root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in SKIP_DIRS]
            for fn in filenames:
                p = os.path.join(dirpath, fn)
                rel = os.path.relpath(p, root)
                if fn.endswith(EXTS):
                    out.append((p, rel))
                elif os.path.basename(dirpath) == '.husky' and '.' not in fn:
                    out.append((p, rel))
    return sorted(out, key=lambda x: x[1])


def head3(path):
    with open(path, 'r', encoding='utf-8', errors='replace') as fh:
        return [next(fh, '') for _ in range(3)]


def scan(root):
    """回 (命中清單, 掃過的檔數)。🔴 檔數要回傳 —— 沒有它,「0 命中」與「一支都沒掃到」印同一句。"""
    hits, seen = [], 0
    for p, rel in candidates(root):
        seen += 1
        for i, line in enumerate(head3(p), 1):
            if ZSH_SHEBANG.match(line):
                hits.append((rel, i, line.rstrip('\n')))
                break
    return hits, seen


def selftest():
    """六個世界。🔴 每個世界都要印【不同】的東西, 否則這支自檢零判別力。"""
    import shutil
    import tempfile
    fails = count = 0
    tmp = tempfile.mkdtemp(prefix='zshgate-')
    try:
        def world(name, files, want_hits, want_seen_min):
            nonlocal fails, count
            count += 1
            d = os.path.join(tmp, 'w%d' % count)
            os.makedirs(os.path.join(d, 'scripts'))
            for fn, body in files.items():
                with open(os.path.join(d, 'scripts', fn), 'w', encoding='utf-8') as fh:
                    fh.write(body)
            hits, seen = scan(d)
            ok = (len(hits) == want_hits) and (seen >= want_seen_min)
            print('  %s %s ⇒ 命中 %d / 掃過 %d(期望命中 %d、掃過 ≥ %d)'
                  % ('PASS ' if ok else '🔴 FAIL', name, len(hits), seen, want_hits, want_seen_min))
            fails += 0 if ok else 1

        world('綠 · bash shebang', {'a.sh': '#!/usr/bin/env bash\necho hi\n'}, 0, 1)
        world('🔴 紅 · env zsh', {'a.sh': '#!/usr/bin/env zsh\necho hi\n'}, 1, 1)
        world('🔴 紅 · /bin/zsh', {'a.sh': '#!/bin/zsh\necho hi\n'}, 1, 1)
        world('綠 · zsh 只出現在【內文】不是 shebang',
              {'a.sh': '#!/usr/bin/env bash\n# 這支不要用 zsh 跑\n'}, 0, 1)
        world('綠 · shebang 在第 4 行(本閘看不到 —— 天花板 ④)',
              {'a.sh': '\n\n\n#!/usr/bin/env zsh\n'}, 0, 1)
        world('🔴 紅 · 兩支裡有一支',
              {'a.sh': '#!/usr/bin/env bash\n', 'b.sh': '#!/usr/bin/env zsh\n'}, 1, 2)

        # 🔴 工具自壞:掃一個不存在的 root ⇒ 掃過 0 支
        #    沒有這一格,「0 命中」與「一支都沒掃到」印同一句話。
        count += 1
        hits, seen = scan(os.path.join(tmp, 'no-such-root'))
        ok = (len(hits) == 0 and seen == 0)
        print('  %s 工具層 · root 不存在 ⇒ 掃過 %d(期望 0)'
              % ('PASS ' if ok else '🔴 FAIL', seen))
        fails += 0 if ok else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('── selftest: %d PASS / %d FAIL' % (count - fails, fails))
    return 1 if fails else 0


def main():
    if '--selftest' in sys.argv:
        return selftest()
    try:
        hits, seen = scan(REPO)
    except Exception as e:  # noqa: BLE001
        print('🔴 zsh-shebang-gate 自己丟了例外 ⇒ 本閘【沒有跑】:%r' % (e,), file=sys.stderr)
        return 2
    if seen == 0:
        print('🔴 zsh-shebang-gate 一支檔都沒掃到 ⇒ 本閘【沒有跑】(掃描目錄 %s)'
              % (', '.join(SCAN_DIRS),), file=sys.stderr)
        return 2
    if not hits:
        # ⚠️ 綠行帶【掃過幾支】—— 一個不帶分母的 0 與「什麼都沒掃到」長得一樣。
        print('✅ zsh-shebang-gate:掃過 %d 支,沒有 zsh shebang' % seen)
        return 0
    print('', file=sys.stderr)
    print('🔴 有 zsh shebang —— 而 repo 裡的 `for X in $VAR` 在 zsh 下【只會跑一次】',
          file=sys.stderr)
    for rel, ln, text in hits:
        print('   · %s:%d  %s' % (rel, ln, text), file=sys.stderr)
    print('', file=sys.stderr)
    print('   為什麼擋:bash 對未加引號的 $VAR 斷詞、zsh 不斷。', file=sys.stderr)
    print('   b4 2026-08-27 實測:`for x in $V`(V 有三個值)⇒ zsh 跑 1 次 / bash 跑 3 次。',
          file=sys.stderr)
    print('   ⇒ 那個迴圈會【只跑一次而印出一個乾淨合理的結論】,沒有東西會紅。', file=sys.stderr)
    print('', file=sys.stderr)
    print('   兩條路:① 改成 `#!/usr/bin/env bash`', file=sys.stderr)
    print('           ② 真的需要 zsh ⇒ 那支檔裡每個迴圈都要 `while IFS= read -r`,',
          file=sys.stderr)
    print('              而本閘不驗那件事(天花板 ③)⇒ 要人看過才放行。', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
