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
* 🔴🔴 **2026-09-06 起本支有兩個模式, 不要把它們讀成同一件事**(主視窗 `-f8` 裁【乙】):
  · 無參數 = `scan()` 全樹普查 —— **只印, 不擋**, 給人看現況用。
  · `--gate` = **pre-push 第 5 支, 會擋** —— 只看 `refs/heads/dev`/`main`、只看**這次要推的新增行**、
    判準讀**要推的那顆的樹**、git 失敗一律 fail-closed。
  ⛔ ~~本支不掛任何 hook / 不擋任何東西~~ —— **那句話 2026-09-06 起不成立**, 留刪除線讓搜它的人撞到這裡。
  🛑 而 **`-48` 的明令沒有被繞過**:那句擋的是【改 `deploy-order-gate.sh`】, 那道閘一行都沒動。
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

import hashlib
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
    except Exception as exc:
        # 🔴🔴 ⛔ ~~`except Exception: return []`~~ —— **2026-09-06 拿掉。**
        #   那一版在 `git ls-files` 失敗時回空清單 ⇒ 本支印
        #   「被裸 SQL 引到的物件 **0** 個 · 交集 **0** 筆」⇒ **一個看起來完全正常的綠**。
        #   🔬 實錘:把 `9cbddce4d` 用 `git archive` 抽進非 git 目錄跑 ⇒ 同一份碼,
        #      我樹上 41 個物件、那裡 **0** 個。**抓到它的是兩發並排, 不是這一發自己。**
        #   ⇒ 🛑 它一旦掛上 pre-push, 這個形狀就是**閘瞎了而放行**。fail-closed。
        raise SystemExit(
            f"🔴 裸 SQL gate:`git ls-files` 在 {root} 失敗 ⇒ fail-closed。({exc})\n"
            "   🛑 **不要把它讀成「沒有呼叫端」** —— 那是尺沒接上, 兩件事本來會印同一個 0。"
        )
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

    # ══ --gate 的世界(2026-09-06 掛上 pre-push 時加)═══════════════════════
    #  🔴 上面那幾格量的是 `scan()`(全樹、只印)。**閘不是那一支** —— 它只看
    #     「這次要推的範圍」, 而那是一個【不同的宣稱】⇒ 要自己的世界, 不能沿用上面的綠。
    gtmp = tempfile.mkdtemp(prefix="rpc-raw-gate-")
    try:
        def _g(*a):
            return subprocess.run(["git", "-C", gtmp] + list(a), check=True,
                                  capture_output=True, text=True).stdout.strip()
        _g("init", "-q", "-b", "main")
        _g("config", "user.email", "t@t"); _g("config", "user.name", "t")
        os.makedirs(os.path.join(gtmp, "supabase", "migrations"))
        os.makedirs(os.path.join(gtmp, "apps", "x", "src"))
        def w(rel: str, txt: str) -> None:
            with open(os.path.join(gtmp, rel), "w", encoding="utf-8") as fh:
                fh.write(txt)

        def sha_of(rel: str) -> str:
            """帳本第二欄要放【真的】sha256 —— 本閘現在會比它。"""
            with open(os.path.join(gtmp, rel), "rb") as fh:
                return hashlib.sha256(fh.read()).hexdigest()

        # 基底:一支已記進帳本的 migration + 一支無關的出貨檔
        w("supabase/migrations/20990101000000_base.sql",
          "CREATE FUNCTION public.zzq_gate_base() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;\n")
        w("supabase/APPLIED.tsv",
          "# 標頭\n20990101000000\t" + sha_of("supabase/migrations/20990101000000_base.sql")
          + "\t2099-01-01\t備註\n")
        w("apps/x/src/other.ts", "export const other = 1;\n")
        _g("add", "-A"); _g("commit", "-qm", "base")
        base_sha = _g("rev-parse", "HEAD")

        # ── 世界①:一支【只在裸 SQL 裡被叫】、且版本不在帳本的函式 ⇒ 必須紅 ──
        w("supabase/migrations/20990202000000_new.sql",
          "CREATE FUNCTION public.zzq_gate_unlogged() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;\n")
        w("apps/x/src/caller.ts",
          "export const q = () => client.query('SELECT public.zzq_gate_unlogged()');\n")
        _g("add", "-A"); _g("commit", "-qm", "raw sql caller")
        red_sha = _g("rev-parse", "HEAD")
        line = f"refs/heads/dev {red_sha} refs/heads/dev {base_sha}"
        check("gate 世界① 只在裸 SQL 裡叫 + 版本不在帳本 ⇒ 擋", gate(line, gtmp), 1)

        # ── 世界②:同一支加進帳本 ⇒ 必須綠(唯一的差別就是那一列)──
        led2 = ("# 標頭\n20990101000000\t" + sha_of("supabase/migrations/20990101000000_base.sql")
                + "\t2099-01-01\t備註\n20990202000000\t"
                + sha_of("supabase/migrations/20990202000000_new.sql") + "\t2099-02-02\t補記\n")
        w("supabase/APPLIED.tsv", led2)
        _g("add", "-A"); _g("commit", "-qm", "ledger row")
        green_sha = _g("rev-parse", "HEAD")
        check("gate 世界② 同一支記進帳本(sha 相符)⇒ 放行",
              gate(f"refs/heads/dev {green_sha} refs/heads/dev {base_sha}", gtmp), 0)

        # ── 🔴 sha 對照:版本號記了、而 sha 是【另一份內容】的 ⇒ 必須擋 ──
        #    只比版本號的尺在這一格會綠, 而它綠的時候, 帳上那一行證明的是別的東西。
        w("supabase/APPLIED.tsv", led2.replace(
            sha_of("supabase/migrations/20990202000000_new.sql"), "deadbeef" * 8))
        _g("add", "-A"); _g("commit", "-qm", "ledger row with wrong sha")
        badsha_sha = _g("rev-parse", "HEAD")
        check("gate sha 記了版本而 sha 是另一份內容的 ⇒ 擋",
              gate(f"refs/heads/dev {badsha_sha} refs/heads/dev {base_sha}", gtmp), 1)

        # ── 🔵 射程對照:呼叫端【不在這次推的範圍】⇒ 綠(證明它不是全樹掃)──
        #    少了這一格, 一個全樹掃的閘也會通過上面兩格 —— 而它會擋住每一個人的每一次 push。
        check("gate 射程 呼叫端不在推的範圍內 ⇒ 放行",
              gate(f"refs/heads/dev {red_sha} refs/heads/dev {red_sha}", gtmp), 0)

        # ── 🔵 ref 對照:推的不是 dev/main ⇒ 不管(與 deploy-order-gate 同射程)──
        check("gate ref 推 feature branch ⇒ 不管",
              gate(f"refs/heads/x {red_sha} refs/heads/agent/line-x {base_sha}", gtmp), 0)

        # ── 🔵 註解對照:同名只出現在註解裡 ⇒ 綠 ──
        w("apps/x/src/caller.ts", "// 以前呼叫 public.zzq_gate_unlogged() ,現在不叫了\nexport const q = 1;\n")
        w("supabase/APPLIED.tsv",
          "# 標頭\n20990101000000\t" + sha_of("supabase/migrations/20990101000000_base.sql")
          + "\t2099-01-01\t備註\n")
        _g("add", "-A"); _g("commit", "-qm", "comment only")
        cm_sha = _g("rev-parse", "HEAD")
        check("gate 註解 同名只在註解裡 ⇒ 放行",
              gate(f"refs/heads/dev {cm_sha} refs/heads/dev {base_sha}", gtmp), 0)
        # ── 🔴 **已知誤報**(codex R1 ①;`-f8` 2026-09-06 要求量出來、不要用推的):
        #    一行【訊息字串】裡出現 `public.<fn>(` ⇒ 本閘**會擋**。
        #    🛑 那不是缺陷被發現, 那是文字比對的天花板 —— 而**擋下來的人看不出差別**,
        #       所以紅訊息末尾要指到板列, 讓他不用猜。
        w("apps/x/src/caller.ts",
          "export const q = () => { throw new Error('呼叫 public.zzq_gate_unlogged() 失敗'); };\n")
        _g("add", "-A"); _g("commit", "-qm", "message string only")
        msg_sha = _g("rev-parse", "HEAD")
        check("gate 已知誤報 訊息字串裡的 public.foo( 在新增行上 ⇒ 會擋(天花板, 不是缺陷)",
              gate(f"refs/heads/dev {msg_sha} refs/heads/dev {cm_sha}", gtmp), 1)



        # ── 🔴 誤擋對照(codex R1 must-fix 修完才有這一格):
        #    呼叫【早就在檔裡】, 這次只改了無關的一行 ⇒ **必須放行**。
        #    ⛔ 掃整支檔的版本在這一格會紅 —— 而它紅的時候, 擋的是一個什麼都沒做錯的人。
        #    base = red_sha:那一顆的 caller.ts **已經**有那個呼叫, 而帳本仍然沒記那一列。
        w("supabase/APPLIED.tsv",
          "# 標頭\n20990101000000\t" + sha_of("supabase/migrations/20990101000000_base.sql")
          + "\t2099-01-01\t備註\n")
        w("apps/x/src/caller.ts",
          "export const q = () => client.query('SELECT public.zzq_gate_unlogged()');\nexport const z = 2;\n")
        _g("add", "-A"); _g("commit", "-qm", "unrelated edit on a file that already calls it")
        edit_sha = _g("rev-parse", "HEAD")
        check("gate 誤擋 呼叫早就在、這次只改無關一行 ⇒ 放行",
              gate(f"refs/heads/dev {edit_sha} refs/heads/dev {red_sha}", gtmp), 0)
        # 🟢 同一顆對「呼叫還不在」的 base ⇒ 必須紅 —— 證明上面那個綠不是恆綠,
        #    而是【新增行裡沒有那個呼叫】換來的。
        check("gate 誤擋 同一顆對「呼叫還不在」的 base ⇒ 擋",
              gate(f"refs/heads/dev {edit_sha} refs/heads/dev {cm_sha}", gtmp), 1)

        # ── 🔴 壞掉的 ref 行 ⇒ fail-closed(不是靜靜跳過)──
        check("gate 壞行 非空而不足四欄 ⇒ fail-closed", gate("refs/heads/dev abc", gtmp), 1)
        check("gate 空 stdin ⇒ 0 個 ref, 放行", gate("", gtmp), 0)

    finally:
        shutil.rmtree(gtmp, ignore_errors=True)

    print(f"── selftest: {passed} PASS / {failed} FAIL")
    return 1 if failed else 0


