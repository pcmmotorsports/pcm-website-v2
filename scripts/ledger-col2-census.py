#!/usr/bin/env python3
"""帳本第二欄普查:每一列的 sha 到底在量哪一個東西。唯讀。
三格互斥且窮盡:repo 檔 / 貼板那份 / 兩者都不是。三數和必須 = 資料列數。"""
import hashlib, io, os, sys, glob, subprocess

# 🔴 `--selftest` 的第一件事:剝掉【繼承來的】git 環境。
#    ⚠️ **本支不在 ⟦02-EARLYDEATHUNVERIFIED⟧ 原本那 13 支名單裡** —— 它是 2026-09-06 `-auth`
#    修完那 7 支、重跑 `selftest-git-isolation-gate.sh` 驗收時**新冒出來的**(分母 108 ⇒ 113)。
#    症狀與那 7 支同型:帶 `GIT_DIR` rc=1 / 不帶 rc=0 ⇒ 它**還沒走到會動 git 那一段就自己死了**,
#    受害者快照沒變 ⇒ 那道閘印 `CLEAN`, **與「跑完而且乾淨」是同一個字**。
#    ⚠️ **只剝 selftest 那一條路** —— 真跑時 `GIT_DIR` 指的是本 repo 自己的 `.git`, 剝掉會壞。
#    形狀取自 `scripts/board-state-consistency.py:932`。
if {'--selftest', '--selfcheck'} & set(sys.argv[1:]):
    for _k in [_k for _k in os.environ if _k.startswith('GIT_')]:
        del os.environ[_k]


# --selftest:掛在 lint-staged 上。🔴 它驗的是【這支腳本的判別力】, 不是帳本對不對。
#    · 分割必須互斥窮盡:三格相加 = 資料列數(不等 ⇒ 分類邏輯漏了一條路徑)
#    · 負對照:一個現造的 sha 不准落進 ① 或 ②
#    🛑 它【不】驗「② 一定 > 0」—— 沒有信箱的機器上貼板分母是 0, 而那時三格照樣相加正確。
#      ⇒ 所以輸出一律把【貼板分母】印出來:分母 0 時, ② 的 0 什麼都不代表。
#    ⚠️ 本腳本不碰 git ⇒ 不需要剝 GIT_* 環境。

# 🔴🔴 code-reviewer R1 #1(Critical):原本寫死 `~/pcm-wt-db`
#    ⇒ 這道閘進主樹之後, **在主樹與其他每一棵 worktree 上都會拿 pcm-wt-db 的 migrations 去比 sha**
#    ⇒ 實測(把 HOME 換掉演 worktree 不在)⇒ rc=1、③=344、印「升乙要重開」+ 叫人 `--no-verify`
#      = **誤擋而且診斷是錯的**。而今天 ②+③ = 10 壓線 ⇒ 跨樹只要一支 migration 內容不同就過線。
#    ✅ 由 `__file__` 上溯兩層(本檔住在 `<repo>/scripts/`);`--repo` 只是給人手動指定用的。
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "--repo" in sys.argv:
    i = sys.argv.index("--repo")
    if i + 1 >= len(sys.argv):
        print("🔴 --repo 後面沒有路徑"); sys.exit(2)
    REPO = sys.argv[i + 1]
# 🔴 `--ledger <path>`:pre-commit 那道閘餵的是【staged 那一份】, 不是工作樹那一份 ——
#    兩者不同時, 讀工作樹會讓閘對「這一顆 commit 會不會讓數字過線」答錯。
LEDGER = os.path.join(REPO, "supabase/APPLIED.tsv")
if "--ledger" in sys.argv:
    _i = sys.argv.index("--ledger")
    if _i + 1 >= len(sys.argv):          # R1 #7:原本會噴 IndexError traceback
        print("🔴 --ledger 後面沒有路徑"); sys.exit(2)
    LEDGER = sys.argv[_i + 1]
BOARD_GLOBS = os.path.expanduser("~/pcm-mailbox/貼板-*/")

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

# 貼板全體 sha → 檔名(分母印出來, 不藏)
board = {}
nfiles = 0
for d in glob.glob(BOARD_GLOBS):
    for root, _, files in os.walk(d):
        for fn in files:
            p = os.path.join(root, fn)
            try: board.setdefault(sha(p), []).append(p); nfiles += 1
            except OSError: pass

