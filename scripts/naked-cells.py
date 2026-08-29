#!/usr/bin/env python3
"""掃出「裸的負向斷言」格 —— 一個 it()/test() 區塊裡負向斷言 >=1 而正向斷言 = 0。

🔴🔴 **canonical: `scripts/naked-cells.py`**
   **若你手上這一份不在這個路徑上, 它是【副本】** ——
   **去讀 canonical, 不要用副本判定本尺的能力。**
   驗法(兩行, 各自答一個問題):
     git ls-files --error-unmatch scripts/naked-cells.py   # rc=0 ⇒ 你在 canonical 那棵樹上
     git diff --quiet -- scripts/naked-cells.py            # rc=0 ⇒ 你手上這份 = HEAD 那一份
   ⚠️ 在 scratchpad / 非 repo 底下第一行會錯 —— **那個錯就是訊號**, 不是工具壞了。

   📌 **為什麼加這幾行**(2026-08-29,而它是實錘不是預防):
      有人拿一份 **87 行的 scratchpad 副本**, 判定這把尺「沒有宣告 throw 盲區」——
      **而 canonical 有宣告, 還給了實例、每次跑都印。**
      🔴 他沒有做錯任何事:**那份副本沒有任何東西告訴他它是副本。**

   🔴 **為什麼【不寫 sha256 / 不寫行數】(設計選擇, 理由留在這裡)**:
      把自己的雜湊或行數寫進自己 ⇒ **寫下去那一秒它就不對了** ⇒ 那是自我否定;
      而「加完再量一次補上」只是把失效延到**下一次任何編輯**, 且失效時**零訊號**。
      ⇒ 改成【問 git】—— 上面兩行不會因為本段的存在而失效, 它們問的是外部事實。
      ⚠️ **代價明寫**:它答不出「你這份副本是哪一版」, 只答得出「是不是這一版」。
         要知道副本的來歷仍然需要人去追。**這是較弱的一版, 而它至少不會騙人。**

用法:naked-cells.py <檔> [<檔> ...]  ·  --selftest 只跑自檢  ·  --matchers <檔...> 列未分類的斷言  ·  --help

════════ 版本 2(2026-08-28 夜,code-reviewer R5 FAIL 之後重寫)════════
v1 自檢通過, 而 reviewer 寫得出五發突變讓它繼續印綠。**根因只有一個**:
v1 的三個自檢世界【全是單格、單行、從第 1 行起】—— 而出事的邏輯全在【多格之間】。
📌 一把尺的自檢世界如果比它要量的東西簡單, 它量不到自己的病。

v1 的五個病(全部由 R5 實跑證明, 逐條修在下面):
  ① 字集比宣稱窄 —— toBeFalsy / toBeUndefined / not.toHaveAttribute /
     not.toBeVisible / toBe(false) 五種真裸格【印 0】⇒ 連進判斷都沒進 = **少報**
  ② 區塊邊界吃到下一個 it( 或檔尾 ⇒ 後面 helper 的 expect(1).toBe(1) 被當成自己的錨、
     兩格之間的 afterEach 算給前一格 ⇒ **少報**
  ③ 剝註解順序反了(/* */ 先剝)⇒ 一行 `// TODO: /* …` 會吃到後面任何一個 */ ⇒ **雙向**
  ④ lookbehind 擋不住字串裡的 //(`toBe('//cdn/x')`)⇒ 有錨的被報成裸的 = **誤報**
  ⑤ 自檢三世界零覆蓋前四條 —— 兩發突變(行號恆 1 / 邊界失效)自檢皆 True
🔴 ③④②③ 的修法不是加 regex, 是**改成逐字元掃描**:註解與字串字面一起遮掉。
🔴 v1 檔頭寫「本尺多報不少報」—— **那句是錯的**, ①② 都是少報。已刪。

⚠️ 仍存在的盲區(印在每次輸出裡, 因為下一個人讀的是輸出):
   Ⓐ **抽成具名函式的錨看不見** —— expectPageRendered(c) / runJudge(...) 內含的
      正向斷言, 本尺一律看不到 ⇒ 會把【有錨的】報成裸的(誤報)。
   Ⓑ **字集是人寫的** —— 不在 NEG 也不在 POS 的斷言會被算成 unknown;
      整格只有 unknown 的格子本尺**不判**, 另行列出給人看(這是 ① 的殘留面)。
      ⇒ 2026-08-28 起用 `--matchers` 把這一格變成**列得出來的集合**(見下)。
   🔴 Ⓒ **本尺只認【`expect` 型】的錨** —— `if (x !== 'failed') throw new Error(…)`
      這種**用擲錯當守門**的寫法, 它連看都看不到。
      ⚠️ 這與Ⓐ**不是同一件事**:Ⓐ 的錨【是 expect】只是不在這一格;
        Ⓒ 的錨**根本不長那個樣子** ⇒ 一把靠「找 expect」認錨的尺對它**天生失明**,
        **不是漏掉, 是不在射程裡** ⇒ 而 `--matchers` 也接不到(它掃的是 expect 敘述)。
      實例:`apps/admin/src/lib/orders/receipt-actions.test.ts:286`(2026-08-28 第三批)。
   🔴 Ⓓ **`for (const x of xs) expect(x)…` 這種寫法看不見**(2026-08-29 線C 出證、線B 當場量):
      整格只有一個【正向】斷言, 而它住在迴圈裡 ⇒ 集合是空的時候**零次迭代 ⇒ 零斷言 ⇒ 綠**。
      本尺把那個 expect 判成 pos ⇒ 該格【不裸】⇒ **少報**。
      當場量到的兩個世界:
        `for (const p of result) expect(p.price).toBeGreaterThan(0)` ⇒ 本尺報 **[]**(漏)
        `expect(result.every((p) => p.price <= 3000)).toBe(true)`    ⇒ 本尺報 **[4]**(抓到)
      📌 **「零次迭代也算過」與「空集合上 every 恆真」是同一件事的兩種寫法, 而本尺只認後者。**
      ⚠️ **這一格【刻意不擴字集】** —— 要抓它得判「所有斷言是不是都在一個可能為空的迴圈裡」,
        那是分析不是關鍵字。**擴字集會做出一把看起來變寬、而仍然漏的尺。**
   ⇒ **每一筆命中都要開檔核。**
"""
import re, sys, io

# ── 逐字元遮罩:註解與字串字面的內容 → 空白(換行保留 ⇒ 行號不飄)────────────
def mask(s: str) -> str:
    """回傳與 s 等長的字串;註解內容、字串/樣板/正則的內容一律換成空白。

    🔴 為什麼不用 regex(v1 的 ③④ 就死在這):
       `// TODO: /* 舊寫法` 這一行, regex 版會從 /* 一路吃到後面任何一個 */;
       `toBe('//cdn/x')` 這一句, 字串裡的 // 會被當成註解起點, 把 '); 一起吃掉。
       兩種都會讓【區塊邊界塌掉】, 而塌掉之後的輸出看起來完全正常。
    """
    out = list(s); i = 0; n = len(s)
    prev_sig = ''  # 上一個非空白的有效字元(判斷 / 是除號還是正則起點)
    while i < n:
        c = s[i]
        if c == '/' and i + 1 < n and s[i+1] == '/':          # 行註解
            while i < n and s[i] != '\n': out[i] = ' '; i += 1
            continue
        if c == '/' and i + 1 < n and s[i+1] == '*':          # 區塊註解
            j = s.find('*/', i + 2); j = n if j < 0 else j + 2
            for k in range(i, j):
                if s[k] != '\n': out[k] = ' '
            i = j; continue
        if c in '"\'`':                                        # 字串 / 樣板
            q = c; j = i + 1
            while j < n:
                if s[j] == '\\': j += 2; continue
                if s[j] == q: break
                j += 1
            for k in range(i + 1, min(j, n)):
                if s[k] != '\n': out[k] = ' '
            i = min(j, n - 1) + 1; prev_sig = q; continue
        if c == '/' and prev_sig in ('', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';'):   # 註:不含 '\n' —— prev_sig 只在非空白時寫入
            j = i + 1                                          # 正則字面
            while j < n and s[j] != '\n':
                if s[j] == '\\': j += 2; continue
                if s[j] == '/': break
                j += 1
            if j < n and s[j] == '/':
                for k in range(i + 1, j): out[k] = ' '
                i = j + 1; prev_sig = '/'; continue
        if not c.isspace(): prev_sig = c
        i += 1
    return ''.join(out)

