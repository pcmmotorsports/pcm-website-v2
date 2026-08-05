# B2-S2 前置實跑紀錄(`B-130-A` ① 兩個未確認件)

> 2026-08-06 夜跑窗(worktree `pcm-a4a-chain`)。**唯讀性質**:全程在拋棄庫,零正式站寫入、零 repo migration 改動。
> 結論摘要見 `docs/specs/2026-08-06-e10-b2-s2-shipped-summary-plan.md` §7;本檔留**指令 + 原始輸出**供 S2 審查引用。

## §0 環境

- 拋棄庫 A:`/tmp/b2s2p`,**port 54345**(用於未確認件 ①②)
- 拋棄庫 B:`/tmp/b2ctlA`,**port 54347**(用於三組對照的 A/B 組)
- 🔴 全程未碰 `54329` / `54331`;`54342`(前一棒 `b2night2`)本輪未動、開工時仍在跑。
- S2「形狀替身」stub:`scratchpad/s2-shape-stub.sql`,**只用 psql 套進拋棄庫,未進 repo、未 commit**。
  複製 S2 的三個結構特徵:①加 `shipped_quantity` 欄 + C8/C9/C6′ ②A4a helper 四軸化
  ③兩支重算 trigger(`shipment_items` I/U/D、`shipments` AFTER UPDATE OF `shipped_at, deleted_at`)。

🔴 **`supabase/migrations/` 目錄本輪零改動** —— 原本打算塞一支 stub migration 進去實測 provision,
被 harness 的 classifier 擋下;改用「讀腳本 + 天然實驗 + psql 直套拋棄庫」達成同樣的判別力(見 §1)。

---

## §1 未確認件 ①:`provision` 會不會把未來的 S2 一起套進拋棄庫 → **會**

### 1.1 讀腳本

`scripts/d1t2-rehearsal.sh:53`:

```bash
for f in supabase/migrations/*.sql; do
  case "$f" in
    *20260723120000*) echo "  跳過(pg_cron/vault):$f" >&2; continue ;;
  esac
```

glob 全收,唯一硬編碼跳過 = `20260723120000`。無 allowlist、無版本上限。

### 1.2 天然實驗(比塞假 migration 更有力)

B2 三支 migration 是這支腳本寫成**之後**才進目錄的。實跑:

```bash
cd /Users/sean_1/pcm-a4a-chain && export PORT=54345
rm -rf /tmp/b2s2p && mkdir -p /tmp/b2s2p && : > /tmp/b2s2p/.a1-throwaway
scripts/d1t2-rehearsal.sh provision /tmp/b2s2p
```

輸出(節錄):

```
== 3/5 套 migrations(跳過 pg_cron 那支;fitments 快照插在首引用之前) ==
  跳過(pg_cron/vault):supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql
psql:...20260805170100_m4b_e10_b2_s1a2_shipments_guards.sql:330: NOTICE:  B2 S1a-2 結構驗收全數通過(...)
psql:...20260805170200_m4b_e10_b2_s1b_shipment_items.sql:466: NOTICE:  B2 S1b 結構驗收全數通過(...)
provision 完成:D1_DB_URL=postgresql://postgres@127.0.0.1:54345/postgres cluster-id=7670567451962066237
PROV-RC=0
```

拋棄庫實查:

```
SELECT to_regclass('public.shipments')||' / '||to_regclass('public.shipment_items')
→ shipments / shipment_items

SELECT string_agg(attname,',' ORDER BY attnum) FROM pg_attribute
 WHERE attrelid='public.order_item_quantity_summary'::regclass AND attnum>0 AND NOT attisdropped
→ order_item_id,quantity,ordered_quantity,instock_quantity,cancelled_quantity
```

⇒ 後加的 migration 確實被套。**S2 同理必被套。**
⇒ provision 是 `a1-verify` / `a4a-verify` / `a6-verify` / `a7*` 一族的共用地基,
S2 一落地,每一支走 provision 的 harness 都在四軸世界裡跑。

---

## §2 未確認件 ②:S2 落地後 a1-verify 的行為探針紅不紅 → **不紅,61/0 全綠**

### 2.1 兩次 a1-verify(唯一變因 = S2 形狀替身)

