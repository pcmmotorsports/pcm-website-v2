#!/usr/bin/env python3
"""片1 回傳碼合約 ↔ 實作 的【雙向】對照 —— 🛑 草稿的測試,不是 migration 的一部分。

🔴 為什麼這一層需要自己的尺(2026-08-28 線C):
   碼錨證得了「閘在寫入之前」· 34 格測試證得了「該擋的擋住了」· 並發 harness 證得了「判斷在鎖裡面」
   —— **而三層都沒有問過:這支函式回得出來的碼,跟我們對外宣告的那一張表,是不是同一套。**

🔴 而寫這支尺的第一發就撞到它自己那一族的病:
   `grep -n "RETURN '"` ⇒ 只撈到 9 行, **而它漏掉 `UPDATED` 與 `UPDATED_OVERWROTE`**
   —— 因為那兩個走的是 `v_code := 'UPDATED_OVERWROTE'` 然後 `RETURN v_code`。
   📌 **一把「找所有回傳碼」的尺, 只認得其中一種回傳的寫法。**
   ⇒ 所以本檔改成撈【函式體裡所有全大寫底線字面】, 不是撈 `RETURN` 那個字。

兩個方向都要, 因為它們抓的是不同的病:
   A 合約 → 實作   宣告了而【產不出來】 ⇒ 呼叫端寫了處理分支, 而那個分支永遠不會執行
                   (那與「處理得很好」在畫面上是同一件事 —— 沒有人會回報)
   B 實作 → 合約   回得出來而【沒宣告】 ⇒ 呼叫端收到一個它沒看過的字串
                   ⇒ 最好的情況是它當成錯誤; 最壞的情況是它當成成功

用法  python3 docs/specs/2026-08-25-saved-views-contract-check.py
回傳  0 = 兩個方向都對 · 1 = 有不合(訊息會說是哪一個方向)
"""
import io, os, re, sys

# 可指定另一個目錄(給突變用)。🔴 沒有這個參數 ⇒ 這把尺【沒辦法被突變殺】,
#    而一把殺不了的尺與一把在守著的尺, 都印 ok。
HERE = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SQL  = os.path.join(HERE, '..', '..', 'supabase/migrations/20260828080000_m4b_b4views1_saved_order_views.sql')
TEST = os.path.join(HERE, '2026-08-25-saved-views-tests.sql')

# 合約 = §14-19 那張表。🔴 手抄進來, 而【手抄本身是一個弱點】——
#   它與 plan 分家之後, plan 改了這裡不會紅。
#   ⇒ 所以下面第三道檢查回頭去 plan 裡數一次, 對不上就紅。
CONTRACT = {
    'admin_create_saved_order_view': {'CREATED', 'DUPLICATE_REQUEST', 'NAME_TAKEN'},
    'admin_update_saved_order_view': {'UPDATED', 'UPDATED_OVERWROTE', 'NO_CHANGE', 'NOT_FOUND', 'NAME_TAKEN'},
    'admin_delete_saved_order_view': {'DELETED', 'NOT_FOUND'},
}
# 這些全大寫字面出現在函式體裡, 而它們【不是回傳碼】⇒ 白名單, 而白名單要有理由
NOT_A_CODE = {
    'UPDATE': 'SQL 關鍵字(FOR UPDATE / UPDATE public....)',
    'DELETE': 'SQL 關鍵字',
    'NULL':   'SQL 關鍵字',
}

def body_of(src, fname):
    i = src.index('CREATE OR REPLACE FUNCTION public.%s(' % fname)
    j = src.index('\n$$;', i)
    return src[i:j]

def codes_in(body):
    """撈全大寫底線字面, 不是撈 RETURN —— 見檔頭那一段。"""
    found = set()
    for m in re.finditer(r"'([A-Z][A-Z_]{2,})'", body):
        tok = m.group(1)
        if tok not in NOT_A_CODE:
            found.add(tok)
    return found

src  = io.open(SQL,  encoding='utf-8').read()
test = io.open(TEST, encoding='utf-8').read()
fail = 0

