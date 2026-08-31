#!/usr/bin/env python3
"""undefined-assert-gate — 擋住第 55 處「守著空氣」的斷言。

它擋的是一個【安靜通過】的形狀:

    expect(fn).toHaveBeenCalledWith({ a: 1, b: undefined });

🔴 `{b: undefined}` 與 `{}` 在 vitest 的比對下【兩個方向都相等】
   ⇒ 那個 `b` 只保證「它不是別的值」,**不保證那個鍵存在** ——
   實作哪天整個不傳 `b`, 這一格照樣綠。

實測(2026-09-01, vitest 4.1.5, 三格自己會紅的探針):
    期望 {a:1,b:undefined} vs 實際 {a:1}             ⇒ 不紅
    期望 {a:1}             vs 實際 {a:1,b:undefined} ⇒ 不紅
    🟢 正對照 期望 {a:1,b:2} vs 實際 {a:1}           ⇒ 紅（尺是活的）

而 repo 現況:741 支測試檔裡 54 處, 逐處量過【零判別力 54/54, 零例外】。
量法 = 把那個鍵改名 `xxxZZQ` ⇒ 跑該檔 ⇒ 仍綠 = 它什麼都沒守。
📎 全文 `~/pcm-mailbox/盤點-key-undefined-的斷言零判別力-20260901.md`、板 `⟦b4-UNDEFASSERT1⟧`。

══ 🛑 天花板(本閘擋不到什麼)══════════════════════════════════════════════
 ① **值是一個變數而該變數是 undefined** —— `key: someVar` 靜態看不出來。
 ② **跨超過 `WINDOW` 行的斷言物件** —— 視窗外的鍵掃不到。
 ③ **`expect.objectContaining` 本身對「多的鍵」就寬鬆** —— 那是另一族, 本閘不判。
    ⇒ 而它與本閘管的不同:那一族是【期望物件可以少寫鍵】, 本閘管的是【寫了而等於沒寫】。
 ⑤ 🔴 **跨行的 `objectContaining(` / `toStrictEqual(`** —— 本閘是逐行跳過它們的,
    所以 `objectContaining({` 換行之後才寫 `bad: undefined` 的那種**仍會被報(假紅)**。
    ⇒ 而那兩個 matcher 自己會紅(2026-09-01 實測)⇒ 報它們沒有意義。
 ⑥ 🔴 **它是 pre-commit ⇒ `--no-verify` 一句就繞過**;而 merge / cherry-pick 產生的 commit
    走的是別的 hook(本 repo 沒有 `pre-merge-commit` 接線)⇒ 那幾條路它看不到。
    ⇒ 而它**沒有 CI 端的同款閘** ⇒ 📌 **本閘擋的是【手滑】,不是【繞過】。**
 ⑦ 🔴 **同一顆 commit 刪掉本閘再做本閘要防的事** —— 殼那一半有 fail-closed(rc=2),
    而**那要等到下一次 checkout 才咬得到**:staged 刪除之後把工作樹版本放回來,
    這一次的 commit 仍會用舊 gate 放行那個刪除。⇒ 那一格靠 code review。
 ④ 🔴 **它只擋【新進來的】** —— 既有 54 處在豁免清單裡, 而本閘對它們沉默。
    ⇒ **本閘綠, 不代表 repo 裡沒有這種斷言。**

══ 🔴 豁免清單的形狀, 而它為什麼不是「檔案:行號」════════════════════════
 鍵 = `檔案\t鍵名`。**不用行號** —— 行號會漂, 而漂掉之後豁免會
   【自己失效】(那一處重新變紅, 而人只會把行號改掉)
   或【自己擴大】(漂到另一處上, 那一處就靜靜地被豁免了)
 ⇒ 📌 **兩種都不會有人發現。**

 而清單是【只減不增】的:本閘在**清單多出本次沒命中的項目時也會紅**
 (`--check-exemptions`), 而它的訊息會說「你加了一筆豁免」。
 ⇒ 清單縮短 = `⟦b4-UNDEFASSERT1⟧` 那一列在前進。
"""
import io
import os
import re
import subprocess
import sys

