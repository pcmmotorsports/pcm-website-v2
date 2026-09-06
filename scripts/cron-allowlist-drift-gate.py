#!/usr/bin/env python3
"""cron 白名單漂移閘 —— ⟦f3-ALLOWLISTMANUAL1⟧(板列 694)。

## 這一條在守什麼

後台儀表板監看排程死活, 靠一張**手寫**的白名單 `CRON_JOB_WHITELIST`。
🔴 **有人加了一條排程而白名單沒跟上 ⇒ 那條排程死掉不會有任何訊號** —— 沒有人在看它,
而「沒有人在看」與「一切正常」在畫面上印同一個東西。

⇒ 本閘比兩個集合, 不相等就紅:
  ① `packages/domain/src/ops/cron-jobs.ts` 的 `CRON_JOB_WHITELIST` 裡每個 `jobName`
  ② `supabase/migrations/*.sql` 裡 `cron.schedule` 排上去、且沒有被後續 `cron.unschedule` 拿掉的名字

## 🛑 它守不到什麼(寫在這裡, 不假裝守住了)

**直接在 Supabase SQL Editor 手排、完全不進 repo 的那一種, 本閘看不到。**
那要拿正式庫的 `cron.job` 去比 —— 需要對正式庫的存取, 是另一件事、另一道閘。
🔬 2026-09-07 唯讀量過一次:正式庫 `cron.job` **9** 條, 與白名單、與 migrations **三邊完全相等**。

## 🔴 為什麼只掃 `*.sql`, 不掃 `*.sql.txt`

`supabase/migrations/PENDING-*.sql.txt` 是【故意】改名讓它貼不出去的(codex 判 FAIL 之後的處置)。
把它算進來, 本閘出生就是紅的, 而紅的原因是一件【做對了】的事。
⚠️ 我第一發掃整個目錄、撈到多一個名字, 以為抓到漂移 —— 開檔才知道那是對的狀態。

## 🔬 codex `gpt-5.6-sol` 2026-09-07 R1 判 FAIL, 本版是照它修完的

那一輪抓到的、本版處理掉的(每一條都在碼裡留了記號):
  · hook 判 staged 而本腳本讀工作樹 ⇒ **兩者不同步**, 只 staged 一半就會誤判相等 ⇒ `--staged`
  · 兩側都掃**原始文字**、未剝註解 ⇒ 註解掉一行照樣被算入 ⇒ 先剝註解
  · 只認 `cron.schedule('x'` 一種形狀 ⇒ named notation / `schedule_in_database` / 動態 SQL 漏抓
    ⇒ 三種都認, **而抓不到字面的那一種【叫出來】不是安靜跳過**
  · 只累加 `schedule`、不處理 `unschedule` ⇒ 退役的 job 名會永遠掛著
  · `--selftest` **完全沒呼叫 `migration_names()`** ⇒ 正規式全壞仍 PASS ⇒ 本版自檢真的餵檔進去
  · `<名字>` 那個 placeholder 排除法在現況**不可觸發** ⇒ 改成「名字形狀不合就不算」的通則

## 用法

    python3 scripts/cron-allowlist-drift-gate.py            # 比工作樹
    python3 scripts/cron-allowlist-drift-gate.py --staged   # 比 index(hook 走這條)
    python3 scripts/cron-allowlist-drift-gate.py --selftest # 量具自檢, 五個世界

⚠️ 本閘**零對外、零 DB**, 只讀 repo 檔。
"""
from __future__ import annotations

import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = "packages/domain/src/ops/cron-jobs.ts"
MIG_DIR = "supabase/migrations"

# 🔴 job 名的形狀 —— 用它取代原本那個寫死的 `<名字>` 排除:
#    那個 placeholder 只出現在【已經被排除的 .sql.txt】裡 ⇒ 那條排除規則在現況不可觸發(codex 抓到)。
#    改成通則:不像 job 名的東西一律不算, 而「像不像」有一條看得見的規則。
JOB_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]*$")

# `cron.schedule('x'` / `cron.schedule_in_database('x'` / `cron.schedule(job_name => 'x'`
SCHED_CALL_RE = re.compile(r"cron\.(schedule|schedule_in_database|unschedule)\s*\(", re.I)
LITERAL_RE = re.compile(r"\A\s*(?:job_name\s*=>\s*)?'([^']*)'")


class DynamicJobName(Exception):
    """cron.schedule 的名字不是字面 ⇒ 這把尺答不出來, 而【答不出來要叫】。"""


