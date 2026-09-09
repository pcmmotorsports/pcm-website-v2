#!/usr/bin/env python3
# ⚠️ 2026-09-09 起本檔【沒有任何 hook 會呼叫它】(Sean 拍板規則減法, 試行一週)。grep 得到它 ≠ 那道保護還在。要恢復:git show 54bb99e18:.husky/board-token-gate.sh
r"""board-token-normalize.py —— 把板上「擋上線?」token 正規化到【最後一格的開頭】。

══ 為什麼有它(2026-09-06 tidy 立;成因是一次【零衝突】的 merge)════════════
`docs/launch-todo.md` 的擋上線 token 約定住在**最後一格的開頭**,
而 `scripts/launch-blocking-count.sh` 也只讀那個位置。
2026-09-06 merge 39e 之後讀數當場從 擋 102 掉到 94 —— 而**一個 token 都沒有消失**
(整檔帶 token 的列 505 ⇒ 507,反而變多)。
🔴 成因:**別的窗在【同一格的開頭】插了新內容,把 token 推到格子中間。**
📌 ⇒ 這不是「merge 把訂正還原」(那是 ⟦auth-BOARDMERGERETRACT⟧ 記的病),
   是**兩個人往同一格的同一端寫** —— 而在 diff 上它是**一次乾淨的合併、零衝突**。
另有 4 列出現**兩個一模一樣的 token**(兩邊各帶一份進 merge)。

══ 🔴 天花板(先讀,不要把它讀得比它大)══════════════════════════════════
 ① 它只管 token 的**位置與份數**,**不管判得對不對**。
 ② 🔴 切欄位**認 `\|` 跳脫** —— 板上 138 列這樣寫,而那是**正確**的寫法。
    不認跳脫的切法會算錯「最後一格」(2026-09-06 實測:82 列因此被放錯格)。
 ③ 同一列有**兩個不同**的 token ⇒ 它**不猜哪個對**,`--check` 報出來、`--fix` **不動它**。
    只有兩個**一模一樣**的才去重。
 ④ 它看不到「別窗把新內容插在前面」這件事本身 —— 只看得到結果。
    真正的修法是規矩:**新內容接在 token 後面,不要插在前面。**

用法:
  python3 scripts/board-token-normalize.py --check     違規列數 + 清單,有違規 rc=1
  python3 scripts/board-token-normalize.py --fix       搬正 + 去重,印逐列動作
  python3 scripts/board-token-normalize.py --selftest  兩個世界(含 `\|` 跳脫)
  python3 scripts/board-token-normalize.py --check-staged  pre-commit 用:**讀 staged 那份**, rc 恆 0
"""
import io, os, re, sys

BOARD = 'docs/launch-todo.md'
CLOSED = ('open', 'doing', 'parked', 'done', 'standing')
# 「這列怎樣算做完」認得的字面(2026-09-07)。⚠️ 這是【字串比對】⇒ 兩個方向都會錯:
#   用別的措辭寫了 ⇒ 少報有;寫了這幾個字而條件不可判定 ⇒ 多報有。**它是提醒, 不是判定。**
CLOSE_WORDS = ('轉 `done`', '關閉條件', '轉 `doing`', '做完的定義', '收工條件')
SPLIT = re.compile(r'(?<!\\)\|')
FIND = re.compile(r'⟨(?:擋|不擋|未判|—)[^⟩]*⟩')
HEADS = ('⟨擋', '⟨不擋', '⟨未判', '⟨—⟩')


# ═══ 規則⑧:指向【板檔自己】的裸行號(2026-09-07;account 踩過一次)═══
#   形狀 `併自原 :565`。合併把列往上移一格之後, 那個 565 指到了 ⟦b9-Q15GAP⟧ ——
#   而它讀起來像那一列的欄位 ⇒ account 據此判「這是重複列」, 而那是一件真的、還在擋的事。
#   🔴 **行號在寫下的那一刻就是對的, 而它在下一次合併就開始說謊, 沒有東西會出聲。**
#   🛑 尺刻意窄:`docs/x.md:123` 這種【帶檔名】的證據引用是規則要求的, 不得誤報 ⇒
#      只認「原/本板/板/列」後面直接接 `:數字` 這幾種指向板檔自己的寫法。
# 規則⑩ 的第三個樣式:**真實的計數宣稱**(第八次 / 第三次 / 第 5 次), 不是模板字 `第 N 次`。
RELCOUNT = re.compile(r'第\s*[一二三四五六七八九十\d]+\s*次')

STALEREF = re.compile(r'(?:併自原|原|本板|板|列)\s*:\d+(?!\d|⚠️)')


# ══ 族欄(規格 `~/pcm-mailbox/規格-板閘加族欄-給ship-20260907.md`;主視窗 A 開、tidy 佐證)══
#
# 🔴 **為什麼**:`open + ⟨擋⟩` 那個數**不是那麼多件事** —— 裡面至少五族, 而**它們在板上長得一模一樣**,
#    每一族的下一步完全不同。📌 **Sean 問「還剩多少」的時候, 那個數是【上界】不是答案。**
#
# 🛑 **兩層, 而分界要看得見(這是本支的設計決定, 不是實作細節)**:
#   ① **明示族** = 有人在 token 欄寫了 `⟨擋·決策⟩` 這種擴充字面 ⇒ **權威**。
#   ② **推測族** = 從誰欄/末格的字面推出來的 ⇒ 🔴 **標成推測、單獨印、【不進分子】。**
#   ⇒ 📌 規格逐字「**不要靠內文猜**」講的是 ①;而 ② **不是把猜的當答案**, 它是把「還沒分族的那一堆」
#     先切開讓人看見。**兩者印在不同的地方, 誰也不會被讀成誰。**
#
# 🔴 **而規格問的那一題我在這裡答**:「**既有那些列誰來填?**」⇒ **沒有人填。**
#   ⇒ 所以本支**第一個印的數就是【未分族】** —— 📌 **不印它的話, 空欄與「已經分完了」印同一個東西。**
FAMILY = {
    '有人在做': '①', '記著': '②', '決策': '③', '跨repo': '④', '待翻態': '⑤', '無關閉條件': '⑥',
    # 🔴 ⑦⑧⑨ 是主視窗 `-f8` 2026-09-07 補的, **量出來的不是想出來的**:
    '等真資料': '⑦',   # 第五族:機制做完了而世界上還沒有那筆資料(例:一箱都還沒送過)
    '時刻觸發': '⑧',   # ⚠️ 與「有主」**不同** —— 誰欄掛的是一個【時刻】不是一個人
                       #    (實例 `⟦f3-MAINMERGEVERIFY⟧`:掛的是「Sean 併 main 那一刻」)
    # 🔴 ⑩⑪⑫ 是主視窗 `-f8` 填完那 23 列之後逼出來的 —— **它填不出來的那 3 列, 三個原因都不同**
    #    ⇒ 📌 **「讀不出來」有時不是判不出來, 是【那一族不在清單上】。**
    #    ⚠️ 而加值前先量過(`-ship` 2026-09-07, 分母 = ⟨擋⟩ 92 列, 負對照現造字面 0):
    #       ⑩ 7 列 · ⑪ 2 列 · ⑫ 5 列 ⇒ 都 ≥2 ⇒ 過主視窗的門檻
    #       (**只有 1 個成員的分類值, 增加的是欄位噪音不是資訊** ⇒ 那種寫進該列就好)
    #    🛑 **而那三個數是【字面掃描】⇒ 下界不是精確值** —— 用別種說法寫的列掃不到。
    '等主視窗': '⑩',   # 🔴 **不是等 Sean** —— 技術岔路該由主視窗答
                       #    📌 沒有這一族 ⇒ 會被填成「決策題等 Sean」⇒ **Sean 早上看到一題他答不了的**
    '等他動手': '⑪',   # 🔴 **他已經決定了, 而執行那一步仍要他本人按**
                       #    📌 實例逐字:「『甲』這個字裡不會寫著它執行時仍然需要他。」
    '要先提plan': '⑫',  # 🔴 不是沒人做、不是等資料 —— **下一步是提 plan 不是寫碼**(鐵則 8)
                       #    📌 沒有這一族 ⇒ 會被填成「有人在做」(不實)或「讀不出來」(浪費一個真答案)
    '讀不出來': '⑨',   # 🔴 **這是【合法值】, 不是失敗** —— mail 量到 13% 填不出來,
                       #    而**沒有這個值可填的人會硬塞一個**。
    # 🔴🔴 ⑬ 是 `-ship` 2026-09-08 填自己那 10 列時**撞出來的**(主視窗 A 當場批):
    #    `:689`(`#858` 手動建訂單)—— **沒有人擋著它、沒有人在做、沒有東西要等**,
    #    它就是**一件還沒做的事**;而 ①〜⑫ **全部在回答「它為什麼不是一件普通待辦」**。
    #    🛑 硬塞會壞資料:填 ③ 是假的(**沒有題在 Sean 那裡**)、
    #       填 ⑨ 也是假的(**讀得出來, 答案就是「還沒做」**)。
    #    📌 **⑨ 是「有人看過而填不出來」, 不是「填不進既有的格子」** —— 混掉的話 ⑨ 變成垃圾桶。
    # 🎯 **而 ⑬ 的價值不只補洞**:**⑬ 的數就是「還剩多少真的要做」** ——
    #    今天那個數是靠**扣掉** ②③⑥ 算出來的, 而**靠扣算出來的數, 每加一族就要重算一次,
    #    且沒有人會去驗那個扣對不對** ⇒ ⑬ 把它從【減法】變成【直接數得出來】。
    # 🛑🛑 **釘死一句(主視窗 A 指定)**:**⑬ 是【沒有外部阻塞】, 不是【簡單】。**
    #    ⚠️ 下一個人很容易把它讀成「這些是好做的」—— 而 `:689` 要**跑一次真的建單流程**。
    '待辦': '⑬',       # 就是待辦(沒有外部阻塞)
    # 🔴🔴 ⑭ 是 Sean 2026-09-08 `Q5` 拍的, 而它與 ①〜⑬ **不是同一種東西**:
    #    ①〜⑬ 回答「這一列【為什麼還沒做完】」—— 它們的前提是**有人判過它擋不擋上線**。
    #    ⑭ 回答的是**那個前提本身不成立**:token 欄寫的是 `⟨未判(…)⟩` ⇒ **連擋不擋都還沒有人看。**
    # 🔬 **加值前先量**(`-ship` 2026-09-08 當場, 尺 = `leading_token()` 同一把):
    #    `⟨未判` **41 列**(open 34 · doing 3 · parked 2 · done 2);⚪ 負對照現造字面 `⟨zzqwin` ⇒ **0**。
    #    正對照同一發:`⟨擋` 94 · `⟨不擋` 459 · `⟨—` 7 ⇒ 尺不是恆真、也不是恆假。
    # 🛑🛑 **而 ⑭ 的族碼【不會】把那 41 列加進「還在擋」那個數** —— 那是改一個判定, 不是改一個欄位,
    #    而那些列的判定權在開列的人(`⟦ship-UNJUDGEDOUTOFFAMILY⟧` 逐字警告過)。
    #    ✅ ⇒ 本支的做法是**另外印一行**:「另有 ⟨未判⟩ N 列」—— 報「還剩多少」時**兩個數一起報**。
    '未判': '⑭',       # 連擋不擋都還沒有人判(token 欄本身是 `⟨未判…⟩`)
}
# 🛑🛑 **而 ⑨「讀不出來」與【未分族】是兩件事, 本支刻意分開印**:
#   · ⑨ = **有人看過這一列, 而填不出來** ⇒ 那是一個結論
#   · 未分族 = **沒有人看過** ⇒ 那是一個空白
#   ⇒ 📌 **兩者在欄位上都是「沒有族碼」, 而它們的下一步完全相反**
#     (⑨ 不必再看;未分族要有人去看)⇒ **合起來印的話, 板上會少掉「已經有人放棄過」這個資訊。**
# ② 推測用的字面 —— 🔴 **只用【誰欄】與【末格】, 不用標題**(標題最會過期, 今晚實測三次)
GUESS = [
    ('③', re.compile(r'等\s*Sean|要\s*Sean\s*拍|決策題|他拍|Sean\s*的手|不可逆')),
    ('④', re.compile(r'另一個\s*repo|不在本\s*repo|跨\s*repo|/Users/sean_1/(?!pcm-w)')),
    ('②', re.compile(r'裁「?乙?不做|開一列記著|只上板不修|今晚不動')),
    ('①', re.compile(r'已在\s*origin/dev|碼已完成|已落地|接手中|doing')),
]


def family_of(token_cell, who_cell, tail):
    """回 `(明示族, 推測族)` —— 🔴 **兩個都回, 呼叫端不准把它們加在一起。**

    明示族來自 token 欄的擴充字面(權威);推測族來自誰欄與末格(**不是答案**)。
    兩者都沒有 ⇒ `(None, None)` = **未分族**, 而那一堆是本支要印的第一個數。
    """
    # 🔴 ⑭ 排在擴充字面之前:`⟨未判…⟩` 的族**寫在 token 自己身上**, 不必有人再寫一次
    #    ⇒ 它是【明示】不是【推測】(權威來源就是那一列的 token 欄本身)。
    if token_cell.startswith('⟨未判'):
        return ('⑭', None)
    exp = None
    for k, v in FAMILY.items():
        if '⟨擋·' + k in token_cell or '⟨不擋·' + k in token_cell:
            exp = v
            break
    if exp:
        return (exp, None)
    hay = who_cell + ' ' + tail
    for fam, pat in GUESS:
        if pat.search(hay):
            return (None, fam)
    return (None, None)


def poscontrol_without_strip(row):
    """規則⑬:寫了「正對照」+ 數字, 而沒有說剝註解前後。回那個數字或 None。

    🔬 起因(2026-09-07, 一夜四次同形):`grep`/`LIKE`/`strpos` **分不出碼與註解**,
       而**註解裡最常出現的正是你在找的那個字**。當天實例:
       正對照 `19` ⇒ 剝註解後 **15**(4 個在註解裡)· `WRITE_PAT` 20 ⇒ 剝後 18。
    🔵 **它只問一句, 不擋、不猜、不解析** —— 而它問在**落地那一刻**。
    ⚠️ 判準刻意寬:有「正對照」+ 數字 + **沒有**「剝」字 ⇒ 問。誤報成本 = 被問一句。
    """
    if '正對照' not in row or '剝' in row:
        return None
    m = re.search(r'正對照[^0-9]{0,40}(\d+)', row)
    return m.group(1) if m else None


def measured_without_date(row):
    """規則⑫ 的判準:`⟨已量⟩` 有沒有帶日期。回那段字或 None。

    🔴 **為什麼日期是關鍵那一半, 不是裝飾**(2026-09-07 主視窗點頭時的理由):
       「量完了」**會過期**。光 `-ship` 一個窗當天就撞到三次板列數字過期而【零訊號】
       (SHIPPDF1 的相依 0 · GATECOVERAGEBYTREE 的 16 棵 · 它自己給主視窗的 21 棵)。
       ⇒ 📌 **沒有日期的 `⟨已量⟩`, 會變成下一個「當時是真的」的句子。**

    🛑🛑 **這個 token 【不是背書】, 它只是把「沒人看過」從堆裡分出來。**兩句射程要一起讀:
       ① **它不保證量對了** —— `-ship` 2026-09-07 就有一發正對照回 0 而那個 0 是假的
          (`\b` 在本 repo 的 grep 靜默不匹配)。
       ② **它不保證標題還成立**(`-6f` 抓到的)—— `⟦b9-SRVMIN⟧` 是**量過而讀數仍然對**,
          過期的是**標題**(它寫「沒有人量過」)⇒ `⟨已量 09-05⟩` 會是**對的**, 而那一列照樣誤導。
       🔴 **⇒ 少了這兩句, `⟨已量⟩` 會讓下一個人【停止查證】—— 而那比沒有 token 更糟。**
          (第二判準「標題與末格矛盾」是**語意**, 機器判不了 ⇒ 已記成一列, 不在本規則做。)
    """
    m = re.search(r'⟨已量([^⟩]*)⟩', row)
    if not m:
        return None
    return None if re.search(r'20\d\d-\d\d-\d\d', m.group(1)) else m.group(0)


def undated_reltime(row):
    """規則⑩ 的判準:這一列有沒有【找不到日期可定錨的相對時間】。回關鍵字或 None。

    🔴 **本函式是【正式路徑與 selftest 共用的那一份】** —— 2026-09-07 code-reviewer 抓到
       第一版 selftest 自己抄了一份邏輯 ⇒ **兩份分家時, selftest 綠證明不了正式那段對**。
    🔴 第三個樣式是**正則**:板上逐字 `第 N 次` 只有 6 處(未填值的模板字),
       而真實計數「第八次 / 第三次 / 第 5 次」有 359 處。
    ⚠️ 窗口 120 是**字元**不是位元組(中文一個字算一個)。
    """
    for _kw, _re in (('今晚', None), ('今天', None), (None, RELCOUNT)):
        if _re is None:
            p = row.find(_kw)
        else:
            mm = _re.search(row)
            p = mm.start() if mm else -1
            _kw = mm.group(0) if mm else ''
        if p < 0:
            continue
        if '2026-' in row[max(0, p - 120):p + 120]:
            continue
        return _kw
    return None


def _strip_mark(s):
    """把刪除線與人貼上去的「重複列」標籤剝掉(第四層的【第二種讀法】)。"""
    return re.sub(r'重複列|~~', '', s)


def _norm_title(cell):
    """標題欄正規化 —— ⚠️ **刻意【不剝】刪除線 `~~…~~`**。

    🛑 `-ship` 2026-09-07 坑 3, 我親手重現:把來源列標上 `~~…~~ ⛔ 重複列` 之後,
       **剝刪除線的量具命中 1 ⇒ 0**。
    🎯 **貼上「這是重複」的標籤, 會讓找重複的量具漏掉它**
       ⇒ 閘對【已標記的那些】永遠印綠, 而人會以為清乾淨了。
    """
    return re.sub(r'[*`⛔✅🔴🔵🟢🟡🛑📌🎯⚠️🔀 \u3000]', '', cell)


