#!/usr/bin/env python3
"""cron **live** 漂移檢查 —— 拿【正式庫的 `cron.job`】去比 repo 那兩個集合。

## 這一支補的是哪一半

`scripts/cron-allowlist-drift-gate.py` 已經在守 repo 這一半(白名單 vs migrations),
而**它的 docstring 自己點名了缺口**,逐字:

> 🛑 **直接在 Supabase SQL Editor 手排、完全不進 repo 的那一種, 本閘看不到。**
>   那要拿正式庫的 `cron.job` 去比 —— 需要對正式庫的存取, 是另一件事、另一道閘。

⇒ 📌 **一個被作者寫下來、而沒有人接的缺口** —— 本支就是那道閘。
🔵 板列 `⟦b4-CRONWL1⟧`(703)· `⟦f3-ALLOWLISTMANUAL1⟧`(694)。

## 🔴 三種結局, 而第三種是這支腳本存在的理由

🔵 **今晚 A 判【只報不擋 ⇒ rc 恆 0】**, 理由:**它今天沒有基線** —— 第一次跑出來的差集,
   **分不出「真的漂了」與「我們的白名單本來就記漏了」。**
✅ **升級條件(寫在這裡, 不留給下一個人判)**:**連續跑過三天、三次都相等 ⇒ 才有資格擋(改成 rc 非 0)。**
✅✅ **[2026-09-07 · A 裁決落地 —— 觀察在跑了]**
   · **掛在 `scripts/harvest-chain.sh`**(`fw-live` 隔壁), **只報不擋**(在 `REPORT_ONLY` 名單裡)。
   · 🔴 **每次的讀數 append 到 `~/pcm-mailbox/cron-live-觀察.tsv`**(一行 = 時間 + 讀數 + `origin/dev` hash)。
     **沒有留讀數,「三天三次相等」永遠不會累積** —— 掛了還是沒有人在觀察。
   · 🔬 **「只報不擋」是量到的**:把本閘餵 rc≠0 給鏈的 `verdict` ⇒ **仍回 0(放行)**;
     🔴 **反向**:把 `cronlive` 從 `REPORT_ONLY` 拿掉再餵同一個 rc ⇒ **回 3(擋)**
     ⇒ 📌 那個「不擋」**真的來自它在名單裡**, 不是來自別的東西。鏈自檢 **47 PASS / 0 FAIL**。
⛔ ~~**而那個升級條件今天【沒有家】—— 這一行不要刪:**~~ **(已作廢, 見上;下面留著是為了記住當時缺什麼)**
   本支登記進 `package.json` 的是 **`--selftest`**(刻意的:本支會打正式庫, **不可以每次 commit 都連線**)
   ⇒ **CI 與 pre-commit 都【不會】跑 live 那一段。**
   ⇒ 📌 **live 檢查目前不在任何自動流程裡 ⇒ 「三天三次相等」要有人【手動】跑三次才會累積,**
     **而目前沒有指定人。**
   🛑 **⇒ 不要把「還在觀察期」讀成「有人在觀察」。**
   🎯 同形狀:`⟦mail-BACKOFFDIESSOONER⟧` —— **要觀察的是那個數的前後變化, 而今天沒有人在看那個數。**
   🔵 要不要掛進夜跑或哨兵, **由 A 判**(2026-09-07 已轉;本支作者不自己掛)。

🛑 **而 `rc 恆 0` 有一個代價**:三態就只剩【文字】, 而文字最容易在兩個地方消失 ——
   **摘要行只印 rc、或有人只 `grep` 關鍵字。**
✅ **⇒ 三種結果印在【同一個位置的同一行】, 格式一致、字首可辨**:
```
🟢 三邊相等   live 9 / 白名單 9 / migrations 9
🟡 差集 N     live 多 X 支 … / 白名單多 Y 支 …
🟡 未量       連不上 / 權限不足:<原因>
```
🛑 **不可以一種印在開頭、一種印在結尾** —— 那樣「未量」會被讀成「沒印差集 = 沒事」。
📌 **⇒ 本支的價值全在【三態分得開】;rc 幫不了你的時候, 版面就是那把尺。**
🛑 **rc=2 不可以被寫成綠**:一支去查正式庫的腳本, 它的**沉默會被讀成「沒有漂移」**。
🛑 **也不可以被寫成紅**:**「有漂移」與「我沒看到」是兩個結論** —— 落進紅會讓人去找一個不存在的漂移。

## 🔴 差集印【兩個方向】, 不是印相等

```
live 有而白名單沒有  ⇒ 有人在 SQL Editor 手排, 而沒有人在看它死活   ← 本族的原病
白名單有而 live 沒有  ⇒ 排程被刪掉了, 而白名單還以為它在
```
📌 **只印一個方向的話,「有人偷偷刪掉一個 cron」你看不見。**

## ⚠️ 它答不出什麼

· **唯讀** —— 這支不 apply 任何東西(唯讀與 apply 是兩個授權, 而 Sean 只給了唯讀)。
· **不印連線字串** —— 全部交給 `scripts/readonly-prod-sql.sh`,本支只讀它的 stdout。
· 它比的是**名字的集合**, 答不出「排程長得對不對」(schedule 字面、command 內容都不看)。
· 🔴 **基線不寫死**:先前板上那個「正式庫 9 條」是**一次手動量測**, 不是閘。
  本支**當場查、當場比, 三個數都印出來**。
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
SIBLING = HERE / "cron-allowlist-drift-gate.py"
RUNNER = HERE / "readonly-prod-sql.sh"

# 🔴 **複用既有那支的解析, 不自己再寫一份** —— 兩份解析會漂, 而漂的那天沒有人會發現
#    (那正是 `feedback_fixing-the-artifact-not-the-generator` 講的:修產物不修產生器)。
#    ⚠️ 檔名有 `-` ⇒ 不能 `import`, 走 importlib。
def _load_sibling():
    spec = importlib.util.spec_from_file_location("cron_allowlist_drift_gate", SIBLING)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"載不進 {SIBLING}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


LIVE_SQL = r"""\pset format unaligned
\pset tuples_only on
\set ON_ERROR_STOP on
SELECT '<<JOB>>' || jobname FROM cron.job ORDER BY jobname;
SELECT '<<COUNT>>' || count(*) FROM cron.job;
"""


def read_live() -> tuple[set[str], str | None]:
    """回 (live 的 jobname 集合, 失敗原因)。**失敗一律回原因字串, 不回空集合。**

    🔴 這裡是 rc=2 的來源:回空集合會讓呼叫端把「查不到」讀成「一條都沒有」。
    """
    with tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8") as fh:
        fh.write(LIVE_SQL)
        path = fh.name
    try:
        p = subprocess.run(["bash", str(RUNNER), path], capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return set(), "唯讀查詢逾時(120s)"
    finally:
        Path(path).unlink(missing_ok=True)
    out = p.stdout
    # 🔴 **不把 stderr 原文印出來** —— 它可能含連線字串。只回一句人話。
    if p.returncode != 0:
        return set(), f"唯讀查詢 rc={p.returncode}(可能是連不上 / 權限不足;stderr 不印, 它可能含連線字串)"
    if "<<COUNT>>" not in out:
        return set(), "唯讀查詢回了東西, 而裡面沒有 <<COUNT>> ⇒ 查詢沒跑完(不是「零條」)"
    names = {ln[len("<<JOB>>"):].strip() for ln in out.splitlines() if ln.startswith("<<JOB>>")}
    declared = next(
        (int(ln[len("<<COUNT>>"):].strip()) for ln in out.splitlines() if ln.startswith("<<COUNT>>")),
        None,
    )
    # 🔴 **鐵則 11 的第四個數**:我撈到幾個名字 vs 它自己說有幾條。對不上 ⇒ 那是【沒量到】不是【零】。
    if declared is None or declared != len(names):
        return set(), f"撈到 {len(names)} 個名字, 而 cron.job 自己說有 {declared} 條 ⇒ 對不上, 判未量"
    return names, None


def report(live: set[str], why: str | None, allow: set[str], mig: set[str]) -> str:
    """把三態印出來, 並回一個【機器可判的態字】。**純函式 —— 不連任何東西。**

    🔴 抽成純函式的理由:`--selftest` 必須能在**連不上正式庫的機器上**證明三態分得開。
       若自檢自己要連線, 那它就與被測的東西共用同一個失敗模式 ⇒ 它答不出「三態分不分得開」。
    """
    if why is not None:
        print(f"🟡 未量       {why}")
        print("   🛑 這【不是】「沒有漂移」——「有漂移」與「我沒看到」是兩個結論, 本支不把後者說成前者。")
        return "未量"

    live_only = sorted(live - allow)
    allow_only = sorted(allow - live)
    counts = f"live {len(live)} / 白名單 {len(allow)} / migrations {len(mig)}"

    if not live_only and not allow_only:
        print(f"🟢 三邊相等   {counts}")
        print("   🔵 三個數都當場查 —— 基線不寫死(板上那個「9」是一次手動量測, 不是閘)。")
        return "相等"

    parts = []
    if live_only:
        parts.append(f"live 多 {len(live_only)} 支 {'/'.join(live_only)}")
    if allow_only:
        parts.append(f"白名單多 {len(allow_only)} 支 {'/'.join(allow_only)}")
    print(f"🟡 差集 {len(live_only) + len(allow_only)}     {' · '.join(parts)}   ({counts})")
    if live_only:
        print(f"   ① live 有而白名單沒有 ⇒ **有人手排而沒有人在看它死活**({len(live_only)} 條)")
        for n in live_only:
            print(f"      + {n}")
    if allow_only:
        print(f"   ② 白名單有而 live 沒有 ⇒ **排程被刪掉了, 而白名單還以為它在**({len(allow_only)} 條)")
        print("      🔴 **少一條排程比多一條安靜** —— 沒有人會因為少了一條而收到任何東西。")
        for n in allow_only:
            print(f"      − {n}")
    print("   🛑 修法不是把白名單改成跟 live 一樣 —— 先開檔判那條該不該在。")
    return "差集"


def selftest() -> int:
    """四個世界, 而每一格問的是【態字對不對】—— 不是「有沒有印東西」。"""
    A, B, C = {"a", "b"}, {"a", "b"}, {"a", "b"}
    cases = [
        ("① 三邊相等 ⇒ 相等", (A, None, B, C), "相等"),
        ("② live 多一支(有人手排)⇒ 差集", ({"a", "b", "x"}, None, B, C), "差集"),
        ("③ 白名單多一支(排程被刪)⇒ 差集", (A, None, {"a", "b", "y"}, C), "差集"),
        ("④ 連不上 ⇒ 未量(不准落進相等, 也不准落進差集)", (set(), "連不上", B, C), "未量"),
        ("⑤ 🔴 負對照:空 live + 沒有 why ⇒ 【差集】不是【未量】", (set(), None, B, C), "差集"),
    ]
    fails = []
    for name, args, want in cases:
        got = report(*args)
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name} ⇒ 得到「{got}」(期望「{want}」)')
        if not ok:
            fails.append(name)
    print(f"── selftest {'PASS' if not fails else 'FAIL'}({len(cases) - len(fails)}/{len(cases)})")
    return 1 if fails else 0


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    mod = _load_sibling()
    live, why = read_live()
    if why is not None:
        report(live, why, set(), set())
        return 0  # 只報不擋(A 2026-09-07);升級條件見檔頭
    ts, files = mod.read_worktree()
    report(live, None, mod.allowlist_names(ts), mod.migration_names(files))
    return 0  # 只報不擋(A 2026-09-07);升級條件見檔頭


if __name__ == "__main__":
    sys.exit(main())
