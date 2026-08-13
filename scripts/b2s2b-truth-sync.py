#!/usr/bin/env python3
# ============================================================
# B2-S2b-3a 後段:真相式**六塊**同步守門(抽取 + 判定,不做突變)
# ============================================================
# 用法:python3 scripts/b2s2b-truth-sync.py <repo-root>
#   → stdout 逐行印出**紅掉的 key**(全綠時零輸出);**exit code:全綠 0、有紅 1**。
#     🔴 呼叫端**必須同時看 rc**:只看「stdout 空」會把 crash(例如非 UTF-8 位元組讓
#     `UnicodeDecodeError` 冒出來)讀成全綠 —— R1 must-fix 2 實測過這條 fail-open。
#   → stderr 印人看的診斷。
#
# 🔴 **位置集合寫死在 SITES,禁止用全樹 grep 決定集合**(plan §1.1 自查型 3):
#   標記字串 `SHIPPED-TRUTH-BEGIN` **也出現在 plan 檔與本檔自己身上** ⇒ 全樹 grep 會多命中,
#   而「找到 7 份、其中 1 份不同」會被讀成同步失敗或被隨手排除,兩種都壞。
#   ⚠️ plan §1.1 另有一句「後段的守門一律自己 grep 取集合再驗計數」——**那句與上面這條互相矛盾**,
#   是我在 3a 前段寫進去的。本檔採**寫死集合**這條(它才是 plan 原本論證過的);plan 字面已同批更正。
#
# 🔴 **分半原則(plan §1.1 v3.1;主視窗 B-151-A 修正後的判斷順序)**:
#   ①**先**算全等半 = 五個「嵌入形」區塊逐字相同的行(實測 5 行,凍結在 COMMON)
#   ②其餘的行 → per-site 整行字面凍結
#   ③**helper 那塊不參與全等半**(語句級聚合 + 別名 s + 行尾註解)⇒ 整塊 6 行全 per-site
#   ④**完整性斷言逐區塊做**
#
# 🔴🔴 **實作上比 v3.1 更嚴一階:每塊凍結的是「整塊 6 行的<u>序列</u>」(`BLOCKS`)。**
#   只比「集合包含」時,把 `AND sh.deleted_at IS NULL` 與述詞行**對調**是全綠的(R1 nit 3 實測)——
#   現行 6 行形狀下重排非等價即非法,但形狀一變(例如改 LEFT JOIN)那就是真縫。
#   `COMMON` / `PERSITE` 保留為**對分半原則本身的自我一致性斷言**(見 `check_frozen_table`),
#   它們與 `BLOCKS` 不一致時**先紅在凍結表自己**,而不是等到比對檔案才紅。
#
# 🔴 抽取時逐行 `strip()`:**只有 helper 那塊需要它**(它維持原縮排,Q1=B 不動 helper);
#   五個嵌入形區塊在原檔內刻意零縮排。上一版註解寫「不 strip 全等半永遠是空集合」是**錯的**
#   (R1 nit 4 實測:不 strip 全等半仍是 5 行)—— 已更正。
#
# 🔴 **本檔守不到的**(天花板,寫死不留給下一棒推測):
#   ①**標記區塊<u>外</u>的接線**。把 `a4a-verify.sh` 標記前一行的
#     `OR s.shipped_quantity IS DISTINCT FROM` 改成 `s.instock_quantity`,第四軸 oracle 就接錯欄,
#     而本守門**全綠**(R1 nit 5 實測)。要守它得比整條述詞的宿主表達式,不在 3a 範圍。
#   ②**SQL 語意**:本檔是純文字比對,不解析 SQL。字面對 ≠ 查詢正確。
import io, os, sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'

