#!/usr/bin/env python3
# ============================================================================
# git-isolation-denominator.py — 誰【呼叫 git 寫入】而可能被 GIT_DIR 洩漏波及
#
# 🔴🔴 本工具目前【只標不擋】—— 下面列出的「無法證明隔離」那幾支,現在【沒有東西在守它們】。
#    而「不擋」是【刻意的、有時限的】:等 -ed 把那幾支的繼承 env(GIT_DIR/GIT_INDEX_FILE)
#    剝乾淨之後,重新評估要不要把它們變成【擋】(pre-push 非 0)。
#    🔴 這一句【不是免責】,它有一個【具名的解封條件】:-ed 的「剝 GIT_* 名單」清空之日
#       = 本工具改成 enforce(擋)的評估點。解封條件的落點由主視窗上板,不只留在這裡。
#
# 為什麼要它(根因,2026-08-27 -ed 拋棄式 repo 重現):
#   git 呼叫 hook 時匯出 GIT_DIR/GIT_INDEX_FILE ⇒ 子程序在暫存目錄跑 `git add -A`
#   卻寫進【真 index】⇒ 真 index 裡其他檔在 cwd 找不到 ⇒ 全 stage 成刪除。
#   GIT_DIR 蓋過 cwd 與 -C ⇒ 改 `git -C` 也防不了。
#
# 與現行 scripts/selftest-git-isolation-gate.sh 的關係:
#   那道閘用【行為尺】跑每支的 --selftest 看受害者變不變 —— 但它【只能作用在有 --selftest 的腳本】。
#   本工具補的是【分母】那一半:抓出所有呼叫 git 寫入的腳本,並標出【哪些閘測不到】(無 --selftest)。
#   「抓得到」與「測得到」是兩件事,而它們在一份「分母 N 支」的報告上長得一樣。
#
# 分母怎麼建(每一條對應現行閘的一個洞):
#   ① python3 逐檔讀 bytes,不用 ugrep(ugrep 的 -I 會把某些檔判 binary ⇒ 分母靜默縮水)
#   ② shebang 偵測候選,不寫死副檔名(舊閘 `\.(py|sh)$` 濾掉了 quantifier-hook.harness.js〔.js〕)
#   ③ curated 寫入子命令表(不是 `git ` 太寬、不是 `git add` 太窄)
#   🔴 不再用「隔離關鍵字(mktemp/git init)」往下縮 —— 實測那樣會漏掉沒帶那些字的成員(同 --selftest 洞)
#
# ✅ 「指令字串假陽」已解(b4 F1 折):早先版本把 heredoc/printf 裡印給人看的「git commit」救援指令
#    當成執行(status-owner-gate / acl-drift-gate 等 11 支噪音,名單 58% 假陽)。scan_lines 現在剝
#    註解 + heredoc body + 引號字串 ⇒ 那 11 支出去、只留真執行的行。(acl-drift 等現在在名單是因為【真的】subprocess.run,不是散文)
#
# 用法:
#   python3 scripts/git-isolation-denominator.py            # 報告(exit 0,只標不擋)
#   python3 scripts/git-isolation-denominator.py --self-check  # 內建正負對照(尺活不活)
#   ISOLATION_GATE_ENFORCE=1 python3 scripts/…               # 有無法證明隔離者 ⇒ exit 1(解封後才開)
# ============================================================================
import subprocess, re, io, os, sys

# ═══ 這張表是分母的【唯一來源】—— 設計文件引用它、WRITE 正則【從它生成】(b4:表與碼要同源)═══════
#   只收【會寫 index / 工作樹 / refs】的子命令 —— 本閘防的是「主 repo 的 index/工作樹被寫」。
#   🔴 push/fetch/gc/repack/write-tree 刻意【不收】:它們寫遠端或物件庫,不碰 index/工作樹
#      ⇒ 不是本次事故(git add -A 把 index 全 stage 成刪除)的形狀。(b4 F2 + 主視窗裁 push 不進表)
WRITE_VERBS = ['add', 'rm', 'mv', 'commit', 'reset', 'restore', 'stash', 'checkout', 'switch',
               'apply', 'update-index', 'update-ref', 'clean', 'init', 'rebase', 'cherry-pick',
               'am', 'revert', 'pull']
# merge 但排除唯讀 plumbing merge-base/merge-tree/merge-file(reviewer R2:`\b` 在 e 與 - 之間會誤中)
WRITE_MERGE = r'merge(?!-)'
# 有唯讀形(list/status)的,只認其【寫入子動作】(reviewer R2:否則 `git worktree list` 破負對照)
WRITE_SUBACTION = {'worktree': ['add', 'remove', 'move', 'repair', 'prune'],
                   'submodule': ['update', 'add', 'deinit', 'set-url', 'set-branch', 'sync']}
