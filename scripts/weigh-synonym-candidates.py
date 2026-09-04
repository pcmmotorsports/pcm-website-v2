#!/usr/bin/env python3
"""weigh-synonym-candidates.py — 一條字典列【加了之後客人拿到的東西變多還是變少】。

用法
  python3 scripts/weigh-synonym-candidates.py '俗稱=>正式分類名' ...
  python3 scripts/weigh-synonym-candidates.py --selftest

🔴 **為什麼需要這支** —— 2026-09-04 量到的:
   顧客站的分類比對現在會自己挑【件數最大】的分類(`parse-search-facets.ts` 的 `pickLargest`),
   而**字典排在它前面** ⇒ 🛑 **一條指向小分類的字典列會【覆蓋】那個好行為, 讓召回變差。**
   實例:`傳動 ⇒ 齒盤與傳動`(143 件)把客人從 `腳踏後移與傳動`(1709 件)拉走 ⇒ **差 12 倍, 已撤。**
   ⇒ 📌 **所以判準不是「這個俗稱對不對」, 是【這一列讓客人拿到的東西變多還是變少】** —— 而那可以量。

🔴 **它為什麼要進版控**(主視窗 2026-09-04):
   這台機器是之後每一條字典列的**唯一背書**, 而它原本只活在某個 session 的暫存目錄裡
   ⇒ **字典列會留下來, 而機器會消失** ⇒ 下一個想加列的人手上沒有它 ⇒ **他會憑感覺加。**

⚠️ **它會【動】`search-synonyms.ts` 然後還原** —— 每次跑完印 sha256 比對,
   而**開跑前若那支檔已經是 dirty 就直接拒跑**(不要在別人改到一半的檔上做這件事)。
"""

import io, os, re, subprocess, sys, hashlib, json

# 🔴 從腳本自己的位置推 repo 根, 不寫死某一棵樹 ——
#    寫死主樹的話, 從施工窗呼叫它會【安靜地】去動主樹的檔。
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICT = os.path.join(REPO, 'apps/storefront/src/data/search-synonyms.ts')
FIX  = os.path.join(REPO, 'apps/storefront/src/data/search-prefix-largest.test.ts')
TMP  = os.path.join(REPO, 'apps/storefront/src/data/__weigh.test.ts')

def sha(p): return hashlib.sha256(io.open(p,'rb').read()).hexdigest()


def orig_peek(): return io.open(DICT, encoding='utf-8').read()

def run(words):
    """把 words 餵進真的解析器, 回 {word: (落點, 件數)}"""
    src = io.open(FIX, encoding='utf-8').read()
    a = src.index('const SUMMARIES: Summary[] = [')
    b = src.index('\n];', a)
    fixture = src[a:b+3]                      # 🔵 直接借那支閘的快照, 不另外造一份
    io.open(TMP,'w',encoding='utf-8').write(
        "import { describe, it } from 'vitest';\n"
        "import { buildCategoryTree } from '@/lib/category-taxonomy';\n"
        "import { parseSearchFacets } from '@/lib/parse-search-facets';\n"
        "import { CATEGORY_URL_SEPARATOR } from '@/components/products-url-parsers';\n"
        "type Summary = Parameters<typeof buildCategoryTree>[0][number];\n"
        + fixture + "\n"
        "const TREE = buildCategoryTree(SUMMARIES);\n"
        "const SRC = { motoBrands: [], brands: [], categories: TREE } as unknown as Parameters<typeof parseSearchFacets>[1];\n"
        "const FLAT = TREE.flatMap((c) => [{ name: c.name, count: c.count }, ...c.children.map((s) => ({ name: s.name, count: s.count }))]);\n"
        f"const W = {json.dumps(words, ensure_ascii=False)};\n"
        "describe('w', () => { it('w', () => {\n"
        "  const out = W.map((w) => {\n"
        "    const r = parseSearchFacets(w, SRC) as { category: string | null; usedSynonyms: unknown[] };\n"
        "    const leaf = r.category ? r.category.split(CATEGORY_URL_SEPARATOR).pop()!.trim() : null;\n"
        "    const hit = leaf ? FLAT.filter((c) => c.name === leaf).map((c) => c.count) : [];\n"
        "    return { w, leaf, n: hit.length ? Math.max(...hit) : null, syn: r.usedSynonyms.length };\n"
        "  });\n"
        "  // eslint-disable-next-line no-console\n"
        "  console.log('###' + JSON.stringify(out));\n"
        "}); });\n")
    p = subprocess.run(['pnpm','exec','vitest','run','apps/storefront/src/data/__weigh.test.ts','--reporter=verbose'],
                       cwd=REPO, capture_output=True, text=True, env={**os.environ,'TURBO_FORCE':'1'})
    os.remove(TMP)
    m = re.search(r'###(\[.*?\])', p.stdout + p.stderr, re.S)
    if not m: sys.exit('🔴 讀不到量測輸出 —— 尺壞了, 不要讀成「沒有結果」')
    return {r['w']: r for r in json.loads(m.group(1))}