def safe(s):
    """把要印到終端機的字串裡的控制字元換掉。

    🔴 codex 2026-09-07 must-fix ④:板的內容是**別的窗寫進來的**, 而我原本把錨與 token
       原封印到終端機 ⇒ 植入 ANSI / OSC 序列可以**偽造或清掉本閘自己的輸出**;
       支援 OSC 52 的終端甚至會被改寫剪貼簿。
    🛑 **`rc=0` 消不掉這些副作用** —— 副作用發生在「印出去」那一刻, 不在 rc 上。
    """
    return ''.join(c if (c == '\t' or ord(c) >= 0x20) and ord(c) != 0x7f else '?' for c in str(s))


def last_idx(line, fields):
    """最後一格的索引。行尾有沒有分隔符要分開處理(板上兩種形狀都有)。"""
    return len(fields) - 2 if re.search(r'\|\s*$', line) else len(fields) - 1


def leading_token(line, fields):
    """**唯一的 token 定義:最後一格【開頭】那一個。** 其餘角括號一律是內文字面。

    🔴 2026-09-07 主視窗裁定改成這個定義, 而理由是量到的:
       本工具原本認【整行任何一個 ⟨…⟩】⇒ 於是**每一個寫規則、寫訂正、解釋這個 token 的人**
       都會製造一次「違規」。一夜之內撞了 6 次, 其中兩次是我在【解釋這個坑的那句話裡】犯的。
    📌 **⇒ 病灶不是那些人不小心, 是尺把【討論】讀成了【事實】。**
       修產物(把角括號改方角)有看不見的到期日;修這個定義才是修產生器。
    """
    cell = fields[last_idx(line, fields)].lstrip()
    m = FIND.match(cell)
    return m.group(0) if m else None


def unjudged_rows(lines):
    """⑭:token 欄開頭是 `⟨未判…⟩` 的列 —— **沒有人判過它擋不擋上線**。

    🔴 **為什麼要有這一支**(`⟦ship-UNJUDGEDOUTOFFAMILY⟧`):`blocking()` 的分母逐字是
       `tok.startswith('⟨擋')` ⇒ 📌 **`⟨未判⟩` 的列【根本不在它的視野裡】**,
       而「還剩多少」那個數就是從那個分母出來的 ⇒ **它排除掉整整一類:還沒有人判過的那些。**
    🛑 **而「還沒判」不等於「不用做」** —— 它等於「連要不要做都還沒有人看」。
    ✅ **本支不改判定、不把 `⟨未判⟩` 算進「還在擋」** —— 它只是把那個數**印出來讓人看見**。
    🔵 尺與 `blocking()` **共用 `leading_token()` 那一把**(不自己數欄 —— 少報比多報難發現)。
    """
    out = []
    for n, line in enumerate(lines, 1):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 5:
            continue
        tok = leading_token(line, f)
        if not tok or not tok.startswith('⟨未判'):
            continue
        out.append((n, f[1].strip(), tok[:30]))
    return out


def blocking(path):
    """`--blocking`:用 **token 欄**(不是整行)列出還在擋上線的列。

    🔴 **這支工具存在的理由是量出來的, 不是覺得**(2026-09-07 tidy 自陳, 逐字):
       > **今晚剛記過「整行 grep 撈到只是提它的列」, 我在下一個小時又踩一次。**
       ⛔ 整行 `'⟨擋⟩' in line` ⇒ **7 列** · ✅ 只看 token 欄開頭 ⇒ **5 列**
       🔬 多報的兩列(`:1045` / `:1467`)token 欄是 `⟨不擋⟩`, **內文在引用「⟨擋⟩」這個字**
    🔴 **而同一晚主視窗也踩了一次**:整行 grep 給了 Sean 一個錯的 `108`(含 done/parked/doing),
       auth 抓到後訂正成 70。
    📌 **⇒ 兩個人在同一晚各踩一次, 而第二次是在第一次被記下來之後**
       ⇒ **那不是「每個窗自己小心」治得了的** ⇒ 換一把尺, 不是加一條紀律。

    🔴🔴 **而【修完多報之後我立刻製造了一次少報】, 這一格比上面那一格重要**:
       我第一版的尺把 token 欄釘死成 `c[5]`(第 6 欄), 又要求 `startswith('⟨擋⟩')` 完全相符
       ⇒ 對 open 態印 **5**, 而真值 **70**(欄數不同的列全漏 · `⟨擋(tidy 判 ③)⟩` 全漏)。
       🛑 **我還拿那個 5 下了「沒有錨可以回你」的結論。**
    📌 **⇒ 少報比多報難發現** —— 多報會有人來吵, 少報只會讓人以為沒事。
    ✅ **⇒ 所以本函式【不自己數欄】, 一律用 `leading_token()`**(它用 `last_idx()` 找最後一格),
       而 `startswith('⟨擋')` 不是 `== '⟨擋⟩'`。🔵 `⟨不擋…⟩` 不會被它抓到(前綴不同)。
    🟢 **正對照(獨立來源)**:主視窗同一晚用另一把尺訂正給 Sean 的數也是 **70**。

    🛑 **它不改判定、不動板列** —— 同一份板, 只是換一把尺去讀。
    """
    marked, done_rows, open_rows = [], [], []
    _lines = io.open(path, encoding='utf-8').read().split('\n')
    for n, line in enumerate(_lines, 1):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 5:
            continue
        tok = leading_token(line, f)
        if not tok or not tok.startswith('⟨擋'):
            continue
        st = f[1].strip()
        m = re.search(r'⟦[^⟦⟧]+⟧', f[2])
        exp_fam, guess_fam = family_of(tok, f[4] if len(f) > 4 else '', f[-2][-500:])
        row = (n, st, m.group(0) if m else '(無錨)', _strip_mark(f[3]).strip()[:58],
               exp_fam, guess_fam)
        marked.append(row)
        (done_rows if st == 'done' else open_rows).append(row)
    # ② 三個數一起印 —— 今天立的那條(「態 done 而 token 仍 ⟨擋⟩」是一列自相矛盾)自己印出來
    print(f'標記 ⟨擋⟩ {len(marked)} · 其中 done {len(done_rows)} · 還在擋 {len(open_rows)}')
    # ══ 族欄(規格 `規格-板閘加族欄-給ship-20260907.md`)══
    # 🔴 **未分族印在第一個** —— 規格問「既有那些列誰來填」, 而答案是【沒有人】
    #    ⇒ 不印它的話, 空欄與「已經分完了」印同一個東西。
    exp = [r for r in open_rows if r[4]]
    gue = [r for r in open_rows if not r[4] and r[5]]
    non = [r for r in open_rows if not r[4] and not r[5]]
    print(f'  ── 族:🔴 未分族 {len(non)} · ✅ 明示 {len(exp)} · 🟡 推測 {len(gue)}'
          f'(**推測不是答案, 不進分子**)')
    if exp:
        from collections import Counter
        c = Counter(r[4] for r in exp)
        print('     明示:' + ' · '.join(f'{k}×{v}' for k, v in sorted(c.items())))
    if gue:
        from collections import Counter
        c = Counter(r[5] for r in gue)
        print('     🟡 推測(從【誰欄與末格】推, **刻意不看標題** —— 標題最會過期):'
              + ' · '.join(f'{k}×{v}' for k, v in sorted(c.items())))
    print('  🛑 族碼:①有人在做 ②裁不做只記著 ③決策題等 Sean ④跨 repo ⑤量完待翻態 ⑥沒有關閉條件'
          ' ⑦等真資料 ⑧時刻觸發(不是人) ⑨讀不出來'
          ' ⑩等主視窗(不是 Sean) ⑪等他動手(已決定) ⑫要先提 plan'
          ' ⑬就是待辦(沒有外部阻塞) ⑭連擋不擋都還沒有人判')
    print('  🔴 **⑬ 是【沒有外部阻塞】, 不是【簡單】** —— 它的數 = 「還剩多少真的要做」, '
          '而那是唯一該回答「還剩多少」的數(②③⑥ 今天是靠【扣】算出來的)。')
    print('  🔴 ⑨【讀不出來】是合法值不是失敗 —— 沒有這個值可填的人會硬塞一個;'
          '而它與【未分族】不同:⑨ 是有人看過而填不出來, 未分族是沒有人看過, 兩者下一步相反。')
    print('  🔴 而 ②③⑥ 不該算進「還剩多少」—— 而它們今天算在裡面(規格第 2 條)。')
    print('  ✅ 要把一列變成【明示】:在 token 欄寫成 `⟨擋·決策⟩` 這種形狀(族名見上)。')
    # 🔴🔴 **2026-09-07 `-ship` 自陳:上面那張族碼表【列了 12 族, 而推測尺只認得 4 族】。**
    #    我把 ⑩⑪⑫ 加進 `FAMILY`(明示字面)、加進印出來的族碼表、selftest 也綠 ——
    #    而 `GUESS` 裡**一條對應的樣式都沒有**, 板上也**沒有任何一列**寫過 `⟨擋·等主視窗⟩`
    #    ⇒ 📌 **⑤〜⑫ 這八族今天在本支的讀數恆為 0, 而那個 0 的意思是「沒有人寫過那個字面」,
    #       不是「板上沒有那種列」**(我手工掃全板撈到 7 列疑似⑩, 而本支印 0)。
    # 🎯 **⇒ 又一次「自檢 PASS 只證明那段邏輯對, 不證明它被接上了」** ——
    #    而這一次騙過我的是**族碼表自己**:它把沒接上的族印得跟接上的族一模一樣。
    # 🛑 **而不補 `GUESS` 樣式是【知情的選擇】不是漏**:主視窗 2026-09-07 剝 ⑩ 的 7 列時量到
    #    **7 列裡只有 2 列真的在等它**, 成因是「主視窗裁」這四個字在**已裁**與**待裁**兩個
    #    世界裡逐字相同 ⇒ **關鍵字尺分不出時態** ⇒ 補樣式只會多量產誤報。
    _impl = sorted({f for f, _ in GUESS})
    _all = sorted(set(FAMILY.values()))
    _gap = [f for f in _all if f not in _impl]
    print(f'  🔴 **推測尺只實作了 {"".join(_impl)} 這 {len(_impl)} 族** —— '
          f'{"".join(_gap)} 只有【明示】那一條路(要有人手寫 token 字面)。')
    print('     📌 **⇒ 那幾族印 0 = 沒有人寫過那個字面, 不是板上沒有那種列。**'
          ' 關鍵字尺分不出時態(「主視窗裁」在已裁與待裁逐字相同)⇒ 刻意不補樣式。')
    for n, st, a_, t, e_, g_ in open_rows:
        tag = f'[{e_}]' if e_ else (f'[~{g_}]' if g_ else '[ ? ]')
        print(f'  :{n} {tag} [{st}] {a_} {t}')
    if done_rows:
        print(f'⚠️ 態 done 而 token 仍 ⟨擋⟩ ⇒ {len(done_rows)} 列自相矛盾(判 token 該撤, 還是態該退回):')
        for n, st, a_, t, _e, _g in done_rows:
            print(f'  :{n} [{st}] {a_} {t}')
    # ═══ ⑭「未判」(Sean 2026-09-08 `Q5`;`⟦ship-UNJUDGEDOUTOFFAMILY⟧`)═══
    #   🔴 **這一段【不加進上面那個數】, 它是第二個數。**
    _unj = unjudged_rows(_lines)
    _unj_open = [r for r in _unj if r[1] not in ('done', 'parked')]
    print(f'🔴 ⑭ 另有 ⟨未判⟩ **{len(_unj)} 列**(其中還活著的 {len(_unj_open)} 列)'
          f' —— **不在上面那個「還在擋 {len(open_rows)}」的分母裡。**')
    print('  🛑 **報「還剩多少」時兩個數要一起報** —— 「還沒判」不等於「不用做」, '
          '它等於【連要不要做都還沒有人看】。')
    print('  ⚠️ **不要順手把 `⟨未判⟩` 改成 `⟨擋⟩`** —— 那是改一個判定, 判定權在開列的人。')
    print('🔵 尺 = token 欄【開頭】那一個 ⟨…⟩;內文提到「⟨擋⟩」的列不算(那正是整行 grep 多報的來源)。')
    return 0


def scan(lines):
    """回 (misplaced, done_blocking);每項是 (行號, 錨或欄2, 說明)。

    ⛔ ~~原本還回 (dup_same, dup_diff) 兩類「同一列有多個 token」~~
    ⇒ 🔴 **2026-09-07 改成「只認最後一格開頭那一個」之後, 那兩類【在結構上永遠是 0】。**
       🛑 **而一個永遠印 0 的計數器, 與「檢查過了沒有問題」印同一個東西** ⇒ 直接移除, 不留恆綠讀數。

    done_blocking = 態是 `done` 而 token 仍是 ⟨擋⟩ 的列。
    🔴 **只警告, 不影響 rc** —— 2026-09-07 主視窗裁「先量分母」:
       它可能是「做完了忘了更新 token」, 也可能是「態被誤標 done」,
       而**這兩件的修法相反** ⇒ 工具不猜, 印出來給人判。
    🛑 失效方向已量到:2026-09-07 那 4 列全部是【做完了而 token 停在擋】
       ⇒ 讀 token 的人會以為它還在擋 ⇒ 那是【派重了】的燃料。
    """
    misplaced, done_blocking = [], []
    ids = {}                               # 識別字 -> [行號…](重複偵測, 見 dup_ids)
    titles = []                            # (行號, 正規化標題, 錨)(第四層 ≥0.90 相似用)
    for n, line in enumerate(lines, 1):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 4 or f[1].strip() not in CLOSED:
            continue
        # 🔴 身分登記必須在【有沒有 token】那道檢查【之前】——
        #    2026-09-07 實測:原本寫在它後面 ⇒ `if not toks: continue` 先跑掉
        #    ⇒ **沒有 token 的列(多半是 done)整批不進分母**, 而重複列大量住在那裡
        #    (那一發漏掉 2/3 組, 我是拿獨立的量測去比才發現的)。
        # 第四層要用的:標題欄原文(⚠️ **不剝刪除線**), 與這一列的錨(同錨的不重報)
        _m_anchor = re.search(r'⟦[^⟦⟧]+⟧', f[2])
        titles.append((n, _norm_title(f[3]), _m_anchor.group(0) if _m_anchor else None))
        m_id = re.search(r'⟦[^⟦⟧]+⟧|#\d+', f[2])
        if m_id:
            ids.setdefault(m_id.group(0), []).append(n)
        else:
            # 🔴 錨欄既沒有 ⟦錨⟧ 也沒有 #N 的列(2026-09-07 實測 160 列)——
            #    舊的唯一性守門與本閘的錨版都【結構上】看不到它們, 而它們照樣會被 merge 複製。
            #    ⇒ 退而用【事欄前 40 字】當身分。
            #    ⚠️ 這是【弱身分】:兩列開頭一樣不代表是同一件事 ⇒ 印出來的措辭必須是「疑似」,
            #       而不是斷言重複。判定要人開檔比對(本工具不猜)。
            ids.setdefault('〔無錨·事欄前40〕' + f[3].strip()[:40], []).append(n)
        toks = FIND.findall(line)
        if not toks:
            continue
        m = re.search(r'⟦[^⟦⟧]*⟧', f[2])
        key = m.group(0) if m else (f[2].strip() or f':{n}')
        tok = leading_token(line, f)
        if tok:
            # ✅ 最後一格開頭有 token ⇒ 它就是答案。**其餘角括號是內文, 不算違規。**
            if f[1].strip() == 'done' and tok.startswith('⟨擋'):
                done_blocking.append((n, key, tok[:24]))
            continue
        # ⛔ 開頭沒有 token, 而行內找得到 ⇒ 可能是合併推歪, 也可能【整列只有內文在講 token】。
        #    🛑 工具分不出這兩者 ⇒ 一律報「位移候選」, 而 --fix 只修**全行恰好一個**的情形。
        misplaced.append((n, key, f'{len(toks)} 個, 開頭沒有'))
    # ═══ 第四層:標題 ≥0.90 相似(`-ship` 2026-09-07 交件, 主視窗裁「併進來不另開閘」)═══
    #   🔴 為什麼要有它:我的第三層比【事欄前 40 字】—— 太窄。
    #      `-ship` 用 ≥0.90 全標題相似度量到 **4 對**, 我那一層只撈到 **2**。
    #      最難抓的一種是「**一列有錨、一列無錨**」:規則⑤只認錨重複(看不到)、
    #      我的弱身分比前 40 字(兩列前 40 字不同 ⇒ 也看不到)⇒ **兩把尺各自失明。**
    #
    #   🛑 **而【比對前不剝刪除線】是這一層的核心, 不是風格**(`-ship` 坑 3, 我親手重現):
    #      把來源列標上 `~~…~~ ⛔ 重複列` 之後, 剝刪除線的量具**命中 1 ⇒ 0**。
    #      🎯 **貼上「這是重複」的標籤, 會讓找重複的量具漏掉它**
    #      ⇒ 閘會對【已標記的那些】永遠印綠, 而人會以為清乾淨了。
    import difflib as _dl
    _norm = lambda s: re.sub(r'[*`⛔✅🔴🔵🟢🟡🛑📌🎯⚠️🔀 \u3000]', '', s)   # ⚠️ 刻意不剝 ~~
    _sim = []
    for _i in range(len(titles)):
        for _j in range(_i + 1, len(titles)):
            (na, ta, ka), (nb, tb, kb) = titles[_i], titles[_j]
            if ka and kb and ka == kb:
                continue                      # 同錨的已由 dup_ids 那層報過
            if abs(len(ta) - len(tb)) > max(len(ta), len(tb)) * 0.3:
                continue                      # 長度差太多 ⇒ 省掉比對
            # 🔴🔴 **佔位符要濾掉**(2026-09-08 `tidy`;`⟦ship-TWINROWNOGATE⟧` 接線時量到):
            #   板上有列的事欄逐字就是一個 `—`(破折號)⇒ 兩個 `—` 相似度 **1.0000**
            #   ⇒ 🔬 實測:不濾 ⇒ 全板命中 **1 對**(`:910` 與 `:1092`), 而**那一對不是重複列**,
            #      它們是兩列各自把事欄留空。⇒ 濾掉之後全板 **0 對**(門檻 8/16/24/40 都是 0)。
            #   🎯 **⇒ 這道閘第一次出聲若是假陽性, 它就再也不會被相信** —— 而它本來就沒出過聲。
            if len(_norm(ta)) < SIM_MIN_TITLE or len(_norm(tb)) < SIM_MIN_TITLE:
                continue
            # 🔴 **兩種讀法都算, 取【較高】的那個**(2026-09-07 實測逼出來的):
            #   `-ship` 坑 3 說「剝刪除線會讓量具失明」——【對, 而只治一半】。
            #   我照他的做(不剝)之後, 那一對的相似度是 **0.8197** ⇒ 仍然抓不到,
            #   因為 `~~` 與人貼上去的「重複列」三個字**自己拉低了相似度**。
            #   🎯 ⇒ **標籤讓量具失明有兩條路:剝掉它會少東西, 留著它會多東西。**
            #      **兩個方向都要算, 取較高的那個** —— 而**這是 selftest 那一格逼出來的**,
            #      不是我想到的(我第一版只照「不剝」做, 那一格就紅了)。
            r = max(_dl.SequenceMatcher(None, ta, tb).ratio(),
                    _dl.SequenceMatcher(None, _strip_mark(ta), _strip_mark(tb)).ratio())
            if r >= 0.90:
                _sim.append((round(r, 4), na, nb))
    _sim.sort(reverse=True)

    dup_ids = sorted((k, v) for k, v in ids.items() if len(v) > 1)
    return misplaced, done_blocking, dup_ids, _sim


