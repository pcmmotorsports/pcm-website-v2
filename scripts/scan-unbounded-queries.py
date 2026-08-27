#!/usr/bin/env python3
"""掃「頂層查詢沒有明示上限」。

一個 supabase 查詢 chain 從 `.from(` 起、到該敘述結尾(`;`)止。
chain 內若沒有 limit / range / single / maybeSingle / head，就是「可能被 max-rows 靜默截斷」。

⚠️ 本尺的界線(先寫,免得結果被讀成比它強)：
  · 只掃 `.from(` 這種 chain 寫法，**掃不到** `.rpc(` 與裸 SQL。
  · `.eq('id', …)` 這種必定單列的查詢也會被列進來 ⇒ **會多報**，要人工看。
  · 跨檔案組裝的 chain（select 常數在別處）仍算得到，因為我看的是 chain 本身。
"""
import re, sys, pathlib

BOUNDED = re.compile(r"\.(limit|range|single|maybeSingle)\s*\(|count\s*:\s*['\"]exact['\"]")
ROOTS = [pathlib.Path('packages'), pathlib.Path('apps')]

hits, total_chains, files_scanned, unreadable = [], 0, 0, 0
for root in ROOTS:
    for p in root.rglob('*.ts'):
        if 'node_modules' in p.parts or '.test.' in p.name:
            continue
        files_scanned += 1
        try:
            src = p.read_text(encoding='utf-8', errors='replace')
        except OSError:
            unreadable += 1
            continue
        for m in re.finditer(r"\.from\(", src):
            end = src.find(';', m.start())
            if end == -1:
                end = m.start() + 400
            chain = src[m.start():end]
            total_chains += 1
            if not BOUNDED.search(chain):
                line = src.count('\n', 0, m.start()) + 1
                tbl = re.search(r"\.from\(\s*['\"]([^'\"]+)", chain)
                hits.append((str(p), line, tbl.group(1) if tbl else '?'))

# ─────────────────────────────────────────────────────────────────────────────
# 🔴 焊死的自檢:這支尺的失效形狀是「印 0」,而 0 與『乾淨』在畫面上是同一件事。
#    ⇒ 三態,不是兩態:0=掃完零命中 / 1=掃完有命中 / 2=尺自己壞了(輸出作廢)。
#    2 必須與 0 分得開 —— 不然「跑錯目錄」會被讀成「這個 repo 很乾淨」。
# ─────────────────────────────────────────────────────────────────────────────
_BOUND_POS = ".from('orders').select('*').limit(50)"      # 該判 bounded
_BOUND_NEG = ".from('orders').select('*').eq('a', 1)"     # 該判 unbounded
checks = [
    ("判別式雙向 · 有上限判得出、沒上限也判得出",
     bool(BOUNDED.search(_BOUND_POS)) and not BOUNDED.search(_BOUND_NEG),
     f"正例={bool(BOUNDED.search(_BOUND_POS))} 負例={not BOUNDED.search(_BOUND_NEG)}"),
    ("掃描根目錄真的存在(跑錯 cwd ⇒ 這裡紅,不會靜靜印 0)",
     all(r.is_dir() for r in ROOTS),
     "  ".join(f"{r}={'在' if r.is_dir() else '不在'}" for r in ROOTS)),
    ("真的掃到檔(files_scanned > 0)", files_scanned > 0, f"files_scanned={files_scanned}"),
    ("真的抓到 chain(total_chains > 0)", total_chains > 0, f"total_chains={total_chains}"),
    # 🔴 原本這格硬寫 True = 恆真自檢(2026-08-20 codex must-fix)。
    #    有檔讀不到而其餘都有上限時,hits=0 ⇒ 會錯回 0「乾淨」,而真相是【有一塊沒掃到】。
    ("讀不到 vs 零命中 分得開(有讀不到的檔 ⇒ 這格紅)", unreadable == 0,
     f"讀不到={unreadable} 命中={len(hits)}"),
]
print("=== 自檢(任一 FAIL ⇒ 本次輸出作廢,exit 2)===")
for name, ok, detail in checks:
    print(f"  {'PASS' if ok else '🔴FAIL'}  {name}  [{detail}]")
print()
if not all(ok for _, ok, _ in checks):
    print("🔴 尺自己壞了 ⇒ 下面的數字不要引用。exit 2")
    sys.exit(2)

print(f"掃過 .ts 檔 = {files_scanned}")
print(f"找到 .from( chain 總數 = {total_chains}   ← 分母")
print(f"其中【沒有】明示上限 = {len(hits)}")
print("---")
for f, l, t in sorted(hits):
    print(f"{f}:{l}  from({t})")

print()
print("--- 這個數字的分母(不帶著走就會被讀成比它強)---")
print(f"  掃 {ROOTS} 底下的 *.ts;跳過 node_modules 與 *.test.*")
print("  只認 .from( 這種 chain 寫法 ⇒ .rpc( 與裸 SQL 不在分母裡")
print("  .eq('id', …) 這種必定單列的也會被列進來 ⇒ 會多報,要人工看")
print()
# 🔴 exit 1 = 有命中。注意:它【現在就有命中】,所以這支目前是恆 1 ——
#    要把它接進 lint-staged 之類的守門,得先有一條基線,否則每次 commit 都紅。
sys.exit(1 if hits else 0)