# 🔴 `-C <path>` / `-c <k>=<v>` 的參數是【下一個 token】(本次事故 `git -C "$dir" add` 的形狀,reviewer R1)
_FLAG = r'(-C +\S+|-c +\S+|-[^ \n]+)'
_ALTS = [rf'(?:{"|".join(WRITE_VERBS)}|{WRITE_MERGE})\b'] + \
        [rf'{k} +(?:{"|".join(v)})\b' for k, v in WRITE_SUBACTION.items()]
WRITE = re.compile(rf'git( +{_FLAG})* +(?:{"|".join(_ALTS)})')

# ═══ 非 shell(.py/.js)的 git 執行【跟 shell 相反】(b4 R2 must-fix:board-state-consistency.py 是真假陰)═══
#   shell:git 在【字串裡】= 印給人看的噪音(echo "git…");git【裸命令】= 執行。
#   py/js:git 在【傳給 exec 的字串/清單裡】= 執行;git 在【註解/docstring】= 噪音。
#   ⇒ 兩者剝的東西【相反】,不能用同一把尺(否則散文中、執行不中 = R1 那 11 支的鏡像)。
# ⚠️ 兩個已知限制(err-toward-inclusion 之外的【漏報】方向,均 repo 現況 0 命中、標明不假裝):
#   ① shell 的 `sh -c 'git add -A'` / `eval "git …"`:字串被 shell scan_lines 換佔位 ⇒ 漏(b4 R2-3 should)。
#   ② py/js 清單形的 worktree/submodule 寫入(subprocess.run(['git','worktree','add']))不抓 —— 清單只認純動詞;
#      但 exec-string 形(run('git worktree add'))會抓(重用 WRITE 的子動作閘)。
#   ③ exec-string 內含跳脫引號(run("echo \\"x\\" && git commit"))被非貪婪配對提前截斷 ⇒ 漏(同 shell 那條 nit)。
#   ④ f-string 動態插入動詞(run(f"git {verb}", shell=True))抓不到 —— 靜態尺的固有盲區。(以上 ③④ code-reviewer R3 抓、repo 現況 0)
_PYJS_VERBS = '|'.join(WRITE_VERBS) + '|' + WRITE_MERGE   # 純寫入動詞(不含 worktree/submodule)
# 清單/元組形 run(['git',…,'add']) / check_call(('git','commit')):git 為首、某元素是寫入動詞
#    🔴 `[` 或 `(` 都收(b4 R3-1:Python tuple `('git','commit')` 對 subprocess 與 list 等價)。
_PYJS_LIST = re.compile(rf'''[\[(]\s*['"]git['"]\s*,[^\])]*?['"](?:{_PYJS_VERBS})['"]''')
# 🔴 Node 分離參數形 execFileSync('git', ['add','-A']) / spawnSync('git', ['commit']):
#    git 是【第一個字串參數】、寫入動詞在【第二個陣列】裡(b4 R3-2:Node 叫 git 最標準、不經 shell 的寫法)。
_PYJS_NODE = re.compile(
    rf'''(?:execFile|execFileSync|spawn|spawnSync|execa)\s*\(\s*['"]git['"]\s*,\s*\[[^\]]*?['"](?:{_PYJS_VERBS})['"]''')
# 動態拼接 'git ' + 'commit'(quantifier-hook 躲字面掃描的形;b4 R2-2:不再靠硬編名字,靠通則抓)
_PYJS_CONCAT = re.compile(r'''['"]git\s*['"]\s*\+|\+\s*['"](?:commit|add|rm|reset|checkout|init|worktree|submodule)['"]''')
# 🔴 exec-string 必須是【傳給 exec 函式的字串】,不是【當測資/訊息的字串】——
#    否則本工具自己的 self-check 世界 `('git -C "$d" add -A', True)` 會誤中(那是測資不是執行)。
#    exec sink:subprocess.run/Popen/call/check_*、os.system/popen、execSync/execFileSync、spawn* 等。
_EXEC_SINK = re.compile(
    r'''(?:subprocess\.\w+|check_output|check_call|Popen|\brun|os\.system|os\.popen|\bsystem|\bpopen'''
    r'''|exec\w*|execSync|execFileSync|spawn\w*|spawnSync)\s*\(\s*[frbu]*(['"])(.*?)\1''')