MIG = 'supabase/migrations/20260806180000_m4b_e10_b2_s2b_shipped_recompute_wire.sql'
# 🔴 2026-08-13(#452):helper 被 20260813120000 以 CREATE OR REPLACE 再次替換 ⇒
#    **apply 之後,helper 的定義權威在那一支,不在 MIG**。
#    不把它加進 SITES 的話,本守門會繼續比對 MIG(死檔)並保持全綠,
#    而「唯一 writer」(MIG:220 逐字)已經脫離同步集合 —— 那正是本守門要防的事。
MIG452 = 'supabase/migrations/20260813120000_m4b_e10_452_procurement_void_schema.sql'
RB = 'docs/runbooks/a4a-summary-rollback.md'
AV = 'scripts/a4a-verify.sh'

# (key, 檔案, 該檔內第幾個標記區塊, 是否參與全等半)
SITES = [
    ('helper',        MIG, 1, False),
    ('helper-452',    MIG452, 1, False),   # #452:helper 的現行定義處
    ('backfill',      MIG, 2, True),
    ('rb-div-col',    RB,  1, True),
    ('rb-div-where',  RB,  2, True),
    ('rb-step5',      RB,  3, True),
    ('av-oracle',     AV,  1, True),
]
# 🔴 **凍結的是 key 集合,不是只有個數**(R1 must-fix 1 實測:只凍 `len(SITES)==6` 時,
#    「刪掉 rb-step5 + 重複一份 rb-div-col」照樣 6 個 ⇒ 守門零輸出全綠、那一塊從此無人守)。
#    這正是本 repo 在 harness 計數上中過三次的同一族。
SITES_KEYS_FROZEN = ['av-oracle', 'backfill', 'helper', 'helper-452', 'rb-div-col', 'rb-div-where', 'rb-step5']
# 每個檔案應有的標記區塊數(BEGIN 與 END 都算;檔尾多一個沒配對的 BEGIN 只靠抽取抓不到 —— R1 nit 6)
BLOCKS_PER_FILE = {MIG: 2, RB: 3, AV: 1, MIG452: 1}

# ── 凍結值(**測量值**,2026-08-06 S2b-3a 後段對 commit ff366bf 實測)──────────
# 🔴 全部是**常數字面**,不是執行期自算再跟自己比(小線 R1 實錘:自算 = 恆綠)。
#    真相式合法變更時必須回來改這裡 —— 那是設計,不是故障。
EMBED = [
    'COALESCE((SELECT sum(si.shipped_quantity)',
    'FROM public.shipment_items si',
    'JOIN public.shipments sh ON sh.id = si.shipment_id',
    None,                                   # ← per-site 的關聯述詞行,逐處不同
    'AND sh.deleted_at IS NULL',
    'AND sh.shipped_at IS NOT NULL), 0)',
]
def embed(pred):
    return [pred if l is None else l for l in EMBED]

BLOCKS = {
    'helper': [
        'SELECT COALESCE(sum(si.shipped_quantity), 0) INTO v_shipped',
        'FROM public.shipment_items si',
        'JOIN public.shipments s ON s.id = si.shipment_id',
        'WHERE si.order_item_id = p_order_item_id',
        'AND s.deleted_at IS NULL          -- Q3=A:作廢即退量',
        'AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算',
    ],
    # 🔴 與 'helper' **逐字相同**:#452 只改了 ordered 軸的述詞,SHIPPED-TRUTH 區塊一個字都沒動。
    #    兩處都凍同一份內容 = 它們必須保持一致(任何一邊漂了都紅)。
    'helper-452': [
        'SELECT COALESCE(sum(si.shipped_quantity), 0) INTO v_shipped',
        'FROM public.shipment_items si',
        'JOIN public.shipments s ON s.id = si.shipment_id',
        'WHERE si.order_item_id = p_order_item_id',
        'AND s.deleted_at IS NULL          -- Q3=A:作廢即退量',
        'AND s.shipped_at IS NOT NULL;     -- 未寄出的草稿箱不算',
    ],
    'backfill':     embed('WHERE si.order_item_id = s.order_item_id'),
    'rb-div-col':   embed('WHERE si.order_item_id = u.order_item_id'),
    'rb-div-where': embed('WHERE si.order_item_id = u.order_item_id'),
    'rb-step5':     embed('WHERE si.order_item_id = u.order_item_id'),
    'av-oracle':    embed('WHERE si.order_item_id = s.order_item_id'),
}
COMMON = [l for l in EMBED if l is not None]          # 全等半(5 行)
# 🔴 2026-08-13(#452)修法:原式用**寫死的 key 名字** `k != 'helper'` 判「參不參與全等半」,
#    而那個語意的真正載體是 SITES 的 `in_common` 旗標 ⇒ 一加第二個整塊比對的位置就會誤判。
#    改成讀旗標本身。**這是把判準對齊它自己的定義,不是放寬。**
IN_COMMON = {k: c for k, _f, _i, c in SITES}
PERSITE = {k: ([v[3]] if IN_COMMON[k] else list(v)) for k, v in BLOCKS.items()}

