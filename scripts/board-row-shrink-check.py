#!/usr/bin/env python3
"""板列縮水檢查 —— **一列的歷史變短了 ⇒ 停下來寫一句為什麼**。

用法:
  python3 scripts/board-row-shrink-check.py            比【工作樹】與 HEAD
  python3 scripts/board-row-shrink-check.py --staged   比【index】與 HEAD
  python3 scripts/board-row-shrink-check.py --selftest  兩個世界(縮 / 長)
rc:  0 = 沒有縮 · 2 = 有列縮了(**停**, 不是擋)· 1 = 工具自壞

══ 🔴 為什麼有它(2026-09-08 · 主視窗 A 開規格 · `-ship` 做)═══════════════════
一列掉了 **47 段歷史**, 而既有兩道尺**都過了**:【欄數 = 7】✅ ·【裸豎線 = 0】✅。
📌 **⇒ 那兩道尺量的是【形狀】, 而縮水改的是【內容的量】** —— 形狀沒壞。

🔴🔴 **而本閘真正的理由是【同一種錯, 一次有守門一次沒有】**(`-ship` 2026-09-07/08 自陳兩次):
   ① 我在 `board-token-normalize.py` 裡把一個 `print` 的字串斷成兩行(未終止字串)
      ⇒ `--selftest` **當場 rc=1 SyntaxError** ⇒ 🟢 **碼這一側有守門, 它擋下來了。**
   ② 我的落板腳本把**一段沒接好的 Python 字串**(`交 `+"…"+``)**原封寫進板**
      ⇒ 🔴 **沒有任何東西會紅** —— 三綠不看板、板閘只看 token 與豎線
      ⇒ **是我自己 `grep` 才抓到的**(命中 1 ⇒ 修完 0)。
🎯 **⇒ 那不是「我寫板的時候比較不小心」, 是【板這一側沒有那道閘】。**
   📌 **把「我要更小心」換成一個位置** —— 而位置補得起來, 小心補不起來。

══ 🛑 天花板(先讀, 不要把它讀得比它大)═══════════════════════════════════
 ① 它**只看有錨的列** —— 無錨列**印出來當分母**, 但比不了(沒有穩定的身分)。
 ② 它**答不出「那 47 段該不該掉」** —— 合法的縮減是存在的(刪除線清理 / 合併重複列)
    ⇒ 📌 **所以它是【停】不是【擋】:停下來的人要寫一句為什麼少。**
 ③ 🔴 **兩個方向都印, 而只有【少】才 rc=2** —— 收割 merge 會讓一列合法地長很多
    (實例:收 account 三顆之後某列 `<br>` 41 ⇒ 95、字元 4206 ⇒ 10410, **那是預期的**)。
    📌 **一道對合法增長也叫的閘, 今天第一發就會被繞過。**
 ④ 🔴 **數的是【字元】不是 bytes** —— 2026-09-07 夜兩個窗為同一列吵了半小時:
    一個量到 7400(bytes, macOS awk 預設 locale)、一個量到 4206(字元), `<br>` 都是 41
    ⇒ **同一列同一內容。** ⇒ ✅ **本支把單位印在數字旁邊, 不讓它離開量測現場。**
 ⑤ **它今天不掛任何 hook** —— 掛不掛由主視窗裁, 因為**「停」與「擋」是兩件事**。
 ⑥ 🔴🔴 **本閘看不見【一個錨佔兩列】的那些錨的縮水**(2026-09-08 真板 = **17** 個)。
    成因:一個錨兩列時本支**不猜哪一列是它** ⇒ **整個錨移出分母**。
    🔬 實測:對 `⟦b4-FITSYNC1⟧` 的真列砍 **40 段 `<br>`** ⇒ **rc=0、印「✅ 沒有任何一列變短」**。
    🛑 **⇒ 那是【知情的沉默】, 不是修好了** —— R1 抓到的是「靜默覆蓋」, 修掉的也只是靜默:
       那 17 個錨現在**被計數、被列名、被印在分母旁**, 而**它們的縮水本閘照樣看不見。**
    📌 **要讓它們受保護, 得先讓板上一個錨只佔一列** —— 那是別人的板, 不是本支能做的。
"""
import io
import re
import subprocess
import sys

BOARD = 'docs/launch-todo.md'
ANCHOR = re.compile(r'⟦[^⟦⟧]+⟧')
SPLIT = re.compile(r'(?<!\\)\|')


