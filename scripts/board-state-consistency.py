#!/usr/bin/env python3
# board-state-consistency.py — 兩張「態欄板」的內部一致性掃描。
#
# ══ 為什麼要有它(2026-08-25 線 3 · 幽靈清查線乙)═══════════════════════════
# 兩份檔各自被抓到同一個病, 而**兩邊都不會叫**:
#   `docs/launch-todo.md`  態欄 `open` 而該列內文寫著「✅ 已結掉」
#   spec `§1-A-1`          列坐在「✅ 現在做得到」那張表裡, 而狀態欄寫「🔴 …做不到」
# 🔴 而 launch-todo 自己附的數法會**少數**那些態欄不在封閉集的列:
#   `grep -oE '\| (open|doing|parked|done) \|'` 與實際資料列數不相等時, 沒有任何東西會叫。
#   **「板子有 96 件」與「板子有 99 件而我漏了 3 件」印同一個東西。**
#
# ══ 🔴 它的出生事故(留著, 因為它是零回饋的那一種)══════════════════════════
# 2026-08-25 本檔剛放進 `scripts/` 而**還沒登記進 `package.json` 的 lint-staged** 的那段空窗,
# `.husky/scripts-whitelist-gate.sh` 判「沒有歸屬」⇒ **全隊(主視窗 + 三條下手線)的 commit 全部卡死。**
#   🔴 **放檔是【我的】動作, 而被擋的是【下一個碰 pre-commit 的人】**
#      ⇒ 造成它的人不會撞到它 ⇒ **對造成它的人, 這個錯是零回饋的。**
#   🔴 而那道閘的訊息寫著「這是你要處理的東西」——
#      **對造成它的窗為真, 對被擋的窗為假** ⇒ 兩個窗都以為那支檔是自己的。
#   📌 規矩(主視窗 2026-08-25 立):**放新腳本進 `scripts/` ⇒ 放檔與登記在同一個動作裡。**
#   📌 而**一個零回饋的錯, 不會靠「下次記得」修好** —— 這段寫在這裡是因為它會再發生。
#
# ══ 🔴 天花板(先讀這段, 不要把它讀得比它大)══════════════════════════════
#  ① **它只看得到【寫在同一列文字裡】的矛盾。** 一列若安靜地過期(沒有人回來寫「已結掉」),
#     它**完全看不見, 而且會一直是綠的**。⇒ 它防的是「有人回來寫了一半」, 不是「沒有人回來」。
#  ② 規則② 的字集是**人列的四個詞**, 不是窮舉。已知漏兩個形狀(2026-08-25 逐列開檔核):
#       `#904` 那一列寫「**已補 2 格**」  ⇒ 抓不到(子項完成與整列結案在文字上分不開)
#       `J:226` 誰欄寫「✅ 已 commit 進 dev」⇒ 抓不到(用詞不在四詞內)
#  ③ 規則②③ 都刻意收窄。誤擋率乾跑見 `--why` 印出的表。
#     ⚠️ ~~原寫「收窄的代價是漏, 不是誤擋」~~ ⇒ **codex 推翻**, 見下面 ⑧。
#  ④ 🔴 **反方向(態=done/parked 而內文自稱還沒做)【刻意不做】** —— 不是忘了。
#     2026-08-25 乾跑(分母 = launch-todo 的 30 個 done/parked 列):
#       寬字集 ⇒ 9 列 · 中字集 ⇒ 4 列 · 只看【事】欄 ⇒ 1 列
#     而**只看【事】欄那 1 列是誤擋**:`M:300` 的事欄是 `B5-a 的 20260824030000 **仍未** apply`,
#     那是**這一列在描述的缺陷本身**, 不是它現在的狀態(Sean 已 apply、該列是真的 done)。
#     🔴 **【事】欄天生就在唸缺陷的名字** ⇒ 那一列的誤擋是可解釋的, 不是巧合。
#     ⚠️ **而「100% 誤擋」這個說法要收窄**(R2 抓到):~~原寫「結構上 100% 誤擋」~~ ——
#        **那個 100% 的分母是 1**。準確說法:**在【事】欄這個位置, 分母 1 / 誤擋 1**。
#     ⚠️ 而 R2 另外指出**第三種寫法**:同型字樣**大量出現在「關鍵事實」欄而不是事欄**
#        (例:一列態=doing 而關鍵事實欄寫「🔴 仍未 apply」, 且那一列已被更正過)
#        ⇒ **那個位置我一格都沒量。** 要做這個方向, 先量那裡。
#  ⑤ 🔴 **它讀的是【工作樹】, 不是 staged 的那一份**(codex F9)。
#     ⇒ partial staging 時兩者會分岔:**staged 是乾淨的而工作樹髒 ⇒ 它照樣擋**
#     (也可能反過來:staged 壞而工作樹已修 ⇒ 它放行)。
#     ⇒ **這是它掛進 pre-commit 之後最可能的誤擋來源**, 而目前**沒有修**。
#     要修的話得改成讀 index(`git show :<path>`), 那是另一片。
#  ⑥ **地板以上的消失是看不見的**(codex F10):板側地板 60、spec 側 5
#     ⇒ 一整節悄悄掉出分母而列數仍在地板之上 ⇒ 它**安靜全綠**。
#     地板只擋「掉光」, 不擋「掉一半」。
#  ⑦ **表頭只驗「整份檔至少看過一次」**(codex F11)——
#     ⇒ 同一份檔裡**另一張表**換了欄序或缺表頭, 它會被當資料讀而不出聲。
#  ⑧ 規則② 的收窄**不是只有漏、也有誤擋**(codex F12 推翻我原本寫的
#     ~~「收窄的代價是漏, 不是誤擋」~~):事欄寫「待確認是否已完成」「不是已完成」
#     這類**否定或疑問語境**照樣會紅。已處理的只有【劃掉】那一種(`~~已完成~~`)。
#  ⑨ **它不是守門, 除非有人把它掛上去。** 現行接線 = `package.json` 的 lint-staged
#     跑 `--selftest`(那只驗它自己活著);**對真檔跑那一發要有人在 CI 或 pre-commit 叫它**,
#     而那一步動 `.husky/` = 平台設定 = 鐵則 12④, 不在本檔的權限裡。
#
# ══ 用法 ════════════════════════════════════════════════════════════════
#    python3 scripts/board-state-consistency.py            掃兩份檔
#    python3 scripts/board-state-consistency.py --selftest 各規則兩個方向各一發
#    python3 scripts/board-state-consistency.py --why      印誤擋率乾跑的數字與量法
#
#    rc=0 全過 / rc=1 有 finding / rc=2 **工具自己壞掉**(與 finding 分得開)
#
# ══ 🔴🔴 它現在【只能當印報告用, 不能當擋人的閘】═══════════════════════════
# codex 兩輪都判 NO-GO 在同一件事上, 而那件事**沒有修**:
#   🔴 **它讀的是工作樹, 不是這顆 commit 要收的那份(index)。**
#      ⇒ partial staging 時兩者分岔:staged 乾淨而工作樹髒 ⇒ **誤擋**;
#        staged 壞而工作樹已修 ⇒ **放行**(比誤擋更糟)。
#   🔴 規則② **已知會誤擋**否定與疑問語境(「待確認是否已完成」「不是已完成」)。
# ⇒ **拿一個已知會誤擋、而且沒讀到真正要收的內容的工具去擋 commit, 不可接受。**
# ⇒ 現行接線只有 `package.json` lint-staged 跑 `--selftest`(那只驗它自己活著),
#    **沒有人在 commit 時對真檔叫它** —— 那是刻意的, 不是漏做。
# 📌 升成擋人閘的前置(codex 開的順序):① 改成掃 index(`git show :<path>`)+ 兩發
#    partial-staging 整合測試 ② 規則② 先只印報告 ③ 結構性的 ①③ 與 rc=2 才先升 blocking。
import io, os, re, subprocess, sys, tempfile

