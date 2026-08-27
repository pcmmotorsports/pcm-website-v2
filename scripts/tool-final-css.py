#!/usr/bin/env python3
"""片0 · 修好的尺 —— 從 CSS / OD 產物算「真正生效的最終值」,不是「宣告過的值」。

## 這支檔解什麼問題
CSS 會層疊(同一個 selector/token 可能被宣告很多次,後面的贏;`@media` 底下的是另一個世界)。
單純 grep 一個屬性或 token 只會抓到【第一次出現】,不一定是【贏的那一次】——
這支檔用大括號配對走訪整份 CSS,回傳「每個 (at-rule 脈絡, selector) 底下,每個屬性最終贏家的值」。

## 三個函式各做什麼
- `walk(css, context)`:核心走訪器。逐一找 `{...}` 配對,`@media`/`@supports` 會展開遞迴
  (它們的內容仍是選擇器規則);其餘 at-rule(`@page`/`@font-face`/`@keyframes`)不展開。
  吐 `(context, selector, 該規則的宣告內文)`。
- `final_values_css(css)`:吃純 CSS 檔(例 globals.css),回傳
  `{(context, selector): {property: 最終值}}`,同 key 後面的宣告覆蓋前面的。
- `final_values(html)`:吃含 `<style>` 標籤的 HTML(例 OD 產物),先按文件順序抽出所有
  `<style>` 內容接起來,再吃給 `walk()`。

## 自檢怎麼跑
`python3 tool-final-css.py [目標檔...]`(不給參數預設吃 OD 的兩份訂單/出貨預覽 html)。
`selfcheck(path)` 跑六組世界(A-F,每組都有正向與負向對照),全過印「全部自檢通過。」、
任一格不過會標 ❌ 並列出想要/拿到的值、整體 exit code 1。

## 已知盲區(截至 2026-08-24)
1. **`@import`/`@custom-variant`/`@charset` 等零大括號 at-rule 陳述式**(2026-08-24 cf 線抓到、
   已修,見下方世界 F):曾經會把緊接在後面的選擇器整塊吞掉、不報錯。globals.css 檔頭正是這個形狀。
   修法:找下一個 `{` 當 prelude 之後,只取【最後一個分號之後】的片段——分號前的陳述式已經自己
   結束了,不該繼續參與這個 `{` 的判斷。
2. `_normalise_selector()` 只處理屬性選擇器的引號種類與空白,其餘同義寫法
   (`*|a` vs `a`、大小寫、`>` 以外組合子的空白差異)沒有處理,仍可能少報衝突(見 docstring)。
3. `@page` 與其邊距框刻意不展開(它們沒有選擇器,展開會製造假的 selector)。
4. **本檔的自檢 fixture 原本只有 OD 的 preview html**(沒有 `@import` 開頭的檔案形狀)⇒
   盲區 1 那個洞在自檢通過的情況下活了很久沒被抓到。**自檢過 ≠ 沒有洞,只證明它在
   寫自檢的人想到的那些形狀上是對的。**
5. 🔴 **`!important` 完全不處理** —— 本尺純粹「文件順序後面的贏」。
   而真 CSS 裡 `!important` **贏過文件順序** ⇒ **當輸家帶 `!important` 而贏家沒帶時,
   這把尺會判反**,而它照樣吐出一份看起來乾淨的表(與盲區 1 同族:不報錯)。
   📏 **2026-08-25 在 `apps/admin/src/app/globals.css` 上量過一次**:
   ```
   會判錯的格(輸家帶 !important、贏家沒帶) = 0
   正對照:全檔宣告 548 筆, 其中帶 !important 的 89 筆(>0 ⇒ 偵測器沒壞)
   ```
   🔴 **那個 0 的射程 = 「這份檔【剛好】沒有」,不是「這把尺沒有這個洞」。**
   換一份 CSS 就要重量;要重量就跑上面那兩個數字(輸家帶 `!important` 而贏家沒帶的格數,
   以及帶 `!important` 的總筆數當正對照 —— **少了正對照,那個 0 與「偵測器沒跑」印同一個字**)。
6. 🔴 **`@layer` 不展開** —— `walk()` 只對 `@media` / `@supports` 遞迴,
   `@layer` 走的是「不展開、整段跳過」那條路(與 `@page`/`@font-face`/`@keyframes` 同一支)。
   ⇒ **包在 `@layer` 裡的規則,本尺從頭到尾看不見,而它不報錯。**
   📏 **直接證據**(2026-08-25 在 `apps/admin/src/app/globals.css` 上跑):
   ```
   拿 @layer base 裡的選擇器問 walk()
     'body'  ⇒ 【沒有吐出】          ← 它只出現在 @layer base 裡
     '*'     ⇒ 有吐出,但那是別處 @media (prefers-reduced-motion) 裡的 *,不是 @layer 裡的那個
   ```
   🔴 **那次影響 = 0,而理由是「這份檔的 `@layer base` 剛好只有 108 字元、0 筆宣告」——
      不是「這把尺沒有這個洞」。** 與盲區 5 同族:**換一份 CSS 就要重量。**
   ⚠️ 而 `@layer` 不只是「少看到規則」:**分層本身會改變層疊結果**
      (未分層 > 已分層,v4 的 Tailwind utilities 就在 layer 裡)⇒ 真要支援它,
      **不能只是遞迴進去,還要把 layer 的優先序帶進比較**。本尺目前兩件都沒做。

🔴 舊尺(2026-08-23 修這支之前的那版)壞在哪:
   舊版用 `([^{}@]+)\\{([^{}]*)\\}` 一發正則掃全文,
   而 `@media print{ .pd-sheet{...} }` 的【內層】長得跟頂層規則一模一樣
   ⇒ 列印覆蓋值被當成螢幕值 merge 進去
   ⇒ `.pd-sheet` 算出 width:auto / padding:0(那是列印值),而螢幕值 210mm / 6mm 被蓋掉。
   ⚠️ **壞尺不會報錯、也會印出一份看起來完整的「最終值」** ⇒ 它讓下一個人停止懷疑。

修法:用大括號配對走訪,把 at-rule 脈絡當成 key 的一部分。
   同一個 (脈絡, selector, property) 才互相覆蓋,不同脈絡各算各的。
"""
import io
import re
import sys
from collections import OrderedDict