# ── 斷言字集 ────────────────────────────────────────────────────────────────
NEG = [r'not\.toContain', r'not\.toHaveBeenCalled', r'not\.toMatch',
       r'not\.toBeInTheDocument', r'not\.toHaveAttribute', r'not\.toBeVisible',
       r'not\.toBeChecked', r'not\.toBeDisabled', r'not\.toHaveClass',
       r'toEqual\(\s*\[\s*\]\s*\)', r'toStrictEqual\(\s*\[\s*\]\s*\)',
       r'toHaveLength\(\s*0\s*\)', r'toBeFalsy\(\)', r'toBeUndefined\(\)',
       r'toBe\(\s*false\s*\)', r'toBe\(\s*undefined\s*\)', r'toBe\(\s*0\s*\)',
       # 🔴 這兩條是【方向】決定的:空集合上 `.every()` 恆真、`.some()` 恆假
       #    ⇒ `.every(...).toBe(true)` 與 `.some(...).toBe(false)` 是裸的,
       #      而 `.every(...).toBe(false)` 與 `.some(...).toBe(true)` **不是**。
       #    ⚠️ v2 改寫時我把這兩條刪掉了 —— 而它們在 v1 裡是對的。
       #      抓到它的是【v1 對 v2 的逐格比對】, 不是自檢:v1 報而 v2 不報那一格,
       #      我原本要記成「v1 誤報」, 開檔才發現是**我的新少報**。
       #      📌 一次改寫可以同時修好四個病、而長出第五個, 而總數看起來是進步的。
       r'\.every\([^;]*\)\.toBe\(\s*true\s*\)', r'\.some\([^;]*\)\.toBe\(\s*false\s*\)']
# 🔴 **`toHaveBeenCalledTimes` 這一族是 2026-08-28 第二批核出來的**:原本只寫
#    `toHaveBeenCalled\b` —— 而那個 `\b` 讓 `toHaveBeenCalledTimes` / `…With` **不匹配**
#    ⇒ 整格只有那種正向斷言時, 它落進 unknown ⇒ **該格被報成裸的(誤報)**。
#    量到的影響面:補上之後【不再報】的格 = **84 格**(母體 1454, 2026-08-28 21:0x)。
#    ⚠️ 而 `\b` 靜默不匹配這個形狀, **memory 的 grep 量具族早就記過** —— 這是一次重新發現:
#      **寫這支新工具的人不知道它存在, 而它在索引上。**
POS_RE = (r'\.(toBe|toEqual|toContain|toHaveBeenCalledTimes|toHaveBeenCalledWith|'
          r'toHaveBeenCalled|toMatch|toBeGreaterThan|'
          r'toBeGreaterThanOrEqual|toBeTruthy|toBeInTheDocument|toHaveLength|toThrow|'
          r'toStrictEqual|toBeDefined|toBeLessThan|toBeCloseTo|toHaveAttribute|'
          r'toHaveClass|toBeVisible|toBeChecked|toBeNaN|toBeInstanceOf|'
          # 🔴 第二批(2026-08-28 21:0x)又補一輪 —— 而**重點不是這幾個名字**:
          #    兩批各撞到一次字集缺口 ⇒ **「再想久一點」不會收斂**, 所以同時加了 `--matchers`
          #    (見下), 把「字集有沒有缺口」從【踩到才知道】變成【一行指令印得出來】。
          r'toMatchObject|toHaveProperty|toContainEqual|toHaveBeenCalledOnce|'
          r'toHaveBeenCalledExactlyOnceWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|'
          r'toBeLessThanOrEqual|toBeTypeOf|toThrowError|toSatisfy)\b')

def kind(st: str) -> str:
    """'neg' / 'pos' / 'unknown' / ''(不是斷言)"""
    if 'expect' not in st: return ''
    if 'not.toBeNull' not in st and re.search(r'toBeNull\(\s*\)', st): return 'neg'
    if any(re.search(p, st) for p in NEG): return 'neg'
    if 'not.toBeNull' in st: return 'pos'
    if re.search(POS_RE, st): return 'pos'
    return 'unknown'

# ── 區塊邊界:從 it( 那個左括號做括號配對,不是「下一個 it(」──────────────
def _match_paren(masked: str, i: int) -> int:
    """從 masked[i] == '(' 起做括號配對, 回傳右括號的 offset(找不到回檔尾)。"""
    d = 0; j = i
    while j < len(masked):
        if masked[j] == '(': d += 1
        elif masked[j] == ')':
            d -= 1
            if d == 0: return j
        j += 1
    return len(masked) - 1

def cells(masked: str):
    """回傳 [(起點 offset, 終點 offset)];終點 = 該 it/test 呼叫【鏈的最後一個】右括號。

    🔴 **鏈式呼叫必須跟著走完**(R2 must-fix, 2026-08-28):
       `it.each([...])('%s …', (a) => { … })` 是**兩組括號** ——
       只配對第一組的話, 終點切在 `.each(…)` 的右括號上,
       ⇒ **真正的本體(第二組裡的箭頭函式)從來沒被掃過。**
       實測(R2 全 repo 691 支):`cells()` 切出 10,037 格、其中 **365 格不含 `=>`**
       = 切在本體之前;補好之後多報出的格:
         **66 格 / 40 支檔**(2026-08-28 20:39, 字集補洞【之前】)
         ⇒ **58 格 / 34 支檔**(20:54, 補完 `toHaveBeenCalledTimes` 那四種【之後】)
       🔴 **兩個數留著並排** —— 只留新的看不出那把尺變準了多少;
          而少掉的 8 格**不是消失的問題, 是本來就有錨的假紅**。
       ⚠️ 而這些格**不在 naked、也不在 unknown** ⇒ 它們在補洞前的輸出上**完全沒有形狀**。
       📌 這與 v1 的 ①② 是同一個病的第三次:**掃描範圍比宣稱窄, 而自檢裡沒有那個世界。**
    """
    out = []
    for m in re.finditer(r'(?:^|[\s;{}])(it|test)(\.\w+)?\s*\(', masked, re.M):
        i = masked.index('(', m.end() - 1) if masked[m.end()-1] != '(' else m.end() - 1
        j = _match_paren(masked, i)
        # 鏈式:`)(` 之後還有一組, 一路跟到最後一組
        k = j + 1
        while k < len(masked):
            while k < len(masked) and masked[k].isspace(): k += 1
            if k < len(masked) and masked[k] == '(':
                j = _match_paren(masked, k); k = j + 1
            else: break
        out.append((m.start(1), min(j + 1, len(masked))))
    return out

def body_of(seg: str) -> str:
    """取出 it(..., () => { 這裡 }) 的【本體】。

    🔴 **深度基準必須從本體算起, 不能從 `it(` 算起**(v2 自己第一版就死在這):
       從 `it(` 起算的話, 本體裡的每一行都在 depth>=2, 而切割條件永遠不成立
       ⇒ **整格塌成一則** ⇒ 一則裡同時有負向與正向時只記負向
       ⇒ **有錨的格子被報成裸的**(正是 v1 nit :41 那個病, 換了個地方長出來)。
    """
    a = seg.find('{')
    if a < 0: return seg
    d = 0
    for j in range(a, len(seg)):
        if seg[j] == '{': d += 1
        elif seg[j] == '}':
            d -= 1
            if d == 0: return seg[a+1:j]
    return seg[a+1:]

def statements(seg: str):
    """以 depth==0 的 `;` 或換行切敘述 —— **兩種都要**:
    只切 `;` 的話, Prettier `semi:false` 的檔整格塌成一則(v1 的 nit);
    只切換行的話, 跨行的 expect( 會被切斷。"""
    outs = []; buf = []; d = 0
    for idx, ch in enumerate(seg):
        if ch in '([{': d += 1
        elif ch in ')]}': d -= 1
        cut = (ch == ';' or ch == '\n') and d <= 0
        if ch == '\n' and cut:
            # 🔴 **接續行不切**(R2 抓到的回歸, 全 repo 154 處):
            #    `expect(x, '訊息')` 換行接 `.toBe(…)` —— 換行處括號是平衡的,
            #    照切的話前半判 unknown、後半沒有 expect ⇒ **正向錨消失、該格被誤報成裸**。
            #    ⚠️ v1 只切 `;`, 結構上不會犯這個 ⇒ **這是我 v2 新長出來的病, 不是 v1 的。**
            nxt = idx + 1
            while nxt < len(seg) and seg[nxt] in ' \t\r\n': nxt += 1
            if nxt < len(seg) and seg[nxt] in '.)]},?:+-*/&|': cut = False
        if cut:
            outs.append(''.join(buf)); buf = []
        else: buf.append(ch)
    outs.append(''.join(buf))
    return [re.sub(r'\s+', ' ', x) for x in outs]