```bash
export PORT=54345
scripts/a1-verify.sh run /tmp/b2s2p                    # 基準
psql "$U" -v ON_ERROR_STOP=1 -q -f scratchpad/s2-shape-stub.sql
scripts/a1-verify.sh run /tmp/b2s2p                    # S2 形狀已套
```

| 情境 | 結果 | 🔴 格數 |
|---|---|---|
| S2 未套(基準) | `════════ A1 驗證結果:PASS=61 / FAIL=0 ════════` | 0 |
| S2 形狀已套 | `════════ A1 驗證結果:PASS=61 / FAIL=0 ════════` | 0 |

兩次尾段逐字相同(含 9/9「對照組:結構 + 行為皆綠」)。

### 2.2 為什麼不紅(機制)

```bash
grep -oE '(INSERT INTO|UPDATE|DELETE FROM)[[:space:]]+public\.[a-z_]+' scripts/a1-behavior-probe.sql | sort | uniq -c
→ 16 INSERT INTO public.order_item_quantity_summary
→  7 DELETE FROM public.order_item_quantity_summary
→  2 INSERT INTO public.order_items

grep -c 'pcm_a4a' scripts/a1-behavior-probe.sql
→ 0
```

探針對摘要表**直寫**,從不經過 A4a 重算鏈 ⇒ 四軸 helper 那條路徑在整支 harness 裡從未被走到。

⇒ **R3 的 F5「S2 落地後 a1-verify 保證全紅」= 證偽。**
⇒ v5 §7.1 我方「結構斷言照樣綠」的推理 = 對,但不完整 —— 問題不在斷言。

### 2.3 真正的問題:a1-verify 把庫留在 A4a 必爆態

同一個庫(a1-verify 跑完之後):

```
BEGIN; SELECT public.pcm_a4a_recompute_order_item_summary('30b68889-…'); ROLLBACK;
→ ERROR:  column "shipped_quantity" of relation "order_item_quantity_summary" does not exist
   查詢: INSERT INTO public.order_item_quantity_summary

BEGIN; INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
       VALUES ('30b68889-…','d37a2463-…',1); ROLLBACK;
→ ERROR:  column "shipped_quantity" of relation "order_item_quantity_summary" does not exist
```

第二個是**走真 trigger 路徑**、不是直呼。零留痕確認:`SELECT count(*) FROM order_item_procurement → 0`。

原因 = `a1-verify.sh:113-119` 的 `drop_a1()`(`DROP TABLE order_item_quantity_summary`)+
`9/9 對照組`(`:447-455`)重套 **A1 單獨一支** ⇒ 表回到 5 欄,而四軸 helper 與兩支 trigger 還在。

---

## §3 三組對照(把「誰造成紅」分乾淨)

🔴 若只跑 C 組,31 紅會被誤讀成「S2 把 a4a-verify 打壞了」而去改 S2。

| 組 | 情境 | 指令 | `a4a-verify` 結果 | `shipped_quantity` 錯誤 |
|---|---|---|---|---|
| **A** | 乾淨庫、無 S2 | provision(54347)→ `a4a-verify.sh /tmp/b2ctlA` | `PASS=65 FAIL=0 SKIP=0(CELL=40 MUT=10)` | 0 |
| **B** | S2 形狀已套、**沒跑** a1-verify | 同庫套 stub → 再跑一次 | `PASS=64 FAIL=1 SKIP=0(CELL=40 MUT=10)` | 0 |
| **C** | S2 形狀已套、**跑過** a1-verify | 54345 那庫(§2) | `PASS=34 FAIL=31 SKIP=0(CELL=40 MUT=10)` | **23** |

⇒ **C 的 31 紅裡有 30 條來自 a1-verify 留下的斷裂態,不是 S2 本身。**

C 組紅格樣本(前幾條):

```
FAIL [R1] 採購 INSERT → 摘要列 (2,0,0)、quantity 複製 — ERROR: column "shipped_quantity" … does not exist
FAIL [R2] 只 INSERT receipt → received=2 且 instock=2 — ERROR: column "shipped_quantity" … does not exist
FAIL [R4] 取消 INSERT → cancelled=2 惰性建列 — ERROR: column "shipped_quantity" … does not exist
FAIL [R12] 摘要被竄改後,下一次來源事件自癒 — ERROR: column "shipped_quantity" … does not exist
```

