#!/usr/bin/env python3
"""literal-fingerprint-gates.py — 掃「用【特徵字面】當世代指紋」的閘, 並量它被後代繼承幾次。

══ 為什麼有這一支(2026-09-07 實撞, 不是設計偏好)═══════════════════════════
`20260904010000` 的前置閘①b 用
    position('PARTNOSEPINDIGITS' IN pg_get_functiondef(...)) = 0
判「庫上那支是不是我抄的那一代」。而唯讀對正式庫實測 **那道閘會【放行】**。
逐代數那個字面:

    20260903230000  4 次   ← 指紋的主人
    20260904010000  1 次
    20260904030000  1 次
    20260904180000  1 次
    20260906900000  1 次
    20260906950000  1 次   ← 今天線上這一代

⇒ 📌 **那個字面被【後面每一代繼承了】** ⇒ 它從「認第 3 代」退化成「第 3 代以後都答 yes」
⇒ 🛑 **一道【釘身分】的閘, 在它保護的東西演化之後, 靜靜退化成一道【釘存在】的閘,
      而退化的方向是【放行】。**
🔵 **這不是那位作者寫壞了** —— 他挑指紋的那一刻, 那個字面**真的只有他那一代有**。
   壞掉的是【時間】, 而沒有任何東西會在它壞掉的時候叫。

⇒ 本支回答板列 `⟦02-CROSSFILEMD5PINS⟧` 留白的那一格:**(b) 尺退化 這一族的分母是多少。**

══ 它答得出什麼 / 答不出什麼(先講)═══════════════════════════════════════
✅ 答得出:哪幾支 migration 用**字面比對**去判身分, 以及那個字面在**後來的 migration 檔**裡出現幾次。
❌ 答不出:
   · **那個閘今天在正式庫會不會放行** —— 那要查 `pg_get_functiondef`, 本支只讀 repo。
     ⇒ 📌 「後代也有這個字面」是**必要條件不是充分條件**:被釘的那支函式今天是哪一代, 本支不知道。
   · 用**別的形狀**判身分的(比 `proconfig` / 比 `md5` / 比參數個數)—— 那是別的字面, 本支的正規式看不到。
     ⇒ `md5` 那一族請用 `scripts/md5-pins-stale.py`。
   · 它**不看 `IN` 的另一邊是什麼** —— 只要 haystack 是 `prosrc` / `pg_get_functiondef` / `pg_get_viewdef`
     就算, 而有些閘拿它去比的是別的東西。
   · 註解裡的字面**不算**(整行 `--` 開頭的先剝掉);而**行尾註解**剝不掉 ⇒ 那一種會被算進來。

用法:
  python3 scripts/literal-fingerprint-gates.py            # 印清單
  python3 scripts/literal-fingerprint-gates.py --selftest # 不讀 migrations, 用內建 fixture 驗這支自己
退出碼:0 = 量到了(不論幾支)· 1 = selftest 失敗 · 2 = 找不到 migrations 目錄
"""
import glob
import io
import os
import re
import sys

# haystack:這幾個才算「在比一支物件的定義」
# 🔴 `別名.` 前綴要吃得到 —— 第一版漏了它, 而 `--selftest` 的第三格【當場紅】。
#    📌 那一格不是裝飾:少了它, `strpos(p.prosrc, …)` 這種最常見的寫法整族看不見。
HAY = r'(?:(?:\w+\.)?prosrc|pg_get_functiondef\s*\([^)]*\)|pg_get_viewdef\s*\([^)]*\)|pg_get_triggerdef\s*\([^)]*\))'
PAT_POSITION = re.compile(r"position\s*\(\s*'([^']{4,})'\s+IN\s+" + HAY, re.I)
PAT_STRPOS = re.compile(r"strpos\s*\(\s*" + HAY + r"\s*,\s*'([^']{4,})'", re.I)
PAT_LIKE = re.compile(HAY + r"\s+(?:NOT\s+)?LIKE\s+'%([^']{4,})%'", re.I)


def strip_comment_lines(sql: str) -> str:
    """整行 `--` 開頭的剝掉。🔴 行尾註解剝不掉 —— 那是本支已知的一個假陽性來源。"""
    return '\n'.join(l for l in sql.split('\n') if not l.lstrip().startswith('--'))