ZERO = "0" * 40
EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
DEPLOY_REFS = ("refs/heads/dev", "refs/heads/main")


def _git_bytes(args: list[str], root: str | None = None) -> tuple[int, bytes]:
    """要算 sha 一定要走【原始位元組】。

    🔴 `text=True` 解碼過的字串算出來的 sha 與檔案本身不同(尾端換行、編碼)
    ⇒ **每一支都會 sha 不符 ⇒ 全部誤判成 pending** —— `deploy-order-gate.sh`
    的 `pending_versions` 註解逐字記過同一個坑(它第一版就是這樣寫的)。
    """
    r = subprocess.run(["git", "-C", root or REPO] + args, capture_output=True)
    return r.returncode, r.stdout


def _git(args: list[str], root: str | None = None) -> tuple[int, str]:
    r = subprocess.run(["git", "-C", root or REPO] + args, capture_output=True, text=True)
    return r.returncode, r.stdout


def _objects_missing_from_ledger(rev: str, root: str | None = None) -> dict[str, tuple[str, str]]:
    """物件名 ⇒ (版本號, kind), 只收【那一顆的樹上帳本沒記的】migration 定義的物件。

    🔴 讀的是 `rev` 的樹, **不是工作樹** —— 與 `deploy-order-gate.sh` 同一條紀律
    (它的 #4 逐字:「判準用**這次要推的那顆的樹**,不是工作樹」)。
    """
    rc, led = _git(["show", f"{rev}:supabase/APPLIED.tsv"], root)
    # 🔴 **讀不到帳本 ⇒ fail-closed**(codex R1 must-fix)。⛔ ~~`if rc == 0:` 之外什麼都不做~~ ——
    #   那會把帳本當成空的 ⇒ **每一支 migration 都算 pending** ⇒ 要嘛吵到被關掉,
    #   要嘛在剛好沒有交集時**照樣回 0** ⇒ 兩種都不是 fail-closed。
    if rc != 0:
        raise SystemExit(
            f"🔴 裸 SQL gate:讀不到 {rev}:supabase/APPLIED.tsv ⇒ fail-closed。\n"
            "   🛑 讀不到帳本與「帳本是空的」不是同一件事, 而它們會算出同一個結果。"
        )
    applied: dict[str, str] = {}
    if True:
        for line in led.split("\n"):
            if line.startswith("#"):
                continue
            cols = line.split("\t")
            if cols and re.fullmatch(r"\d{14}", cols[0]):
                # 🔴 **連 sha 一起收**(codex R1 must-fix):只比版本號 ⇒ 一支被記過帳、
                #   而檔案事後被改動的 migration, 帳上那一行證明的是**另一份內容**,
                #   卻仍然算「已 apply」⇒ 靜默放行。`deploy-order-gate.sh` 比 sha, 本閘跟上。
                applied[cols[0]] = cols[1] if len(cols) > 1 else ""
    # 🛑 帳本讀不到 ⇒ 不當成「什麼都沒貼」(那會把每一支都算成 pending, 變成噪音閘),
    #    也不當成「全貼了」⇒ 交給呼叫端 fail-closed。
    rc, tree = _git(["ls-tree", "-r", "--name-only", rev, "supabase/migrations"], root)
    if rc != 0:
        raise SystemExit("🔴 裸 SQL gate:讀不到那一顆的 supabase/migrations 樹 ⇒ fail-closed。")
    # 🔴 `ls-tree` 對【不存在的路徑】是 rc=0 + 空輸出(codex R1 must-fix)⇒ 分母是空的,
    #   而「沒有 migration」與「讀不到 migration」會算出同一個 `missing={}` ⇒ 放行。
    if not [x for x in tree.split("\n") if x.endswith(".sql")]:
        raise SystemExit(
            f"🔴 裸 SQL gate:{rev} 的樹上 supabase/migrations 一支 .sql 都沒有 ⇒ fail-closed。\n"
            "   🛑 那不是「都貼完了」, 那是分母是空的。"
        )
    out: dict[str, tuple[str, str]] = {}
    for path in tree.split("\n"):
        if not path.endswith(".sql"):
            continue
        ver = os.path.basename(path)[:14]
        if not re.fullmatch(r"\d{14}", ver):
            continue
        rcb, blob = _git_bytes(["show", f"{rev}:{path}"], root)
        if rcb != 0:
            raise SystemExit(f"🔴 裸 SQL gate:讀不到 {rev}:{path} ⇒ fail-closed。")
        if applied.get(ver) == hashlib.sha256(blob).hexdigest():
            continue          # 記過帳, 而且帳上那一行證明的就是這一份內容
        src = strip_comments(blob.decode("utf-8", "replace"))
        for m in DEF_FN.finditer(src):
            out.setdefault(m.group(1), (ver, "fn"))
        for m in DEF_VIEW.finditer(src):
            out.setdefault(m.group(1), (ver, "view"))
    return out