### 3.1 B 組那唯一 1 紅 = 第二個產出

```
FAIL 突變 N8 upsert DO UPDATE 加 WHERE false ⇒ alloc 3→4 摘要凍在 3(R5 翻面)
     — ERROR:  syntax error at or near ","
```

`a4a-verify.sh` 的 DB 內突變靶是**對 helper 原始碼做文字改寫**。helper 一被 S2 改寫,
該錨失效,而失效的形狀是**語法錯**,不是「那格紅得漂亮」。
⇒ S2c 必須同批更新 N8 的錨,並驗「突變真的翻面」而不是「紅了就算」。
(同型教訓:memory `feedback_text-level-guard-blind-to-invalid-syntax`。)

### 3.2 共用 port 讓爆炸半徑變大

```
scripts/a1-verify.sh:35   PORT="${PORT:-54329}"
scripts/a4a-verify.sh:17  URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
```

兩支預設同一個 port ⇒ **預設情況下先跑 a1-verify 再跑 a4a-verify 就會踩到 C 組。**

---

## §3.3 🪧 地雷牌:`a1-verify` 與 `a4a-verify` 共用預設 port 54329(backlog 候選)

> `B-132-A` ③ 要求:今晚**不改腳本**(那是 S2c 片的事),先把地雷插牌。

```
scripts/a1-verify.sh:35   PORT="${PORT:-54329}"
scripts/a4a-verify.sh:17  URL="postgresql://postgres@127.0.0.1:${PORT:-54329}/postgres"
```

**症狀(S2 落地後才會出現,今天不會)**:同一台機器上依預設值先跑 `a1-verify` 再跑 `a4a-verify`,
第二支會踩到 §2.3 的斷裂態 ⇒ **34/31**,而且 31 紅裡 30 條的成因**不在 a4a-verify 自己身上**。
診斷者若沒跑 §3 的三組對照,會把它讀成「S2 把 A4a 打壞了」而去改 S2 —— **改錯地方**。

**同 port 家族實查**(`grep -rn 'PORT=' scripts/*.sh`):
`a1-verify` / `a7-verify` / `a7bm-verify` / `a7c-preflight` / `a7t-verify` / `a1-lock-probe` /
`d1t2-rehearsal` / `a7bt-fixtures` / `a4a-verify` **預設皆 54329**;
`a8a1/a8a2/a8c1/a8c2-verify` 走 54331;`a7t-concurrency-probe`=54332、`b2s1-concurrency-probe`=54333。

**候選修法(三選一,S2c-3 片決定;今晚不做)**
1. `a1-verify` 收尾把庫還原(§2.3 的處置,S2 plan §7.3)—— 治本,但選檔規則已被 R2 證明會誤選。
2. 讓 `a1-verify` 用專屬 port(改預設值)—— 最小,但只是把兩支隔開、不解決「留下斷裂態」本身。
3. 兩者都做。

🔴 **無論選哪個,都要先有一格「跑完後直呼 helper 必須成功」的活體斷言**,否則修了也沒人知道有沒有生效。

---

## §4 誠實邊界

- 量的是**「S2 形狀替身」**,不是真 S2。結論效力範圍 = 任何「加欄 + 改寫 helper」形狀的 S2;
  若最終 S2 改成不動 helper(另開一支重算函式),§2 必須重驗。
- C 組 31 紅**只做了成因分類**(23 條帶 `shipped_quantity` 字樣),沒有逐格追因;
  歸因靠 A/B/C 三組差分,不是逐格閱讀。
- a1-verify 的 61/0 是在替身之下量的。真 S2 若同時動 `a1-verify.sh` 或 A1 migration 本身,數字會變。
- 本輪**未**驗證「provision 在 S2 存在時,5/5 的 seed 步驟會不會被四軸 helper 影響」——
  替身是 provision **之後**才套的。真 S2 進目錄後,seed 會在四軸世界裡跑;
  推理上安全(那時表已有 6 欄),但**未實測**,列為 S2 開工首日的第一格。

—— 完 ——