reds = []
def red(key, why):
    reds.append(key)
    sys.stderr.write('     [%s] %s\n' % (key, why))

def check_frozen_table():
    """🔴 對**凍結表自己**做 v3.1 分半原則的自我一致性斷言(位置集合 / idx 覆蓋 / 分半結構)。
    🔴 誠實邊界(R2 F3):`COMMON`/`PERSITE` 是由 `EMBED`/`BLOCKS` **推導**的 ⇒ 分半那三條在現行
    `embed()` 形狀下按構造近乎恆真;真正可達的紅點是「有人把 embed() 換成手寫字面清單」
    或「翻 in_common 旗標」。承重的比對是**檔案 vs 寫死常數**,不是這裡。"""
    if sorted(k for k, *_ in SITES) != SITES_KEYS_FROZEN:
        red('SITES', '位置 key 集合不符:實得 %r,凍結 %r —— 有位置被刪/改/重複'
                     % (sorted(k for k, *_ in SITES), SITES_KEYS_FROZEN))
    # 🔴 **idx 軸也要守**(R2 F2):key 集合擋不住「把 `('rb-step5', RB, 3)` 改成 `RB, 2`」——
    #    key 不變、而 RB 三塊的凍結內容**碰巧逐字相同**(都是 `embed('… u.order_item_id')`)
    #    ⇒ 比到第 2 塊照樣綠、塊數 3 也綠,**RB 第 3 塊從此無人比對且零紅點**。
    #    ⇒ 逐檔斷言「SITES 用到的 idx 多重集合 == 1..該檔應有的塊數」。
    for f, n in BLOCKS_PER_FILE.items():
        got_idx = sorted(i for _k, ff, i, _c in SITES if ff == f)
        if got_idx != list(range(1, n + 1)):
            red('SITES', '%s 的 idx 覆蓋不符:實得 %r,應為 %r —— 有塊被跳過或重複指到'
                         % (os.path.basename(f), got_idx, list(range(1, n + 1))))
    for key, _f, _i, in_common in SITES:
        blk = BLOCKS[key]
        if in_common:
            hits = [l for l in blk if l in COMMON]
            rest = [l for l in blk if l not in COMMON]
            if hits != COMMON:
                red('FROZEN', '%s 的凍結塊與 COMMON 不一致(全等半應恰為那 5 行、且順序相同)' % key)
            if rest != PERSITE[key]:
                red('FROZEN', '%s 的 per-site 推導與凍結表不一致' % key)
            # ④ 完整性:兩半合計 = 該塊總行數(對凍結表本身斷言,不是對檔案)
            if len(hits) + len(rest) != len(blk):
                red('FROZEN', '%s 的分半算術不成立' % key)
        else:
            # 🔴 helper:**整塊 per-site**,不做兩半拆解。
            #    ⚠️ 它與 COMMON **碰巧有 1 行重疊**(`FROM public.shipment_items si` —— 那是跨全部
            #    六塊唯一逐字相同的行)。上一版在這裡斷言「helper 一行 COMMON 都不能含」,
            #    **被本函式自己當場紅掉** —— 「不參與全等半」講的是**判定方式**(整塊比對),
            #    不是「內容不得與 COMMON 有交集」。兩者混為一談就會寫出這條假斷言。
            if PERSITE[key] != blk:
                red('FROZEN', '%s 的 per-site 凍結不是整塊(不參與全等半的塊必須整塊凍)' % key)