def _strip_comments(css: str) -> str:
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def _normalise_selector(sel: str) -> str:
    """把同義但寫法不同的 selector 收成同一個 key。

    🔴 **為什麼需要它(2026-08-23,在線A 的 `globals.css` 上當場撞到)**:
       CSS 的屬性選擇器 `[data-den='std']` 與 `[data-den="std"]` 是**同一個東西**
       (引號種類不影響比對,特異性也一樣)⇒ 瀏覽器會讓**後面那個**贏。
       而本尺原本用【字面字串】當 key ⇒ 把它們算成兩個不同的 selector
       ⇒ **回報 5 處,而真相是 3 個 selector、11 條宣告。**
    ⚠️ 這個盲點的方向是【少報衝突】—— 而這把尺的用途正是【找衝突】。
       ⇒ 它與它要取代的那把壞尺同族:不報錯、吐出一份看起來乾淨的表。
    ⚠️ **本函式只normalise 引號與空白。** 其他同義寫法(`*|a` vs `a`、大小寫、
       `> ` 前後空白以外的形式)**沒有處理** ⇒ 仍可能少報。**這一格標未解決。**
    """
    sel = ' '.join(sel.split())
    return re.sub(r"\[([^\]=]+)='([^']*)'\]", r'[\1="\2"]', sel)


def styles_in_document_order(html: str) -> list[str]:
    """依文件順序取出每個 <style> 的內容。後面的贏 —— 這是 CSS 的規則,不是我的選擇。"""
    return [m.group(1) for m in re.finditer(r'<style[^>]*>(.*?)</style>', html, re.S)]


def walk(css: str, context: str = ''):
    """走訪 CSS,吐 (context, selector, declarations_text)。

    context = at-rule 的巢狀路徑,例如 '' / '@media print' / '@media print > @media (x)'。
    🔴 `@page` 與它的邊距框刻意【不展開】—— 它們沒有選擇器,展開會製造假的 selector。
    """
    i, n = 0, len(css)
    while i < n:
        brace = css.find('{', i)
        if brace == -1:
            return
        prelude = css[i:brace].strip()
        # 🔴 2026-08-24 修:零大括號的 at-rule 陳述式(`@import 'x';` / `@custom-variant …;` /
        #   `@charset …;`)以分號結尾、沒有自己的 `{}`。若它們緊接在下一個選擇器前面,
        #   `css[i:brace]` 會把它們與真正的 prelude 黏成一串,讓真 prelude 被誤判成
        #   「看不懂的 at-rule」而整段連同下一個選擇器的 body 一起被跳過、不吐、不報錯
        #   (globals.css 檔頭 `@import ×2 + @custom-variant + :root` 就是這個形狀,
        #    :root 整塊 30 幾顆 token 因此消失)。
        #   修法:只認 prelude 裡【最後一個分號之後】的那一段 —— 分號之前的東西早已經是
        #   完整陳述式,自己結束了,不該繼續黏著參與這個 `{` 的判斷。
        if ';' in prelude:
            prelude = prelude.rsplit(';', 1)[1].strip()
        # 找對應的右大括號(要配對,不能用 find('}'))
        depth, j = 1, brace + 1
        while j < n and depth:
            if css[j] == '{':
                depth += 1
            elif css[j] == '}':
                depth -= 1
            j += 1
        body = css[brace + 1:j - 1]
        if prelude.startswith('@'):
            at = prelude.split('{')[0].strip()
            if at.startswith('@media') or at.startswith('@supports'):
                yield from walk(body, f'{context} > {at}'.lstrip(' >'))
            # @page / @font-face / @keyframes:不展開(見 docstring)
        else:
            for sel in prelude.split(','):
                sel = _normalise_selector(sel)
                if sel:
                    yield context, sel, body
        i = j


