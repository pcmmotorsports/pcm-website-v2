#!/usr/bin/env python3
"""第五層量具:**「管理者」這個字的定義,在 TS 與 SQL 兩側是不是同一個。**

🔴 為什麼需要它(2026-08-28 線C):
   線B ⟦b4-MGR0⟧ 在 TS 定義了管理者 = `is_active === true && is_manager === true`;
   本片四支 RPC 在 SQL 用 `s.is_active AND s.is_manager`。
   ⇒ **相同的是那個【定義】, 不是那道【閘】**(線B 三支 action 一律要管理者;
      本片只有共用檢視要 —— 私人檢視不歸管理者管)。
   🔴 而**兩邊現在沒有任何機械的東西把那個定義綁著**:
      線B 哪天在定義裡多加一個條件(例如 `is_verified`), 我這四支不會紅、不會有人知道。
      📌 **一個跨語言的共用定義, 若沒有一把尺同時讀兩側, 它只是一個巧合。**

⚠️ 而這把尺**只能是絆線, 不是證明**:它比對的是【字面】。
   有人把 TS 那句改寫成語意相同而字面不同的形狀 ⇒ 它會誤報(假紅);
   有人在別處覆寫掉那個判斷 ⇒ 它抓不到(假綠)。
   ⇒ **假紅便宜(有人來看), 假綠貴** —— 而這把尺的假綠是它的天花板, 寫在這裡不藏。

⚠️ 另一個天花板:⟦b4-MGR0-SEM⟧ 那條繩子綁的是「**拆欄那天**要一起改」,
   本檔綁的是「**今天**兩邊一不一致」。**兩件事, 而先前只有前者有繩子。**

用法  python3 docs/specs/2026-08-25-saved-views-manager-def-check.py [repo根]
回傳  0 = 兩側同一個定義 · 1 = 不同或找不到
"""
import io, os, re, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
TS  = os.path.join(ROOT, 'apps/admin/src/lib/staff.ts')
SQL = os.path.join(ROOT, 'docs/specs/2026-08-25-saved-views-migration-draft.sql')
fail = 0

def read(p):
    try:
        return io.open(p, encoding='utf-8').read()
    except OSError:
        return None

ts, sql = read(TS), read(SQL)
if ts is None:
    print('🔴 讀不到 %s ⇒ 這把尺【沒有跑】, 不是「兩側一致」' % TS); sys.exit(1)
if sql is None:
    print('🔴 讀不到 %s ⇒ 這把尺【沒有跑】' % SQL); sys.exit(1)

# ── TS 側:抽出那一句判斷裡用到的欄位 ────────────────────────────────────────
m = re.search(r'return\s+row\?\?\.is_active[^;]*;|return\s+row\?\.is_active[^;]*;', ts)
if not m:
    print('🔴 TS 側找不到管理者定義那一句(`return row?.is_active …`)')
    print('   ⇒ 它可能被改寫、搬走或刪掉了 ⇒ 本尺【不能】判成一致'); fail = 1
    ts_fields = None
else:
    expr = m.group(0)
    ts_fields = set(re.findall(r'\bis_[a-z_]+\b', expr))
    # 只認「都必須為 true」的形狀;出現 `||` 就不是「兩個都要」
    if '||' in expr:
        print('🔴 TS 側那句含 `||` ⇒ 不再是「兩個條件都要」⇒ 與 SQL 的 AND 不等價')
        print('   實得:%s' % expr.strip()); fail = 1
    print('     TS  %s ⇒ %s' % (expr.strip(), sorted(ts_fields)))

# ── SQL 側:四支 RPC 用到的 staff 欄位 ───────────────────────────────────────
# 🔴 先濾掉註解 —— 這一步是 2026-08-28 突變 MD2 逼出來的:
#    第一版直接對整份原文抽 `s.is_xxx`, 而 `:12` 有一行【註解】提到 `AND s.is_manager`
#    ⇒ 真的碼裡整個拿掉那個欄位, 而註解留著 ⇒ **這把尺照樣說「兩側相同」。**
#    📌 又一次:**尺把「寫著這件事的那段文字」當成「這件事本身」。** 今晚第三次。
def strip_comments(t):
    return '\n'.join(l for l in t.splitlines() if not l.lstrip().startswith('--'))

sql_fields = set()
for fn in ['admin_list_saved_order_views', 'admin_create_saved_order_view',
           'admin_update_saved_order_view', 'admin_delete_saved_order_view']:
    i = sql.index('CREATE OR REPLACE FUNCTION public.%s(' % fn)
    body = strip_comments(sql[i:sql.index('\n$$;', i)])
    # 🔴 只認【真的欄位讀取】`s.is_xxx`。
    #    第一版還把區域變數名 `v_is_manager` 也算進來 —— 而 2026-08-28 突變 MD2
    #    (三支的 `SELECT s.is_manager INTO v_is_manager` 全換成 `SELECT false INTO v_is_manager`)
    #    ⇒ 欄位讀取整個消失, 而**變數名還在** ⇒ 這把尺照樣說「兩側相同」。
    #    📌 **一個變數叫 `v_is_manager`, 不代表有人去讀過那一欄。**
    #       名字是作者的意圖, 而尺要量的是行為。
    for mm in re.finditer(r'\bs\.(is_[a-z_]+)\b', body):
        sql_fields.add(mm.group(1))
print('     SQL 四支 RPC 用到的 staff 欄位 ⇒ %s' % sorted(sql_fields))

if ts_fields is not None:
    if ts_fields != sql_fields:
        print('🔴 兩側「管理者」的定義用到的欄位不同')
        print('   TS 有而 SQL 沒有 : %s' % sorted(ts_fields - sql_fields))
        print('   SQL 有而 TS 沒有 : %s' % sorted(sql_fields - ts_fields))
        print('   ⇒ 線B 改了定義而本片沒跟上, 或反過來'); fail = 1
    else:
        print('ok   兩側同一組欄位:%s' % sorted(ts_fields))

# ── 負對照:餵一組一定不同的欄位, 上面那道必須判得出不同 ──────────────────────
if ts_fields is not None and (ts_fields | {'is_never_a_real_column'}) == sql_fields:
    print('🔴 負對照失效:塞一個不存在的欄位進去, 它竟然還說相同'); fail = 1
else:
    print('ok   負對照:塞一個不存在的欄位 ⇒ 判得出不同(這道有判別力)')

print('=== 管理者定義:兩側相同 ===' if not fail else '=== 管理者定義:不一致或量不到 ===')
sys.exit(fail)