def strip_sql_comments(text: str) -> str:
    """剝掉 SQL 的 `--` 行註解與 `/* */` 塊註解, 保留字串與 dollar-quote 內容。

    🛑 **它的限度**:只認單引號字串與 `$tag$` dollar-quote;巢狀 `/* /* */ */` 只脫一層。
       ⇒ 剝錯的方向是**多剝**(把碼當註解)⇒ 那會讓名字漏抓 ⇒ 而漏抓在本閘是【紅】不是綠。
    """
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "'":
            j = i + 1
            while j < n:
                if text[j] == "'":
                    if j + 1 < n and text[j + 1] == "'":
                        j += 2
                        continue
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
            continue
        if c == "$":
            m = re.match(r"\$[A-Za-z_0-9]*\$", text[i:])
            if m:
                tag = m.group(0)
                end = text.find(tag, i + len(tag))
                end = n if end == -1 else end + len(tag)
                out.append(text[i:end])
                i = end
                continue
        if text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
            out.append("\n")
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            out.append(" ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def strip_ts_comments(text: str) -> str:
    """剝掉 TS 的 `//` 與 `/* */`, 保留單/雙引號與樣板字串。"""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in "'\"`":
            q, j = c, i + 1
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == q:
                    j += 1
                    break
                j += 1
            out.append(text[i:j])
            i = j
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j == -1 else j
            out.append("\n")
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
            out.append(" ")
            continue
        out.append(c)
        i += 1
    return "".join(out)


def allowlist_names(text: str) -> set[str]:
    """白名單那張表裡的每個 `jobName`(先剝註解 —— 註解掉一列不該還算數)。"""
    return set(re.findall(r"jobName:\s*'([^']+)'", strip_ts_comments(text)))


def scan_calls(text: str) -> list[tuple[str, str]]:
    """回 [(動作, 名字)];名字不是字面 ⇒ 拋 DynamicJobName(**答不出來要叫**)。"""
    body = strip_sql_comments(text)
    found: list[tuple[str, str]] = []
    for m in SCHED_CALL_RE.finditer(body):
        verb = m.group(1).lower()
        lit = LITERAL_RE.match(body[m.end():])
        if lit is None:
            raise DynamicJobName(f"{verb} 的第一個參數不是字面:{body[m.end():m.end() + 60]!r}")
        name = lit.group(1)
        if JOB_NAME_RE.match(name):
            found.append(("unschedule" if verb == "unschedule" else "schedule", name))
    return found


def migration_names(files: list[tuple[str, str]]) -> set[str]:
    """依版本號順序套用 schedule / unschedule, 回「今天還排著」的名字。

    🔴 只累加 `schedule` 的舊版本會讓**退役的 job 名永遠掛著** ⇒ 白名單拿掉它反而變紅。
    """
    live: set[str] = set()
    for _path, text in sorted(files, key=lambda t: t[0]):
        for verb, name in scan_calls(text):
            if verb == "schedule":
                live.add(name)
            else:
                live.discard(name)
    return live


def read_worktree() -> tuple[str, list[tuple[str, str]]]:
    dom = io.open(ROOT / DOMAIN, encoding="utf-8").read()
    files = [
        (p.name, io.open(p, encoding="utf-8").read())
        for p in sorted((ROOT / MIG_DIR).glob("*.sql"))
    ]
    return dom, files


def read_staged() -> tuple[str, list[tuple[str, str]]]:
    """讀 **index** 的內容 —— hook 判的是 staged, 這裡就必須也讀 staged(codex must-fix)。"""
    def show(path: str) -> str:
        r = subprocess.run(["git", "show", f":{path}"], cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"git show :{path} 失敗 rc={r.returncode} {r.stderr.strip()}")
        return r.stdout

    r = subprocess.run(["git", "ls-files", "-z", "--", f"{MIG_DIR}/*.sql"],
                       cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"git ls-files 失敗 rc={r.returncode} {r.stderr.strip()}")
    paths = [p for p in r.stdout.split("\0") if p]
    return show(DOMAIN), [(Path(p).name, show(p)) for p in paths]


def report(dom: set[str], mig: set[str], n_files: int) -> int:
    only_dom = sorted(dom - mig)
    only_mig = sorted(mig - dom)
    # 🔴 「9 條」曾被寫成好像是 9 支檔(codex nit)—— 名字數與檔數是兩個東西, 兩個都印。
    print(f"白名單(cron-jobs.ts)  {len(dom)} 個 job 名")
    print(f"migrations            {len(mig)} 個 job 名(掃了 {n_files} 支 .sql)")
    if not only_dom and not only_mig:
        print("🟢 兩邊相等 —— 零漂移。")
        print("🛑 而它守不到【直接在 SQL Editor 手排、不進 repo】那一種:那要拿正式庫的 cron.job 比。")
        return 0
    print("🔴 兩邊不相等 ⇒ 有排程在跑而沒有人在看, 或白名單留著一個已經不存在的名字。")
    for n in only_dom:
        print(f"   · 只在白名單裡:{n}   ⇒ migrations 沒有它 —— 排程被拿掉了而白名單沒跟?")
    for n in only_mig:
        print(f"   · 只在 migrations 裡:{n}   ⇒ 白名單沒有它 —— 那條排程死掉不會有任何訊號。")
    print("   修法:兩邊對齊。白名單在 packages/domain/src/ops/cron-jobs.ts。")
    return 1


def _w(d: Path, name: str, body: str) -> tuple[str, str]:
    (d / name).write_text(body, encoding="utf-8")
    return name, body


def selftest() -> int:
    """🔴 五個世界 —— 而**每一個都真的呼叫 `migration_names()`**。

    上一版的自檢完全沒碰那支函式 ⇒ 正規式、剝註解、placeholder、檔案枚舉全壞仍會 PASS
    (codex must-fix)。那種自檢證明的是「我寫的比較邏輯沒錯」, 而壞掉的從來不是那一半。
    """
    ok = True

    def check(label: str, got, want) -> None:
        nonlocal ok
        good = got == want
        ok = ok and good
        print(f"  {'🟢' if good else '🔴'} {label}:得 {got!r} / 要 {want!r}")

    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        f1 = _w(d, "20260101000000_a.sql", "SELECT cron.schedule('pcm-alpha', '0 1 * * *', 'SELECT 1');")
        f2 = _w(d, "20260102000000_b.sql", "-- SELECT cron.schedule('pcm-commented-out', '* * * * *', 'x');\n")
        f3 = _w(d, "20260103000000_c.sql", "SELECT cron.schedule(job_name => 'pcm-named', schedule => '0 2 * * *', command => 'SELECT 1');")
        f4 = _w(d, "20260104000000_d.sql", "SELECT cron.schedule_in_database('pcm-indb', '0 3 * * *', 'SELECT 1', 'postgres');")
        f5 = _w(d, "20260105000000_e.sql", "SELECT cron.unschedule('pcm-alpha');")
        check("① 位置參數抓得到", migration_names([f1]), {"pcm-alpha"})
        check("② 被註解掉的【不算】", migration_names([f2]), set())
        check("③ named notation 抓得到", migration_names([f3]), {"pcm-named"})
        check("④ schedule_in_database 抓得到", migration_names([f4]), {"pcm-indb"})
        check("⑤ unschedule 之後不再算", migration_names([f1, f5]), set())

        dyn = _w(d, "20260106000000_f.sql", "EXECUTE format('SELECT cron.schedule(%L, ...)', v_name);")
        try:
            migration_names([dyn])
            print("  🔴 ⑥ 動態名字沒有叫 —— 一把答不出來卻不出聲的尺")
            ok = False
        except DynamicJobName:
            print("  🟢 ⑥ 動態名字會叫(不是安靜跳過)")

    real = allowlist_names(io.open(ROOT / DOMAIN, encoding="utf-8").read())
    check("⑦ 真白名單讀得到(非空)", bool(real), True)
    fake = "zzz-fake-cron-job-selftest"
    print(f"\n世界 相等 ⇒ rc 要 0;現造 {fake} ⇒ rc 要 1 且印出那條名字")
    rc_same = report(real, set(real), 0)
    print()
    rc_diff = report(real, set(real) | {fake}, 0)
    check("⑧ 相等 rc", rc_same, 0)
    check("⑨ 不等 rc", rc_diff, 1)
    print(f"\n{'🟢 自檢 PASS' if ok else '🔴 自檢 FAIL'}")
    return 0 if ok else 2


def main() -> int:
    if "--selftest" in sys.argv:
        return selftest()
    staged = "--staged" in sys.argv
    try:
        dom_text, files = read_staged() if staged else read_worktree()
    except (RuntimeError, OSError) as e:
        print(f"🔴 讀不到受測內容 ⇒ 擋下(不放行):{e}")
        return 2
    if not files:
        print(f"🔴 {MIG_DIR} 底下掃到 0 支 .sql ⇒ 擋下。")
        print("   0 支在【路徑錯了】與【真的沒有 migration】兩個世界是同一個數字。")
        return 2
    dom = allowlist_names(dom_text)
    if not dom:
        print("🔴 從 cron-jobs.ts 讀到 0 個 jobName ⇒ 擋下。")
        print("   那個 0 在【白名單被清空】與【我的正規式對不上新寫法】兩個世界是同一個數字。")
        return 2
    try:
        mig = migration_names(files)
    except DynamicJobName as e:
        print(f"🔴 有一處 cron 呼叫的 job 名不是字面 ⇒ 這把尺答不出來 ⇒ 擋下:{e}")
        print("   修法:把名字寫成字面, 或在本閘加一條看得見的例外(不要讓它安靜跳過)。")
        return 2
    print(f"讀的是:{'index(staged)' if staged else '工作樹'}")
    return report(dom, mig, len(files))


if __name__ == "__main__":
    sys.exit(main())
