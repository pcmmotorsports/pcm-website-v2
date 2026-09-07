#!/usr/bin/env python3
"""碰到 `manual_failed` 那兩支函式的新 migration, 檔頭要帶【配對那一句】⇒ 否則擋下。

    python3 scripts/manual-failed-pairing-gate.py <file.sql> [more.sql ...]
    python3 scripts/manual-failed-pairing-gate.py --selftest      五個世界各表演一次

── 🔴 為什麼要這一道(而它不是「多一道比較保險」)──────────────────────────
  板列 `⟦b9-REFUNDNUM1⟧` 逐字記著:**兩支 SQL 共用一個邊界「哪些 `manual_failed` 算數」,
  而【沒有任何守門在守它】**:
    · `pcm_order_refundable_remaining`(主數字)      ⇒ `corrected_to = 'money_moved'` **才扣**
    · `pcm_order_pending_manual_verdict_amount`(後半句)⇒ `v.refund_id IS NULL`(**還沒判**)**才算**
  🛑 **改主數字那半 ⇒ 後半句那支【不會紅】** ⇒ 畫面會**雙重計算或漏算**,
     而客人 / 員工看到的是**一句自相矛盾的話**。

── 🔴🔴 而它為什麼【只能是機制, 不能是規則文字】────────────────────────────
  那句規矩最該住的地方是那兩支 SQL 的檔頭。而**它們都已 apply ⇒ 連註解都不可改**
  (memory `reference_applied-migrations-are-immutable-even-in-comments` 逐字:
   「已 apply 的 migration, 連【註解】都是不可變的…改一個字(哪怕是中文註解)⇒ sha 不相等」)。
  ⇒ 📌 **所以那句話只能住在板列上, 而板列沒有人在守。**
  ⇒ 🎯 **那正是「規矩住在一個沒有執行者的地方」** —— 而 CLAUDE.md 機制優先律說:
     **發現坑, 第一選擇做成機制;機制做不到才寫規則文字, 而寫規則前先答「為何機制做不到」。**
     ⇒ **這一格機制做得到, 所以做了它。**

── 🛑 「碰到」的定義(講死, 否則這道閘會誤擋)───────────────────────────────
  **碰到 = 這支檔裡出現那兩個函式名【任一個】, 而且【不是只出現在註解裡】。**
  🔴 為什麼要剝註解:本 repo 的 migration **註解比碼多**, 而一支「只是在說明那兩支」的檔
     被擋下來, 會讓人學會忽略這道閘。
     (母題:板列 `⟦b4-PARTCANCEL1⟧` 那個 `grep -c 'p_items'` ⇒ 2, 而兩處都是註解。)
  ⚠️ **而剝的只有【行首 `--`】那一種** —— 下面這幾種**仍然算碰到**(code-reviewer 2026-09-08 實測):
     · 行尾註解裡的函式名
     · `/* … */` 區塊註解裡的
     · dollar-quoted 字串常數(`DO $d$ … $d$`)裡的
     🛑 **那是刻意往【嚴】的方向偏,而代價不對稱**:
     **漏擋的代價是【錢算錯】,誤擋的代價是【有人多讀一句話並貼一個錨】。**
     🔵 **而它與 `migration-static-checks.sh` 那句「用結構分,不用『出現』分」不一致** ——
     **那個不一致是知道的**:要做對得寫一個 SQL 的 tokenizer,而**那把新的尺自己會有坑**
     ⇒ 📌 **在「多讀一句話」這個代價下,不值得**。哪天誤擋真的變吵 ⇒ 再回來,而不是現在先做。

── 🔴🔴 做閘的固定步驟(主視窗 A 2026-09-08 立;而本支【自己就是那個實例】)──────
  **`--selftest` 全綠之後,對【今天的真實檔案全集】跑一次,看它擋掉幾支。**
  🔬 本支的實錘:第一版 selftest 四個世界全綠 ⇒ 看起來完成了;
     而對 `supabase/migrations/*.sql` 全集跑一次 ⇒ **22 支被擋**,
     而它們**都已 apply、連註解都不可改** ⇒ 📌 **它們沒有【合法的修法】。**
  🛑 **⇒ 判準不是「擋掉幾支」,是【擋掉的那幾支有沒有合法的修法】** ——
     沒有 ⇒ **那道閘不能上**,不論它自己多正確。
  🎯 **⇒ 而 `--selftest` 抓不到它,因為 selftest 的世界是【寫閘的人自己造的】。**

── 🔵 而修法【不是加豁免清單】——────────────────────────────────────────
  加豁免清單 ⇒ 那 22 支被寫死成例外 ⇒ 而**清單會過期,而過期時它會開始漏擋**。
  ✅ 正解:接進 `migration-static-checks.sh` 當第 (8) 道
     ⇒ 自動吃到入口 `migration-new-file-static-checks.sh` 的 `already_landed`
       (在 `APPLIED.tsv` 第一欄 / 已在 `origin/dev` ⇒ 一律不掃)。
  🔴 **而不自己發明第二把「哪些檔該掃」的尺,理由是那支入口自己寫的**:
     它的註解裡記著它踩過的兩個坑 —— 14 位版本號寫成 12 位(**整改沒生效而畫面全綠**)、
     絕對路徑讓 `origin/dev` 判錯(**擋住一批不是他造成的紅**)。
     ⇒ 📌 **重寫一把新的尺,就是把那兩個坑再踩一次。**

── ⚠️ 它證不到什麼(不要讀得比它寬)────────────────────────────────────────
  · 它只認【函式名字面】。有人用動態 SQL 拼出那個名字, 它看不到。
  · 它**不驗那句配對寫得對不對** —— 只驗【那句話在不在】。
    🔴 一支貼了那句而完全沒理解它的 migration, 照樣過得了本閘。**那一格靠人。**
  · 它只掃**餵給它的檔**。lint-staged 沒把那支檔交給它 ⇒ 它一個字都不會說。
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# 🔴 那兩支函式 —— 而它們的座標寫在這裡, 是為了讓下一個人查得到「為什麼是這兩支」
PAIRED_FUNCS = (
    "pcm_order_refundable_remaining",          # newest = live = 20260820100000
    "pcm_order_pending_manual_verdict_amount", # newest = live = 20260907200000(貼板 90)
)

# 🔴🔴 **要帶的是【一個不會撞的標記】, 不是兩個各自去比的片段**(code-reviewer 2026-09-08 must-fix)
#
# ⛔ ~~第一版:`PAIRING_MARKS = ("manual_failed", "並排")`, 兩個片段【各自】在不在~~
# 🛑 **而那個設計【幾乎恆真】—— 成因我自己複量過**:
#    `manual_failed` 是那兩支函式【自己 body 裡就有的字面】——
#    🔬 `20260820100000` 含它 **3** 次 · `20260907200000` 含它 **5** 次
#    ⇒ 一支「碰到」它們的檔, 那個字幾乎必然在 ⇒ **那一半形同不存在**
#    ⇒ 只剩「並排」兩個字在守 ⇒ 而它是【日常詞】
# 🔬 **reviewer 的反例我自己複現過, 逐字**:
#    `-- 這支 migration 把 chip 改成並排顯示` + `WHERE status = 'manual_failed'`
#    ⇒ **放行(rc=0)** —— 而那正是這道閘要防的那個世界。
# 🎯 **⇒ 兩個【各自檢查】的片段, 不等於【那一句話】** —— 而它們在輸出上長得一樣。
#
# ✅ **改法:認【一個標記】** —— 用板列的錨。它是本 repo 的既有慣例(同 `RLS-GATE-EXEMPT` 那族),
#    而它**不會因為別的原因出現在一支 migration 裡**。
# ⚠️ **而它擋不住的仍要明說**:一個把錨貼上去而完全沒讀懂那句話的人, 照樣過得了本閘。
#    📌 **本閘驗的是【那個人有沒有被叫來看一眼】, 不是【他看懂了沒】。**
PAIRING_MARK = "⟦b9-REFUNDNUM1⟧"

HINT = """
🔴 **這支 migration 碰到了那兩支【共用同一個邊界】的函式,而檔頭沒有帶那句配對。**

  · pcm_order_refundable_remaining         (主數字)  ⇒ corrected_to = 'money_moved' 才扣
  · pcm_order_pending_manual_verdict_amount(後半句)  ⇒ v.refund_id IS NULL(還沒判)才算