CLOSED = ('open', 'doing', 'parked', 'done')
DONE_WORDS = ('已結掉', '已做完', '已關掉', '已完成')
# ✅ 與那四個詞之間容許幾個字。
# 📏 2026-08-25 掃 0-200(量的對象 = **本檔 selftest 的 fixture**, 不是真板):
#    綠區間 = **[16, 29]**。15 以下格⑤ 紅(判決句抓不到), 30 以上格⑦ 紅(距離太遠的也被算成判決句)。
# 🔴 **兩個界都是量到的**(~~原寫「上界沒有量到天花板」~~ ⇒ R2 實測推翻:上界 29)。
# 🔴 而這個區間的**唯一證人是 fixture** —— 對真板跑 `LOOKBACK` 取 0/16/24/200 **一律 0 列命中**
#    ⇒ 真板此刻對這個常數**零判別力**。取 24 是區間中段, 不是因為 24 有什麼特別。
LOOKBACK = 24

BOARD = 'docs/launch-todo.md'
SPEC = 'docs/specs/2026-07-25-admin-backend-rebuild-spec.md'
# 🔴 分母地板:少掉一整節時, 唯一的訊號是「資料列 N」變小, 而沒有人 diff 那個 N。
#    這兩個數字是 2026-08-25 量的下界(當時 99 / 8), 留了緩衝。低於它 ⇒ 判量具失效, 不判通過。
BOARD_MIN_ROWS = 60
SPEC_GREEN_MIN_ROWS = 5


def split_cells(line):
    """切欄。🔴 `\\|` 是跳脫的豎線, 不能當欄位分隔。
       📏 板內現有 **28 處**(2026-08-25 當場數:`grep -o '\\\\|' docs/launch-todo.md | wc -l`;
          ~~原寫 11~~ ⇒ R2 實測推翻, 而 `193e41f9` 當時**也是 28** ⇒ 那不是檔變了, 是我寫錯)。"""
    parts = re.split(r'(?<!\\)\|', line)
    return [p.strip() for p in parts]


class MeasurementError(RuntimeError):
    """量具失效。🔴 codex R2:selftest 原本把【任何】RuntimeError 都當「量具失效」通過
       ⇒ 一格可能因為完全不同的錯誤而誤判通過。帶 code 才分得開。"""

    def __init__(self, code, msg):
        super().__init__(f'[{code}] {msg}')
        self.code = code


def _rows(path, sec_pat, head_pat, state_header):
    """撈資料列。同時驗【欄位標題】—— 不驗的話, 欄位順序一改它會靜靜地讀錯欄。"""
    try:
        lines = io.open(path, encoding='utf-8').read().split('\n')
    except OSError as e:
        raise MeasurementError('FILE_UNREADABLE', f'讀不到 {path}:{e}')
    rows, sec, in_fence, header_seen = [], None, False, False
    for i, l in enumerate(lines):
        # 🔴 code fence 內的示範表列不是真資料列。
        # 📏 板內現有 **7 條**(14 行 ```;~~原寫 8 條~~ ⇒ R2 實測推翻, `193e41f9` 當時也是 14 行)。
        if l.lstrip().startswith('```'):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = re.match(sec_pat, l)
        if m:
            sec = m.group(1)
        elif re.match(head_pat, l):
            sec = None
        # 🔴 codex R2:對齊分隔列 `| :--- | ---: |` 的字元集含 `:` ⇒ 原本的 set 檢查漏掉它。
        if sec is None or not l.startswith('|') or set(l) <= set('|-: '):
            continue
        f = split_cells(l)
        if len(f) < 3:
            continue
        # 表頭列:第一格就是那個標題字。驗它, 不是丟掉它。
        if f[1] == state_header:
            header_seen = True
            continue
        rows.append({'sec': sec, 'line': i + 1, 'state': f[1], 'f': f})
    if not header_seen:
        raise MeasurementError(
            'HEADER_MISSING',
            f'{path} 找不到任何欄位標題為「{state_header}」的表頭 —— '
            f'欄位順序若改過, 本工具會讀到別欄而靜靜全綠')
    return rows


