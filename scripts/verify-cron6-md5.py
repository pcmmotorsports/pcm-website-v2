#!/usr/bin/env python3
"""⟦b4-CRON6⟧ 片2 的 md5 自檢 —— 而它防的是一個【真的發生過】的病。

2026-08-29:折 must-fix ① 時算出完成版 md5,接著折 must-fix ③ 把一段實測註解寫進
**函式體裡面** ⇒ 第二次折改掉了第一次折量的那個東西。同一個人、同一輪、同一支檔。
⇒ 首次 apply 會過(prosrc = L3a,在名單裡),而**重跑就 RAISE** ——
  而那支 migration 旁邊的註解逐字寫著「重跑冪等放行」。
📌 那行註解描述的是它【想要】的行為,不是它會有的行為。(`-b4` R3 抓到)

🔴 **本腳本自己帶正對照**:先拿 L3a 那支【已知 md5】驗抽法。
   少了那一步,一把壞掉的抽法與對的答案會印同一個綠 ——
   而那正是 `-b4` 自己第一發踩到的:它的 regex 命中註解裡的 `$fn$` 字面 ⇒ 抽到 3 個字元。

🔵 **2026-09-03 一般化**:原本只看 `CRON6` 那一支寫死的檔 —— 而它**從來沒有被呼叫過**
   (真檢查零呼叫端;`package.json` 只在【本檔自己被 stage】時跑 `--selftest`)。
   ⇒ 現在改成掃全部 migration 的**自我宣稱**, 並接進 `supabase/migrations/*.sql`。
   ⚠️ **檔名沒有跟著改** —— 改名要動一支 migration 的引用, 而 migration 是不可變歷史。
      📌 **所以這支檔的名字比它的射程窄, 而那是已知的**(`⟦02-CROSSFILEMD5PINS⟧` 那一列有記)。

🔴🔴 **而【為什麼不能純掃描】—— 這一段是本片的核心, 不要刪**:
   正確的錨是「某個本檔定義的函式, 它的 body md5 出現在本檔的字面裡」。
   🛑 而那個集合的**成員資格, 由【它有沒有對上】決定**:
      有人改了函式體 ⇒ md5 不符 ⇒ **它從集合裡掉出去** ⇒ 掃描看不到它 ⇒ **印綠**。
   ⇒ 🎯 **⇒ 那正是這道閘要防的那件事, 而純掃描會對它失明。**
   ⇒ ⇒ 📌 **形狀的名字:【用「有沒有違規」去定義「誰要被檢查」】**
      —— 判準把它要抓的東西排除在分母外。
   ✅ **所以成員資格由【基準集】決定**(`scripts/migration-self-md5-baseline.txt`),
      而掃描只用來發 NOTICE(見下)。

用法:  python3 scripts/verify-cron6-md5.py
       rc=0 一致 / rc=1 不一致或集合變短 / rc=2 抽法壞了(校準沒過)
"""
import hashlib
import io
import pathlib
import re
import sys

L3A = 'supabase/migrations/20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql'
# ⚠️ **一般化之後這顆是死常數**(碼中零引用, 只剩散文提到)—— 留著是因為它是這支工具的**由來**,
#    而檔名還叫 `verify-cron6-md5.py`。⇒ 拿掉它會讓「為什麼叫這個名字」失去落點。
CRON6 = 'supabase/migrations/20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql'
FN = 'pcm_cron.expire_unpaid_orders'
# 🔬 校準塊的已知答案。⛔ ~~「L3a 檔 :39 記的」~~ ⇒ **那個出處是錯的**(code-reviewer 2026-09-03):
#    `grep -rn 456db40f` ⇒ 命中在 `20260828060000_…heartbeat.sql:39`, 而 **L3a 檔內 0 命中**。
#    ✅ 正確出處:那支 heartbeat migration 的 :39, 逐字「與 repo 的 `AS $fn$ … $fn$` 那段逐 byte 相同」。
L3A_KNOWN = '456db40fd5f959b9d1b96af7cfc8d4d2'  # 2026-08-28 與正式庫逐 byte 相同


