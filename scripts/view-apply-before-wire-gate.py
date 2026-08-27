#!/usr/bin/env python3
# view-apply-before-wire-gate.py — **它守 TARGETS 表, 不守 apply 這件事本身。**
# 表裡每一對 (view, 呼叫端識別字):「那支 view 還沒 apply, 而呼叫端已經掛上」⇒ 紅。
# 🔴 舊檔名 `apply-before-wire-gate.py` **比內容窄** —— 窄的名字讓人以為它守得比實際多
#    (memory `feedback_control-named-beyond-its-actual-power`)。2026-08-25 主視窗裁定改名。
#
# ══ 為什麼要有它(2026-08-25 線 4)══════════════════════════════════════════
# `scripts/deploy-order-gate.sh` 對這個形狀**完全看不到**, 而那是量到的不是猜的(`#915` 洞③):
#   掛線那一發的新增行裡**沒有 DB 物件名、也沒有 `.from(`** —— 它只是多一行
#   `enqueueOrderShippedEmails(...)` 去呼叫一支【既有的】use-case。
#   拋棄式 repo 構造(世界 E):pending view + 只新增那一行 ⇒ 那道閘 **GREEN**。
# 🔴 而失敗形狀是 **42P01**:正式站去 SELECT 一支資料庫裡不存在的 view。
#   ⇒ 開閘順序是硬的:**先確認 view 在庫裡, 再掛呼叫端。** 反過來 ⇒ 開閘當天直接炸。
#
# ══ 🔴 這道閘【不保證】什麼(先讀, 不要把它讀得比它大)═══════════════════════
#  ⓪ **它不是防【故意繞過】的安全邊界**(2026-08-25 codex R1 中風險, 接受並寫明)。
#     `git commit --no-verify` / 改 `core.hooksPath` / 把這支 .py 或那層薄殼改成永遠回 0
#     —— 每一條都關得掉它, 而**本機 hook 本來就擋不住有意繞過**。
#     🔴 要寫下來的理由不是它擋不住, 是**檔案裡那些「fail-closed」「擋下(不放行)」的字**
#        讀起來像一道關不掉的閘。真要防有意繞過 ⇒ 那是 CI / server-side 的事, 不是這裡。
#  ① 它讀的是 `supabase/APPLIED.tsv` —— 那是**repo 裡的帳**, 不是**正式庫裡的事實**。
#     兩者會漂(2026-08-24 型別檔那條線實錘)⇒ 不一致時, 它會很有信心地算錯。
#     🔴 **校準它需要一發對正式庫的查詢, 而那不是本閘做得到的事** —— 有 DB access 的人做得到。
#     ⚠️ **不要把這一條讀成「天花板」**(主視窗 2026-08-25 調整措辭):
#        「不可修」對【寫它的施工窗】為真, 對【這個 repo】為假。
#        📌 差別在於:**「天花板」會讓下一個人不去想;「需要另一種資源」會讓他知道有路。**
#  ② 它只看得到**本 repo 的靜態文字**。有人在 Vercel 環境變數裡打開一個旗標, 它看不到。
#  ③ 呼叫端偵測 = 完整識別字比對。**抓不到**(明列, 不假裝覆蓋):
#       · `import { enqueueOrderShippedEmails as go }` 之後只出現 `go(...)`  ← 改名進口
#         🔴 **這一條 2026-08-25 已構造驗過:偵測器確實漏掉它**(見 selftest `renamed_import`)
#       · 動態 import / 反射呼叫                                    ← **未構造**
#       · 呼叫端掛在 `packages/**` 而不是 `apps/**`                  ← **未構造**
#  ④ 它守的是 TARGETS 表裡列出的那幾對。表外的同型缺口它一個都看不到。
#
# ══ 🔴 為什麼版本號是【推出來的】不是打字打進去的 ═════════════════════════
# 若把 `20260822010000` 寫死, 那支 migration 被改名 / 合併 / 拆開的那天,
# 這支會算出「這個版本不在帳上 ⇒ 未 apply」——**方向剛好相反地仍然為真**,
# 所以**沒有人會發現它已經在看空氣**。⇒ 版本號一律從「哪一支 migration 建了這個 view」推。
# ⇒ 而推不出來(0 支, 或 2 支以上)⇒ `cannot_tell` ⇒ **紅**, 不是綠。
#   📌 母題:**「找不到」與「沒問題」在布林上都是 false。**
#
# ══ 🔴🔴 出生事故:第一版【該紅沒有紅】, 而 selftest 全綠 ══════════════════
# 2026-08-25 本檔第一版寫完:selftest 八格全過、正對照(`enqueueOrderCreatedEmails` ⇒ 1 處)
# 也是綠的。然後我餵它一發**真的 Q4** —— 在 `apps/` 底下放一支真的呼叫 `enqueueOrderShippedEmails`
# 的新檔 ⇒ **它仍然回 ok。**
#   成因量到:`git grep` **預設只搜【追蹤中】的檔**。那支新檔是 untracked ⇒ 對它隱形。
#     `git grep -l 'enqueueOrderShippedEmails' -- apps`             ⇒ 零命中
#     `git grep -l --untracked 'enqueueOrderShippedEmails' -- apps` ⇒ 抓到
# 🔴 **而掛線那一發最可能的形狀就是【一支新檔】** ⇒ 第一版對它要守的那件事**天生失明**。
#    ⚠️ **F14(code-reviewer R1 nit)更正上面這句因果**:量到的是 —— 兄弟符號
#       `enqueueOrderCreatedEmails` 掛在 `apps/storefront/src/app/api/cron/email-sweep/route.ts`,
#       那是一支**既有的已追蹤檔** ⇒ shipped 最可能的形狀是**同一支檔多一行**, 不是新檔。
#       行為上兩半現在都涵蓋了(`--cached` ∪ `--untracked`), 而**那句因果會帶壞後面的設計判斷**。
# 🔴 **selftest 全綠 + 正對照非零, 兩件都沒有揭露它** ——
#    正對照那個符號住在**已追蹤**的檔裡, 所以「尺是活的」這句話當時為真而**不涵蓋新檔**。
# 📌 **「該綠真的綠」與「該紅真的紅」是兩發, 而只有後者能抓到這一類。**
# 🔴🔴 **而正對照之所以沒揭露它, 是因為正對照【剛好落在尺看得見的那一側】**(主視窗 2026-08-25 補):
#    目標是【新檔】, 而正對照 `enqueueOrderCreatedEmails` 住在【已追蹤的舊檔】裡。
#    ⇒ **正對照要挑一個與目標【同樣形狀】的東西。** 目標是新檔 ⇒ 正對照就不能是舊檔。
#    ⇒ 本檔的 selftest 因此**另外**構造了一發真的新檔(見交件檔的兩個方向紀錄);
#      而 `find_callers` 的正對照仍是舊檔 —— **那一格只證明 git grep 活著, 不證明它看得到新檔。**
#
# ══ 怎麼跑 ════════════════════════════════════════════════════════════════
#   python3 scripts/view-apply-before-wire-gate.py              對真 repo 跑(pre-commit 走這條)
#   python3 scripts/view-apply-before-wire-gate.py --selftest   純述詞四象限 + cannot_tell 兩個方向
#   rc: 0 = 沒有這個風險
#       1 = **確證的**部署順序違規(未 apply 而呼叫端已掛)
#       2 = **證據不足**(帳本壞 / 推不出版本號 / 掃不動 / 正對照死了 / root 不對 / 未預期例外)
#   🔴 F4(code-reviewer R1 must-fix):上一版檔頭還停在舊的三態描述, 而碼已經改了 ——
#      **一支檔會對它自己說謊, 而讓它變假的是同一支檔後來的另一段。**
#   ⚠️ F5(code-reviewer R1 Important):**掛在 lint-staged 會把 rc=2 壓成 1**
#      (`lint-staged/bin/lint-staged.js` 固定 `process.exitCode = 1`)⇒ 三態當場消失。
#      ⇒ **若三態是承重的, 這支要直接掛在 `.husky/pre-commit` 裡配 `|| exit $?`**
#        (`scripts-whitelist-gate.sh` 就是這樣掛的)。**交件時已把這一格寫給主視窗。**
#
# ══ 🔴 退場條件(立法時就寫, 否則它永遠不會退場)═════════════════════════
# 當 view 已 apply 且呼叫端已掛(Q3), 這支對那一對就沒有判別力了。
# 退場**不是刪掉它**, 是讓那一對留在表裡當**常設斷言**:
#   「apply 狀態與呼叫端狀態必須同向」——**那句話在退場後仍然成立**
#   (有人把那支 migration 從 `APPLIED.tsv` 拿掉, 以後仍然該紅)。
import io, os, re, sys, subprocess

