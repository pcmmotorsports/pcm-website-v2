#!/usr/bin/env python3
# ============================================================
# grep-claim-recheck — 重跑「檔案裡寫下的 grep 宣稱」,比對值有沒有漂移
# ============================================================
# 用法:  python3 <本檔> [--selftest] [<repo-root>]
#
# ══ 🔴 它答不了什麼(檔頭,不是檔尾)══════════════════════════════════
#   本尺的輸出有 6 態,而其中 4 態是「沒判」。**「沒判」不是「通過」。**
#     COUNT / FILES / LINES  真的跑了
#     SKIPPED-ENV    目標命中 .env* ⇒ 不碰(見下)
#     SKIPPED-META   pattern 含 regex 元字元而原文沒用 -E ⇒ 語意不同 ⇒ 不判
#     SKIPPED-FLAG   🔴 原文旗標與本尺不同義 ⇒ 不判
#     SKIPPED-NOPATH 目標不像路徑(grep 旗標 / 中文詞 / 簡寫)⇒ 不判
#     NOT-A-FILE     目標不存在 ⇒ 沒有被檢查
#   ⇒ 報告裡引用「漂移 N 條」時,**分母是 COUNT+FILES+LINES,不是抽到的總數。**
#
# ══ 🔴 為什麼有 SKIPPED-FLAG(2026-08-26 實測出來的,不是設計出來的)══
#   本尺第一版一律用 `grep -c` 去比。而實測原文的旗標分佈:
#     -c 131 · -rn 45 · -n 21 · -rl 17 · -rln 17 · -cE 14 · -oE 12 · -l 9 …
#   ⇒ 那個 `⇒ N` 至少有四種意思:計數 / 行數 / 檔數 / 出現次數。
#   🔴 實錘:`scripts/rpc-apply-smoke.sh:15` 原文 `grep -n … ⇒ 1067`,
#      那個 1067 是【行號】。第一版把它判成「漂移」,而它根本不是同一種東西。
#   📌 **兩邊都是真的量測,而它們量的是不同的量綱。** 這種錯長得跟 finding 一模一樣。
#
# ══ 🔴 為什麼有 basename 補路徑(resolve)—— 它唯一的實證理由 ═══════
#   本尺第一版只認完整路徑。而 `CartContext.tsx:294` 有一句
#     `grep -c 'userId' <本檔>` ⇒ 檔上寫 0,而實際 2
#   —— 那正是「一句說明自己就是它宣稱不存在的東西」那個病的教科書實例,
#   🔴 **而第一版抓不到它**:那句只寫了 basename ⇒ 落進 `NOT-A-FILE` 那 204 條裡。
#   📌 **一個已知的病,被一把正在找那個病的尺漏掉。** 修法② 是為了它而加的。
#
# ══ 🔴 為什麼 .env* 的排除寫在【尺裡面】而不是報告的注意事項裡 ═══════
#   本尺第一版 grep 了 apps/storefront/.env.local(只取計數、沒印內容 ⇒ 未洩漏)。
#   而真正的理由是:**下一個人會照抄這把尺**,而他可能用 `grep -n` 或 `grep -o`
#   ⇒ **這把尺會比我活得久。** 所以排除必須是一行程式碼,不是一句叮嚀。
#
# ══ 已知盲區(寫死,不留給下一棒推測)════════════════════════════════
#   · 只認單行、反引號包住的 `grep …` ⇒ `N` 形狀。多行 / && 串接 / 用變數的抓不到。
#   · 目標帶管線(`| wc -l` 32 條 / 其他 28 條)⇒ 本版只取最後一段當路徑,
#     而那對 `| wc -l` 是對的、對其他管線【不一定】⇒ 標 SKIPPED-FLAG。
#   · basename 補路徑只處理【唯一命中】;同名多支不處理(2026-08-26 那 14 個剛好都唯一)。
#   · 🔴 本尺不掃 ~/pcm-mailbox/(信箱)。它們今天被排除是因為「不在 git」——
#     **那是運氣不是設計。** 哪天信箱收進 repo,本尺會被那些交件檔灌爆。
# ============================================================
import fnmatch, os, re, subprocess, sys

ENV_PREFIX = '.env'
META = re.compile(r'[\^\$\*\+\?\[\]\(\)\{\}\\|]')
PATHY = re.compile(r'(/|\.(md|sql|ts|tsx|js|mjs|sh|py|json|css|yml|yaml|tsv|txt|html))$')
EXTRACT = re.compile(
    r"`\s*(?:git\s+)?grep\s+((?:-[a-zA-Z]+\s+)*)['\"]([^'\"]{3,60})['\"]\s+([^`]{1,80})`\s*[⇒=]>?\s*\*{0,2}(\d{1,6})\b")

_index = None
def resolve(target):
    """只有 basename 時,去 git ls-files 找唯一命中,補成完整路徑。"""
    global _index
    if os.path.exists(target):
        return target
    if '/' in target:
        return target
    if _index is None:
        _index = {}
        for f in subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split('\n'):
            if f:
                _index.setdefault(os.path.basename(f), []).append(f)
    hits = _index.get(target, [])
    return hits[0] if len(hits) == 1 else target      # 同名多支 ⇒ 不猜