WINDOW = 40
# 🔴 `toEqual` 也納入 —— **實測它是同一個病**（2026-09-01,vitest 4.1.5）:
#      期望 {a:1,b:undefined} vs 實際 {a:1} ⇒ 不紅
#      🟢 正對照 期望 {a:1,b:2} vs 實際 {a:1} ⇒ 紅（尺是活的）
#    ⇒ 📌 而第一版只收三個 `toHaveBeen*` ⇒ **少涵蓋 22 處**（54 處裡 toEqual 佔 22）。
#       那個少報的方向是【好消息】:清單只有 6 筆,看起來像「這個 repo 很乾淨」。
# 🔴🔴 **這份名單是【實測】出來的,不是猜的 —— 而我猜錯過一次**(codex R1 must-fix):
#    2026-09-01 逐個 matcher 餵 `{a:1}` vs 期望 `{a:1,b:undefined}`:
#      toEqual                              ⇒ **不紅** ⇒ 同病, 收
#      toHaveBeenCalledWith / Nth / Last     ⇒ **不紅** ⇒ 同病, 收
#      🔴 toStrictEqual                      ⇒ **會紅** ⇒ **不是同病, 移出**
#         （我第一版把它收進來, 那是【猜的】—— 它的名字讀起來像同一族）
#      🔴 expect.objectContaining({bad:undefined}) ⇒ **會紅** ⇒ 排除是對的, 而理由不是「另一族」
#    ⇒ 📌 **一個名字讀起來像同族的 matcher, 行為可以是相反的。**
#    🔵 別名也收(codex must-fix):`toBeCalledWith` / `toHaveBeenCalledExactlyOnceWith`
#       —— 它們在 vitest 4.1.5 上都存在(實測 typeof === 'function')。
MATCHERS = ('toHaveBeenCalledWith', 'toHaveBeenNthCalledWith', 'toHaveBeenLastCalledWith',
            'toHaveBeenCalledExactlyOnceWith', 'toBeCalledWith', 'toBeCalledTimes',
            'toEqual')
# 🔴 一行裡可能有多個 `k: undefined`（單行物件字面）⇒ finditer 不是 match。
#    第一版只認「undefined 在行尾」⇒ 對擠在一行的那種印 0 ⇒ 全 repo 少報 14 處（40 vs 54）。
KEYRE = re.compile(r'([A-Za-z_$][\w$]*)\s*:\s*undefined(?=\s*[,}\)])')
EXEMPT_PATH = 'scripts/undefined-assert-gate.exemptions.tsv'


def scan(files):
    out = []
    for f in files:
        try:
            src = io.open(f, encoding='utf-8').read().split('\n')
        except (OSError, UnicodeDecodeError):
            continue
        for i, line in enumerate(src):
            if not any(m in line for m in MATCHERS):
                continue
            depth = 0
            started = False
            for j in range(i, min(i + WINDOW, len(src))):
                depth += src[j].count('(') - src[j].count(')')
                if '(' in src[j]:
                    started = True
                # 🔴 **`objectContaining` / `toStrictEqual` 包在裡面的那一段要跳過**
                #    (codex must-fix + 我的自檢抓到):它們**自己會紅**(2026-09-01 實測),
                #    ⇒ 報它們是【假紅】。而假紅會被修掉,而最省事的修法是拿掉本閘。
                #    ⚠️ 而這是【逐行】判斷 ⇒ 一個跨行的 `objectContaining({\n bad: undefined` 仍會被報。
                #       那是本閘的天花板⑤,寫在檔頭。
                if 'objectContaining' in src[j] or 'toStrictEqual' in src[j]:
                    if started and depth <= 0:
                        break
                    continue
                for m in KEYRE.finditer(src[j]):
                    out.append((f, j + 1, m.group(1)))
                if started and depth <= 0:
                    break
    return out