# 🔴 ROOT 從**本檔自己的位置**推(裝好之後 = repo 根), 不從「人在哪」推 ——
#    後者的坑寫在 CLAUDE.md 路由表(`where-is.sh` 在別的 repo 底下會安靜地跑去 pcm-website-v2 找)。
# ⚠️ `PCM_GATE_ROOT` **只給測試用**:本檔還沒被放進 `scripts/` 之前(施工窗寫在 scratchpad),
#    路徑推法會指到錯的地方 ⇒ 沒有這個開關就**驗不了它**。裝好之後不要設它。
def _resolve_root():
    # 🔴 codex R1 must-fix:`PCM_GATE_ROOT` 原本【無條件】生效 ⇒ 有人可以把它指向一份
    #    自己準備的假 repo, 讓這道閘印綠。⇒ 只在 `--selftest` 時吃它, 且要通過健全性檢查。
    env = os.environ.get('PCM_GATE_ROOT')
    if env and '--selftest' in sys.argv:
        cand = os.path.abspath(env)
    else:
        cand = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for must in ('package.json', os.path.join('supabase', 'migrations')):
        if not os.path.exists(os.path.join(cand, must)):
            # 🔴 F4:`SystemExit('字串')` 的 exit code 是 **1** ——
            #    而 1 在本閘是「確證的部署順序違規」⇒ 訊息會叫人去改部署順序, 而真正的事是 root 不對。
            print('🔴 %s:root 看起來不是本 repo(缺 %s)⇒ 拒絕在這裡判斷。' % (GATE_NAME, must))
            raise SystemExit(2)
    return cand


# 🔴🔴 **這一段是事故的修補, 不是防禦性想像。**(2026-08-25 主視窗在真樹上踩到)
#    本檔的 `--selftest` 會 `git init` / `git add` 拋棄式 repo。它掛在 lint-staged 上
#    ⇒ 每次 pre-commit 都會跑。而 pre-commit 執行時 git **匯出 `GIT_INDEX_FILE`**
#    ⇒ 子行程的 `git add` / `git commit` **寫進真 repo**, 而 cwd 是空的暫存目錄。
#    實際後果(量到的):`dev` 被指到 fixture 的 `base` commit、`git ls-files` 從 3237 ⇒ 4。
#    📌 **兩個世界印同一句話**:有沒有污染真 repo, selftest 的輸出一模一樣。
#    (同款第二支;第一支 `scripts/board-state-consistency.py` 同日已修, 修法相同。)
#
# 🔴🔴 **而【真跑】那條路刻意【不】隔離 —— 這不是漏掉, 是量過的。**
#    拋棄式 repo 掛 pre-commit hook 印 env, 兩個世界:
#      `git commit -F msg -- a.txt b.txt`(帶 pathspec, 本 repo 的慣例)
#          ⇒ GIT_INDEX_FILE=.git/next-index-94327.lock(**臨時 index**)
#          ⇒ `git show :a.txt` 回 **v1** = 這一顆真的會提交的內容
#      `git commit -F msg`(不帶 pathspec)
#          ⇒ GIT_INDEX_FILE=.git/index ⇒ `git show :a.txt` 回 v2
#    ⇒ **把 GIT_INDEX_FILE 拿掉, 帶 pathspec 那條路就會讀到【不是這顆 commit】的 index。**
#      那正是本閘上一輪 codex must-fix 修掉的那個病, 換個方向再犯一次。
#    ⇒ 規則:**fixture 的 git 一律 GIT-free;真讀一律繼承。** 由 `GIT_ENV` 一個開關決定。
_GIT_FREE_ENV = dict((k, v) for k, v in os.environ.items() if not k.startswith('GIT_'))
GIT_ENV = None          # None = 繼承(真跑);`--selftest` 會把它換成 _GIT_FREE_ENV

GATE_NAME = 'view-apply-before-wire-gate'
ROOT = _resolve_root()
LEDGER = os.path.join(ROOT, 'supabase', 'APPLIED.tsv')
MIGDIR = os.path.join(ROOT, 'supabase', 'migrations')
# 🔴 index 讀取要的是【相對 repo root 的路徑】, 而上面兩個是絕對路徑。
#    這兩個是常數, `--selftest` 換 ROOT 時**不需要**跟著換(git 指令帶 `cwd=ROOT`)。
#    ⚠️ 而這正是它們危險的地方:改了 LEDGER/MIGDIR 的絕對路徑而忘了這兩個, 兩邊會指到不同的檔,
#       **而畫面上不會有任何訊號**。動其中一個就四個一起看。
LEDGER_REL = 'supabase/APPLIED.tsv'
MIGDIR_REL = 'supabase/migrations'

# ── TARGETS:(view 名, 呼叫端識別字, 正對照識別字)
#    正對照識別字 = 一個【一定找得到呼叫端】的兄弟符號。偵測器對它回空 ⇒ 尺死了 ⇒ rc=2。
#    🔴 沒有這一格, 「呼叫端是空的」與「偵測器壞了」印同一個結果。
TARGETS = [
    ('pcm_shipped_email_pending', 'enqueueOrderShippedEmails', 'enqueueOrderCreatedEmails'),
]

# 🔴 呼叫端不算數的地方。**F8(code-reviewer R1 nit)更正**:
#    上一版這裡寫得像是 `EXCLUDE_RE` 在擋 `packages/use-cases/src/index.ts` 的 re-export ——
#    **不是。`EXCLUDE_RE` 只認測試檔。真正擋掉那個 re-export 的是下面的 `CALLER_ROOTS = ['apps']`。**
#    ⇒ 🔴 有人照天花板③「呼叫端掛在 packages/** ← 未構造」去把 `'packages'` 加進來,
#      **當場就會吃到那個 re-export 的紅**, 而上一版的註解會告訴他「已經被排除了」。
#    (而那個 re-export 一定要排除的理由不變:不排除的話這道閘**裝上去當天就紅**,
#     而「一裝就紅」與「抓到真東西」在 CI 上長得一樣。)
CALLER_ROOTS = ['apps']
EXCLUDE_RE = re.compile(r'\.(test|spec)\.[jt]sx?$|__tests__/')