# ── Ⓓ 那一族:「零次迭代也算過」──────────────────────────────────────────────
# 🔴 **這是【純新增】的偵測器 —— 它不改變任何一格既有的 naked/unknown 判定。**
#    那是刻意的:線B 2026-08-29 提醒「加一個 pattern 之後另一族靜默消失」是它踩過的最壞形狀
#    (v1→v2 重寫時把 `.every(...).toBe(true)` 從 NEG 刪掉而毫無察覺, 自檢 11 世界全過)
#    ⇒ 做成純新增 ⇒ 「會不會擠掉某一族」這一題的答案是**零風險**, 而不是「我覺得不會」。
#
# 這一族長什麼樣:格內【所有】的 expect 都在迴圈裡 ⇒ **集合是空的時候零次迭代 ⇒ 零斷言 ⇒ 綠**。
#   實例① `sortProducts price-asc` 的 for-index(code-reviewer 2026-08-29 撈的)
#   實例② `product-jsonld.test.ts:180` —— **標題叫「正向白名單」而它是裸的**(線G 撈的)
#          📌 它住在最尷尬的位置:就在兩個裸格的同一個 describe 裡, **標題會讓人以為錨已經在了**
# 🔴 **而這一族到目前為止, 每一格都是【別人撈給我的】。**
#    那不是自責, 是**這把尺的盲區形狀的證據**:它漏掉的東西, **只有換一雙眼睛才看得到**。
#
# ⚠️ **刻意【不收】`if (…) expect(…)`**(線B 判的):它的空世界是「條件不成立」不是「集合是空的」,
#    而那可能是刻意的(某些格就是在測「不成立時不做事」)⇒ 收它會做出假紅。
# ⚠️ **刻意【排除字面陣列】** —— `for (const m of ['a','b'])` 不可能是空的 ⇒ 不是這一族。
#    🔴 這一條是量出來的:第一版沒排除字面 ⇒ 報 278 格, 而**手抽 3 格 3 格全是誤報**
#      (refund.test.ts:293 · brand-content.test.ts:49 · result-banner.test.tsx:208 全在跑字面陣列)
#      ⇒ 收緊後 **136 格**。📌 **那個 278 看起來像一個發現, 而它是一把太寬的尺。**
LOOP_HEAD = re.compile(
    r'(?:\bfor\s*\(|\bwhile\s*\(|[.?]\s*\.?\s*(?:forEach|map|filter|some|every|flatMap)\s*\()[^{]*$')
# 🔴 兩處都要求【中括號裡有東西】—— 少了那個要求, `(r ?? []).forEach(...)` 會被誤殺,
#    而那是線B 點名「最該被抓、而最像已經處理過的」三種之一:
#    `?? []` 是一個 **fallback**, 不是被跑的字面 —— 它明說了「這東西可能不在」。
#    ✅ 這一格是【自檢當場抓到的】:第一版裝進來時形狀 H 掉了, 而九種形狀的自檢立刻紅。
#    📌 **一把新尺的第一個使用者是它自己的自檢。**
LOOP_LITERAL = re.compile(r'\bfor\s*\([^)]*\bof\s*\[[^\]]|\[[^\]]+\]\s*(?:as\s+const\s*)?\)\s*\.\s*(?:forEach|map)\s*\(')

