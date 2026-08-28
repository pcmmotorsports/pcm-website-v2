#!/usr/bin/env python3
"""掃出「裸的負向斷言」格 —— 一個 it()/test() 區塊裡負向斷言 >=1 而正向斷言 = 0。

用法:naked-cells.py <檔> [<檔> ...]   ·   --help 印本說明

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
POS_RE = (r'\.(toBe|toEqual|toContain|toHaveBeenCalled|toMatch|toBeGreaterThan|'
          r'toBeGreaterThanOrEqual|toBeTruthy|toBeInTheDocument|toHaveLength|toThrow|'
          r'toStrictEqual|toBeDefined|toBeLessThan|toBeCloseTo|toHaveAttribute|'
          r'toHaveClass|toBeVisible|toBeChecked)\b')

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
       = 切在本體之前;補好之後**多報出 66 格真裸格 / 40 支檔**。
       ⚠️ 而那 66 格**不在 naked、也不在 unknown** ⇒ 它們在輸出上**完全沒有形狀**。
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
    print('=== 自檢(每個世界的期望值是一串行號, 不是 [] vs []) ===')
    if not selftest():
        print('🔴 自檢沒過 ⇒ 本次結果作廢'); sys.exit(1)
    print('=== 自檢的自檢(對自檢打兩發突變, 它【必須】紅)===')
    if not selfcheck_of_selfcheck():
        print('🔴 自檢自己沒有判別力 ⇒ 本次結果作廢'); sys.exit(1)
    if selftest_only:
        print('=== --selftest:自檢與探針全過 ==='); sys.exit(0)
    print('=== 已知盲區:Ⓐ抽成具名函式的錨看不見(誤報) Ⓑ字集是人寫的, unknown 另列 ===')
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