def _report_sims(sims, red_lines):
    """第四層(≥0.90 全標題相似)的**輸出**。

    🔴🔴 **2026-09-08 `tidy`:這一層【算對了兩天而沒有被印出來】。**
    `scan()` 回傳四個值, 而 `--check` 與 staged 兩條路都寫
    `mis, dblock, dups, sims = scan(...)` ⇒ **`sims` 解包出來之後一次都沒有被讀。**
    🔬 量法(當場跑):`grep -n 'sims' <本檔>` ⇒ 修前 **2** 處, 兩處都是那一行解包。
    🎯 **⇒ 而 selftest 是綠的** —— 因為它**直接呼叫 `scan()`**, 測的是【函式】不是【接線】。
       📌 同族:memory `feedback_behaviour-tests-prove-a-path-not-the-wiring`
       (行為測證的是路不是接線)· `feedback_a-guard-has-two-denominators`
       (它掃得到嗎 / 它會被叫嗎 —— 修好第一個之後綠沒有變)。

    `red_lines` = 這顆 commit 【新增】的板列行號集合。
    🛑 **只對【自己新增的】判紅** —— 照本檔既有紀律(規則⑨ 那段逐字):
    「回頭掃只會讓每個人每次 commit 都看到一坨與他無關的舊債, 然後開始忽略這道閘」。
    """
    if not sims:
        return 0
    print(f'   ── 另外:標題【高度相似】的列 {len(sims)} 對'
          f'(≥0.90 全標題;規則⑤ 只認錨重複 ⇒ 看不到「一列有錨一列無錨」那種)')
    _red = 0
    for _r, _na, _nb in sims[:8]:
        _own = _na in red_lines or _nb in red_lines
        _red += 1 if _own else 0
        print(f'      👯 :{_na} 與 :{_nb} 相似 {_r}' + ('   🔴 這顆 commit 動到' if _own else ''))
    print('      🛑 **相似不等於重複** —— 先開檔看它們是不是同一件事, **不要直接刪**。')
    print('      🔵 比對【刻意不剝 `~~`】, 而且兩種讀法取較高的那個 ——'
          '貼上「重複列」標籤會讓找重複的量具漏掉它(`-ship` 2026-09-07 坑 3)。')
    if _red:
        print(f'      🔴 其中 {_red} 對【這顆 commit 動到了】⇒ 判紅。'
              '不是你造成的那些只警告。')
    return _red


def fix_line(line):
    """搬正 / 去重。回 (新行, 動作) 或 (原行, None)。"""
    f = SPLIT.split(line)
    toks = FIND.findall(line)
    if leading_token(line, f):
        return line, None                      # 開頭已有 token ⇒ 其餘是內文, 不動
    if len(toks) != 1:
        # 🔴 全行不只一個而開頭沒有 ⇒ **分不出哪個是被推歪的 token、哪些是內文**
        #    ⇒ 不猜(與「重複不同不修」同一個理由)。
        return line, None
    tok = toks[0]
    base = line
    for _ in range(len(toks)):
        base = FIND.sub('', base, count=1)
    f2 = SPLIT.split(base)
    j2 = last_idx(base, f2)
    cell = f2[j2]
    lead = len(cell) - len(cell.lstrip())
    f2[j2] = cell[:lead] + tok + ' ' + cell[lead:].lstrip()
    new = '|'.join(f2)
    # 🔴 驗:去掉 token 後(收斂空白)必須與原行去掉全部 token 後相同, 且剩恰好 1 個
    if re.sub(r'\s+', ' ', FIND.sub('', new, count=1)).strip() != re.sub(r'\s+', ' ', base).strip():
        return line, None
    if len(FIND.findall(new)) != 1:
        return line, None
    return new, ('去重+搬正' if len(toks) > 1 else '搬正')


def missing_token_whole_board(lines):
    """🔴 **整塊板【完全沒有 token】的資料列** —— 2026-09-07 線【帳號】`account` 加(主視窗 A 准)。

    ⚠️ **為什麼是【多一格】而不是改既有那格**:
      · `scan()` 那格答的是「**開頭沒有 token 而行內找得到**」(位移)。
      · 「**完全沒有 token**」那一格在 `check_staged()` 裡, 而**它的主詞只有【這顆 commit 新增的列】**。
      🔬 2026-09-07 實測:在板的**複本**上插一列**完全沒有 token** 的探針 ⇒ `--check` 照樣印「**0 列**」
         ⇒ 📌 **那把尺看不見它** —— 而那個 0 一直被當成「**全板都有 token**」在讀。
      ⇒ 本函式補的就是那個主詞:**整塊板, 不只 diff。** 既有兩格**一個字沒動**。

    🟡 **warn-only, 不進 rc**(主視窗裁, 理由與 front 那支同一句:
       **一道對幾十列叫的閘等於沒有閘** ⇒ 先讓它出聲, 不要先讓它擋)。

    🛑🛑 **本函式的分母【不乾淨】, 而這一句是它唯一的免責落點**:
      板上有些格子裡放著**含管線字元的程式碼**(`grep -iE 'a|b'`、`awk -F'|'`),
      逐行切 `|` 會把那種行**算成一列**。本函式排掉兩類:①態欄不是已知態 ②錨欄不像錨也不像編號。
      🔴 **而那些被排掉的行【我沒有逐行看過】** —— 2026-09-07 對真板實測排掉 **56 行**,
         而我只驗了「排掉之後剩下的那 1 列是什麼」。
      ⇒ **⇒ 可能有【真的漏 token 的列】被那兩條規則一起排掉了, 而目前沒有人量過。**
      ⇒ 所以呼叫端**印排除數**、也**印那一格的開頭**, 讓讀的人自己判 —— 見下方。
    """
    KNOWN = {'open', 'doing', 'parked', 'done', '—', '-'}
    missing, noisy = [], 0
    for n, l in enumerate(lines, 1):
        c = l.split('|')
        if len(c) < 7:
            continue
        st = c[1].strip()
        if st == '' or st == '態' or set(st) <= set('-: '):
            continue
        if st == 'done':
            continue                      # done 不要求 token(板上 262 列如此, 那是慣例)
        if st not in KNOWN:
            noisy += 1
            continue
        anchor = c[2].strip()
        if ('⟦' not in anchor) and (not anchor.lstrip('#').strip().isdigit()) and anchor not in ('—', '-', ''):
            noisy += 1
            continue
        if not c[5].lstrip().startswith('⟨'):
            missing.append((n, anchor[:30] or '(無錨)', st, c[5].strip()[:38]))
    return missing, noisy


def _selftest_missing_token():
    """🟢 正對照 / 🔴 負對照 —— 這一格存在的理由就是「沒有它會怎樣」被實測過一次。"""
    base = ['| 態 | # | 事 | 誰 | 卡什麼 |', '|---|---|---|---|---|']
    withtok = '| open | ⟦zzq-A⟧ | 有 token 的列 | 探針 | ⟨不擋⟩ 這一格有 token |'
    notok = '| open | ⟦zzq-B⟧ | 沒有 token 的列 | 探針 | 這一格開頭故意不放 token |'
    m1, _ = missing_token_whole_board(base + [withtok, notok])
    m2, _ = missing_token_whole_board(base + [withtok])
    ok1 = len(m1) == 1 and m1[0][1] == '⟦zzq-B⟧'
    ok2 = len(m2) == 0
    print(f'   世界一 插一列無 token ⇒ 數到 {len(m1)} 列(該 1, 且是 ⟦zzq-B⟧)  {"是" if ok1 else "🔴 否"}')
    print(f'   世界二 拿掉那一列   ⇒ 數到 {len(m2)} 列(該 0)              {"是" if ok2 else "🔴 否"}')
    return ok1 and ok2


def run(path, mode):
    lines = io.open(path, encoding='utf-8').read().split('\n')
    mis, dblock, dups, sims = scan(lines)
    if mode == '--check':
        print(f'── board-token-normalize --check:{path}')
        print(f'   最後一格開頭沒有 token 而行內找得到 {len(mis)} 列')
        for n, k, why in mis:
            print(f'   位移候選 :{n:5} {k}  {why}')
        if mis:
            print('   🟡 「位移候選」= 開頭沒 token 而行內有角括號。它可能是合併推歪,')
            print('      也可能是【整列只有內文在講 token】⇒ --fix 只修全行恰好一個的情形, 其餘不猜。')
        print(f'   ── 另外(只警告, 不影響 rc):同一個識別字出現在多列 {len(dups)} 個')
        for k, ns in dups:
            print(f'   重複列 {k:32} 出現在 :{ns}')
        if dups:
            print('   🔴 **同一件事被數兩次** ⇒ 擋數/進度都會虛胖, 而兩份的內容通常【不一樣】。')
            print('   ⚠️ 開頭是〔無錨·事欄前40〕的那幾筆 = **弱身分**(那些列沒有錨也沒有編號)')
            print('      ⇒ **只是【疑似】** —— 兩列開頭一樣不代表是同一件事, 要開檔比對才算數。')
            print('      🛑 產生器多半是 merge 本身:兩條線改同一列 ⇒ git 逐行比對看不出是同一列的兩版 ⇒ 兩行都留。')
            print('      ⇒ 修法不是刪一行, 是【開檔比對哪一份是超集】再合;而下一次 merge 還會再來。')
        miss_all, noisy = missing_token_whole_board(lines)
        # 🛑 **排除數與那一格的開頭都要印在【數字旁邊】, 不是只寫在檔頭** ——
        #    📌 會被複製走的是數字, 不是檔頭。
        print(f'   ── 另外(只警告, 不影響 rc):**整塊板**態非 done 而【完全沒有 token】{len(miss_all)} 列'
              f'(另有 {noisy} 行被判為【格內程式碼/非資料列】而排除;🔴 **那 {noisy} 行沒有人逐行看過** ——'
              f' 可能有真的漏 token 的列被一起排掉, 這個數不乾淨, 不要單獨引用)')
        for n, k, st, head in miss_all[:12]:
            # 🔴 **把那一格的開頭印出來** —— 少了它, 讀的人分不出「真的漏了 token」與
            #    「這是多行格子的續行、剛好被切成一列」。2026-09-07 實測:唯一那 1 列就是後者。
            #    📌 **印出來比多一道濾網誠實** —— 濾網會把「真的漏了」也一起濾掉, 而它濾掉時不出聲。
            print(f'   無 token :{n:5} {k:32} 態={st}  末格開頭={head!r}')
        if miss_all:
            print('   🔴 **這一格與上面那一格不是同一件事**:上面問「token 位移了嗎」, 這一格問「有沒有 token」。')
            print('      🛑 而既有那道「完全沒有 token」的檢查【只看這顆 commit 新增的列】 ——')
            print('         2026-09-07 實測:在複本插一列完全沒有 token 的探針, `--check` 照樣印 0。')
            print('      🟡 warn-only:一道對幾十列叫的閘等於沒有閘 ⇒ 先出聲, 不先擋。')
        print(f'   ── 另外(只警告, 不影響 rc):態 done 而 token 仍 ⟨擋⟩ {len(dblock)} 列')
        for n, k, why in dblock:
            print(f'   done+擋 :{n:5} {k}  {why}')
        if dblock:
            print('   🟡 它可能是【做完了忘了更新 token】, 也可能是【態被誤標 done】——')
            print('      🔴 這兩件的修法【相反】 ⇒ 本工具不猜, 開檔判。')
            print('      🛑 已量到的失效方向:讀 token 的人以為它還在擋 ⇒ 那是【派重了】的燃料。')
        _report_sims(sims, set())
        return 1 if mis else 0
    changed = 0
    for i, line in enumerate(lines):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 4 or f[1].strip() not in CLOSED or not FIND.search(line):
            continue
        new, act = fix_line(line)
        if act:
            lines[i] = new
            changed += 1
            m = re.search(r'⟦[^⟦⟧]*⟧', SPLIT.split(new)[2])
            print(f'   ✅ :{i+1:5} {act} {m.group(0) if m else ""}')
    io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'── 動了 {changed} 列')
    return 0


# ═══ 規則⑫:【無錨列】彼此重複(2026-09-07;`⟦ship-TWINROWNOGATE⟧`)═══
#   🔴 **為什麼規則⑤ 抓不到**:⑤ 認的是【錨重複】, 而它的分母是「帶錨的列」
#      ⇒ 📌 **一把尺的分母把病灶排除在外, 而它照樣印綠。**
#      (那一列自陳:規則⑤ 印的 `dup=0` 分母是 615 個帶錨的列, **結構上不含這 156 列**。)
#   🛑 **無錨列沒有身分** ⇒ 只能比**內容**;用 `difflib` 比事欄, 門檻 0.75。
#   🔬 **現況量過(2026-09-07)**:無錨列 **156** 列 · 兩兩比 **12,090** 對 ⇒ **相似 0 組**
#      ⇒ **不必 warn-only 起步**(主視窗紀律②:報 >20 才先 warn-only)。
#      🟢 尺是活的:同一列自比 ⇒ **1.0**。
#   ⚠️ **長度差 >35% 先跳過** —— 省掉大部分比對, 而它同時是**已知的漏法**:
#      一列被大量增補之後與它的孿生列長度拉開 ⇒ 本尺看不到。**寫出來, 不假裝沒有。**
# 🔴 第四層(≥0.90 全標題相似)的【最小標題長度】—— 少了它, 兩個 `—` 佔位符會相似 1.0000。
#   實測 2026-09-08:不濾 ⇒ 1 對假陽性;≥8 ⇒ 0 對(而 16/24/40 也都是 0 ⇒ 這個數不敏感)。
SIM_MIN_TITLE = 8
NOANCHOR_SIM_THRESHOLD = 0.75


def anchorless_dups(rows):
    """rows = [(行號, 事欄)] ⇒ 回 [(相似度, 行號1, 行號2)]，只收 >= 門檻的。"""
    import difflib
    import itertools
    out = []
    for (k1, a), (k2, b) in itertools.combinations(rows, 2):
        if not a or not b:
            continue
        # ⚠️ 這一行是【效能前置過濾】不是判準 —— 突變掉它結果不變(2026-09-07 實測),
        #    因為長度差很多的兩段 SequenceMatcher 本來就給不出 0.75。別把它當守門。
        if abs(len(a) - len(b)) / max(len(a), len(b)) > 0.35:
            continue
        r = difflib.SequenceMatcher(None, a, b).ratio()
        if r >= NOANCHOR_SIM_THRESHOLD:
            out.append((round(r, 3), k1, k2))
    return sorted(out, reverse=True)