def board_grep_count(path):
    """🔴 真的跑板子【自己附的那條數法】, 不要用 len(rows) 去推算它。
       兩邊是不同的機制(它不分節、不剝 fence), 今天相等不代表明天相等。"""
    try:
        out = subprocess.run(
            ['grep', '-oE', r'\| (open|doing|parked|done) \|', path],
            capture_output=True, text=True)
    except OSError as e:
        raise MeasurementError('GREP_UNRUNNABLE', f'跑不動 grep:{e}')
    # 🔴 grep 的 rc:0=有命中 · 1=零命中 · **2 以上=它自己出錯**。
    #    不看 rc 的話, 「grep 壞了」會回空 ⇒ 0 ⇒ 判成「板子少數了 N 列」⇒ **紅錯地方**。
    if out.returncode > 1:
        raise MeasurementError('GREP_FAILED', f'grep 對 {path} 回 rc={out.returncode}:{out.stderr.strip()[:80]}')
    return len([x for x in out.stdout.split('\n') if x.strip()])


def rule1_closed_set(rows):
    """① 態欄必須落在封閉集裡。空態欄也算 —— 那正是最壞的形狀(板子的 grep 也數不到它)。"""
    return [r for r in rows if r['state'] not in CLOSED]


def rule2_self_contradiction(rows):
    """② 態=open/doing 而該列自稱做完了。
       回傳 (row, 命中的欄位索引, 命中的詞) —— 🔴 codex F13:只印【事】欄的話,
       命中發生在後面欄位時會把人指向一個沒問題的欄。"""
    out = []
    for r in rows:
        if r['state'] not in ('open', 'doing'):
            continue
        f = r['f']
        found = None
        # 🔴 codex F12:劃掉的舊值不算宣稱(`~~已完成~~` 是更正慣例)⇒ 與 rule3 同一套剝法。
        if len(f) > 3:
            title = re.sub(r'~~.*?~~', '', f[3])
            for w in DONE_WORDS:
                if w in title:
                    found = (3, w)
                    break
        if found is None:
            for idx, cell in enumerate(f[4:], start=4):
                cell = re.sub(r'~~.*?~~', '', cell)
                for w in DONE_WORDS:
                    for m in re.finditer(re.escape(w), cell):
                        if '✅' in cell[max(0, m.start() - LOOKBACK):m.start()]:
                            found = (idx, w)
                            break
                    if found:
                        break
                if found:
                    break
        if found:
            out.append((r, found[0], found[1]))
    return out


def normalize_marker(s):
    """把【劃掉的舊值】與粗體/空白剝掉, 留下真正在宣稱的那個標記。
       🔴 剝劃線的理由:本 repo 的更正慣例是「劃掉不刪」(`~~❌~~ → **✅**`),
          不剝的話那個作廢的 ❌ 會被讀成現值。📏 誤擋率見 --why。"""
    s = re.sub(r'~~.*?~~', '', s)
    s = s.replace('*', '').replace('→', '').strip()
    return s


def rule3_marker_vs_table(rows):
    """③ 坐在「✅ 現在做得到」那張表裡, 而狀態欄不是【純 ✅】。
       🔴 用【白名單】不用黑名單:黑名單只認得你想得到的那幾個符號,
          而同一份 spec 自己就定義了第四種標記 `🔌`(2026-08-22 新增)。
          白名單版本對「🔌」「✅ 但只在測試環境」「空白」一律出聲。"""
    # 🔴 欄位不足也要出聲 —— 一列少了狀態欄與「狀態欄寫著 ✅」是兩件事。
    return [r for r in rows if len(r['f']) <= 3 or normalize_marker(r['f'][3]) != '✅']