VERDICT_OK, VERDICT_BLOCKED, VERDICT_CANNOT = 'ok', 'blocked', 'cannot_tell'


def verdict(applied_versions, creating_versions, callers, dropped_after=False):
    """純述詞:零 I/O。

    applied_versions  帳本上的版本號集合(None = 帳本讀不到 / 壞掉)
    creating_versions 建這個 view 的 migration 版本號, 由早到晚(None = 推不出來)
    callers           掛上呼叫端的檔案清單
    dropped_after     最後一支 CREATE 之後還有一支 DROP(見 F7)

    🔴 **F6(code-reviewer R1 Important)**:`callers` 是空的時候, 42P01 構造不出來 ——
       apply 狀態怎樣都不改變答案。原本先判 `cannot_tell` 再看 callers
       ⇒ 帳本有一行縮排的 `  #` 註解, 就會擋掉**整棵樹的每一顆 commit**, 而那全是誤擋。
       ⇒ **先看 callers。沒有呼叫端 = 沒有這個風險, 回 ok。**
    🔴 **F1(code-reviewer R1 must-fix)**:上一版的 docstring 說「看最早那一支」而**碼沒改**
       —— 仍然要求剛好 1 支 ⇒ 它自己命名的「可用性恆假路」原封不動還在。
       ⇒ 這一版**真的**取最早那一支。
    """
    if not callers:
        return VERDICT_OK, '呼叫端=0 處 ⇒ 這個風險構造不出來(apply 狀態不影響)'
    if applied_versions is None:
        return VERDICT_CANNOT, '有呼叫端, 而帳本讀不到或格式壞掉 ⇒ 判不了'
    if not creating_versions:
        return VERDICT_CANNOT, '有呼叫端, 而推不出「哪支 migration 建了它」⇒ 判不了'
    first = creating_versions[0]          # 🔴 F1:view 從最早那一支起存在
    if dropped_after:
        return VERDICT_CANNOT, '最後一支 CREATE 之後還有 DROP ⇒ 這支 view 現在在不在, 靜態看不出來'
    if first not in applied_versions:
        return VERDICT_BLOCKED, '未 apply(%s 不在帳本)而呼叫端已掛:%s' % (first, ', '.join(callers))
    return VERDICT_OK, 'apply=True(%s)/ 呼叫端=%d 處' % (first, len(callers))


def _index_text(rel):
    """讀 **index(staged)** 裡那份檔的內容。不在 index ⇒ None。

    🔴 為什麼不讀工作樹(2026-08-25 codex R1 must-fix, 已構造並量到):
       pre-commit 要判的是**這一顆 commit 會帶進去什麼**, 而工作樹可以與 index 不同。
       實測兩個世界, `git write-tree` 兩邊都是 `950d08ab53dd96f0e2…`(**提交內容完全相同**):
         P0 工作樹帳本沒有那個版本 ⇒ 🔴 blocked rc=1
         P1 只把版本寫進【工作樹】帳本、不 stage ⇒ ✅ ok rc=0   ← 同一顆 commit, 相反的判決
       ⇒ 一個**不會被提交的編輯**可以讓這道閘轉綠, 而且不用刪任何檔、畫面上零訊號。
    📌 三個輸入源現在都指向【擋】的那一邊:
       呼叫端 = `--cached` ∪ `--untracked`(多算 ⇒ 多擋)
       帳本   = 只讀 index(工作樹說 apply 了不算數)
       migration = 只讀 index(沒 stage ⇒ 推不出版本 ⇒ cannot_tell ⇒ 擋)
    """
    try:
        r = subprocess.run(['git', 'show', ':' + rel], cwd=ROOT,
                           capture_output=True, env=GIT_ENV)
    except OSError:
        return None
    if r.returncode != 0:
        return None
    try:
        return r.stdout.decode('utf-8')
    except UnicodeDecodeError:
        return None


def _index_listing(reldir):
    """index 裡 `reldir` 底下的檔名(只第一層)。git 壞掉 ⇒ None(不是空清單)。

    🔴 「查無」與「量具壞了」不得回同一個值 —— 空清單會被讀成「這個目錄沒有 migration」。
    """
    try:
        r = subprocess.run(['git', 'ls-files', '--cached', '-z', '--', reldir],
                           cwd=ROOT, capture_output=True, env=GIT_ENV)
    except OSError:
        return None
    if r.returncode != 0:
        return None
    out = []
    for raw in r.stdout.split(b'\0'):
        if not raw:
            continue
        try:
            rel = raw.decode('utf-8')
        except UnicodeDecodeError:
            return None
        rest = rel[len(reldir):].lstrip('/')
        if '/' in rest:                  # 子目錄 ⇒ 本閘只看第一層(與舊行為一致)
            continue
        out.append(rest)
    return sorted(out)


def _index_texts(rels):
    """一發 `git cat-file --batch` 把多個 index blob 讀回來。`{rel: text}`;整體失敗 ⇒ None。

    🔴 為什麼不是 N 發 `git show`(2026-08-25 量到, 不是設計偏好):
       本 repo `git ls-files --cached -- supabase/migrations` ⇒ **215 支**,
       而單發 `git show` 實測 **0.04 秒** ⇒ 215 × 0.04 ≈ **8.6 秒**, 掛在每一顆 commit 上。
       閘慢到讓人想繞過, 它就等於不存在。
    ⚠️ 讀不出來的那幾支**不放進回傳的 dict**(不是放空字串)——
       「這支是空的」與「這支讀不到」不得印同一個值;呼叫端看不到 key 就走 cannot_tell。
    """
    if not rels:
        return {}
    stdin = ''.join(':' + r + '\n' for r in rels).encode('utf-8')
    try:
        r = subprocess.run(['git', 'cat-file', '--batch'], cwd=ROOT,
                           input=stdin, capture_output=True, env=GIT_ENV)
    except OSError:
        return None
    if r.returncode != 0:
        return None
    out, buf, i = {}, r.stdout, 0
    for rel in rels:
        nl = buf.find(b'\n', i)
        if nl < 0:
            return None                  # 輸出比輸入短 ⇒ 對不上, 不猜
        head = buf[i:nl].decode('utf-8', 'replace').split()
        i = nl + 1
        if len(head) != 3:               # `<sha> missing` / `<sha> ambiguous` 等
            continue
        try:
            size = int(head[2])
        except ValueError:
            return None
        blob = buf[i:i + size]
        i += size + 1                    # 內容後面固定跟一個 \n
        try:
            out[rel] = blob.decode('utf-8')
        except UnicodeDecodeError:
            continue                     # 非 UTF-8 ⇒ 當成讀不到, 不塞垃圾
    return out


