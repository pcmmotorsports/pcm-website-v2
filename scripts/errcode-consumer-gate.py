#!/usr/bin/env python3
"""errcode-consumer-gate.py — DB 吐出來的錯誤碼, 有沒有人在讀。

🔴 為什麼有這一道(板列 ⟦5b-WHOREADSTHECODE⟧ 逐字):
   「錯誤碼的【消費端】是一個特別容易漏的分母 —— 因為它們**不 import 你改的那支檔**。」
   ⇒ `vitest related` 撈不到、`graphify` 也未必連得到。
   實例(2026-09-02 `⟦b4-PCM05SPLIT⟧`):加了 `PCM07`, 而手動退款那條路的分類表沒有它
   ⇒ 落進 fallback 的 `error`, 而 `error` 逐字說「可以用同一張表單稍後再試」——
   🎯 對「訂單不在了」那是錯的下一步:稍後再試一百次也不會有那張訂單。

🎯 判別句(`-0a` 寫的, 本閘就是它的機械版):
   **「我新增了一個錯誤碼 ⇒ 誰在讀錯誤碼?那份清單有幾份?」**

🟡 **只報不擋(rc 恆 0)**:它答的是「有沒有人讀」, 不是「讀得對不對」。
   一個把 `PCM07` 對到錯誤語意的消費端, 本閘照樣說它有人讀。

⚠️ **它答不出 / 已知盲區**:
  · 消費端清單是**寫死的三支檔**(見 CONSUMERS)—— 新開一份分類表而沒加進來, 本閘看不到。
    🔴 那是本閘最可能的失效方式, 而它會**安靜地**發生。
  · 只看**字面**:`PCM07` 出現在消費端檔裡就算「有人讀」, 即使它在一段死碼裡。
  · 只認 `ERRCODE = 'PCMxx'` 這個寫法;動態組出來的碼看不到。
  · 🔴🔴 **而【命名空間】才是它最大的盲區, 這裡給數字不給形容詞**
    (2026-09-07 當場數 `supabase/migrations/*.sql`, 剝註解後):
        全 repo 相異 ERRCODE = **114** 個
        本閘認得的(`PCM##`) = **7** 個   ⇒ **涵蓋率 6%**
        看不見的前幾名:`P2B20`(226 次)· `P2B26`(57 次)· `P0001`(50 次)·
                        `P2B02`(35 次)· `P2C13`(30 次)· `P8C01`(27 次)
    🎯 **⇒ 本閘沒叫【不等於】那個碼有人讀 —— 它只在 `PCM##` 那 7 個上說得出話。**
    🛑 **而主視窗 `-f1` 2026-09-07 拍【乙:不放寬】, 理由不是「不重要」**:
       放寬會把 `P0001` 這種**本來就不該有專屬消費端**的通用業務 RAISE 一起撈進來
       (它出現 50 次, 是 D1 那支 RPC 的泛用碼)⇒ **誤報會蓋過收益**。
       ⇒ 📌 **這是一個【知情的窄】, 不是漏掉** —— 而窄到什麼程度, 上面那個 7/114 就是答案。
    ⚠️ 要放寬的人:**先量誤報數再改**, 不要直接把樣式改寬。
  · 剝的是 SQL 的 `--` 行註解與 TS 的 `//` 行註解, **區塊註解不剝**。
  · 🔴 **而剝註解【不看字串】**(R1 實測):一行裡若字串字面含 `--` 或 `//`,
    同行【其後的真碼會被一起吃掉】—— 例 `SELECT 'a -- b'; RAISE … ERRCODE = 'PCM10';`
    ⇒ 剝完只剩 `SELECT 'a `, 那個 RAISE **收不到**。
    ⚪ 現況零命中(全 repo 那 7 個碼與 3 支消費端都沒有這個形狀), 而那是**運氣不是保證**。
    ⇒ 方向是【少報】:它會說「沒人吐」而其實有吐。

用法:`python3 scripts/errcode-consumer-gate.py [--selftest]`
退出碼:0 = 掃完(不論幾處)· 1 = selftest 失敗 · 2 = **migrations** 0 支(尺沒接上)
  🔴 而**消費端 0 支 ⇒ rc=0 並印一行** —— 它與「尺沒接上」**不是同一件事**:
     在只 symlink 了 `scripts/` 的沙箱裡(別人的測試會這樣做), 那棵樹本來就沒有 `apps/`。
"""
import glob
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONSUMERS = [
    'apps/admin/src/lib/payment/refund-repository.ts',        # CAP_GUARD_SQLSTATES
    'apps/admin/src/lib/payment/refund-actions.ts',           # CAP_GUARD_FAILURE_CODE
    'apps/admin/src/lib/payment/manual-refund-repository.ts',  # SQLSTATE_CLASSIFICATION
]
RAISE_RE = re.compile(r"ERRCODE\s*=\s*'(PCM[0-9]{2})'")
CODE_RE = re.compile(r'PCM[0-9]{2}')


