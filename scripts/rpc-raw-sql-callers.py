#!/usr/bin/env python3
"""rpc-raw-sql-callers — 「用【裸 SQL 字面】呼叫、而那個物件還沒 apply」的交集。

## 為什麼有這支檔(⟦b9-RPCBLIND1⟧)

`scripts/deploy-order-gate.sh` 的偵測窗口錨在 **`.rpc(` 那一行 + 後兩行**
(該檔 `:68` 逐字「窗口只開到 `.rpc(` 之後兩行」)。
⇒ 🔴 **`client.query('SELECT public.X(...)')` 這種【裸 SQL】呼叫,它一個都看不到。**

板列 `⟦b9-RPCBLIND1⟧` 2026-08-31 量到:`SELECT public.<fn>` 引到的函式 **52** 支,
其中從未被 `.rpc('<fn>'` 呼叫過(= 對那道閘隱形)**40** 支,而在出貨碼真的有呼叫點的 **25** 支
—— 🔴 **幾乎全在 `packages/adapters/src/payment/`**。

🛑🛑 **而本支【刻意不掛任何 hook】,那不是省事,是一條具名的裁定**:
   板列證據欄逐字「**只量,沒有修**(`-48` 明令:**修 deploy 閘的爆炸半徑是所有人的 push**)」。
   ⇒ 那道閘一壞,全隊每一次 push 都受影響,而**發現它的人不是改它的人**。
   ⇒ 📌 **所以本支只【印】,不擋任何東西。要不要掛上 pre-push,等 `-48` 或 Sean。**

## 🔴 它答不出什麼(先講,不要拿它當它不是的東西)

* **它不證「那支 migration 沒貼」** —— 它只證「**那個版本號不在 `APPLIED.tsv` 的版本欄**」。
  而 `APPLIED.tsv` 檔頭逐字寫著「不在本表上**什麼都不代表**」⇒ 本支的輸出是【候選】不是【缺陷】。
* **它不看 `CREATE OR REPLACE`** —— 一支只改函式體的 migration,它的物件早就存在;
  本支對那一種**印同一個結果**,而那個結果沒有判別力。
* **它只認【字面】** —— 動態組出來的函式名(`format()` / 變數拼接)它看不到。
* 🔴 **它與 `deploy-order-gate.sh` 【不重疊也不取代】**:那道閘看 `.rpc(`,本支看裸 SQL。
  ⇒ **兩支都跑過,才等於「兩種呼叫形狀都看過」。**

## 🟢 這把尺會不會動(2026-09-05 首次落地當天量的,兩個對照)

首跑印 **交集 0**。而 **0 是最需要對照的那一種讀數**,所以兩邊都做了:

* **合成對照(`--selftest`,5 PASS)**:拋棄式 repo 裡種一支裸 SQL 呼叫未 apply 函式的假檔 ⇒ **紅**;
  同名只出現在註解裡 ⇒ **綠**;呼叫端在測試檔 ⇒ **綠**;那支已記進帳本 ⇒ **綠**。
* 🔴 **真 repo 對照(比合成的有力)**:拿 **`a437d07ae^`** 那一版 `APPLIED.tsv`(= 我補記那兩列**之前**)
  對**同一份碼**重跑 ⇒ **交集 2**,逐字:
  ```
  20260904050000  fn  begin_charge_attempt   @ packages/adapters/src/payment/PgChargeAttemptAdapter.ts
  20260904240000  fn  get_search_log_health  @ packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts
  ```
  ⇒ 📌 **今天的 0 是【真的 0】,而它之所以是 0,正是因為那兩列在半小時前被記進帳本。**
  ⇒ 🛑 **而那不代表「以後都會是 0」** —— 它是一個隨每一次 commit 改變的狀態,不是一個性質。

⚠️ **首跑的另外兩個數也要一起看**:帶物件定義的 migration **218** 支 · 出貨碼被裸 SQL 引到的物件 **40** 個
   ⇒ **兩個輸入都不是空的** ⇒ 那個 0 不是「尺沒接上」。
"""

from __future__ import annotations

import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG_DIR = os.path.join(REPO, "supabase", "migrations")
LEDGER = os.path.join(REPO, "supabase", "APPLIED.tsv")

# 🔴 只認【裸 SQL】那三種形狀 —— `.rpc(` 那一種是 deploy-order-gate 的守備範圍,本支不碰。
PAT_FN = re.compile(r"\bpublic\.([a-z_][a-z_0-9]*)\s*\(")
PAT_VIEW = re.compile(r"\b(?:FROM|JOIN)\s+public\.([a-z_][a-z_0-9]*)", re.IGNORECASE)

