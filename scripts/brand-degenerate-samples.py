#!/usr/bin/env python3
"""品牌資料「退化樣本」盤點 —— backlog `#837` 的觸發檢查。

**為什麼存在**:`brand-content.ts` 裡幾筆**刻意留白**的資料,同時是幾道守門【唯一】的真實樣本。
2026-08-20 `dna` 上架時 video/aside/categories 三處留白 ⇒ 成為三道守門的樣本;
2026-08-21 兩顆 commit 把它補完 ⇒ **樣本歸零、守門瞎掉、隔天才被別人發現**。
留白是刻意的,補完也是刻意的,**中間沒有人知道那個留白正被守門當量具用**。

⇒ 本支讓那件事**在資料被改的當下就說話**,而不是等別人跑測試。

離開碼:0 = 每條分流都還有 ≥2 個樣本;1 = 有分流零樣本或只剩 1 家(下一個補完它的人會讓守門瞎掉)。
自檢:`--selftest`(不讀正式資料,餵兩組已知答案的合成資料,要求兩個世界給出不同答案)。
"""
import io, json, re, sys

DATA = 'apps/storefront/src/data/brand-content.ts'

# 每條 = (顯示名, 判定一筆資料是否走這條退化分流)
BRANCHES = [
    ('兩欄退化(無 video 且無 aside)', lambda b: _blank(b, 'video') and _blank(b, 'aside')),
    ('categories 為空', lambda b: _blank(b, 'categories')),
    ('無 aside', lambda b: _blank(b, 'aside')),
    ('無 video', lambda b: _blank(b, 'video')),
    ('無 timeline', lambda b: _blank(b, 'timeline')),
]


def _blank(brand, key):
    """與 JS 的 falsy 對齊 —— 元件端寫的是 `brand.video && …`(`BrandPageAbout.tsx:51`)。

    🔴 這裡刻意用 falsy 而不是 `is None`:如果來源資料出現 `0` / `''` / `[]`,
    **畫面上是「沒有」,而 `is None` 會說「有」** ⇒ 那會讓本支的讀數與畫面相反。
    (自檢第一版把這條寫反了 —— 標籤寫「0 不算留白」而期望值寫「算」,自檢當場抓到。)
    """
    return not brand.get(key)


def analyse(brands):
    """回傳 [(分流名, [走這條的 slug])];**純函式,不碰檔案** —— 自檢才餵得進合成資料。"""
    return [(name, [b['slug'] for b in brands if pred(b)]) for name, pred in BRANCHES]


def load(path=DATA):
    s = io.open(path, encoding='utf-8').read()
    m = re.search(r'=\s*(\[[\s\S]*?\])\s*(?:as const)?\s*;', s)
    if m is None:
        print(f'✗ 解析不出 {path} 裡的品牌陣列 —— 檔案格式變了?', file=sys.stderr)
        sys.exit(2)
    return json.loads(m.group(1))


def report(brands):
    rows = analyse(brands)
    print(f'品牌數 {len(brands)}')
    bad = []
    for name, slugs in rows:
        n = len(slugs)
        mark = '🔴 零樣本' if n == 0 else ('⚠️ 只剩 1 家' if n == 1 else '        ')
        if n <= 1:
            bad.append((name, n))
        print(f'{mark:<10} {name:<32} {n:>2} 家  {",".join(slugs[:4])}')
    print()
    if bad:
        for name, n in bad:
            print(f'🔴 `{name}` 只剩 {n} 個真實樣本 ⇒ 守它的測試已瞎 / 快瞎(見 backlog #837)')
        print('   處置:合成樣本(見 BrandPageAbout.test.tsx 那個 describe),或找回一筆真的留白。')
        return 1
    print('每條分流都還有 ≥2 個真實樣本。')
    return 0


def selftest():
    """兩個世界都表演:同一支 `analyse`,餵【有留白】與【補完了】必須給出不同答案。"""
    blank_one = {'slug': 'blank', 'video': None, 'aside': None, 'categories': [], 'timeline': None}
    full_one = {'slug': 'full', 'video': {'src': 'v'}, 'aside': {'src': 'a'},
                'categories': [['c', 0]], 'timeline': [{'y': 1}]}
    fails = []

    def want(label, got, exp):
        if got != exp:
            fails.append(f'{label}: 得到 {got!r} 期望 {exp!r}')

    # 世界一:有一筆留白 ⇒ 每條分流都抓得到它
    w1 = dict(analyse([blank_one, full_one]))
    want('世界一 兩欄退化', w1['兩欄退化(無 video 且無 aside)'], ['blank'])
    want('世界一 categories 為空', w1['categories 為空'], ['blank'])
    want('世界一 無 aside', w1['無 aside'], ['blank'])

    # 世界二:那一筆被補完了 ⇒ 同樣的分流必須變成空
    filled = {**blank_one, 'video': {'src': 'v'}, 'aside': {'src': 'a'}, 'categories': [['c', 1]]}
    w2 = dict(analyse([filled, full_one]))
    want('世界二 兩欄退化', w2['兩欄退化(無 video 且無 aside)'], [])
    want('世界二 categories 為空', w2['categories 為空'], [])
    want('世界二 無 aside', w2['無 aside'], [])

    # 🔴 兩個世界必須【真的不同】—— 沒有這一條,上面全部寫死成 [] 也會過
    if w1['兩欄退化(無 video 且無 aside)'] == w2['兩欄退化(無 video 且無 aside)']:
        fails.append('兩個世界給了同一個答案 ⇒ 這支腳本沒有判別力')

    # falsy 邊界:`0` / `''` / `[]` 在畫面上都是「沒有」⇒ 本支也要當成留白
    for junk in (0, '', [], {}, None, False):
        got = dict(analyse([{'slug': 'z', 'video': junk, 'aside': {'x': 1},
                             'categories': [['c', 0]], 'timeline': [1]}]))['無 video']
        want(f'falsy video={junk!r} 要算留白', got, ['z'])
    # 反面:真的有值就不算
    want('有值不算留白', dict(analyse([{'slug': 'z', 'video': {'src': 'v'}, 'aside': {'x': 1},
                                        'categories': [['c', 0]], 'timeline': [1]}]))['無 video'], [])

    # 🔴 離開碼也要兩個世界都表演(主視窗 2026-08-22 指定):
    #    真資料今天【就是】≤1 家 ⇒ 直接跑真資料的自檢會恆紅,而恆紅的閘會被人繞過。
    #    ⇒ 這裡餵合成輸入,只驗 report() 的判定邏輯。
    import io as _io, contextlib as _ctx
    def _rc(brands):
        with _ctx.redirect_stdout(_io.StringIO()):
            return report(brands)
    two_each = [{'slug': f'b{i}', 'video': None, 'aside': None, 'categories': [], 'timeline': None}
                for i in range(2)] + [full_one]
    want('每條分流都 ≥2 家 ⇒ 離開碼 0', _rc(two_each), 0)
    only_one = [{'slug': 'solo', 'video': None, 'aside': None, 'categories': [], 'timeline': None},
                full_one]
    want('有分流只剩 1 家 ⇒ 離開碼 1', _rc(only_one), 1)
    want('有分流零樣本 ⇒ 離開碼 1', _rc([full_one, {**full_one, 'slug': 'f2'}]), 1)

    if fails:
        print('✗ selftest 失敗:', file=sys.stderr)
        for f in fails:
            print(f'   {f}', file=sys.stderr)
        return 1
    print('✓ selftest 通過(兩個世界給出不同答案)')
    return 0


if __name__ == '__main__':
    sys.exit(selftest() if '--selftest' in sys.argv[1:] else report(load()))