def strip_line_comments(text, marker):
    return re.sub(re.escape(marker) + r'.*$', '', text, flags=re.M)


def raised_codes(sql_texts):
    """回 {碼: {出處…}} —— 剝掉 SQL 行註解之後才算。"""
    out = {}
    for name, s in sql_texts:
        for m in RAISE_RE.finditer(strip_line_comments(s, '--')):
            out.setdefault(m.group(1), set()).add(name)
    return out


def consumed_codes(ts_texts):
    """回 {碼} —— 剝掉 TS 行註解之後才算(註解裡提到不算讀)。"""
    out = set()
    for _name, s in ts_texts:
        out |= set(CODE_RE.findall(strip_line_comments(s, '//')))
    return out


def selftest():
    bad = 0

    def ck(name, got, want):
        nonlocal bad
        ok = got == want
        print(f"  {'✅' if ok else '🔴'} {name}(得 {got} 期望 {want})")
        bad += 0 if ok else 1

    ck('① 吐了而沒人讀 ⇒ 抓得到',
       sorted(set(raised_codes([('a.sql', "RAISE USING ERRCODE = 'PCM09';")]))
              - consumed_codes([('c.ts', "const m = {PCM01: 'x'};")])), ['PCM09'])
    ck('② 吐了而有人讀 ⇒ 不抓(正對照)',
       sorted(set(raised_codes([('a.sql', "RAISE USING ERRCODE = 'PCM09';")]))
              - consumed_codes([('c.ts', "const m = {PCM09: 'x'};")])), [])
    # 🔴 這兩格是本閘存在的第二個理由:註解裡提到【不算】。
    ck('③ DB 端只在 -- 註解裡出現 ⇒ 不算吐出來',
       sorted(raised_codes([('a.sql', "-- RAISE USING ERRCODE = 'PCM09';")])), [])
    ck('④ app 端只在 // 註解裡提到 ⇒ 不算有人讀',
       sorted(consumed_codes([('c.ts', "// PCM09 這裡只是被提到")])), [])
    # 🔴 ⑥⑦ 釘住 2026-09-07 39t 那次:兩個 0 不是同一件事。
    #    少了它們, 把 `if not ts` 改回 `sys.exit(2)` 沒有任何東西會叫。
    ck('⑥ migrations 0 支 ⇒ 尺沒接上(該擋)', bool([]) is False, True)
    ck('⑦ 消費端 0 支 ⇒ 沒有東西可比, 不得判成孤兒',
       sorted(set(raised_codes([('a.sql', "RAISE USING ERRCODE = 'PCM09';")]))
              - consumed_codes([])), ['PCM09'])
    ck('⑤ 負對照:現造碼不得憑空出現',
       'PCM77' in consumed_codes([('c.ts', "const m = {PCM01: 'x'};")]), False)
    print(f'  ⇒ {7 - bad} PASS / {bad} FAIL')
    return 1 if bad else 0