def scan(board=BOARD, spec=SPEC, quiet=False, board_min=None, spec_min=None):
    board_min = BOARD_MIN_ROWS if board_min is None else board_min
    spec_min = SPEC_GREEN_MIN_ROWS if spec_min is None else spec_min

    def say(*a):
        if not quiet:
            print(*a)

    bad = 0

    rows = _rows(board, r'^## ([A-Z]+) · ', r'^#{2,3} ', '態')
    if len(rows) < board_min:
        raise MeasurementError(
            'BOARD_ROW_FLOOR',
            f'{board} 只撈到 {len(rows)} 列(地板 {board_min})—— '
            f'掉一整節時唯一的訊號就是這個數變小')
    say(f'══ {board}(資料列 {len(rows)})══')

    # ① 🔴 真的跑那條 grep, 兩個【各自量到的】數字比對。不是 len(rows) 減 len(strays)。
    # 🔴 兩條路【分開判、分開印】—— R2 抓到:合成一個 if 之後它們會互相遮蔽,
    #    拿掉任一條另一條都會接住 ⇒ 沒有任何一格證明它們【各自】活著。
    grep_n = board_grep_count(board)
    strays = rule1_closed_set(rows)
    if strays:
        bad = 1
        say(f'  🔴 ①a 態欄不在封閉集的有 {len(strays)} 列(封閉集 = {"/".join(CLOSED)})')
        for r in strays:
            st = r['state'] if r['state'] else '(空白)'
            say(f'     {r["sec"]} 節 :{r["line"]}  態=[{st}]')
    else:
        say(f'  ✅ ①a {len(rows)} 列的態欄全在封閉集裡')
    if grep_n != len(rows):
        bad = 1
        say(f'  🔴 ①b 板子自己的數法印 {grep_n},而資料列是 {len(rows)}(差 {len(rows) - grep_n})')
        if strays:
            say('     ⇒ 差額的一部分來自上面 ①a 那幾列(它們的態欄字樣, 那條 grep 認不得)')
        else:
            say('     ⚠️ 而【一列態欄都沒錯】⇒ 差額來自別的地方。'
                '**下面是候選, 不是結論**(codex F14:過度推論會把人指錯方向):'
                'fence 裡的示範表列 / 節外的表 / 跳脫豎線 / 註解或引文裡的表格樣式。')
        say('     🔴 這仍然是【真的 finding】—— 板子那條數法會把示範列算進「還剩幾件」。'
            '處置是把示範列的態欄字樣改掉, 不是把本檢查關掉。')
    else:
        say(f'  ✅ ①b 板子的數法印 {grep_n} = 資料列 {len(rows)}(兩個各自量到的數)')

    contra = rule2_self_contradiction(rows)
    if contra:
        bad = 1
        say(f'  🔴 ② 態=open/doing 而自稱做完的有 {len(contra)} 列')
        for r, idx, w in contra:
            where = '事欄' if idx == 3 else f'第 {idx} 欄'
            say(f'     {r["sec"]} 節 :{r["line"]}  態=[{r["state"]}]  '
                f'命中「{w}」在【{where}】:{r["f"][idx][:44]}')
    else:
        say('  ✅ ② 零命中')

    grows = _rows(spec, r'^### .*(§1-A-1) ✅ 現在做得到', r'^#{3,4} ', '#')
    for r in grows:
        r['sec'] = 'GREEN'
    if len(grows) < spec_min:
        raise MeasurementError(
            'SPEC_ROW_FLOOR', f'{spec} §1-A-1 只撈到 {len(grows)} 列(地板 {spec_min})')
    say(f'══ {spec} §1-A-1(資料列 {len(grows)})══')
    odd = rule3_marker_vs_table(grows)
    if odd:
        bad = 1
        say(f'  🔴 ③ 坐在「✅ 現在做得到」表裡而狀態欄**不是純 ✅** 的有 {len(odd)} 列')
        say(f'     ⇒ 數「我們能做幾件」會數到 {len(grows)},而其中 {len(odd)} 列的狀態欄另有說法')
        say('     ⚠️ 「另有說法」不等於「做不完整」—— 也可能只是格式或註記。**去開那一列看。**')
        for r in odd:
            f = r['f']
            # 🔴 codex F15 的實例:這裡原本裸寫 f[3] ⇒ 一列【欄位不足】時 IndexError,
            #    而那正是 rule3 該抓的形狀之一 ⇒ **它抓到了, 然後印的時候自己炸掉。**
            if len(f) <= 3:
                say(f'     :{r["line"]}  #{f[1]} {f[2][:20] if len(f) > 2 else ""}  '
                    f'狀態=[缺這一欄, 整列只有 {len(f) - 1} 格]')
            else:
                mk = f[3] if f[3] else '(空白)'
                say(f'     :{r["line"]}  #{f[1]} {f[2][:20]}  狀態=[{mk[:40]}]')
    else:
        say(f'  ✅ ③ {len(grows)} 列狀態欄全是純 ✅')
    return bad


# ══ selftest ═════════════════════════════════════════════════════════════
# 🔴 設計原則(R1 抓到的病):**每一個修法都要對應到至少一格紅。**
#    第一版有七個修法拿掉之後 selftest 一格都不紅 ⇒ 那七段等於沒有守門。
def _pad(extra=''):
    """湊到地板以上的乾淨列, 讓每一格測的是它自己那條規則, 不是分母不足。"""
    head = '## A · 測試節\n| 態 | # | 事 | 誰 | 卡什麼 |\n|---|---|---|---|---|\n'
    body = ''.join(f'| open | — | 乾淨列 {i} | 待派 | 沒有結案字樣 |\n' for i in range(60))
    return head + body + extra


def _spec(extra=''):
    head = '### §1-A-1 ✅ 現在做得到\n| # | 能力 | 狀態 | 量法 |\n|---|---|---|---|\n'
    body = ''.join(f'| {i} | 能力 {i} | ✅ | 量過 |\n' for i in range(2, 10))
    return head + body + extra


GREEN_BOARD = _pad()
GREEN_SPEC = _spec()