def read_applied():
    # 🔴 2026-08-25 codex R1 must-fix:改讀 **index**, 不讀工作樹(理由見 `_index_text`)。
    #    讀不到(不在 index / 非 UTF-8 / git 壞掉)⇒ None ⇒ cannot_tell, 與舊行為同一格。
    text = _index_text(LEDGER_REL)
    if text is None:
        return None
    rows = text.splitlines()
    out = set()
    for line in rows:
        # 🔴 F6:原本用 `line.startswith('#')` ⇒ **一行縮排的 `  #` 註解**會被當成資料列
        #    ⇒ 版本號檢查不過 ⇒ **整張 288 行的手維護帳本作廢**。今天那些註解剛好都在第 0 欄
        #    ⇒ 它是**潛伏**不是現行。⇒ 改成先 strip 再判。
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        cells = line.split('\t')
        if len(cells) != 4:          # 欄數壞掉 ⇒ 整張帳本不採信(fail-closed)
            return None
        ver = cells[0].strip()
        # 🔴 codex R1 must-fix:原本只數欄數 ⇒ 一列 `\t\t\t` 會產生 {''} 而被當成【有效帳本】。
        #    ⚠️ **F9(code-reviewer R1 nit):我原本舉的例子站不住** —— 我寫「一列 `\t\t\t`」,
        #       而 `'\t\t\t'.strip() == ''` ⇒ 上面那個空行檢查早就跳過它了。**那個成因不存在。**
        #    真的會過欄數檢查而版本號是垃圾的形狀是 `a\tb\tc\td` 這種 ⇒ fixture 有一格專門餵它。
        #    版本號的形狀是 14 位數字(migration 檔名前綴)⇒ 不是這個形狀 = 帳本壞了, 不是空。
        # 🔴 F10:`'１２３４５６７８９０１２３４'.isdigit()` 是 **True**(全形)⇒ 加 isascii。
        if not (ver.isascii() and ver.isdigit() and len(ver) == 14):
            return None
        out.add(ver)
    return out or None