# ── v2(2026-08-29):字面陣列【存進變數】那一族 ─────────────────────────────
# 🔴 **來源不是我發現的, 是抽樣打出來的**:我自己抽 10 格判「真裸 6」,
#    R3 用【另一把尺】重判 ⇒ 6 格裡有 4 格是同一個病:
#      `const cases = [ … ]` 先存進變數, 再 `for (const c of cases)`
#    而 v1 的字面排除【只看迴圈頭】⇒ 看不穿一個變數裡裝的是字面。
# 🔴 **而真正的收穫是判準本身換了一層**:
#      v1(語法層)  「斷言只活在迴圈裡嗎」
#      v2(行為層)  「零次迭代那個世界, **不改測試檔本身**搆不搆得到」
#                   ⇒ 跑生產衍生的東西 = 真裸;跑測試自己寫死的清單 = 誤報
#    📌 一份寫死在測試裡的清單**永遠不會自己變空** ⇒ 它不屬於這一族。
#    ⚠️ 它另有一個真缺陷(清單會過期、新增一軸不會被守)——
#       那是 **stale-pin 族**, 不是零迭代族, **不要收進這裡**。
#
# 🔴 **選擇(明寫, 連同代價)**:宣告【全檔追】, 不限同一個 `it()` 之內。
#    理由是量到的(🔴 **兩個比例的分母不同, R1 點名要寫清楚**):
#      **24% = 33/135**(全分母:v1 那 135 格裡, 字面宣告在【同一格內】的)
#      **40% = 4/10** (抽樣分母:我抽的 10 格裡, 這個病造成的誤報)
#    ⇒ 差額住在【宣告在 `it()` 外面】那些 ⇒ 所以要全檔追。
#    ⚠️ 檔內另有一處寫 v1 產出是「136 格」、一處寫「135 格」—— 兩個都是 v1 的量,
#      🔴 **R2 已歸因:135 是對的、136 是錯的** —— R2 獨立重跑 v1 的 HEAD blob ⇒ **135 格 / 87 支檔**,
#      而支檔數 87 與舊 banner 一致 ⇒ 那個 136 是當時數錯了, 不是稿變動。
#    🔴 **另一個歸因(同族, 而成因完全不同)**:我一度量到分母 **689** 支、R2 量到 **690**。
#      成因 = **另一個窗在我量的中途 commit 了一支新測試檔**(`cad1b37c` 06:04
#      新增 `scripts/placeholder-copy-guard.test.ts`)⇒ **分母自己在動。**
#      📌 **八窗共用一棵樹時, 分母是一個【時刻】的函數, 不是一個常數。**
#    ⚠️ **代價**:兩個不同作用域用同名變數時會【過度排除】⇒ 少報。
#       ⇒ ~~這把尺的偏誤方向是**保守**(寧可漏報, 不做假紅), 而那是刻意選的。~~
#       🔴🔴 **撤(R4)。這句話我寫過兩次, 兩次都被實跑證偽:**
#         R1 證偽第一次:`const rows = []` 與 `[...a,...b]` 被排除 ⇒ 漏掉的是**最確定**的那一族
#         R4 證偽第二次:`mask()` 的白名單缺口讓判定**兩個方向都動**(見下方 `mask()` 那條)
#       📌 **⇒ 這把尺的偏誤方向【未知, 未量】。**
#       📌 **而值得記的不是「我寫錯了」, 是【我寫的那句話本身沒有被任何東西驗過】** ——
#          自檢驗的是「它抓不抓得到那幾種形狀」, **沒有一格在驗「它錯的時候往哪邊錯」**。
#          ⇒ 一個關於量具偏誤方向的宣稱, 需要它自己的量測, 而它長得像一句設計說明。
# ⚠️ **它還會漏什麼**(選了全檔追之後仍然看不見的):
#    · 字面經由 helper 產生 —— `const cases = mk()` 而 `mk()` 回傳字面 ⇒ 判成真裸(假紅)
#    · ~~字面被 `.filter()` 過 ⇒ 判成真裸(假紅)~~ 🔴 **R2 撤:那不是漏, 那是對的** ——
#      `.filter()` 回得了空 ⇒ 它【就是】真裸(論證在 `_iterable_root` 的 docstring)。
#      📌 **同一支檔裡一處把它記成缺陷、一處記成修法** —— 而兩處都讀得通。
#    · import 進來的常數陣列 —— 它在【生產側】⇒ 判成真裸, **而那是對的**(生產改了它會變空)
#    · 🔴 **迴圈頭超過 200 字元 ⇒ 該格靜默不報**(`_in_loop` 的 `body[max(0,i-200):i]` 窗)
#      R1 實跑:for-index 頭塞 336 字元 ⇒ 得 `[]`(應命中)。**v1 既有、非本次引入**,
#      而它原本【不在這份自稱完整的盲區清單裡】—— 📌 **一份盲區清單自己的盲區, 沒有人在量。**
#    · 🔴 **`mask()` 不遮正則字面裡的 `{`** ⇒ 那個 `{` 被當成區塊開頭, head 往回取到
#      `gridRules.filter((r) => /(^|[;` ⇒ `LOOP_HEAD` 命中 ⇒ **假紅**。
#      實例 `apps/admin/src/app/design-tokens.test.ts:1518`(R2 開檔核出來的:三個 `expect`
#      其實一個都不在迴圈裡)。**v1 既有的盲區, 而它是拿掉過度排除【之後】才浮出來的** ——
#      📌 **一個洞被另一個洞蓋著, 補了上面那個, 下面那個才第一次見光。**
#      🔴🔴 **R4 撤掉我上面那句「偏誤方向是多報」—— 它是錯的, 而這是【第二次】。**
#      真正的觸發不是「正則裡的 `{`」, 是 `mask()` 的 `prev_sig` 白名單**缺 `>`(`=>` 後)與識別字尾
#      (`return` 後)**⇒ 那些位置的正則**整段沒遮**。corpus 有 **22 處**這種正則含 `{}()`/引號。
#      R4 把白名單補上重跑 ⇒ **5 支檔判定改變, 而【兩個方向都有】**:
#        `design-tokens.test.ts:1518` 的已知假紅**消失**(證實成因就在這裡)
#        `site-config-wiring.test.ts:177` **從沒報變成報** —— 正則裡的 `['"`]` 起了一個假字串、
#          把大段碼刷白 ⇒ 那一格是**靜默少報**
#      📌 **⇒ 這把尺的偏誤方向【未知】。我宣稱過兩次(R1 一次、R4 一次), 兩次都被證偽。**
#         **⇒ 本檔不再寫任何「它只會多報 / 只會少報」的句子。**
#      ⇒ 本輪不動 `mask()`:改它會同時搬動兩個方向的判定, 那是另一件事、要自己的驗收。
#
# 🔴 **另一個【已知、已量、刻意不修】的少報(R4 must-fix #1)—— 它比上面那條確定**
#    `_in_loop` 只看【最內層】那個 `{` ⇒ **內層跑字面的迴圈, 會把外層跑生產的迴圈整個蓋掉**
#    ⇒ 那一格**靜默消失**。R4 開檔核出兩格真的:
#      `apps/storefront/src/styles/brand-directory.test.ts:98`
#         內 `for (const bare of BARE)` 字面 / 外 `for (const r of rules)`, 而 `rules` 是解析 CSS 來的
#         ⇒ **解析出 0 條時整格全綠**
#      `apps/storefront/src/components/brand/BrandPageCategories.test.tsx:197`
#         內 `['<','>','&']` 字面 / 外 `BRAND_CONTENT`
#    ⚠️ **而修法【不是】「任一層是非字面迴圈就算」** —— R4 實跑:那樣會讓
#      `packages/domain/src/order/refund.test.ts:761` 變成**新的假紅**(它外層 `scenarios` 是測試寫死的)。
#    📌 **⇒ 這一格要的是【設計】不是一行修改, 而我在第四輪審查上, 不在這裡發明它。**
#    ⇒ 交給下一個人:上面兩個 `檔案:行號` 就是現成的重現。
#
# 🔴 **LOOP_HEAD 認不得的兩種迴圈(R4 nit, 靜默少報)**:`for await (const c of gen())` 與
#    `do { … } while (…)` ⇒ 兩者皆不匹配 ⇒ 該格不會進分母。**本清單原本沒有它們。**
# 🔴 **R1 抓到的四條 must-fix, 全部同一個方向:我的尺往【少報】錯。**
#    而檔頭原本寫「保守 = 只漏報不假紅」—— **那句在下面兩格上不成立**,
#    因為漏掉的正是【零迭代最確定】的那一族:
#      · `const rows = []`      ⇒ 空字面, 它保證零次迭代 ⇒ **最該報的, 被我排除了**
#      · `const x = [...a,...b]` ⇒ 展開生產陣列, 它可以是空的 ⇒ 同上
#    ⇒ 兩處都要求【中括號裡有東西, 而且第一個字不是 `.`】—— 與 `LOOP_LITERAL` 對稱。
#    📌 **兩道守同一件事的門, 形狀不一樣的那一刻就有一邊是錯的。**
LITERAL_VAR = re.compile(
    r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;\n]*?)?=\s*\[\s*(?!\s*\])(?!\.\.\.)[^\]\s]')
# ~~`_ITER_OF` / `_ITER_DOT`~~ **v3 之後已無呼叫點, 已刪**(R4 nit:留著會讓下一個人以為它們還在跑)。
# 括號內文(已經配對過)裡的 `of NAME` —— 尾端不再有 `)`
_ITER_OF_INNER = re.compile(r'\bof\s+([A-Za-z_$][\w$]*)\s*$')
# 呼叫左括號【前面】那一段的尾巴:必須是【裸識別字 . 方法名】, 前綴不准是 `)` `]` `.`
_FN_KEYWORD = re.compile(r'\bfunction(\s+[A-Za-z_$][\w$]*)?\s*$')
_RECEIVER = re.compile(
    r'(?:^|[^\w$.)\]])([A-Za-z_$][\w$]*)\s*\??\s*\.\s*(?:forEach|map|filter|some|every|flatMap)\s*$')
# 🔴 只認【裸識別字直接掛方法】—— 前面不准是 `)` `]` `.`(那代表它是一條鏈的結果)

def _iterable_root_at(body: str, i: int):
    """i = 那個 `{` 的位置。從它【往回配對括號】找出真正被跑的東西;抽不出來回 None。

    🔴 **R3 打死了兩個 regex 版本, 而它們錯在同一件事:拿【頭附近出現過的識別字】當【被跑的那個】。**
      v2-a `_ITER_DOT.findall` 取最後一個 ⇒ 抓到內層 callback 裡的名字
      v2-b `LOOP_HEAD.search(h)` 判種類 ⇒ 🔴 **它回的是【最左邊】那個 match**
           (pattern 尾巴 `[^{]*$` 會一路吃到底)⇒ for 之前先有一條 `.map(` 鏈就走錯分支
      實錘:那一版讓 corpus 81 ⇒ 83, 而**多出來的 2 格兩格都是假紅**
           (`brand-showcase-coverage.test.ts:143` 跑同格字面 `zeroProductBrands`;
            `BrandPageBrandWall.test.tsx:128` 根被抽成 `BRAND_CONTENT` —— **完全不是被跑的那個**)
      而它**同時**新開了少報的方向:`const n = zzqcases.map(x=>x).length; for (const c of prodRows)`
      ⇒ 抽到 `zzqcases` ⇒ 排除掉。📌 **一個「修正」可以在兩個方向同時變差, 而總數只動了 2。**
    ⇒ 正解不是換一個 regex, 是**不用 regex 找位置**:從 `{` 往回配對, 拿到真正的那一組括號。
    """
    j = i - 1
    while j >= 0 and body[j].isspace():
        j -= 1
    if j >= 0 and body[j] == ')':
        # `for (…) {` / `while (…) {` —— 往回配對到它自己的 `(`
        d, k = 0, j
        while k >= 0:
            if body[k] == ')':
                d += 1
            elif body[k] == '(':
                d -= 1
                if d == 0:
                    break
            k -= 1
        if k < 0:
            return None
        kw = re.search(r'([A-Za-z_$][\w$]*)\s*$', body[:k])
        name = kw.group(1) if kw else ''
        if name in ('for', 'while'):
            m = _ITER_OF_INNER.search(body[k + 1:j].rstrip())
            return (True, m.group(1) if m else None)
        if not _FN_KEYWORD.search(body[:k]):
            # 🔴 **R4 must-fix**:`if (…) {` / `switch (…) {` / `catch (…) {` 也是「`{` 前面是 `)`」。
            #    ~~舊碼回 None~~ ⇒ 上層讀成「這是迴圈, 只是抽不出根」⇒ **不排除 ⇒ 假紅**。
            #    實錘構造:`const n = rows.map(f).length; if (n) { expect(n).toBe(1); }`
            #    ⇒ `LOOP_HEAD` 咬到那條 `.map(` 鏈 ⇒ 整格被報成零迭代格, **而它根本不是迴圈**。
            #    📌 **「不是迴圈」與「是迴圈但抽不出根」用同一個回傳值 ⇒ 上層分不出來。**
            #    ⚠️ 而它**全 corpus 零命中** —— 潛伏的洞不會叫, 是 R4 構造出來的。
            return (False, None)
        # `function (p) {` 的 `(` 是【參數列】不是呼叫 ⇒ 落到下面往外再找一層
        k -= 1
    else:
        k = i - 1
    # callback(`… => {` 或 `function (…) {`)—— 往回找【還沒關上的 `(`】= 那個呼叫的左括號
    while True:
        d = 0
        while k >= 0:
            c = body[k]
            if c == ')':
                d += 1
            elif c == '(':
                if d == 0:
                    break
                d -= 1
            k -= 1
        if k < 0:
            return (True, None)
        m = _RECEIVER.search(body[:k])
        if m:
            return (True, m.group(1))
        if _FN_KEYWORD.search(body[:k]):
            # 🔴 **R4 must-fix**:`zzqcases.forEach(function (p) { … })` —— 舊碼從 `{` 往回只找到
            #    `function (p)` 那組括號就停了 ⇒ 抽不到 receiver ⇒ **字面變數的排除被 `function` 繞過**。
            #    📌 **箭頭函式與 function 關鍵字在【行為上】一模一樣, 而在【括號結構上】差一層。**
            k -= 1
            continue
        return (True, None)

