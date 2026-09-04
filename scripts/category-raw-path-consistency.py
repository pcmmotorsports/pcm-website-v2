#!/usr/bin/env python3
"""category-raw-path-consistency.py — `raw_path` 與【父 · 子】對不對得起來。

用法
  python3 scripts/category-raw-path-consistency.py            # 掃正式庫(唯讀)
  python3 scripts/category-raw-path-consistency.py --selftest # 不碰 DB, 驗判定邏輯

🔴🔴 **它與那道 UNIQUE 的分工 —— 這一段是本檔存在的全部理由**
```
categories_raw_path_key = UNIQUE(raw_path)   擋的是【路徑撞車】
本閘                                          擋的是【路徑與父子關係脫鉤】
🔴 而兩者【等價, 只在 raw_path 一直被維護成「父 · 子」的前提下】
⇒ 📌 一道 UNIQUE 加一個【沒有人在維護的約定】, 合起來看起來像一道完整的保護。
⇒ 🎯 本閘守的正是那個【約定】。
```
🔬 **實例**:`水管束環` 在正式庫有兩列, 父分別是 `引擎與冷卻` 與 `四輪 ATV/UTV`,
   raw_path 分別是「引擎與冷卻 · 水管束環」「四輪 ATV/UTV · 水管束環」⇒ UNIQUE 過得了, 而它們是不同的東西。
   🔴 **而若有人插一列 raw_path 手寫成別的東西, 名字撞車就會滑過去 —— 而 UNIQUE 不會叫。**

⛔ ~~本檔原名 `category-sibling-name-collision.py`, 判準是「同一父層底下不得有同名」~~
   ⇒ 🔴 **那個不變式【已經被 `categories_raw_path_key` 擋著了】**(2026-09-04 實查索引),
     而寫它的人(包括我)以為沒有東西在擋 —— 板列逐字寫「沒有任何 constraint 在擋」。
   ⇒ 📌 **那句話的問題不是查錯, 是【分母漏了等價路徑】**:
     它查的是「有沒有針對 `(parent_id, name)` 的 constraint」—— **那個確實沒有**;
     而擋著同一件事的是一道**對另一個欄位**的 UNIQUE。
   ⇒ ✅ 舊字面留著, 讓搜「同名兄弟」的人同一發撞到這裡。

🔴🔴 **這支【還沒有接上任何會自動跑的東西】**(2026-09-04 交件時的事實):
   單元測試碰不到正式庫;唯一有正式庫金鑰又會定期跑的是 `.github/workflows/rpm-sync.yml`,
   而寫這支的人**不被允許改 `.github/workflows/*`** ⇒ 接線要另一個人做。
   ⇒ 📌 **在它被接上之前, 這支與「沒有守門」印同一個綠。**
"""
import os, subprocess, sys

SEP = ' · '   # 🔴 與 `products-url-parsers.ts` 的 CATEGORY_URL_SEPARATOR 同一個字面。
              #    ⚠️ 它是【複述】不是 import(這裡是 python, 那邊是 TS)⇒ 那邊改了這裡不會紅。
              #    ⇒ 而 2026-09-04 實查正式庫 117 列全部用這個分隔符 ⇒ 今天成立。


def find_mismatch(rows):
    """rows = [{'id','name','parent','raw_path'}](parent 是父的 **名字**, 頂層為 None)。
    回 raw_path 與【父 · 子】對不起來的那幾列。**純函式, 不碰 DB。**"""
    out = []
    for r in rows:
        want = r['name'] if r['parent'] is None else f"{r['parent']}{SEP}{r['name']}"
        if r['raw_path'] != want:
            out.append({'id': r['id'], 'name': r['name'], 'got': r['raw_path'], 'want': want})
    return out


if '--selftest' in sys.argv[1:]:
    WORLDS = [
        ('頂層:raw_path = 名字',        [{'id': 'a', 'name': 'X', 'parent': None, 'raw_path': 'X'}], 0),
        ('子類:raw_path = 父 · 子',     [{'id': 'b', 'name': 'Y', 'parent': 'P', 'raw_path': f'P{SEP}Y'}], 0),
        # 🔴 這一發是【真的造一列歪掉的】, 不是把期望值改掉 ——
        #    有人手寫 raw_path、而它與 parent+name 對不起來, 正是 UNIQUE 抓不到的那一種。
        ('🔴 手寫歪掉:raw_path 與父子脫鉤', [{'id': 'c', 'name': 'Y', 'parent': 'P', 'raw_path': '別的東西 · Y'}], 1),
        # 🔵 而【跨父層同名】不該叫 —— 那是正式庫今天真實存在的形狀(水管束環 ×2)
        ('🔵 跨父層同名而路徑各自正確 ⇒ 不該叫',
         [{'id': 'd', 'name': 'Z', 'parent': 'P1', 'raw_path': f'P1{SEP}Z'},
          {'id': 'e', 'name': 'Z', 'parent': 'P2', 'raw_path': f'P2{SEP}Z'}], 0),
    ]
    bad = 0
    for name, rows, want in WORLDS:
        got = len(find_mismatch(rows))
        ok = got == want
        print(f'  {"✅" if ok else "🔴"} {name:<38} 期望 {want} · 實得 {got}')
        bad += 0 if ok else 1
    if bad:
        print(f'🔴 自檢 FAIL:{bad} 個世界的判定不對')
        sys.exit(1)
    print('✅ 自檢通過:四個世界(含【真的造一列歪掉的】與【不該叫的那一側】)判定都對。')
    print('⚠️ 而它只驗判定邏輯 —— 「它撈不撈得到正式庫」那一半靠真的跑一次時被驗。')
    sys.exit(0)

# ── 真的掃正式庫(唯讀) ──────────────────────────────────────────────
url = os.environ.get('PCM_READONLY_DATABASE_URL')
if not url:
    sys.exit('🔴 沒載到 PCM_READONLY_DATABASE_URL ⇒ **沒有查, 不是查無**。')

SQL = ("select c.id::text, c.name, coalesce(p.name,''), coalesce(c.raw_path,'') "
       "from public.categories c left join public.categories p on p.id = c.parent_category_id "
       "order by c.name;")
proc = subprocess.run(['psql', url, '-At', '-F', '\t', '-c', SQL], capture_output=True, text=True)
if proc.returncode != 0:
    sys.exit(f'🔴 查詢失敗 rc={proc.returncode} ⇒ **沒有查, 不是查無**\n{proc.stderr[:400]}')

rows = []
for line in proc.stdout.splitlines():
    if not line.strip():
        continue
    cid, name, par, raw = line.split('\t')
    rows.append({'id': cid, 'name': name, 'parent': par or None, 'raw_path': raw})

if not rows:
    sys.exit('🔴 一列都沒撈到 ⇒ 尺壞了, 不要讀成「沒有分類」')

hits = find_mismatch(rows)
ok_n = len(rows) - len(hits)
print(f'分母:分類 {len(rows)} 列')
print(f'🟢 正對照:raw_path 與【父 · 子】對得起來的 {ok_n} 列 —— 該非零, 否則是分隔符或欄位讀錯')
if hits:
    print(f'🔴 對不起來的 {len(hits)} 列:')
    for h in hits:
        print(f'   {h["name"]}(id={h["id"]})· 現在是「{h["got"]}」· 應該是「{h["want"]}」')
    sys.exit(1)
print('✅ 每一列的 raw_path 都與它的【父 · 子】對得起來。')