def strip_sql_comments(body):
    """剝掉 `--` 行註解與 /* */ 區塊註解。

    🔴 codex R1 must-fix:原本直接對整支 .sql 跑正規式 ⇒ **註解掉的 `CREATE VIEW` 也會命中**
       ⇒ 一支根本沒建那個 view 的 migration 被當成 creator。
       (同款坑 `scripts/deploy-order-gate.sh` 2026-08-24 已踩過一次, 它的修法就是剝註解。)
    ⚠️ **仍然抓不到 / 會弄錯的(F12 code-reviewer R1 nit 補全 —— 上一版只寫了第一條)**:
      ① 字串字面裡的 `CREATE VIEW`(例如 `EXECUTE 'CREATE VIEW …'`)⇒ 抓不到
      ② **反方向**:字串字面裡的 `--` 或 `/*` 會被當成註解 ⇒ **吃掉它後面真的 DDL**
      ③ Postgres 的區塊註解**可以巢狀**, 而這裡停在第一個 `*/`
      🔴 ②③ 都**往紅那邊倒**(該看到的 CREATE 被吃掉 ⇒ 少一個 creator ⇒ cannot_tell),
         **不製造假綠**。要真的解掉它們得 parse SQL。**未處理, 明寫在這裡。**
    """
    out, i, n = [], 0, len(body)
    while i < n:
        if body.startswith('--', i):
            j = body.find('\n', i)
            i = n if j < 0 else j
        elif body.startswith('/*', i):
            j = body.find('*/', i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(body[i])
            i += 1
    return ''.join(out)


VER_RE = re.compile(r'^(\d{14})_')


def _migration_files():
    """`supabase/migrations/` 底下**檔名合法**的 .sql,依版本號排序。

    🔴 F13(code-reviewer R1 nit)兩條:
      ① `os.listdir` **不遞迴** ⇒ 子目錄裡的 migration 隱形。這裡明說:**本閘只看第一層。**
      ② 上一版用 `name.split('_')[0]` ⇒ 一支叫 `v.sql` 的檔會被推成版本號 `v.sql`,
         然後印出「未 apply(v.sql 不在帳本)」—— **把一個垃圾值當事實端出來**。
         ⇒ 改成正規式:檔名前綴必須是 14 位數字 + 底線, 否則不算 migration。
    """
    names = _index_listing(MIGDIR_REL)
    if names is None:
        return None                      # git 壞掉 ⇒ 不是「沒有 migration」
    out = []
    for name in names:
        if not name.endswith('.sql'):
            continue
        m = VER_RE.match(name)
        if m:
            out.append((m.group(1), name))
    return out


def view_history(view):
    """回傳 (建它的版本號清單, 最後一支 CREATE 之後有沒有 DROP)。

    版本號推不出來(同一個版本號兩支檔都建它)⇒ 回 (None, False)。

    🔴 F7(code-reviewer R1 Important):上一版**完全沒看 DROP** ——
       實測:creator 之後放一支 `DROP VIEW public.pcm_shipped_email_pending`、呼叫端已掛
       ⇒ 它印 `✅ ok / rc=0`。版本號還在帳上, 而**庫裡那支 view 已經沒了** ⇒ 正是它要防的 42P01。
       ⇒ 現在:最後一支 CREATE 之後還有 DROP ⇒ `cannot_tell`(靜態看不出它現在在不在)。
    """
    cre = re.compile(
        r'CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:MATERIALIZED\s+)?VIEW\s+'
        r'(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?%s"?\b' % re.escape(view), re.I)
    drp = re.compile(
        r'DROP\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?%s"?\b'
        % re.escape(view), re.I)
    creates, drops = [], []
    migs = _migration_files()
    if migs is None:
        return None, False               # 列不出 index ⇒ 推不出版本號 ⇒ cannot_tell
    bodies = _index_texts([MIGDIR_REL + '/' + n for _, n in migs])
    if bodies is None:
        return None, False               # 批次讀取整個壞掉 ⇒ cannot_tell
    for ver, name in migs:
        raw = bodies.get(MIGDIR_REL + '/' + name)
        if raw is None:
            return None, False           # 列得到卻讀不到 ⇒ 量具不一致, 不猜
        body = strip_sql_comments(raw)
        if cre.search(body):
            creates.append((ver, name))
        if drp.search(body):
            drops.append(ver)
    by_ver = {}
    for ver, name in creates:
        by_ver.setdefault(ver, []).append(name)
    for ver, names in by_ver.items():
        if len(names) > 1:
            return None, False          # 同版本號兩支檔都建它 ⇒ 推不出版本號
    vers = sorted(by_ver)
    if not vers:
        return [], False
    return vers, any(d > vers[-1] for d in drops)


def creating_versions(view):
    """相容包裝:只要版本號清單(`None` = 推不出來)。"""
    vers, _ = view_history(view)
    return vers


def find_callers(symbol):
    """回傳掛上呼叫端的檔案清單;**掃不動就回 None(不是空清單)**。

    🔴 codex R1 must-fix 三條:
      ① 原本完全不看 `git grep` 的 return code ⇒ **rc=1(零命中)與 rc=128(git/pathspec 壞掉)
         被讀成同一件事:空清單** ⇒ 「掃不動」會變成「沒有人掛」⇒ 放行。
      ② 原本 OSError 回 `None`, 而呼叫端直接 `len(callers)` ⇒ **TypeError 崩潰**, 不是設計好的狀態。
      ③ 原本只掃工作樹(`--untracked`)。pre-commit 真正要判的是**這一顆 commit 會帶進去什麼**
         ⇒ 改成 **staged(`--cached`)∪ 工作樹未追蹤** 的聯集。**聯集 = 往擋的那邊倒。**
         ⚠️ 仍抓不到:已 staged 但工作樹又刪掉的檔 —— `--cached` 涵蓋它 ⇒ 這一格由 ① 那半解掉。
    🔴 而 `out.split()` 改成逐行解析(codex nit):含空白的檔名會被拆碎。
    """
    found = set()
    for mode in (['--cached'], ['--untracked']):
        try:
            r = subprocess.run(
                ['git', 'grep', '-lE'] + mode +
                [r'(^|[^A-Za-z0-9_])%s([^A-Za-z0-9_]|$)' % symbol, '--'] + CALLER_ROOTS,
                cwd=ROOT, text=True, capture_output=True, env=GIT_ENV)
        except OSError:
            return None
        if r.returncode not in (0, 1):      # 0=有命中 1=零命中 其餘=git 壞了
            return None
        for line in r.stdout.splitlines():
            f = line.strip()
            if f and not EXCLUDE_RE.search(f):
                found.add(f)
    # 🔴 F11:上一版這裡是 `return sorted(found) if saw_any_ok else None` —— 而每條失敗路徑都提前
    #    return 了 ⇒ 走到這裡時它必為 True ⇒ **那是一道不可達的守門, 比沒有更糟**(它讓人以為有守)。
    return sorted(found)


def real_run():
    """rc 三態(codex R1 must-fix:原本把 cannot_tell 折進 1, 與確證的危險分不開)。

    0 = 表裡每一對都 ok
    1 = **確證的**部署順序違規(未 apply 而呼叫端已掛)
    2 = **證據不足**:帳本壞掉 / 推不出版本號 / git 掃不動 / 正對照死了
        ⇒ 一樣不放行, 而它要求的下一步不同(去修證據, 不是去改部署順序)。
    """
    # 🔴 F15(code-reviewer R1 nit):**輸出從不印 ROOT** ⇒ 殘留一個 `export PCM_GATE_ROOT`
    #    就讓綁定層去量別棵樹, 照樣 rc=0, 而**畫面上看不出量的是哪一棵**。⇒ 兩種模式都印。
    print('   ROOT = %s' % ROOT)
    applied = read_applied()
    worst = 0
    for view, symbol, control in TARGETS:
        ctrl = find_callers(control)
        if ctrl is None:
            print('🔴 %s:掃描本身失敗(git grep 非零 rc 或跑不起來)⇒ 不報結論。' % GATE_NAME)
            return 2
        if not ctrl:                                   # 🔴 正對照:尺死了就不要報結果
            print('🔴 %s:正對照識別字 %s 在 %s 底下回【空】—— 偵測器不可信, 不報結論。'
                  % (GATE_NAME, control, '/'.join(CALLER_ROOTS)))
            return 2
        callers = find_callers(symbol)
        if callers is None:
            # 🔴 非對稱故障:正對照那一發成功、目標那一發失敗 ⇒ 原本會變成 callers=[] ⇒ 放行。
            print('🔴 %s:目標 %s 的掃描失敗(而正對照成功)⇒ 不報結論。' % (GATE_NAME, symbol))
            return 2
        cv, dropped = view_history(view)
        if cv is None and callers:
            v, why = VERDICT_CANNOT, '同一個版本號有兩支 migration 建它 ⇒ 推不出版本號'
        else:
            v, why = verdict(applied, cv or [], callers, dropped)
        mark = {'ok': '✅', 'blocked': '🔴', 'cannot_tell': '🔴'}[v]
        print('%s %-30s %-12s %s' % (mark, view, v, why))
        print('     正對照 %s ⇒ %d 處 ⇒ 偵測器是活的' % (control, len(ctrl)))
        if v == VERDICT_BLOCKED:
            worst = max(worst, 1)
        elif v == VERDICT_CANNOT:
            worst = max(worst, 2)
    if worst == 1:
        print('')
        print('🔴 開閘順序是硬的:**先讓那支 migration 進正式庫並記進 supabase/APPLIED.tsv, 再掛呼叫端。**')
        print('   反過來 ⇒ 正式站 SELECT 一支不存在的 view ⇒ 42P01。')
        print('   確認過安全就 git commit --no-verify, 並在 commit body 寫明為什麼。')
    elif worst == 2:
        print('')
        print('🔴 證據不足(不是「有危險」也不是「沒事」)⇒ 先把上面那一行講的東西修好再判。')
    return worst


# ══ 🔴🔴 fixture 世界:讓【綁定層】的每一條修法都有一格會死 ═══════════════
# F2(code-reviewer R1 must-fix)量到:上一版的 selftest **9 發突變只抓到 1 發** ——
# 純述詞那格活著, 而 codex R1 的八條修法**一條都沒有留下會失敗的那一格**。
#   ⇒ 「檔頭 §出生事故 講的那個 bug 可以原樣復發, 而 selftest 全綠。」
# 🔴 成因:上一版的綁定層只對**真 repo 現況**跑一發, 而現況是「沒有呼叫端」⇒ 怎麼改都綠。
#   ⇒ 這一段自己造一個**拋棄式 git repo**, 在裡面把每條修法各推到會死的那個世界。
#   ⚠️ 需要 `git`。跑不起來 ⇒ 明說 SKIP 並讓 selftest **紅**(不是綠), 因為那表示沒驗到。
import shutil, tempfile


def _fixture_run(world):
    """在一個拋棄式 repo 裡把模組的三個路徑常數指過去, 跑 real_run 拿 rc。"""
    global ROOT, LEDGER, MIGDIR, GIT_ENV
    d = tempfile.mkdtemp(prefix='vabwg-')
    keep = (ROOT, LEDGER, MIGDIR)
    try:
        os.makedirs(os.path.join(d, 'supabase', 'migrations'))
        os.makedirs(os.path.join(d, 'apps', 'x'))
        io.open(os.path.join(d, 'package.json'), 'w').write('{}\n')
        GIT_ENV = _GIT_FREE_ENV      # 🔴 fixture 期間【連真讀那幾支也要】GIT-free,
                                     #    否則 cwd 是 fixture 而 index 是真 repo 的。
        ROOT, LEDGER = d, os.path.join(d, 'supabase', 'APPLIED.tsv')
        MIGDIR = os.path.join(d, 'supabase', 'migrations')
        for cmd in (['git', 'init', '-q', '.'],
                    ['git', 'config', 'user.email', 'p@p.t'],
                    ['git', 'config', 'user.name', 'p']):
            subprocess.run(cmd, cwd=d, capture_output=True, env=_GIT_FREE_ENV)
        world(d)
        buf = []
        _p = print
        try:
            import builtins
            builtins.print = lambda *a, **k: buf.append(' '.join(str(x) for x in a))
            rc = real_run()
        finally:
            builtins.print = _p
        # 🔴 只比 rc 不夠:N5 那一格原版與突變版**都回 2**, 而理由完全不同
        #    (原版=掃描失敗 / 突變版=正對照回空)⇒ 那一格對 N5 零判別力。
        #    ⇒ 連訊息一起回, 由呼叫端比【理由】。
        return rc, '\n'.join(buf)
    finally:
        ROOT, LEDGER, MIGDIR = keep
        shutil.rmtree(d, ignore_errors=True)


def _w(d, *rel):
    return os.path.join(d, *rel)


def _git(d, *args):
    # 🔴 fixture 的 git **一律 GIT-free** —— 見檔頭 `_GIT_FREE_ENV` 那段事故。
    return subprocess.run(['git'] + list(args), cwd=d, capture_output=True,
                          env=_GIT_FREE_ENV)


def _env_isolation_witness():
    """🔴 證人格:fixture 的 git **不可以**被外部 `GIT_DIR` / `GIT_INDEX_FILE` 拉走。

    兩個方向都驗:誘餌 repo 必須**完全沒動**, 而 fixture repo 必須**真的動了**。
    📌 這一格**自己製造那個環境**, 所以【有沒有帶 GIT_DIR 的兩種跑法下它都會紅】——
       不必等到有人在 pre-commit 底下跑才發現。事故當天缺的正是這一格。
    """
    import tempfile
    decoy = tempfile.mkdtemp()
    fixture = tempfile.mkdtemp()
    for _d in (decoy, fixture):
        subprocess.run(['git', 'init', '-q', '.'], cwd=_d,
                       capture_output=True, env=_GIT_FREE_ENV)
    io.open(os.path.join(fixture, 'f.txt'), 'w').write('x\n')
    _old = dict(os.environ)
    os.environ['GIT_DIR'] = os.path.join(decoy, '.git')
    os.environ['GIT_INDEX_FILE'] = os.path.join(decoy, '.git', 'index')
    try:
        _git(fixture, 'add', '-A')
    finally:
        os.environ.clear()
        os.environ.update(_old)

    def _staged(_d):
        r = subprocess.run(['git', 'ls-files', '--cached'], cwd=_d,
                           capture_output=True, text=True, env=_GIT_FREE_ENV)
        return [x for x in r.stdout.split('\n') if x]

    return _staged(decoy), _staged(fixture)

def _real_read_inherits_index_witness():
    """🔴 證人格:**真跑那條路必須繼承 `GIT_INDEX_FILE`。**

    這是上一格 (`_env_isolation_witness`) 的**鏡像**, 而它守的是相反的方向:
      · 上一格:fixture 的 git **被** env 拉走 ⇒ 汙染真 repo
      · 這一格:真讀 **沒有跟著** env ⇒ 讀到不是這一顆 commit 的 index

    🔴 為什麼一定要有它:本 repo 的慣例是 `git commit -F <msg> -- <pathspec>`,
       而帶 pathspec 時 git 給 hook 的是一份**臨時 index**。真讀若忽略它,
       讀到的就是 `.git/index` —— 在這個 repo 裡**那不是邊角情況, 那是每一顆 commit 的常態**。
    📌 兩條路的規則相反而住在同一支檔 ⇒ **這支檔最容易被「統一一下」改壞**,
       而「統一」之後 fixture 那一格仍然是綠的。**沒有這一格, 那個方向零訊號。**

    構造:`.git/index` 的帳本【有】版本(真跑會說 ok);臨時 index 的帳本【沒有】(該擋)。
    ⇒ 繼承 ⇒ rc=1 ✅ / 不繼承 ⇒ rc=0 🔴
    """
    import tempfile
    d = tempfile.mkdtemp()
    for sub in ('scripts', os.path.join('supabase', 'migrations'), os.path.join('apps', 'x')):
        os.makedirs(os.path.join(d, sub), exist_ok=True)
    io.open(os.path.join(d, 'package.json'), 'w').write('{}\n')
    for cmd in (['git', 'init', '-q', '.'],
                ['git', 'config', 'user.email', 'p@p.t'],
                ['git', 'config', 'user.name', 'p']):
        subprocess.run(cmd, cwd=d, capture_output=True, env=_GIT_FREE_ENV)
    _base(d, '20260822010000')                    # 帳本有版本, 已 commit
    io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
        'export const w = () => enqueueOrderShippedEmails();\n')
    _git(d, 'add', 'apps/x/wire.ts')              # 呼叫端進 .git/index
    shutil.copy(os.path.abspath(__file__), os.path.join(d, 'scripts', os.path.basename(__file__)))

    tmpidx = os.path.join(d, '.git', 'tmp-index')
    env = dict(_GIT_FREE_ENV)
    env['GIT_INDEX_FILE'] = tmpidx
    subprocess.run(['git', 'read-tree', 'HEAD'], cwd=d, env=env, capture_output=True)
    io.open(os.path.join(d, 'supabase', 'APPLIED.tsv'), 'w', encoding='utf-8').write(
        '# version\tsha\tdate\twho\n20260101000000\tx\t2026-01-01\tme\n')
    for a in (['git', 'add', 'supabase/APPLIED.tsv'], ['git', 'add', 'apps/x/wire.ts']):
        subprocess.run(a, cwd=d, env=env, capture_output=True)
    # 把工作樹的帳本改回【有版本】⇒ 這樣「讀工作樹」也會回 0
    #    ⇒ 這一格同時守著「別退回去讀工作樹」, 而不只是守 index 來源
    io.open(os.path.join(d, 'supabase', 'APPLIED.tsv'), 'w', encoding='utf-8').write(
        '# version\tsha\tdate\twho\n20260822010000\ty\t2026-08-22\tsean\n')

    r = subprocess.run(
        [sys.executable, os.path.join(d, 'scripts', os.path.basename(__file__))],
        cwd=d, env=env, capture_output=True, text=True)
    return r.returncode