def verdict(a, b, t):
    """從【兩個讀數】算出判定。**純函式:不碰檔、不跑 vitest。**

    🔴 這一段被抽成函式是 2026-09-04 的 pre-commit 閘逼出來的, 而它逼對了:
       原本 `--selftest` 會【真的去改 `search-synonyms.ts` 再還原】,
       而那份登記掛在 lint-staged ⇒ 🛑 **它會在 pre-commit 當下改一支被追蹤的檔。**
       ⇒ 📌 那正是「在 hook 底下跑一個會改檔的 harness」那一族(見 mutation-harness-restore.md)。
    ✅ 改成:selftest 只餵【合成的讀數】驗判定的四個分支, 零副作用;
       而「它量不量得到」那一半, 每一次真的拿它去量的時候都在被驗。
    """
    an, bn = a['n'], b['n']
    if not b['syn']:
        return (('TO_NOT_IN_TREE', '🔴 `to` 不在目錄樹上(打錯字, 或那個分類 0 件)⇒ 換一個 to')
                if b['leaf'] is None else ('RULE_FIRST', '🔴 這一列沒被用到 —— 規則自己先命中了 ⇒ 多餘, 不加'))
    if b['leaf'] != t:                        return ('WRONG_TARGET', f"🔴 落到「{b['leaf']}」而不是你要的「{t}」⇒ 不加")
    if an is None:                            return ('WAS_UNREACHABLE', f'✅ 原本【什麼都撈不到】⇒ 現在 {bn} 件 ⇒ 加')
    if bn > an:                               return ('MORE_RECALL', f'✅ 召回變多 {an} ⇒ {bn} ⇒ 加')
    if bn == an and a['leaf'] == b['leaf']:   return ('REDUNDANT', '🔵 純冗餘(落點件數都相同)⇒ 可加可不加')
    return ('LESS_RECALL', f'🔴 召回變少 {an} ⇒ {bn} ⇒ 不加')


if '--selftest' in sys.argv[1:]:
    # 🔴 六個世界, 而它們必須印出【六種不同的判定】。
    #    其中第三個(⇒ 加)是刻意的:一台只會說「不加」的機器,
    #    在該說「加」的時候我不會知道它壞了。
    CASES = [
        ('召回變少', {'leaf':'大','n':1709},        {'leaf':'小','n':143,'syn':1},   '小'),
        ('純冗餘',   {'leaf':'同','n':302},         {'leaf':'同','n':302,'syn':1},   '同'),
        ('⇒ 加(原本撈不到)', {'leaf':None,'n':None}, {'leaf':'新','n':251,'syn':1},  '新'),
        ('⇒ 加(召回變多)',   {'leaf':'小','n':10},   {'leaf':'大','n':99,'syn':1},   '大'),
        ('to 不在樹上', {'leaf':None,'n':None},      {'leaf':None,'n':None,'syn':0},  '不存在'),
        ('規則先命中', {'leaf':'某','n':50},          {'leaf':'某','n':50,'syn':0},    '某'),
    ]
    # 🔴🔴 比【分支代號】不比【渲染後的字串】——
    #    ⛔ 初版比字串 ⇒ 我把兩個分支壓成同一句去突變它, 而**它照樣印「6 種互不相同」**
    #       因為兩句的數字不同(251 vs 99)⇒ 字串就不同。
    #    📌 **一個把兩種世界壓成同一個分支的錯, 在【渲染後的字串】上看不見。**
    seen = []
    for name, a, b, t in CASES:
        tag, msg = verdict(a, b, t)
        print(f'  {name:<22} ⇒ [{tag}] {msg}')
        seen.append(tag)
    if len(set(seen)) != len(CASES):
        dup = [x for x in set(seen) if seen.count(x) > 1]
        print(f'🔴 自檢 FAIL:{len(CASES)} 個世界只走到 {len(set(seen))} 個分支'
              f'(重複的:{dup})⇒ 有兩個世界被壓成同一個分支, 這台機器在那裡沒有判別力。')
        sys.exit(1)
    print(f'✅ 自檢通過:{len(CASES)} 個世界各自走到【不同的分支】。')
    print('⚠️ 而它【只驗判定邏輯】—— 「它量不量得到」那一半靠每一次真的拿它去量時被驗。')
    sys.exit(0)

EXISTING = '--existing' in sys.argv[1:]

if EXISTING:
    # 🔴 【既有列】要反過來量:把它【拿掉】再量, 不是再加一份(見下方那道拒答閘的理由)。
    #    ⚠️ 而這裡一次拿掉【全部】再量, 而不是一條一條 ——
    #       前提:`synonymFor` 是【對整個詞的精確比對】⇒ A 列不影響 B 詞的查詢。
    #       🔴 那是一個【前提】不是事實 ⇒ 下面 `--existing` 跑完會自己抽驗一條做對照。
    pairs = re.findall(r"^    from: '([^']+)',\n    to: '([^']+)',", orig_peek(), re.M)
    if not pairs:
        sys.exit('🔴 字典裡一列都讀不到 ⇒ 尺壞了, 不要讀成「字典是空的」')