def _in_loop(body: str, pos: int, litvars=frozenset()) -> bool:
    """從 pos 往回走, 找第一層【還沒關上的 {】, 看它的開頭是不是迴圈頭(且跑的不是字面)。"""
    d = 0; i = pos
    while i > 0:
        i -= 1; c = body[i]
        if c == '}': d += 1
        elif c == '{':
            if d == 0:
                head = body[max(0, i - 200):i]
                if not LOOP_HEAD.search(head):
                    return False
                if LOOP_LITERAL.search(head):
                    return False
                is_loop, root = _iterable_root_at(body, i)
                return is_loop and root not in litvars
            d -= 1
    return False

def loop_only_cells(src: str):
    """格內至少一個 expect, 而【全部】都在(非字面的)迴圈裡 ⇒ 回傳那些格的行號。"""
    m = mask(src); out = []
    litvars = frozenset(LITERAL_VAR.findall(m))          # 🔴 全檔, 不限本格
    for a, b in cells(m):
        body = body_of(m[a:b])
        hits = [x.start() for x in re.finditer(r'\bexpect\s*\(', body)]
        if hits and all(_in_loop(body, h, litvars) for h in hits):
            out.append(m.count('\n', 0, a) + 1)
    return out

# 🔴 自檢:九種形狀 + 兩個【不該命中】的。一把沒有自檢的尺, 與一把壞掉的尺印一樣的東西。
LOOP_WORLD = """import {it,expect} from 'vitest';
import { ZZQ_FROM_PROD } from './prod';
const zzqcases = [1, 2];
const zzqempty = [];
const zzqspread = [...zzqa, ...zzqb];
describe('d',()=>{
  it('A for-of',()=>{ for (const p of r) { expect(p).toBe(1); } });
  it('B for-index',()=>{ for (let i=1;i<r.length;i++) { expect(r[i]).toBe(1); } });
  it('C forEach',()=>{ r.forEach((p)=>{ expect(p).toBe(1); }); });
  it('D map-forEach',()=>{ r.map(f).forEach((v)=>{ expect(v).toBe(1); }); });
  it('E while',()=>{ while (q.length) { expect(q.pop()).toBe(1); } });
  it('F optional forEach',()=>{ r?.forEach((p)=>{ expect(p).toBe(1); }); });
  it('G for-in',()=>{ for (const k in obj) { expect(obj[k]).toBe(1); } });
  it('H nullish forEach',()=>{ (r ?? []).forEach((p)=>{ expect(p).toBe(1); }); });
  it('I 不該命中:迴圈外也有斷言',()=>{ expect(r).toHaveLength(3); for (const p of r) { expect(p).toBe(1); } });
  it('J 不該命中:根本沒有迴圈',()=>{ expect(r).toBe(1); });
  it('K 不該命中:跑的是字面陣列',()=>{ for (const m of ['a','b']) { expect(m).toBe(1); } });
  it('L 不該命中:字面陣列存進變數(v2 補的那一族)',()=>{ for (const c of zzqcases) { expect(c).toBe(1); } });
  it('M 不該命中:字面變數 forEach',()=>{ zzqcases.forEach((c)=>{ expect(c).toBe(1); }); });
  it('N 該命中:跑的是生產函式回傳(負對照 —— 它與 L 只差【誰產的】)',()=>{ for (const c of zzqbuild(1)) { expect(c).toBe(1); } });
  it('O 該命中:跑的是 import 進來的常數(生產側會變空)',()=>{ for (const c of ZZQ_FROM_PROD) { expect(c).toBe(1); } });
  it('P 該命中:空字面陣列(R1 must-fix —— 它保證零迭代, 最該報)',()=>{ for (const c of zzqempty) { expect(c).toBe(1); } });
  it('Q 該命中:展開生產陣列(R1 must-fix —— 展開的結果可以是空的)',()=>{ for (const c of zzqspread) { expect(c).toBe(1); } });
  it('R 該命中:字面被 filter 過(R1 must-fix —— filter 回得了空)',()=>{ for (const c of zzqcases.filter(f)) { expect(c).toBe(1); } });
  it('S 該命中:鏈的結果 forEach(R1 must-fix —— 舊碼抽到內層 callback 的 zzqcases)',()=>{ zzqprod.filter((x)=>zzqcases.some((c)=>c===x)).forEach((p)=>{ expect(p).toBe(1); }); });
  it('T 不該命中:for 之前先有一條 .map 鏈, 而跑的是字面(R3 —— 前一版在這裡假紅)',()=>{ const q = zzqcases.map((x)=>x); for (const c of zzqcases) { expect(c).toBe(q.length); } });
  it('U 該命中:for 之前先有一條 .map 鏈, 而跑的是生產(R3 —— 前一版在這裡少報)',()=>{ const n = zzqcases.map((x)=>x).length; for (const c of zzqprod) { expect(c).toBe(n); } });
  it('V 不該命中:根本不是迴圈是 if(R4 —— 前一版被 LOOP_HEAD 咬到 .map 鏈而假紅)',()=>{ const n = zzqprod.map((x)=>x).length; if (n) { expect(n).toBe(1); } });
  it('W 不該命中:function 回呼跑字面(R4 —— 前一版被 function 那層括號繞過)',()=>{ zzqcases.forEach(function (p) { expect(p).toBe(1); }); });
  it('X 該命中:function 回呼跑生產(W 的對照 —— 只差【誰產的】)',()=>{ zzqprod.forEach(function (p) { expect(p).toBe(1); }); });
});
"""

def _want_loop():
    """期望值【從世界裡的標籤推】, 不手維護 —— 手維護的清單在加一格時會安靜地爛掉。"""
    return [i for i, ln in enumerate(LOOP_WORLD.split('\n'), 1)
            if "it('" in ln and '不該命中' not in ln]

def selftest_loop(verbose=True):
    got = loop_only_cells(LOOP_WORLD)
    want = _want_loop()
    ok = got == want
    if verbose:
        print('  Ⓓ 偵測器自檢:期望 %s · 實得 %s ⇒ %s' % (want, got, 'PASS' if ok else '🔴 FAIL'))
        if not ok:
            print('  🔴 標【不該命中】的是負對照 —— 它們命中 = 尺太寬')
            print('  🔴 而 N/O 是【反向負對照】—— 它們不命中 = 尺被 v2 的排除吃掉太多')
    return ok