def _strip_pyjs(txt):
    """剝 py/js 的【註解 + docstring】,但【不剝一般字串】(exec-string 裡住著命令)。"""
    txt = re.sub(r'"""[\s\S]*?"""', '', txt)
    txt = re.sub(r"'''[\s\S]*?'''", '', txt)
    txt = re.sub(r'/\*[\s\S]*?\*/', '', txt)             # /* */
    return '\n'.join(l for l in txt.split('\n') if not re.match(r'\s*(#|//)', l))

def _pyjs_exec_string_cmds(s):
    """yield 每個【傳給 exec 函式的字串內容】(給 shell 的 WRITE 尺重用 ⇒ 連 worktree/submodule 子動作閘一起繼承)。"""
    for m in _EXEC_SINK.finditer(s):
        yield m.group(2)

def pyjs_calls_git_write(txt):
    s = _strip_pyjs(txt)
    if _PYJS_LIST.search(s) or _PYJS_NODE.search(s) or _PYJS_CONCAT.search(s):
        return True
    return any(WRITE.search(c) for c in _pyjs_exec_string_cmds(s))   # exec-string = shell 語法,重用 WRITE(含子動作閘)

# 🔴 KNOWN_DYNAMIC 現在【空的】——b4 R2-2:quantifier-hook.harness.js 原本靠硬編名字進來、下一支 .js 進不來。
#    改成靠 _PYJS_CONCAT 通則(`'git '+'commit'`)自動抓 ⇒ 不再需要硬編。保留 dict 當逃生口,目前無成員。
KNOWN_DYNAMIC = {}
SELFTEST = re.compile(r'--selftest')
CAND_EXT = re.compile(r'\.(sh|bash|py|js|mjs|cjs)$')

def tracked_files():
    out = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout
    return [f for f in out.split('\n') if f and not f.startswith('.claude/worktrees/')]

def is_candidate(f):
    if CAND_EXT.search(f):
        return True
    try:
        with io.open(f, 'rb') as fh:
            head = fh.read(64)
        return head[:2] == b'#!' and (b'sh' in head or b'python' in head or b'node' in head)
    except OSError:
        return False

def read_text(f):
    try:
        return io.open(f, encoding='utf-8', errors='replace').read()
    except OSError:
        return ''

_HEREDOC_OPEN = re.compile(r'<<-?\s*[\'"]?(\w+)[\'"]?')

# 🔴 b4 F1:19 支「無法證明隔離」裡 11 支是 printf/heredoc 裡印給人看的救援指令(echo "…git commit…"),
#    從不執行 ⇒ 名單 58% 噪音 ⇒ 每次都叫的閘會被人學會忽略(= 今天止血令那支的下場)。
#    ⇒ scan_lines 剝三種噪音,只留【真的會執行】的行:
#      ① 整行註解(# / //)  ② heredoc body(僅 shell;.js 的 `<<` 是位移不是 heredoc)
#      ③ 引號字串換佔位 Q(保留命令結構:`git -C "$d" add`→`git -C Q add` 仍命中、`echo "git push"`→`echo Q` 不命中)
def _is_shell(f):
    if re.search(r'\.(sh|bash)$', f):
        return True
    try:
        h = io.open(f, 'rb').read(64)
        return h[:2] == b'#!' and b'sh' in h and b'python' not in h and b'node' not in h
    except OSError:
        return False

def scan_lines(txt, is_shell):
    """逐行走,剝掉註解/heredoc body,引號換佔位,yield (原始行號, 原始行, 剝後行)。
    🔴 原始行號要跟著走 —— strip 會刪行,剝後的 index 對不回原檔(evidence 印錯行的 bug 來源)。"""
    heredoc = None
    for i, line in enumerate(txt.split('\n')):
        if heredoc is not None:
            if line.strip() == heredoc:
                heredoc = None
            continue
        if re.match(r'\s*(#|//)', line):
            continue
        if is_shell:
            m = _HEREDOC_OPEN.search(line)
            if m:
                heredoc = m.group(1)
        # ⚠️ 已知限制(code-reviewer nit,安全方向):引號換佔位不懂【跳脫引號】——
        #    `echo "run \"git commit\" now"` 會在 `\"` 提前截斷 ⇒ 後半的 git 中和不掉 ⇒ 可能誤判 True。
        #    是 err-toward-inclusion 方向(多報不漏報),且本 repo 現況 0 命中(2026-08-27 grep)⇒ 先不處理。
        neutral = re.sub(r"'[^']*'", 'Q', re.sub(r'"[^"]*"', 'Q', line))
        yield i + 1, line, neutral