# 🔴🔴 **【假零】的來源 —— 這一段是本支最重要的部分, 而它是實撞出來的。**
#   第一版只認「直接拿 `prosrc` / `pg_get_functiondef(...)` 去比」那一種形狀,
#   而 `--selftest` 用同款的合成字串驗它 ⇒ **九格全綠, 而全樹掃出來【指紋型 0 條】。**
#   🔼 那個 0 是假的。真實世界最常見的寫法是**先撈進一個變數, 再比那個變數**:
#       84    v_def text;
#       87    SELECT pg_get_functiondef(p.oid) INTO v_def
#       95    IF position('PARTNOSEPINDIGITS' IN v_def) = 0 THEN
#   ⚠️ 而我在 selftest 裡**刻意寫了一格說「變數不算」**, 還把它註記成「見檔頭答不出什麼第三條」——
#      📌 **我把真實世界的那一種, 明文排除在分母外, 然後量到 0。**
#   🎯 這正是「我的 fixture 往我的結論偏」:合成的 fixture 長得像我想抓的東西,
#      而**真的那一支長得不一樣, 於是尺說「沒有」。**
#   ✅ 修法:先找出**被賦值為定義**的變數, 再把它們也當 haystack。
ASSIGN = re.compile(
    r'(?:SELECT\s+(?:\w+\.)?(?:pg_get_functiondef\s*\([^)]*\)|pg_get_viewdef\s*\([^)]*\)|prosrc)'
    r'[^;]*?\bINTO\s+(\w+)'
    r'|(\w+)\s*:=\s*(?:\w+\.)?(?:pg_get_functiondef|pg_get_viewdef|pg_get_triggerdef)\s*\()',
    re.I | re.S)


def def_vars(code: str):
    """回傳「被賦值為某個物件定義」的變數名 —— 它們之後也算 haystack。"""
    out = set()
    for m in ASSIGN.finditer(code):
        for g in m.groups():
            if g:
                out.add(g)
    return out


def literals_in(sql: str):
    code = strip_comment_lines(sql)
    out = set()
    for pat in (PAT_POSITION, PAT_STRPOS, PAT_LIKE):
        for m in pat.finditer(code):
            lit = m.group(1)
            # 🔴 純標點 / 純空白的字面不是指紋, 濾掉(它們是語法片段)
            if re.search(r'[A-Za-z0-9_]{4,}', lit):
                out.add(lit)
    # 🔴 第二輪:把「被賦值為定義的變數」也當 haystack 掃一次
    for v in def_vars(code):
        for pat in (
            re.compile(r"position\s*\(\s*'([^']{4,})'\s+IN\s+" + re.escape(v) + r"\b", re.I),
            re.compile(r"strpos\s*\(\s*" + re.escape(v) + r"\s*,\s*'([^']{4,})'", re.I),
            re.compile(re.escape(v) + r"\s+(?:NOT\s+)?LIKE\s+'%([^']{4,})%'", re.I),
        ):
            for m in pat.finditer(code):
                lit = m.group(1)
                if re.search(r'[A-Za-z0-9_]{4,}', lit):
                    out.add(lit)
    return out


def kind_of(lit: str) -> str:
    """把字面分兩層 —— 而**這是啟發式, 不是判準**。

    指紋型:沒有空白的【代號】(像 `PARTNOSEPINDIGITS`)⇒ 用途多半是「這是不是我抄的那一代」
            ⇒ **被後代繼承就退化成存在檢查, 而方向是放行**
    存在型:其餘(SQL 片語如 `FOR EACH ROW`、關聯名如 `order_manual_refunds`)
            ⇒ 用途多半是「這支裡面有沒有那一塊」⇒ **被繼承是正常的, 不算病**
    🔴 分錯的代價不對稱:把【指紋型】分成存在型 = 漏報 ⇒ 邊界往「指紋型」放寬。
    """
    if re.search(r'\s', lit):
        return '存在型'
    if lit.isupper():
        return '指紋型'
    return '存在型'