def final_values_css(css: str) -> 'OrderedDict[tuple[str, str], OrderedDict[str, str]]':
    """吃【純 CSS 檔】(例 globals.css)。與 final_values 同一套邏輯,只是沒有 <style> 那層。"""
    out: 'OrderedDict[tuple[str, str], OrderedDict[str, str]]' = OrderedDict()
    for ctx, sel, body in walk(_strip_comments(css)):
        flat = re.sub(r'\{[^{}]*\}', '', body)
        d = out.setdefault((ctx, sel), OrderedDict())
        for decl in flat.split(';'):
            if ':' not in decl:
                continue
            k, v = decl.split(':', 1)
            k = k.strip()
            if k and not k.startswith('@'):
                d[k] = v.strip()
    return out


def final_values(html: str) -> 'OrderedDict[tuple[str, str], OrderedDict[str, str]]':
    css = _strip_comments('\n'.join(styles_in_document_order(html)))
    out: 'OrderedDict[tuple[str, str], OrderedDict[str, str]]' = OrderedDict()
    for ctx, sel, body in walk(css):
        # 只吃這一層的宣告,巢狀區塊留給遞迴
        flat = re.sub(r'\{[^{}]*\}', '', body)
        d = out.setdefault((ctx, sel), OrderedDict())
        for decl in flat.split(';'):
            if ':' not in decl:
                continue
            k, v = decl.split(':', 1)
            k = k.strip()
            if k and not k.startswith('@'):
                d[k] = v.strip()          # 文件順序後面的贏
    return out


# ────────────────────────────────────────────────────────────────────────
# 自檢 —— 🔴 這支腳本【自己】要有兩個世界,否則它跟它要取代的壞尺一樣不可信。
#   線A 2026-08-23:「修完請讓它表演一次…不要只看它不再報錯。」
# ────────────────────────────────────────────────────────────────────────
def _broken_ruler(html: str):
    """舊的壞尺,原樣保留 —— 它是本檔的【負向對照組】,不是死碼。刪掉它自檢就沒有對照。"""
    css = _strip_comments('\n'.join(styles_in_document_order(html)))
    out: 'OrderedDict[str, OrderedDict[str, str]]' = OrderedDict()
    for m in re.finditer(r'([^{}@]+)\{([^{}]*)\}', css):
        sel = ' '.join(m.group(1).split())
        if not sel:
            continue
        d = out.setdefault(sel, OrderedDict())
        for decl in m.group(2).split(';'):
            if ':' in decl:
                k, v = decl.split(':', 1)
                d[k.strip()] = v.strip()
    return out


