#!/usr/bin/env python3
"""止血閘:新的 migration 若有 `EXCEPTION WHEN OTHERS` 而【沒有】接 `query_canceled` ⇒ 出聲。

══ 它從哪裡來 ════════════════════════════════════════════════════════════════
板列 `⟦b4-NCPCANCELROLLBACK⟧` + `docs/plans/2026-09-07-when-others-unified-handling-plan.md`。
codex 2026-09-04 逐字:「`WHEN OTHERS` 不接 `query_canceled` 與 `assert_failure`;
重算等待 admin 鎖時撞 statement timeout, 整筆客人收款仍會回滾, 違反硬不變式。」
主視窗 `-f1` 2026-09-07 批:**baseline 釘現有 18 支、只報不擋、判準先剝註解再數。**

══ 🔴 為什麼判準【一定要剝註解】—— 這是本閘存在的第二個理由 ══════════════════
全 repo 有 **8 支**檔案「含 `query_canceled`」, 而剝掉註解之後**只剩 4 支**真的在碼裡接。
🎯 **中間那 4 支只在【註解】裡提到它** —— 而其中一支正是那一列的主角
`20260904230000_m4b_noncardpaid_settle_and_expire_leg.sql`:
**它的註解裡逐字抄著 codex 那句 finding。**
⇒ 📌 **一把不剝註解的尺會把它算成「已經接了」—— 而那個字之所以在檔裡, 正是因為它【沒接】。**

══ 🛑 它【不】做什麼 ═════════════════════════════════════════════════════════
· **它不擋任何人。** 離場碼 3 是給 `harvest-chain` 的 `REPORT_ONLY` 那一族用的
  (那一族逐字「只報不擋」, `verdict` 不把它的 rc 算進放行判定)。
  ⇒ 🔴 **現存 18 支會讓一道【會擋】的閘第一天就被關掉** —— 那是本 repo「閘死於誤報」那一族。
· **它不判「那個 `WHEN OTHERS` 包住的是哪一段」** —— 它只答「這支檔裡有沒有這個結構」。
  ⇒ 有的可能包的是無害的段落。**要判那個要開檔。**
· **它不看 `packages/` 與 `apps/`** —— 那一側有沒有同型的 catch-all, 沒有人量過。

══ 🔴 baseline 的意思(以及它會怎麼騙你)═══════════════════════════════════
`scripts/when-others-cancel-baseline.txt` 釘住**現有**那些檔名。
· 檔名在 baseline 裡而仍然犯規 ⇒ **只印, 不算新增**(那是 plan §4 要另外排的債)。
· 🟢 檔名在 baseline 裡而**已經修好** ⇒ 印一行「可以從 baseline 拿掉」——
  🛑 **本閘不會自己去改 baseline**:那是一個【人的決定】, 不是一個副作用。
· 🔴 **不在 baseline 而犯規 ⇒ 這就是本閘唯一要叫的那件事。**

⚠️ **baseline 是【檔名】不是【內容雜湊】** ⇒ 有人把一支既有檔改壞, 本閘**看不到**。
   它守的是「不要長新的」, **不是**「舊的沒有變壞」。**這一句要跟著結論走。**

用法:
  python3 scripts/when-others-cancel-gate.py            對整個 migrations 目錄跑
  python3 scripts/when-others-cancel-gate.py --selftest 六個世界
  ⚠️ **`lint-staged` 會在後面附上 staged 的檔名** ⇒ 位置參數一律忽略(見檔尾)。
  python3 scripts/when-others-cancel-gate.py --write-baseline   重寫 baseline(要人自己決定)

離場碼:0=沒有新增的  3=有新增的(只報不擋)  2=用法錯  9=環境壞了
"""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MIGRATIONS = os.path.join(REPO, 'supabase', 'migrations')
BASELINE = os.path.join(HERE, 'when-others-cancel-baseline.txt')