for fn, declared in sorted(CONTRACT.items()):
    body = body_of(src, fn)
    actual = codes_in(body)
    short = fn.replace('admin_', '').replace('_saved_order_view', '')

    # 方向 B:回得出來而沒宣告
    extra = actual - declared
    if extra:
        print('🔴 B 實作→合約  %-8s 回得出 %s, 而合約沒宣告' % (short, sorted(extra)))
        print('               ⇒ 呼叫端會收到一個它沒看過的字串'); fail = 1

    # 方向 A:宣告了而產不出來
    missing = declared - actual
    if missing:
        print('🔴 A 合約→實作  %-8s 合約宣告 %s, 而函式體裡找不到' % (short, sorted(missing)))
        print('               ⇒ 呼叫端的那個分支永遠不會執行, 而那與「處理得很好」長一樣'); fail = 1

    # 方向 C:宣告了、產得出來, 而【沒有一格測試餵到它】
    untested = {c for c in declared if ("'%s'" % c) not in test}
    if untested:
        print('🔴 C 合約→測試  %-8s %s 沒有任何一格測試期望它' % (short, sorted(untested)))
        print('               ⇒ 它「產得出來」是讀出來的, 不是量到的'); fail = 1

    if not (extra or missing or untested):
        print('ok   %-8s %d 個碼:合約 = 實作 = 有測試餵到' % (short, len(declared)))

# ── D 手抄的合約 vs plan §14-19 那張表 ──────────────────────────────────────
# 🔴 少了這一道, 上面三道全綠只證明「我抄的那份自洽」。
# ⚠️ 而這一道【第一版是假的】(2026-08-28 突變 CC4 抓到):
#    第一版問的是「這個碼在 plan 裡有沒有出現」—— 而 plan 有 4500 行,
#    同一個碼在 §14-19 / §14-21 / §14-22 各出現一次
#    ⇒ 把合約表那一列改壞, 它照樣在別處找得到 ⇒ **恆綠**。
#    📌 **一把尺的分母若是「整份檔」, 它幾乎恆真, 而恆真的檢查印的是 ok。**
#    ✅ 改成【只讀 §14-19 那張表的那一列】, 分母收到一列。
plan = io.open(os.path.join(HERE, '2026-08-25-saved-views-plan.md'), encoding='utf-8').read()
rows = {}
for line in plan.splitlines():
    m = re.match(r'\|\s*`(list|create|update|delete)`\s*\|(.*?)\|', line)
    if m and m.group(1) != 'list':
        rows['admin_%s_saved_order_view%s' % (m.group(1), 's' if m.group(1) == 'list' else '')] = \
            set(re.findall(r'`([A-Z][A-Z_]{2,})`', m.group(2)))
if len(rows) != 3:
    print('🔴 D 讀不到 §14-19 合約表(找到 %d 列, 期望 3)⇒ 表的格式變了或表不見了' % len(rows))
    fail = 1
else:
    for fn, declared in CONTRACT.items():
        got = rows.get(fn, set())
        if got != declared:
            print('🔴 D 本檔→plan  %-8s 本檔抄的 %s, 而 plan 表那一列是 %s'
                  % (fn.replace('admin_', '').replace('_saved_order_view', ''),
                     sorted(declared), sorted(got)))
            print('               ⇒ 合約手抄本已漂移'); fail = 1
    if not fail:
        print('ok   D 三列都與 plan §14-19 表逐字相同')

# 負對照:餵一個一定不在表裡的碼, D 必須判它漂移
probe = {k: set(v) for k, v in CONTRACT.items()}
probe['admin_delete_saved_order_view'].add('__ZZ_NEVER_A_CODE__')
if len(rows) == 3 and probe['admin_delete_saved_order_view'] == rows['admin_delete_saved_order_view']:
    print('🔴 負對照失效:塞一個不存在的碼進去, D 竟然還說相同'); fail = 1
else:
    print('ok   負對照:塞一個不存在的碼 ⇒ D 判得出不同(它有判別力)')

print('=== 合約對照:兩個方向都對 ===' if not fail else '=== 合約對照:有不合 ===')
sys.exit(fail)