def _base(d, applied_ver='20260101000000'):
    """基底:一支建 view 的 migration(版本 20260822010000)+ 一個正對照呼叫端。"""
    io.open(_w(d, 'supabase', 'migrations', '20260822010000_v.sql'), 'w').write(
        'CREATE VIEW public.pcm_shipped_email_pending AS SELECT 1;\n')
    io.open(_w(d, 'apps', 'x', 'ctrl.ts'), 'w').write(
        'export const q = () => enqueueOrderCreatedEmails();\n')
    io.open(_w(d, 'supabase', 'APPLIED.tsv'), 'w').write(
        '# version\tsha\tdate\twho\n%s\tx\t2026-01-01\tme\n' % applied_ver)
    _git(d, 'add', '-A'); _git(d, 'commit', '-qm', 'base')


# 🔴 這幾格光看 rc 分不出「對的理由」與「另一個理由」⇒ 連訊息一起比。
NEED_PHRASE = {
    'git 壞掉(.git 被刪)': '掃描本身失敗',
    '帳本四欄齊全而版本號是垃圾': '帳本讀不到或格式壞掉',
    '帳本欄數壞掉': '帳本讀不到或格式壞掉',
    '帳本只有註解': '帳本讀不到或格式壞掉',
    'CREATE 之後有 DROP': 'DROP',
    '建 view 的 migration 只在工作樹': '推不出',
}


