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

hits, total_chains, files_scanned = [], 0, 0
for root in ROOTS:
    for p in root.rglob('*.ts'):
        if 'node_modules' in p.parts or '.test.' in p.name:
            continue
        files_scanned += 1
        src = p.read_text(encoding='utf-8', errors='replace')
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

print(f"掃過 .ts 檔 = {files_scanned}")
print(f"找到 .from( chain 總數 = {total_chains}   ← 分母")
print(f"其中【沒有】明示上限 = {len(hits)}")
print("---")
for f, l, t in sorted(hits):
    print(f"{f}:{l}  from({t})")
