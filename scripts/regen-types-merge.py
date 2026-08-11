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
# 檔頭計數 :2 說的十支
TARGETS = [
    'create_order',
    'admin_upsert_supplier',
    'admin_append_order_note',
    'admin_initiate_order_refund',
    'admin_finalize_order_refund',
    'admin_upsert_item_procurement',
    'admin_cancel_order',
    'admin_record_item_receipt',
    'search_products_by_vehicle',
    'admin_search_orders',
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
    """該區塊 Args 內的參數名集合(去掉 `?`,只看名字)。

    🔴 兩種寫法都要吃(2026-08-11 #415 code-reviewer MF5):生成器對**短簽章**會印成
    **單行** `Args: { p_brand: string; p_model?: string | null }`,對長簽章才印多行。
    原版只認獨立一行的 `Args: {` ⇒ 對單行簽章回**空集合**,而空集合恆等於空集合
    ⇒ 那支的「參數集合相等」守門**恆真**:真的改了簽章也照樣整塊貼回 = 靜默回捲。
    解析不出來時**回 None**(fail-closed),呼叫端一律 STOP,不當成「相等」。
    """
    seg = lines[span[0]:span[1]]
    single = None
    for l in seg:
        m1 = re.match(r'^\s+Args: \{(.+)\}\s*$', l)
        if m1:
            single = m1.group(1)
            break
    if single is not None:
        return {
            m.group(1)
            for m in re.finditer(r'([A-Za-z_][A-Za-z0-9_]*)\??:', single)
        } or None
    try:
        a = next(i for i, l in enumerate(seg) if l.strip() == 'Args: {')
    except StopIteration:
        return None
    names = set()
    for l in seg[a + 1:]:
        if l.strip() in ('}', '},'):
            break
        m = re.match(r'^\s+([A-Za-z_][A-Za-z0-9_]*)\??:', l)
        if m:
            names.add(m.group(1))
    return names or None


def args_shape(lines, span):
    """該區塊的**簽章形狀**:每個參數的 `名字|可省略|型別`(把手動校正的 ` | null` 正規化掉)
    + `Returns:` 那一行。

    🔴 為什麼不能只比參數名(2026-08-11 #415 關卡2 codex must-fix):名字集合相等
    **不代表簽章沒變** —— 型別改了(`text`→`uuid`)、`?` 被拿掉(具預設值變必填)、
    或 `Returns` 換了,名字集合照樣相等 ⇒ 舊區塊整塊貼回 = **把新簽章靜默回捲**,
    而這一條對本檔 TARGETS 尤其致命:⑨⑩ 兩支的校正本身就是在講「可省略 + 可為 null」。
    ⚠️ 比較前要把 ` | null` 正規化掉,否則**每一支有校正的都會 STOP**(那是我們自己加的差異)。
    解析不出來回 None(fail-closed)。
    """
    seg = lines[span[0]:span[1]]

    def norm(t):
        return re.sub(r'\s*\|\s*null\b', '', t).strip().rstrip(';,').strip()

    shape = {}
    single = None
    for l in seg:
        m1 = re.match(r'^\s+Args: \{(.+)\}\s*$', l)
        if m1:
            single = m1.group(1)
            break
    if single is not None:
        for part in single.split(';'):
            m = re.match(r'\s*([A-Za-z_][A-Za-z0-9_]*)(\??):\s*(.+)$', part)
            if m:
                shape[m.group(1)] = (m.group(2) == '?', norm(m.group(3)))
    else:
        try:
            a = next(i for i, l in enumerate(seg) if l.strip() == 'Args: {')
        except StopIteration:
            return None
        for l in seg[a + 1:]:
            if l.strip() in ('}', '},'):
                break
            m = re.match(r'^\s+([A-Za-z_][A-Za-z0-9_]*)(\??):\s*(.+)$', l)
            if m:
                shape[m.group(1)] = (m.group(2) == '?', norm(m.group(3)))
    if not shape:
        return None
    returns = [l.strip() for l in seg if l.strip().startswith('Returns:')]
    if not returns:
        return None
    return (tuple(sorted(shape.items())), returns[0])


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
    so, sn = args_shape(old, ob[fn]), args_shape(new, nb[fn])
    if po is None or pn is None or so is None or sn is None:
        report.append(f'STOP {fn}: Args/Returns 解析不出來(名字 舊={po} 新={pn};形狀 舊={so is not None} 新={sn is not None})⇒ fail-closed,不貼回')
        continue
    if po != pn:
        report.append(f'STOP {fn}: 參數集合不同 舊-新={sorted(po - pn)} 新-舊={sorted(pn - po)}')
        continue
    if so != sn:
        diff = [k for k in dict(so[0]) if dict(so[0]).get(k) != dict(sn[0]).get(k)]
        report.append(f'STOP {fn}: 簽章形狀變了(參數名相同)—— 差異參數={sorted(diff)};Returns 舊={so[1]} 新={sn[1]}')
        continue
    report.append(f'OK   {fn}: 參數集合與簽章形狀皆相等({len(po)} 個)⇒ 整塊貼回')

# 由**檔案位置**由後往前替換,免得行號位移。
# 🔴 不可用 reversed(TARGETS):清單順序 ≠ 檔案順序,先替換到前面的區塊會把後面的行號推掉
#    (第一版就是這樣把 admin_initiate_order_refund 插成兩份)。
todo = [
    fn for fn in TARGETS
    if fn in ob and fn in nb
    and args_params(old, ob[fn]) is not None
    and args_params(old, ob[fn]) == args_params(new, nb[fn])
    and args_shape(old, ob[fn]) is not None
    and args_shape(old, ob[fn]) == args_shape(new, nb[fn])
]
for fn in sorted(todo, key=lambda f: nb[f][0], reverse=True):
    s, e = nb[fn]
    result[s:e] = old[ob[fn][0]:ob[fn][1]]

open(OUT, 'w').writelines(header + result)
print('\n'.join(report))