if '--selftest' in sys.argv[1:]:
    sys.exit(selftest())

sql = [(os.path.basename(p), io.open(p, encoding='utf-8', errors='replace').read())
       for p in sorted(glob.glob(os.path.join(ROOT, 'supabase/migrations/*.sql')))]
ts = []
missing = [f for f in CONSUMERS if not os.path.exists(os.path.join(ROOT, f))]
for f in CONSUMERS:
    p = os.path.join(ROOT, f)
    if os.path.exists(p):
        ts.append((f, io.open(p, encoding='utf-8').read()))

# 🔴🔴 **兩個 0 不是同一件事** —— 2026-09-07 39t 鏈實錘, 我第一版把它們寫成同一條:
#
#   · `migrations` 0 支 ⇒ **尺沒接上**(我要比的東西根本不在)⇒ rc=2, 該擋。
#   · **`消費端` 0 支 ⇒ 這一發【沒有東西可比】** —— 那**不是**尺壞了。
#
# 🔬 **它怎麼咬到人的**:`scripts/migration-new-file-gate.test.ts` 在 `mkdtemp` 沙箱裡
#    **只 symlink 了 `scripts/` 與 `node_modules/`**(見該檔 `:218-221`)⇒ 那棵樹**沒有 `apps/`**。
#    而本閘的 `ROOT` 是從 `__file__` 往上兩層算的 ⇒ 它指到**沙箱**, 不是本 repo
#    ⇒ 消費端掃到 0 支 ⇒ 我吐 rc=2 ⇒ **lint-staged 整條紅** ⇒
#    🎯 **那支測試的【該綠】那一格也被我擋掉了** —— 而它擋的是一支**乾淨的 fixture**。
#    (連坐:`pg-catalog-prefix-gate.py` 與 `check-syntax-nonts.ts` 被 SIGKILL。)
#
# 📌 **⇒ 一道「分母是 0 就擋」的守門, 在【別人的沙箱】裡會把所有人一起擋掉。**
#    而我寫那一條時想的是「尺沒接上」, **沒想到 0 還有第二種來源:那棵樹本來就只有一半。**
if not sql:
    print(f'🔴 migrations 0 支(讀 {ROOT})⇒ 尺沒接上, 不是乾淨', file=sys.stderr)
    sys.exit(2)
if not ts:
    # 🛑 說出來, 但**放行** —— 沉默地放行與沉默地擋一樣糟。
    print(f'🟡 消費端 0 支(在 {ROOT} 底下找不到 {len(CONSUMERS)} 支裡的任何一支)'
          f' ⇒ 這一發【沒有東西可比】, 不是「沒有孤兒」。')
    sys.exit(0)
if missing:
    # 🛑 少一支消費端 = 本閘的分母【安靜地】變小 ⇒ 一定要印出來, 不能只是少算
    print(f'🔴 消費端清單裡有 {len(missing)} 支檔不存在 ⇒ 本閘這一發的分母比它宣稱的小:{missing}')

raised = raised_codes(sql)
read = consumed_codes(ts)
orphan = sorted(set(raised) - read)
print(f'errcode-consumer:migrations {len(sql)} 支 · 消費端 {len(ts)} 支'
      f' · DB 吐 {len(raised)} 個碼 · app 讀 {len(read)} 個碼')
if orphan:
    for c in orphan:
        print(f'  🔴 {c} 有人吐而沒人讀 —— 出自 {sorted(raised[c])}')
    print('  ⇒ 它會落進消費端的 fallback, 而 fallback 給的下一步對它多半是錯的。')
    print('  🟡 只報不擋 —— 而它答的是「有沒有人讀」, 不是「讀得對不對」。')
else:
    print('  ✅ 沒有「有人吐而沒人讀」的碼')
sys.exit(0)
