#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""citation-rot-check.py — 找出「引用了別的檔的行號 + 逐字, 而那句話已經不在那裡」的地方。

🔴 為什麼有這一支(2026-08-27 夜, 下手窗 de 立):
  當晚同一個病在【三個不同的載體】上各出現一次:
    · migration 檔頭重述「跑到第幾輪」   ⇒ 每跑一輪就過期一次
    · STATUS.md / CURRENT.md 引用行號    ⇒ 被引的檔一動就過期, 而【兩邊都沒有訊號】
    · 變更單的驗收錨綁提議字面           ⇒ 套的人換句就恆 0
  共同形狀:**把一份會動的東西複製到第二個地方, 而沒有東西綁著它們。**
  前兩者當晚各自解掉一半(「不複製、只指過去」/ 短標記當錨), 而**跨檔引用那一對沒有解法**。

  🔴 而正解的形狀是主視窗那句:**「換一個本來就記那件事的載體」** ——
     跨檔引用「那句話還在不在」這件事, 本來就記在【被引檔的內容】裡。
     ⇒ 本支不要求任何人改寫法, 它只是【去把那件事讀出來】。

  規模(2026-08-27 當場量):
    `docs/` 底下形如 `<path>:<NN>` 的引用 ⇒ 8,542
    STATUS.md 57 / CURRENT.md 26
    其中後面緊接「逐字」引號的 ⇒ 139(**只有這種驗得起來**)

⚠️ 誠實邊界(不要讀成比它大 —— 這一節是本支最該先讀的一節):

  1. 它只驗**同時帶【路徑】與【「」引號】**的那種。兩者缺一它一句話都說不了。
  2. 🔴🔴 **而最會腐爛的那一種, 它結構上看不到** ——
     文件裡真正常見的寫法是【綽號 + 行號】:「`片3a` 檔頭 `:7` 逐字「…」」。
     **那裡沒有路徑** ⇒ 本支不知道要去開哪個檔 ⇒ 零命中。
     2026-08-27 當場量:`STATUS.md` + `CURRENT.md` 這種綽號式引用 **8 處**。
     📌 **而本支【就是為了那一格而做的】** —— 立它的那個實例(STATUS 引片3a `:7`,
        而 `:7` 已經是別句)**它自己抓不到**。
     ⇒ **一支工具的驗收案例, 正是它結構上漏掉的那一種。這一句不要刪。**
  3. 它比對的是**正規化後的子字串**(剝 markdown 粗體/刪除線/反引號/空白;省略號只取前段)
     ⇒ 引文被改寫過而語意相同 ⇒ 它會判 🔴。**那是刻意的**:改寫過就該有人看一眼。
  4. 🔴 **`🔴` 有兩種成因而本支分不開**:①被引檔改了 ②那句引文本來就不是逐字(是改寫/摘要)。
     ⇒ 標籤只寫「找不到 ⇒ 要人看一眼」, **不寫「引用已死」**。
  5. ⚠️ **不要拿本支的分母去講「repo 裡有幾個引用」** —— 那個數字我 2026-08-27 用三種 grep
     量到三個不同的值(83 / 0 / 8), 而差別來自 regex 的貪婪行為不是來自檔案。
     **本支只報【它自己掃到的那些】, 那不是全集。**
  6. 它**不判對錯**, 只判「那句話還在不在那個位置」。

🔴 立它的那一夜, 我在它身上連修四輪(省略號誤報 / 標籤過度宣稱 / 隔字形狀漏抓 / 驗收案例結構外),
   而**同一夜我剛裁決別的窗「同一層打轉就停」**。⇒ **本支停在這一版。**
   要擴的話該問的不是「regex 怎麼再寬一點」, 而是
   **「引用要不要一開始就帶路徑」** —— 那是寫法約定, 不是工具問題。
