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
# ⚠️ 已知限制(err-toward-inclusion ⇒ 這些是【安全方向】的假陽,寧可多測一次;reviewer R2 抓到):
#   字面尺【分不出】真執行的 git 與【印在 heredoc/printf 字串裡教人怎麼跑】的 git ——
#   e.g. `.husky/status-owner-gate.sh` / `acl-drift-gate.sh` / `view-apply-gate.sh` / `a7c-preflight.sh`
#   的執行碼其實【零 git 寫入】,是它們印給人看的救援指令裡有「git commit / git restore」字樣被收進來。
#   ⇒ 「無法證明隔離」清單裡有幾支是這種【指令字串假陽】,逐支核時會被排除(不是真風險)。
#   後續要更準 ⇒ 剝 heredoc/字串字面(較難、需狀態解析),本輪先接受這個安全方向的過度納入。
#
# 用法:
#   python3 scripts/git-isolation-denominator.py            # 報告(exit 0,只標不擋)
#   python3 scripts/git-isolation-denominator.py --self-check  # 內建正負對照(尺活不活)
#   ISOLATION_GATE_ENFORCE=1 python3 scripts/…               # 有無法證明隔離者 ⇒ exit 1(解封後才開)
# ============================================================================
import subprocess, re, io, os, sys

# curated git 寫入(mutating)子命令 —— 窄於 `git `、寬於 `git add`
# 🔴 `-C <path>` 與 `-c <k>=<v>` 的【參數是下一個 token】(就是本次事故 `git -C "$dir" add` 的形狀)
#    ⇒ flag 群要能吃「兩個 token 的 flag」,不能只認自足的 `-[^ ]+`(否則 `-C` 吃不到路徑就 fail)。
# 🔴 err-toward-inclusion:漏一支真寫入 = 本次事故;誤收一支唯讀 = 只是多跑一次行為測。
#    ⇒ 寧可寬。但【不能】收唯讀常用形(status/show/log/diff/branch/rev-parse/ls-files)——
#    那會把負對照 literal-sweep(git status/show/branch)誤收進來。
#    worktree/submodule 是本次 commit-pack-preflight 漏掉的(reviewer R1);它們也有 list/status 唯讀形,
#    但腳本一旦出現 `git worktree`/`git submodule` 多半在操作工作樹 ⇒ 收進來、讓行為/靜態層再分。
#    worktree/submodule 有唯讀形(list/status)⇒ 只認它們的【寫入子動作】,不然會誤收唯讀腳本
#    (literal-sweep 有 `git worktree list` ⇒ 若整個 worktree 都收就破負對照)。
WRITE = re.compile(
    r'git( +(-C +\S+|-c +\S+|-[^ \n]+))* +(?:'
    r'(?:add|rm|mv|commit|reset|restore|stash|checkout|switch|apply|update-index|update-ref|'
    # 🔴 `merge(?!-)`:`\b` 在 e 與 - 之間 ⇒ `merge\b` 會誤中 `merge-base`(唯讀 plumbing,本 repo 到處是)。
    #    (reviewer R2 抓到)⇒ 用 negative lookahead 擋掉 merge-base/merge-tree/merge-file。
    r'clean|init|merge(?!-)|rebase|cherry-pick|am|revert|fetch|pull|push|gc|repack|write-tree)\b'
    r'|worktree +(?:add|remove|move|repair|prune)\b'
    r'|submodule +(?:update|add|deinit|set-url|set-branch|sync)\b'
    r')')

# 🔴 字面尺【抓不到】動態拼接的 git 命令(例 quantifier-hook.harness.js 用 `'git '+'commit'` 躲字面掃描)。
#    ⇒ 這類【已知會躲掉字面】的,明文列進來(每條一句理由)。這【不是】豁免——是【反向的納入】。
KNOWN_DYNAMIC = {
    'scripts/quantifier-hook.harness.js':
        "刻意用字串拼接 GC='git '+'commit' 建 git 命令躲字面掃描 ⇒ regex 抓不到,明文納入(reviewer R1 抓到)",
}
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

def strip_comment_lines(txt):
    # 剝【整行註解】—— sh/py 是 #、js 是 //(reviewer R1:.js 的 // 註解裡有「git commit」字樣造成假命中)。
    # 只剝行首,不碰行內(行內 # / // 可能在字串裡)。
    return '\n'.join(l for l in txt.split('\n') if not re.match(r'\s*(#|//)', l))

def calls_git_write(txt):
    return bool(WRITE.search(strip_comment_lines(txt)))

def build():
    denom = []          # (path, has_selftest, is_husky)
    for f in tracked_files():
        if not is_candidate(f):
            continue
        t = read_text(f)
        # 字面尺命中 或 明文列在 KNOWN_DYNAMIC(躲字面掃描的動態拼接)
        if calls_git_write(t) or f in KNOWN_DYNAMIC:
            denom.append((f, bool(SELFTEST.search(t)), f.startswith('.husky/')))
    return sorted(denom)

def main():
    denom = build()
    testable = [d for d in denom if d[1]]
    unprovable = [d for d in denom if not d[1]]
    print(f"git 寫入分母 = {len(denom)} 支  |  有 --selftest(閘可行為測)= {len(testable)}"
          f"  |  無 --selftest(閘測不到)= {len(unprovable)}")
    print("\n🔴 無法證明隔離(無 --selftest ⇒ 現行閘看不到;逐支列,不是「多幾支」):")
    for f, _sel, husky in unprovable:
        tag = ' [.husky 真 hook?意圖寫主 repo?逐支核]' if husky else ''
        print(f"    {f}{tag}")
    print(f"\n有 --selftest(閘已能行為測,本工具不重測): {len(testable)} 支")
    if os.environ.get('ISOLATION_GATE_ENFORCE') == '1' and unprovable:
        print(f"\n🔴 ENFORCE:{len(unprovable)} 支無法證明隔離 ⇒ exit 1", file=sys.stderr)
        return 1
    return 0

def self_check():
    denom = {d[0] for d in build()}
    ok = True
    # 正對照:已知漏網必須在分母裡
    #   前三支 = 最初的漏網;後兩支 = reviewer R1 抓到的 `git -C`/worktree/submodule 漏網(鎖住回歸)
    for want in ['scripts/deploy-order-gate-verify.sh',
                 'scripts/state-gates-freshness.harness.sh',
                 'scripts/quantifier-hook.harness.js',
                 'scripts/unreported-work-scan.sh',
                 'scripts/commit-pack-preflight.sh']:
        hit = want in denom
        print(f"  正對照 {want}: {'✅ 在分母' if hit else '🔴 漏(尺壞)'}")
        ok = ok and hit
    # 負對照:真唯讀 git 的腳本必須【不在】分母
    neg = 'scripts/literal-sweep.sh'  # 只 git status/show/branch
    out = neg not in denom
    print(f"  負對照 {neg}: {'✅ 不在分母(唯讀)' if out else '🔴 誤收(尺太寬)'}")
    ok = ok and out
    print("  ⇒", "self-check PASS" if ok else "🔴 self-check FAIL")
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(self_check() if '--self-check' in sys.argv[1:] else main())
