#!/usr/bin/env python3
"""新增的 rollback 註解段落必須帶 SET lock_timeout。

🔴 為什麼是【守門】而不是【回溯補完】(2026-09-07 主視窗 A 裁):
   回溯要一個分母, 而那個分母【召回率不明】——
   382 支 migration 裡, 本判準認得出 rollback 標頭的只有 149 支;
   剩下 233 支是「真的沒有」還是「判準不認得」**答不出來**(相異寫法 748 種)。
   ⇒ 📌 **一個召回率不明的分母, 撐不起一次 382 支的批次改** ——
     改完之後沒有人能說「都補完了」, 而那正是那種批次唯一的價值。
   ⇒ ✅ 改成只看【這次新增的】那幾段:不需要分母, 也不受召回率影響。

🛑 **它【不】做什麼(寫在這裡, 不要讓下一個人以為這件事解決了)**:
   · 既有的 **144 支**(149 認得出 − 5 已帶)**不會被補**
     ⇒ **今天照著既有檔貼 rollback 的人, 仍然沒有 lock_timeout。**
   · 它只認得出本判準看得懂的標頭 ⇒ **用別種寫法新增的 rollback, 它看不到**(而那是「漏報」不是「誤報」)。

🔬 段落怎麼框(這一格是本閘的承重件):
   標頭 = 一行註解, 剝掉 `--` 與 `══`/編號後**以 rollback 或 回退 開頭**(必須錨在開頭 ——
          否則會撈到「⇒ 整輪取消一起 rollback」這種講交易的散文)。
   結尾 = **第一行會執行的碼**(rollback 內容本來整段都是註解)。
   ⛔ ~~結尾 = 下一個 ══ 橫幅~~ **那個版本是錯的**:199 段裡 **166 段一路吃到檔尾**
      (中位數 23 行 / 最長 710 行)⇒ 它把 migration 自己的正向 SQL 吞進來
      ⇒ 量出「15 支已經帶了」而**正確答案是 5** —— 命中的 `SET LOCAL lock_timeout` 是正向碼。
      📌 **一個框太大的範圍, 會讓你在別人的碼裡找到自己要的答案。**
      🟢 而**段落長度本身就是「我框對了嗎」的量具**:改對之後中位數 23⇒7、最長 710⇒166。
"""
import io, os, re, subprocess, sys

HDR = re.compile(r'^\s*--\s*[═=\s\d.]*\b(rollback|回退)\b', re.I)
WANT = 'lock_timeout'


def is_comment(line: str) -> bool:
    t = line.strip()
    return t == '' or t.startswith('--')


def sections(lines):
    """回傳 [(標頭行號1-based, 段落文字)]。結尾 = 第一行會執行的碼。"""
    out = []
    for a, l in enumerate(lines):
        if not HDR.match(l):
            continue
        b = a + 1
        while b < len(lines) and is_comment(lines[b]):
            b += 1
        out.append((a + 1, '\n'.join(lines[a:b])))
    return out


def added_line_numbers(path):
    """這次 staged diff 裡【新增】的行號(1-based, 對新檔)。"""
    try:
        d = subprocess.run(['git', 'diff', '--cached', '-U0', '--', path],
                           capture_output=True, text=True, check=False).stdout
    except Exception:
        return set()
    got, cur = set(), None
    for l in d.split('\n'):
        m = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@', l)
        if m:
            cur = int(m.group(1))
            continue
        if cur is None:
            continue
        if l.startswith('+') and not l.startswith('+++'):
            got.add(cur); cur += 1
        elif l.startswith('-'):
            pass
        else:
            cur += 1
    return got


def check(paths, added_of):
    bad = []
    for p in paths:
        lines = io.open(p, encoding='utf-8', errors='replace').read().split('\n')
        added = added_of(p)
        for hdr, seg in sections(lines):
            if hdr not in added:
                continue          # 🔵 既有段落不管 —— 本閘只看這次新增的
            if WANT not in seg:
                bad.append((p, hdr, lines[hdr - 1].strip()[:70], len(seg.split('\n'))))
    return bad


