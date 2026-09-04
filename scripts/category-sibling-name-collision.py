#!/usr/bin/env python3
"""category-sibling-name-collision.py — 同一個父層底下不得有兩個同名分類。

用法
  python3 scripts/category-sibling-name-collision.py              # 掃正式庫(唯讀)
  python3 scripts/category-sibling-name-collision.py --selftest   # 不碰 DB, 驗判定邏輯

🔴 **守的是什麼(而【不是】守什麼)** ——
   顧客站的解析器回的是分類【名字】(`parse-search-facets.ts`),而網址走 `父 · 子` 的路徑。
   ⇒ 📌 **跨不同父層的同名【不是問題】** —— 路徑不同, 分得開。
     實例:`維修零件` 有 3 列、`水管束環` / `防爆水管組` 各 2 列 —— 線【前台】2026-09-04 查過,
     它們**是不同的東西**(機車一個、四輪 ATV 一個)⇒ **不能合併**。
   🔴 **而【同一個父層底下】兩個同名, 那才是真的分不開** —— 名字一樣、路徑一樣。
   ⇒ 本支只守後者。

⚠️ **今天的事實不是保證**:2026-09-04 量到同層同名 **0** ——
   而**沒有任何 DB constraint 在擋它**(線【前台】查的)⇒ 它是「今天剛好沒有」。
   🛑 而主視窗 2026-09-04 裁定**做掃描守門、不做 DB constraint**:
      constraint 要 Sean 貼, 而**唯一性可能是刻意不強制的 —— 我們不知道**;
      掃描只會叫、不會擋任何人建東西 ⇒ 零風險而拿得到訊號。

🔴🔴 **這支【還沒有接上任何會自動跑的東西】**(2026-09-04 交件時的事實):
   · 單元測試碰不到正式庫(worktree / CI 都沒有那組 env)
   · 唯一有正式庫金鑰又會定期跑的是 `.github/workflows/rpm-sync.yml`(每日 cron)
   · 🛑 **而寫這支的人不被允許改 `.github/workflows/*`** ⇒ 接線要另一個人做。
   ⇒ 📌 **在它被接上之前, 這支與「沒有守門」印同一個綠** —— 那句話要跟著這支檔走。
"""
import io, json, os, re, subprocess, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def find_collisions(rows):
    """rows = [{'id','name','parent'}]。回同一個父層底下同名的那幾組。**純函式, 不碰 DB。**"""
    seen = {}
    for r in rows:
        key = (r['parent'], r['name'])          # parent 為 None 代表頂層
        seen.setdefault(key, []).append(r['id'])
    return [{'parent': p, 'name': n, 'ids': ids} for (p, n), ids in seen.items() if len(ids) > 1]


if '--selftest' in sys.argv[1:]:
    WORLDS = [
        ('乾淨:名字都不同',            [{'id': 'a', 'name': 'X', 'parent': 'p1'},
                                        {'id': 'b', 'name': 'Y', 'parent': 'p1'}], 0),
        ('🔴 髒的:同一父層兩個同名',   [{'id': 'a', 'name': 'X', 'parent': 'p1'},
                                        {'id': 'b', 'name': 'X', 'parent': 'p1'}], 1),
        ('🔵 跨父層同名 ⇒ 【不該叫】',  [{'id': 'a', 'name': 'X', 'parent': 'p1'},
                                        {'id': 'b', 'name': 'X', 'parent': 'p2'}], 0),
        ('🔴 頂層兩個同名(parent 皆 None)', [{'id': 'a', 'name': 'X', 'parent': None},
                                             {'id': 'b', 'name': 'X', 'parent': None}], 1),
    ]
    bad = 0
    for name, rows, want in WORLDS:
        got = len(find_collisions(rows))
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name:<34} 期望 {want} · 實得 {got}')
        if not ok:
            bad += 1
    # 🔴 第三個世界是這支自檢的重點 —— 它是【不該叫】的那一側。
    #    一把只驗過「該叫時會叫」的尺, 它的【不該叫】那一側從來沒有被跑過,
    #    而那一側正是它每天要拿來說「今天沒事」的方向。
    if bad:
        print(f'🔴 自檢 FAIL:{bad} 個世界的判定不對')
        sys.exit(1)
    print('✅ 自檢通過:四個世界(含【跨父層同名不該叫】那一格)判定都對。')
    print('⚠️ 而它只驗判定邏輯 —— 「它撈不撈得到正式庫」那一半靠真的跑一次時被驗。')
    sys.exit(0)

# ── 真的掃正式庫(唯讀) ──────────────────────────────────────────────
env = os.environ.get('PCM_READONLY_DATABASE_URL')
if not env:
    sys.exit('🔴 沒載到 PCM_READONLY_DATABASE_URL ⇒ **沒有查, 不是查無**。'
             '(本機:`set -a; . .env.local; set +a` 之後再跑)')

SQL = ("select coalesce(parent_category_id::text,''), name, id::text "
       "from public.categories order by 1, 2;")
p = subprocess.run(['psql', env, '-At', '-F', '\t', '-c', SQL], capture_output=True, text=True)
if p.returncode != 0:
    sys.exit(f'🔴 查詢失敗 rc={p.returncode} ⇒ **沒有查, 不是查無**\n{p.stderr[:400]}')

rows = []
for line in p.stdout.splitlines():
    if not line.strip():
        continue
    par, name, cid = line.split('\t')
    rows.append({'id': cid, 'name': name, 'parent': par or None})

if not rows:
    sys.exit('🔴 一列都沒撈到 ⇒ 尺壞了, 不要讀成「沒有分類」')

hits = find_collisions(rows)
print(f'分母:分類 {len(rows)} 列 · 不重複名字 {len({r["name"] for r in rows})}')
print(f'🟢 正對照(證明這把尺看得到同名):全庫同名的名字 '
      f'{len({r["name"] for r in rows}) != len(rows) and len([1 for n in {r["name"] for r in rows} if sum(1 for r in rows if r["name"] == n) > 1]) or 0} 個'
      ' —— 而那些是【跨父層】的, 本支刻意不叫。')
if hits:
    print(f'🔴 同一個父層底下有同名分類 {len(hits)} 組:')
    for h in hits:
        print(f'   父={h["parent"] or "(頂層)"} · 名字「{h["name"]}」· {len(h["ids"])} 列:{h["ids"]}')
    sys.exit(1)
print('✅ 同一個父層底下沒有同名分類。')