DEF_FN = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z_0-9]*)", re.IGNORECASE
)
DEF_VIEW = re.compile(
    r"CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z_0-9]*)",
    re.IGNORECASE,
)


def strip_comments(src: str) -> str:
    """剝掉 `//`、`/* */` 與 `--` 註解。

    🔴 **為什麼一定要剝**:註解最會講那件事。不剝的話「這裡呼叫了 public.foo()」這種
    說明文字會被當成呼叫點 ⇒ 本支的負對照就是在釘這一格。
    """
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"^\s*//.*$", " ", src, flags=re.M)
    src = re.sub(r"^\s*--.*$", " ", src, flags=re.M)
    return src


def applied_versions() -> set[str]:
    """讀 `APPLIED.tsv` 的【版本欄】。

    🔴 **解析欄位, 不整行 grep** —— 整行 grep 會被第 4 欄的自由文字命中
    (那一欄常常引用別支的版本號)⇒ 一支沒記的會被讀成有記。
    (2026-09-05 線 `-1d` 當晚踩過。)
    """
    out: set[str] = set()
    if not os.path.exists(LEDGER):
        return out
    with open(LEDGER, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            cols = line.rstrip("\n").split("\t")
            if cols and re.fullmatch(r"\d{14}", cols[0]):
                out.add(cols[0])
    return out


def migration_objects() -> dict[str, list[tuple[str, str]]]:
    """版本號 ⇒ [(kind, name)]。"""
    res: dict[str, list[tuple[str, str]]] = {}
    if not os.path.isdir(MIG_DIR):
        return res
    for fn in sorted(os.listdir(MIG_DIR)):
        if not fn.endswith(".sql"):
            continue
        ver = fn[:14]
        if not re.fullmatch(r"\d{14}", ver):
            continue
        with open(os.path.join(MIG_DIR, fn), encoding="utf-8", errors="replace") as fh:
            src = strip_comments(fh.read())
        objs = [("fn", m.group(1)) for m in DEF_FN.finditer(src)]
        objs += [("view", m.group(1)) for m in DEF_VIEW.finditer(src)]
        if objs:
            res[ver] = sorted(set(objs))
    return res


def source_files(root: str) -> list[str]:
    """出貨碼:`apps` / `packages` 底下的 `.ts` / `.tsx`,**排除測試與產生的型別檔**。

    🔴 `database.types.ts` 一定要排除 —— 它是**產生出來的**,函式名出現在那裡
    只代表 schema 有它,**不代表有碼在呼叫**(板列 `⟦b9-RPCBLIND1⟧` 逐字:
    「25 是把 `database.types.ts` 剝掉之後的數 —— 不剝是 29」)。
    """
    try:
        out = subprocess.run(
            ["git", "-C", root, "ls-files", "apps", "packages"],
            capture_output=True, text=True, check=True,
        ).stdout.split("\n")
    except Exception:
        return []
    keep = []
    for f in out:
        if not f.endswith((".ts", ".tsx")):
            continue
        if ".test." in f or ".spec." in f or "/__tests__/" in f:
            continue
        if f.endswith("database.types.ts"):
            continue
        keep.append(os.path.join(root, f))
    return keep


def raw_callers(files: list[str]) -> dict[str, list[str]]:
    """物件名 ⇒ 呼叫它的檔案清單(裸 SQL 字面)。"""
    hits: dict[str, list[str]] = {}
    for path in files:
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                src = strip_comments(fh.read())
        except OSError:
            continue
        for m in list(PAT_FN.finditer(src)) + list(PAT_VIEW.finditer(src)):
            hits.setdefault(m.group(1), []).append(path)
    return hits


def scan(root: str) -> tuple[list[tuple[str, str, str, str]], int, int]:
    applied = applied_versions()
    defs = migration_objects()
    callers = raw_callers(source_files(root))
    rows: list[tuple[str, str, str, str]] = []
    for ver, objs in sorted(defs.items()):
        if ver in applied:
            continue
        for kind, name in objs:
            if name in callers:
                rows.append((ver, kind, name, os.path.relpath(callers[name][0], root)))
    return rows, len(defs), len(callers)


def selftest() -> int:
    """🔴 第一件事:剝掉繼承來的 git 環境。

    `git -C` **擋不住** `GIT_DIR` / `GIT_INDEX_FILE` 那幾個 —— 它們會讓拋棄式 repo
    的 `ls-files` 讀到**本 repo 的 index**(`.husky/selftest-git-isolation-gate.sh` 釘的就是這一格)。
    """
    for var in (
        "GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_COMMON_DIR", "GIT_NAMESPACE",
    ):
        os.environ.pop(var, None)

    import shutil
    import tempfile

    tmp = tempfile.mkdtemp(prefix="rpc-raw-selftest-")
    passed = failed = 0

    def check(label: str, got, want) -> None:
        nonlocal passed, failed
        if got == want:
            passed += 1
        else:
            failed += 1
            print(f"  🔴 {label}: 得 {got!r} 期望 {want!r}")

    try:
        subprocess.run(["git", "init", "-q", tmp], check=True)
        os.makedirs(os.path.join(tmp, "supabase", "migrations"))
        os.makedirs(os.path.join(tmp, "apps", "x", "src"))
        with open(os.path.join(tmp, "supabase", "migrations",
                               "20990101000000_selftest.sql"), "w", encoding="utf-8") as fh:
            fh.write("CREATE FUNCTION public.zzq_selftest_fn() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;\n")
        with open(os.path.join(tmp, "supabase", "APPLIED.tsv"), "w", encoding="utf-8") as fh:
            # 🔵 第 4 欄【故意】提到那個版本號 —— 釘住「解析欄位而不是整行 grep」。
            fh.write("# 標頭\n20260101000000\tdeadbeef\t2026-01-01\t備註裡提到 20990101000000 這個版本號\n")

        # ── 🟢 正對照:裸 SQL 呼叫一支【未 apply】的函式 ⇒ 必須紅 ──
        with open(os.path.join(tmp, "apps", "x", "src", "caller.ts"), "w", encoding="utf-8") as fh:
            fh.write("export const q = () => client.query('SELECT public.zzq_selftest_fn()');\n")
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        global MIG_DIR, LEDGER
        MIG_DIR = os.path.join(tmp, "supabase", "migrations")
        LEDGER = os.path.join(tmp, "supabase", "APPLIED.tsv")
        rows, _, _ = scan(tmp)
        check("正對照 裸 SQL 呼叫未 apply 的函式 ⇒ 交集 1", len(rows), 1)
        if rows:
            check("正對照 抓到的是那支", rows[0][2], "zzq_selftest_fn")

        # ── 🔵 負對照①:同一個名字【只出現在註解裡】⇒ 必須綠 ──
        with open(os.path.join(tmp, "apps", "x", "src", "caller.ts"), "w", encoding="utf-8") as fh:
            fh.write("// 這裡以前呼叫 public.zzq_selftest_fn() ,現在不呼叫了\nexport const q = 1;\n")
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rows, _, _ = scan(tmp)
        check("負對照① 只在註解裡提到 ⇒ 交集 0", len(rows), 0)

        # ── 🔵 負對照②:呼叫端在【測試檔】⇒ 不算出貨碼 ⇒ 必須綠 ──
        os.remove(os.path.join(tmp, "apps", "x", "src", "caller.ts"))
        with open(os.path.join(tmp, "apps", "x", "src", "caller.test.ts"), "w", encoding="utf-8") as fh:
            fh.write("client.query('SELECT public.zzq_selftest_fn()');\n")
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rows, _, _ = scan(tmp)
        check("負對照② 呼叫端在測試檔 ⇒ 交集 0", len(rows), 0)

        # ── 🔵 負對照③:那支 migration 【已記在帳本】⇒ 必須綠 ──
        os.remove(os.path.join(tmp, "apps", "x", "src", "caller.test.ts"))
        with open(os.path.join(tmp, "apps", "x", "src", "caller.ts"), "w", encoding="utf-8") as fh:
            fh.write("export const q = () => client.query('SELECT public.zzq_selftest_fn()');\n")
        with open(LEDGER, "a", encoding="utf-8") as fh:
            fh.write("20990101000000\tcafe\t2026-01-01\t已記\n")
        subprocess.run(["git", "-C", tmp, "add", "-A"], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rows, _, _ = scan(tmp)
        check("負對照③ 帳本已記 ⇒ 交集 0", len(rows), 0)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"── selftest: {passed} PASS / {failed} FAIL")
    return 1 if failed else 0


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    rows, ndefs, ncallers = scan(REPO)
    print("======== 裸 SQL 呼叫 × 帳本沒記 的交集 ========")
    print(f"  掃到帶物件定義的 migration {ndefs} 支 · 出貨碼裡被裸 SQL 引到的物件 {ncallers} 個")
    print(f"  🔴 交集 {len(rows)} 筆  ← 這是【候選】不是【缺陷】(帳本沒記 ≠ 沒貼)")
    for ver, kind, name, path in rows:
        print(f"     {ver}  {kind:4}  {name}  @ {path}")
    print()
    print("  🛑 本支【不擋任何東西】—— 只印。要不要掛 pre-push 等 `-48` 或 Sean(見檔頭)。")
    print("  🛑 它與 deploy-order-gate.sh 不重疊:那道看 `.rpc(`,本支看裸 SQL ⇒ 兩支都跑才算看過兩種形狀。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