def rows(text):
    """回 `(比得了的, 無錨數, 重複錨集合, 欄太少數)` —— 🔴 **四個桶都回, 那個 0 才有分母。**

    🔴🔴 **`dup` 這個桶是 code-reviewer 2026-09-08 抓到的 must-fix**:
       第一版用 `out[錨] = …` **靜默覆蓋** —— 而板上**現在就有 17 個錨各佔 2 列**
       (真列 + 錨欄帶反引號的「正本在下面」指標列), **指標列排在後面 ⇒ 存進去的是它**。
       🔬 實測:對 `⟦b4-FITSYNC1⟧` **真列**砍掉 **40 段 `<br>`** ⇒ **rc=0、印「✅ 沒有任何一列變短」**
       ⇒ 🎯 **那正是本支存在的那一種事故, 而它從我這裡溜過去。**
    ✅ 修法 = **不覆蓋、也不合併加總**(一縮一長會互相抵銷)⇒ **整個 key 移出分母, 印給人看。**
    📎 同型判別式既有前例:`scripts/board-row-by-anchor.sh:12-30`(錨欄反引號 = 引用列)——
       🛑 **那份已經量過並記載這個型態, 而我重蹈了它** ⇒ 下一個寫板尺的人先讀那 20 行。
    """
    out, noanchor, dup, thin = {}, 0, set(), 0
    for line in text.split('\n'):
        if not line.startswith('| '):
            continue
        f = SPLIT.split(line)
        if len(f) < 5:
            thin += 1          # 🔵 三欄小表那一族 —— 它不在 675 也不在 269, 要自己一個桶
            continue
        m = ANCHOR.search(f[2])
        if not m:
            noanchor += 1
            continue
        k = m.group(0)
        if k in out:
            dup.add(k)
            continue
        out[k] = (line.count('<br>'), len(line))
    for k in dup:
        out.pop(k, None)       # 🔴 一個錨兩列 ⇒ 兩列都不算, 不猜哪一列是它
    return out, noanchor, dup, thin


def git_show(ref, path):
    # 🔴 `ref=':'`(index)組出來是 `::path` ⇒ **`--staged` 從來沒有能跑過**
    #    (code-reviewer 2026-09-08 must-fix;它是**大聲壞**不是假綠, 而檔頭把它列為支援用法)。
    spec = f':{path}' if ref == ':' else f'{ref}:{path}'
    p = subprocess.run(['git', 'show', spec],
                       capture_output=True, text=True)
    if p.returncode != 0:
        print(f'🔴 讀不到 {spec} ⇒ 尺沒接上, 不是乾淨', file=sys.stderr)
        sys.exit(1)
    return p.stdout


def compare(old_txt, new_txt, label):
    old, old_na, old_dup, old_thin = rows(old_txt)
    new, new_na, new_dup, new_thin = rows(new_txt)
    if not old or not new:
        print(f'🔴 分母是 0(舊 {len(old)} 列 / 新 {len(new)} 列)⇒ 尺沒接上', file=sys.stderr)
        return 1
    shrunk, grew = [], []
    for k, (nb, nc) in new.items():
        if k not in old:
            continue
        ob, oc = old[k]
        if nb < ob or nc < oc:
            shrunk.append((k, ob, nb, oc, nc))
        elif nb > ob or nc > oc:
            grew.append((k, ob, nb, oc, nc))
    # 🔴 R2 nit:舊版單列而新版多了指標列 ⇒ 該錨被 pop ⇒ 會被誤報成「整列不見」,而它明明還在。
    gone = [k for k in old if k not in new and k not in new_dup]
    print(f'📏 比 {label}:兩邊都有錨的列 {len(set(old) & set(new))} '
          f'· 只在舊的 {len(gone)} · 只在新的 {len(set(new) - set(old))}')
    print(f'   ⚪ **比不了的三桶(印出來是為了讓那個 0 有分母)**:無錨 舊 {old_na}/新 {new_na}'
          f' · 🔴 一錨兩列 舊 {len(old_dup)}/新 {len(new_dup)}'
          f' · 欄少於 5 舊 {old_thin}/新 {new_thin}')
    if new_dup:
        print(f'   🔴 **一個錨佔兩列 ⇒ 那個錨【整個移出分母】, 本支不猜哪一列是它**'
              f'(常見成因:錨欄帶反引號的指標列)⇒ ' + ' · '.join(sorted(new_dup)[:6])
              + (' …' if len(new_dup) > 6 else ''))
    if grew:
        # 🔴 增長只印一行, 不叫 —— 見天花板 ③
        db = sum(b - a for _, a, b, _, _ in grew)
        print(f'🔵 有 {len(grew)} 列變長(合計 +{db} 段 `<br>`)⇒ **不叫**(收割 merge 是合法增長)。')
    if gone:
        print(f'🔴 有 {len(gone)} 列的錨在新版找不到 ⇒ 那不是縮水, 是【整列不見或改了錨】:')
        for k in gone[:10]:
            print(f'   · {k}')
    if not shrunk:
        print('✅ 沒有任何一列變短。')
        return 2 if gone else 0
    print(f'🛑🛑 {len(shrunk)} 列變短 ⇒ **停下來, 每一列寫一句為什麼少**'
          f'(合法的縮減存在:刪除線清理 / 合併重複列):')
    for k, ob, nb, oc, nc in shrunk:
        print(f'   · {k}  `<br>` {ob} ⇒ {nb}({nb - ob})'
              f' · 字元 {oc} ⇒ {nc}({nc - oc})   ⚠️ 單位=字元, 不是 bytes')
    return 2


