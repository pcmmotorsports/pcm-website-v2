#!/usr/bin/env python3
"""⟦ship-BROWSERFAMILY⟧ **vitest 跑的**那一族「要起真瀏覽器」的測試 —— 而它【不是手寫清單】。

⚠️ **射程先講(codex R1 must-fix)**:本檔**只收 `*.test.ts` / `*.test.tsx`**,
    **不收 `*.spec.ts`** —— 那 6 支 e2e spec 也 import `@playwright/test`, 而它們
    **根本不由 vitest 跑**:`vitest.config.ts:37` 逐字「Playwright E2E specs 用 @playwright/test
    runner、非 vitest」, 並在每個 project 的 exclude 裡逐字全列。
    ⇒ 📌 **所以「真瀏覽器那一族」這個說法太寬** —— 本檔的分母是
      **「會被 vitest 跑、而且會起真瀏覽器」**。名字沒改, 而射程寫在這裡。

🔴🔴 **為什麼不手寫**(2026-09-06 量到的):
    「檔名含 browser」那把尺數出 **6** 支, 而真的 import 瀏覽器的是 **10** 支
    ⇒ **手寫/照檔名的清單漏 40%**, 而漏掉的那幾支今晚已經害全套紅過兩次
    (`cancel-forms-hydrated` · `page-measure` —— 兩支檔名都沒有 browser)。

🛑🛑 **而【用 grep 當尺】本身就是這一族的坑**:
    grep 對「**提到**它」與「**用**它」是同一件事。
    · 假陽性實例:`statement-pdf-tracing.test.ts` 只在**註解**與**一句斷言字串**裡提到
      `puppeteer-core`(`expect(count(/puppeteer-core/))`), **它從不起瀏覽器**。
    · 假陰性實例:`statement-cascade-browser.test.tsx` import 的是 `@playwright/test`,
      而第一版 pattern 沒有那個字面。
    ⇒ ✅ 所以本檔**先剝掉註解**(⛔ ~~與字串字面~~ —— **那一步已刪**, 理由見 `strip_noise` 上方),
      再用一個**允許跨行**的 regex 找 import。
    ⇒ ✅ 而**準不準不靠我宣稱** —— 下面 `--selftest` 用正/負對照去問。

🛑 **已知會誤判的兩種, 寫下來不藏**(codex R1 實測構造出來的):
    · **假陽性**:一段 template literal 裡放一行長得像 import 的字 ⇒ 會被收進來。
      🔵 **而這個方向是【安全的那一邊】**:多收一支 = 多跑幾秒;少收一支 = **那支從此不在任何入口裡**。
    · **假陰性**:`import {\n  chromium,\n} from '@playwright/test'` 這種**跨行** import ——
      ⛔ 舊版逐行掃描收不到它;✅ 現在的 regex 跨行, 已修。

用法:
    python3 scripts/browser-test-family.py            # 印分母 N 與清單
    python3 scripts/browser-test-family.py --run      # 序列跑這一族(1 worker)
    python3 scripts/browser-test-family.py --selftest # 尺的正負對照
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# 🔴 **`scripts` 不可以少**(R2 must-fix):`vitest.config.ts:135` 的 include 逐字是
#    `{packages,apps,scripts}/**/*.{test,spec}.{ts,tsx}` ⇒ **那底下的測試檔 vitest 是會跑的**。
#    ⚠️ 今天那裡 0 支用瀏覽器 ⇒ 少了它**現在看不出來**, 而它是潛伏的:
#    哪天有人在 `scripts/` 底下寫一支起瀏覽器的測試, **它會落在這個入口之外而沒有人發現**。
#    ⇒ 📌 **分母的範圍要照著【誰會跑它】劃, 不是照著我記得哪幾個目錄。**
ROOTS = ("apps", "packages", "scripts")
PKGS = ("@playwright/test", "playwright", "puppeteer", "puppeteer-core")

# 🔵 正對照:這幾支【必須】在分母裡 —— 它們是檔名就寫著 browser 的那一批,
#    尺壞掉(pattern 打錯 / 剝註解剝過頭)時它們會第一個消失。
# 🔴🔴 **每個【今天真的有人用】的套件各要一支正對照**(codex R1 must-fix):
#    舊版兩支都是 `playwright` ⇒ **把 `@playwright/test` 從 PKGS 拿掉, 分母 10→9 而自測照樣綠**
#    ⇒ 📌 那正是這一片一開始要修的那個病(漏一個套件名), 在守門自己身上復發。
#    當場數(2026-09-06):`playwright` 9 支 · `@playwright/test` 1 支 ·
#    `puppeteer` 0 · `puppeteer-core` 0。
#    ⚠️ **後兩個今天【零檔在用】⇒ 它們在 PKGS 裡是【未被驗證的】** —— 留著是為了將來,
#      而**沒有任何一格在證明它們寫對了**。這句話就是那個缺口的落點。
POSITIVE = (
    "cancel-forms-browser.test.tsx",  # 用 playwright
    "print-doc-cascade-browser.test.tsx",  # 用 playwright
    "statement-cascade-browser.test.tsx",  # 🔴 用 @playwright/test —— 少了它, 拿掉那個套件名沒人會叫
    # 🔴🔴 **這一支的檔名【沒有】browser, 而那正是它在這裡的理由**(R2 must-fix):
    #    上面三支都是 `*-browser.test.tsx` ⇒ 尺若退化成「照檔名撈」, **三格照樣全綠**,
    #    而分母 10 支裡**有 4 支檔名不含 browser** —— 那 4 支正是這一整片存在的理由。
    #    ⇒ 📌 **正對照要涵蓋【那個會出錯的維度】, 不是涵蓋最多的那個維度。**
    "cancel-forms-hydrated.test.tsx",
)
# 🔴 負對照:這一支【必須不在】 —— 它只在註解與斷言字串裡提到 puppeteer-core。
#    少了這一格, 「剝掉註解與字串」這件事**沒有任何東西在驗**。
NEGATIVE = "statement-pdf-tracing.test.ts"

_BLOCK = re.compile(r"/\*.*?\*/", re.S)
_LINE = re.compile(r"^\s*//.*$", re.M)

# ⛔ ~~還有一條剝【字串字面】的 regex `(['"`])(?:\\.|(?!\1).)*\1`~~ —— **已刪, 而理由是實測**:
#    它在這個 repo 上**跑不完**(2026-09-06 兩次各等 120s / 300s 都沒回來)。
#    🔬 成因:那個形狀是典型的**災難性回溯** —— CJK 註解裡一個落單的 `'` 或 `` ` ``
#    就讓引擎掃到檔尾再整段回頭, 而本 repo 的註解幾乎全是中文。
# 🟢 **而拿掉它【不會】讓負對照失效** —— 因為真正擋住假陽性的是下面那個
#    「這一行必須 **以 `import ` 開頭**」的條件:
#    `statement-pdf-tracing.test.ts` 提到 puppeteer 的兩處是**註解**與
#    `expect(count(/puppeteer-core/))`, **兩處都不是以 `import ` 開頭的行** ⇒ 它本來就進不來。
#    ⇒ 📌 那一格負對照現在守的是**這個推論**, 不是那條 regex。它仍然是活的。


def strip_noise(src: str) -> str:
    """剝掉區塊註解與行註解(**不剝字串** —— 理由見上面那段)。"""
    return _LINE.sub("", _BLOCK.sub("", src))


_IMPORT_PKG = re.compile(
    r"(?:^|\n)\s*import\b[^;]*?\bfrom\s*['\"]({})['\"]".format(
        "|".join(re.escape(p) for p in PKGS)
    ),
    re.S,
)


def uses_browser(path: Path) -> bool:
    """這支檔是不是【真的 import】了瀏覽器套件(不是提到它)。

    🔴 **跨行 import 要收得到**(codex R1 must-fix):
       `import {\n  chromium,\n} from '@playwright/test';` 這種寫法, 逐行掃描**收不到**
       ⇒ 那是**假陰性**, 而假陰性的代價是「那支檔從此不在任何入口裡」。
       ⇒ ✅ 改成對【剝過註解的整份原始碼】跑一個 `re.S` 的 regex。
    """
    src = path.read_text(encoding="utf-8", errors="replace")
    return _IMPORT_PKG.search(strip_noise(src)) is not None


def family() -> list[str]:
    """走檔案樹找這一族。

    🔴 **`rglob` 不能用** —— 它會**先走進 `node_modules` 再輪到我的過濾**,
       而那棵樹大到讓這支腳本跑不完(2026-09-06 實測:120 秒沒回來)。
       ⇒ 📌 **「先收集再過濾」與「走的時候就剪掉」在結果上一樣, 在能不能跑完上不一樣。**
       ⇒ ✅ 用 `os.walk` 並**當場把 `node_modules` 從 `dirnames` 裡拿掉**(那才會真的不進去)。
    """
    import os

    out: list[str] = []
    for r in ROOTS:
        for dirpath, dirnames, filenames in os.walk(ROOT / r):
            dirnames[:] = [d for d in dirnames if d != "node_modules" and not d.startswith(".")]
            for fn in filenames:
                if not (fn.endswith(".test.ts") or fn.endswith(".test.tsx")):
                    continue
                p = Path(dirpath) / fn
                if uses_browser(p):
                    out.append(str(p.relative_to(ROOT)))
    return sorted(out)


def selftest() -> int:
    fam = family()
    bad = 0
    print(f"分母 N = {len(fam)}")
    if len(fam) == 0:
        print("❌ 分母是 0 —— 尺壞了或路徑錯, 而 0 會讓 --run 什麼都不跑而 rc=0")
        bad += 1
    for name in POSITIVE:
        if not any(f.endswith(name) for f in fam):
            print(f"❌ 正對照不見了:{name} 應該在分母裡")
            bad += 1
    if any(f.endswith(NEGATIVE) for f in fam):
        print(f"❌ 負對照命中:{NEGATIVE} 只在註解與字串裡提到瀏覽器套件, 不該在分母裡"
              " ⇒ 剝註解/字串那一步沒生效")
        bad += 1
    print("✅ selftest 通過" if bad == 0 else f"❌ selftest 有 {bad} 格紅")
    return 1 if bad else 0


def split_check() -> int:
    """⟦ship-BROWSERFAMILY⟧ **b 的三道自檢 —— 而它們是 b 能不能接線的【前置】, 不是 b 本身。**

    🛑🛑 **b 的失敗形狀是【少一批綠】, 不是多一個紅**:
       收割鏈若改成「全套排除這族 + 這族序列跑一發」, **排除清單漏一支 ⇒ 它從此不在任何一段裡
       ⇒ 永遠不跑, 而兩段都是綠的。**
       ⇒ 📌 本 repo 記過:**少一批綠比多一個紅難發現**(整支檔載不起來時 `Tests` 那行只是少算)。
    ⇒ ✅ 所以主視窗 `-f8` 裁:**先寫這三道自檢、不動收割鏈**;三道綠了才談接線。
    """
    fam = family()
    bad = 0

    # ── ① 兩段檔數和 == 全套檔數 ──────────────────────────────────
    # 🔴 這一道是**唯一**擋得住「漏一支 ⇒ 它從此不在任何一段」的東西。
    #    ⚠️ 而它現在只能**靜態**地問(b 還沒接線, 沒有「兩段」可以數)⇒ 本格問的是它的**前提**:
    #    「全套會跑的檔」這個分母算不算得出來, 且這一族是它的**子集**。
    #    ⇒ 📌 分母算不出來的話, ①在 b 接線那天也不會算得出來 —— 那才是現在要知道的事。
    all_tests = []
    for r in ROOTS:
        import os as _os
        for dirpath, dirnames, filenames in _os.walk(ROOT / r):
            dirnames[:] = [d for d in dirnames if d != "node_modules" and not d.startswith(".")]
            for fn in filenames:
                if fn.endswith(".test.ts") or fn.endswith(".test.tsx"):
                    all_tests.append(str((Path(dirpath) / fn).relative_to(ROOT)))
    all_tests = sorted(all_tests)
    rest = [f for f in all_tests if f not in set(fam)]
    print(f"① 全套 {len(all_tests)} 支 = 這族 {len(fam)} + 其餘 {len(rest)}", end="  ")
    if len(fam) + len(rest) != len(all_tests):
        print("❌ 加不起來"); bad += 1
    elif not set(fam) <= set(all_tests):
        print("❌ 這族不是全套的子集 ⇒ 排除清單會排掉不存在的東西"); bad += 1
    else:
        print("✅")

    # ── ② 清單裡每一支都要真的在磁碟上 ────────────────────────────
    # 🔴 檔案改名時:排除那一段會「排除一個不存在的檔」(**安全**方向, 它會回到全套),
    #    而序列那一段會**少跑它**(**不安全**方向)⇒ 兩段都要各自對清單做這一格。
    missing = [f for f in fam if not (ROOT / f).exists()]
    print(f"② 清單 {len(fam)} 支逐支 test -f", end="  ")
    if missing:
        print(f"❌ {len(missing)} 支不存在:{missing}"); bad += 1
    else:
        print("✅")

    # ── ③ 對全 repo 重算尺 A, 必須逐字等於清單 ───────────────────
    # 🔴 **少了這一格, 這條路會隨時間安靜失效**:新加一支瀏覽器測試而忘了進清單 ⇒ 沒有人會叫。
    # ⚠️ **而本格今天的判別力有限, 誠實寫下來**:清單就是尺 A 現算出來的 ⇒ 兩邊同源。
    #    它真正擋得住的是「**有人把清單改成寫死的**」那一天 —— 那時這一格會紅。
    recomputed = family()
    print(f"③ 重算尺 A 逐字比({len(recomputed)} vs {len(fam)})", end="  ")
    if recomputed != fam:
        only_a = [f for f in recomputed if f not in fam]
        only_b = [f for f in fam if f not in recomputed]
        print(f"❌ 不一致 ⇒ 只在重算 {only_a} · 只在清單 {only_b}"); bad += 1
    else:
        print("✅(⚠️ 同源 ⇒ 它擋的是【清單被改成寫死】那一天)")

    print("✅ 三道自檢通過" if bad == 0 else f"❌ 三道自檢有 {bad} 道紅")
    return 1 if bad else 0


def main() -> int:
    argv = sys.argv[1:]
    # 🔴🔴 **嚴格解析參數**(codex R1 must-fix):舊版是 `if "--run" in argv`
    #    ⇒ `--rn` 打錯字會**靜靜地只印清單然後 rc=0**, 而人以為它跑了;
    #      `--run --selftest` 也只跑自測就 rc=0。
    #    ⇒ 📌 **一個「拼錯就變成別的動作而且成功」的入口, 比沒有入口糟。**
    known = {"--run", "--selftest", "--split-check"}
    # 🔴🔴 **lint-staged 會把 staged 檔的路徑【接在命令後面】**(R2 must-fix, 我當場重現):
    #    `python3 scripts/browser-test-family.py --selftest scripts/browser-test-family.py`
    #    ⇒ 舊版嚴格解析把它當「不認得的參數」⇒ **rc=2 ⇒ 這一片自己的 commit 會被自己擋下來。**
    #    ⇒ 📌 **我在 R1 補的那道「拼錯要擋」, 在 R2 變成一個把自己鎖在門外的閘** ——
    #      補洞造洞, 而兩次都是真的洞。
    # ✅ 修法:**忽略「看起來是檔案路徑」的位置參數**(lint-staged 就是這樣傳的),
    #    而**仍然擋掉不認得的【旗標】**(`-` 開頭)—— 那才是「拼錯」的形狀。
    flags = [a for a in argv if a.startswith("-")]
    unknown = [a for a in flags if a not in known]
    if unknown:
        print(f"❌ 不認得的旗標:{' '.join(unknown)} —— 只吃 --run / --selftest / --split-check")
        return 2
    # 🔴 **只准下一個動作旗標** —— 舊版只擋 run+selftest 那一組;多一個 `--split-check` 之後,
    #    「兩個一起下」的組合從 1 種變 3 種 ⇒ 改成**數動作旗標**, 而不是逐組列舉。
    #    📌 逐組列舉的擋法, 在選項變多的那一天會**安靜地漏掉新的那幾組**。
    actions = [f for f in flags if f in known]
    if len(set(actions)) > 1:
        print(f"❌ 一次只能下一個動作:{' '.join(sorted(set(actions)))}")
        return 2
    argv = flags
    if "--split-check" in argv:
        return split_check()
    if "--selftest" in argv:
        return selftest()

    fam = family()
    # 🔴 **第一行就印分母與清單** —— 鐵則 11 的第四個數(我餵幾支)要看得見。
    print(f"⟦ship-BROWSERFAMILY⟧ 分母 N = {len(fam)}")
    for f in fam:
        print(f"  {f}")
    if "--run" not in argv:
        return 0
    if not fam:
        print("❌ 分母是 0 ⇒ 拒絕跑(跑了會 rc=0 而什麼都沒驗)")
        return 1

    # 🔴🔴 **不直接叫 vitest, 走既有的 `scripts/vitest-ran-gate.sh`**(codex R1 must-fix):
    #    直接叫的話, **全部 skipped 也是 rc=0** ⇒ 這個入口會用一個成功的 rc 說「跑過了」。
    #    ⇒ 📌 那道閘存在的理由逐字就是「讓【vitest 根本沒跑到】這件事自己會叫」——
    #      **既有的機制不要再造一個。**
    # ⚠️ **`--no-file-parallelism` 只序列化到【檔】那一層**(vitest 4 官方字面)——
    #    同一支檔裡若有 `test.concurrent`, 它們**仍然平行**。
    #    ⇒ 📌 所以本入口的宣稱是「**檔與檔之間**序列」, 不是「整族序列」。
    cmd = [
        "sh", "scripts/vitest-ran-gate.sh",
        "run", "--no-file-parallelism",
        *fam,
    ]
    print("$ " + " ".join(cmd))
    proc = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    sys.stdout.write(proc.stdout)
    sys.stderr.write(proc.stderr)
    if proc.returncode != 0:
        return proc.returncode

    # 🔴🔴 **鐵則 11 的第四個數要【比】, 不是只印前半**(R2 must-fix)。
    #    舊版只印了「我餵幾支」⇒ 而一支 family 檔若落進 vitest 的 exclude,
    #    **餵 10 跑 9 會全綠 rc=0** —— 那不是少一個紅, 是**少一批綠**(本 repo 記過)。
    #    ⇒ ✅ 從 vitest 自己的 summary 把「它跑了幾支」撈出來, 與 `len(fam)` 對。
    plain = re.sub(r"\x1b\[[0-9;:]*m", "", proc.stdout + proc.stderr)
    m = re.search(r"^\s*Test Files\s+.*?\((\d+)\)\s*$", plain, re.M)
    if m is None:
        print("❌ 讀不到 vitest 的 `Test Files … (N)` 那一行 ⇒ 比不了「我餵幾支 vs 它跑幾支」"
              " ⇒ 拒絕回 0(那個 0 會是一句沒有根據的成功)")
        return 1
    ran = int(m.group(1))
    if ran != len(fam):
        print(f"❌ 我餵 {len(fam)} 支, 而 vitest 只跑了 {ran} 支 ——"
              " 差的那幾支【不會紅, 它們只是不存在】(最常見的成因:落進 vitest 的 exclude)")
        return 1
    print(f"✅ 我餵 {len(fam)} 支 ⇒ vitest 跑 {ran} 支(第四個數對上)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