# 🔴🔴 **③ 拆成 ③a / ③b, 而判準【呼叫】修法丙那把尺**
#    (主視窗 `-f8` 2026-09-06 裁乙 + 逐字「不要再手寫一份等價迴圈」):
#      ③a = `scripts/ledger-drift-classify.sh` 回 `drift` ⇒ **部署閘那邊已經會降級了**
#      ③b = 回 `changed` / `notfound` ⇒ **真的卡在 PENDING**
#    🎯 **為什麼要拆**:這個門檻的用途是「要不要升乙(帳本加第三欄)」,
#      而丙已經替 ③a 那一族回答了「碼沒變、只差註解」⇒ **把它們算進分子 = 為一個已經解決的病叫**;
#      而**下一次真的該叫的時候, 沒有人會相信它。**
#    🛑 **這【不是】放寬** —— 是讓 census 與部署閘**問同一件事**。
#    🔬 **它的由來是一次真實事件**(2026-09-06):主視窗一顆**純註解** commit(`e79632df1`)改了
#      `20260902180000`, 而它從 `git merge` 進來 —— **而 merge 不跑 pre-commit** ⇒ 那道閘沒被叫到,
#      是合併後手動跑 census 才看到 `②+③ = 11 > 10`。而那 11 裡有 4 列是丙處理得好好的。
CLASSIFY = os.path.join(REPO, "scripts", "ledger-drift-classify.sh")

def drift_kind(mig_path):
    """回 'drift' / 'changed' / 'notfound';叫不動一律 'notfound'(不猜, 往多算的方向偏)。"""
    if not os.path.isfile(CLASSIFY): return "notfound"
    try:
        out = subprocess.run(["sh", CLASSIFY, os.path.relpath(mig_path, REPO), want, "WORKTREE"],
                             cwd=REPO, capture_output=True, text=True, timeout=60).stdout
    except Exception:
        return "notfound"
    return (out.split() or ["notfound"])[0]

rows, repo_hit, board_hit, neither, malformed = 0, [], [], [], []
third_a, third_b = [], []
for line in io.open(LEDGER, encoding="utf-8"):
    line = line.rstrip("\n")
    if not line or line.startswith("#"): continue
    c = line.split("\t")
    rows += 1
    # 🔴 R1 #6:原本 `len(c) < 2 ⇒ continue` **既不計 rows 也不進三格** ⇒ 掉 tab 的列隱形。
    #    現在它自己一格。⚠️ 它不代表帳本壞了才會非 0 —— 但非 0 就值得有人看一眼。
    if len(c) < 2:
        malformed.append(line[:40]); continue
    ver, want = c[0], c[1]
    cands = glob.glob(os.path.join(REPO, "supabase/migrations", ver + "_*.sql"))
    if cands and sha(cands[0]) == want: repo_hit.append(ver); continue
    if want in board: board_hit.append((ver, os.path.basename(board[want][0]))); continue
    neither.append(ver)
    (third_a if (cands and drift_kind(cands[0]) == "drift") else third_b).append(ver)

if "--gate" in sys.argv:
    affected = len(board_hit) + len(third_b)          # 🔴 分子改成 ②+③b(裁乙)
    total = len(repo_hit) + len(board_hit) + len(neither) + len(malformed)
    # 🔵 R1 #5:這一格是**碼層自檢(canary)**, 不是在守帳本 ——
    #    它只會在「有一條分類路徑沒把那一列 append 進任何一格」時紅。
    if total != rows:
        print(f"🔴 帳本第二欄普查【碼層自檢】:四格相加 {total} ≠ 資料列 {rows} ⇒ 這支尺自己壞了, 擋下"); sys.exit(1)
    print(f"帳本第二欄普查(staged):資料列 {rows} · ① repo {len(repo_hit)} · ② 貼板 {len(board_hit)} "
          f"· ③ 都不是 {len(neither)}(③a 丙會降級 {len(third_a)} / ③b 真卡住 {len(third_b)}) "
          f"· 壞掉的列 {len(malformed)} · 貼板分母 {nfiles} 個檔 · repo {REPO}")
    if third_a: print("   ③a(丙已處理, 不算進分子):" + " ".join(sorted(third_a)))
    if third_b: print("   ③b(真卡住, 算進分子)    :" + " ".join(sorted(third_b)))
    if nfiles == 0:
        # 🔴 R1 ④ Minor:這句原本只在檔頭註解裡, 而**讀輸出的人看不到註解**。
        print("   ⚠️ 貼板分母是 0(信箱不在 / 路徑變了)⇒ **② 的那個 0 什麼都不代表**。")
    if affected > 10:
        print(f"🔴 ②+③b = {affected} > 10 ⇒ `⟦db-LEDGERSHADRIFT⟧` 的【乙】(帳本加第三欄)要重開。")
        print( "   ② 的清單:" + " ".join(v for v, _ in sorted(board_hit)))
        print( "   ③b 的清單:" + " ".join(sorted(third_b)))
        print( "   🛑 這不是「你這一顆寫錯了」—— 是**那一欄的兩種用途已經多到該分欄了**。")
        print( "   確認過要先放行就用 git commit --no-verify, 並在 body 寫明理由。")
        sys.exit(1)
    print(f"   ✅ ②+③b = {affected} ≤ 10 ⇒ 維持甲。🛑 這只答【那一欄在量哪個東西】, 不答帳本對不對。")
    sys.exit(0)

