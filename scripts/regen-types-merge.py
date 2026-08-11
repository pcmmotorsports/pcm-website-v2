"""重 gen 合併器 — 把 `database.types.ts` 的手動校正貼回新生成的檔案。

照該檔檔頭指定的做法:**逐函式整塊替換 + 參數名集合比對**。
參數集合不相等 = 真的有簽章變更(不只是校正被沖掉)⇒ 印 STOP、**該支不動**,由人判斷。

用法(產生新檔 → 驗證 → 才覆蓋,別直接寫回原檔):
    supabase gen types typescript --project-id <id> > /tmp/dbtypes-new.ts
    python3 scripts/regen-types-merge.py \\
        packages/adapters/src/supabase/database.types.ts /tmp/dbtypes-new.ts /tmp/dbtypes-merged.ts
    diff packages/adapters/src/supabase/database.types.ts /tmp/dbtypes-merged.ts   # 應只有新增、零刪除
    mv /tmp/dbtypes-merged.ts packages/adapters/src/supabase/database.types.ts

跑完**一定要自己再驗三件事**(腳本不會替你驗):
  ① `diff | grep -c '^<'` = 0 —— 零刪除 = 沒有校正被沖掉(校正全是既有行)。
  ② 每支目標函式在輸出檔裡**恰出現一次**(`grep -c '^      <fn>: {'`)。
  ③ 新增的每一段講得出對應哪支 migration;講不出來 = 先問,不要收下。

🔴 這支腳本存在的理由是 2026-08-11 那次重 gen 的教訓:
   `TARGETS` 的清單順序 **≠** 檔案順序 ⇒ 替換必須按**檔案位置**由後往前
   (第一版用 `reversed(TARGETS)`,把 `admin_initiate_order_refund` 插成了兩份,
    是上面第 ② 道檢查叫的)。校正筆數的唯一權威在 `database.types.ts` 檔頭 `:2`,
   本檔的 `TARGETS` 只是「哪幾支有校正」,新增校正時要同步補一行。
"""
import re
import sys

OLD, NEW, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
# 檔頭計數 :2 說的八支
TARGETS = [
    'create_order',
    'admin_upsert_supplier',
    'admin_append_order_note',
    'admin_initiate_order_refund',
    'admin_finalize_order_refund',
    'admin_upsert_item_procurement',
    'admin_cancel_order',
    'admin_record_item_receipt',
]


def blocks(lines):
    """回傳 {函式名: (起, 迄)}(6 空格縮排的具名區塊)。"""
    out = {}
    start = None
    name = None
    for i, ln in enumerate(lines):
        m = re.match(r'^      ([A-Za-z_][A-Za-z0-9_]*): \{$', ln)
        if m:
            start, name = i, m.group(1)
        elif ln == '      }\n' and start is not None:
            out.setdefault(name, (start, i + 1))
            start = None
    return out


def args_params(lines, span):
    """該區塊 Args 內的參數名集合(去掉 `?`,只看名字)。"""
    seg = lines[span[0]:span[1]]
    try:
        a = next(i for i, l in enumerate(seg) if l.strip() == 'Args: {')
    except StopIteration:
        return set()
    names = set()
    for l in seg[a + 1:]:
        if l.strip() in ('}', '},'):
            break
        m = re.match(r'^\s+([A-Za-z_][A-Za-z0-9_]*)\??:', l)
        if m:
            names.add(m.group(1))
    return names


old = open(OLD).readlines()
new = open(NEW).readlines()

# 檔頭 / 本體分界:行首錨點(檔頭自己就提到這個字串,裸子字串會攔腰砍斷)
h = next(i for i, l in enumerate(old) if l.startswith('export type Json ='))
header = old[:h]

ob, nb = blocks(old), blocks(new)
result = list(new)
report = []
for fn in TARGETS:
    if fn not in ob:
        report.append(f'STOP {fn}: 舊檔找不到')
        continue
    if fn not in nb:
        report.append(f'STOP {fn}: 新檔找不到(簽章消失?)')
        continue
    po, pn = args_params(old, ob[fn]), args_params(new, nb[fn])
    if po != pn:
        report.append(f'STOP {fn}: 參數集合不同 舊-新={sorted(po - pn)} 新-舊={sorted(pn - po)}')
        continue
    report.append(f'OK   {fn}: 參數集合相等({len(po)} 個)⇒ 整塊貼回')

# 由**檔案位置**由後往前替換,免得行號位移。
# 🔴 不可用 reversed(TARGETS):清單順序 ≠ 檔案順序,先替換到前面的區塊會把後面的行號推掉
#    (第一版就是這樣把 admin_initiate_order_refund 插成兩份)。
todo = [
    fn for fn in TARGETS
    if fn in ob and fn in nb and args_params(old, ob[fn]) == args_params(new, nb[fn])
]
for fn in sorted(todo, key=lambda f: nb[f][0], reverse=True):
    s, e = nb[fn]
    result[s:e] = old[ob[fn][0]:ob[fn][1]]

open(OUT, 'w').writelines(header + result)
print('\n'.join(report))