def load_exemptions():
    if not os.path.exists(EXEMPT_PATH):
        return set()
    rows = set()
    for line in io.open(EXEMPT_PATH, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line or line.startswith('#'):
            continue
        parts = line.split('\t')
        if len(parts) >= 2:
            rows.add((parts[0], parts[1]))
    return rows


# 🔴 `.spec` 也要收 —— codex must-fix:`vitest.config.ts:101` 的 include 是
#    `**/*.{test,spec}.{ts,tsx}` ⇒ 只收 `.test` 的話,**一支新的 `.spec` 可以直接繞過本閘**。
#    (repo 現有 4 支 `.spec`;而 `apps/storefront/e2e/` 那些是 Playwright、不是 vitest,
#     它們不受本病影響 —— 而收進來也只是多掃幾支,不會誤報。)
def _is_test(f):
    return f.endswith(('.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'))


def staged_test_files():
    r = subprocess.run(
        ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        capture_output=True, text=True)
    return [f for f in r.stdout.split('\n') if _is_test(f)]


def all_test_files():
    r = subprocess.run(
        ['git', 'ls-files', '*.test.ts', '*.test.tsx', '*.spec.ts', '*.spec.tsx'],
        capture_output=True, text=True)
    return [f for f in r.stdout.split('\n') if f]


def main(argv):
    if '--selftest' in argv:
        return selftest()

    exempt = load_exemptions()
    files = all_test_files() if '--all' in argv else staged_test_files()
    hits = scan(files)
    new = [h for h in hits if (h[0], h[2]) not in exempt]

    # 🔴 只減不增:清單裡有【全 repo 都掃不到】的項目 ⇒ 有人加了一筆而它守不到東西。
    live = {(f, k) for f, _, k in scan(all_test_files())}
    stale = sorted(exempt - live)

    if not new and not stale:
        print(f'✅ undefined-assert-gate:掃了 {len(files)} 支 staged 測試檔,'
              f'沒有新的 `key: undefined` 斷言(豁免清單 {len(exempt)} 筆)')
        return 0

    if new:
        print('🔴 這幾個鍵【沒有在守任何東西】—— '
              '`{a: undefined}` 與 `{}` 在 vitest 下相等,'
              '所以實作整個不傳那個鍵時,這一格照樣綠。', file=sys.stderr)
        for f, ln, k in new:
            print(f'   {f}:{ln}  `{k}: undefined`', file=sys.stderr)
        print('', file=sys.stderr)
        print('   要斷言「那個鍵不存在」⇒ 取實際參數再問它:', file=sys.stderr)
        print("     const arg = fn.mock.calls.at(-1)![0];", file=sys.stderr)
        print("     expect('someKey' in arg).toBe(false);", file=sys.stderr)
        print('   要斷言「整個物件就是這幾個鍵」⇒ 比鍵集合:', file=sys.stderr)
        print("     expect(Object.keys(arg).sort()).toEqual([...]);", file=sys.stderr)
        print('     🔵 `Object.keys` 對 `{a: undefined}` 仍回 `[\'a\']` '
              '⇒ **它分得出「有這個鍵」與「沒有」**,而 toHaveBeenCalledWith 分不出。',
              file=sys.stderr)
        print('', file=sys.stderr)
        print('   🛑 **而有三條路是【更糟的】,不要走**(codex 2026-09-01 點名:'
              '一道只封鎖而不給出路的閘,會把人推向它掃不到的寫法):', file=sys.stderr)
        print("     ① 把那個鍵【刪掉】⇒ 那不是修好, 是連那個『它不是別的值』也不保證了",
              file=sys.stderr)
        print("     ② 改成 `key: void 0` / `key: someUndefinedVar` ⇒ 一樣沒判別力, 而本閘掃不到",
              file=sys.stderr)
        print("     ③ 包一層 `expect.objectContaining` ⇒ 那一族對『多的鍵』更寬鬆",
              file=sys.stderr)
        print('   ✅ 而 `toStrictEqual` 是**安全的**(實測:它對 `{a:undefined}` vs `{}` 會紅)'
              ' ⇒ 本閘刻意不擋它。', file=sys.stderr)
        print(f'   📎 背景:板 ⟦b4-UNDEFASSERT1⟧', file=sys.stderr)

    if stale:
        print('', file=sys.stderr)
        print(f'🔴 豁免清單有 {len(stale)} 筆【現在掃不到】—— 清單是只減不增的。',
              file=sys.stderr)
        print('   ⚠️ 而它有【三種】成因,而本閘分不出來(codex 2026-09-01 點名):', file=sys.stderr)
        print('     ① 你修好了那一處 ⇒ **刪掉那一行**(清單縮短, 是好事)', file=sys.stderr)
        print('     ② 你【改了檔名 / 刪了整支測試檔】⇒ 也是刪掉那一行, 而**要在 commit body 說**',
              file=sys.stderr)
        print('     ③ 你【加了一筆】⇒ 不要加。豁免只出不進, 否則它會變成垃圾桶。',
              file=sys.stderr)
        print('   📌 ①② 都是刪, ③ 是加 —— 而本閘只看得到「清單與現況對不上」。'
              '**判它是哪一種靠人, 而 commit body 是那個人留下說法的地方。**', file=sys.stderr)
        for f, k in stale:
            print(f'   {f}\t{k}', file=sys.stderr)
        print('   ⇒ 若你剛修好那一處 ⇒ **把它從清單刪掉**(那是清單縮短,是好事)。',
              file=sys.stderr)
        print('   ⇒ 若你剛加了一筆 ⇒ **不要加**。豁免只出不進,否則它會變成垃圾桶。',
              file=sys.stderr)
    return 1


def selftest():
    import tempfile
    ok = True

    def case(name, body, expect_keys):
        nonlocal ok
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'x.test.ts')
            io.open(p, 'w', encoding='utf-8').write(body)
            got = sorted(k for _, _, k in scan([p]))
            good = got == sorted(expect_keys)
            ok = ok and good
            print(f'  {"✅" if good else "🔴"} {name:<46} 命中 {got} (要 {sorted(expect_keys)})')

    print('undefined-assert-gate --selftest')
    # 🟢 好世界:有值 ⇒ 不得報
    case('🟢 有值的鍵 ⇒ 不報',
         "expect(fn).toHaveBeenCalledWith({ realKey: 'v' });\n", [])
    # 🔵 壞世界一:多行
    case('🔵 多行物件字面 ⇒ 報',
         "expect(fn).toHaveBeenCalledWith({\n  a: 1,\n  bad: undefined,\n});\n", ['bad'])
    # 🔴 壞世界二:**擠在一行** —— 第一版掃描器對它印 0（少報 14 處的成因）
    case('🔴 擠在一行 ⇒ 報（第一版對它印 0）',
         "expect(fn).toHaveBeenCalledWith({ a: 1, bad: undefined });\n", ['bad'])
    case('🔴 一行兩個 ⇒ 兩個都報',
         "expect(fn).toHaveBeenCalledWith({ p: undefined, q: undefined });\n", ['p', 'q'])
    # 🔵 射程:不是本閘管的 matcher ⇒ 不報（明寫，不是漏）
    case('🔴 toEqual 也是同一個病 ⇒ 報',
         "expect(x).toEqual({ bad: undefined });\n", ['bad'])
    case('🔴 Nth ⇒ 報',
         "expect(fn).toHaveBeenNthCalledWith(1, { bad: undefined });\n", ['bad'])
    case('🔴 Last ⇒ 報',
         "expect(fn).toHaveBeenLastCalledWith({ bad: undefined });\n", ['bad'])
    case('🔴 別名 toBeCalledWith ⇒ 報',
         "expect(fn).toBeCalledWith({ bad: undefined });\n", ['bad'])
    # 🔴 這一格 codex 抓到我原本寫成【恆真】:舊 fixture 根本沒有 `undefined`,
    #    掃不掃它都會得到 [] ⇒ 它證明不了「我排除了 toStrictEqual」。
    #    ⇒ 換成**真的帶 undefined** 的樣本, 它才有判別力。
    case('🔵 toStrictEqual 帶 undefined ⇒ 不報（它會自己紅，實測）',
         "expect(x).toStrictEqual({ bad: undefined });\n", [])
    case('🔵 objectContaining 帶 undefined ⇒ 不報（它會自己紅，實測）',
         "expect(fn).toHaveBeenCalledWith(expect.objectContaining({ bad: undefined }));\n", [])
    # 🔵 視窗外 ⇒ 不報（天花板②的實物）
    case('🔵 視窗外的鍵 ⇒ 不報（天花板②）',
         "expect(fn).toHaveBeenCalledWith({\n" + "  // pad\n" * (WINDOW + 3) +
         "  bad: undefined,\n});\n", [])
    print('  ⇒', '全過' if ok else '🔴 有格子沒過')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