def report(bad):
    if not bad:
        return 0
    print('🔴 新增的 rollback 段落沒有帶 `SET lock_timeout`:%d 段' % len(bad))
    for p, hdr, head, n in bad:
        print('   %s:%d  (%d 行)' % (p, hdr, n))
        print('      標頭逐字:%s' % head)
    print('   ── 為什麼 ──')
    print('   rollback 是【人把註解貼進 psql】跑的, 而 psql 預設沒有 lock_timeout ⇒ 它會【無限等】。')
    print('   而「很慢」與「卡在鎖上」在那個畫面上是同一件事:兩者都是一個不動的游標。')
    print('   ⇒ 修法:在那一段的第一行加 `-- SET LOCAL lock_timeout = \'5s\';`(照 repo 慣例的 5s)。')
    print('   🛑 本閘只看【這次新增】的段落 —— 既有 144 支沒有被補, 那是 ⟦db-ROLLBACKLOCKWAIT⟧ 的另一半。')
    return 1


def selftest():
    import tempfile
    p, f = 0, 0
    def ck(label, got, want):
        nonlocal p, f
        if got == want:
            p += 1
        else:
            f += 1
            print('  🔴 FAIL %s (得 %r, 該是 %r)' % (label, got, want))
    d = tempfile.mkdtemp()
    def w(name, text):
        q = os.path.join(d, name)
        io.open(q, 'w', encoding='utf-8').write(text)
        return q

    GOOD = "-- Rollback(手動):\n--   SET LOCAL lock_timeout = '5s';\n--   DROP TABLE t;\nSELECT 1;\n"
    BAD  = "-- Rollback(手動):\n--   DROP TABLE t;\nSELECT 1;\n"
    a = w('a.sql', GOOD); b = w('b.sql', BAD)

    # ① 有帶 ⇒ 綠   ② 沒帶 ⇒ 紅(兩個方向的突變)
    ck('① 新增段落有帶 lock_timeout ⇒ 0 筆', len(check([a], lambda _p: {1, 2, 3})), 0)
    ck('② 新增段落沒帶 ⇒ 1 筆', len(check([b], lambda _p: {1, 2})), 1)
    # ③ 同一支檔, 段落【不是這次新增】⇒ 不管
    ck('③ 既有段落(不在 added 裡)⇒ 0 筆', len(check([b], lambda _p: set())), 0)
    # ④ 🔴 錨在開頭:講交易的散文不可以被當成標頭
    c = w('c.sql', "-- ⇒ 例外冒出去 ⇒ 整輪取消一起 rollback。\nSELECT 1;\n")
    ck('④ 散文裡的 rollback 不算標頭 ⇒ 0 筆', len(check([c], lambda _p: {1})), 0)
    # ⑤ 🔴 結尾必須停在第一行會執行的碼 —— 否則會吃到正向 SQL 的 lock_timeout
    e = w('e.sql', "-- Rollback(手動):\n--   DROP TABLE t;\nSET LOCAL lock_timeout = '5s';\nCREATE TABLE t();\n")
    ck('⑤ 正向碼裡的 lock_timeout 不算數 ⇒ 仍 1 筆', len(check([e], lambda _p: {1, 2})), 1)
    # ⑥ 負對照:現造標頭不該被認出來
    g = w('g.sql', "-- zqx7742tmpsection:\n--   DROP TABLE t;\nSELECT 1;\n")
    ck('⑥ 負對照 現造標頭 ⇒ 0 筆', len(check([g], lambda _p: {1, 2})), 0)
    # ⑦ report 在有 finding 時 rc=1、無 finding 時 rc=0
    ck('⑦ report 有 finding ⇒ rc=1', report(check([b], lambda _p: {1, 2})), 1)
    ck('⑧ report 無 finding ⇒ rc=0', report([]), 0)

    print('── selftest: %d PASS / %d FAIL' % (p, f))
    if p + f != 8:
        print('🔴 格數 ≠ 8 —— 有人加減了格子而沒有動這個數')
        return 1
    return 1 if f else 0


def main():
    args = [a for a in sys.argv[1:] if a != '--selftest']
    if '--selftest' in sys.argv[1:]:
        return selftest()
    if args:
        paths = [a for a in args if a.endswith('.sql')]
        return report(check(paths, added_line_numbers))
    out = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACM'],
                         capture_output=True, text=True, check=False).stdout
    paths = [p for p in out.split('\n')
             if p.startswith('supabase/migrations/') and p.endswith('.sql') and os.path.exists(p)]
    if not paths:
        print('── rollback-locktimeout-gate:這顆 commit 沒有 staged 的 migration ⇒ 不適用')
        return 0
    return report(check(paths, added_line_numbers))


if __name__ == '__main__':
    sys.exit(main())
