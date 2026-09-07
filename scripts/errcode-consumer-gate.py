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
  · 剝的是 SQL 的 `--` 行註解與 TS 的 `//` 行註解, **區塊註解不剝**。
  · 🔴 **而剝註解【不看字串】**(R1 實測):一行裡若字串字面含 `--` 或 `//`,
    同行【其後的真碼會被一起吃掉】—— 例 `SELECT 'a -- b'; RAISE … ERRCODE = 'PCM10';`
    ⇒ 剝完只剩 `SELECT 'a `, 那個 RAISE **收不到**。
    ⚪ 現況零命中(全 repo 那 7 個碼與 3 支消費端都沒有這個形狀), 而那是**運氣不是保證**。
    ⇒ 方向是【少報】:它會說「沒人吐」而其實有吐。

用法:`python3 scripts/errcode-consumer-gate.py [--selftest]`
退出碼:0 = 掃完(不論幾處)· 1 = selftest 失敗 · 2 = 分母是 0(尺沒接上)
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
    ck('⑤ 負對照:現造碼不得憑空出現',
       'PCM77' in consumed_codes([('c.ts', "const m = {PCM01: 'x'};")]), False)
    print(f'  ⇒ {5 - bad} PASS / {bad} FAIL')
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

# 🔴 分母是 0 【不是乾淨】—— 那與「尺沒接上」印同一個東西
if not sql or not ts:
    print(f'🔴 分母是 0(migrations {len(sql)} 支 · 消費端 {len(ts)} 支)⇒ 尺沒接上',
          file=sys.stderr)
    sys.exit(2)
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