def selftest_loop_directions(verbose=True):
    """🔴 **兩發方向探針** —— 證的不是「排除會叫」, 是【排除會停】。

    R1 點名:這兩發原本只活在 commit body 裡 ⇒ **下一次改寫就沒了**。
    📌 **單方向的負對照只證明它會叫, 不證明它會停** —— 而一個恆真的排除也會叫。
    """
    # 🔴 **期望值【從世界推】, 不手寫** —— 上一版寫死 `== 2` / `== 1`, 而我一加兩格它就紅了。
    #    📌 **那正是本檔自己剛立的那條:手維護的期望值在加一格時會爛。**
    #       而它這次是**大聲**爛的(紅)—— 下一次可能是安靜的。
    lines = LOOP_WORLD.split('\n')
    exp1 = {i for i, l in enumerate(lines, 1)
            if "it('" in l and '不該命中' in l and 'zzqcases' in l}   # 靠 zzqcases 被排除的那些
    exp2 = {i for i, l in enumerate(lines, 1) if "it('N " in l}        # 只有 N 該消失
    base = set(loop_only_cells(LOOP_WORLD))
    # ① 拿掉那個字面宣告 ⇒ 靠它被排除的格必須【全部變成命中】(否則排除與宣告無關 = 恆真)
    w1 = LOOP_WORLD.replace('const zzqcases = [1, 2];', 'const zzqcases = zzqmake();')
    got1 = set(loop_only_cells(w1)) - base
    # ② 把 N 的來源從生產函式換成字面變數 ⇒ N 必須【消失】, 而【只有 N】(否則排除沒在看來源)
    w2 = LOOP_WORLD.replace('for (const c of zzqbuild(1))', 'for (const c of zzqcases)')
    got2 = base - set(loop_only_cells(w2))
    ok = (got1 == exp1) and (got2 == exp2) and bool(exp1) and bool(exp2)
    if verbose:
        print('  方向① 拿掉字面宣告 ⇒ 期望 %s · 實得 %s ⇒ %s'
              % (sorted(exp1), sorted(got1), 'ok' if got1 == exp1 else '🔴'))
        print('  方向② 換成字面來源 ⇒ 期望 %s · 實得 %s ⇒ %s'
              % (sorted(exp2), sorted(got2), 'ok' if got2 == exp2 else '🔴'))
        if not exp1 or not exp2:
            print('  🔴 期望集合是空的 ⇒ 那個相等【恆真】, 探針已失效')
    return ok

def naked_cells(src: str):
    """回傳 (裸格行號 list, 只有 unknown 斷言的格行號 list)"""
    m = mask(src)
    line_of = lambda off: m.count('\n', 0, off) + 1
    naked, unknown_only = [], []
    for a, b in cells(m):
        ks = [kind(x) for x in statements(body_of(m[a:b]))]
        n = ks.count('neg'); p = ks.count('pos'); u = ks.count('unknown')
        if n > 0 and p == 0: naked.append(line_of(a))
        elif n == 0 and p == 0 and u > 0: unknown_only.append(line_of(a))
    return naked, unknown_only

def cells_with_unknown(src: str):
    """格內含有 unknown 斷言的格行號 —— 給合計行拆數用(R2 nit)。"""
    m = mask(src); out = []
    for a, b in cells(m):
        ks = [kind(x) for x in statements(body_of(m[a:b]))]
        if 'unknown' in ks: out.append(m.count('\n', 0, a) + 1)
    return out

# ── 自檢 ────────────────────────────────────────────────────────────────────
# 🔴 **v1 的根因就在這一段**:三個世界全是單格、單行、從第 1 行起
#    ⇒ 「區塊邊界」與「行號」兩條邏輯零覆蓋, 兩發突變(行號恆 1 / 邊界失效)自檢皆 True。
# ⇒ v2 的世界一律【多格、有前置行、格與格之間有東西、最後一格後面還有 helper】,
#   而且**每個世界的期望值是一串行號**, 不是 [] vs [] —— 期望值相同的世界不算兩個世界。
WORLDS = [
    # (名稱, 原始碼, 期望裸格行號, 期望 unknown-only 行號)
    ('W1 註解裡有正向斷言 ⇒ 仍應裸;而有真錨的那格不裸', '''import { it, expect } from 'vitest';

describe('x', () => {
  it('a', () => {
    // 這裡提到 expect(x).toContain('y') 但那是註解
    expect(c.textContent).not.toContain('z');
  });

  it('b', () => {
    expect(c.querySelectorAll('tr').length).toBeGreaterThan(0);
    expect(c.textContent).not.toContain('z');
  });
});
''', [4], []),

    # 🔴 這個世界殺「邊界吃到下一個 it( 或檔尾」那發突變(R5 MF②)
    ('W2 最後一格後面有 helper 的 expect ⇒ 不得被當成它的錨', '''import { it, expect } from 'vitest';

describe('y', () => {
  it('c', () => {
    expect(c.textContent).not.toContain('z');
  });
});

function helper() {
  expect(1).toBe(1);
}
''', [4], []),

    # 🔴 這個世界殺「兩格之間的 afterEach 算給前一格」那發(同 MF②)
    ('W3 格與格之間的 afterEach 不得算進前一格', '''import { it, expect } from 'vitest';

describe('z', () => {
  it('d', () => {
    expect(spy).not.toHaveBeenCalled();
  });

  afterEach(() => {
    expect(cleanupSpy).toHaveBeenCalled();
  });

  it('e', () => {
    expect(c.querySelector('form')).not.toBeNull();
    expect(c.textContent).not.toContain('q');
  });
});
''', [4], []),

    # 🔴 這個世界殺 MF③(剝註解順序)與 MF④(字串裡的 //)
    ('W4 `// … /*` 與字串裡的 `//` 都不得吃掉後面的碼', '''import { it, expect } from 'vitest';

describe('w', () => {
  it('f', () => {
    // TODO: /* 舊寫法
    expect(a.href).toBe('//cdn/x');
    expect(c.textContent).not.toContain('z');
  });

  it('g', () => {
    expect(c.textContent).not.toContain('z');
  });
});
''', [10], []),

    # 🔴 這個世界殺 MF①(字集窄)—— 五種真裸格 v1 全部印 0
    ('W5 五種 v1 漏掉的裸格形狀', '''import { it, expect } from 'vitest';

describe('v', () => {
  it('h', () => {
    expect(el.hidden).toBeFalsy();
  });

  it('i', () => {
    expect(find(x)).toBeUndefined();
  });

  it('j', () => {
    expect(el).not.toHaveAttribute('disabled');
  });

  it('k', () => {
    expect(el).not.toBeVisible();
  });

  it('l', () => {
    expect(list.some((x) => x.bad)).toBe(false);
  });
});
''', [4, 8, 12, 16, 20], []),

    # 🔴 semi:false(Prettier 無分號)—— v1 整格塌成一則 ⇒ 有真錨的被報成裸的
    ('W6 無分號風格:有錨的不得被報成裸的', '''import { it, expect } from 'vitest'

describe('u', () => {
  it('m', () => {
    expect(c.querySelectorAll('tr').length).toBeGreaterThan(0)
    expect(c.textContent).not.toContain('z')
  })

  it('n', () => {
    expect(c.textContent).not.toContain('z')
  })
})
''', [9], []),

    # 🔴 方向決定裸不裸:同一個 API, 兩個方向不同命(v2 改寫時漏掉, 靠 v1↔v2 比對抓回)
    ('W8 every/some 的方向', """import { it, expect } from 'vitest';

describe('s', () => {
  it('q', () => {
    expect(boxes.every((b) => !b.disabled)).toBe(true);
  });

  it('r', () => {
    expect(boxes.some((b) => b.bad)).toBe(true);
  });
});
""", [4], []),

    # 🔴 it.each 是【兩組括號】的鏈式呼叫 —— 沒有這個世界, 邊界切在本體之前而完全沒有形狀
    #    (R2 must-fix;真 repo 上安靜少報 66 格 / 40 支檔)
    ('W9 it.each 鏈式呼叫的本體要掃得到', """import { it, expect } from 'vitest';

describe('e', () => {
  it.each([
    ['a', 1],
    ['b', 2],
  ])('%s 不得出現', (label) => {
    expect(c.textContent).not.toContain(label);
  });

  it.each([['x']])('%s 有錨', (label) => {
    expect(c.querySelectorAll('tr').length).toBeGreaterThan(0);
    expect(c.textContent).not.toContain(label);
  });
});
""", [4], []),

    # 🔴 v2 自己長出來的回歸:換行接 `.toBe(…)` 被切成兩則 ⇒ 正向錨消失(R2 抓到, v1 不會犯)
    ('W10 換行接續的 .toBe 不得被切斷', """import { it, expect } from 'vitest';

describe('m', () => {
  it('帶訊息的多行 expect 仍算正向錨', () => {
    expect(el.getAttribute('viewBox'), '訊息')
      .toBe('0 0 24 24');
    expect(c.textContent).not.toContain('z');
  });

  it('沒有錨的那格', () => {
    expect(c.textContent).not.toContain('z');
  });
});
""", [10], []),

    # 🔴 2026-08-28 第二批核出來的字集缺口:`toHaveBeenCalled\\b` 讓 …Times / …With 不匹配
    #    ⇒ 整格只有那種正向斷言時被報成裸的。全 repo 補完之後少報 84 格假紅(1454 ⇒ 1370)。
    ('W11 toHaveBeenCalledTimes 這一族算正向', """import { it, expect } from 'vitest';

describe('n', () => {
  it('s', () => {
    expect(state).toBeUndefined();
    expect(mocks.doIt).toHaveBeenCalledTimes(1);
  });

  it('t', () => {
    expect(state).toBeUndefined();
  });
});
""", [9], []),

    # 負對照:沒有任何斷言 / 只有本尺不認得的斷言
    ('W7 零斷言不報;只有 unknown 的另列一堆', '''import { it, expect } from 'vitest';

describe('t', () => {
  it('o', () => {
    render(<X />);
  });

  it('p', () => {
    expect(x).toSatisfyCustomMatcher();
  });
});
''', [], [8]),
]