if "--selftest" in sys.argv:
    ok = True
    if len(repo_hit)+len(board_hit)+len(neither)+len(malformed) != rows:
        print("🔴 selftest FAIL:四格相加不等於資料列數 ⇒ 分類漏了一條路徑"); ok = False
    fake = "f" * 64
    if fake in board:
        print("🔴 selftest FAIL:現造的 sha 竟然在貼板 map 裡"); ok = False
    if rows == 0:
        print("🔴 selftest FAIL:帳本零資料列 ⇒ 這支腳本這一發沒有分母"); ok = False
    # 🔵 升乙的門檻(主視窗 `-f8` 2026-09-06 裁):②+③ > 10 ⇒ 加第三欄那一案要重開。
    #    2026-09-06 量到的是 5+5 = 10, **壓線**。
    # 🛑🛑 **而這一格【射程很窄】, 不要把它讀成「那個門檻有人守著」**:
    #    它掛在 `package.json` 的 lint-staged, key 是**這支腳本自己的逐字路徑**
    #    ⇒ **只有在有人把【這支腳本】staged 進 commit 時才會跑。**
    #    ⇒ 📌 **帳本長出第 11 列受影響的那一天, 沒有任何東西會叫。**
    #      要它真的會叫, 得改掛在 `supabase/APPLIED.tsv` 上 —— 那是另一件事, 今天沒做。
    affected = len(board_hit) + len(third_b)          # 🔴 分子改成 ②+③b(裁乙)
    if affected > 10:
        print(f"🔴 selftest FAIL:②+③ = {affected} > 10 ⇒ 照 `-f8` 2026-09-06 的裁定, "
              f"⟦db-LEDGERSHADRIFT⟧ 的【乙】(帳本加第三欄)要重開"); ok = False
    print(f"selftest {'PASS' if ok else 'FAIL'}:資料列 {rows} · 四格和 "
          f"{len(repo_hit)+len(board_hit)+len(neither)+len(malformed)} · 壞掉的列 {len(malformed)} "
          f"· 貼板分母 {nfiles} 個檔")
    sys.exit(0 if ok else 1)

print(f"貼板分母:{len(glob.glob(BOARD_GLOBS))} 個目錄 / {nfiles} 個檔 / {len(board)} 個相異 sha")
print(f"帳本資料列 {rows}")
print(f"  ① 等於 repo 檔 sha      {len(repo_hit)}")
print(f"  ② 等於貼板那份 sha      {len(board_hit)}")
print(f"  ③ 兩者都不是            {len(neither)}  (③a 丙會降級 {len(third_a)} / ③b 真卡住 {len(third_b)})")
print(f"  ④ 壞掉的列(欄數<2)      {len(malformed)}")
_sum = len(repo_hit)+len(board_hit)+len(neither)+len(malformed)
# 🔵 R2 nit ②:原本印「(必須等於 N)」而**它對資料恆真** ⇒ 那是【碼層自檢】不是在守帳本。
print(f"  ①+②+③+④ = {_sum} · 資料列 {rows} ⇒ " + ("一致(碼層自檢)" if _sum == rows else "🔴 不一致 ⇒ 這支尺自己壞了"))
print("\n② 的清單:")
for v, f in sorted(board_hit): print(f"    {v}  ⇐ {f}")
print("\n③a 的清單(丙會降級 ⇒ 不算進升乙的分子):")
for v in sorted(third_a): print(f"    {v}")
print("\n③b 的清單(真卡住 ⇒ 算進分子):")
for v in sorted(third_b): print(f"    {v}")
if malformed:
    print("\n④ 壞掉的列(欄數<2, 前 40 字):")
    for v in malformed: print(f"    {v}")