def check_staged():
    """pre-commit 用:**讀 staged 那份**, 不讀工作樹。恆 rc=0(warn-only)。

    🔴 **為什麼一定要讀 staged**:工作樹那份可能有你【還沒 add】的修正,
       或別窗剛寫進來的東西 ⇒ 用它去判 staged 的內容, 兩個方向都會錯:
       ① 工作樹已修而 staged 沒修 ⇒ **印綠, 而進 commit 的那份是壞的**
       ② 工作樹壞而 staged 是好的 ⇒ 罵一個沒有問題的 commit
       🛑 2026-09-06 一夜有兩道閘踩過這一格(主視窗 04:0x 轉述)。

    🟡 **warn-only 是刻意的**:rc 恆 0, 不擋 commit。
       擋不擋等三天的分母出來再拍(主視窗 04:0x 裁)。
       ⚠️ ⇒ **本閘印了東西不代表 commit 會被擋;它印綠也不代表板子乾淨**
          (它只看這顆 commit staged 的那份)。
    """
    import subprocess
    # 🔴 `--no-renames`(codex 2026-09-07 must-fix ②):開了 rename detection 時
    #    `--name-only` **只列 post-image** ⇒ 把板 rename 走會漏掉原路徑, 然後安靜放行。
    #    關掉 rename 偵測 ⇒ 兩邊都會列出來。
    r = subprocess.run(['git', 'diff', '--cached', '--name-only', '--no-renames'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        # 🔴 git 自己失敗 ⇒ **不准印「乾淨」** —— 那正是「清單變空就放行」那個病。
        print('🟡 board-token 閘:`git diff --cached` 失敗 ⇒ **本閘這次沒有看過任何東西**')
        print(f'   rc={r.returncode} · stderr 首行:{(r.stderr or "").splitlines()[:1]}')
        return 0
    staged = [x for x in r.stdout.split('\n') if x.strip()]
    if BOARD not in staged:
        return 0                      # 板沒 staged ⇒ 安靜不跑
    # 🔴 2026-09-07 加(`-ship` 交件坑 1, 我實測重現):**板檔檔尾若沒有換行字元**,
    #    任何人用 `>>` 追加一列 ⇒ **那一列會黏在最後一行的尾巴上**。
    #    🛑 而最後一行常常是**引言文字**(不是 `| ` 開頭)⇒ **黏上去的那一整列從分母裡消失**
    #       ⇒ 閘印「0 違規」、計數器少算一列, **而畫面上一切正常。**
    #    📌 ⇒ 這一格問的不是格式, 是**下一個人追加時會不會安靜地掉一列**。
    _tail = subprocess.run(['git', 'show', f':{BOARD}'], capture_output=True)
    if _tail.returncode == 0 and _tail.stdout and not _tail.stdout.endswith(b'\n'):
        print('   🔴 **板檔檔尾沒有換行字元** ⇒ 下一個用 `>>` 追加的人, 那一列會黏在最後一行尾巴上')
        print('      ⇒ 若最後一行不是 `| ` 開頭(常常是引言), **那一整列會從所有計數的分母裡消失**。')
        print('      ⇒ 修法:`printf \'\\n\' >> ' + BOARD + '`')
    # 🔴 2026-09-07(`-ship` 交件坑 2):**負對照字串一旦被寫進板子, 它就不再是負對照。**
    #    實測板上:`zzz` **76** 命中 · `zzq8842` **12** · `zzz_bogus` **6**
    #    ⇒ 有人拿它們當「現造字串」跑 grep ⇒ **會回非 0, 而他分不出是誰貼的。**
    #    🎯 **⇒ 一個負對照的有效期, 到它被寫進被測的那份檔為止** —— 而**寫的人正是在證明它不存在**。
    #    ⇒ 這裡不擋(那是別人的列), 只在 staged 的板裡看到常見負對照字串時提醒一句。
    _dirty = [w for w in ('zzz_bogus', 'zzq8842', 'zz-bogus')
              if w in (subprocess.run(['git', 'show', f':{BOARD}'],
                                      capture_output=True, text=True).stdout or '')]
    # 🔴 2026-09-07 量到:七道閘合起來 14 行, 而**這一條 3 行與你這顆 commit 無關**
    #    ⇒ 照本檔已有的原則(分開【你剛做的】與【這個板子的舊帳】), 收成一行。
    if _dirty:
        print(f'   🟡 板上已含 {len(_dirty)} 個【常被當負對照】的字串({", ".join(_dirty)})'
              ' ⇒ 別再拿它們驗 0(負對照的有效期, 到它被寫進被測的那份檔為止)')
    s = subprocess.run(['git', 'show', f':{BOARD}'], capture_output=True, text=True)
    if s.returncode != 0:
        print(f'🟡 board-token 閘:讀不到 staged 的 {BOARD}(rc={s.returncode})⇒ **本閘沒看過**')
        return 0
    mis, dblock, dups, sims = scan(s.stdout.split('\n'))
    # ═══ 新開的列有沒有寫「怎樣算做完」(2026-09-07;主視窗三條件)═══
    #   ① warn-only ② **只看 staged diff 裡【新增】的 open/doing 列**(不回頭掃既有的 354 列)
    #   ③ 缺關閉條件字面 ⇒ 印一句「這列做到哪算完?」
    #   🔴 為什麼只看新增的:2026-09-07 量到 open+doing 413 列裡只有 59 列(14.3%)寫了關閉條件。
    #      **回頭補那 354 列是另一件事**;而修法在【開列那一刻】—— 掃全部只會讓每個人每次 commit
    #      都看到一坨與他無關的舊債, 然後開始忽略這道閘。
    d = subprocess.run(['git', 'diff', '--cached', '-U0', '--no-renames', '--', BOARD],
                       capture_output=True, text=True)
    # 規則⑨ 要知道每一列【自己那張表】的表頭欄數 ⇒ 先從 staged 全文建一張「行號 ⇒ 表頭欄數」。
    #   ⚠️ 而 diff 只給得起「新增的那一行長什麼樣」, 給不起它落在第幾行 ⇒
    #      改用【內容比對】:在 staged 全文裡找到那一行, 再往上找最近的表頭。
    _lines = s.stdout.split('\n')
    _heads = []
    for _i, _l in enumerate(_lines):
        if _l.startswith('|') and _i + 1 < len(_lines) \
                and set(_lines[_i + 1].replace('|', '').replace(' ', '')) <= set('-:') \
                and _lines[_i + 1].strip():
            _heads.append((_i + 1, len(SPLIT.split(_l)) - 2))

    def _cols_for(_row):
        """那一列所屬表格的表頭有幾欄。找不到那一行 ⇒ None(⇒ 規則⑨ 不叫, 寧可漏報不誤報)。"""
        try:
            _n = _lines.index(_row) + 1
        except ValueError:
            return None
        _h = [c for (ln, c) in _heads if ln < _n]
        return _h[-1] if _h else None

    newrows = []
    notok = []          # 新開的 open/doing 列而【完全沒有 token】
    stale = []          # 新增行裡指向板檔自己的裸行號(規則⑧)
    shape = []          # 新增的主表列欄數不是 5(規則⑨)
    reltime = []        # 新增/改動列裡沒有日期可定錨的相對時間(規則⑩)
    noanchor = []       # 新增列的錨欄裡沒有錨(規則⑪)
    nodate = []         # `⟨已量⟩` 沒有帶日期(規則⑫)
    nostrip = []        # 「正對照 N」而沒說剝註解前後(規則⑬)
    if d.returncode == 0:
        for ln in d.stdout.split('\n'):
            if not ln.startswith('+| ') or ln.startswith('+++'):
                continue
            row = ln[1:]
            # ═══ 規則⑨:新增的主表列欄數不是 5(2026-09-07;ship 量到板上 11 列)═══
            #   🔴 `scripts/md-table-overflow.py` **看得到而刻意不判紅**, 逐字理由「那一類內容沒掉、
            #      壞的是歸屬」—— 對通用 markdown 那是對的。**而這張表的歸屬就是一切**:
            #      少一格 ⇒ 末欄(帶 ⟨擋⟩ token)被渲染到【誰】欄的位置。
            #   🛑 為什麼只看【新增】:板上既有 11 列, 每一列要判斷內容該落哪兩格 ⇒ 那是判斷不是格式,
            #      回頭掃只會讓每個人每次 commit 都看到一坨與他無關的舊債, 然後開始忽略這道閘。
            #   🔬 而「找共同來源再一起修」那條路 2026-09-07 已經走過:`⟦b4-TBLCOLS1⟧` 09-01 裁乙,
            #      理由逐字「5 列連號 ⇒ **看起來是同一次貼上**」。實測**那個前提不成立** ——
            #      11 列的 blame 分散在 6 顆;而 blame 答的是「最後動到這行的人」不是「誰造成」,
            #      所以我又用【首次出現時的欄數】追了一列:`⟦b9-PROBESCHED⟧` **出生就是 4 欄**,
            #      而開它那顆(`65af2783e`)一共只開 2 列、**兩列都壞** ⇒ 不是大批次貼上。
            #      ⇒ 📌 **沒有共同產生器可找, 所以「等找到來源」是在等一個不會來的東西。**
            # 🔴🔴 **2026-09-07 訂正:分母不是「5 欄」, 是【那一列自己那張表的表頭】。**
            #    第一版 hardcode 5 ⇒ 我照它去「修」了 8 列, 而那 8 列屬於 `:1034` 那張
            #    **4 欄表**, 它們本來就是對的 —— **是我把它們補成 5 欄之後才 overflow**,
            #    被 `md-table-overflow` 擋下(它報「表頭在 :1034, 4 欄;這一列 5 格」)。
            #    🔬 全板實測 **100 張表頭**(2 欄 / 4 欄 / 5 欄 / 6 欄都有)。
            #    ⇒ 📌 **一把假設「全檔一種欄數」的尺, 在一個有 100 張表的檔上,
            #         會把【對的列】報成壞的 —— 而它報出來的樣子與真的壞掉一模一樣。**
            #    ⇒ 用各自表頭之後:ship 報 12 · 我第一版報 11 · **真值 3**。
            # ═══ 規則⑩:相對時間沒有日期可定錨(2026-09-07;主視窗裁)═══
            #   🔬 起因 `⟦tidy-RELATIVETIME⟧`:板上「今晚」461 處, 而它附近出現過的日期有
            #      18 個相異值、從 2026-08-14 到 2026-09-07 —— **橫跨 24 天**。
            #      「今晚第 N 次」35 處而只有 5 處附近有日期 ⇒ 30 處沒有錨。
            #   🛑 那種句子**是拿來當證據的**(「這已經是第八次」比「這發生過」有力得多),
            #      而**沒有人在維護那個計數器** —— 它跨午夜既不遞增也不重置,
            #      **而它讀起來仍然像一個當下的事實**。
            #   🔴 **只掃這次 staged diff 的新增/改動列。舊的 461 處明文不追**
            #      (主視窗裁:那是別人的字, 而在原作者脈絡裡是對的)。
            #   ⚠️ **窗口 120 字是【字元】不是位元組** —— 中文一個字算一個。
            # 🔴 **第三個樣式是【正則】不是逐字**(2026-09-07 code-reviewer 抓到):
            #    第一版寫逐字 `'第 N 次'` ⇒ 板上只命中 **6** 處(那是未填值的模板字),
            #    而真實計數「第八次 / 第三次 / 第 5 次」全板 **359** 處 —— **一個都攔不到**。
            #    ⇒ 📌 **我拿正則量出來的數字(35 處), 去佐證一條逐字比對的規則** ——
            #       那兩組不是同一批案例, 而 selftest 用的 fixture 剛好寫「今晚第八次」
            #       ⇒ **被第一個關鍵字「今晚」攔下 ⇒ 綠燈, 而第三個樣式從沒被驗過。**
            _hit = undated_reltime(row)
            if _hit:
                # 🔴 字元類要同時排除開括號與閉括號;只排閉括號那種是貪吃:錨欄若有一個【孤兒 ⟦】,
                #    它會從那個孤兒一路吃到後面真錨的 ⟧, 回傳一整段當「錨」。
                #    真板上今天 0 列有孤兒 ⇒ **這是潛伏的**, 而同檔其他 6 處都寫對了。
                _mA = re.search(r'⟦[^⟦⟧]+⟧|#\d+', SPLIT.split(row)[2]) if len(SPLIT.split(row)) > 2 else None
                reltime.append((_mA.group(0) if _mA else '(無錨)', _hit))
            _g9 = SPLIT.split(row)
            _hdr_cols = _cols_for(row)
            if len(_g9) >= 3 and _g9[1].strip() in ('open', 'doing', 'parked', 'done', 'standing') \
                    and _hdr_cols is not None and len(_g9) - 2 != _hdr_cols:
                _m9 = re.search(r'⟦[^⟦⟧]+⟧|#\d+', _g9[2])
                shape.append((_m9.group(0) if _m9 else _g9[2].strip()[:24] or '(無錨)',
                              len(_g9) - 2, _hdr_cols))
            # ═══ 規則⑪:新增的板列【錨欄沒有錨】(2026-09-07;tidy 量到擋列裡 10 列這樣)═══
            #   🔴 為什麼要管:無錨的列**所有錨工具都定位不到它** ——
            #      `board-row-by-anchor.sh` 撈不到、`what-happened-to.py` 問不了、
            #      規則⑤(錨重複)看不見它。⇒ 它在板上是一個**沒有把手**的東西。
            #   🛑 **而它最貴的代價是重複列**:本檔 :180 那段逐字寫著,重複列裡最難抓的一種
            #      就是「**一列有錨、一列無錨**」—— `⟦b9-ACLDRIFT5⟧` 那一對一夜回來三次,
            #      每次都讓擋數 +1,而**沒有一把尺看得見**(相似度那把是後來才補的)。
            #   🛑🛑 **本規則【不建議】從行內別處撿一個錨補上去** ——
            #      實測 `:729` 行內有 **8** 個錨、`:750` 有 4 個,而那些多半是**引用別列**。
            #      撿一個補上去 = **把別列的身分安到這一列頭上**,而那在 diff 上看起來像「補齊資料」。
            #      ⇒ 正確動作是**開一個新錨**,或**確認它其實是某列的重複**再走合併。
            #   🔵 只掃這次 staged 的新增列 —— 板上既有那 10 列是別人的字,回頭掃只會被忽略。
            # ═══ 規則⑫:`⟨已量⟩` 沒有帶日期(2026-09-07;主視窗點頭)═══
            #   🔬 起因:板上兩種列**在畫面上一模一樣而下一步完全不同** ——
            #      「**沒人量過**」vs「**量完了而沒有人動手**」。同形當天出現兩次
            #      (`⟦b9-SRVMIN⟧` 讀數 09-05 就有、沒人 REVOKE;`⟦acct-NOLAUNCHVERDICT⟧` 機制做好沒人確認)。
            #   🔵 **為什麼是末格 token 不是態**:態答「這件事在等什麼」, 證據答「背後有沒有讀數」
            #      —— 那是**兩個維度**, 塞進同一個欄位下次會再撞一次同型(本檔 :216 已經記過一次)。
            #   ⚠️ 射程與「它不是背書」的兩句寫在 `measured_without_date` 的 docstring, 不在這裡重複。
            _h13 = poscontrol_without_strip(row)
            if _h13:
                _m13 = re.search(r'⟦[^⟦⟧]+⟧|#\d+', SPLIT.split(row)[2]) \
                    if len(SPLIT.split(row)) > 2 else None
                nostrip.append((_m13.group(0) if _m13 else '(無錨)', _h13))
            _hit12 = measured_without_date(row)
            if _hit12:
                _m12 = re.search(r'⟦[^⟦⟧]+⟧|#\d+', SPLIT.split(row)[2]) \
                    if len(SPLIT.split(row)) > 2 else None
                nodate.append((_m12.group(0) if _m12 else '(無錨)', _hit12))
            _g11 = SPLIT.split(row)
            if len(_g11) >= 4 and _g11[1].strip() in ('open', 'doing', 'parked', 'done', 'standing') \
                    and not re.search(r'⟦[^⟦⟧]+⟧|#\d+', _g11[2]):
                noanchor.append((_g11[3].strip()[:30] or '(空事欄)',
                                 len(re.findall(r'⟦[^⟦⟧]+⟧', row))))
            if STALEREF.search(row):
                _g0 = SPLIT.split(row)
                _m0 = re.search(r'⟦[^⟦⟧]+⟧|#\d+', _g0[2]) if len(_g0) > 2 else None
                stale.append((_m0.group(0) if _m0 else row.strip()[:34],
                              STALEREF.search(row).group(0)))
            g = SPLIT.split(row)
            if len(g) < 4 or g[1].strip() not in ('open', 'doing'):
                continue
            m2 = re.search(r'⟦[^⟦⟧]+⟧|#\d+', g[2])
            key = m2.group(0) if m2 else g[3].strip()[:34]
            if not any(w in row for w in CLOSE_WORDS):
                newrows.append(key)
            # 🔴 2026-09-07 加:新開的 open/doing 列【完全沒有 token】。
            #    既有的「位移候選」要求行內至少有一個 ⟨…⟩ ⇒ **一個都沒有的列它看不到**。
            #    而那正是 2026-09-07 12:5x 我用手抓到的那一列(⟦f3-PDPSKUSTATIC⟧):
            #    計數器把它算進「未填」, 而**沒有人在看那一格** ⇒
            #    🛑 白話版頭條那句「全部判完了」**有 20 分鐘是不成立的, 而沒有東西會出聲。**
            if not FIND.search(row):
                notok.append(key)
    if notok:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 新開的 open/doing 列有 {len(notok)} 列【完全沒有擋上線 token】')
        for k in notok:
            print(f'   ⬜ 新列 {safe(k):32} ← **這列擋不擋上線?**(⟨擋⟩／⟨不擋⟩／⟨未判(為什麼)⟩)')
        print('   🟡 沒 token ⇒ 被算進「未填」⇒ **「還在擋幾件」少算了它, 而沒有東西會出聲。**')
    if reltime:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 動到的列有 {len(reltime)} 列'
              f'【相對時間旁邊 120 字內沒有日期】')
        for k, kw in reltime:
            print(f'   🕐 {safe(k):32} ← 「{kw}」附近沒有 `2026-…` 可以定錨')
        print('   🟡 板上「今晚」461 處, 而它附近的日期橫跨 **24 天**(08-14 ~ 09-07)')
        print('      ⇒ 讀的人沒有辦法知道是哪一晚。**舊的 461 處不追, 這一格只管你這次動的。**')
    if nostrip:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 動到的列有 {len(nostrip)} 列'
              f'【寫了「正對照 N」而沒說剝註解前後】')
        for k, num in nostrip:
            print(f'   📐 {safe(k):32} ← 正對照 {num} —— **剝註解前後兩個數都印了嗎?**')
        print('   🟡 grep/LIKE/strpos 分不出碼與註解, 而註解裡最常出現的正是你在找的那個字。')
    if nodate:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 動到的列有 {len(nodate)} 列'
              f'【`⟨已量⟩` 沒有帶日期】')
        for k, seg in nodate:
            print(f'   📏 {safe(k):32} ← 「{seg}」沒有 `20xx-xx-xx`')
        print('   🟡 「量完了」會過期 —— 沒有日期的 `⟨已量⟩` 會變成下一個「當時是真的」的句子。')
        print('   🛑 而它**不是背書**:不保證量對了, 也不保證標題還成立。')
    # ═══ 規則⑫:無錨列彼此重複 —— 對【全板】跑(不是只看 staged)═══
    #   🔵 為什麼與⑪ 不同層:⑪ 問「這一列有沒有錨」(單列, 掃 staged 就夠);
    #      ⑫ 問「這一列與【別的列】是不是同一件事」⇒ **它天生要看全板**。
    _al = []
    try:
        # 🔴🔴 **[2026-09-09 `-sync` 訂正我自己五分鐘前的修法]**
        #    我第一版只把 `except` 改成會出聲, 而**那守錯了失效模式**:
        #    `git show` 失敗時 `subprocess.run` **不拋例外**, 它回 `returncode != 0` 而 `stdout` 是空字串
        #    ⇒ 📌 **最可能的那一種壞法, 從來走不到 `except`** ⇒ 我的修法在它最需要出聲時是啞的。
        #    🔬 實測:`GIT_DIR=/tmp/不存在 … --check-staged` ⇒ 我加的那行訊息**一個字都沒印**。
        #    ✅ 所以要問 `returncode`, 不是等它拋。
        _p = subprocess.run(['git', 'show', f':{BOARD}'], capture_output=True, text=True)
        if _p.returncode != 0:
            raise RuntimeError(f'git show :{BOARD} rc={_p.returncode}')
        _full = _p.stdout
        _rows = []
        for _n, _l in enumerate(_full.split('\n'), 1):
            if not _l.startswith('| '):
                continue
            _c = SPLIT.split(_l)
            if len(_c) < 5 or _c[1].strip() not in ('open', 'doing', 'parked', 'done', 'standing'):
                continue
            if re.search(r'⟦[^⟦⟧]+⟧|#\d+', _c[2]):
                continue
            _rows.append((_n, _c[3].strip()))
        _al = anchorless_dups(_rows)
        _al_ok = True
    except Exception as _e:
        # 🔴🔴 **[2026-09-09 `-sync`]** ⛔ ~~舊版 `except: _al = []`~~ ——
        #    📌 **檢查器自己死掉, 與「板上零組重複」印【同一個東西】。**
        #    而規則⑫ 正是為了「已經發生過兩次而沒有任何東西叫」才存在的
        #    ⇒ 🛑 一個會靜靜變成 0 的規則⑫, 在它最需要出聲的那一天最可能是啞的。
        #    ✅ 出聲, 而**不改本函式 rc 恆 0 的既有契約**(那是另一個決定, 見下方逐字)。
        #    🔵 而這一格與「改成會擋」是兩件事:沒有這一格, 改成會擋也擋不住
        #      —— **一個壞掉的檢查在「會擋」的世界裡照樣放行。**
        _al = []
        _al_ok = False
        print(f'   🔴 規則⑫(無錨列重複)【沒有跑成】:{type(_e).__name__} —— '
              f'這【不是】「零組重複」。⇒ 這一發對無錨列重複沒有判別力, 不要當它綠。')
    if _al_ok and not _al:
        # 🔵 **把「真的 0 組」講出來** —— 沉默與 0 在報告上是同一個東西,
        #    而上面那個 🔴 分支要有東西可以對照才讀得懂。
        print('   ── 另外(只警告, 不影響 rc):【無錨列】彼此重複 0 組(規則⑫ 有跑成)')
    if _al:
        print(f'   ── 另外(只警告, 不影響 rc):【無錨列】彼此重複 {len(_al)} 組'
              f'(相似度 ≥ {NOANCHOR_SIM_THRESHOLD};規則⑤ 看不到它們, 它的分母只有帶錨的列)')
        for _r, _k1, _k2 in _al[:8]:
            print(f'      👯 :{_k1} 與 :{_k2} 相似 {_r}')
        print('      🛑 **無錨列沒有身分 ⇒ 只能比內容** —— 而合併時「一邊搬位置、一邊改內容」'
              '會被算成兩次獨立加入。⇒ 先開檔看它們是不是同一件事, **不要直接刪**。')
    if noanchor:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 新增的板列有 {len(noanchor)} 列'
              '【錨欄裡沒有錨】⇒ 所有錨工具都定位不到它')
        for ev, other in noanchor:
            print(f'      ⚓ {ev}… (行內別處有 {other} 個錨)')
        print('      🛑 **不要從行內別處撿一個補上去** —— 那些多半是【引用別列】,'
              '撿來用等於把別列的身分安到這一列頭上。開新錨, 或確認它是重複再合併。')
    if shape:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 新增的主表列有 {len(shape)} 列【欄數不是 5】')
        for k, c, hc in shape:
            print(f'   ▦ {safe(k):32} ← 淨 {c} 欄, 而它那張表的表頭是 {hc} 欄')
        print('   🟡 少一格 ⇒ 末欄(帶 ⟨擋⟩ token)會被渲染到【誰】欄的位置 ⇒ 歸屬錯位。')
        print('      🔴 md-table-overflow 那支【看得到而刻意不判紅】(它的理由是「內容沒掉」)')
        print('      ⇒ 這一格由本閘接手, 因為【這張表的歸屬就是一切】。')
    if stale:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 有 {len(stale)} 處【指向板檔自己的裸行號】')
        for k, ref in stale:
            print(f'   🔢 {safe(k):32} ← `{ref}` **行號會移位, 改寫成 ⟦錨⟧**')
        print('   🟡 合併一次就移一格 ⇒ 它會指到別人那一列, 而讀起來像那一列的欄位。')
        print('      實錘 2026-09-07:`併自原 :565` 移位後指到 ⟦b9-Q15GAP⟧ ⇒ 有人判它是重複列。')
    if newrows:
        print(f'   ── 另外(只警告, 不影響 rc):這顆 commit 新開的 open/doing 列有 {len(newrows)} 列沒寫「怎樣算做完」')
        for k in newrows:
            print(f'   ❓ 新列 {safe(k):32} ← **這列做到哪算完?**')
        print('   🟡 沒關閉條件 ⇒ **接手的答不出「做到哪」、做完的答不出「能不能收」⇒ 兩邊都讓它卡著。**')
        print(f'   ⇒ 末格補一句即可, 例「**轉 `done`** = <可 yes/no 的條件>」。認得:{"／".join(CLOSE_WORDS)}')
    # 🔴 2026-09-07 12:5x 實測:一顆「開兩列」的 commit 讓五道閘印了 **16 行**,
    #    而其中一半是【與這顆 commit 無關的全板舊債】(別人的列)。
    #    🛑 那正是本檔自己寫過的失效模式:「每個人每次 commit 都看到一坨與他無關的舊債,
    #       然後開始忽略這道閘。」⇒ **它會先殺掉前面那兩道【針對你這顆 commit】的提醒。**
    #    ⇒ 📌 **全板性的三類在這裡只印【一行摘要】, 逐列清單留給 `--check`(人主動跑的那個)。**
    # ═══ 第四層(≥0.90 標題相似)的輸出 —— 2026-09-08 `tidy` 接線 ═══
    #   🔴 **這一層算對了而【從來沒有被印出來】**:`sims` 在兩條路都解包出來、一次都沒被讀
    #      (修前 `grep -n 'sims' <本檔>` ⇒ 2 處, 兩處都是那一行解包)。
    #   🛑 **而 selftest 是綠的** —— 它直接呼叫 `scan()`, 測【函式】不測【接線】。
    #   ⚠️ **這裡刻意 warn-only, 與本函式 rc 恆 0 的既有設計一致**(見下方那段逐字)。
    #      🔴 `⟦ship-TWINROWNOGATE⟧` 的關閉條件要求「對新增判紅」——
    #      **而把這支從 rc 恆 0 改成會擋, 是改一道全艦隊 pre-commit 閘的行為** ⇒ 另一個決定,
    #      不在本次接線裡。⇒ **接線先做完(它本來一個字都不說), 判紅另議。**
    _own_lines = set()
    for _ln in (d.stdout.split('\n') if d.returncode == 0 else []):
        if _ln.startswith('+| ') and not _ln.startswith('+++'):
            try:
                _own_lines.add(_lines.index(_ln[1:]) + 1)
            except ValueError:
                pass
    _report_sims(sims, _own_lines)

    _tot = len(mis) + len(dblock) + len(dups)
    if _tot:
        print(f'── board-token 閘(staged):全板另有 {_tot} 件舊帳'
              f'(位移 {len(mis)} · done而標擋 {len(dblock)} · 重複識別字 {len(dups)})')
        print('   ⚠️ **那些【不是這顆 commit 造成的】** ⇒ 逐列清單跑 '
              '`python3 scripts/board-token-normalize.py --check`')
    if mis or dblock or dups or notok or stale or shape or reltime or noanchor or nodate or nostrip:
        print('   🟡 **只是提醒, 不擋這顆 commit**(rc 恆 0)。修法:`python3 scripts/board-token-normalize.py --fix`')
        print('      🔴 而 `--fix` 動的是【工作樹】⇒ 修完要重新 `git add` 才會進這顆 commit。')
    # ═══ rc:【只有】規則⑫(無錨列彼此重複)會擋 ═══════════════════════════
    #  🔴🔴 **[2026-09-09 · 主視窗 A 裁, 而它是【一個】決定不是三個]**
    #     本函式原本 `rc 恆 0`。板列 `⟦ship-TWINROWNOGATE⟧` 的關閉條件寫「對新增判紅」——
    #     🛑 **而它沒說是哪一種新增**, 而本函式底下有【三個】warn-only:
    #     ```
    #     無錨列彼此重複        今天 0 組  ⇒ ✅ 翻(它已經發生過兩次, 而翻了不擋住任何人)
    #     態非 done 而完全沒 token  18 列  ⇒ 🛑 不翻 —— 翻了當場擋住全隊 18 次
    #     態 done 而 token 仍 ⟨擋⟩   2 列  ⇒ 🛑 不翻 —— 那兩列主視窗夜末要親自裁
    #     ```
    #     📌 **三個 warn-only 是三個決定, 不是一個** —— 照那一列的字面一起翻,
    #        會在凌晨擋住全隊 20 次。**分母先拆開, 決定才做得下去。**
    #
    #  🔴 **而這一格能成立的前提是上面規則⑫ 那個【不再靜默回 0】的修法**:
    #     一個壞掉的檢查在「會擋」的世界裡照樣放行 ⇒ **翻成會擋而不修那個, 是假的。**
    #
    #  ⚠️ **其餘兩格的 warn-only 行為逐字不動** —— 它們照樣印, 照樣不影響 rc。
    if _al:
        print('')
        print(f'🔴 **板列 ⟦ship-TWINROWNOGATE⟧:無錨列彼此重複 {len(_al)} 組 ⇒ 擋。**')
        print('   🛑 **無錨列沒有身分 ⇒ 只能比內容** —— 先開檔看它們是不是同一件事。')
        print('   ✅ 是同一件事 ⇒ **兩列零刪除合併成一列**(不是留一份丟一份), 合完回核兩邊的文字都還在。')
        print('   ⚪ 不是同一件事 ⇒ 給其中一列一個錨 ⇒ 它就有身分了, 規則⑤ 接手。')
        print('   ⚠️ 而**不要用 --no-verify 繞過** —— 這道閘擋的正是「合併做完了、來源列沒刪」, 而那已經發生過兩次, 兩次都沒有任何東西叫。')
        return 1
    return 0