def selftest(verbose=True):
    ok = True
    for name, src, want_naked, want_unknown in WORLDS:
        got_n, got_u = naked_cells(src)
        good = (got_n == want_naked and got_u == want_unknown)
        ok = ok and good
        if verbose:
            print(('  ok  ' if good else '  FAIL') + f'  {name}')
            if not good:
                print(f'        裸格 期望 {want_naked} 得到 {got_n}')
                print(f'        unknown 期望 {want_unknown} 得到 {got_u}')
    return ok

def _probe(g, patches, label, expect_green, results):
    """換手術刀跑一發自檢, **無論如何都還原**(R2 nit:原版 selftest 拋例外時 globals 不還原
    ⇒ 之後每一發都跑在被動過手腳的模組上, 而輸出看起來完全正常)。"""
    saved = {k: g[k] for k in patches}
    try:
        g.update(patches)
        green = selftest(verbose=False)
    finally:
        g.update(saved)
    results.append((label, green, expect_green))

def selfcheck_of_selfcheck(verbose=True):
    """🔴 **對自檢本身打兩發突變** —— R5 就是拿這兩發證明 v1 的自檢沒有判別力。

    v1 的問題不是「世界不夠多」, 是**世界不夠難**:三個世界全是單格單行,
    所以「行號」與「區塊邊界」壞掉時它們印不出差別。
    ⇒ 這裡直接把那兩個壞法接上去, **自檢必須紅**;它還印綠就代表世界又退化了。
    (v1 那條「期望值要互不相同」的檢查作廢:那是形狀, 不是判別力 ——
     三個世界剛好期望同一串行號完全可以是對的。)
    """
    results = []
    real_cells = cells
    # 突變 A:行號永遠印 1(對應 R5 的 out.append(1))
    g = globals()
    orig_naked = g['naked_cells']
    def naked_lineno_broken(src):
        n, u = orig_naked(src)
        return ([1] * len(n), u)
    g['naked_cells'] = naked_lineno_broken
    results.append(('突變A 行號恆 1', selftest(verbose=False), False))
    g['naked_cells'] = orig_naked
    # 突變 B:區塊邊界一路吃到檔尾(對應 R5 的 end = len(lines))
    # 🔴 **這一發【單獨打】殺不掉自檢, 而那是量到的、不是猜的**:
    #    邊界有【兩道】—— cells() 的括號配對 + body_of() 的大括號配對;
    #    打壞其中一道, 另一道接住。⇒ 所以下面 B3 兩道一起打。
    #    ⚠️ 這一格本身就是一則:**一個「還是綠的」可以是【兩道守門】而不是【沒有守門】**,
    #       而這兩者在輸出上長一樣 —— 分得開它們的是「再打第二刀」。
    real_body = body_of
    def cells_broken(masked):
        return [(a, len(masked)) for a, _ in real_cells(masked)]
    g['cells'] = cells_broken
    b1 = selftest(verbose=False)
    g['cells'] = real_cells
    results.append(('突變B1 只打壞 cells 邊界', b1, True))
    g['body_of'] = lambda seg: seg[seg.find('{') + 1:] if '{' in seg else seg
    b2 = selftest(verbose=False)
    g['body_of'] = real_body
    results.append(('突變B2 只打壞 body_of 括號配對', b2, True))
    g['cells'] = cells_broken
    g['body_of'] = lambda seg: seg[seg.find('{') + 1:] if '{' in seg else seg
    b3 = selftest(verbose=False)
    g['cells'] = real_cells; g['body_of'] = real_body
    results.append(('突變B3 兩道邊界一起打壞', b3, False))
    # 🔴 探針 C/D:把 R2 抓到的那兩個病【接回去】—— 沒有它們, W9/W10 只是兩個會過的世界,
    #    而「會過」證不了它們有判別力(這正是 v1 那三個世界的死法)。
    real_st = statements
    def cells_first_paren_only(masked):
        out = []
        for m in re.finditer(r'(?:^|[\s;{}])(it|test)(\.\w+)?\s*\(', masked, re.M):
            i = masked.index('(', m.end() - 1) if masked[m.end()-1] != '(' else m.end() - 1
            j = _match_paren(masked, i)
            out.append((m.start(1), min(j + 1, len(masked))))
        return out
    g['cells'] = cells_first_paren_only
    c1 = selftest(verbose=False)
    g['cells'] = real_cells
    results.append(('突變C it.each 只配對第一組括號(R2 的 must-fix)', c1, False))
    def statements_cut_every_newline(seg):
        outs = []; buf = []; d = 0
        for ch in seg:
            if ch in '([{': d += 1
            elif ch in ')]}': d -= 1
            if (ch == ';' or ch == '\n') and d <= 0:
                outs.append(''.join(buf)); buf = []
            else: buf.append(ch)
        outs.append(''.join(buf))
        return [re.sub(r'\s+', ' ', x) for x in outs]
    g['statements'] = statements_cut_every_newline
    d1 = selftest(verbose=False)
    g['statements'] = real_st
    results.append(('突變D 換行一律切(我 v2 自己長出來的回歸)', d1, False))
    ok = True
    for name, observed_green, expect_green in results:
        good = (observed_green == expect_green)
        ok = ok and good
        if verbose:
            # 🔴 標籤由【觀測值】印, 不由判定印 —— 第一版我把 B1/B2 的觀測值反轉之後
            #    拿去印標籤, 於是兩格明明是綠的而畫面上印「紅(對)」。
            #    (常載紀律:輸出的標籤要由結果決定。同一天第三次踩。)
            seen = '仍綠' if observed_green else '轉紅'
            want = '(預期仍綠 = 另一道接住了)' if expect_green else '(必須紅)'
            print(('  ok  ' if good else '  FAIL') + f'  {name} ⇒ 自檢{seen} {want}')
    return ok