RE_OTHERS = re.compile(r'\bEXCEPTION\s+WHEN\s+OTHERS\b', re.I | re.S)
RE_QC = re.compile(r'\bquery_canceled\b', re.I)


def strip_sql_comments(s: str) -> str:
    """剝掉 `--` 行註解與 `/* */` 區塊註解;單引號字串原樣保留。

    🔴 **不要用 `sed 's/--.*//'`** —— 它會砍掉字串裡的 `--`。
    ⚠️ **已知限制**:dollar-quoting(`$$ … $$`)裡的單引號配對可能被算錯。
       對本閘的兩個 pattern 而言影響是【可能少剝一點註解】⇒ 偏向**少報**新增者。
       **偏向的方向要寫出來, 不要只說「有限制」。**
    """
    out, i, n = [], 0, len(s)
    while i < n:
        if s.startswith('--', i):
            j = s.find('\n', i)
            i = n if j < 0 else j
        elif s.startswith('/*', i):
            j = s.find('*/', i + 2)
            i = n if j < 0 else j + 2
        elif s[i] == "'":
            j = i + 1
            while j < n:
                if s[j] == "'":
                    if j + 1 < n and s[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append(s[i:j + 1])
            i = j + 1
        else:
            out.append(s[i])
            i += 1
    return ''.join(out)


def offends(text: str) -> bool:
    """有 `EXCEPTION WHEN OTHERS` 而【碼裡】沒有 `query_canceled`。"""
    body = strip_sql_comments(text)
    return bool(RE_OTHERS.search(body)) and not RE_QC.search(body)


def read_baseline():
    if not os.path.exists(BASELINE):
        return None
    names = set()
    with open(BASELINE, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#'):
                names.add(line)
    return names


def scan():
    if not os.path.isdir(MIGRATIONS):
        print(f'🔴 找不到 {MIGRATIONS} ⇒ ENV-FAIL', file=sys.stderr)
        sys.exit(9)
    hits = []
    total = 0
    for name in sorted(os.listdir(MIGRATIONS)):
        if not name.endswith('.sql'):
            continue
        total += 1
        with open(os.path.join(MIGRATIONS, name), encoding='utf-8', errors='replace') as f:
            if offends(f.read()):
                hits.append(name)
    return total, hits


def main_scan():
    total, hits = scan()
    base = read_baseline()
    if base is None:
        print('🔴 baseline 不存在 ⇒ 這【不是通過】—— 先跑 --write-baseline 並讓人看過', file=sys.stderr)
        sys.exit(9)
    new = [h for h in hits if h not in base]
    fixed = sorted(base - set(hits))
    print(f'── when-others-cancel-gate:分母 {total} 支 .sql(剝註解後判)')
    print(f'   犯規 {len(hits)} 支 · baseline {len(base)} 支 · 新增 {len(new)} 支 · 已修好 {len(fixed)} 支')
    if fixed:
        print('   🟢 這幾支已經修好了, 可以從 baseline 拿掉(本閘不自己改 baseline):')
        for x in fixed:
            print(f'      {x}')
    if new:
        print('   🔴 新增(這就是本閘唯一要叫的那件事):')
        for x in new:
            print(f'      {x}')
        print('   ✅ 修法:那支 migration 的 EXCEPTION 區塊補一行')
        print('      WHEN query_canceled THEN RAISE;   -- 逾時/取消不吞, 原樣往外')
        print('   🛑 只報不擋 —— 而【不擋不等於不重要】, 見 ⟦b4-NCPCANCELROLLBACK⟧。')
        return 3
    print('   ✅ 沒有新增的')
    return 0


def selftest():
    ok = True

    def ck(name, got, want):
        nonlocal ok
        if got == want:
            print(f'  ✅ {name}(得 {got})')
        else:
            print(f'  🔴 {name} —— 得 {got} 期望 {want}')
            ok = False

    # 世界一:接了 ⇒ 不叫
    ck('①新檔接了 query_canceled ⇒ 不算犯規',
       offends("""CREATE FUNCTION f() RETURNS void AS $$ BEGIN
         NULL;
       EXCEPTION
         WHEN query_canceled THEN RAISE;
         WHEN OTHERS THEN NULL;
       END $$ LANGUAGE plpgsql;"""), False)

    # 世界二:沒接 ⇒ 叫
    ck('②新檔沒接 ⇒ 算犯規',
       offends("""CREATE FUNCTION f() RETURNS void AS $$ BEGIN
         NULL;
       EXCEPTION
         WHEN OTHERS THEN NULL;
       END $$ LANGUAGE plpgsql;"""), True)

    # 世界三:只在【註解】裡提到 ⇒ 不算接(這是本閘存在的第二個理由)
    ck('③只在註解裡提到 query_canceled ⇒ 仍算犯規',
       offends("""-- codex 說:WHEN OTHERS 不接 query_canceled, 違反硬不變式
       CREATE FUNCTION f() RETURNS void AS $$ BEGIN
         NULL;
       EXCEPTION
         WHEN OTHERS THEN NULL;   /* query_canceled 這裡也是註解 */
       END $$ LANGUAGE plpgsql;"""), True)

    # 世界四:負對照 —— 完全沒有 WHEN OTHERS ⇒ 不算犯規
    #   🔴 少了它, 一支「永遠回 True」的判定會讓 ②③ 通過。
    ck('④負對照:沒有 WHEN OTHERS ⇒ 不算犯規',
       offends('CREATE TABLE t (id int); -- query_canceled 只是個字'), False)

    # 世界五:剝註解本身要真的在做事(而不是原樣回傳)
    ck('⑤strip 真的剝掉了 -- 註解',
       'SECRETWORD' in strip_sql_comments('SELECT 1; -- SECRETWORD\n'), False)
    ck('⑥strip 不得剝掉【字串裡】的 --',
       "'a--b'" in strip_sql_comments("SELECT 'a--b';"), True)

    print('✅ selftest PASS(六個世界)' if ok else '🔴 selftest FAIL')
    return 0 if ok else 1


def write_baseline():
    total, hits = scan()
    with open(BASELINE, 'w', encoding='utf-8') as f:
        f.write('# when-others-cancel-gate 的 baseline —— 釘住【寫下這一刻已經犯規】的那些檔。\n')
        f.write('# 🔴 它是【檔名】不是內容雜湊 ⇒ 有人把既有檔改壞, 本閘看不到。\n')
        f.write('#    它守的是「不要長新的」, 不是「舊的沒有變壞」。\n')
        f.write(f'# 產生方式:python3 scripts/when-others-cancel-gate.py --write-baseline(當下分母 {total} 支)\n')
        f.write('# 🛑 修好一支之後【手動】把它從這裡刪掉 —— 本閘不自己改這個檔。\n')
        for h in hits:
            f.write(h + '\n')
    print(f'baseline 已寫:{len(hits)} 支(分母 {total})')
    return 0


if __name__ == '__main__':
    argv = sys.argv[1:]
    known = ('--selftest', '--write-baseline')
    # 🔴🔴 **`lint-staged` 會把【staged 的檔名】附在命令後面** —— 第一版把它當成「不認得的參數」
    #    ⇒ `rc=2` ⇒ 那道 hook 直接 FAILED。而在我自己終端機跑是綠的。
    #    🎯 **一個「嚴格檢查參數」的好習慣, 在 lint-staged 底下就是一個誤擋。**
    #    ⇒ ✅ 只驗【以 `-` 開頭的旗標】;位置參數(檔名)一律忽略 —— 本閘本來就掃整個目錄。
    for a in argv:
        if a.startswith('-') and a not in known:
            print(f'🔴 不認得的旗標:{a}(只認 {" ".join(known)})', file=sys.stderr)
            sys.exit(2)
    if '--selftest' in argv:
        sys.exit(selftest())
    if '--write-baseline' in argv:
        sys.exit(write_baseline())
    sys.exit(main_scan())