def selftest() -> int:
    fail = 0
    n = 0

    def cell(name, got, want):
        nonlocal fail, n
        n += 1
        if got == want:
            print(f'  PASS {name} ⇒ {got}')
        else:
            print(f'  🔴 FAIL {name} ⇒ {got} 但宣稱是 {want}')
            fail = 1

    cell('position 形狀抓得到',
         literals_in("IF position('PARTNOSEPINDIGITS' IN pg_get_functiondef(p.oid)) = 0 THEN"),
         {'PARTNOSEPINDIGITS'})
    # 🔴🔴 **這一格原本寫「刻意不算」, 而那正是造出假零的那一刀。**
    #    真實世界的閘就是這個形狀(先 SELECT INTO 一個變數, 再比那個變數)。
    #    ✅ 現在:**變數有被賦值為定義 ⇒ 算**;沒有被賦值過 ⇒ 不算(否則什麼變數都會中)。
    cell('🔴 真實形狀:SELECT INTO 變數再比它 ⇒ 必須抓得到',
         literals_in("DECLARE v_def text; BEGIN\n"
                     "  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p;\n"
                     "  IF position('PARTNOSEPINDIGITS' IN v_def) = 0 THEN RAISE; END IF; END"),
         {'PARTNOSEPINDIGITS'})
    cell('反向對照:沒有被賦值為定義的變數 ⇒ 不算',
         literals_in("IF position('ZZQ_RANDOM_VAR' IN v_never_assigned) = 0 THEN"),
         set())
    cell('strpos(prosrc, …) 抓得到',
         literals_in("IF strpos(p.prosrc, 'ZZQ_MARKER_X') = 0 THEN"),
         {'ZZQ_MARKER_X'})
    cell('LIKE 形狀抓得到',
         literals_in("WHERE p.prosrc LIKE '%ZZQ_LIKE_MARK%'"),
         {'ZZQ_LIKE_MARK'})
    # 🔴 判別力那一格:整行註解裡的字面【不可以】被算到
    cell('整行註解裡的不算',
         literals_in("-- position('ZZQ_COMMENT_ONLY' IN pg_get_functiondef(x))"),
         set())
    # 🔴 反向對照:沒有 haystack 的字面比對不算(否則什麼字串都會中)
    cell('沒有 haystack 的不算',
         literals_in("IF position('ZZQ_NO_HAY' IN some_other_col) = 0 THEN"),
         set())
    cell('分層:代號式 = 指紋型', kind_of('PARTNOSEPINDIGITS'), '指紋型')
    cell('分層:帶空白的 SQL 片語 = 存在型', kind_of('FOR EACH ROW'), '存在型')
    cell('分層:小寫關聯名 = 存在型', kind_of('order_manual_refunds'), '存在型')
    if fail == 0:
        print(f'✅ literal-fingerprint-gates --selftest {n}/{n}'
              '(四種形狀抓得到 + 註解不算 + 沒有 haystack 不算 + 分層三格)')
    return fail


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        return selftest()

    here = os.path.dirname(os.path.abspath(__file__))
    mdir = os.path.join(os.path.dirname(here), 'supabase', 'migrations')
    if not os.path.isdir(mdir):
        print(f'🔴 找不到 {mdir} ⇒ 這是【路徑錯】不是【零命中】', file=sys.stderr)
        return 2

    files = sorted(glob.glob(os.path.join(mdir, '*.sql')))
    raw = {p: io.open(p, encoding='utf-8').read() for p in files}
    print(f'══ 用【特徵字面】當世代指紋的閘(分母:{len(files)} 支 migration)══')

    rows = []
    for p in files:
        for lit in sorted(literals_in(raw[p])):
            later = [q for q in files if os.path.basename(q) > os.path.basename(p)
                     and lit in raw[q]]
            rows.append((os.path.basename(p), lit, len(later),
                         [os.path.basename(q)[:14] for q in later], kind_of(lit)))

    if not rows:
        print('🔵 零命中 —— 而本支的 --selftest 證明它抓得到四種形狀 ⇒ 這個零是【真的沒有】')
        return 0

    inherited = [r for r in rows if r[2] > 0]
    print(f'  命中 {len(rows)} 條(檔 × 字面);其中**被後代繼承**的 {len(inherited)} 條')
    fp = [r for r in rows if r[4] == '指紋型']
    fp_inh = [r for r in fp if r[2] > 0]
    print(f'  其中【指紋型】{len(fp)} 條, 而被後代繼承的 {len(fp_inh)} 條 ← 🔴 這一格才是 (b) 尺退化的分母')
    print('  🛑 而【存在型】被繼承是【正常的】—— 那種閘問的是「有沒有那一塊」, 不是「是不是那一代」')
    print('  🔴 「被後代繼承」= 那個字面在【版本號更大的 migration】裡也出現 '
          '⇒ 這道閘可能已經分不出世代')
    print()
    for f, lit, cnt, later, kind in rows:
        mark = '🔴' if cnt > 0 else '🟢'
        print(f'  {mark} [{kind}] {f[:14]}  「{lit[:38]}」  後代出現 {cnt} 次')
        if cnt:
            print(f'        ⇒ {", ".join(later[:8])}{" …" if cnt > 8 else ""}')
    print()
    print('  🛑 射程:🔴 只代表【repo 裡後面也有這個字面】—— 它是「這道閘可能已退化」的**必要條件**,')
    print('     不是充分條件。要下結論得問正式庫「被釘的那支今天是哪一代」。')
    print('     🟢 也不代表安全:那支被釘的物件可能【根本沒有後代】, 或後代不在 migrations 裡。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