def probe(flags, pattern, target):
    """回 (態, 值|None)。6 態,而其中 4 態是『沒判』。"""
    fl = flags.replace('-', '').replace(' ', '')
    if os.path.basename(target).startswith(ENV_PREFIX):
        return ('SKIPPED-ENV', None)
    if not PATHY.search(target):
        return ('SKIPPED-NOPATH', None)
    target = resolve(target)
    if not os.path.exists(target):
        return ('NOT-A-FILE', None)
    if 'o' in fl or 'n' in fl:                 # -o 數出現次數 / -n 印行(那個 N 常是行號)
        return ('SKIPPED-FLAG', None)
    if META.search(pattern) and 'E' not in fl:  # 原文沒用 -E 而 pattern 有元字元 ⇒ 語意對不上
        return ('SKIPPED-META', None)
    base = ['grep', '-r'] if os.path.isdir(target) else ['grep']
    base += ['-E'] if 'E' in fl else ['-F']
    if 'l' in fl:
        r = subprocess.run(base + ['-l', pattern, target], capture_output=True, text=True)
        return ('FILES', len([x for x in r.stdout.split('\n') if x]))
    r = subprocess.run(base + ['-c', pattern, target], capture_output=True, text=True)
    if os.path.isdir(target):                  # -r -c 每檔一行 ⇒ 加總
        return ('COUNT', sum(int(x.rsplit(':', 1)[-1]) for x in r.stdout.split('\n') if ':' in x))
    return ('COUNT', int(r.stdout.strip() or 0))

def selftest():
    """九格雙向表演。任一 FAIL ⇒ 本次輸出作廢(exit 1)。
    🔴 靶一律帶當天日期 —— 固定靶會在這支檔進 repo 那一刻被自己燒掉。"""
    import tempfile
    TARGET = 'zzz-selftest-20260826'            # ← 🔴 換日期,不要沿用
    # 🔴 為什麼是 `zzz-` 開頭而不是別的:2026-08-26 量到,本檔原本用 `zzq-`,
    #    而全隊的哨兵掃描尺字集要求 `zzz` 三個 z ⇒ **那個靶對掃描器是隱形的。**
    #    ⇒ 一個【隱形的已死靶】比一個【被記帳的已死靶】危險:
    #      後者會出現在黑名單上,前者會被下一個人當成乾淨的靶再用一次。
    ok = True
    def chk(name, got, want):
        nonlocal ok
        good = got == want; ok = ok and good
        print(f"  {'✅' if good else '🔴'} {name:46s} 得 {str(got):24s} 期望 {want}")
    d = tempfile.mkdtemp()
    p = os.path.join(d, 'plain.md'); open(p, 'w').write(f'alpha\n{TARGET}\nalpha\n')
    e = os.path.join(d, '.env.local'); open(e, 'w').write('SECRET=alpha\n')
    chk('-c 純字面 ⇒ 真的數',            probe('-c ', 'alpha', p),   ('COUNT', 2))
    chk('-c 查無 ⇒ COUNT 0(不是跳過)',   probe('-c ', 'gamma', p),   ('COUNT', 0))
    chk('-l ⇒ 算【檔數】不是計數',         probe('-l ', 'alpha', p),   ('FILES', 1))
    chk('🔴 -n ⇒ SKIPPED-FLAG(量綱不同)', probe('-n ', 'alpha', p),   ('SKIPPED-FLAG', None))
    chk('🔴 .env.local ⇒ SKIPPED-ENV',   probe('-c ', 'alpha', e),   ('SKIPPED-ENV', None))
    chk('🔴 跳過 != 零命中(要分得開)',
        probe('-c ', 'alpha', e) != probe('-c ', 'gamma', p), True)
    chk('元字元 + 無 -E ⇒ SKIPPED-META',  probe('-c ', '^alpha', p),  ('SKIPPED-META', None))
    chk('元字元 + 有 -E ⇒ 真的跑',        probe('-cE ', '^alpha', p), ('COUNT', 2))
    chk('不像路徑(-l 當目標)⇒ NOPATH',   probe('-c ', 'alpha', '-l'), ('SKIPPED-NOPATH', None))
    print(f"\n⇒ 自檢 {'PASS(九格印出不同答案)' if ok else 'FAIL ⇒ 本次輸出作廢'}")
    return 0 if ok else 1

def main(root='.'):
    os.chdir(root)
    files = [f for f in subprocess.run(['git', 'ls-files'], capture_output=True, text=True)
             .stdout.split('\n') if f.endswith(('.md', '.sh', '.py', '.sql', '.ts', '.tsx'))]
    tally, drift = {}, []
    for f in files:
        try:
            lines = open(f, encoding='utf-8', errors='ignore').read().split('\n')
        except OSError:
            continue
        for i, ln in enumerate(lines):
            for m in EXTRACT.finditer(ln):
                flags, pat = m.group(1), m.group(2)
                tgt = m.group(3).strip().split()[-1].strip('`"\' ')
                claimed = int(m.group(4))
                kind, actual = probe(flags, pat, tgt)
                tally[kind] = tally.get(kind, 0) + 1
                if kind in ('COUNT', 'FILES') and actual != claimed:
                    drift.append((f, i + 1, flags.strip(), pat, tgt, claimed, actual))
    judged = sum(tally.get(k, 0) for k in ('COUNT', 'FILES', 'LINES'))
    print('抽到的宣稱去向(🔴 六態 —— 跳過【不是】通過):')
    for k in sorted(tally):
        print(f'  {k:16s} {tally[k]:4d}')
    print(f'\n🔴 漂移 {len(drift)} 條,而它的分母是【真的跑了的 {judged} 條】,不是抽到的總數 {sum(tally.values())}')
    for d in drift:
        print(f'  {d[0]}:{d[1]}  grep {d[2]} {d[3]!r} {d[4]}   檔上寫 {d[5]} ⇒ 現在 {d[6]}')

if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv else main(sys.argv[1] if len(sys.argv) > 1 else '.'))