def extract_all(path):
    """回傳該檔所有標記區塊(每塊是已 strip 的行 list),外加 (begin 數, end 數)。"""
    lines = io.open(os.path.join(ROOT, path), encoding='utf-8').read().split('\n')
    out, st, nb, ne = [], None, 0, 0
    for i, l in enumerate(lines):
        t = l.strip()
        if t == '-- SHIPPED-TRUTH-BEGIN':
            nb += 1
            st = i
        elif t == '-- SHIPPED-TRUTH-END':
            ne += 1
            if st is not None:
                out.append([x.strip() for x in lines[st + 1:i]])
                st = None
    return out, nb, ne

check_frozen_table()

cache = {}
for path, expect_n in BLOCKS_PER_FILE.items():
    try:
        blocks, nb, ne = extract_all(path)
    except Exception as e:          # OSError / UnicodeDecodeError / 任何解不開的檔案
        red('FILE:' + os.path.basename(path), '讀不到或解不開:%s: %s' % (type(e).__name__, e))
        cache[path] = None
        continue
    cache[path] = blocks
    # 🔴 標記配對與塊數自斷言:檔尾多一個沒配對的 BEGIN,光靠抽取抓不到(R1 nit 6 實測)
    if nb != ne or len(blocks) != expect_n:
        red('FILE:' + os.path.basename(path),
            'BEGIN=%d / END=%d / 成塊=%d,期望各 %d —— 標記被加/刪或沒配對' % (nb, ne, len(blocks), expect_n))

for key, path, idx, _in_common in SITES:
    blocks = cache.get(path)
    if blocks is None:
        red(key, '所屬檔案讀不到(見上方 FILE: 紅點)')
        continue
    if idx > len(blocks):
        red(key, '該檔只有 %d 個標記區塊,取不到第 %d 個 —— 標記被刪掉了' % (len(blocks), idx))
        continue
    blk = blocks[idx - 1]
    # 🔴 **整塊序列逐字比對**:一次涵蓋行數、內容、順序三件事。
    #    上一版拆成「長度 / 全等半缺行 / per-site 不符 / 完整性算術」四條,但實測那四條
    #    **沒有一條構造得出只紅它自己的負測**(R1 must-fix 3 / nit 1 / nit 2)——
    #    構造不出只紅它的負測 = 先懷疑那條是 no-op(memory `feedback_unconstructible-negative-test-means-noop-guard`)。
    #    ⇒ 合併成一條**真的會單獨紅**的斷言,並在下面把差異指到行。
    if blk != BLOCKS[key]:
        exp, got = BLOCKS[key], blk
        if len(got) != len(exp):
            red(key, '區塊 %d 行,凍結 %d 行 —— 有行被加/刪' % (len(got), len(exp)))
        else:
            d = [(i, a, b) for i, (a, b) in enumerate(zip(got, exp)) if a != b]
            # 🔴 helper 塊整塊 per-site ⇒ 即使該行碰巧在 COMMON 裡也不該標「全等半」(R2 F5)。
            in_common_site = dict((k, c) for k, _f, _i, c in SITES)[key]
            half = '全等半' if (in_common_site and d and exp[d[0][0]] in COMMON) else 'per-site 半'
            red(key, '第 %d 行不符(%s):期望「%s」實得「%s」' % (d[0][0] + 1, half, d[0][2], d[0][1]))

for k in sorted(set(reds)):
    print(k)
sys.exit(1 if reds else 0)
