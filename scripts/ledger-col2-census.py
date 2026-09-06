#!/usr/bin/env python3
"""帳本第二欄普查:每一列的 sha 到底在量哪一個東西。唯讀。
三格互斥且窮盡:repo 檔 / 貼板那份 / 兩者都不是。三數和必須 = 資料列數。"""
import hashlib, io, os, sys, glob

# --selftest:掛在 lint-staged 上。🔴 它驗的是【這支腳本的判別力】, 不是帳本對不對。
#    · 分割必須互斥窮盡:三格相加 = 資料列數(不等 ⇒ 分類邏輯漏了一條路徑)
#    · 負對照:一個現造的 sha 不准落進 ① 或 ②
#    🛑 它【不】驗「② 一定 > 0」—— 沒有信箱的機器上貼板分母是 0, 而那時三格照樣相加正確。
#      ⇒ 所以輸出一律把【貼板分母】印出來:分母 0 時, ② 的 0 什麼都不代表。
#    ⚠️ 本腳本不碰 git ⇒ 不需要剝 GIT_* 環境。

REPO = os.path.expanduser("~/pcm-wt-db")
LEDGER = os.path.join(REPO, "supabase/APPLIED.tsv")
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

rows, repo_hit, board_hit, neither = 0, [], [], []
for line in io.open(LEDGER, encoding="utf-8"):
    line = line.rstrip("\n")
    if not line or line.startswith("#"): continue
    c = line.split("\t")
    if len(c) < 2: continue
    rows += 1
    ver, want = c[0], c[1]
    cands = glob.glob(os.path.join(REPO, "supabase/migrations", ver + "_*.sql"))
    if cands and sha(cands[0]) == want: repo_hit.append(ver); continue
    if want in board: board_hit.append((ver, os.path.basename(board[want][0]))); continue
    neither.append(ver)

if "--selftest" in sys.argv:
    ok = True
    if len(repo_hit)+len(board_hit)+len(neither) != rows:
        print("🔴 selftest FAIL:三格相加不等於資料列數 ⇒ 分類漏了一條路徑"); ok = False
    fake = "f" * 64
    if fake in board:
        print("🔴 selftest FAIL:現造的 sha 竟然在貼板 map 裡"); ok = False
    if rows == 0:
        print("🔴 selftest FAIL:帳本零資料列 ⇒ 這支腳本這一發沒有分母"); ok = False
    print(f"selftest {'PASS' if ok else 'FAIL'}:資料列 {rows} · 三格和 "
          f"{len(repo_hit)+len(board_hit)+len(neither)} · 貼板分母 {nfiles} 個檔")
    sys.exit(0 if ok else 1)

print(f"貼板分母:{len(glob.glob(BOARD_GLOBS))} 個目錄 / {nfiles} 個檔 / {len(board)} 個相異 sha")
print(f"帳本資料列 {rows}")
print(f"  ① 等於 repo 檔 sha      {len(repo_hit)}")
print(f"  ② 等於貼板那份 sha      {len(board_hit)}")
print(f"  ③ 兩者都不是            {len(neither)}")
print(f"  ①+②+③ = {len(repo_hit)+len(board_hit)+len(neither)}  (必須等於 {rows})")
print("\n② 的清單:")
for v, f in sorted(board_hit): print(f"    {v}  ⇐ {f}")
print("\n③ 的清單:")
for v in sorted(neither): print(f"    {v}")