if __name__ == '__main__':
    args = [a for a in sys.argv[1:]]
    if not args or args[0] in ('-h', '--help'):
        print(__doc__); sys.exit(0)
    # `--selftest` = 只跑自檢與探針, 不掃檔。給 lint-staged 當守門用:
    # 🔴 這一行的判別力**不是形式** —— 任何一個世界或任何一發探針失效, 它就 rc=1。
    #    (`scripts-whitelist-gate` 自己的訊息寫著:它驗不出那行命令有沒有判別力,
    #      寫 `true` 一樣過得了 ⇒ **那一格靠人**, 而這裡就是那個人。)
    selftest_only = args[0] == '--selftest'
    if selftest_only: args = []
    # 🔴 `--matchers <檔...>` = 把盲區Ⓑ 變成【可以列出來的集合】。
    #    成因:2026-08-28 一個晚上撞到【兩次】字集缺口
    #    (第一次 toHaveBeenCalledTimes ⇒ 84 格假紅;第二次 toMatchObject ⇒ repo 有 419 次)。
    #    ⇒ 補名字是治那一次;**這一格是讓下一次【被看見】**:
    #      它印出「出現在 expect 敘述裡、而 NEG/POS 都沒分類」的 matcher 與次數。
    #    ⚠️ 它**不會**告訴你那些該算正向還是負向 —— 那要人判。
    #      它只保證:**你不會因為不知道它存在而漏掉它。**
    if args and args[0] == '--matchers':
        from collections import Counter
        known = set(re.findall(r'to[A-Z]\w*', POS_RE)) | set(re.findall(r'to[A-Z]\w*', ' '.join(NEG))) | {'toBeNull'}
        c = Counter()
        for f in args[1:]:
            for st in statements(mask(io.open(f, encoding='utf-8').read())):
                if 'expect' not in st: continue
                for mt in re.finditer(r'\.(to[A-Z]\w*)\s*\(', st): c[mt.group(1)] += 1
        rest = [(n, k) for k, n in c.most_common() if k not in known]
        print(f'字集已涵蓋 {len(known & set(c))} 種 · 出現而未分類 {len(rest)} 種')
        for n, k in rest: print(f'{n:6d}  {k}')
        print('🔴 未分類的會落進 unknown, 而 unknown 不算 pos ⇒ 只有那種斷言的格會被報成【裸的】')
        print('⚠️ 而清單裡會混進【不是 matcher 的方法】(toISOString / toUpperCase / toString …)')
        print('   —— 它們出現在 `expect(d.toISOString()).toBe(…)` 這種句子裡。')
        print('   📌 這一格本工具**分不出來**, 要人看一眼:名字像 matcher 的才要補進字集。')
        sys.exit(0)
    print('=== 自檢(每個世界的期望值是一串行號, 不是 [] vs []) ===')
    if not selftest():
        print('🔴 自檢沒過 ⇒ 本次結果作廢'); sys.exit(1)
    print('=== Ⓓ 偵測器自檢(九種形狀 + 三個負對照)===')
    if not selftest_loop():
        print('🔴 Ⓓ 自檢沒過 ⇒ 本次結果作廢'); sys.exit(1)
    print('=== Ⓓ 排除的【兩個方向】(單方向只證明它會叫, 不證明它會停)===')
    if not selftest_loop_directions():
        print('🔴 Ⓓ 排除不是雙向的 ⇒ 本次結果作廢'); sys.exit(1)
    print('=== 自檢的自檢(對自檢打兩發突變, 它【必須】紅)===')
    if not selfcheck_of_selfcheck():
        print('🔴 自檢自己沒有判別力 ⇒ 本次結果作廢'); sys.exit(1)
    if selftest_only:
        print('=== --selftest:自檢與探針全過 ==='); sys.exit(0)
    print('=== 已知盲區:Ⓐ抽成具名函式的錨看不見(誤報) Ⓑ字集是人寫的, unknown 另列 ===')
    # 🔴 把盲區Ⓑ 從「檔頭的一句話」變成【每一次輸出都會看到的東西】。
    #    數字跟著走:2026-08-28 補四種正向斷言 ⇒ 全 repo 少報 84 格假紅(母體 1454)。
    print(f'=== 字集規模:NEG {len(NEG) + 3} 條 · POS {POS_RE.count("|") + 1} 條 · 最後更新 2026-08-28 ===')
    print('=== 🔴 不在字集裡的斷言會落進 unknown, 而【unknown 不算 pos】⇒ 那一格會被報成裸的 ===')
    print('=== ⇒ 看到某格被報, 第一個念頭是【去看它的斷言在不在字集裡】(上次補漏 = 84 格假紅) ===')
    print('=== 🔴 Ⓒ 本尺只認【expect 型】的錨:`if (…) throw new Error(…)` 這種擲錯型守門看不見 ===')
    print('=== 🔴 Ⓓ `for (const x of xs) expect(x)…`:空集合零次迭代 ⇒ 零斷言 ⇒ 綠(少報)===')
    print('===    2026-08-29 起【另列】(見下方 Ⓓ 那一節)—— 🔴 **不是修好, 是縮窄** ===')
    # 🔴 **R1 must-fix(鐵則 11 字面 vs 事實)**:這一行原本寫死「136 格 / 87 支檔」,
    #    而那是 2026-08-28 v1 的產出 —— **改完尺之後它就是死數, 而印它的是工具自己。**
    #    📌 **一個由工具印出來的過期數字, 比寫在文件裡的更危險 —— 讀的人以為那是這一次量到的。**
    #    ⇒ 不寫死。要現值就跑那行命令, **讓它自己印**。
    print('===    縮窄了多少 ⇒ 不寫死, 而是【本次執行的最後一行】當場印(見輸出結尾的 Ⓓ 合計)===')
    print('===    🔴 而它仍然看不見:①`if (…) expect(…)`(刻意不收:空世界是「條件不成立」, 收了會假紅)===')
    print('===    ②抽成具名 helper 的迴圈 ③字面陣列以外「不可能為空」的來源(它會誤報那些)===')
    print('===    (同一件事寫成 `every(...).toBe(true)` 本尺抓得到 ⇒ **同病兩種寫法, 只認一種**)===')
    print('===    (它與Ⓐ不同:Ⓐ 的錨是 expect 只是不在這格;Ⓒ 的錨根本不長那個樣子, --matchers 也接不到)===')
    print('=== ⇒ 每一筆命中都要開檔核。本尺【不宣稱】不少報。 ===')
    # 🔴 **R3 nit**:重複路徑會讓合計與事實不符(實跑同一支檔餵兩次 ⇒ 印「8 格 / 2 支檔」
    #    而事實是 4 格 / 1 支)。📌 **那個數字是當場算的, 而它算的是【我餵了幾條】不是【有幾支檔】。**
    seen = set(); args = [f for f in args if not (f in seen or seen.add(f))]
    tot = tu = tmix = td = tdf = 0
    dmix = 0
    for f in args:
        src = io.open(f, encoding='utf-8').read()
        n, u = naked_cells(src)
        mix = cells_with_unknown(src)
        d = loop_only_cells(src)                      # 🔴 R2 must-fix:本行以前【不存在】
        tot += len(n); tu += len(u); tmix += len(set(n) & set(mix))
        td += len(d); tdf += (1 if d else 0); dmix += len(set(d) & set(n))
        if n: print(f"{len(n):3d}  {f}  {[str(x) for x in n]}")
        if u: print(f"  ?  {f}  只有 unknown 斷言的格:{[str(x) for x in u]}")
        if d: print(f"  Ⓓ  {f}  零迭代就綠的格:{[str(x) for x in d]}")
    # 🔴 合計拆兩個數(R2 nit):一個「裸」如果格內【還有 unknown 斷言】,
    #    那個裸是**靠「unknown 不算 pos」撐出來的** —— 它的信心度與「格內只有負向」不同。
    #    合成一個數字的話, 兩種信心度混在同一格而讀的人分不出來。
    print(f'=== 裸格合計 {tot}(其中 {tmix} 格【格內還有 unknown】⇒ 信心度較低)'
          f' · 只有 unknown 的格 {tu} ===')
    # 🔴🔴 **R2 must-fix ——【這一段以前根本不存在】**
    #    `loop_only_cells()` 在本檔寫好了、有自檢、有雙向負對照, 而它**從來沒有被掃檔迴圈呼叫過**
    #    ⇒ Ⓓ 那一族的數字**從來沒有被這支工具印出來過**, 只活在人手動 import 它的時候。
    #    🔴 而 R1 那一輪我「修好」的方式是:把 banner 的死數換成一行【叫人自己跑】的命令 ——
    #      而那行命令 `| grep -c Ⓓ` 當時會印 **6**, 那 6 行全是 banner 與自檢自己的輸出, **零筆是格**。
    #    📌 **⇒ 我把「一個過期的真數字」換成了「一個當場算出來的假數字」** ——
    #       而後者更糟:**它長得像剛量的**, 正是那行註解自己要防的形狀。
    #    ⇒ 真正的修法不是改那行字, 是**把尺接上**。
    # 🔴 **R3 nit**:舊 banner 有「其中 N 格本來就被判為裸格」而新的漏了 ⇒ 讀的人會把兩個合計相加。
    print(f'=== Ⓓ 零迭代就綠的格 {td} 格 / {tdf} 支檔(分母 {len(args)} 支去重後)'
          f' · 其中 {dmix} 格【本來就在上面的裸格合計裡】⇒ 🔴 兩個數不可以相加 ===')
    print('===    🔴 這個數是【本次執行當場算的】, 不是寫死的 ===')