def body(path: str) -> str | None:
    """取 `AS $fn$` 與下一個 `$fn$` 之間那段 = PG 存進 prosrc 的東西。

    🔴 **從 `CREATE OR REPLACE FUNCTION <名>` 那一行開始找**,不要對全檔跑 regex ——
       檔裡的【註解】也含 `$fn$` 字面,對全檔跑會抽到註解那一段。
    """
    s = io.open(path, encoding='utf-8').read()
    i = s.find('CREATE OR REPLACE FUNCTION ' + FN)
    if i < 0:
        return None
    m = re.search(r'AS \$fn\$', s[i:])
    if not m:
        return None
    start = i + m.end()
    j = s.find('$fn$', start)
    return s[start:j] if j > 0 else None


def selftest() -> int:
    """`--selftest`:證明這把尺【會叫】,不只是「今天剛好綠」。

    🔴 而它演的是兩個世界,不是跑一次看綠 ——
       一把恆綠的尺與一把對的尺,在正常那一發上印同一個結果。
    """
    b = body(L3A)
    if b is None:
        print('🔴 selftest 失敗:抽不到 L3a 的函式體')
        return 2
    h = hashlib.md5(b.encode()).hexdigest()
    # 世界 A:該綠的綠
    if h != L3A_KNOWN:
        print(f'🔴 selftest 失敗:L3a 實算 {h} 與已知值不符 ⇒ 抽法壞了')
        return 2
    # 世界 B:該紅的紅 —— 動一個字元,md5 必須變
    if hashlib.md5((b + ' ').encode()).hexdigest() == h:
        print('🔴 selftest 失敗:加一個空白而 md5 沒變 ⇒ 這把尺是恆綠的')
        return 2
    # 世界 C:抽法壞掉時要能認出來(不是印「值過期了」)
    fake = '-- 這不是函式體'
    if 'sweeper_heartbeat' in fake or 'clock_timestamp' in fake:
        print('🔴 selftest 失敗:健全性檢查的判準自己就命中假輸入')
        return 2
    print('✅ selftest:三個世界都演過(該綠綠 / 動一字必變 / 假輸入認得出)')
    return 0


BASELINE = 'scripts/migration-self-md5-baseline.txt'
MIGDIR = 'supabase/migrations'
# ⚠️ **只認單引號字面** —— 而 repo 慣例常把 md5 寫在**反引號註解**裡(本檔 :39 / :141 即是)
#    ⇒ 🔴 那種「宣稱」對 NOTICE **結構上隱形**。
#    ✅ 而那是刻意的:**只有引號字面才是真的 pin**(SQL 會拿它去比), 註解裡那個不會被執行。
#    🛑 但下一個人可能寫在註解裡就以為被保護了 ⇒ 這一句就是給他看的。
HEXRE = re.compile(r"'([0-9a-f]{32})'")


def all_bodies(src: str):
    """本檔裡每一支 `CREATE OR REPLACE FUNCTION` 的 (函式名, body)。

    ⛔ ~~「與 `body()` 共用同一個【不對全檔跑 regex】的紀律」~~
    🔴🔴 **那句話是假的, 而 code-reviewer 2026-09-03 量了才發現**:
       本函式對**全檔** `finditer`, 而 `seg = src[m.start():]` **沒有上界**
       ⇒ 註解裡寫 `CREATE OR REPLACE FUNCTION public.foo` 而其後接的是**別支**函式
         ⇒ `foo` 會被安上別人的 body。
       🔬 實測:註解命中 **12 處**, 其中 3 個是**中文詞被當成函式名**(正規式的 word 類在 Python 吃 CJK)。
    ✅ **而今天沒有實害**(審查逐支複驗):界定到「下一個 CREATE」的版本與現行版本,
       278 支跑出來**同一組 9 格**, 差集兩邊皆空 ⇒ **latent, 不是 live**。
    🛑 **⇒ 所以我留著這個實作而【改掉那句宣稱】** —— 因為
       **一句錯的宣稱會關掉下一個人的檢查動作**, 而那比實作本身危險。
       (要加界的話, 界應該是「下一個 `CREATE OR REPLACE FUNCTION` 或檔尾」。)
    """
    out = []
    for m in re.finditer(r'CREATE OR REPLACE FUNCTION\s+([\w.]+)', src):
        seg = src[m.start():]
        tag_m = re.search(r'AS \$(\w*)\$', seg)
        if not tag_m:
            continue
        tag = '$%s$' % tag_m.group(1)
        end = seg.find(tag, tag_m.end())
        if end < 0:
            continue
        out.append((m.group(1), seg[tag_m.end():end]))
    return out