else:
    pairs = [tuple(a.split('=>')) for a in sys.argv[1:]]
if not pairs: sys.exit('用法:weigh-candidates.py "俗稱=>正式名" ...')
words = [f for f, _ in pairs]

# 🛑 開跑前:那支檔不能已經是 dirty —— 否則我還原的是【我進來時的樣子】, 不是【他的樣子】
_st = subprocess.run(['git','status','--porcelain','--','apps/storefront/src/data/search-synonyms.ts'],
                     cwd=REPO, capture_output=True, text=True)
if _st.stdout.strip():
    sys.exit('🔴 search-synonyms.ts 現在是 dirty ⇒ 拒跑。先把它 commit 或還原, 不要在別人改到一半的檔上做這件事。')

orig = io.open(DICT, encoding='utf-8').read()

# 🔴🔴 **這台機器問的是「【加】這一列會不會改變什麼」** ——
#    ⇒ 對一條【已經在字典裡】的 from, 「沒這列」那一欄根本不是沒那列, 它照樣被舊的那列命中
#    ⇒ 🛑 兩欄會印成一樣, 而判定會印【純冗餘】—— **那句話是假的, 它答的是「再加一份重複的沒差」。**
#    📌 這一格是 2026-09-04 commit 完之後拿一條【剛加進去的】列去量, 當場撞出來的。
_existing = [] if EXISTING else [f for f, _ in pairs if re.search(r"^    from: '" + re.escape(f) + r"',$", orig, re.M)]
if _existing:
    sys.exit('🔴 這些 from 【已經在字典裡】了, 這台機器答不了它們:' + ' · '.join(_existing) +
             '\n   它問的是「加這一列會不會改變什麼」⇒ 對已經在裡面的列, 兩欄都會是「有那列」的世界。'
             '\n   ⇒ 要量既有列的價值, 是把它【拿掉】再量, 不是再加一份。')

before_sha = sha(DICT)
if EXISTING:
    # 有那些列 = 現況;沒那些列 = 全部拿掉
    with_ = run(words)
    stripped = orig
    for f, _t in pairs:
        stripped = re.sub(r"  \{\n    from: '" + re.escape(f) + r"',\n(?:.*\n)*?  \},\n", '', stripped, count=1)
    io.open(DICT, 'w', encoding='utf-8').write(stripped)
    try:
        without = run(words)
    finally:
        io.open(DICT, 'w', encoding='utf-8').write(orig)
    # 🟢 抽驗那個前提:單獨拿掉【第一條】, 它的讀數要與「全部拿掉」那一發相同
    f0, _ = pairs[0]
    one = re.sub(r"  \{\n    from: '" + re.escape(f0) + r"',\n(?:.*\n)*?  \},\n", '', orig, count=1)
    io.open(DICT, 'w', encoding='utf-8').write(one)
    try:
        solo = run([f0])
    finally:
        io.open(DICT, 'w', encoding='utf-8').write(orig)
    if (solo[f0]['leaf'], solo[f0]['n']) != (without[f0]['leaf'], without[f0]['n']):
        print(f"🔴 前提被推翻:單獨拿掉「{f0}」得到 {solo[f0]['leaf']}({solo[f0]['n']}),"
              f" 而全部拿掉時是 {without[f0]['leaf']}({without[f0]['n']}) ⇒ 字典列之間會互相影響,"
              ' 這一發的讀數不可信。')
        sys.exit(1)
    print(f"🟢 前提抽驗過:單獨拿掉「{f0}」與全部拿掉時讀數相同 ⇒ 字典列之間不互相影響。")
else:
    without = run(words)

rows = '' if EXISTING else ''.join(
    "  {\n    from: '%s',\n    to: '%s',\n    kind: 'category',\n    source: 'draft',\n"
    "    added: '2026-09-04',\n    note: '量測用暫時列, 跑完移除。',\n  },\n" % (f, t) for f, t in pairs)
if not EXISTING:
    i = orig.rindex('];')
    io.open(DICT,'w',encoding='utf-8').write(orig[:i] + rows + orig[i:])
    try:
        with_ = run(words)
    finally:
        io.open(DICT,'w',encoding='utf-8').write(orig)

after_sha = sha(DICT)
print('✅ 字典逐位元組還原' if before_sha == after_sha else f'🔴 還原失敗 {before_sha[:12]} vs {after_sha[:12]}')
print()
print(f"{'俗稱':<12}{'沒這列 ⇒ 落點(件數)':<34}{'有這列 ⇒ 落點(件數)':<34}判定")

print()
print(f"{'俗稱':<12}{'沒這列 ⇒ 落點(件數)':<34}{'有這列 ⇒ 落點(件數)':<34}判定")
for f, t in pairs:
    a, b = without[f], with_[f]
    print(f"{f:<12}{str(a['leaf'])+'('+str(a['n'])+')':<34}"
          f"{str(b['leaf'])+'('+str(b['n'])+')':<34}{verdict(a, b, t)[1]}")