🛑 **改主數字那半 ⇒ 後半句那支【不會紅】** ⇒ 畫面會雙重計算或漏算,
   而客人 / 員工看到的是一句自相矛盾的話。

✅ **要過本閘:在檔頭加上這一句(照抄即可,而【讀一次再抄】)**

-- 🔴 本支碰到 `manual_failed` 那個共用邊界。兩支的判準必須【並排讀一次】:
--    · pcm_order_refundable_remaining          ⇒ corrected_to = 'money_moved' 才扣
--    · pcm_order_pending_manual_verdict_amount ⇒ v.refund_id IS NULL 才算
--    🛑 只改一邊 ⇒ 另一邊不會紅, 而畫面會雙重計算或漏算。板列 ⟦b9-REFUNDNUM1⟧。
--    🔵 (本閘認的就是【⟦b9-REFUNDNUM1⟧ 這個錨】—— 而它在這裡不是裝飾, 是機器讀的那個字。)

🛑 **不要用 `--no-verify` 繞過** —— 那會把【全部】的 pre-commit 一起關掉,
   而那正是這道閘最想避免的事。真的認為本閘誤擋 ⇒ 停下來回報,不要自己繞。
"""


def strip_line_comments(text: str) -> str:
    """把【行首 `--`】那種註解行拿掉。行尾註解刻意保留(見檔頭:往嚴的方向偏)。"""
    return "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("--"))


def check(path: str) -> str | None:
    """回 None = 過;回字串 = 擋下的理由。"""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    code = strip_line_comments(text)
    touched = [f for f in PAIRED_FUNCS if f in code]
    if not touched:
        return None
    if PAIRING_MARK in text:
        return None
    return "碰到:%s" % ", ".join(touched)


def selftest() -> int:
    """四個世界。🔴 而【好世界必須過】那兩格不可少 —— 少了它, 一道恆擋的閘也會全綠。"""
    body_touch = "SELECT pcm_order_refundable_remaining(o.id);\n"
    pairing = "-- 🔴 本支碰到那個共用邊界。兩支的判準必須並排讀一次。板列 ⟦b9-REFUNDNUM1⟧。\n"
    worlds = [
        ("① 碰到而沒帶那個錨        ⇒ 必須擋", body_touch, True),
        ("② 碰到而帶了那個錨        ⇒ 必須過", pairing + body_touch, False),
        ("③ 沒碰到                  ⇒ 必須過", "SELECT 1;\n", False),
        ("④ 只在【行首註解】提到     ⇒ 必須過", "-- 講一下 pcm_order_refundable_remaining\nSELECT 1;\n", False),
        # 🔴🔴 ⑤ 是 code-reviewer 2026-09-08 那條 must-fix 的【反例本身】——
        #    第一版在這一格【放行】, 而那正是本閘要防的世界。
        #    🛑 而它會過的成因是:`manual_failed` 是那兩支函式自己 body 裡就有的字
        #       (20260820100000 含 3 次 / 20260907200000 含 5 次)⇒ 那一半形同不存在。
        ("⑤ 🔴 假配對:manual_failed + 無關的『並排』 ⇒ 必須擋",
         "-- 這支 migration 把 chip 改成並排顯示\n"
         "SELECT * FROM x WHERE status = 'manual_failed';\n" + body_touch, True),
    ]
    bad = []
    with tempfile.TemporaryDirectory() as d:
        for label, content, want_block in worlds:
            p = Path(d) / "t.sql"
            p.write_text(content, encoding="utf-8")
            got = check(str(p))
            blocked = got is not None
            mark = "✅" if blocked == want_block else "🔴"
            print("  %s %s ⇒ 實際%s" % (mark, label, "擋下" if blocked else "放行"))
            if blocked != want_block:
                bad.append(label)
    if bad:
        print("🔴 selftest 失敗:%s" % " / ".join(bad))
        return 1
    # 🔴 這一句寫【動態的數】不寫死「四個世界」——
    #    我加第五格的時候, 那句寫死的話當場變成假話, 而它照樣印綠。
    print("selftest 通過:%d 個世界都表演對了(而②③④ 證明它不是恆擋, ⑤ 是 reviewer 那條 must-fix 的反例)"
          % len(worlds))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--selftest":
        return selftest()
    if not args:
        print("用法:python3 scripts/manual-failed-pairing-gate.py <file.sql> [...]")
        return 2
    blocked = [(a, r) for a in args if (r := check(a)) is not None]
    if not blocked:
        return 0
    print("🔴 manual-failed-pairing-gate 擋下 %d 支:" % len(blocked))
    for a, r in blocked:
        print("   ✗ %s  ── %s" % (a, r))
    print(HINT)
    return 1


if __name__ == "__main__":
    sys.exit(main())