def scan_self_asserting():
    """今天【對得上】的自我宣稱 = {(檔名, 函式名)}。

    🛑 **這個集合不可以拿來當「誰要被檢查」** —— 見檔頭那段:
       對不上的會自動從這裡掉出去, 而那正是要抓的東西。
       它只用來發 NOTICE(發現新的沒被保護的)。
    """
    found = set()
    for path in sorted(pathlib.Path(MIGDIR).glob('*.sql')):
        src = io.open(path, encoding='utf-8').read()
        lits = set(HEXRE.findall(src))
        if not lits:
            continue
        for fn, b in all_bodies(src):
            if hashlib.md5(b.encode()).hexdigest() in lits:
                found.add((path.name, fn))
    return found


def load_baseline():
    """基準集。回 (rows, bad) —— `rows is None` = 檔不見或空。

    🔴🔴 **`bad` 這一格是 code-reviewer 2026-09-03 抓到的【真 fail-open】, 不是防禦性程式碼**:
       我第一版寫 `if len(parts) == 2: rows.add(...)` —— **格式不符的行【靜靜被丟掉】**。
       ⇒ 實測:把一行的 tab 換成空格 ⇒ 那一格從基準集消失 ⇒ 集合「沒有變短」⇒ **rc 照舊 0**
       ⇒ 🎯 **⇒ 有人可以用「改一個空白」把一格保護拿掉, 而畫面上一切正常。**
       ⇒ ⇒ 📌 **而它與這支工具要防的病是同一個形狀** —— 一個字元的差別, 零訊號。
    ✅ ⇒ 所以:**解析不掉的行 = 量具壞了 = rc=2**, 不是「那一行不算」。
    """
    p = pathlib.Path(BASELINE)
    if not p.is_file():
        return None, []
    rows, bad = set(), []
    for n, ln in enumerate(io.open(p, encoding='utf-8'), 1):
        s = ln.strip()
        if not s or s.startswith('#'):
            continue
        parts = s.split('\t')
        if len(parts) == 2 and parts[0] and parts[1]:
            rows.add((parts[0], parts[1]))
        else:
            bad.append((n, s[:60]))
    return (rows or None), bad