"""
import re, sys, os, unicodedata

# 🔴 `path` 與 `:NN` 之間【可以隔著字】—— 第一版沒有這一格, 而那正是它要抓的那種寫法:
#    STATUS.md 實際寫的是 「`…policy.sql`(片3a)檔頭 `:7` 逐字「…」」
#    ⇒ 第一版對它抓到 **0**。**一支工具的驗收案例, 正是它自己漏掉的那一種。**
#    (2026-08-27 造控制世界量到:隔著字的形狀 ⇒ 0 命中;而 STATUS+CURRENT 那種形狀共 83 處。)
CITE = re.compile(
    r'(?P<path>[A-Za-z0-9_][A-Za-z0-9_./-]*\.(?:ts|tsx|sql|md|py|sh|css|ya?ml|json))'
    r'`?(?P<mid>[^「」\n:]{0,24})'
    r'`?\s*:\s*(?P<line>\d+)`?'
    r'(?P<gap>[^「\n]{0,40})'
    r'「(?P<quote>[^」\n]{6,})」'
)

def norm(s: str) -> str:
    """剝掉 markdown 裝飾與空白 —— 兩邊都剝, 比的是內容不是排版。"""
    s = unicodedata.normalize('NFKC', s)
    s = s.replace('**', '').replace('~~', '').replace('`', '')
    s = re.sub(r'[\s　]+', '', s)
    return s

def probe(quote: str) -> str:
    """把引文變成【可以去比對的那一段】。

    🔴 第一版沒有這一步, 而它讓尺【系統性誇大】:
       文件裡的引文常常是截斷的(「每個員工的帳號密碼…」), 而那個 `…` 是【引用者加的】,
       原檔裡沒有 ⇒ 整句永遠比不到 ⇒ 每一個截斷引用都被判成「引用已死」。
       2026-08-27 第一次跑 STATUS+CURRENT 印「25 處只有 1 處還在原位」——
       **而那個數字有一大半是這個 bug。**
       📌 一把新做的尺, 它的第一次輸出最不該被相信 —— 而它看起來最像發現了大事。
    ⇒ 只取省略號【之前】那一段;太短(<6 字)就放棄比對, 交給 ⛔ 而不是硬判。
    """
    for mark in ('…', '...', '‥'):
        if mark in quote:
            quote = quote.split(mark)[0]
    return quote

def check_one(root, citing_file, m):
    path, line_no, quote = m.group('path'), int(m.group('line')), m.group('quote')
    tgt = os.path.join(root, path)
    if not os.path.exists(tgt):
        # 引用可能是相對於別的目錄 ⇒ 找同名檔;找不到才算 ⛔
        base = os.path.basename(path)
        hits = []
        for dp, _, fns in os.walk(root):
            if 'node_modules' in dp or '/.git' in dp:
                continue
            if base in fns:
                hits.append(os.path.join(dp, base))
        if len(hits) != 1:
            return ('⛔', f'{citing_file}: 被引檔找不到或不唯一({path}, 同名 {len(hits)} 支)')
        tgt = hits[0]
    try:
        lines = open(tgt, encoding='utf-8').read().split('\n')
    except Exception as e:
        return ('⛔', f'{citing_file}: 讀不到 {path} — {e}')
    q = norm(probe(quote))
    if len(q) < 6:
        return ('⛔', f'{citing_file}: {path}:{line_no} 引文截斷後太短、比不了(「{quote[:24]}」)')
    at = norm(lines[line_no - 1]) if 0 < line_no <= len(lines) else ''
    if q in at:
        return ('✅', f'{path}:{line_no}')
    where = [i + 1 for i, ln in enumerate(lines) if q in norm(ln)]
    if where:
        return ('🟡', f'{citing_file}: {path}:{line_no} 那句話搬到 :{",".join(map(str, where[:3]))} 了')
    # ⚠️ 這個 🔴 有【兩種成因而本支分不開】:①被引檔改了 ②那句引文本來就不是逐字(是改寫/摘要)。
    #    ⇒ 標籤只能講「找不到」, 不能講「引用已死」。第一版寫「引用已死」是過度宣稱。
    return ('🔴', f'{citing_file}: {path}:{line_no} 引文在被引檔裡找不到(檔改了 或 那句本來就不是逐字)⇒ 要人看一眼:「{quote[:36]}」')

def scan(root, files):
    out = []
    for f in files:
        p = f if os.path.isabs(f) else os.path.join(root, f)
        if not os.path.exists(p):
            out.append(('⛔', f'{f}: 檔不存在'))
            continue
        for m in CITE.finditer(open(p, encoding='utf-8').read()):
            out.append(check_one(root, os.path.relpath(p, root), m))
    return out

def selftest(root):
    """🔴 三個世界必須印【不同】的東西, 否則這支尺沒有判別力。"""
    import tempfile, shutil
    tmp = tempfile.mkdtemp(prefix='citerot-')
    try:
        os.makedirs(os.path.join(tmp, 'sub'))
        open(os.path.join(tmp, 'sub', 'target.md'), 'w', encoding='utf-8').write(
            '第一行\n這裡有一句 **會被引用的話**\n第三行\n')
        cases = {
            '該綠': 'sub/target.md:2 逐字「會被引用的話」',
            '該黃': 'sub/target.md:3 逐字「會被引用的話」',
            '該紅': 'sub/target.md:2 逐字「這句話從來沒有出現過」',
        }
        got = {}
        for name, body in cases.items():
            f = os.path.join(tmp, f'{name}.md')
            open(f, 'w', encoding='utf-8').write(body)
            r = scan(tmp, [f])
            got[name] = r[0][0] if r else '(零命中)'
        ok = got.get('該綠') == '✅' and got.get('該黃') == '🟡' and got.get('該紅') == '🔴'
        for k, v in got.items():
            print(f'  {k} ⇒ {v}')
        print('⇒ 自檢 ' + ('PASS(三個世界印不同答案)' if ok else '🔴 FAIL —— 這支尺分不開三個世界, 結果作廢'))
        return 0 if ok else 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__':
    root = os.getcwd()
    if len(sys.argv) > 1 and sys.argv[1] == '--selftest':
        sys.exit(selftest(root))
    targets = sys.argv[1:] or ['STATUS.md', 'docs/handoff/CURRENT.md']
    res = scan(root, targets)
    n = {k: 0 for k in ('✅', '🟡', '🔴', '⛔')}
    for tag, msg in res:
        n[tag] = n.get(tag, 0) + 1
        if tag != '✅':
            print(f'{tag} {msg}')
    # 🔴 分母印出來, 讓讀的人自己算 —— 不要只給結論
    print(f'\n分母:掃了 {len(targets)} 支檔, 帶引號的行號引用共 {len(res)} 處')
    print(f'  ✅ 還在原位 {n["✅"]} · 🟡 搬走了 {n["🟡"]} · 🔴 整個檔找不到 {n["🔴"]} · ⛔ 驗不了 {n["⛔"]}')
    sys.exit(1 if (n['🔴'] or n['⛔']) else 0)