def calls_git_write(txt, is_shell):
    return any(WRITE.search(n) for _, _, n in scan_lines(txt, is_shell))

def file_calls_git_write(f, txt):
    """依檔種選尺:shell 用 scan_lines+WRITE;py/js 用 pyjs_calls_git_write(執行形,不是散文)。"""
    return calls_git_write(txt, True) if _is_shell(f) else pyjs_calls_git_write(txt)

# 🔴 本工具【自我排除】:它是 git-write 的偵測器 ⇒ 檔內含大量 git 命令【測資】(self-check 的邊界世界、
#    _PYJS_CONCAT 的 `'git '+'commit'` 樣本)⇒ 會誤中自己。而它【只 `git ls-files`(讀)】、不執行任何寫入。
#    這【不是】b4 批的「靠硬編名字【納入】」(那讓下一支進不來);這是【排除唯一必然含對抗測資的那支=偵測器自己】。
#    ⚠️ 若本工具哪天真的加了 git 寫入 ⇒ 拿掉這行(它就該進自己的分母)。
SELF = 'scripts/git-isolation-denominator.py'

def build():
    denom = []          # (path, has_selftest, is_husky)
    for f in tracked_files():
        if not is_candidate(f) or f == SELF:
            continue
        t = read_text(f)
        if file_calls_git_write(f, t) or f in KNOWN_DYNAMIC:
            denom.append((f, bool(SELFTEST.search(t)), f.startswith('.husky/')))
    return sorted(denom)

def evidence_line(f):
    """這支檔【第一行真的命中 git 寫入】的證據(b4 F3:逐支要有行號證據,不是只印路徑)。"""
    txt = read_text(f)
    if _is_shell(f):
        for lineno, raw, neutral in scan_lines(txt, True):
            if WRITE.search(neutral):
                return f'L{lineno}: {raw.strip()[:76]}'
    else:
        # py/js:掃【原始行】(保留行號),跳過整行註解;命中 list/concat/exec-string 常見形即回。
        for i, raw in enumerate(txt.split('\n')):
            if re.match(r'\s*(#|//)', raw):
                continue
            if _PYJS_LIST.search(raw) or _PYJS_NODE.search(raw) or _PYJS_CONCAT.search(raw) \
               or any(WRITE.search(c) for c in _pyjs_exec_string_cmds(raw)):
                return f'L{i + 1}: {raw.strip()[:76]}'
        return 'py/js 執行形(subprocess/exec 清單或字串;跨行,單行對不到)'
    return '(命中處剝噪音後消失?)'   # 僅 shell-no-match 走到這;KNOWN_DYNAMIC 已空,不再另列

def main():
    denom = build()
    testable = [d for d in denom if d[1]]
    unprovable = [d for d in denom if not d[1]]
    print(f"git 寫入分母 = {len(denom)} 支  |  有 --selftest(閘可行為測)= {len(testable)}"
          f"  |  無 --selftest(閘測不到)= {len(unprovable)}")
    print("\n🔴 無 --selftest ⇒ 現行閘的【行為尺測不到它們】(逐支附證據行;不是「多幾支」):")
    print("   ⚠️ 「測不到」≠「一定不隔離」——有幾支是【刻意寫真 repo】(worktree/暫時 ref),"
          "那是它的目的、不是事故;逐支判要分「拋棄式沒拋棄」與「本來就寫真 repo」兩族(b4 §5)。")
    for f, _sel, husky in unprovable:
        tag = ' [.husky]' if husky else ''
        print(f"    {f}{tag}  ⇐ {evidence_line(f)}")
    print(f"\n有 --selftest(閘已能行為測,本工具不重測): {len(testable)} 支")
    for f, _sel, _h in testable:
        print(f"    {f}")
    if os.environ.get('ISOLATION_GATE_ENFORCE') == '1' and unprovable:
        print(f"\n🔴 ENFORCE:{len(unprovable)} 支無 --selftest ⇒ exit 1", file=sys.stderr)
        return 1
    return 0