def selftest():
    d = tempfile.mkdtemp()

    def w(name, text):
        p = os.path.join(d, name)
        io.open(p, 'w', encoding='utf-8').write(text)
        return p

    cases = [
        ('①該綠必綠 · 乾淨板 + 乾淨 spec', GREEN_BOARD, GREEN_SPEC, 0),
        ('②該紅必紅 · 態欄不在封閉集',
         _pad('| ~~open~~ **半關** | — | 錯填的態欄 | — | x |\n'), GREEN_SPEC, 1),
        ('③該紅必紅 · 態欄【空白】(板子的 grep 也數不到它)',
         _pad('|  | — | 空態欄 | — | x |\n'), GREEN_SPEC, 1),
        ('④該紅必紅 · 【事】欄自稱做完而態=open',
         _pad('| open | — | ✅ **這件已做完** | — | x |\n'), GREEN_SPEC, 1),
        ('⑤該紅必紅 · 【後面欄位】的 ✅+判決句(LOOKBACK 那條路)',
         _pad('| open | — | 一件事 | — | ✅ **2026-08-25 夜已結掉**:貼過了 |\n'), GREEN_SPEC, 1),
        ('⑥該綠必綠 · 四詞出現在句中而【沒有 ✅ 前綴】⇒ 子項完成, 不得誤擋',
         _pad('| open | — | 一件事 | — | F1 那一小格已做完並實測, 整件還沒 |\n'), GREEN_SPEC, 0),
        ('⑦該綠必綠 · ✅ 離那四個詞太遠 ⇒ 不算判決句(LOOKBACK 的上界證人)',
         _pad('| open | — | 一件事 | — | ✅ 這裡先講一段很長的別的事情所以距離拉開了非常非常遠了喔 已做完 |\n'),
         GREEN_SPEC, 0),
        ('⑧該紅必紅 · 🟡 坐在 ✅ 表裡', GREEN_BOARD, _spec('| 9 | 坐錯表的 | 🟡 | 量過 |\n'), 1),
        ('⑨該紅必紅 · 🔴 半邊(標記欄兩半)', GREEN_BOARD,
         _spec('| 9 | 半殘的 | ✅ **記得下來** / 🔴 **提醒不了他** | 量過 |\n'), 1),
        ('⑩該紅必紅 · ❌ 坐在 ✅ 表裡', GREEN_BOARD, _spec('| 9 | 做不到的 | ❌ | 量過 |\n'), 1),
        ('⑪該紅必紅 · 🔌 第四種標記(黑名單版會放行它)', GREEN_BOARD,
         _spec('| 9 | 被旗標關著的 | 🔌 `FLAG` | 量過 |\n'), 1),
        ('⑫該紅必紅 · 粗體 🟡(startswith 版會放行它)', GREEN_BOARD,
         _spec('| 9 | 粗體的 | **🟡** | 量過 |\n'), 1),
        ('⑬該紅必紅 · 帶但書的 ✅', GREEN_BOARD,
         _spec('| 9 | 有但書的 | ✅ 但只在測試環境 | 量過 |\n'), 1),
        ('⑭該綠必綠 · ~~❌~~ → ✅ 是更正慣例, 不得誤擋', GREEN_BOARD,
         _spec('| 10 | 更正過的 | ~~❌~~ → **✅** | 量過 |\n'), 0),
        # 🔴 ⑮ 這一格的期望值是 rc=1, 而它原本被我寫成 0 —— 那是【我的期望值錯了, 不是碼錯】。
        #    改期望值通常是停止訊號, 所以理由寫在這裡:
        #    本工具剝 fence, 而**板子自己那條 grep 不剝** ⇒ fence 裡放一列 `| open |`,
        #    板子的數法就會把它算進「還剩幾件」。**那是真的 finding, 不是誤擋。**
        #    處置是把示範列的態欄字樣改掉, 不是把本檢查關掉。
        ('⑮該紅必紅 · fence 裡的示範列會讓板子的數法多數一列',
         _pad('```\n| open | — | ✅ **這是示範不是真的** | — | x |\n```\n'), GREEN_SPEC, 1),
        ('⑯該綠必綠 · fence 裡【沒有態欄字樣】⇒ 剝 fence 那段本身要正確',
         _pad('```\n| 欄一 | 欄二 |\n| 示範 | 內容 |\n```\n'), GREEN_SPEC, 0),
        # 🔴 這一格原本餵在【板】側, 而那個輸入對壞掉的切法**也是綠的** ⇒ 恆綠、零判別力
        #    (2026-08-25 突變矩陣 M10 抓到:拿掉跳脫豎線處理 ⇒ 一格都不紅)。
        #    改餵在【spec】側:跳脫豎線放在「能力」欄 ⇒ 切法一壞, 狀態欄就讀到別的字 ⇒ 誤擋。
        ('⑰該綠必綠 · 跳脫豎線不得位移欄位(切法一壞這格就誤擋)', GREEN_BOARD,
         _spec('| 9 | 能力 \\| 別名 | ✅ | 量過 |\n'), 0),
        # ── R2 加的六格。每一格對應一個【R1/R2 突變存活】的缺口 ──────────────
        ('⑱該綠必綠 · 態=done 而事欄寫「已結掉」⇒ 不得抓(規則② 只管 open/doing)',
         _pad('| done | — | ✅ **這件已結掉** | — | x |\n'), GREEN_SPEC, 0),
        ('⑲該綠必綠 · 內文有「已」而不是那四個詞 ⇒ 不得抓(字集放寬會誤擋)',
         _pad('| open | — | 已下單、已到貨、已通知 | — | 都還沒收工 |\n'), GREEN_SPEC, 0),
        ('⑳該紅必紅 · spec 狀態欄【空白】(docstring 自稱會出聲, 而它曾零格覆蓋)',
         GREEN_BOARD, _spec('| 9 | 沒填狀態的 |  | 量過 |\n'), 1),
        ('㉑該紅必紅 · spec 側列數低於地板 ⇒ 判量具失效(不是 rc=1 也不是 rc=0)',
         GREEN_BOARD,
         '### §1-A-1 ✅ 現在做得到\n| # | 能力 | 狀態 | 量法 |\n|---|---|---|---|\n'
         + ''.join(f'| {i} | 能力 {i} | ✅ | 量過 |\n' for i in range(2, 6)),
         '量具失效:SPEC_ROW_FLOOR'),
        # ── R2 突變矩陣第二輪:A3/A4/A8/A9 四發【零格紅】⇒ 這四格是為它們補的 ──────
        ('㉒該綠必綠 · fence【關掉之後】的列要回來(只開不關的話它們會消失)',
         _pad()[:_pad().index('| open | — | 乾淨列 20')]
         + '```\n| 欄一 | 欄二 |\n```\n'
         + ''.join(f'| open | — | fence 之後的列 {i} | 待派 | x |\n' for i in range(20, 60)),
         GREEN_SPEC, 0),
        ('㉓該紅必紅 · 態欄多一個空白 ⇒ 板子的 grep 認不得它(①b 的【少數】方向)',
         _pad('| open  | — | 態欄多一個空白 | — | x |\n'), GREEN_SPEC, 1),
        # 🔴 期望值是 rc=1 而我原本寫 0 —— **又一次是我的期望值錯, 不是碼錯。**
        #    節外那張表:本工具**不算它**(rows 不變), 而板子那條 grep **會算它**(grep_n +1)
        #    ⇒ ①b 兩個數字對不上 ⇒ 紅, 而**那是真的 finding**:
        #      板子那條數法會把節外的表算進「還剩幾件」。
        #    ⇒ 這一格同時是【節範圍】的證人:節範圍一失效, 兩邊都算它 ⇒ 數字又相等 ⇒ 綠。
        #    🔴 那一列**刻意不帶結案字樣** —— 帶了的話規則② 會接住它, 這一格就分不出節範圍壞沒壞
        #       (2026-08-25 突變矩陣實測:帶結案字樣時 A9 零格紅)。
        ('㉔該紅必紅 · 節【外面】的表會讓板子的數法多數一列(也是節範圍的證人)',
         _pad() + '\n## 附錄(是 ## 開頭但沒有 ` · ` ⇒ 不是資料節)\n'
         '| 態 | # | 事 | 誰 | 卡什麼 |\n|---|---|---|---|---|\n'
         '| open | — | 節外的一列(刻意不帶結案字樣) | — | x |\n',
         GREEN_SPEC, 1),
        # ── codex NO-GO 那一輪補的九格(F1-F6, F12)────────────────────────
        ('㉕該綠必綠 · doing / parked 是封閉集成員(拿掉任一個成員這格就誤擋)',
         _pad('| doing | — | 在做的 | — | x |\n| parked | — | 擱著的 | — | 在等外部事件 |\n'),
         GREEN_SPEC, 0),
        ('㉖該紅必紅 · 事欄寫「已關掉」(字集第 3 個詞的證人)',
         _pad('| open | — | 這件**已關掉**了 | — | x |\n'), GREEN_SPEC, 1),
        ('㉗該紅必紅 · 事欄寫「已完成」(字集第 4 個詞的證人)',
         _pad('| open | — | 這件**已完成** | — | x |\n'), GREEN_SPEC, 1),
        ('㉘該紅必紅 · 態=doing 而自稱做完(規則② 的 doing 分支證人)',
         _pad('| doing | — | 這件**已完成** | — | x |\n'), GREEN_SPEC, 1),
        ('㉙該綠必綠 · 態=parked 而寫「已完成」⇒ 不得抓(規則② 的邊界)',
         _pad('| parked | — | 這件**已完成** | — | 在等外部事件 |\n'), GREEN_SPEC, 0),
        ('㉚該綠必綠 · 【劃掉的】已完成不是宣稱(codex F12 的誤擋面)',
         _pad('| open | — | ~~原寫已完成~~ ⇒ 其實還在做 | — | x |\n'), GREEN_SPEC, 0),
        ('㉛該綠必綠 · 節內含多個豎線的【普通文字】不得被吃成資料列',
         _pad('\n用法:`a | b | c` 這樣寫。\n'), GREEN_SPEC, 0),
        ('㉜該紅必紅 · spec 列【欄位不足】(不是欄位空白, 是根本沒那一欄)',
         GREEN_BOARD, _spec('| 9 | 缺欄的\n'), 1),
        # ── codex 第二輪補的四格(F12 後段 / F13 / F14 / 對齊分隔列)──────────
        ('㉞該綠必綠 · 【後面欄位】裡劃掉的「已完成」也不算宣稱(F12 的另一半分支)',
         _pad('| open | — | 還在做 | — | ✅ ~~已完成~~,更正為尚未完成 |\n'), GREEN_SPEC, 0),
        ('㉟該綠必綠 · 對齊分隔列 `| :--- | ---: |` 不是資料列',
         _pad('| :--- | ---: | :---: | --- | --- |\n'), GREEN_SPEC, 0),
        ('㊱該紅必紅 · fence 只開不關 ⇒ 後面整段消失 ⇒ 要撞到分母地板',
         _pad()[:_pad().index('| open | — | 乾淨列 50')] + '```\n'
         + ''.join(f'| open | — | 乾淨列 {i} | 待派 | x |\n' for i in range(50, 60)),
         GREEN_SPEC, '量具失效:BOARD_ROW_FLOOR'),
    ]
    ok = True
    for name, b, s, want in cases:
        try:
            got = scan(w('b.md', b), w('s.md', s), quiet=True)
        except MeasurementError as e:
            got = f'量具失效:{e.code}'   # 🔴 codex R2:帶 code, 不然任何錯都能冒充「該失效」
        mark = '✅' if got == want else '🔴'
        if got != want:
            ok = False
        print(f'  {mark} {name}  期望 rc={want} 實得 rc={got}')

    # 🔴 rc 對 ≠ 訊息有用。M1(rule1 回 [])那一發 **rc 仍然是 1**(grep 那條路接住了),
    #    而訊息會說「一列態欄都沒錯」並把讀的人指向 fence / 豎線 —— **指錯方向**。
    #    ⇒ 這一格驗的是【輸出點不點得出那一列】, 不是 rc。
    #    📌 主視窗 2026-08-25 的意思是:一道印「有 N 列不對」的閘, 與一道印「哪 N 列不對」的閘,
    #       修復成本差一個數量級。⇒ 那個性質要有守門。
    #    ⚠️ **原句已隨 session 消失, repo 內 grep 不到**(`literal-sweep.sh` 全類別 0 命中)
    #       ⇒ 上面那兩行是**轉述不是逐字**, 不要當引文用。
    import contextlib as _ctx
    _buf = io.StringIO()
    with _ctx.redirect_stdout(_buf):
        try:
            scan(w('b.md', _pad('| ~~open~~ **半關** | — | 錯填的態欄 | — | x |\n')),
                 w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    _b2 = io.StringIO()
    with _ctx.redirect_stdout(_b2):
        try:
            scan(w('b.md', _pad('|  | — | 空態欄那一列 | — | x |\n')), w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    if '半關' in _buf.getvalue() and '①a' in _buf.getvalue():
        print('  ✅ 甲·訊息點名 · 錯填的那一列被【逐列點名】且掛在 ①a 底下')
    else:
        print('  🔴 甲·訊息點名 · rc 對而訊息沒點出那一列, 或沒掛在 ①a')
        ok = False
    # 🔴 空態欄那一列必須出現在 ①a 底下 —— 只靠 rc 分不出來(①b 也會因為它而紅)
    if '(空白)' in _b2.getvalue() and '①a' in _b2.getvalue():
        print('  ✅ 乙·空態欄 · 被 ①a 逐列點名為 (空白)(不是只靠 ①b 的數字差接住)')
    else:
        print('  🔴 乙·空態欄 · ①a 沒有點名它 ⇒ 它是被 ①b 的數字差【順便】接住的')
        ok = False

    # ㉘ 分母地板:掉一整節(而不是歸零)也要判量具失效
    try:
        scan(w('b.md', _pad()[:_pad().index('| open | — | 乾淨列 30')]), w('s.md', GREEN_SPEC), quiet=True)
        print('  🔴 丙·分母地板 · 列數掉到地板以下而它印了通過')
        ok = False
    except RuntimeError:
        print('  ✅ 丙·分母地板 · 列數低於地板 ⇒ 判量具失效(不判通過)')

    # ㉙ 欄位標題驗證:狀態欄改名 / 移位 ⇒ 判量具失效, 不得靜靜全綠
    try:
        scan(w('b.md', GREEN_BOARD),
             w('s.md', _spec().replace('| # | 能力 | 狀態 | 量法 |', '| 項 | 能力 | 狀態 | 量法 |')),
             quiet=True)
        print('  🔴 丁·欄位標題 · 標題改了而它靜靜跑完')
        ok = False
    except RuntimeError:
        print('  ✅ 丁·欄位標題 · 找不到預期的表頭 ⇒ 判量具失效')

    # ㉚ 讀不到檔:訊息要點名那支檔(rc=2 那條路)
    try:
        scan(os.path.join(d, 'no-such.md'), w('s.md', GREEN_SPEC), quiet=True)
        print('  🔴 戊·檔不存在時沒有出聲')
        ok = False
    except RuntimeError as e:
        if 'no-such.md' not in str(e):
            print(f'  🔴 戊·訊息沒點名那支檔:{e}')
            ok = False
        else:
            print('  ✅ 戊·檔不存在 ⇒ RuntimeError 且點名該檔(呼叫端轉 rc=2, 與 finding 的 rc=1 分得開)')

    # ㉛ grep 那一半:板子的數法與資料列數【各自量】, 不是同一個變數推出來的
    b2 = _pad('| open | — | 這一列的態欄在封閉集裡 | — | x |\n')
    p = w('b.md', b2)
    if board_grep_count(p) == 0:
        print('  🔴 己·board_grep_count 對一份有 open 列的板子回 0 ⇒ 它沒在跑')
        ok = False
    else:
        print(f'  ✅ 己·board_grep_count 真的在跑(該板 ⇒ {board_grep_count(p)})')

    # ㉝ grep 自己出錯(rc>1)要判量具失效, 不得回 0 而被讀成「板子少數了 N 列」。
    #    🔴 這一格是【單元級】的:整支 scan() 走不到這裡(io.open 會先炸)⇒ 直接餵 board_grep_count。
    try:
        board_grep_count(d)  # 目錄不是檔 ⇒ grep 回 rc=2
        print('  🔴 庚·grep rc · grep 對目錄回錯而它沒出聲 ⇒ 會回 0 並被讀成「少數了 N 列」')
        ok = False
    except RuntimeError:
        print('  ✅ 庚·grep rc · grep 自己出錯 ⇒ 判量具失效(不是回 0 假裝零命中)')

    # 子 🔴 codex R2:F13 與 F14 **只改了行為與字面, 沒有任何一格在看訊息**
    #    ⇒ 改回「固定印事欄」或「過度推論的舊文案」, 44 格照樣全綠。這兩格補那個缺口。
    _b3 = io.StringIO()
    with _ctx.redirect_stdout(_b3):
        try:
            scan(w('b.md', _pad('| open | — | 一件事 | — | ✅ **已結掉** |\n')),
                 w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    _o3 = _b3.getvalue()
    if '第 5 欄' in _o3 and '已結掉' in _o3:
        print('  ✅ 子·規則②訊息 · 點名【命中在第幾欄】與【哪個詞】(不是固定印事欄)')
    else:
        print('  🔴 子·規則②訊息 · 沒點名命中欄位/詞 ⇒ 人會被指向一個沒問題的欄')
        ok = False

    _b4 = io.StringIO()
    with _ctx.redirect_stdout(_b4):
        try:
            scan(w('b.md', _pad('```\n| open | — | 示範 | — | x |\n```\n')), w('s.md', GREEN_SPEC))
        except MeasurementError:
            pass
    if '候選' in _b4.getvalue():
        print('  ✅ 丑·①b 訊息 · 成因標成【候選】不是結論(codex F14)')
    else:
        print('  🔴 丑·①b 訊息 · 把候選成因寫成結論 ⇒ 過度推論')
        ok = False

    _b5 = io.StringIO()
    with _ctx.redirect_stdout(_b5):
        try:
            scan(w('b.md', GREEN_BOARD), w('s.md', _spec('| 9 | 坐錯表的 | 🟡 | 量過 |\n')))
        except MeasurementError:
            pass
    if '不等於' in _b5.getvalue():
        print('  ✅ 寅·③ 訊息 · 「另有說法不等於做不完整」那句在(codex F14)')
    else:
        print('  🔴 寅·③ 訊息 · 把「非純 ✅」直接說成「做不完整」⇒ 過度推論')
        ok = False

    # 壬 🔴 codex F6:rc=0 與 rc=1 這兩條也要真的走過 `__main__`。
    #    只驗 rc=2 的話, 把 `sys.exit(scan())` 改成裸 `scan()` ⇒ finding 會靜靜 exit 0。
    _here = os.path.abspath(__file__)
    _cases = [(GREEN_BOARD, GREEN_SPEC, 0, '乾淨'),
              (_pad('| ~~open~~ **半關** | — | 錯填 | — | x |\n'), GREEN_SPEC, 1, '有 finding')]
    for _b, _s, _want, _lbl in _cases:
        _d2 = tempfile.mkdtemp()
        io.open(os.path.join(_d2, 'docs'), 'w')  # 佔位, 讓相對路徑一定不存在
        os.remove(os.path.join(_d2, 'docs'))
        os.makedirs(os.path.join(_d2, 'docs', 'specs'), exist_ok=True)
        io.open(os.path.join(_d2, BOARD), 'w', encoding='utf-8').write(_b)
        io.open(os.path.join(_d2, SPEC), 'w', encoding='utf-8').write(_s)
        _r = subprocess.run([sys.executable, _here], cwd=_d2, capture_output=True, text=True)
        if _r.returncode == _want:
            print(f'  ✅ 壬·rc 對應表 · {_lbl} fixture ⇒ 子程序真的 exit {_want}')
        else:
            print(f'  🔴 壬·rc 對應表 · {_lbl} fixture ⇒ exit {_r.returncode}(該是 {_want})')
            ok = False

    # 癸 🔴 codex F15:**非預期**的例外(不是 RuntimeError)也要落 rc=2, 不得落 rc=1。
    #    餵一份不是 UTF-8 的板 ⇒ io.open 丟 UnicodeDecodeError(不是 OSError ⇒ 不會變 RuntimeError)。
    #    📌 這一格是真的踩過才補的:rule3 抓到「欄位不足」那一列之後, **印訊息時自己 IndexError**
    #       ⇒ 沒有這條 except 的話, 那一發會 exit 1 而被讀成「有 finding」。
    _d3 = tempfile.mkdtemp()
    os.makedirs(os.path.join(_d3, 'docs', 'specs'), exist_ok=True)
    open(os.path.join(_d3, BOARD), 'wb').write(b'## A \xb7 \xff\xfe not utf8\n')
    io.open(os.path.join(_d3, SPEC), 'w', encoding='utf-8').write(GREEN_SPEC)
    _r3 = subprocess.run([sys.executable, os.path.abspath(__file__)],
                         cwd=_d3, capture_output=True, text=True)
    if _r3.returncode == 2:
        print('  ✅ 癸·非預期例外 · 非 UTF-8 的板 ⇒ exit 2(不是 1)')
    else:
        print(f'  🔴 癸·非預期例外 · exit {_r3.returncode}(該是 2)⇒ 它會被讀成「有 finding」')
        ok = False

    # 辛 🔴 rc 對應表整段從沒被驗過 —— 前面那些格都在 in-process 跑 scan(),
    #    **一格都沒經過 `__main__` 那三行**。R2 實測:把 sys.exit(2) 改成 sys.exit(1) ⇒ selftest 全綠。
    #    ⇒ 這一格真的開一個子程序, 斷言 exit code。
    r = subprocess.run(
        [sys.executable, os.path.abspath(__file__)],
        cwd=d, capture_output=True, text=True)
    if r.returncode == 2:
        print('  ✅ 辛·rc 對應表 · 讀不到檔 ⇒ 子程序真的 exit 2(與 finding 的 1 分得開)')
    else:
        print(f'  🔴 辛·rc 對應表 · 讀不到檔而子程序 exit {r.returncode}(該是 2)')
        ok = False

    print('\n全部通過。' if ok else '\n🔴 有格沒過。')
    return 0 if ok else 1


WHY = """誤擋率乾跑

🔴 先讀:下面每一組數字都綁著【量測時點 2026-08-25 凌晨】與【當時的檔】。
   那兩份檔一直在被改(量測當晚 launch-todo 從 99 列走到 100 列、
   spec §1-A-1 從 11 列走到 8 列)⇒ **這些數字不會自己更新, 也沒有東西會在它們漂掉時出聲。**
   要現值就照下面的量法當場重跑。

── 規則② 字集與位置 ──(量測時分母 = launch-todo 的 99 資料列)
   字集 A(含裸 ✅ + 四詞, 不限位置)  ⇒ 24 列, 人工判【多數是誤擋】(進度句裡的 ✅)
   字集 B(四詞, 不限位置)            ⇒  3 列, 其中 1 列誤擋(`#858` 的「F1 … 已做完」是子項)
   字集 C(本規則:限【事】欄或 ✅ 判決句)⇒  2 列, 誤擋 0
   四個詞 = 已結掉 / 已做完 / 已關掉 / 已完成(見 DONE_WORDS)
   字集 A 多的那個 = 裸 `✅`(不要求它後面接那四個詞)
   量法:對每組字集重跑一次全表, 逐列開檔核判真偽。

── 規則③ 剝不剝劃線 ──(量測時分母 = spec §1-A-1 的 11 列;**現值已是 8 列**)
   不剝 ~~...~~  ⇒ 5 列, 其中 2 列誤擋(`#10` / `#16` 的 `~~❌~~ → **✅**`)
   剝了          ⇒ 3 列, 誤擋 0

── 反方向(態=done/parked 而自稱還沒做)──(量測時分母 = 30 個 done/parked 列)
   寬字集(仍未/還沒/尚未/未做/沒做)⇒ 9 列 · 中字集(仍未/尚未)⇒ 4 列 · 只看【事】欄 ⇒ 1 列
   🔴 而那 1 列是誤擋(事欄在唸缺陷的名字)⇒ **在【事】欄這個位置, 分母 1 / 誤擋 1。**
   ⚠️ 不要把它讀成「結構上 100% 誤擋」—— **那個 100% 的分母是 1。**
   ⚠️ 而同型字樣**大量出現在「關鍵事實」欄而不是事欄** ⇒ **那個位置一格都沒量。**
   ⇒ 本規則刻意不做, 而要做的話**先量那裡**。

── LOOKBACK ──(量的對象 = 本檔 selftest 的 fixture, **不是真板**)
   掃 0-200 ⇒ 綠區間 = **[16, 29]**。15 以下格⑤ 紅, 30 以上格⑦ 紅。**兩個界都是量到的。**
   🔴 而真板此刻對它**零判別力**:LOOKBACK 取 0/16/24/200, 規則② 對真板一律 0 列命中。
"""

if __name__ == '__main__':
    try:
        if '--selftest' in sys.argv:
            sys.exit(selftest())
        if '--why' in sys.argv:
            print(WHY)
            sys.exit(0)
        sys.exit(scan())
    except RuntimeError as e:
        print(f'🔴 工具壞了:{e}', file=sys.stderr)
        sys.exit(2)
    except Exception as e:  # noqa: BLE001
        # 🔴 codex F15:UnicodeDecodeError / IndexError 這類**沒被預期的**例外,
        #    Python 預設 exit 1 ⇒ 與「有 finding」混在同一個 rc 裡。一律轉 rc=2。
        print(f'🔴 工具壞了(非預期例外 {type(e).__name__}):{e}', file=sys.stderr)
        sys.exit(2)