def fixture_worlds():
    """每一格都對應【一條修法】。改壞那條修法 ⇒ 那一格必須變色。"""
    def w_ok(d):
        _base(d, '20260822010000')

    def w_untracked_only(d):                     # 殺 N1(拿掉 --untracked)
        _base(d)
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')

    def w_cached_only(d):                        # 殺 N2(拿掉 --cached)
        _base(d)
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'apps/x/wire.ts')
        os.remove(_w(d, 'apps', 'x', 'wire.ts'))  # 進了 index, 工作樹沒有

    def w_commented_create(d):                   # 殺 N3(拿掉剝註解)
        _base(d)
        io.open(_w(d, 'supabase', 'migrations', '20260101000000_fake.sql'), 'w').write(
            '-- CREATE VIEW public.pcm_shipped_email_pending AS SELECT 1;\n')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'supabase')   # 🔴 本閘判的是 index ⇒ 這一格的突變也必須進 index

    def w_git_broken(d):                         # 殺 N5(拿掉 git rc 檢查)
        _base(d)
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        shutil.rmtree(_w(d, '.git'), ignore_errors=True)

    def w_empty_ledger(d):                       # 殺 N7(`or None` 拿掉)
        _base(d)
        io.open(_w(d, 'supabase', 'APPLIED.tsv'), 'w').write('# 只有註解\n')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'supabase')   # 🔴 本閘判的是 index ⇒ 這一格的突變也必須進 index

    def w_bad_cols(d):                           # 殺 N6(欄數檢查拿掉)
        _base(d)
        io.open(_w(d, 'supabase', 'APPLIED.tsv'), 'w').write(
            '# h\n20260822010000\tx\t2026-01-01\n')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'supabase')   # 🔴 本閘判的是 index ⇒ 這一格的突變也必須進 index

    def w_dropped(d):                            # 殺 F7(DROP 偵測拿掉)
        _base(d, '20260822010000')
        io.open(_w(d, 'supabase', 'migrations', '20260823000000_drop.sql'), 'w').write(
            'DROP VIEW public.pcm_shipped_email_pending;\n')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'supabase')   # 🔴 本閘判的是 index ⇒ 這一格的突變也必須進 index

    def w_indent_comment(d):                     # 殺 F6(縮排註解那條)
        _base(d, '20260822010000')
        io.open(_w(d, 'supabase', 'APPLIED.tsv'), 'w').write(
            '# h\n  # 縮排的註解\n20260822010000\tx\t2026-01-01\tme\n')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'supabase')   # 🔴 本閘判的是 index ⇒ 這一格的突變也必須進 index

    def w_junk_version(d):                       # 殺 N4(拿掉 14 位數檢查)
        _base(d)
        io.open(_w(d, 'supabase', 'APPLIED.tsv'), 'w').write(
            '# h\njunk\tx\t2026-01-01\tme\n')          # 四欄齊全, 而版本號是垃圾
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'supabase')   # 🔴 本閘判的是 index ⇒ 這一格的突變也必須進 index

    def w_worktree_only_ledger(d):               # 殺 N8(帳本改讀工作樹)
        """🔴 2026-08-25 codex R1 must-fix 的守門格。

        帳本的 apply 紀錄**只寫在工作樹、沒有 stage** ⇒ 這一顆 commit 帶進去的帳本仍然沒有它。
        修好前實測:`git write-tree` 與「兩側都沒有」那個世界**同一個 hash**
        (`950d08ab53dd96f0e2…`)⇒ **提交內容完全相同, 而判決相反**(rc=0 vs rc=1)。
        ⇒ 一個不會被提交的編輯可以讓這道閘轉綠, 不用刪任何檔, 畫面上零訊號。
        """
        _base(d)
        io.open(_w(d, 'supabase', 'APPLIED.tsv'), 'w').write(
            '# h\n20260101000000\tx\t2026-01-01\tme\n20260822010000\ty\t2026-08-22\tsean\n')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'apps/x/wire.ts')         # 🔴 帳本【故意不 stage】

    def w_worktree_only_migration(d):            # 殺 N9(migration 改讀工作樹)
        """建 view 的 migration 只在工作樹(從 index 拿掉)⇒ 推不出版本號 ⇒ cannot_tell。

        🔴 這一格與上一格的 rc 不同(2 vs 1)才有判別力:
           讀工作樹的版本會找到那支 migration ⇒ 版本不在帳本 ⇒ rc=1;
           讀 index 找不到它 ⇒ 「推不出哪支 migration 建了它」⇒ rc=2。
        """
        _base(d)
        _git(d, 'rm', '--cached', '-q', 'supabase/migrations/20260822010000_v.sql')
        io.open(_w(d, 'apps', 'x', 'wire.ts'), 'w').write(
            'export const w = () => enqueueOrderShippedEmails();\n')
        _git(d, 'add', 'apps/x/wire.ts')

    cases = [
        ('OK 已 apply + 未掛',            w_ok,               0, '—'),
        ('帳本四欄齊全而版本號是垃圾',    w_junk_version,     2, 'N4 拿掉 14 位數檢查 ⇒ 這格變 1'),
        ('呼叫端只在工作樹',              w_untracked_only,   1, 'N1 拿掉 --untracked ⇒ 這格變 0'),
        ('呼叫端只在 index',              w_cached_only,      1, 'N2 拿掉 --cached ⇒ 這格變 0'),
        ('另一支【註解掉的】CREATE',      w_commented_create, 1, 'N3 拿掉剝註解 ⇒ 這格變 0'),
        ('git 壞掉(.git 被刪)',          w_git_broken,       2, 'N5 拿掉 rc 檢查 ⇒ 這格變 0'),
        ('帳本只有註解',                  w_empty_ledger,     2, 'N7 拿掉 or None ⇒ 這格變 1'),
        ('帳本欄數壞掉',                  w_bad_cols,         2, 'N6 拿掉欄數檢查 ⇒ 這格變 0'),
        ('CREATE 之後有 DROP',            w_dropped,          2, 'F7 拿掉 DROP 偵測 ⇒ 這格變 0'),
        ('帳本有一行【縮排的】註解',      w_indent_comment,   0, 'F6 沒修 ⇒ 這格變 2(誤擋)'),
        ('帳本的 apply 只寫在工作樹',     w_worktree_only_ledger,     1,
         'N8 帳本改讀工作樹 ⇒ 這格變 0(而提交內容一模一樣)'),
        ('建 view 的 migration 只在工作樹', w_worktree_only_migration, 2,
         'N9 migration 改讀工作樹 ⇒ 這格變 1'),
    ]
    bad = 0
    if not shutil.which('git'):
        print('  🔴 找不到 git ⇒ fixture 世界【一格都沒跑】⇒ 判紅(沒驗到不等於沒問題)')
        return 1
    # (世界名, 建構子, 期望 rc, 期望訊息裡必須出現的字串或 None, 它殺哪個突變)
    for name, world, want, kills in cases:
        need = NEED_PHRASE.get(name)
        try:
            got, out = _fixture_run(world)
        except Exception as exc:                        # noqa: BLE001
            print('  %-28s 🔴 跑不起來:%s' % (name, exc))
            bad = 1
            continue
        ok = got == want and (need is None or need in out)
        why = '' if (need is None or need in out) else '(rc 對而【理由】不對:找不到「%s」)' % need
        print('  %-28s 期望 rc=%s 實得 rc=%s %s %s  [%s]'
              % (name, want, got, '✅' if ok else '🔴', why, kills))
        if not ok:
            bad = 1
    return bad


