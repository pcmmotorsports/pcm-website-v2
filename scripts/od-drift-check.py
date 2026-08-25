#!/usr/bin/env python3
"""od-drift-check.py — OD 設計稿漂移偵測(§12 已搬規則)

    python3 scripts/od-drift-check.py            比對 manifest vs 現在的 OD 稿
    python3 scripts/od-drift-check.py --selftest 十四個世界各表演一次

═══ 這支檔存在的理由 ═══════════════════════════════════════════════════════
2026-08-25 b4 線把 §12 的幾條規則從 OD 稿搬進 repo,並在交件時自己標了一個洞:

    「這一格擋得住【結構被改】,擋不住【稿改了】——
      哪天 OD 把那兩條規則改掉,我方這兩條與那格斷言都會安靜地繼續綠。
      🔴 而我不知道有誰在看那件事。」

⇒ 本檔把那句話從「一個沒有人認領的洞」變成「一個跑得起來的檢查」。

═══ 🔴 它【做不到】什麼(先講,不要事後補)═════════════════════════════════
① **它不是 CI 測試,也不該是。** OD 稿住在 repo 外面
   (`~/Library/Application Support/Open Design/…`)⇒ 別人的機器與 CI 上那個檔不存在
   ⇒ 做成 vitest 會「紅在環境」而不是「紅在漂移」,那種紅會被學會忽略。
② **它仍然需要有人去跑它。** 我把「查不了」變成「查得了」,**沒有解決第二半。**
   📌 同族實錘(2026-08-25 線 2 量到):`migration-reset-role-guard.sh` 三層都空 ——
      沒有東西會跑它、唯一提到它的那支也沒人跑、而就算跑了第三層也擋不住。
      **本檔是第一層。** 知道自己只是第一層,不是少做的理由。
③ **它只涵蓋 manifest 裡列出的那幾條** —— 不是「§12 全部」,更不是「整份稿」。
   分母寫在 manifest 自己裡面,不在這支檔的宣稱裡。
④ 🔴 **它算贏家的那把尺自己有兩個【沒有修掉】的盲區**,而本檔完全繼承它們
   (`scripts/tool-final-css.py` 檔頭盲區 5 與 6;repo 版只是把它們**寫下來**,沒有修掉):
   · `!important` **完全不處理** —— 本尺純粹「文件順序後面的贏」,
     而真 CSS 裡 `!important` 贏過文件順序 ⇒ **輸家帶 `!important` 而贏家沒帶時,它會判反,
     且照樣吐出一份看起來乾淨的表**。
   · `@layer` **不展開**,而分層本身會改變層疊結果(未分層 > 已分層)。
   📏 **對【我們這 10 條】量過一次(2026-08-25,對真稿,量法 = 逐字複製 `final_values` 的前處理)**:
   ```
   10 條裡碰得到的                                  = 10 / 10   ← 分母對照
   輸家帶 !important 而贏家沒帶(會判反)的格數      = 0
   正對照 這 10 條的宣告裡帶 !important 的           = 2   (>0 ⇒ 偵測器沒壞)
   正對照 同一個屬性被宣告 >1 次的                   = 0
   ```
   🔴 **那個 0 的真正理由是第三個數字,不是運氣**:這 10 條的屬性在 40 個 `<style>` 區塊裡
   **從頭到尾只被宣告過一次** ⇒ **沒有覆寫,就沒有「誰贏」的問題**,盲區咬不到。
   ⚠️ 但**射程只到「今天這份稿」** —— 哪天有人加一個 `FIX-N` 區塊覆寫它們,這三個數字全部要重量。
   ⚠️ 而 `⑤ 我自己第一發就把這件事量錯了`:漏了 `_strip_comments` 與扁平化
      ⇒ **只碰到 10 條裡的 7 條,而它照樣印出一個 0**。
      📌 **分母對照(碰得到幾條)要與結果印在一起** —— 少了它,「沒有問題」與「沒量到」同一個字。

═══ 🔴🔴 兩個世界必須分開報 ═══════════════════════════════════════════════
    「稿換了」   與   「我方漂了」   **都會讓值對不上**,而處置完全相反:
      稿換了   ⇒ 去讀新稿、重新決定要不要跟 ⇒ 本次比對【作廢】,不是發現漂移
      我方漂了 ⇒ 稿沒動而我們的紀錄與它對不上 ⇒ 那才是真的要修
⇒ 所以**第一件事是驗稿的 sha256**,對不上就停,**不要往下比值**。
   📌 為什麼特別要這條:`docs/design/od-cascade-winning-values.md` 那張表釘了約 60 個行號
      而**零 sha256** ⇒ 稿一動,全部座標無聲失效,**而值看起來還是對的**。
      姊妹檔 `admin-design-system.md` 已經學過這課(釘 sha + 「對不上 ⇒ 所有行號全部作廢」)。

═══ 為什麼記【贏家值】不記第一次宣告 ═════════════════════════════════════
稿自己會層疊:39 個 `<style>` 區塊,後面帶 `data-od-fix="FIX-N"` 的會覆寫前面的。
🔴 實錘(2026-08-24):有三重證據都支持「把 `--primary` 改回稿」,而開了稿才發現
   `FIX-10` 用同特異性覆寫成我方現值 ⇒ **改回去才是改壞。**
⇒ manifest 的值一律由 `tool-final-css.py` 的 `final_values()` 產出。

回傳碼:0 沒有漂移 / 1 有漂移 / 2 稿換了(本次作廢)/ 3 環境不足(找不到稿或工具)
     / 4 **本次比對不可信**(manifest 條數或集合不對 / JSON 壞 / parser traceback /
         **這幾條落在本尺的已知盲區**)
🔴 **4 與 1 一定要分得開** —— 把當機報成漂移,會讓人去改一份沒有錯的 CSS。
🔴 而 **4 與 0 更要分得開**:`blind_spot_scan()` 每次現算,踩到盲區就回 4、**不出比對結果** ——
   因為產表與複查用的是同一把尺,尺判錯時兩邊會自洽成綠,而下游那支 vitest 會
   **反過來逼我方的 CSS 去跟一個錯的值**(codex R3 MF-6)。
"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
MANIFEST = os.path.join(REPO, 'docs', 'design', 'od-ported-rules.json')
# 🔴 **指 repo 內那份,不是信箱那份**(2026-08-25 codex R1 MF-1)。
#    原本寫 `~/pcm-mailbox/tool-final-css.py` ⇒ **會出貨的腳本,指著不會出貨的那一份**
#    ⇒ 在任何沒有那個信箱資料夾的機器上,它會回「環境不足」而看起來像正常的保守行為。
#    📌 這正是 `feedback_i-fixed-it-in-the-copy-that-never-ships` 那條的鏡像。
#    ✅ 而「換這支尺會不會改變值」是**量過的,不是推的**(2026-08-25,兩份都對真稿跑 `final_values()`):
#       兩份輸出 **552 個鍵完全相同**、manifest 那 10 條逐條相同、判不同的 0 條;
#       負對照 = 故意塞一格不同 ⇒ 比對器有印出不同(⇒ 那個 0 不是量具沒跑)。
#       兩份的**非註解行完全相同**,26 行差異全部是 repo 版多寫的盲區聲明。
#    ⚠️ 所以 manifest **不需要重產** —— 這條是可攜性缺陷,不是值的缺陷。兩件不要合成一句。
TOOL = os.path.join(REPO, 'scripts', 'tool-final-css.py')

RC_OK, RC_DRIFT, RC_SOURCE_CHANGED, RC_ENV, RC_BROKEN = 0, 1, 2, 3, 4

# 🔴 manifest 應有的**識別集合**(codex R1 MF-2 + R2 MF-3)。
#    R1 那版寫的是 `EXPECTED_RULES = 10`,而 R2 打穿了它:
#    **刪掉一條、把另一條複製一份 ⇒ 數字還是 10 ⇒ 照樣回「沒有漂移」。**
#    📌 判別句:**「幾條」與「哪幾條」是兩個宣稱,而 `len` 只答得出前者。**
#    ⇒ 改成把 `(group, context, selector)` 整組寫死。改分母要改這張表,那是刻意的摩擦。
EXPECTED_KEYS = frozenset(
    {
        ('組4', '@media (max-width:767px)', '.workspace-panel'),
        ('組4', '@media (max-width:767px)', '.workspace-row'),
        ('組4', '@media (max-width:767px)', '.workspace-handle'),
        ('組5', '@media (max-width:767px)', '.workspace-panel>.panel-width-locked'),
        ('組19', '', '[data-od-panel="money"] details:has(>summary h2:not(.text-destructive)) > summary'),
        ('組20', '', '[data-od-panel="money"] details:has(>summary h2.text-destructive) > summary'),
        ('組28', '', '.od-seg-on .od-seg-dot'),
        ('組37', '', '.od-seg:focus-visible'),
        ('組38', '', '[data-od-tab]:focus-visible'),
        ('組40', '', '.od-segbar:focus-within'),
    }
)


# 🔴🔴 **把 EXPECTED_KEYS 綁在【會自己過期的東西】上**(codex R4 MF-2)。
#    沒有這兩個常數時,`rc=4 集合紅` 的最短路是「把實際的 key 貼進 EXPECTED_KEYS」——
#    ⇒ **一條沒有人審過的新規則就這樣變綠了**,而那個動作在 diff 上只是多一行。
#    📌 判別句(這包的三張清單共用):
#       **一張豁免清單,如果新增一行就能讓紅消失,那它不是豁免清單,是一個關閉開關。**
#       **每一行豁免都要綁一個【會自己過期】的東西。**
#    ⇒ 這裡綁兩件:①這組 key 是對著【哪一份稿】決定的 ②那 10 條的宣告值的指紋。
#      稿變了而有人只補 key ⇒ ①②都對不上 ⇒ 仍然紅,而且要動【兩個檔】才壓得下去。
EXPECTED_SOURCE_SHA = 'fc4a24a584e9e7d24eeb6e7e0839e8cc0c25a754db5bf9fee537e7e97f933d67'
EXPECTED_RULES_DIGEST = 'ba9af53f595e9d87614eb72c705f34ce9626bd2c8ee0c6d7de726a5fbe56794d'


def rules_digest(rows) -> str:
    """對規則內容取指紋 —— 順序無關,值有關。"""
    canon = json.dumps(
        sorted(
            [[r.get('group'), r.get('context'), r.get('selector'), sorted(r.get('declarations', {}).items())]
             for r in rows]
        ),
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.sha256(canon.encode()).hexdigest()


def guarded(run) -> tuple[int, list[str]]:
    """把「它自己壞了」統一映射成 `RC_BROKEN`(codex R2 MF-1/MF-4)。

    🔴 **接 `SystemExit` 而不只是 `Exception`**:被 import 的工具若在載入階段
       `sys.exit(0)`,`except Exception` **接不到** ⇒ 它會一路衝到直譯器,而 shell 收到
       **rc=0** ⇒ **這支檢查會安靜地報「沒有漂移」**。那不是撞碼,是**假綠**。
    ⚠️ 刻意**不接 `KeyboardInterrupt`** —— 使用者按 Ctrl-C 不該被記成「工具壞了」。
    📌 本函式存在的第二個理由:selftest 可以直接餵它一顆會炸的 lambda
       ⇒ **例外路徑真的被跑過**,而不是靠讀程式碼相信它。
    """
    try:
        return run()
    except KeyboardInterrupt:
        raise
    except FileNotFoundError as e:
        return RC_ENV, [f'⚠️ 找不到需要的檔 ⇒ **環境不足,不是「沒有漂移」**:{e}']
    except (Exception, SystemExit) as e:  # noqa: BLE001 —— 要的就是「任何毛病都不准被讀成漂移」
        return RC_BROKEN, [f'🔴 它自己壞了 ⇒ **不是漂移,本次比對作廢**:{type(e).__name__}: {e}']


def load_final_values(html: str) -> dict:
    """用 tool-final-css.py 算贏家值。找不到那支工具 ⇒ 環境不足,不是「沒有漂移」。"""
    return _tfc().final_values(html)


def blind_spot_scan(html: str, keys) -> list[str]:
    """回「本尺對這幾條規則失效」的理由行;空清單 = 這一次沒有落在已知盲區。

    🔴 **為什麼要現算,而不是寫一段註解**(codex R3 MF-6):
       產表(`final_values`)與複查用的是**同一把尺** ⇒ 尺判錯時兩邊會**自洽成綠**,
       而下游那支 vitest 會**反過來逼我方的 CSS 去跟一個錯的值**。
       ⇒ 那不是漏報,是**主動把我方推向錯的值** —— 這包會從「沒用」變成「有害」。
    ⇒ 所以把盲區從【安靜】換成【有聲】:每次跑都現算,踩到就 `RC_BROKEN`,不出比對結果。

    本尺的失效條件(來自 `tool-final-css.py` 檔頭盲區 5):它純粹「文件順序後面的贏」,
    而真 CSS 裡 `!important` **贏過文件順序** ⇒ 只有在**同屬性被宣告過不只一次**時才會判錯。
    ⇒ 偵測兩件:①同屬性宣告 >1 次 ②其中輸家帶 `!important` 而贏家沒帶。
    ⚠️ **`@layer` 那個盲區(盲區 6)本函式【沒有偵測】** —— 分層會改變層疊結果而本尺不展開它。
       2026-08-25 我**沒有量過**這份稿裡的 `@layer`,**明寫未量,不假裝量過**。
    """
    import re as _re

    css = _tfc()._strip_comments('\n'.join(_tfc().styles_in_document_order(html)))
    hist: dict = {}
    for ctx, sel, body in _tfc().walk(css):
        if (ctx, sel) not in keys:
            continue
        flat = _re.sub(r'\{[^{}]*\}', '', body)
        for decl in flat.split(';'):
            if ':' not in decl:
                continue
            prop, val = decl.split(':', 1)
            prop = prop.strip()
            if not prop or prop.startswith('@'):
                continue
            hist.setdefault((ctx, sel), {}).setdefault(prop, []).append(
                (val.strip(), bool(_re.search(r'!\s*important', val)))
            )

    out: list[str] = []
    touched = sum(1 for k in keys if k in hist)
    for k, props in hist.items():
        for prop, h in props.items():
            if len(h) > 1:
                out.append(f'   {k[1]} 的 {prop} 被宣告 {len(h)} 次 ⇒ 本尺只會取最後一次')
            if any(i for _, i in h[:-1]) and not h[-1][1]:
                out.append(f'   🔴 {k[1]} 的 {prop}:輸家帶 !important 而贏家沒帶 ⇒ **本尺會判反**')
    if out:
        out.insert(0, f'   (分母對照:{len(keys)} 條裡碰得到 {touched} 條)')
    return out


_TFC = None


def _tfc():
    """延遲載入算贏家值的工具 —— 讓 `guarded()` 接得到它 import 階段的任何毛病。"""
    global _TFC
    if _TFC is None:
        spec = importlib.util.spec_from_file_location('tfc', TOOL)
        if spec is None or spec.loader is None:
            raise FileNotFoundError(TOOL)
        _TFC = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_TFC)
    return _TFC


def compare(
    manifest: dict,
    html: str,
    raw: bytes,
    expected_keys: frozenset = EXPECTED_KEYS,
    # 🔴 `'default'` 這顆哨兵不是講究:寫成 `pins=(EXPECTED_SOURCE_SHA, …)` 時,
    #    那個 tuple 在 **def 執行的當下**就算好了 ⇒ 之後改模組常數【完全沒有效果】
    #    ⇒ 這條分支**從外面測不到**,而它在自檢裡(pins=None)也不會被走到
    #    ⇒ 一條沒有任何路徑會執行到的守門,而它看起來裝好了。(我實測撞到才發現。)
    pins: 'tuple[str, str] | str | None' = 'default',
) -> tuple[int, list[str]]:
    """回 (rc, 訊息行)。

    🔴 **順序:sha 先驗,識別集合後驗**(codex R2 MF-2)。
       R1 那版把條數檢查放在最前面,而那**新開了一個洞**:條數壞掉**而且**稿同時換了
       ⇒ 先回 rc=4「它自己壞了」,**把本該回報的「稿換了」吃掉**。
       兩者的處置完全不同(去讀新稿 vs 修 manifest),被吃掉的那個不會再有第二次機會講話。
    📌 這一格值得記:**我是在折上一輪的 must-fix 時把它做出來的。**
       修 nit / 補守門新增的碼,一樣會帶進 must-fix 級缺陷。
    """
    lines: list[str] = []

    actual_sha = hashlib.sha256(raw).hexdigest()
    if actual_sha != manifest['source']['sha256']:
        lines.append('🔴 稿換了 —— 本次比對【作廢】,這不是「發現漂移」。')
        lines.append(f"   manifest 記的 sha256 : {manifest['source']['sha256']}")
        lines.append(f'   現在這份的 sha256    : {actual_sha}')
        lines.append('   ⇒ 處置:去讀新稿,逐條決定要不要跟,然後重產 manifest。')
        lines.append('   ⚠️ 不要直接把 manifest 的 sha 改成新的 —— 那會把「還沒看過新稿」')
        lines.append('      偽裝成「已經核對過」,而兩者在檔案上長得一模一樣。')
        return RC_SOURCE_CHANGED, lines

    # 🔴 識別集合後驗 —— 守的是「**哪 10 條**」,不是「10 條」(codex R2 MF-3)。
    #    刪一條、複製另一條 ⇒ `len` 不變 ⇒ 舊版照樣回「沒有漂移」。
    rows = manifest.get('rules', [])
    got_keys = frozenset((row.get('group'), row.get('context'), row.get('selector')) for row in rows)
    # 🔴 **集合【與】基數兩個都要驗**(codex R3 MF-1)。R2 把 `len` 換成集合,而那**弄丟了基數保護**:
    #    合併衝突多留一筆【完全重複】的規則 ⇒ 集合不變 ⇒ 回 rc=0。
    #    📌 第三輪連續第三次「折 A 開出 B」—— 每一次都是在修上一輪的 must-fix 時做出來的。
    if len(rows) != len(expected_keys):
        lines.append('🔴 manifest 條數與集合對不上 ⇒ **本次比對作廢**。')
        lines.append(f'   期望 {len(expected_keys)} 條,實際 {len(rows)} 條(去重後 {len(got_keys)} 個)。')
        lines.append('   ⇒ 最常見的成因:合併衝突留下重複的規則。**集合看不出重複,基數看得出。**')
        return RC_BROKEN, lines
    if got_keys != expected_keys:
        lines.append('🔴 manifest 的規則集合不對 ⇒ **本次比對作廢,這不是「沒有漂移」**。')
        for k in sorted(expected_keys - got_keys, key=str):
            lines.append(f'   少了:{k}')
        for k in sorted(got_keys - expected_keys, key=str):
            lines.append(f'   多了:{k}')
        lines.append('   ⇒ 處置:先弄清楚是【被刪掉】、【欄位改名讓它讀不到】,還是【有人真的加了規則】。')
        lines.append('      **不要直接把期望值改成實際值** —— 那會把「掃到別的東西」變成「都沒漂」。')
        return RC_BROKEN, lines

    # 🔴 版本釘選【只算不報】—— 報的位置在下面,理由見那裡。
    if pins == 'default':
        pins = (EXPECTED_SOURCE_SHA, EXPECTED_RULES_DIGEST)  # 呼叫當下才取, 才改得動
    pin_bad: list[str] = []
    if pins is not None:
        want_sha, want_digest = pins
        got_digest = rules_digest(rows)
        if manifest['source']['sha256'] != want_sha or got_digest != want_digest:
            pin_bad = [
                '🔴 manifest 與本檔記的【審過的版本】對不上。',
                f"   稿 sha:本檔記 {want_sha[:16]}… / manifest 說 {manifest['source']['sha256'][:16]}…",
                f'   值指紋:本檔記 {want_digest[:16]}… / 實際 {got_digest[:16]}…',
                '   ⇒ 有人動過 manifest 的內容,而【本檔的期望值沒有跟著被人審過】。',
                '   ⚠️ 壓下這個紅要動【兩個檔】,那是刻意的 —— 貼一行進清單不該足以讓紅消失。',
            ]

    # 🔴 盲區先掃(codex R3 MF-6)—— 踩到就不出比對結果,而不是出一份不可信的結果。
    blind = blind_spot_scan(html, {(k[1], k[2]) for k in expected_keys})
    if blind:
        lines.append('🔴 這幾條落在本尺的【已知盲區】⇒ **本次比對不可信,不要當成「沒有漂移」**。')
        lines += blind
        lines.append('   ⇒ 處置:那幾格要人開稿手判誰贏,或把 tool-final-css.py 的層疊語意補起來。')
        lines.append('   ⚠️ `@layer` 那個盲區本檔【沒有偵測】—— 未量,不是量過沒事。')
        return RC_BROKEN, lines

    fv = load_final_values(html)
    drifted: list[str] = []
    for row in manifest['rules']:
        key = (row['context'], row['selector'])
        now = fv.get(key)
        if now is None:
            drifted.append(f"   [{row['group']}] 選擇器在稿上消失了:{row['selector']}")
            continue
        if now != row['declarations']:
            drifted.append(f"   [{row['group']}] {row['selector']}")
            for prop in sorted(set(row['declarations']) | set(now)):
                was, isnow = row['declarations'].get(prop), now.get(prop)
                if was != isnow:
                    drifted.append(f'       {prop}: 記的 {was!r} ⇒ 現在 {isnow!r}')

    if drifted:
        lines.append('🔴 稿沒換,而下列規則與 manifest 對不上 ⇒ **這是真的漂移**。')
        lines += drifted
        lines.append('   ⇒ 處置:逐條看是我方搬錯、還是 manifest 被人手改過。')
        if pin_bad:
            lines.append('   📌 而版本釘選【也】對不上 ⇒ 後者的可能性高很多:')
            lines += ['   ' + x for x in pin_bad]
        return RC_DRIFT, lines

    # 🔴🔴 **釘選放在【值比完之後】才報**(我自己在折 R4 MF-2 時撞到的):
    #    放在前面的話它會**遮蔽 rc=1** —— 因為稿的 sha 相符時 `final_values()` 是決定性的,
    #    ⇒ 值會對不上的唯一成因就是「manifest 被人手改過」,而那正好也讓釘選對不上
    #    ⇒ 釘選先報 ⇒ **rc=1 這條路在正式使用時永遠走不到**,變成死碼,
    #      而死掉的分支在自檢裡(pins=None)照樣全綠 ⇒ 沒有任何訊號。
    #    ⇒ 現在:值對不上 ⇒ 仍然 rc=1 並【指名到屬性】,釘選的資訊附在後面當佐證。
    if pin_bad:
        lines += pin_bad
        lines.append('   ⇒ 值本身逐條相同,所以這不是漂移,是【版本沒有被審過】⇒ 本次比對作廢。')
        return RC_BROKEN, lines

    lines.append(f"✅ 沒有漂移。稿 sha 相符,manifest 裡 {len(manifest['rules'])} 條規則逐條相同。")
    lines.append(f"   ⚠️ 分母 = 這 {len(manifest['rules'])} 條,**不是 §12 全部、更不是整份稿**。")
    return RC_OK, lines


def _boom(e: BaseException):
    """selftest 用:餵給 `guarded()` 的一顆會炸的東西 —— **例外路徑要真的跑過,不是讀程式碼相信它。**"""
    raise e


def selftest() -> int:
    """十四個世界各表演一次 —— **該綠的要綠、該紅的要紅,而且要紅在【不同的碼】上。**"""
    base_html = '<style>.a{color:red}</style><style>.b{color:blue}</style>'
    base_raw = base_html.encode()
    rule_a = {'group': 'T', 'context': '', 'selector': '.a', 'declarations': {'color': 'red'}}
    rule_b = {'group': 'T', 'context': '', 'selector': '.b', 'declarations': {'color': 'blue'}}
    man = {'source': {'sha256': hashlib.sha256(base_raw).hexdigest()}, 'rules': [rule_a, rule_b]}
    KEYS = frozenset({('T', '', '.a'), ('T', '', '.b')})
    # selftest 用構造的小 HTML ⇒ 版本釘選不適用(`pins=None`),那一格另有世界⑭專門驗。
    cmp = lambda m, h, r: compare(m, h, r, expected_keys=KEYS, pins=None)  # noqa: E731
    worlds = []

    rc, _ = cmp(man, base_html, base_raw)
    worlds.append(('① 完全相同 ⇒ 該綠', rc == RC_OK, rc))

    # ② 稿換了(sha 不同)⇒ 必須回 SOURCE_CHANGED, **不是 DRIFT**
    other = base_html + '<!-- x -->'
    rc, _ = cmp(man, other, other.encode())
    worlds.append(('② 稿換了 ⇒ 該回「作廢」不是「漂移」', rc == RC_SOURCE_CHANGED, rc))

    # ③ 值變了而 sha 仍相符(構造:manifest 記錯值)⇒ 真漂移
    man3 = json.loads(json.dumps(man))
    man3['rules'][0]['declarations'] = {'color': 'GREEN'}
    rc, _ = cmp(man3, base_html, base_raw)
    worlds.append(('③ 值對不上而 sha 相符 ⇒ 該紅在「漂移」', rc == RC_DRIFT, rc))

    # ④ 稿上整條不見了(識別集合仍相符、sha 仍相符)⇒ 也要算漂移,不是靜靜地當成沒事。
    #    🔴 構造方式很重要:**不能改 manifest 的 selector** —— 那會變成「識別集合不對」(rc=4),
    #       就量不到這一條了。要動的是**稿那一側**:一份沒有 `.a` 的稿,而 sha 對得上它自己。
    gone_html = '<style>.b{color:blue}</style>'
    gone_raw = gone_html.encode()
    man4 = json.loads(json.dumps(man))
    man4['source']['sha256'] = hashlib.sha256(gone_raw).hexdigest()
    rc, _ = cmp(man4, gone_html, gone_raw)
    worlds.append(('④ 選擇器在稿上查無 ⇒ 該紅在「漂移」', rc == RC_DRIFT, rc))

    # ⑤ 🔴 **改寫過**(codex R3 nit):原本這一格重跑②③再比它們的碼,而②③各自已經釘死自己的碼
    #    ⇒ 它變成邏輯必然式、零額外回歸判別力,而「10 個世界全過」會讀起來像 10 條獨立防線。
    #    改成驗**碼本身的定義**:有人把 RC_BROKEN 打成 1,②③還是各自過,而整套語意會塌掉。
    codes = [RC_OK, RC_DRIFT, RC_SOURCE_CHANGED, RC_ENV, RC_BROKEN]
    worlds.append(('⑤ 五個回傳碼必須兩兩相異', len(set(codes)) == len(codes), codes))

    # ⑥ 🔴 空的 manifest **不可以**印「沒有漂移」(codex R1 MF-2 實測到的恆綠格)——
    #    迴圈跑 0 圈時 `drifted` 是空的,而空的 `drifted` 與「逐條都相同」在程式裡是同一件事。
    man6 = json.loads(json.dumps(man))
    man6['rules'] = []
    rc6, _ = cmp(man6, base_html, base_raw)
    worlds.append(('⑥ manifest 空掉 ⇒ 不可以回「沒有漂移」', rc6 == RC_BROKEN, rc6))

    # ⑦ 🔴🔴 **條數一樣而成員不同**(codex R2 MF-3):刪掉 `.b`、把 `.a` 複製一份 ⇒ 還是 2 條。
    #    舊版守 `len` ⇒ **這一發會完全通過**。「幾條」與「哪幾條」是兩個宣稱。
    man7 = json.loads(json.dumps(man))
    man7['rules'] = [json.loads(json.dumps(rule_a)), json.loads(json.dumps(rule_a))]
    rc7, _ = cmp(man7, base_html, base_raw)
    worlds.append(('⑦ 條數相同而成員不同 ⇒ 該紅', rc7 == RC_BROKEN, rc7))

    # ⑧ 🔴🔴 **稿換了【而且】集合也壞了**(codex R2 MF-2):必須回「稿換了」,不可以被「它自己壞了」吃掉。
    #    舊版把條數檢查放在 sha 之前 ⇒ 這一發會回 4,而「去讀新稿」那個處置就沒有人會做了。
    rc8, _ = cmp(man7, other, other.encode())
    worlds.append(('⑧ 稿換了 ＋ 集合也壞 ⇒ 該回「稿換了」不是「它自己壞了」', rc8 == RC_SOURCE_CHANGED, rc8))

    # ⑨ 🔴🔴 **`SystemExit(0)` 不可以變成綠的**(codex R2 MF-1)——
    #    `except Exception` 接不到它 ⇒ 舊版會讓直譯器以 **rc=0** 結束 = **假綠**。
    rc9, _ = guarded(lambda: _boom(SystemExit(0)))
    worlds.append(('⑨ 被載入的工具 sys.exit(0) ⇒ 不可以回 0', rc9 == RC_BROKEN, rc9))

    # ⑩ 🔴 環境不足 與 它自己壞了 也要分得開(前者可以重試,後者要修碼)。
    rc10, _ = guarded(lambda: _boom(FileNotFoundError('x')))
    worlds.append(('⑩ 環境不足 ≠ 它自己壞了', rc10 == RC_ENV and rc10 != rc9, f'{rc10} vs {rc9}'))

    # ⑪ 🔴🔴 **完全重複的一筆**(codex R3 MF-1):集合不變、只有基數變。
    #    R2 把 len 換成集合之後,這一發會【完全通過】—— 合併衝突最常見的長相就是它。
    man11 = json.loads(json.dumps(man))
    man11['rules'].append(json.loads(json.dumps(rule_a)))
    rc11, _ = cmp(man11, base_html, base_raw)
    worlds.append(('⑪ 多一筆完全重複的規則 ⇒ 該紅(集合看不出來, 基數看得出來)', rc11 == RC_BROKEN, rc11))

    # ⑫ 🔴🔴 **落在本尺盲區時不可以出比對結果**(codex R3 MF-6):
    #    構造一份「輸家帶 !important 而贏家沒帶」的稿 —— 真瀏覽器吃 red,本尺會說 blue。
    trap = "<style>.a{color:red !important}</style><style>.a{color:blue}</style>"
    trap_raw = trap.encode()
    man12 = json.loads(json.dumps(man))
    man12['source']['sha256'] = hashlib.sha256(trap_raw).hexdigest()
    man12['rules'] = [json.loads(json.dumps(rule_a)), json.loads(json.dumps(rule_b))]
    rc12, l12 = cmp(man12, trap, trap_raw)
    worlds.append(('⑫ 踩到 !important 盲區 ⇒ 該回「不可信」而不是一個比對結果',
                   rc12 == RC_BROKEN and any('判反' in x for x in l12), rc12))

    # ⑭ 🔴🔴 **版本釘選**(codex R4 MF-2):有人把新 key 貼進 EXPECTED_KEYS 讓集合過關,
    #    而 pins 沒跟 ⇒ 仍然紅。壓下它要動兩個檔,那是刻意的摩擦。
    pin_sha = hashlib.sha256(base_raw).hexdigest()
    rc14a, _ = compare(man, base_html, base_raw, expected_keys=KEYS,
                       pins=(pin_sha, rules_digest(man['rules'])))
    rc14b, l14b = compare(man, base_html, base_raw, expected_keys=KEYS,
                          pins=(pin_sha, '0' * 64))
    worlds.append(('⑭ 值指紋對不上 ⇒ 該紅(而指紋對得上時要綠)',
                   rc14a == RC_OK and rc14b == RC_BROKEN and any('審過的版本' in x for x in l14b),
                   f'{rc14a} / {rc14b}'))

    # ⑬ 🔴 負對照:**沒有踩到盲區的稿不可以被誤擋** —— 沒有這一格,⑫ 與「這道閘恆紅」分不開。
    rc13, _ = cmp(man, base_html, base_raw)
    worlds.append(('⑬ 沒踩到盲區的稿不可以被盲區閘誤擋', rc13 == RC_OK, rc13))

    ok = True
    for label, passed, got in worlds:
        print(f"  {'PASS' if passed else 'FAIL'}  {label}   (rc={got})")
        ok = ok and passed
    print('selftest:', 'PASS' if ok else '🔴 FAIL')
    return 0 if ok else 1


def main() -> int:
    if '--selftest' in sys.argv:
        return selftest()

    if not os.path.exists(MANIFEST):
        print(f'🔴 找不到 manifest:{MANIFEST}', file=sys.stderr)
        return RC_ENV

    def work() -> tuple[int, list[str]]:
        manifest = json.load(io.open(MANIFEST, encoding='utf-8'))
        src = os.path.expanduser(manifest['source']['path'])
        if not os.path.exists(src):
            return RC_ENV, [
                '⚠️ 找不到 OD 稿 ⇒ **環境不足,不是「沒有漂移」**。',
                f'   期望位置:{src}',
                '   (這支檔只在有裝 Open Design 的機器上跑得動 —— 那是它不做成 CI 測試的理由)',
            ]
        raw = io.open(src, 'rb').read()
        return compare(manifest, raw.decode('utf-8'), raw)

    # 🔴 **整段都在 `guarded()` 裡面,印訊息那個迴圈也是**(codex R2 MF-4)。
    #    R1 那版把 `for ln in lines: print(ln)` 放在 try **外面** ⇒ 接管線時
    #    (`… | head`)stdout 的 BrokenPipe/OSError 會以未捕捉例外退出,而 shell 收到 **rc=1**
    #    —— 那個碼在本檔的字典裡是「真的漂移」⇒ **一個管線意外會被讀成一個發現。**
    rc, lines = guarded(lambda: _emit(work()))
    if rc == RC_BROKEN:
        for ln in lines:
            print(ln, file=sys.stderr)
    return rc


def _emit(result: tuple[int, list[str]]) -> tuple[int, list[str]]:
    """把訊息印出來,並把 (rc, lines) 原樣傳回 —— 印這個動作本身也要在保護傘底下。"""
    rc, lines = result
    for ln in lines:
        print(ln, file=sys.stderr if rc in (RC_ENV, RC_BROKEN) else sys.stdout)
    sys.stdout.flush()  # 🔴 不 flush 的話 BrokenPipe 會延到直譯器關閉才炸,那時已經接不到了
    return rc, []


if __name__ == '__main__':
    sys.exit(main())