def selftest():
    # 🔴 剝掉繼承來的 git 環境(自檢清單;git -C 擋不住它)
    for v in ('GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
              'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'):
        os.environ.pop(v, None)
    import tempfile
    d = tempfile.mkdtemp()
    bad = os.path.join(d, 'bad.md')
    good = os.path.join(d, 'good.md')
    rows_bad = [
        '| 態 | # | 事 | 誰 | 卡什麼 |',
        '|---|---|---|---|---|',
        '| open | ⟦x-A⟧ | 甲 | 誰 | ⟨擋(t)⟩ 正常:token 在格首 |',
        '| open | ⟦x-B⟧ | 乙 | 誰 | 別窗插的新內容 ⟨擋(t)⟩ 被推走的 |',
        '| open | ⟦x-C⟧ | 丙 | 誰 | ⟨不擋(t)⟩ 內文含 `a\\|b\\|c` 而 token 在格首 |',
        '| open | ⟦x-D⟧ | 丁 | 誰 | 內文含 `a\\|b\\|c` 而 ⟨不擋(t)⟩ 被推走 |',
        '| open | ⟦x-E⟧ | 戊 | 誰 | ⟨擋(t)⟩ 重複相同 ⟨擋(t)⟩ |',
        '| open | ⟦x-F⟧ | 己 | 誰 | ⟨擋(t)⟩ 重複不同 ⟨不擋(t)⟩ |',
        # 🔴 done+⟨擋⟩ 那條規則的【兩個世界】(2026-09-07 加)
        '| done | ⟦x-G⟧ | 庚 | 誰 | ⟨擋(t)⟩ 正對照:做完了而 token 停在擋 ⇒ 必須叫 |',
        '| done | ⟦x-H⟧ | 辛 | 誰 | ⟨不擋(t)⟩ 負對照:同樣是 done 而 token 不是擋 ⇒ 必須【不】叫 |',
        '| open | ⟦x-I⟧ | 壬 | 誰 | ⟨擋(t)⟩ 負對照:同樣是擋而態不是 done ⇒ 必須【不】叫 |',
        # 🔴🔴 2026-09-07 主視窗指定的那一格:**內文提到 token 字面, 不可以叫**
        #    舊定義(認整行任何一個)在這一列會叫 ⇒ 這格就是新舊定義的分水嶺。
        '| open | ⟦x-J⟧ | 癸 | 誰 | ⟨不擋(t)⟩ 這裡在解釋規則:token 是 ⟨未判(…)⟩ 不是 ⟨不擋⟩, '
        '而 ⛔ ~~⟨擋⟩~~ 是舊字面 ⇒ **全列 4 個角括號而只有開頭那個算** |',
        '| done | ⟦x-K⟧ | 子 | 誰 | ⟨—⟩ done 而開頭不是擋, 內文提到 ⟨擋⟩ ⇒ done+擋 必須【不】叫 |',
        # 🔴 重複識別字的兩個世界(2026-09-07 加;起因 = #64 被 merge 複製兩次而零守門出聲)
        '| open | #77 | 丑 | 誰 | ⟨擋(t)⟩ 正對照第一份:同一個 #77 出現兩列 ⇒ 必須叫 |',
        '| parked | #77 | 丑 | 誰 | ⟨擋(t)⟩ 正對照第二份(內容不同, 這正是 merge 產生的形狀) |',
        '| open | #78 | 寅 | 誰 | ⟨擋(t)⟩ 負對照:唯一的編號 ⇒ 必須【不】叫 |',
        # 🔴 第四層(≥0.90 相似)的兩個世界(`-ship` 2026-09-07 交件)
        #    ⚠️ 正對照【一列有錨一列無錨】—— 那是最難抓、而前三層都看不到的形狀
        '| open | ⟦x-TWIN⟧ | 這一列的標題刻意與下一列幾乎一字不差只差最後兩個字甲 | 誰 | ⟨擋(t)⟩ x |',
        '| open | — | 這一列的標題刻意與下一列幾乎一字不差只差最後兩個字乙 | 誰 | ⟨擋(t)⟩ x |',
        # 🔴 坑 3 的守門:同一對, 而來源列被標上刪除線 ⇒ **仍然要抓得到**
        '| open | ⟦x-STRK⟧ | 這是一段刻意用來測刪除線會不會讓量具失明的標題文字甲甲 | 誰 | ⟨擋(t)⟩ x |',
        '| open | — | ~~這是一段刻意用來測刪除線會不會讓量具失明的標題文字乙乙~~ ⛔ 重複列 | 誰 | ⟨擋(t)⟩ x |',
        # 🔴 無錨列的兩個世界(2026-09-07 加;那 160 列兩道閘本來都看不到)
        #    ⚠️ 這兩列【故意不放 token】—— 身分登記若寫在「有沒有 token」檢查之後就會漏掉它們,
        #       而那正是我 2026-09-07 犯過的 bug(漏掉 2/3 組)。
        '| done | — | 卯 | 誰 | 無錨正對照第一份, 而且這一列沒有 token |',
        '| done | — | 卯 | 誰 | 無錨正對照第二份(事欄前 40 字相同)|',
        '| done | — | 辰 | 誰 | 無錨負對照:事欄不同 ⇒ 必須【不】叫 |',
    ]
    io.open(bad, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')
    io.open(good, 'w', encoding='utf-8').write('\n'.join(
        [rows_bad[0], rows_bad[1], rows_bad[2], rows_bad[4]]) + '\n')
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    mis, db, dup, _sim1 = scan(io.open(bad, encoding='utf-8').read().split('\n'))
    ck('世界 A(壞)位移列', len(mis), 2)          # x-B, x-D(含跳脫那列)
    # ⛔ ~~原本斷言 x-E 重複相同=1 / x-F 重複不同=1~~
    # ⇒ 🔴 新定義下這兩列【開頭都有 token】⇒ 其餘角括號是內文 ⇒ **本來就不該叫**。
    ck('x-E(開頭有 token 而後面又一個)不叫', sum(1 for r in mis if r[1] == '⟦x-E⟧'), 0)
    ck('x-F(開頭有 token 而後面是不同的)不叫', sum(1 for r in mis if r[1] == '⟦x-F⟧'), 0)
    ck('done+擋 命中(正對照 x-G)', len(db), 1)
    ck('done+擋 命中的是 x-G(不是 x-H/x-I)', db[0][1] if db else '無', '⟦x-G⟧')
    # 🔴 新定義的兩格:內文提到 token 字面, 位移與 done+擋 都不可以叫
    ck('x-J(內文 4 個角括號)不算位移', sum(1 for r in mis if r[1] == '⟦x-J⟧'), 0)
    ck('x-J 不算位移(第二次問, 換個角度)', sum(1 for r in mis if r[1] == '⟦x-J⟧'), 0)
    ck('x-K(done, 內文提到 ⟨擋⟩)不算 done+擋', sum(1 for r in db if r[1] == '⟦x-K⟧'), 0)
    dupk = dict(dup)
    ck('重複識別字 正對照 #77 被抓到', '#77' in dupk, True)
    ck('重複識別字 #77 指出兩個行號', len(dupk.get('#77', [])), 2)
    ck('重複識別字 負對照 #78 不叫', '#78' in dupk, False)
    ck('重複識別字 負對照 ⟦x-A⟧(唯一)不叫', '⟦x-A⟧' in dupk, False)
    _p = {tuple(sorted((a, b))) for _, a, b in _sim1}
    ck('第四層 正對照(有錨 vs 無錨)被抓到', len(_sim1) >= 1, True)
    ck('第四層 坑3:來源列標了刪除線【仍然】抓得到',
       any('刪除線' in rows_bad[a - 1] or '刪除線' in rows_bad[b - 1] for a, b in _p), True)
    nk = [k for k in dupk if k.startswith('〔無錨')]
    ck('無錨重複 正對照「卯」被抓到', len(nk), 1)
    ck('無錨重複 指出兩個行號', len(dupk[nk[0]]) if nk else 0, 2)
    ck('無錨 負對照「辰」不叫', any('辰' in k for k in dupk), False)
    mis2, db2, dup2, _sim2 = scan(io.open(good, encoding='utf-8').read().split('\n'))
    ck('世界 B(乾淨)位移列', len(mis2), 0)
    ck('世界 B(乾淨)位移 2', len(mis2), 0)
    ck('世界 B(乾淨)done+擋', len(db2), 0)
    ck('世界 A rc', run(bad, '--check'), 1)
    ck('世界 B rc', run(good, '--check'), 0)

    # ── 🔴 2026-09-07 `account` 加:整塊板「完全沒有 token」那一格的正負對照 ──
    #    這一格存在的理由是【沒有它會怎樣】被實測過一次:在板的複本上插一列完全沒有 token
    #    的探針 ⇒ `--check` 照樣印 0 ⇒ 那個 0 的主詞只有【新增的列】。
    print('  ── 整塊板「完全沒有 token」那一格(warn-only, 不進 rc)──')
    ck('missing_token_whole_board 兩個世界', 0 if _selftest_missing_token() else 1, 0)
    print('  ── --fix 之後 ──')
    _before_angle = io.open(bad, encoding='utf-8').read().count('⟨')
    run(bad, '--fix')
    mis3, _db3, _dup3, _sim3 = scan(io.open(bad, encoding='utf-8').read().split('\n'))
    ck('修後 位移', len(mis3), 0)
    # ⛔ ~~修後 重複相同=0 / 重複不同(刻意不修)=1~~ ⇒ 兩類已隨新定義移除(見 scan docstring)。
    # ✅ 換成新定義下真正該問的:x-F 開頭有 token ⇒ --fix 不該動它, 它那兩個角括號要原封不動。
    ck('修後 x-F 的角括號一個沒少', io.open(bad, encoding='utf-8').read().count('⟨'), _before_angle)
    txt = io.open(bad, encoding='utf-8').read()
    # ═══ --check-staged 的兩個世界(2026-09-07;主視窗指定)═══
    #   🔴 這一段會【碰 git】⇒ 開一棵拋棄式 repo, 而繼承來的 git 環境在函式開頭已剝掉。
    import subprocess
    g = os.path.join(d, 'repo')
    os.makedirs(g, exist_ok=True)
    def git(*a):
        return subprocess.run(['git', '-C', g, *a], capture_output=True, text=True)
    # 🔴 codex 2026-09-07 must-fix ③:**不檢查 `git init` 的 rc 是危險的** ——
    #    `mkdtemp()` 跟隨 `TMPDIR`, 若它落在一棵真 repo 裡而 `init` 又失敗,
    #    後面的 `git -C` 會**往上找到那棵真 repo**, 改寫它的 config 並 stage 我的測試檔。
    #    ⇒ 三道:①init 的 rc 必須 0 ②**斷言 toplevel 就是我剛建的那個目錄** ③收尾刪掉整棵樹。
    r_init = git('init', '-q')
    if r_init.returncode != 0:
        print(f'  🔴 selftest 無法建拋棄式 repo(git init rc={r_init.returncode})⇒ 中止, 不往下跑')
        return 1
    r_top = git('rev-parse', '--show-toplevel')
    top = os.path.realpath(r_top.stdout.strip()) if r_top.returncode == 0 else ''
    if top != os.path.realpath(g):
        print(f'  🔴 selftest toplevel 不是我建的那棵({top!r} != {os.path.realpath(g)!r})⇒ 中止')
        return 1
    for _c in (('config', 'user.email', 't@t'), ('config', 'user.name', 't')):
        if git(*_c).returncode != 0:
            print(f'  🔴 selftest git {_c[0]} 失敗 ⇒ 中止')
            return 1
    os.makedirs(os.path.join(g, 'docs'), exist_ok=True)
    board = os.path.join(g, BOARD)
    io.open(board, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')
    other = os.path.join(g, 'other.md')
    io.open(other, 'w', encoding='utf-8').write('x\n')

    cwd0 = os.getcwd()
    os.chdir(g)
    try:
        # 世界一:板【沒有】staged ⇒ 安靜不跑(印 0 行)
        git('add', 'other.md')
        import contextlib, io as _io
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc_a = check_staged()
        ck('板沒 staged ⇒ rc', rc_a, 0)
        ck('板沒 staged ⇒ 一個字都不印', buf.getvalue().strip(), '')
        # 世界二:板 staged 且有違規 ⇒ 印出來
        # 🔴🔴 **[2026-09-09 · 主視窗 A 裁「只翻無錨列重複」之後, 這一格從 0 改成 1]**
        #    ⛔ ~~原本斷言 `rc 仍 0(warn-only)`~~ —— 那是**舊契約**。
        #    ✅ 而它現在斷言的是新契約:**這個 fixture 裡有一組無錨列重複(:21/:22 都是「卯」)**
        #      ⇒ 規則⑫ 擋 ⇒ rc=1。
        #    🔬 **這一格是【我改完才發現】的** —— selftest 當場紅, 而它紅得對:
        #      我以為我只是「翻一個旗標」, 而這個 fixture 一直帶著那組重複在測它。
        #      📌 **一個 fixture 刻意造的壞世界, 在契約改變的那一刻會變成【期望值要跟著改】** ——
        #        而分不出「我改壞了」與「期望值過期了」的唯一辦法, 是回去看那個 fixture 造了什麼。
        git('add', BOARD)
        buf2 = _io.StringIO()
        with contextlib.redirect_stdout(buf2):
            rc_b = check_staged()
        out = buf2.getvalue()
        ck('板 staged 有【無錨列重複】⇒ rc=1(規則⑫ 會擋)', rc_b, 1)
        ck('而它擋的理由印出來了(不是靜靜回 1)', '⟦ship-TWINROWNOGATE⟧' in out, True)
        # ⚪ **負對照 —— 少了它, 上面那個 1 可能是【任何一個 warn-only 都在擋】。**
        #    把那組重複拿掉(只留一個「卯」), 其餘違規原封不動 ⇒ rc 必須回到 0。
        #    🎯 **那一發才證明:翻動的是【無錨列重複】那一個, 不是三個一起。**
        #  🔵 判別方式刻意用【那一格的內容】而不是行號 —— fixture 之後有人加一列,
        #     行號會漂而「事欄是卯」不會。
        _seen_mao = False
        _kept = []
        for _r in rows_bad:
            _cols = _r.split('|')
            _is_mao = len(_cols) > 3 and _cols[3].strip() == '卯'
            if _is_mao:
                if _seen_mao:
                    continue          # 第二個「卯」丟掉 ⇒ 那組重複就不存在了
                _seen_mao = True
            _kept.append(_r)
        assert _seen_mao, 'fixture 裡找不到「卯」⇒ 這個負對照沒有跑到, 不要當它通過'
        io.open(board, 'w', encoding='utf-8').write('\n'.join(_kept) + '\n')
        git('add', BOARD)
        buf2b = _io.StringIO()
        with contextlib.redirect_stdout(buf2b):
            rc_b2 = check_staged()
        out2b = buf2b.getvalue()
        ck('拿掉那組重複 ⇒ rc 回到 0(其餘 warn-only 不擋)', rc_b2, 0)
        ck('而其餘 warn-only 照樣印(沒被我一起翻掉)', '只警告, 不影響 rc' in out2b, True)
        # 還原 fixture, 後面的格子照原樣跑
        io.open(board, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')
        git('add', BOARD)
        # ⛔ ~~原本斷言印出「位移候選」逐列~~ ⇒ 2026-09-07 12:5x 改成【一行摘要】
        #    (實測那顆 commit 印 16 行, 一半是與它無關的全板舊債 ⇒ 會殺掉針對性的提醒)
        #    ✅ 而這一格【不能因此拿掉】—— 它守的是「板 staged 時這道閘真的有輸出」。
        ck('板 staged 有違規 ⇒ 有印出全板摘要', '全板另有' in out, True)
        ck('板 staged ⇒ 不再逐列印全板舊債', '位移候選 :' in out, False)
        ck('板 staged 有違規 ⇒ 明說不擋', '不擋這顆 commit' in out, True)
        # ═══ 規則⑩ 的【端到端】兩個世界(2026-09-07;code-reviewer 抓的那一條)═══
        #   🔴 上面那組 `undated_reltime` 只驗【判準本身】, 驗不到:
        #      ① `+| ` 前綴過濾 ② `git diff -- <BOARD>` 的檔案限定。
        #      ⇒ 有人改壞那兩道, 純函式那組**照樣全綠**。這一組走真的 staged diff。
        _c0 = git('commit', '-q', '-m', 'base-for-rule10')
        if _c0.returncode != 0:
            print('  🔴 selftest 建 rule10 base commit 失敗 ⇒ 這一組空轉, 中止')
            return 1
        # 世界甲:板列新增一句沒有日期的「今晚」⇒ 該叫
        io.open(board, 'a', encoding='utf-8').write(
            '| open | ⟦zz10-A⟧ | 事 | 誰 | ⟨擋⟩ 今晚撞到同一件事, 轉 `done` = 修好 |\n')
        git('add', BOARD)
        _b = _io.StringIO()
        with contextlib.redirect_stdout(_b):
            check_staged()
        ck('⑩端到端 沒日期的新列 ⇒ 叫', 'zz10-A' in _b.getvalue(), True)
        # ═══ 規則⑪ 的【端到端】三個世界(2026-09-07;tidy)═══
        #   🔴 這一組刻意**不**在 selftest 裡重算判準 —— 今天已經吃過兩次虧
        #      (guards-what 的 R2、派工表那兩格),重算的版本三發突變全綠。
        #      ⇒ 一律走 `check_staged()`, 比它**印出來的字**。
        io.open(board, 'a', encoding='utf-8').write(
            '| open | — | 錨欄是破折號的新列 zz11A | `mail` | ⟨擋⟩ 事由 |\n')
        git('add', BOARD)
        _c1 = _io.StringIO()
        with contextlib.redirect_stdout(_c1):
            check_staged()
        _o1 = _c1.getvalue()
        ck('⑪端到端 錨欄無錨的新列 ⇒ 叫', '錨欄裡沒有錨' in _o1, True)
        # ═══ 規則⑬ 的兩個方向(2026-09-07;主視窗紀律①)═══
        #   🔴 ⑬a/⑬b 直接叫純函式 `anchorless_dups`;⑬c/⑬d 讀【真的那塊板】。
        #   ⚠️ `board` 在 selftest 裡指的是 temp 假板 ⇒ 真板要自己算路徑, 不可以用 board。
        _d1 = anchorless_dups([(1, '客人匯了款而系統沒有任何反應, 而那封信一直沒有寄出去'),
                               (2, '客人匯了款而系統沒有任何反應, 而那封信一直沒有寄出去 補一句')])
        ck('⑬a 造一組無錨重複 ⇒ 抓到', len(_d1), 1)
        ck('⑬a2 而它要說得出【是哪兩列】', (_d1[0][1], _d1[0][2]) if _d1 else None, (1, 2))
        # 🔵 反方向:內容不同的兩列不准被抓 —— 否則它是一道「什麼都紅」的閘
        _d2 = anchorless_dups([(1, '客人匯了款而系統沒有任何反應'),
                               (2, '出貨標籤列印出來多了一頁而頁碼不見了')])
        ck('⑬b 🔵 內容不同 ⇒ 不抓(不是恆紅)', len(_d2), 0)
        # 🔴 真板的無錨列不准大量誤報 —— 主視窗紀律①:多到沒有人會讀就等於沒有
        _rb = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), BOARD)
        _real = []
        for _n, _l in enumerate(io.open(_rb, encoding='utf-8').read().split('\n'), 1):
            if not _l.startswith('| '):
                continue
            _c = SPLIT.split(_l)
            if len(_c) < 5 or _c[1].strip() not in ('open', 'doing', 'parked', 'done', 'standing'):
                continue
            if re.search(r'⟦[^⟦⟧]+⟧|#\d+', _c[2]):
                continue
            _real.append((_n, _c[3].strip()))
        _dr = anchorless_dups(_real)
        ck('⑬c 真板的無錨列不會被大量誤報(≤20 組)',
           'yes' if len(_dr) <= 20 else f'no({len(_dr)}組)', 'yes')
        ck('⑬d 🟢 而分母不是 0(否則上一格恆真)',
           'yes' if len(_real) >= 20 else f'no(只有{len(_real)}列)', 'yes')

        # ═══ ⑮ 第四層的【接線】—— 2026-09-08 `tidy` ═══
        #   🔴🔴 **為什麼要有這一格**:第四層 2026-09-07 就寫好了、算得對、
        #      而 `sims` 在兩條路都【解包出來一次都沒被讀】⇒ **它兩天一個字都沒說。**
        #   🛑 **而那兩天 selftest 一直是綠的** —— 因為既有那幾格【直接呼叫 `scan()`】,
        #      測的是【函式算得對不對】, 不是【算出來的東西有沒有被印出來】。
        #      📌 ⇒ 同族 memory `feedback_behaviour-tests-prove-a-path-not-the-wiring`。
        #   ✅ ⇒ 本格改測【輸出】:抓 `_report_sims` 的 stdout, 而不是看它的回傳值。
        import io as _io2
        import contextlib as _ctx
        def _cap(_sims, _own):
            _b = _io2.StringIO()
            with _ctx.redirect_stdout(_b):
                _n = _report_sims(_sims, _own)
            return _b.getvalue(), _n
        _o_hit, _n_hit = _cap([(0.95, 111, 222)], set())
        ck('⑮a 有命中 ⇒ 真的印出那兩個行號', ':111 與 :222' in _o_hit, True)
        _o_zero, _ = _cap([], set())
        ck('⑮b ⚪ 負對照:零命中 ⇒ 一個字都不印(否則它會恆印)', _o_zero, '')
        _o_own, _n_own = _cap([(0.95, 111, 222)], {222})
        ck('⑮c 這顆 commit 動到的那一對 ⇒ 標出來', '這顆 commit 動到' in _o_own, True)
        ck('⑮d ⚪ 而不是自己的 ⇒ 不標(證明那個標籤不是無條件印)',
           '這顆 commit 動到' in _o_hit, False)
        ck('⑮e 回傳值 = 自己造成的對數(0 vs 1)', (_n_hit, _n_own), (0, 1))
        # 🔴 而最重要的一格:**兩條路真的呼叫它了嗎** —— 上面五格全綠也答不出這題。
        _src15 = _io2.open(__file__, encoding='utf-8').read()
        # 🔴🔴 **第一版的 ⑮f 是壞的, 而它【綠著】** —— 記在這裡:
        #   我寫 `_src15.count('_report_sims(sims') >= 2`, 而那把尺數到 3 —— 其中
        #   ① `def _report_sims(sims, red_lines):` 這一行**定義自己**就含那串
        #   ② 這一格**自己的斷言字串**也含那串
        #   ⇒ 📌 真正的呼叫點只有 1 個時, 它照樣 >= 2 ⇒ **突變拆掉一處呼叫, 它不紅。**
        #   🔬 實測:拆掉 `--check` 那一處 ⇒ selftest **rc=0**(該紅而沒紅)。
        #   ✅ 改成數【兩個呼叫點各自獨有的字面】, 而字面**執行期拼**(否則又撈到自己)。
        _c_chk = '_report_sims(sims, ' + 'set())'
        _c_stg = '_report_sims(sims, ' + '_own_lines)'
        ck('⑮f1 🔴 `--check` 那條路真的呼叫了', _src15.count(_c_chk), 1)
        ck('⑮f2 🔴 staged 那條路真的呼叫了', _src15.count(_c_stg), 1)
        # 🔴 **負對照字串要【執行期拼出來】, 不可以整串寫在這裡** ——
        #   本檔會被這把尺自己掃到 ⇒ 寫成字面 ⇒ 它撈到自己 ⇒ 負對照當場失效。
        #   🔬 實測 2026-09-08:第一版整串寫死 ⇒ ⑮g 紅, 而紅的理由是【它找到了自己】。
        #   📌 板上 `:697` 那一列早就記過同型:「負對照字串一寫進【會被掃的檔】就死了」。
        _bogus15 = 'qvx' + '7719' + 'NeverWired' + 'Reporter('
        ck('⑮g ⚪ 負對照:同一把尺對一個現造的函式名 ⇒ 找不到',
           _bogus15 in _src15, False)
        # ═══ `--blocking` 的兩個方向(2026-09-07;主視窗紀律①)═══
        #   🔴 三格的世界都是【現造的假板】, 而 ⑭d 比的是【真板】—— 兩者都要。
        _bb = os.path.join(g, 'blk.md')
        io.open(_bb, 'w', encoding='utf-8').write('\n'.join([
            '| 態 | 錨 | 事 | 誰 | token |',
            '| open | ⟦x-BLK1⟧ | 該抓的 | 誰 | ⟨擋⟩ 事由 |',
            '| open | ⟦x-BLK2⟧ | 帶括號的也該抓 | 誰 | ⟨擋(tidy 判 ③)⟩ 事由 |',
            # 🔴 這一列就是今天的 :1045/:1467 —— token 欄是 ⟨不擋⟩, 而【內文提到「⟨擋⟩」這個字】
            '| open | ⟦x-NOTBLK⟧ | 原 ⟨擋⟩ 已撤 ⇒ 內文在引用它 | 誰 | ⟨不擋(tidy 判)⟩ 事由 |',
            '| done | ⟦x-DONEBLK⟧ | 態 done 而 token 仍擋 | 誰 | ⟨擋⟩ 事由 |',
            # 🔴 這一列【多一欄】⇒ token 在 index 6 不是 5。它守的是「不准釘死欄號」。
            #    真板上釘死 c[5] 只少 3 列(67 vs 70)⇒ 任何【門檻式】的格都殺不到那個突變,
            #    只有一列欄數不同的假列殺得到。(2026-09-07 量的)
            '| open | ⟦x-WIDECOL⟧ | 欄數不同的列 | 誰 | 多出來的一欄 | ⟨擋⟩ 事由 |',
            # 🔴 族⑭(2026-09-08):它**不進「還在擋」那個數**, 而它必須被【另外印出來】。
            '| open | ⟦x-UNJ⟧ | 連擋不擋都沒人判 | 誰 | ⟨未判(沒人看過)⟩ 事由 |',
        ]) + '\n')
        _b = _io.StringIO()
        with contextlib.redirect_stdout(_b):
            blocking(_bb)
        _bo = _b.getvalue()
        ck('⑭a 標記/done/還在擋 三個數一起印',
           '標記 ⟨擋⟩ 4 · 其中 done 1 · 還在擋 3' in _bo, True)
        # 🔴 這一格擋的是我今晚犯的那個少報:把 token 欄釘死成 c[5]
        ck('⑭a2 🔴 欄數不同的列也抓得到(不准釘死欄號)', '⟦x-WIDECOL⟧' in _bo, True)
        ck('⑭b 帶括號的 ⟨擋(…)⟩ 也抓得到', '⟦x-BLK2⟧' in _bo, True)
        # 🔵 反方向:token 是 ⟨不擋⟩ 而內文提到「⟨擋⟩」⇒ 不准抓(整行 grep 多報的來源)
        ck('⑭c 🔵 ⟨不擋⟩ 而內文提 ⟨擋⟩ ⇒ 不抓', '⟦x-NOTBLK⟧' in _bo, False)
        ck('⑭c2 而它【確實】內文提到「⟨擋⟩」(否則上一格是空過的)',
           '⟨擋⟩' in io.open(_bb, encoding='utf-8').read().split('\n')[3], True)
        ck('⑭d 態 done 而 token 仍擋 ⇒ 單獨列出來', '自相矛盾' in _bo and '⟦x-DONEBLK⟧' in _bo, True)
        # ═══ 族⑭「未判」的兩個世界(2026-09-08 `Q5`;`⟦ship-UNJUDGEDOUTOFFAMILY⟧`)═══
        #   🔴 **這兩格守的是那一列的轉 done 條件②本身**:「不含 ⇒ 每次報那個數時要一起報」
        #      ⇒ 少了它們, **把那一行 print 刪掉是全綠的**。
        ck('族⑭ `--blocking` 一定要【另外印】未判那個數(不含在「還在擋」裡)',
           '⑭ 另有 ⟨未判⟩ **1 列**' in _bo and '還在擋 3' in _bo, True)
        ck('族⑭ 負對照:那一列【不】混進「還在擋」的清單(它不是 ⟨擋⟩)',
           '⟦x-UNJ⟧' in _bo.split('⑭ 另有')[0], False)
        ck('族⑭ 而「兩個數一起報」那句話要印出來(它是那一列的轉 done 條件②)',
           '報「還剩多少」時兩個數要一起報' in _bo, True)
        # 🔴 真板那一發:擋住「我釘死欄號 ⇒ 印 5 而真值 70」那個少報再回來
        _b2 = _io.StringIO()
        with contextlib.redirect_stdout(_b2):
            blocking(_rb)
        _open70 = sum(1 for _x in _b2.getvalue().split('\n') if _x.startswith('  :') and '[open]' in _x)
        ck('⑭e 🔴 真板 open+⟨擋⟩ ≥ 20(擋少報回來;我第一版印 5, 真值 70)',
           'yes' if _open70 >= 20 else f'no(只有{_open70})', 'yes')
        ck('⑪端到端 而它要印出【行內別處有幾個錨】', '行內別處有' in _o1, True)
        ck('⑪端到端 且明說不要撿別列的錨來補', '不要從行內別處撿一個補上去' in _o1, True)
        # 🔵 負對照:有錨的新列**不可以**讓計數多一 —— 少了這格,「恆叫」與「叫對」同一個綠
        _n1 = _o1.count('⚓')
        io.open(board, 'a', encoding='utf-8').write(
            '| open | ⟦zz11-B⟧ | 有錨的新列 | `mail` | ⟨擋⟩ 事由 |\n')
        git('add', BOARD)
        _c2 = _io.StringIO()
        with contextlib.redirect_stdout(_c2):
            check_staged()
        ck('⑪端到端 🔵 再加一列【有錨的】⇒ 規則⑪ 的計數不變(不是恆叫)',
           _c2.getvalue().count('⚓'), _n1)
        # 🔴🔴 世界乙之一:**板檔裡【不是表格列】的那些行**(檔頭說明散文)⇒ 不該叫
        #    這一格守的是 `+| ` 前綴過濾。**它是突變測出來才補的** ——
        #    2026-09-07 我第一版只補了「非板檔」那格, 而拿掉 `+| ` 過濾去突變 ⇒ **全綠**
        #    ⇒ 📌 **那道保護當時沒有任何東西守著, 而我以為我補的那格在守它。**
        io.open(board, 'a', encoding='utf-8').write(
            '> 這是檔頭散文不是表格列, 而它寫著今晚而沒有日期 zz10-C\n')
        git('add', BOARD)
        _b3 = _io.StringIO()
        with contextlib.redirect_stdout(_b3):
            check_staged()
        #    ⚠️ **斷言不能用 `zz10-C` 當關鍵字** —— 那行沒有 `|` ⇒ 規則⑩ 印出來的錨是
        #    `(無錨)`, 內文根本不會出現。第一版我就是這樣寫, ⇒ 突變拿掉過濾之後**照樣綠**,
        #    而我差點把它讀成「那道保護沒被守」。📌 **尺用錯關鍵字, 與被測的東西壞掉, 印同一個綠。**
        #    ✅ 改成數規則⑩ 印了幾行(`🕐`)—— 有沒有多一行, 才是這一格要問的。
        ck('⑩端到端 板檔裡的非表格行 ⇒ 不叫(`+| ` 前綴過濾生效)',
           _b3.getvalue().count('🕐'), 1)

        # 🔴 世界乙:**同一支檔以外**的檔案寫同樣的句子 ⇒ 不該叫
        #    (那正是「本檔自己的註解」那一格真正該驗的東西 —— `-- BOARD` 限定有沒有生效)
        io.open(other, 'a', encoding='utf-8').write('| open | ⟦zz10-B⟧ | 今晚沒有日期 | 誰 | x |\n')
        git('add', 'other.md')
        _b2 = _io.StringIO()
        with contextlib.redirect_stdout(_b2):
            check_staged()
        ck('⑩端到端 非板檔寫同樣的句子 ⇒ 不叫(檔案限定生效)',
           'zz10-B' in _b2.getvalue(), False)

        # ═══ `:359` / `:427` 的端到端(2026-09-07;`--ops` 剩的兩個活口)═══
        #   🔴 我先前為這兩行寫過斷言, 而那些是**直接驗判斷式**(一個 lambda、一個 `len(...) >= 3`)
        #      ⇒ **沒有經過 `check_staged()` 這條路** ⇒ 突變它們照樣綠。**同型的錯今晚第五次。**
        #   ✅ 這一組走真的 staged diff。
        #
        # ① `:359` 表頭偵測 `set(分隔行) <= set('-:')`
        #    突變成 `<` = **真子集** ⇒ 分隔行**同時用 `-` 和 `:`**(兩邊對齊)時會被拒 ⇒ 那張表的表頭認不出來
        #    ⇒ 規則⑨ 對它底下的列拿不到欄數 ⇒ **不叫**。
        #    ⚠️ 只有 `-` 的分隔行**兩種寫法答案相同** ⇒ fixture 必須用帶冒號的。
        _c1 = git('commit', '-q', '-m', 'base-for-359-427')
        if _c1.returncode != 0:
            print('  🔴 selftest 建 359/427 base commit 失敗 ⇒ 這一組空轉, 中止')
            return 1
        io.open(board, 'w', encoding='utf-8').write('\n'.join([
            '| 態 | 錨 | 事 | 誰 | 末 |',
            '|:--|--:|:-:|---|---|',          # 🔴 帶冒號 —— 這是本格的關鍵
            #    ⚠️ 這一列要【真的缺一格】(4 欄 vs 表頭 5 欄)—— 第一版我寫了 5 欄,
            #       規則⑨ 本來就不該叫 ⇒ 那一格紅得莫名其妙, 而它紅的是我的 fixture。
            '| open | ⟦zz359-A⟧ | 事 | ⟨擋⟩ 缺一格, 轉 `done` = 修好 |',
        ]) + '\n')
        git('add', BOARD)
        _bb = _io.StringIO()
        with contextlib.redirect_stdout(_bb):
            check_staged()
        ck('①端到端 帶冒號的分隔行 ⇒ 表頭仍認得出(規則⑨ 對那列出聲)',
           'zz359-A' in _bb.getvalue(), True)
        # ② `:427` `len(_g9) >= 3`:**恰好 3 格**的列要進規則⑨ 的分母
        #    (`| open | ⟦x⟧ |` 切出來是 4 個元素 ⇒ 淨 2 欄, 而表頭 5 欄 ⇒ 該叫)
        io.open(board, 'w', encoding='utf-8').write('\n'.join([
            '| 態 | 錨 | 事 | 誰 | 末 |',
            '|---|---|---|---|---|',
            #    🔴 **要【恰好 3 個元素】才咬得到那個邊界** —— `| open | ⟦x⟧ |` 切出 4 個,
            #       `>= 3` 與 `> 3` 對它答案相同 ⇒ 第一版那個 fixture 綠著而突變照樣活。
            #       `| open |` 才是 3 個(態欄 'open' 合法、第三個元素是空字串)。
            #       ⚠️ 那一列**沒有錨**, 所以下面斷言的是【規則⑨ 有沒有印東西】不是錨名。
            '| open |',
        ]) + '\n')
        git('add', BOARD)
        _bc = _io.StringIO()
        with contextlib.redirect_stdout(_bc):
            check_staged()
        ck('②端到端 恰好 3 元素的列仍進規則⑨ 分母(邊界是 >= 3)',
           '▦' in _bc.getvalue(), True)

        # ═══ 新列缺關閉條件的兩個世界(2026-09-07;主視窗指定)═══
        #   🔴 這兩格要真的分得出「**這次新增的**」與「**本來就在的**」——
        #      所以先 commit 一版當底, 再加新列。
        _c = git('commit', '-q', '-m', 'base')
        # 🔴 不驗這一步的 rc, 下面三格會【全部空轉】:沒 commit 成功 ⇒ 沒有 base ⇒
        #    `git diff --cached` 把【整份檔】都當成新增 ⇒ 正對照與負對照都會叫
        #    ⇒ 而我 2026-09-07 第一發看到的是【正對照不叫】, 方向還相反 ⇒ 更難猜。
        if _c.returncode != 0:
            print(f'  🔴 selftest 建 base commit 失敗(rc={_c.returncode})⇒ 下面三格作廢')
            return 1
        base_rows = io.open(board, encoding='utf-8').read().rstrip('\n')
        io.open(board, 'w', encoding='utf-8').write(
            # 🔴 這一列的【事欄】刻意不含任何 CLOSE_WORDS ——
        #    我第一版寫「沒寫關閉條件的新列」, 而那五個字【自己命中了】⇒ 正對照不叫。
        #    📌 **描述一個東西的文字, 含著那個東西的關鍵字 ⇒ fixture 自己讓自己通過。**
        base_rows + '\n| open | ⟦x-NOCLOSE⟧ | 新開一列而末格只有描述 | 誰 | ⟨擋(t)⟩ 只有描述 |\n')
        git('add', BOARD)
        buf4 = _io.StringIO()
        with contextlib.redirect_stdout(buf4):
            check_staged()
        o4 = buf4.getvalue()
        ck('新列沒寫關閉條件 ⇒ 叫', '⟦x-NOCLOSE⟧' in o4 and '做到哪算完' in o4, True)
        ck('新列沒寫關閉條件 ⇒ rc 仍 0', check_staged(), 0)
        # ═══ 新列【完全沒有 token】的兩個世界(2026-09-07)═══
        #   ⚠️ 正對照那列刻意【一個角括號都不放】—— 我 11:2x 才踩過
        #      「fixture 的描述文字自己命中判準」那個坑。
        io.open(board, 'w', encoding='utf-8').write(
            base_rows + '\n| open | ⟦x-NOTOK⟧ | 新開一列而末格只有描述 | 誰 | 只有描述 |\n')
        git('add', BOARD)
        buf9 = _io.StringIO()
        with contextlib.redirect_stdout(buf9):
            check_staged()
        o9 = buf9.getvalue()
        ck('新列完全沒 token ⇒ 叫', '⟦x-NOTOK⟧' in o9 and '這列擋不擋上線' in o9, True)
        ck('新列完全沒 token ⇒ rc 仍 0', check_staged(), 0)
        # 🔴 負對照:新列【有】token ⇒ 這一條不可以叫
        #    (它仍可能因為「沒寫關閉條件」而被另一條叫 ⇒ 所以只比對「擋不擋上線」那句)
        io.open(board, 'w', encoding='utf-8').write(
            base_rows + '\n| open | ⟦x-HASTOK⟧ | 新開一列而末格有判 | 誰 | ⟨不擋(t)⟩ 只有描述 |\n')
        git('add', BOARD)
        buf10 = _io.StringIO()
        with contextlib.redirect_stdout(buf10):
            check_staged()
        ck('新列有 token ⇒ 不叫那一條', '⟦x-HASTOK⟧' in buf10.getvalue().split('沒寫「怎樣算做完」')[0], False)

        # 負對照一:新列【有】寫關閉條件 ⇒ 不叫
        io.open(board, 'w', encoding='utf-8').write(
            base_rows + '\n| open | ⟦x-HASCLOSE⟧ | 有寫的新列 | 誰 | ⟨擋(t)⟩ **轉 `done`** = 那支貼完 |\n')
        git('add', BOARD)
        buf5 = _io.StringIO()
        with contextlib.redirect_stdout(buf5):
            check_staged()
        ck('新列有寫關閉條件 ⇒ 不叫', '⟦x-HASCLOSE⟧' in buf5.getvalue(), False)
        # 🔴 負對照二:**既有的 354 列那一族**(base 裡本來就有、沒寫關閉條件)⇒ 必須【不】叫
        #    這格擋的是「掃全部」那個錯誤實作 —— 它在上面兩格之下【也會過】。
        io.open(board, 'w', encoding='utf-8').write(base_rows + '\n')
        git('add', BOARD)
        buf6 = _io.StringIO()
        with contextlib.redirect_stdout(buf6):
            check_staged()
        ck('既有列沒寫關閉條件 ⇒ 不叫(只看新增的)', '做到哪算完' in buf6.getvalue(), False)

        # ═══ 被污染的負對照字串:兩個世界(2026-09-07;`-ship` 交件坑 2)═══
        io.open(board, 'w', encoding='utf-8').write(
            base_rows + '\n| open | ⟦x-DIRTY⟧ | 這一列刻意含一個常被當負對照的字 zzz_bogus | 誰 | ⟨擋(t)⟩ x |\n')
        git('add', BOARD)
        buf13 = _io.StringIO()
        with contextlib.redirect_stdout(buf13):
            check_staged()
        ck('板上含 zzz_bogus ⇒ 叫', '常被當負對照' in buf13.getvalue(), True)
        io.open(board, 'w', encoding='utf-8').write(base_rows + '\n')
        git('add', BOARD)
        buf14 = _io.StringIO()
        with contextlib.redirect_stdout(buf14):
            check_staged()
        ck('板上沒有那些字 ⇒ 不叫', '常被當負對照' in buf14.getvalue(), False)

        # ═══ 檔尾換行的兩個世界(2026-09-07;`-ship` 交件坑 1)═══
        io.open(board, 'w', encoding='utf-8').write(base_rows)          # 🔴 刻意不加 \n
        git('add', BOARD)
        buf11 = _io.StringIO()
        with contextlib.redirect_stdout(buf11):
            check_staged()
        ck('檔尾沒換行 ⇒ 叫', '檔尾沒有換行字元' in buf11.getvalue(), True)
        io.open(board, 'w', encoding='utf-8').write(base_rows + '\n')   # ✅ 有 \n
        git('add', BOARD)
        buf12 = _io.StringIO()
        with contextlib.redirect_stdout(buf12):
            check_staged()
        ck('檔尾有換行 ⇒ 不叫', '檔尾沒有換行字元' in buf12.getvalue(), False)

        # 🔴 第三個世界:staged 是【乾淨的】而工作樹是【壞的】⇒ 必須看 staged, 印乾淨
        io.open(board, 'w', encoding='utf-8').write('\n'.join(
            [rows_bad[0], rows_bad[1], rows_bad[2]]) + '\n')
        git('add', BOARD)
        io.open(board, 'w', encoding='utf-8').write('\n'.join(rows_bad) + '\n')  # 工作樹弄壞
        buf3 = _io.StringIO()
        with contextlib.redirect_stdout(buf3):
            check_staged()
        ck('工作樹壞而 staged 乾淨 ⇒ 不報違規', '位移候選' in buf3.getvalue(), False)
    finally:
        os.chdir(cwd0)
        # 🔴 must-fix ③ 的第三道:整棵拋棄式樹刪掉, 不留在磁碟上
        import shutil
        shutil.rmtree(g, ignore_errors=True)

    ck('跳脫那列的 `a\\|b\\|c` 還在', txt.count('`a\\|b\\|c`'), 2)
    # ═══ 規則⑧ 的兩個世界(2026-09-07)═══
    #   🔴 這一族的正對照是【它咬得到】, 負對照是【它不咬合法證據】——
    #      而後者才是它會不會被人關掉的那一半:板上到處是 `檔案:行號`, 那是規則要求的。
    for _s in ('⏬ **[併自原 :565]** 不要派本列', '本板 :1002 那一列', '見上一列 :638'):
        ck(f'⑧該咬 {_s[:14]}', bool(STALEREF.search(_s)), True)
    for _s in ('證據 `supabase/migrations/20260904270000_m4b.sql:7-9` 逐字',
               'docs/specs/2026-08-25-q15.md:7 叫下游用 39',
               '`scripts/acl-drift-gate.py` 在(wc -l ⇒ 837)',
               '併自原 :565⚠️(已訂正過的那 12 處, 不該再叫)',
               '共 64 張;有政策 48 張;反向差 0'):
        ck(f'⑧不咬 {_s[:16]}', bool(STALEREF.search(_s)), False)
    # ═══ 規則⑨ 的兩個世界(2026-09-07;第二版 —— 分母改成【各自表頭】)═══
    #   🔴 第一版這幾格測的是「該 5 欄」, 而那個假設是錯的:板上實測 **100 張表頭**,
    #      2/4/5/6 欄都有。我照第一版去「修」了 8 列, 那 8 列屬於一張 4 欄表、本來就是對的。
    #   ⇒ 這一組現在測的是【表頭驅動】, 而正對照與負對照【互換了角色】:
    #      同樣一列 5 欄, 在 5 欄表裡是對的、在 4 欄表裡是錯的。
    def _cols_of_table(_head, _row):
        _g = SPLIT.split(_row)
        if len(_g) < 3 or _g[1].strip() not in ('open', 'doing', 'parked', 'done', 'standing'):
            return None
        return (len(_g) - 2, len(SPLIT.split(_head)) - 2)

    _h5 = '| 態 | 錨 | 事 | 誰 | 末 |'
    _h4 = '| 態 | 錨 | 事 | 誰 |'
    _r5 = '| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 末 |'
    _r4 = '| open | ⟦x-A⟧ | 事 | ⟨擋⟩ 末 |'
    ck('⑨ 5 欄列在 5 欄表 ⇒ 相符', _cols_of_table(_h5, _r5), (5, 5))
    ck('⑨ 4 欄列在 5 欄表 ⇒ 不符(該叫)', _cols_of_table(_h5, _r4), (4, 5))
    # 🔴 這一格是本次事故的正對照:同一列 5 欄, 換一張 4 欄表就是【多一格】。
    ck('⑨ 5 欄列在 4 欄表 ⇒ 不符(該叫;這正是我修壞那 8 列的形狀)',
       _cols_of_table(_h4, _r5), (5, 4))
    ck('⑨ 4 欄列在 4 欄表 ⇒ 相符(第一版會把它誤報成壞)',
       _cols_of_table(_h4, _r4), (4, 4))
    ck('⑨ 儲存格內含跳脫豎線 ⇒ 仍算 5 欄(不得誤報)',
       _cols_of_table(_h5, '| open | ⟦x-A⟧ | `a \\| b` 的寫法 | 誰 | ⟨擋⟩ 末 |'), (5, 5))
    ck('⑨ 檔頭的兩欄小表 ⇒ 不在分母(態不是封閉集)',
       _cols_of_table('| 動作 | 怎麼做 |', '| 標完成 | 該列態改 done |'), None)
    # ═══ 規則⑩ 的兩個世界(2026-09-07;第二版 —— 改叫【正式路徑那一份】)═══
    #   🔴 第一版 selftest 自己抄了一份 `_reltime_hits` ⇒ code-reviewer 逐字指出:
    #      「兩份分家時 selftest 綠證明不了正式那段對」。⇒ 現在共用 `undated_reltime`。
    ck('⑩ 「今晚」而附近沒日期 ⇒ 該叫',
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 今晚撞到同一件事 |'), '今晚')
    ck('⑩ 「今晚」而附近【有】日期 ⇒ 不叫(這一格擋誤報)',
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 2026-09-07 今晚撞到同一件事 |'), None)
    ck('⑩ 日期在【後面】120 字內也算(窗口雙向)',
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 今晚撞到, 量於 2026-09-07 08:5x |'), None)
    ck('⑩ 完全沒有相對時間 ⇒ 不叫',
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 一句沒有時間詞的話 |'), None)
    # ═══ 規則⑫ 的兩個世界(2026-09-07)—— 共用 `measured_without_date`, 不另抄一份 ═══
    # ══ 族欄:🔴 最重要的是【明示與推測不可混】那兩格 ══
    ck('族① 明示族來自 token 欄擴充字面 ⇒ 回在第一格(權威)',
       family_of('⟨擋·決策⟩', '待派', '內文'), ('③', None))
    ck('族② 沒有明示 ⇒ 從誰欄推, 而【回在第二格】不是第一格',
       family_of('⟨擋⟩', '等 Sean 拍', '內文'), (None, '③'))
    # 🔴 這一格釘住 ⑨ 與未分族不可混 —— 它們的下一步相反。
    # 🔴 這一格釘住 ⑩ 與 ③ 分開 —— 混掉的後果是 Sean 早上收到一題他答不了的。
    ck('族⑦ ⟨擋·等主視窗⟩ 不是 ⟨擋·決策⟩(等 Sean)',
       family_of('⟨擋·等主視窗⟩', '待派', ''), ('⑩', None))
    ck('族⑧ ⟨擋·等他動手⟩ 與「決策」分開(他已經決定了)',
       family_of('⟨擋·等他動手⟩', '待派', ''), ('⑪', None))
    # 🔴 這一格釘住 ⑬ 與 ⑨ 分開 —— 混掉的話 ⑨ 會變成垃圾桶。
    ck('族⑩ ⟨擋·待辦⟩ 不是 ⟨擋·讀不出來⟩(讀得出來, 答案就是「還沒做」)',
       family_of('⟨擋·待辦⟩', '待派', ''), ('⑬', None))
    ck('族⑪ ⟨擋·待辦⟩ 與 ⟨擋·待翻態⟩ 不得互相吃到(前綴相近)',
       family_of('⟨擋·待翻態⟩', '待派', ''), ('⑤', None))
    ck('族⑤ ⟨擋·讀不出來⟩ 是【明示族】不是未分族(有人看過而填不出來)',
       family_of('⟨擋·讀不出來⟩', '待派', ''), ('⑨', None))
    ck('族⑥ ⟨擋·時刻觸發⟩ 與「有主」分開(誰欄掛的是時刻不是人)',
       family_of('⟨擋·時刻觸發⟩', '等 Sean 併 main 那一刻', ''), ('⑧', None))
    ck('族③ 兩者都沒有 ⇒ 未分族(這一堆是本支要印的第一個數)',
       family_of('⟨擋⟩', '待派', '一段沒有線索的內文'), (None, None))
    # 🔴 這一格釘住「不用標題」——標題最會過期, 而它是最容易被順手加進去的來源。
    ck('族④ 標題裡有那些字也不算(本支刻意不看標題)',
       family_of('⟨擋⟩', '待派', '內文')[1], None)
    # 🔴 這一格釘住上面那個落差 —— 有人補了 GUESS 樣式而忘了改警語 ⇒ 這裡紅。
    ck('族⑨ 推測尺實作的族數 < 族碼表(落差必須被印出來, 不可靜靜地是 0)',
       sorted({f for f, _ in GUESS}), ['①', '②', '③', '④'])
    ck('⑬ 「正對照 19」而沒說剝 ⇒ 該問',
       poscontrol_without_strip('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 正對照 19 命中 |'), '19')
    ck('⑬ 有「剝」字 ⇒ 不問(它已經在講剝前剝後了)',
       poscontrol_without_strip('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 剝註解後 15(剝前 19)|'), None)
    ck('⑬ 沒有「正對照」⇒ 不問(不是每個數字都要剝)',
       poscontrol_without_strip('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 一共 19 支檔 |'), None)
    ck('⑫ `⟨已量⟩` 沒帶日期 ⇒ 該叫',
       measured_without_date('| open | ⟦x-A⟧ | 事 | 誰 | ⟨已量⟩ 讀數在這 |'), '⟨已量⟩')
    ck('⑫ `⟨已量 2026-09-05⟩` ⇒ 不叫(這一格擋誤報)',
       measured_without_date('| open | ⟦x-A⟧ | 事 | 誰 | ⟨已量 2026-09-05⟩ 讀數在這 |'), None)
    # 🔴 這一格釘住「只管已量, 不要順手也要求未量帶日期」——
    #    `⟨未量⟩` 的意思就是**還沒有讀數**, 逼它帶日期是逼人寫一個沒有意義的數字。
    ck('⑫ `⟨未量⟩` ⇒ 不叫(它本來就沒有讀數可以標時點)',
       measured_without_date('| open | ⟦x-A⟧ | 事 | 誰 | ⟨未量⟩ 沒有人量過 |'), None)
    ck('⑫ 負對照:現造 token ⇒ 不叫',
       measured_without_date('| open | ⟦x-A⟧ | 事 | 誰 | ⟨zqx8never⟩ |'), None)
    # ⚠️ 而「日期在 token【外面】」不算 —— 那正是本規則要防的:
    #    一列末格哪裡都可能有日期, 而**問題是「這個讀數」是什麼時候的**, 不是「這一列提過日期」。
    ck('⑫ 日期在 token 外面 ⇒ 仍該叫(日期要黏在那個讀數上)',
       measured_without_date('| open | ⟦x-A⟧ | 事 | 誰 | 2026-09-05 開列 ⟨已量⟩ 讀數 |'), '⟨已量⟩')
    # 🔴 第三個樣式:**真實計數**要攔得到, 而**逐字 `第 N 次` 攔不到它**。
    #    這一格的 fixture 刻意【不含「今晚」「今天」】—— 第一版的 fixture 寫「今晚第八次」,
    #    被第一個關鍵字攔下就綠了 ⇒ **第三個樣式從沒被驗過**(code-reviewer 抓到的那一格)。
    ck('⑩ 真實計數「第八次」(不含今晚/今天)⇒ 該叫',
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 這已經是第八次撞到同一件事 |'), '第八次')
    ck('⑩ 「第 5 次」帶阿拉伯數字也算', 
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 這是第 5 次 |'), '第 5 次')
    ck('⑩ 真實計數而附近有日期 ⇒ 不叫',
       undated_reltime('| open | ⟦x-A⟧ | 事 | 誰 | ⟨擋⟩ 2026-09-07 這已經是第八次 |'), None)
    # ═══ 族碼 ⑭「未判」(Sean 2026-09-08 `Q5`)—— 兩個世界都要表演 ═══
    #   ⚠️ **標籤寫「族⑭」不寫「⑭」** —— 上面 `:1180` 那組 `⑭a〜⑭e` 是**自檢規則的編號**,
    #      與這裡的**族碼**同字不同義。同一個字在一份輸出裡指兩件事 ⇒ 下一個人會讀錯。
    ck('族⑭ token 自己是 `⟨未判(…)⟩` ⇒ 明示族 ⑭(不是推測)',
       family_of('⟨未判(還沒有人看)⟩', '待派', '一段沒有線索的內文'), ('⑭', None))
    ck('族⑭ 負對照:`⟨擋⟩` 同樣沒線索 ⇒ 不可以變成 ⑭(證明那一行不是恆真)',
       family_of('⟨擋⟩', '待派', '一段沒有線索的內文'), (None, None))
    _t14 = ['| 態 | 錨 | 事 | 誰 | 末 |', '|---|---|---|---|---|',
            '| open | ⟦x-U1⟧ | 甲 | 誰 | ⟨未判(沒人看過)⟩ 內文 |',
            '| open | ⟦x-U2⟧ | 乙 | 誰 | ⟨擋⟩ 內文提到 ⟨未判⟩ 這個字而 token 不是它 |',
            '| done | ⟦x-U3⟧ | 丙 | 誰 | ⟨未判(沒人看過)⟩ 內文 |']
    ck('族⑭ 行為:數得到 token 欄是 ⟨未判⟩ 的列(含 done)', len(unjudged_rows(_t14)), 2)
    ck('族⑭ 行為負對照:內文提到「⟨未判⟩」而 token 是 ⟨擋⟩ 的列【不】算(整行 grep 會多報)',
       [r[0] for r in unjudged_rows(_t14)], [3, 5])
    # ═══ `--ops` 逼出來的六個活口(2026-09-07;`selftest-guards-what --ops` 首跑 17 點活 6)═══
    #   🔴 這些全是**邊界**, 而邊界差一在正常輸入上看不出來 —— 要**踩在邊界上**才問得出。
    #      (同夜在 `board-merge-rows` 我為此改了三次 fixture 才真的踩到, 每次都是重跑工具問出來的。)
    #
    # ① `:101` `ord(c) >= 0x20`:空白(0x20)本身**要被留下**, 不可以變成 `?`
    ck('①a 空白(0x20)不被當控制字元', safe('a b'), 'a b')
    ck('①b 而 0x1f 要被換掉(證明上一格踩在邊界)', safe('a\x1fb'), 'a?b')
    # ①c `ord(c) != 0x7f`:DEL 要被換掉
    ck('①c DEL(0x7f)要被換掉', safe('a\x7fb'), 'a?b')
    # ② `:193` `ka == kb`:**同錨的兩列跳過相似度比對**(它們已由「重複識別字」那層報過)
    #    ⚠️ 第一版我寫了 `_dup_key(...)` —— **那個函式不存在, 是我編的名字**。
    #       改成驗【行為】:同錨 ⇒ 由 dup 那層報;換成不同錨 ⇒ 改由相似度那層報。
    _t2 = ['| 態 | 錨 | 事 | 誰 | 末 |', '|---|---|---|---|---|',
           '| open | ⟦x-SAME⟧ | 這一列的標題刻意寫得很長而且與下一列幾乎一字不差甲 | 誰 | ⟨擋⟩ x |',
           '| open | ⟦x-SAME⟧ | 這一列的標題刻意寫得很長而且與下一列幾乎一字不差乙 | 誰 | ⟨擋⟩ y |']
    _r2 = scan(_t2)
    _t3 = [_t2[0], _t2[1], _t2[2], _t2[3].replace('⟦x-SAME⟧', '⟦x-OTHER⟧')]
    _r3 = scan(_t3)
    ck('②a 同錨兩列 ⇒ 進「重複識別字」那層', len(_r2[2]) >= 1, True)
    ck('②b 同錨 ⇒ 相似度那層【不】重複報', len(_r2[3]), 0)
    ck('②c 換成不同錨 ⇒ 改由相似度那層報(證明 == 那一行真的在分流)',
       (len(_r3[2]), len(_r3[3]) >= 1), (0, True))
    # ③ `:206` `r >= 0.90` —— 標題相似度門檻
    #    🔴 **第一版我寫 `ck(..., (0.90 >= 0.90) and not (0.90 > 0.90))`** ——
    #       那**根本沒有經過被突變的那一行**, 它只是在驗 Python 的比較運算子。
    #       ⇒ 突變 `:206` 之後照樣綠。**同一個錯我今天犯第四次**(前三次在 board-merge-rows)。
    #    ✅ 改成餵**真的 `scan()`**, 而且造【跨在門檻兩側】的兩對:
    #       造「恰好等於 0.90」的一對做不到(相似度是離散的)⇒ 改成證明那條線的位置。
    #       量到:尾 '甲乙丙丁戊己庚' ⇒ 0.9118(上)· 再多一個字 ⇒ 0.8986(下)。
    _b6 = '這一列的標題刻意寫得很長很長而且與下一列幾乎完全一樣只差結尾'
    _hdr6 = ['| 態 | 錨 | 事 | 誰 | 末 |', '|---|---|---|---|---|']
    def _sim_rows(_tail):
        return _hdr6 + [
            f'| open | ⟦x-S1⟧ | {_b6}甲 | 誰 | ⟨擋⟩ x |',
            f'| open | ⟦x-S2⟧ | {_b6}{_tail} | 誰 | ⟨擋⟩ y |']
    ck('③a 相似度 0.9118(門檻【上】)⇒ 要報成近似重複',
       len(scan(_sim_rows('甲乙丙丁戊己庚'))[3]) >= 1, True)
    ck('③b 相似度 0.8986(門檻【下】)⇒ 不可以報(證明那條線在 0.90 而不是更低)',
       len(scan(_sim_rows('甲乙丙丁戊己庚辛'))[3]), 0)
    # 🛑 **而這兩格【仍然抓不到 `>=` ⇒ `>` 那個突變】, 照實記**:
    #    要抓它需要一對相似度**恰好等於 0.90** 的標題, 而 `SequenceMatcher` 的比值是離散的
    #    —— 我逼近到 0.9118 / 0.8986, **中間沒有 0.9000**。
    #    ⇒ 📌 **那個突變【活著】是一個【已知且證明過的缺口】, 不是「我忘了補」。**
    #       實務上它的代價:門檻從「>= 0.90」變成「> 0.90」⇒ **只有恰好 0.9000 的那一對會漏報**,
    #       而那需要標題長度與差異剛好湊出整數比。⇒ **判定:不值得為它扭曲 fixture。**
    #    ⚠️ 而我**不把它從 `--ops` 的報表裡藏起來** —— 讓它繼續印紅, 附這段說明比消音好。
    # ④ `:359` 表頭偵測:分隔行只能有 `-` `:` `|` 空白 —— **空集合也算**(全是 | 的那種)
    _sep = lambda s: set(s.replace('|', '').replace(' ', '')) <= set('-:')
    ck('④a 正常分隔行 `|---|---|` ⇒ 認得', _sep('|---|---|'), True)
    ck('④b 帶對齊冒號 `|:--|--:|` ⇒ 認得', _sep('|:--|--:|'), True)
    ck('④c 而含別的字 ⇒ 不認(證明它不是恆真)', _sep('| 態 | 錨 |'), False)
    # ⑤ `:427` `len(_g9) >= 3`:恰好 3 格的列**要**進規則⑨ 的分母(不可以被邊界擋掉)
    _g3 = SPLIT.split('| open | ⟦x-T⟧ |')
    ck('⑤ 恰好 3 格的列仍在規則⑨ 分母內(邊界是 >= 3)', len(_g3) >= 3, True)
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    a = sys.argv[1] if len(sys.argv) > 1 else ''
    if a == '--selftest':
        sys.exit(selftest())
    if a == '--blocking':
        t = sys.argv[2] if len(sys.argv) > 2 else BOARD
        if not os.path.isfile(t):
            print(f'🔴 查無:{t} ⇒ 量具缺席', file=sys.stderr)
            sys.exit(2)
        sys.exit(blocking(t))
    if a == '--check-staged':
        sys.exit(check_staged())
    if a in ('--check', '--fix'):
        t = sys.argv[2] if len(sys.argv) > 2 else BOARD
        if not os.path.isfile(t):
            print(f'🔴 查無:{t} ⇒ 量具缺席', file=sys.stderr)
            sys.exit(2)
        sys.exit(run(t, a))
    print(__doc__)
    sys.exit(2)