def selfcheck(path: str) -> bool:
    html = io.open(path, encoding='utf-8').read()
    good, bad = final_values(html), _broken_ruler(html)
    ok = True

    def expect(label, got, want):
        nonlocal ok
        hit = got == want
        ok = ok and hit
        print(f"  {'✅' if hit else '❌'} {label}\n       想要 {want!r}\n       拿到 {got!r}")

    print(f'== 自檢 {path}')
    print('-- 世界 A:好尺應該把螢幕值與列印值【分開】')
    scr = good.get(('', '.pd-sheet'), {})
    prn = good.get(('@media print', '.pd-sheet'), {})
    expect('螢幕 .pd-sheet width', scr.get('width'), '210mm')
    expect('螢幕 .pd-sheet padding', scr.get('padding'), '6mm')
    expect('列印 .pd-sheet width', prn.get('width'), 'auto')
    expect('列印 .pd-sheet padding', prn.get('padding'), '0')

    print('-- 世界 B:壞尺對【同一個 selector】必須吐出不同的東西(否則我根本沒修到)')
    b = bad.get('.pd-sheet', {})
    expect('壞尺 .pd-sheet width(= 列印值汙染螢幕值)', b.get('width'), 'auto')
    expect('壞尺 .pd-sheet padding', b.get('padding'), '0')
    differs = (b.get('width'), b.get('padding')) != (scr.get('width'), scr.get('padding'))
    ok = ok and differs
    print(f"  {'✅' if differs else '❌'} 兩把尺對同一個 selector 吐出不同的東西 = {differs}")

    print('-- 世界 C:已知答案回歸(.pd-sech 是我 2026-08-23 單獨驗過的那個)')
    sech = good.get(('', '.pd-sech'), {})
    expect('.pd-sech border-top', sech.get('border-top'), '1.2mm solid var(--pd-ink)')
    expect('.pd-sech background(稿上沒有 ⇒ None)', sech.get('background'), None)

    print('-- 世界 D:線A 那把尺的病 —— 註解不得被吃進 selector')
    #    他的 `([^{}]+)\\{` 沒有先剝註解 ⇒ 規則之間的 /* … */ 整段變成 selector 的一部分。
    #    本尺在 walk() 之前先 _strip_comments ⇒ 構造不出那個症狀。**但要表演,不是宣稱。**
    probe = """
    .a { --row-h: 44px }
    /* ① 列表再緊湊一階:列高 56 → 44,而這段註解【不是】選擇器 */
    .a { --row-h: 40px }
    @media print { .a { --row-h: 99px } }
    """
    got = final_values_css(probe)
    bad_sel = [s for (_c, s) in got if '/*' in s or '列高' in s]
    expect('註解變成 selector 的筆數', len(bad_sel), 0)
    expect('.a 螢幕最終值(後面的贏)', got.get(('', '.a'), {}).get('--row-h'), '40px')
    expect('.a 列印值分開存放', got.get(('@media print', '.a'), {}).get('--row-h'), '99px')
    #    🔴 正向對照:證明上面那個 0 不是「probe 根本沒有註解」。
    raw_has_comment = '/*' in probe
    ok = ok and raw_has_comment
    print(f"  {'✅' if raw_has_comment else '❌'} 正向對照:probe 裡真的有註解 = {raw_has_comment}")

    print('-- 世界 E:同義 selector(引號種類)必須收成同一個 key')
    probe2 = """
    .g[data-den='std'] { --h: 32px }
    .g[data-den="std"] { --h: 48px }
    """
    g2 = final_values_css(probe2)
    keys = [s for (_c, s) in g2]
    expect('收成幾個 key(同義 ⇒ 1)', len(keys), 1)
    expect('後面的贏', g2.get(('', '.g[data-den="std"]'), {}).get('--h'), '48px')
    #    🔴 負向對照:未 normalise 的話會是 2 個 key、且 32px 那筆會被當成獨立的答案活下來。
    naive = len({' '.join(x.split()) for x in ("""\
    .g[data-den='std']""", """    .g[data-den="std"]""")})
    ok = ok and naive == 2
    print(f"  {'✅' if naive == 2 else '❌'} 負向對照:純字面比對會算成 {naive} 個 key(所以這一格有判別力)")

    print('-- 世界 F:零大括號的 at-rule 陳述式(@import)不能吃掉後面黏著的選擇器')
    #    🔴 2026-08-24 cf 線在 globals.css 上抓到:walk() 找下一個 `{` 當 prelude,
    #    `@import 'x';` 這種只有分號沒有大括號的陳述式會被黏進下一個選擇器的 prelude,
    #    變成「看起來像未知 at-rule」⇒ 走 @font-face/@keyframes 那條「整段跳過不吐」的路,
    #    :root 整塊被吞掉、不報錯。globals.css 檔頭正是這個形狀(@import ×2 + :root)。
    probe3 = "@import 'tailwindcss';\n:root { --primary: #1a5c96; }\n.dark { --primary: oklch(1 0 0); }"
    got3 = final_values_css(probe3)
    expect('世界F:@import 開頭時 :root 仍要出現', got3.get(('', ':root'), {}).get('--primary'), '#1a5c96')
    expect('世界F:.dark 不受影響(對照組)', got3.get(('', '.dark'), {}).get('--primary'), 'oklch(1 0 0)')

    print(f"== {'PASS' if ok else 'FAIL'}\n")
    return ok


if __name__ == '__main__':
    base = ('/Users/sean_1/Library/Application Support/Open Design/namespaces/'
            'release-stable/data/projects/pcm-524f/')
    targets = sys.argv[1:] or [base + '預覽-出貨明細單.html', base + '預覽-訂單明細.html']
    if not all(selfcheck(t) for t in targets):
        sys.exit(1)
    print('全部自檢通過。')