def self_check():
    denom = {d[0] for d in build()}
    ok = True
    # 正對照:已知漏網必須在分母裡
    #   前三支 = 最初的漏網;中兩支 = reviewer R1 的 `git -C`/worktree/submodule;
    #   🔴 board-state-consistency.py = b4 R2 抓的【py 清單形真假陰】(止血令那支)⇒ 現在必須自己在名單。
    #   🔴 quantifier-hook.harness.js:KNOWN_DYNAMIC 已【空】⇒ 它在,證明靠 _PYJS_CONCAT 通則、不靠硬編(b4 R2-2)。
    assert not KNOWN_DYNAMIC, "KNOWN_DYNAMIC 應為空 —— quantifier 靠通則抓,不靠硬編"
    for want in ['scripts/deploy-order-gate-verify.sh',
                 'scripts/state-gates-freshness.harness.sh',
                 'scripts/quantifier-hook.harness.js',
                 'scripts/unreported-work-scan.sh',
                 'scripts/commit-pack-preflight.sh',
                 'scripts/board-state-consistency.py']:
        hit = want in denom
        print(f"  正對照 {want}: {'✅ 在分母' if hit else '🔴 漏(尺壞)'}")
        ok = ok and hit
    # 負對照:真唯讀 git 的腳本必須【不在】分母
    neg = 'scripts/literal-sweep.sh'  # 只 git status/show/branch
    out = neg not in denom
    print(f"  負對照 {neg}: {'✅ 不在分母(唯讀)' if out else '🔴 誤收(尺太寬)'}")
    ok = ok and out
    # 🔴 邊界世界(b4 F4:餵【合成字串】,不靠 tracked 檔 ⇒ 從外面也驗得到尺)
    #    每一對 = (輸入片段, is_shell, 期望命中)。剝噪音後 WRITE 該命中的必命中、該不命中的必不命中。
    worlds = [
        ('git -C "$d" add -A',            True,  True),   # 事故形狀
        ('git -c user.name=x commit -m y', True,  True),
        ('git worktree add ../w HEAD',    True,  True),
        ('git -C "$W" submodule update',  True,  True),
        ('echo "復原:git checkout -- ."', True,  False),  # 字串裡的 git ⇒ 不算
        ('printf "run git commit\\n"',    True,  False),
        ('cat <<MSG\ngit commit -m x\nMSG', True, False),  # heredoc body ⇒ 不算
        ('git merge-base HEAD x',         True,  False),   # 唯讀 plumbing
        ('git worktree list',             True,  False),   # 唯讀子動作
        ('git status --porcelain',        True,  False),
    ]
    for frag, sh, exp in worlds:
        got = calls_git_write(frag, sh)
        mark = '✅' if got == exp else '🔴'
        print(f"  邊界(shell) {mark} calls_git_write({frag!r}) = {got} (期望 {exp})")
        ok = ok and (got == exp)
    # 🔴 py/js 邊界世界(b4 R2-4:上一輪 10 世界全 shell,證不了 py/js 那半活著)——執行形 vs 散文
    pyjs_worlds = [
        ("subprocess.run(['git','add','-A'])",             True),   # 清單形 = 執行
        ("subprocess.run(['git','-C',d,'commit'])",        True),
        ("subprocess.run('cd x && git init', shell=True)", True),   # exec-string
        ("execSync('git add -A')",                         True),   # js
        ("GC = 'git ' + 'commit'",                         True),   # 動態拼接(不靠硬編)
        ("GC = 'git ' + 'status'",                         True),   # 🔴 拼接【刻意不分動詞】:動態建命令看不到動詞 ⇒ 一律收(安全方向,code-reviewer R3)
        ("subprocess.check_call(('git','commit','-m','x'))", True),  # 🔴 b4 R3-1:Python tuple 形(對 subprocess 等價 list)
        ("execFileSync('git', ['add', '-A'])",             True),   # 🔴 b4 R3-2:Node 分離參數形(叫 git 最標準、不經 shell)
        ("spawnSync('git', ['commit','-m','x'])",          True),
        ("execFileSync('git', ['status'])",                False),  # Node 分離參數【唯讀】⇒ 不收(尺不是只看到 git 就叫)
        ("subprocess.run(['git','status'])",               False),  # 清單形唯讀
        ("subprocess.run(['git','ls-files'])",             False),
        ('msg = "手動跑 git commit 一次"',                  False),  # 訊息字串 ≠ 命令
        ('log("see git commit history")',                  False),
    ]
    for frag, exp in pyjs_worlds:
        got = pyjs_calls_git_write(frag)
        mark = '✅' if got == exp else '🔴'
        print(f"  邊界(py/js) {mark} pyjs_calls_git_write({frag!r}) = {got} (期望 {exp})")
        ok = ok and (got == exp)
    print("  ⇒", "self-check PASS" if ok else "🔴 self-check FAIL")
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(self_check() if '--self-check' in sys.argv[1:] else main())
