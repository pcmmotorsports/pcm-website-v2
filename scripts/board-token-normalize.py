#!/usr/bin/env python3
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
        _m_anchor = re.search(r'⟦[^⟧]+⟧', f[2])
        titles.append((n, _norm_title(f[3]), _m_anchor.group(0) if _m_anchor else None))
        m_id = re.search(r'⟦[^⟧]+⟧|#\d+', f[2])
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
        m = re.search(r'⟦[^⟧]*⟧', f[2])
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
        print(f'   ── 另外(只警告, 不影響 rc):態 done 而 token 仍 ⟨擋⟩ {len(dblock)} 列')
        for n, k, why in dblock:
            print(f'   done+擋 :{n:5} {k}  {why}')
        if dblock:
            print('   🟡 它可能是【做完了忘了更新 token】, 也可能是【態被誤標 done】——')
            print('      🔴 這兩件的修法【相反】 ⇒ 本工具不猜, 開檔判。')
            print('      🛑 已量到的失效方向:讀 token 的人以為它還在擋 ⇒ 那是【派重了】的燃料。')
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
            m = re.search(r'⟦[^⟧]*⟧', SPLIT.split(new)[2])
            print(f'   ✅ :{i+1:5} {act} {m.group(0) if m else ""}')
    io.open(path, 'w', encoding='utf-8').write('\n'.join(lines))
    print(f'── 動了 {changed} 列')
    return 0


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
    if _dirty:
        print(f'   🟡 板上已含這些【常被當成負對照】的字串:{", ".join(_dirty)}')
        print('      ⇒ 下一個拿它們當「現造字串」驗 0 命中的人會拿到非 0, 而**他分不出是誰貼的**。')
        print('      📌 **一個負對照的有效期, 到它被寫進被測的那份檔為止。** 現造新的, 且貼前先驗 0。')
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
    newrows = []
    notok = []          # 新開的 open/doing 列而【完全沒有 token】
    if d.returncode == 0:
        for ln in d.stdout.split('\n'):
            if not ln.startswith('+| ') or ln.startswith('+++'):
                continue
            row = ln[1:]
            g = SPLIT.split(row)
            if len(g) < 4 or g[1].strip() not in ('open', 'doing'):
                continue
            m2 = re.search(r'⟦[^⟧]+⟧|#\d+', g[2])
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
    _tot = len(mis) + len(dblock) + len(dups)
    if _tot:
        print(f'── board-token 閘(staged):全板另有 {_tot} 件舊帳'
              f'(位移 {len(mis)} · done而標擋 {len(dblock)} · 重複識別字 {len(dups)})')
        print('   ⚠️ **那些【不是這顆 commit 造成的】** ⇒ 逐列清單跑 '
              '`python3 scripts/board-token-normalize.py --check`')
    if mis or dblock or dups or notok:
        print('   🟡 **只是提醒, 不擋這顆 commit**(rc 恆 0)。修法:`python3 scripts/board-token-normalize.py --fix`')
        print('      🔴 而 `--fix` 動的是【工作樹】⇒ 修完要重新 `git add` 才會進這顆 commit。')
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
        # 世界二:板 staged 且有違規 ⇒ 印出來, 而 rc 仍是 0
        git('add', BOARD)
        buf2 = _io.StringIO()
        with contextlib.redirect_stdout(buf2):
            rc_b = check_staged()
        out = buf2.getvalue()
        ck('板 staged 有違規 ⇒ rc 仍 0(warn-only)', rc_b, 0)
        # ⛔ ~~原本斷言印出「位移候選」逐列~~ ⇒ 2026-09-07 12:5x 改成【一行摘要】
        #    (實測那顆 commit 印 16 行, 一半是與它無關的全板舊債 ⇒ 會殺掉針對性的提醒)
        #    ✅ 而這一格【不能因此拿掉】—— 它守的是「板 staged 時這道閘真的有輸出」。
        ck('板 staged 有違規 ⇒ 有印出全板摘要', '全板另有' in out, True)
        ck('板 staged ⇒ 不再逐列印全板舊債', '位移候選 :' in out, False)
        ck('板 staged 有違規 ⇒ 明說不擋', '不擋這顆 commit' in out, True)
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
        ck('板上含 zzz_bogus ⇒ 叫', '常被當成負對照' in buf13.getvalue(), True)
        io.open(board, 'w', encoding='utf-8').write(base_rows + '\n')
        git('add', BOARD)
        buf14 = _io.StringIO()
        with contextlib.redirect_stdout(buf14):
            check_staged()
        ck('板上沒有那些字 ⇒ 不叫', '常被當成負對照' in buf14.getvalue(), False)

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
    print('SELFTEST ' + ('PASS' if not fails else 'FAIL:' + ','.join(fails)))
    return 0 if not fails else 1


if __name__ == '__main__':
    a = sys.argv[1] if len(sys.argv) > 1 else ''
    if a == '--selftest':
        sys.exit(selftest())
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