def main() -> int:
    if '--selftest' in sys.argv:
        return selftest()

    # ══ 校準(尺的自檢, 不是檢查結果)══
    # 🔴🔴 **L3A 這一格【刻意寫死, 不改成掃描】** —— 它是這把尺的**校準塊**, 不是被檢查的對象。
    #    若它也改成掃描 ⇒ 這把尺的「已知答案」跟著它掃到的東西一起變
    #    ⇒ 🛑 它就沒有東西可以自檢了, 而它壞掉時會印一組**內部完全自洽**的數字。
    #    ⇒ 📌 **通則:被檢查的對象要掃描, 校準塊要寫死。**
    #      (下一個人看到這裡不要覺得「漏了一個沒改成掃描的」而把它一起改掉。)
    b = body(L3A)
    if b is None:
        print(f'🔴 rc=2 抽法壞了:{L3A} 裡找不到 {FN}')
        return 2
    got = hashlib.md5(b.encode()).hexdigest()
    if got != L3A_KNOWN:
        print(f'🔴 rc=2 抽法壞了 —— 校準沒過\n'
              f'   L3a 實算 {got} (長度 {len(b)})\n'
              f'   而已知值 {L3A_KNOWN}\n'
              f'   ⇒ 【先修抽法,不要動那些 migration 的字面】')
        return 2
    if hashlib.md5((b + ' ').encode()).hexdigest() == got:
        print('🔴 rc=2 校準失敗:加一個空白而 md5 沒變 ⇒ 這把尺是恆綠的')
        return 2
    print(f'══ 校準 ══  L3a ✅(長度 {len(b)} md5 {got};末尾加一空白 ⇒ md5 會變)')
    print('   🔵 以上兩行是【尺的自檢】, 不是檢查結果 —— 不要把它讀成「都檢查過了」。')

    # ══ 檢查 ══
    want, bad = load_baseline()
    # 🔴 掉行 ⇒ rc=2(量具壞了), 而**不是**「那幾行不算」—— 見 `load_baseline` 的 docstring。
    if bad:
        print(f'🔴 rc=2 基準集有 {len(bad)} 行解析不掉 —— 那是【量具壞了】, 不是「那幾行不算」:')
        for n, s in bad:
            print(f'   :{n}  {s}')
        print('   ⇒ 每一行必須是 `<migration 檔名><TAB><函式名>`。**用空格代 tab 會讓那一格靜靜消失。**')
        return 2
    if want is None:
        print(f'🔴 rc=1 基準集不見或是空的:{BASELINE}\n'
              f'   ⇒ 沒有基準 = 沒有【昨天】可以比 ⇒ 擋下, 不靜靜通過(fail-closed)。')
        return 1
    now = scan_self_asserting()
    gone = sorted(want - now)
    added = sorted(now - want)
    print(f'══ 檢查 ══  基準 {len(want)} 格 · 今天對得上 {len(now)} 格')

    # 🔵 **NOTICE(不是紅)**:發現新的自我宣稱而它不在基準集 ⇒ 沒有人在保護它。
    #    🔴 而它**刻意不紅** —— 每加一支就紅 ⇒ 那種閘會死於誤報, 而誤報會被主動關掉。
    for f, fn in added:
        print(f'   🔵 NOTICE 發現一支新的自我宣稱:{f} · {fn}')
        print(f'      ⇒ 它今天【不在基準集裡, 沒有被保護】。要保護它 ⇒ 把這一行加進 {BASELINE}:')
        print(f'         {f}\t{fn}')

    if gone:
        print('🔴 rc=1 自我宣稱【對不上了】—— 基準集裡有而今天算不出來:')
        for f, fn in gone:
            print(f'   - {f} · {fn}')
        # 🔴🔴 **先講【改名】那個假說, 再講 body** —— code-reviewer 2026-09-03 抓到:
        #    我原本直接斷言「那支函式的 body 被改過」, 而 migration **真的會被改名**
        #    (實測 `git log --diff-filter=R -- supabase/migrations/` ⇒ **5 次**, 四次在最近四天, 全是撞號修正)。
        #    ⇒ 改名時同一格會**同時**進 `gone`(紅)與 `added`(NOTICE)——
        #      fail-closed 所以不危險, 🛑 **而那句診斷逐字為假, 且它把修的人指向最貴的那條路**。
        #    ⇒ 📌 **一個會叫的閘, 它叫的內容決定下一個人往哪裡看。**
        renamed = {fn for _, fn in gone} & {fn for _, fn in added}
        if renamed:
            print('   🔵 **先看這個假說**:下面這幾支函式【同時】出現在「不見了」與「新發現」兩邊')
            print(f'      ⇒ {", ".join(sorted(renamed))}')
            print('      ⇒ 那多半是**那支 migration 被改名了**(撞號修正很常見), 不是 body 被改。')
            print(f'      ⇒ 這種情況下:把 {BASELINE} 裡的舊檔名換成新的即可。')
        print('   ⇒ 若不是改名, 那才是:那支函式的 body 被改過, 而檔裡那個 md5 字面沒跟著改。')
        print('   ⚠️ 而【重跑冪等】會壞:首次 apply 可能過, 重跑就 RAISE。')
        print(f'   ⇒ 若那是刻意拿掉的, 手改 {BASELINE} 並說明理由。')
        return 1

    print('   ✅ 基準集裡每一格今天都對得上。')
    # 🛑 這一句與紅字一樣顯眼, 而它是刻意的:讀的人不可以把沉默讀成背書。
    print('   🛑 本閘證的是【集合沒有變短, 而在集合裡的都對得上】。')
    print('      它**證不到**「該有的自我宣稱都在」—— 基準集是從現況 parse 的, 它繼承現況的缺漏。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
