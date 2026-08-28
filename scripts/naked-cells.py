#!/usr/bin/env python3
"""掃出「裸的負向斷言」格 —— 一個 it()/test() 區塊裡負向斷言 >=1 而正向斷言 = 0。

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

def _in_loop(body: str, pos: int) -> bool:
    """從 pos 往回走, 找第一層【還沒關上的 {】, 看它的開頭是不是迴圈頭(且不是字面陣列)。"""
    d = 0; i = pos
    while i > 0:
        i -= 1; c = body[i]
        if c == '}': d += 1
        elif c == '{':
            if d == 0:
                head = body[max(0, i - 200):i]
                if LOOP_HEAD.search(head):
                    return not LOOP_LITERAL.search(head)
                return False
            d -= 1
    return False

def loop_only_cells(src: str):
    """格內至少一個 expect, 而【全部】都在(非字面的)迴圈裡 ⇒ 回傳那些格的行號。"""
    m = mask(src); out = []
    for a, b in cells(m):
        body = body_of(m[a:b])
        hits = [x.start() for x in re.finditer(r'\bexpect\s*\(', body)]
        if hits and all(_in_loop(body, h) for h in hits):
            out.append(m.count('\n', 0, a) + 1)
    return out

# 🔴 自檢:九種形狀 + 兩個【不該命中】的。一把沒有自檢的尺, 與一把壞掉的尺印一樣的東西。
LOOP_WORLD = """import {it,expect} from 'vitest';
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
});
"""

def selftest_loop(verbose=True):
    got = loop_only_cells(LOOP_WORLD)
    want = [3, 4, 5, 6, 7, 8, 9, 10]        # A-H 命中 · I/J/K 不得命中
    ok = got == want
    if verbose:
        print('  Ⓓ 偵測器自檢:期望 %s · 實得 %s ⇒ %s' % (want, got, 'PASS' if ok else '🔴 FAIL'))
        if not ok:
            print('  🔴 I/J/K 是負對照(迴圈外有斷言 / 沒有迴圈 / 跑字面陣列)—— 它們命中就是尺太寬')
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
    print('===    縮窄的量:全分母 689 支上, 新列出 136 格 / 87 支檔(其中 97 格本來就被判為裸格)===')
    print('===    🔴 而它仍然看不見:①`if (…) expect(…)`(刻意不收:空世界是「條件不成立」, 收了會假紅)===')
    print('===    ②抽成具名 helper 的迴圈 ③字面陣列以外「不可能為空」的來源(它會誤報那些)===')
    print('===    (同一件事寫成 `every(...).toBe(true)` 本尺抓得到 ⇒ **同病兩種寫法, 只認一種**)===')
    print('===    (它與Ⓐ不同:Ⓐ 的錨是 expect 只是不在這格;Ⓒ 的錨根本不長那個樣子, --matchers 也接不到)===')
    print('=== ⇒ 每一筆命中都要開檔核。本尺【不宣稱】不少報。 ===')
    tot = tu = tmix = 0
    for f in args:
        src = io.open(f, encoding='utf-8').read()
        n, u = naked_cells(src)
        mix = cells_with_unknown(src)
        tot += len(n); tu += len(u); tmix += len(set(n) & set(mix))
        if n: print(f"{len(n):3d}  {f}  {[str(x) for x in n]}")
        if u: print(f"  ?  {f}  只有 unknown 斷言的格:{[str(x) for x in u]}")
    # 🔴 合計拆兩個數(R2 nit):一個「裸」如果格內【還有 unknown 斷言】,
    #    那個裸是**靠「unknown 不算 pos」撐出來的** —— 它的信心度與「格內只有負向」不同。
    #    合成一個數字的話, 兩種信心度混在同一格而讀的人分不出來。
    print(f'=== 裸格合計 {tot}(其中 {tmix} 格【格內還有 unknown】⇒ 信心度較低)'
          f' · 只有 unknown 的格 {tu} ===')