def selftest():
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name}:{got}(期望 {want})')
        if not ok:
            fails.append(name)

    base = ('| open | ⟦x-A⟧ | 題 | 誰 | ⟨擋⟩ 一<br>二<br>三 |\n'
            '| open | ⟦x-B⟧ | 題 | 誰 | ⟨擋⟩ 只有一段 |\n'
            '| open | — | 無錨那列 | 誰 | ⟨擋⟩ 內容 |\n')
    short = base.replace('⟨擋⟩ 一<br>二<br>三', '⟨擋⟩ 一')
    longer = base.replace('⟨擋⟩ 一<br>二<br>三', '⟨擋⟩ 一<br>二<br>三<br>四')
    r, na, dp, th = rows(base)
    ck('① 有錨列數', len(r), 2)
    ck('② 無錨列【單獨數】(那個 0 才有分母)', na, 1)
    # 🔴 ⑨⑩ 釘住 must-fix 1 —— 少了它們, 把 dup 那段改回覆蓋沒有東西會叫。
    dupdoc = base + '| open | `⟦x-A⟧` 正本在上面 | 指標 | 誰 | ⟨擋⟩ 短 |\n'
    r2, _n2, dp2, _t2 = rows(dupdoc)
    ck('⑨ 一個錨兩列 ⇒ 那個錨【移出分母】, 不得靜默覆蓋', sorted(dp2), ['⟦x-A⟧'])
    ck('⑩ 而移出去之後它不在比對集裡(不猜哪一列是它)', '⟦x-A⟧' in r2, False)
    ck('③ `<br>` 數', r['⟦x-A⟧'][0], 2)
    # 🔴 兩個世界:縮 ⇒ 2, 長 ⇒ 0。少了任一格, 把 `nb < ob` 改成 `False` 沒有東西會叫。
    ck('④ 世界【縮】⇒ rc=2', compare(base, short, 'selftest-縮'), 2)
    ck('⑤ 世界【長】⇒ rc=0(合法增長不得叫)', compare(base, longer, 'selftest-長'), 0)
    ck('⑥ 世界【一樣】⇒ rc=0', compare(base, base, 'selftest-同'), 0)
    # 🔴 負對照:分母是 0 要回 1(尺沒接上), 不得回 0
    ck('⑦ 🔴 負對照:新版沒有任何資料列 ⇒ 1(尺沒接上, 不是乾淨)',
       compare(base, '沒有表格的一段話\n', 'selftest-空'), 1)
    # 🔴 而「整列不見」與「變短」是兩件事 —— 它們的下一步不同
    ck('⑧ 錨整個不見 ⇒ 2, 而訊息說的是【整列不見】不是縮水',
       compare(base, base.replace('| open | ⟦x-B⟧ | 題 | 誰 | ⟨擋⟩ 只有一段 |\n', ''), 'selftest-掉列'), 2)
    print(f'  ⇒ {10 - len(fails)} PASS / {len(fails)} FAIL')
    if fails:
        print('SELFTEST FAIL:' + ' · '.join(fails))
        return 1
    print('SELFTEST PASS')
    return 0


def main():
    a = sys.argv[1:]
    if '--selftest' in a:
        return selftest()
    ref = 'HEAD'
    new = (git_show(':', BOARD) if '--staged' in a
           else io.open(BOARD, encoding='utf-8').read())
    return compare(git_show(ref, BOARD), new,
                   f'{ref} ⇒ ' + ('index' if '--staged' in a else '工作樹'))


if __name__ == '__main__':
    sys.exit(main())