# ══ selftest ═══════════════════════════════════════════════════════════════
# 🔴 四象限【每一格各餵一發】, 而 Q2 與 Q4 **只差一個布林** ⇒ 用同一個變數餵 callers。
#    兩發之間若還有別的差異, 紅的理由可能來自那個別的差異。
def selftest():
    # 🔴 `--selftest` 全程 GIT-free —— **不是只有建 fixture 那幾發**。
    #    綁定層那幾行也走真讀函式, 而它們的 cwd 是 fixture。
    #    實測(帶 `GIT_DIR` 跑):只在建 fixture 時隔離 ⇒ 綁定層印
    #      「帳本版本筆數 ⇒ None / 建這支 view 的版本 ⇒ []」而整體 rc=1。
    #    ⇒ **它會在 lint-staged 底下紅, 而手動跑是綠的** —— 事故那晚紅的就是這種格。
    global GIT_ENV
    GIT_ENV = _GIT_FREE_ENV
    print('   ROOT = %s' % ROOT)
    WIRED = ['apps/storefront/src/app/api/cron/email-sweep/route.ts']   # Q3/Q4 共用這一個變數
    # 🔴 codex nit 更正:~~Q2/Q4~~ —— Q2 的 callers 是空的, 共用這個變數的是 **Q3 與 Q4**。
    #    而【只差一個布林】那句話對 **Q2↔Q4** 成立(applied 不同、callers 都由下面的常數決定)。
    V = ['20260822010000']
    A = {'20260822010000', '20260101000000'}
    NA = {'20260101000000'}
    # 🔴 code-reviewer R1 F1 指出:上一版的 C3/C4 **把舊行為寫成驗收條件** ——
    #    「誰照 docstring 去修(取最早那一支), 誰就紅」。修法落地後這兩格的期望值必須跟著改。
    #    ⚠️ 這是**更新期望值**, 不是為了讓它過而放寬守門:兩格改的方向都是【少擋】,
    #       而少擋的那兩種情況(有兩支 creator / 沒有呼叫端)**構造不出 42P01**。
    cases = [
        ('Q1 未apply + 未掛',        NA,   V,  [],    VERDICT_OK),
        ('Q2 已apply + 未掛',        A,    V,  [],    VERDICT_OK),
        ('Q3 已apply + 已掛',        A,    V,  WIRED, VERDICT_OK),
        ('Q4 未apply + 已掛',        NA,   V,  WIRED, VERDICT_BLOCKED),
        ('C1 帳本壞 + 已掛',         None, V,  WIRED, VERDICT_CANNOT),
        ('C2 零 creator + 已掛',     A,    [], WIRED, VERDICT_CANNOT),
        ('C3 兩支 creator + 已掛(取最早, 最早那支已 apply)',
         A, ['20260822010000', '20260823010000'], WIRED, VERDICT_OK),
        ('C3b 兩支 creator + 已掛(最早那支未 apply)',
         NA, ['20260822010000', '20260823010000'], WIRED, VERDICT_BLOCKED),
        # 🔴 下面三格全部【沒有呼叫端】⇒ 42P01 構造不出來 ⇒ 一律 ok(F6)
        ('C4 零 creator + 未掛',     A,    [], [],    VERDICT_OK),
        ('C5 帳本壞 + 未掛',         None, V,  [],    VERDICT_OK),
        ('C6 未apply + 未掛',        NA,   [], [],    VERDICT_OK),
    ]
    bad = 0
    for name, ap, cv, cl, want in cases:
        got, why = verdict(ap, cv, cl)
        ok = got == want
        print('  %-26s 期望 %-11s 實得 %-11s %s' % (name, want, got, '✅' if ok else '🔴 不符'))
        if not ok:
            bad = 1
    print('')
    print('  ── fixture 世界(每一格對應一條修法)──')
    if fixture_worlds():
        bad = 1
    print('')
    # 真實綁定那一層:只驗它餵給純述詞的東西是不是真的(各附一發非零)
    ap = read_applied()
    print('  綁定層 帳本版本筆數        ⇒ %s' % (len(ap) if ap else 'None'))
    cv = creating_versions('pcm_shipped_email_pending')
    print('  綁定層 建這支 view 的版本  ⇒ %s' % cv)
    neg = creating_versions('zzz_this_view_does_not_exist')
    print('  綁定層 負對照(假 view 名) ⇒ %s %s' % (neg, '✅ 空' if not neg else '🔴 不該有東西'))
    if ap is None or not cv or neg:
        bad = 1
    ctrl = find_callers('enqueueOrderCreatedEmails')
    tgt = find_callers('enqueueOrderShippedEmails')
    # 🔴 codex R1:`find_callers` 現在**掃不動會回 None**(不是空清單)⇒ 這裡要分得開再印。
    print('  綁定層 正對照 created 呼叫端 ⇒ %s %s'
          % ('掃不動(None)' if ctrl is None else '%d 處' % len(ctrl),
             '🔴 尺死了' if not ctrl else '✅ 非空'))
    print('  綁定層 目標   shipped 呼叫端 ⇒ %s'
          % ('掃不動(None)' if tgt is None else '%d 處' % len(tgt)))
    if not ctrl or tgt is None:
        bad = 1
    # 🔴 天花板③ 第一條「改名進口」:**構造它, 證明偵測器真的漏**(其餘兩條標明未構造)。
    #    偵測器 = 找完整識別字 `enqueueOrderShippedEmails`。兩個世界:
    detector = re.compile(r'(^|[^A-Za-z0-9_])enqueueOrderShippedEmails([^A-Za-z0-9_]|$)')
    same_file = 'import { enqueueOrderShippedEmails as go } from "@pcm/use-cases";\ngo(deps);'
    split_file = 'go(deps);'          # import 在別的檔 / 或不在這次的新增行裡
    a = detector.search(same_file) is not None
    b = detector.search(split_file) is not None
    print('  天花板 renamed_import 同檔(import 也在)⇒ 抓得到=%s %s' % (a, '✅' if a else '🔴'))
    print('  天花板 renamed_import 只有呼叫那一行   ⇒ 抓得到=%s %s'
          % (b, '🔴 這就是那個漏, 已構造證實' if not b else '(預期是 False)'))
    # 🔴🔴 codex R1 must-fix:**這一格原本 `if b is not False: bad = 1`** ——
    #    意思是「偵測器【必須】漏掉它, 否則 selftest 紅」⇒ **有人把這個漏修好, 這支就會紅。**
    #    那是把【已知缺口】寫成【驗收條件】, 方向反了。⇒ 改成**只報告, 不 gate**。
    if a is not True:
        bad = 1                        # a 反過來 ⇒ 偵測器連最基本的字面都抓不到 ⇒ 真的壞了
    if b is not False:
        print('        📌 這個漏後來被補起來了 —— 檔頭天花板③ 第一條要跟著更新。')
    print('  天花板 動態 import / 反射呼叫          ⇒ **未構造**')
    print('  天花板 呼叫端掛在 packages/** 而非 apps/** ⇒ **未構造**')
    _rc_inherit = _real_read_inherits_index_witness()
    if _rc_inherit == 1:
        print('  真讀繼承證人  臨時 index 沒有那個版本 ⇒ rc=1 ✅'
              '   [真讀改成 GIT-free 或改讀工作樹 ⇒ 這格變 0]')
    else:
        print('  🔴 真讀繼承證人 FAIL:rc=%s(該是 1)⇒ 真跑那條路沒有讀到'
              ' GIT_INDEX_FILE 指的那份 index' % _rc_inherit)
        bad = 1
    _decoy, _fix = _env_isolation_witness()
    if _decoy == [] and _fix == ['f.txt']:
        print('  env 隔離證人  誘餌 repo staged=[] ✅ / fixture staged=[f.txt] ✅'
              '   [拿掉 _GIT_FREE_ENV ⇒ 誘餌變 [f.txt]、fixture 變 []]')
    else:
        print('  🔴 env 隔離證人 FAIL:誘餌 staged=%s / fixture staged=%s'
              ' ⇒ fixture 的 git 被外部 GIT_DIR 拉走了' % (_decoy, _fix))
        bad = 1
    print('')
    print('rc=0 表示述詞四象限與綁定層對照全過;它**不表示**真 repo 現在是綠的(那要跑不帶參數那一發)。')
    return bad


if __name__ == '__main__':
    if '--selftest' in sys.argv:
        sys.exit(selftest())
    sys.exit(real_run())