def gate(stdin_text: str | None = None, root: str | None = None) -> int:
    """pre-push 第 5 支。**射程刻意與 `deploy-order-gate.sh` 對齊**:

    · 只看真的會觸發部署的 ref(`refs/heads/dev` / `refs/heads/main`)
    · 只看**這次要推的範圍**改到的出貨檔 —— 🔴 不是全樹。
      全樹掃一旦有一筆站著的命中, **每一個人的每一次 push 都會被擋** ⇒
      `.husky/pre-push` 檔頭逐字記過「**閘死於誤報與死於太慢一樣常見, 而被關掉的閘等於沒有**」。
    · git 失敗一律 fail-closed(不把錯誤吞成空集合)。
    """
    blocked: list[str] = []
    ref_n = 0
    for line in (sys.stdin.read() if stdin_text is None else stdin_text).split("\n"):
        if not line.strip():
            continue
        parts = line.split()
        # 🔴 **非空而欄數不對 ⇒ fail-closed**(codex R1 must-fix)。⛔ ~~`continue`~~ ——
        #   那是「格式壞掉」而不是「沒有要推」, 而靜靜跳過等於放行。
        if len(parts) < 4:
            print(
                f"🔴 裸 SQL gate:pre-push 餵進來的這一行不是四欄 ⇒ fail-closed:{line!r}",
                file=sys.stderr,
            )
            return 1
        _local_ref, local_sha, remote_ref, remote_sha = parts[:4]
        if local_sha == ZERO or remote_ref not in DEPLOY_REFS:
            continue
        ref_n += 1
        base = EMPTY_TREE if remote_sha == ZERO else remote_sha
        rc, files = _git(["diff", "--name-only", base, local_sha, "--", "apps", "packages"], root)
        if rc != 0:
            print(
                f"🔴 裸 SQL gate:算不出 {base}..{local_sha} 的 diff(物件不在?shallow clone?)⇒ fail-closed。\n"
                "   確認過安全就用 git push --no-verify。",
                file=sys.stderr,
            )
            return 1
        # 🔴 副檔名不只 `.ts/.tsx`(codex R1 must-fix):`.js/.mjs/.cjs/.jsx/.mts/.cts` 裡的
        #   裸 SQL 呼叫一樣會上線, 而**宣稱是「非測試出貨檔」卻只收兩種**就是一句比實作寬的話。
        app_files = [
            f for f in files.split("\n")
            if f.endswith((".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"))
            and ".test." not in f and ".spec." not in f and "/__tests__/" not in f
            and not f.endswith("database.types.ts")
        ]
        if not app_files:
            continue
        missing = _objects_missing_from_ledger(local_sha, root)
        if not missing:
            continue
        # 🔴 100% rename 在 `-U0` 下沒有 `+` hunk ⇒ 新上線的呼叫會漏擋
        #   (`deploy-order-gate.sh` 的關卡2 R2 #1 記過同一格)⇒ 那些檔改掃整檔。
        rc, ren = _git(["diff", "--name-only", "--diff-filter=R", base, local_sha,
                        "--", "apps", "packages"], root)
        renamed = set(ren.split("\n")) if rc == 0 else set()
        for f in app_files:
            # 🔴🔴 **只看【這次新增的行】, 不是整支檔**(codex R1 must-fix, 也是
            #   `deploy-order-gate.sh` 的 #3 逐字:「比對的是**新增行**,不是整個檔的現況 ——
            #   只改同一個檔的無關一行,不該因為檔內早就有那個 RPC 字樣而被擋」)。
            #   ⛔ ~~掃整支檔~~ ⇒ 無關編輯 / rename / merge / force-push **都會把既有呼叫重新判罪一次**
            #      ⇒ 那正是「閘死於誤報」的形狀。
            rc, raw = _git(["diff", "-U0", base, local_sha, "--", f], root)
            if rc != 0:
                print(f"🔴 裸 SQL gate:算不出 {f} 的新增行 ⇒ fail-closed。", file=sys.stderr)
                return 1
            content = "\n".join(
                ln[1:] for ln in raw.split("\n")
                if ln.startswith("+") and not ln.startswith("+++")
            )
            if f in renamed:
                # 🔴 這裡的 `git show` 失敗**不是**「檔案被刪」——`--diff-filter=R` 已經
                #   保證它在那一顆的樹上。真的讀不到 ⇒ partial clone / 壞物件 ⇒ fail-closed
                #   (codex R1 must-fix:⛔ ~~`if rc2 == 0`, 失敗就靜靜略過~~)。
                rc2, whole = _git(["show", f"{local_sha}:{f}"], root)
                if rc2 != 0:
                    print(f"🔴 裸 SQL gate:讀不到 {local_sha}:{f}(rename 進來的)⇒ fail-closed。",
                          file=sys.stderr)
                    return 1
                content += "\n" + whole
            if not content.strip():
                continue
            src = strip_comments(content)
            names = {m.group(1) for m in PAT_FN.finditer(src)}
            names |= {m.group(1) for m in PAT_VIEW.finditer(src)}
            for name in sorted(names & set(missing)):
                ver, kind = missing[name]
                blocked.append(f"     {ver}  {kind:4}  {name}  @ {f}")
    if not blocked:
        # 🔵 「0 blocked」與「一個 ref 都沒檢查」是兩件事 —— 照 `deploy-order-gate.sh` 的
        #   REF_N 紀律單獨報出來, 免得一個什麼都沒看的綠被讀成一個看過了的綠。
        print(f"裸 SQL gate:0 blocked(檢查了 {ref_n} 個 ref)", file=sys.stderr)
        return 0
    print("🔴 部署時序 gate(裸 SQL):碼要用的物件, 帳本上沒有那一支 migration。", file=sys.stderr)
    for row in sorted(set(blocked)):
        print(row, file=sys.stderr)
    print(
        "   🛑 **帳本沒記 ≠ 沒貼**(`supabase/APPLIED.tsv` 檔頭逐字「不在本表上什麼都不代表」)\n"
        "      ⇒ 真的貼了就補記那一列;沒貼就先貼。確認過安全才用 git push --no-verify。\n"
        "   🔵 本閘看的是裸 SQL(`query('SELECT public.X')`);`.rpc(` 那一種在 deploy-order-gate。\n"
        "   🟡 **若上面那一行其實是【訊息字串 / 行尾註解】而不是呼叫 ⇒ 這是【已知誤報】,不是你做錯**\n"
        "      —— 本閘是文字比對, 分不出執行語境(板列 ⟦b9-RPCBLIND1⟧ 的缺口三行;\n"
        "      selftest 有一格逐字量過『訊息字串裡的 public.foo( 會擋』)。\n"
        "      ⇒ 那種情況下 `git push --no-verify` 是對的動作, 而**請順手在板列那三行加一筆**。",
        file=sys.stderr,
    )
    return 1


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    if "--gate" in sys.argv:
        return gate()
    rows, ndefs, ncallers = scan(REPO)
    # 🔴 兩個輸入任一為空 ⇒ 交集必然是 0, 而那個 0 的意思是「尺沒接上」。
    #   檔頭逐字寫過「兩個輸入都不是空的 ⇒ 那個 0 不是尺沒接上」—— 這裡把那句話變成一道檢查。
    if ndefs == 0 or ncallers == 0:
        print(
            f"🔴 裸 SQL gate:分母是空的(migration {ndefs} 支 / 被引到的物件 {ncallers} 個)⇒ fail-closed。\n"
            "   🛑 **交集 0 與尺沒接上印同一個東西** —— 這一發不算數。",
            file=sys.stderr,
        )
        return 2
    print("======== 裸 SQL 呼叫 × 帳本沒記 的交集 ========")
    print(f"  掃到帶物件定義的 migration {ndefs} 支 · 出貨碼裡被裸 SQL 引到的物件 {ncallers} 個")
    print(f"  🔴 交集 {len(rows)} 筆  ← 這是【候選】不是【缺陷】(帳本沒記 ≠ 沒貼)")
    for ver, kind, name, path in rows:
        print(f"     {ver}  {kind:4}  {name}  @ {path}")
    print()
    print("  🔵 這是 `scan()` 全樹模式 —— **只印, 不擋**。擋的是 `--gate`(pre-push 第 5 支, 2026-09-06 掛上)。")
    print("  🛑 它與 deploy-order-gate.sh 不重疊:那道看 `.rpc(`,本支看裸 SQL ⇒ 兩支都跑才算看過兩種形狀。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
