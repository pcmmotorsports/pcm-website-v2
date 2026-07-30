# N3a + N3b Slice Plan —— 訂單編號產號器換成 6 碼亂碼(2026-07-30)

> **拍板來源**:Sean 2026-07-30 拍 Q1=A(`docs/specs/2026-07-30-order-renumber-instead-of-delete.md:96-103`)。
> **格式合約**:`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.4a(:512-526)—— 片級 plan 不得改寫。
> **片型**:兩片皆 **高風險片**(鐵則 12 ③ DB 結構)。鐵則 8 適用 ⇒ 本檔待 Sean 批准才動工。

---

## §0 範圍

### Sean 2026-07-30 第二輪三拍板(本檔 §7 原三題)

| 題 | 答 | 連動 |
|---|---|---|
| Q1 產號用盡的 LINE 告警(規格 N3b-app) | **A = 不做、記 backlog** | 施工範圍不含 N3b-app;殘餘風險見 §5 第 3 條 |
| Q2 動工前要不要跑 codex 關卡1 審 plan | **A = 兩關都跑** | 本檔須先過關卡1、findings 折入後才動工 |
| Q3 domain 的舊格式驗證器 | **B = 本次一起改對** | **新增 N2 片**(見 §2a) |

| 片 | 型 | 內容 | 檔 |
|---|---|---|---|
| **N2** | D | domain `display-id.ts`:刪舊格式產號器、驗證改成兩收 | `packages/domain/src/order/display-id.ts` 等 |
| **N3a** | T | 新建 `public.pcm_generate_display_id() RETURNS text` | `supabase/migrations/20260730120000_m4b_e10_n3a_pcm_generate_display_id.sql` |
| **N3b** | R | `create_order` 段 8 改呼叫它 + 有界重試 | `supabase/migrations/20260730120100_m4b_e10_n3b_create_order_new_display_id.sql` |

施工序 = **N2 → N3a → N3b**。N2 可獨立上線(規格 :551 逐字:純型別/測試層、對結帳零 runtime 影響),
故排最前、先落地最小的一片。

**明確不做**(Sean 拍板):N3c 收窗 / 收緊 `orders_display_id_format` CHECK / 舊 30 張改號 /
D1 全線 / N3b-app。
**Sean 已知並接受**:`display_id` 欄位新舊兩種格式永久並存。

---

## §1 實查事實(每條都已驗;非推測)

| # | 事實 | 來源 |
|---|---|---|
| 1 | **pgcrypto 1.3 已裝、schema = `extensions`** | production 唯讀 `list_extensions`(2026-07-30) |
| 2 | 但 **repo 內零 `CREATE EXTENSION`** ⇒ 隔離環境不會自動有它(#299 同一病灶)。🔴 **已實跑證實、非推論**:`d1t2-rehearsal.sh provision` 跑完 31 支 migration 後查 = `NO-extensions-schema \| NO-pgcrypto` | `grep -rn "CREATE EXTENSION" supabase/migrations/` = 0 命中 + 2026-07-30 隔離庫實跑 |
| 3 | UNIQUE 約束名確為 **`orders_display_id_key`**(`UNIQUE (display_id)`、contype=`u`) | production 唯讀 `pg_constraint` 實查 |
| 4 | ⚠️ 它是 `20260604120000:94` 的 **inline `UNIQUE` 未具名**、名字由 PG 自動生成 ⇒ 必須實查而非照抄慣例 | `20260604120000_m3_s2a_orders_order_items.sql:94` |
| 5 | `orders` 上其他 UNIQUE:`orders_pkey(id)`、`orders_legacy_display_id_key`、`orders_tappay_rec_trade_id_key`。**create_order 的 INSERT 三者都不寫值** ⇒ 唯一可能碰撞的就是 `display_id` | production 唯讀實查 |
| 6 | 正式站現行 `create_order` **只有 9-param 一個 overload**、owner=`postgres`、ACL=`{postgres=X/postgres,authenticated=X/postgres}` | production 唯讀 `pg_proc` 實查 |
| 7 | 正式站現行 `create_order` **完整指紋 = `850e2e3cf5f503391df5fe6fe0067cce`**,與 repo 內宣稱的「狀態 B」常數**逐字元相符** | production 唯讀實查 + `20260719120000:180` |
| 8 | RF2a-0 / RF2a-2 只在註解提到 `create_order`、**沒有重新定義它** ⇒ 07-19 那支就是當前生效版 | 逐檔 grep(4 命中皆非 `CREATE FUNCTION`) |
| 9 | 放寬後的 `orders_display_id_format` CHECK **已在正式站生效**、6 碼寫得進去 | production 唯讀實查(定義逐字含 `[23456789BCDFGHJKMNPQRSTVWXYZ]{6}`) |
| 10 | 🔴 **`assertDisplayId`(還在驗舊格式)全樹唯一呼叫端是 domain factory `createOrder`,而 `createOrder` 零生產呼叫端** —— 我自己重驗過規格這條宣稱,成立 | `order.ts:253`;`grep -rn createOrder` 命中僅 barrel export / 註解 / 測試 / 同名不同物的 `createOrderStatusOption` |
| 11 | `packages/schemas` **沒有任何 displayId 驗證**;顯示層(信件 / 前台 / 後台)全把它當純字串傳 | `grep -rn "display" packages/schemas/src` = 0 命中 |
| 12 | 28 字元 × 6 碼 = **481,890,304** 組;`9 × 28 = 252`、`256 − 252 = 4` ⇒ rejection 門檻 = **丟棄 byte ≥ 252**。🔴 **F5 更正**:初稿寫「現網 29 張(實為 30 張)的單抽碰撞率 ≈ 6.0e-8」**前提是錯的** —— 那 30 張全是舊格式 `PCM-…`,在 6 碼新空間裡佔 **0 格** ⇒ **第一張新單的碰撞率是 0**。正確口徑:新單累積到 N 張時,單抽碰撞率 ≈ `N / 4.82e8` | `python3` 實算 + 規格 :503-508;F5 由 Fable 關卡1 抓出 |
| 13 | 🔴 **N3a 演算法已在真 PG17 隔離庫跑過原型並通過**:50,000 抽 regex 全過、零重複、one-hot 28/28、零禁用字元、卡方 22.7;耗時 178ms | 2026-07-30 隔離庫實跑(詳 §2 探針段) |
| 14 | 🔴 **`>= 253` 的 off-by-one 只有卡方檢定抓得到**(regex / 長度 / one-hot / 重複四項全綠) | 同上,M4 突變實測 |
| 15 | 🔴🔴 **正式站訂單數是 30、不是 29** —— 最新一張 `PCM-2026-0105`(2026-07-29 04:39 UTC 建立、`payment_status=unpaid`、`legacy_display_id=null`)。**STATUS.md、提案檔、本 plan 初稿全部寫 29,是舊數字。** 對 Sean 的拍板語意無影響(「舊的全部不動」),但字面必須更正 | production 唯讀實查(2026-07-30) |
| 16 | ✅ **rollback 前提已驗證**(原本只是我的推論):`order_display_seq` last_value=**105**、`is_called=true`,而 orders 內舊格式最大序號=**105** ⇒ 回滾後 `nextval` 回 106、**不會與任何舊號相撞** | production 唯讀實查 |
| 17 | 🔴 **隔離庫的 seed 不足以跑真 `create_order`**,需三件 fixture(詳 §4.1c);且 shim 的 `auth.uid()` 是**寫死回 `NULL`**(`d1-supabase-shim.sql:32-33`) | 2026-07-30 隔離庫實跑,補齊後成功建單回 `PCM-2026-9001` |

**⇒ N3a/N3b 的 runtime 影響面 = `create_order` RPC 一支。TS 側零改動、簽章零改動、回傳形狀零改動。**

---

## §2a N2 設計(Q3=B 新增)

### 🔴 規格 N2 的字面在 Q1=A 之後已不成立,必須修正

規格 §5.4b N2 逐字寫「`display-id.ts` 依 §5.4a **換成新格式**」。
那個字面**建立在 N3c 會把資料庫收緊成新格式 only 的前提上**。Sean 拍 Q1=A 之後
N3c 不做、兩種格式**永久並存** ⇒ 「domain 只認新格式」會埋下一個**潛在(latent)錯誤**:
`display_id` 為舊格式的 30 張真實訂單,一旦哪天被餵進 `assertDisplayId` 就會被自己的驗證器擋下來。

🔴 **F6(Fable nit)措辭更正**:這是**潛在、不是現行**錯誤 —— 事實 #10 已證實
`createOrder` factory 零生產呼叫端,**今天沒有任何路徑**會把舊單餵進 `assertDisplayId`。
方向仍然是兩收,但不得把它寫成「現在就壞了」。

**⇒ N2 的正確內容 = 驗證兩收 + 刪掉舊格式的「產號」與「解析」能力。**
(不是把舊格式趕出去,是把「在 TS 裡生號 / 從號碼反推年份序號」這件事整個拿掉 ——
產號從此只有一個生產者:`pcm_generate_display_id()`。)

### 具體動作

| 對象 | 動作 | 為什麼 |
|---|---|---|
| `formatDisplayId(year, seq)` | **刪除** | 唯一功能是產舊格式;零生產呼叫端(事實 #10);TS 從此不該有能力生單號 |
| `parseDisplayId(value)` | **刪除** | 「從單號反推年份/序號」只對舊格式有意義,新格式無此語意;零生產呼叫端 |
| `MIN_SEQ_DIGITS` / `DISPLAY_ID_PATTERN` | **刪除** | 上面兩支的私有支撐,一起走 |
| `isValidDisplayId` / `assertDisplayId` | **改成兩收** | `assertDisplayId` 是 `createOrder` factory 的守門(`order.ts:253`);Order entity 必須能承載兩種格式的真實訂單 |
| `packages/domain/src/index.ts` barrel | 移除已刪的兩個 export | :61-64 現在 export 四支 |
| `display-id.test.ts` | 重寫 | 新增:兩種格式各自 accept、垃圾值 reject、`new String()` wrapper 仍被 typeof 擋 |

### 兩收的實作 = 重用既有唯一來源、不立第三份

`packages/domain/src/order/order-number-search.ts` 已經 export 這兩條 regex,
且該檔自己的註解(:16-17)逐字寫「**必須永久同時接受新舊兩種格式**」:

- `LEGACY_ORDER_NUMBER_RE = /^PCM-\d{4}-\d{4,}$/`(:24)
- `ORDER_NUMBER_RE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$/`(:29)

⇒ `display-id.ts` **import 這兩條**,不自己再寫一份 regex。
理由:同一形狀寫三處(D0 的 CHECK、search、display-id)必然漂移;
CHECK 那份在 DB 無法共用,TS 這兩份沒有理由不共用。
🔴 這也讓「改字母表」這件事在 TS 側只有一個落點。

### 誠實邊界(N2)
- N2 **對結帳零 runtime 影響** —— 不是我的推論,是實查:`assertDisplayId` 全樹唯一呼叫端
  是 `createOrder` factory,而該 factory **零生產呼叫端**(事實 #10)。
- ⇒ N2 的驗收只能是「型別 + 測試 + 三綠」,**不得宣稱驗過任何結帳行為**。

---

## §2 N3a 設計

```
public.pcm_generate_display_id() RETURNS text
LANGUAGE plpgsql / SECURITY DEFINER / VOLATILE / PARALLEL UNSAFE
CALLED ON NULL INPUT / NOT LEAKPROOF / COST 100 / SET search_path = ''
```

演算法(逐條對齊 §5.4a,不自行發明):

1. 字母表常數 `'23456789BCDFGHJKMNPQRSTVWXYZ'`(28 字元、大寫 only)。
2. 一次抽 16 bytes:`extensions.gen_random_bytes(16)`(schema-qualify;`search_path=''` 下必須)。
3. 逐 byte **rejection sampling**:`byte >= 252` 丟棄重抽,其餘取 `(byte % 28) + 1` 位。
   🔴 **禁 `random()`**、**禁對全 256 域直接 `% 28`**(會偏向前 4 個字元)。
4. 湊不滿 6 碼就再抽一批;**抽取批次有上限**(16 批),用盡 `RAISE`。
   理由:每 byte 可用率 98.4%,一批 16 bytes 湊不到 6 碼已幾乎不可能;設上限是為了
   「RNG 病態時明確報錯」而不是無界迴圈掛住結帳連線。
5. 回傳前**自我驗證**符合 `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$`,不符則 `RAISE`
   (下游 CHECK 是第二道,但函式不該把爛值交出去)。

**本函式不查表、不判斷唯一性** —— 唯一性由 `orders_display_id_key` + N3b 的重試迴圈負責
(§5.4a 逐字:helper 只回候選值,不可能捕捉 INSERT 的 unique violation)。

**ACL**:`REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;`
`create_order` 是 SECURITY DEFINER、owner=postgres、helper 也 owner=postgres ⇒ 呼得到,不需任何 GRANT。

**migration 內的 apply-time 守門**(fail-closed,任一條不成立整片回滾):
- pgcrypto 已裝且 `extensions.gen_random_bytes` 可解析(對應事實 #2:新環境沒它就當場吵)
- 函式屬性逐項精確斷言(secdef / proconfig / volatile / owner / ACL 矩陣)
- **行為探針(數值已在真 PG17 實測定案,見下)**

### 🔴 行為探針的門檻不是猜的 —— 2026-07-30 已在拋棄式 PG17 實跑定案

原本我寫「連抽 200 次」。**200 抽驗不出取樣偏差** —— 這正是
`feedback_fixed-vector-cannot-prove-bit-fidelity`(固定向量測不住降熵)那個坑。
於是把演算法原型建在隔離庫上,對**兩個真突變**實測分離度:

| 版本 | 卡方統計量(28 格、df=27) |
|---|---|
| 正確版(門檻 `>= 252`)5 次實測 | **48.3 / 28.8 / 39.9 / 15.4 / 23.2**(期望值 27) |
| **M1 突變:拿掉 rejection、直接 `% 28`**(規格明文禁止的形狀) | **242.4** |
| **M4 突變:門檻 off-by-one 寫成 `>= 253`** | **166.3** |

⇒ **採用門檻 = 卡方 > 82 即 RAISE**(df=27 的 p≈1e-6)。
理由:正確版實測最大 48.3、離 82 有裕度;兩個突變 166 / 242 遠在門檻之上 ⇒ **兩個方向都是 ~7σ 分離**。
🔴 原本想用的 p=0.001 臨界值 55.5 **被實測否決** —— 正確版有一次跑到 48.3,離 55.5 太近,
會變成偶發假紅的不穩定探針。

**M4 是本片最陰的坑**:`>= 253` 只多收一個 byte(252),它 `% 28 = 0` ⇒ 只讓字母表**第一個字元 `2`**
多 1/9 權重。regex 全過、長度全對、one-hot 全覆蓋、零重複 —— **除了卡方,所有其他探針都是綠的**。

**探針最終清單**(50,000 抽;實測耗時 **178ms**,對 migration 無感):
1. 50,000 抽全部符合 `^[23456789BCDFGHJKMNPQRSTVWXYZ]{6}$` — 抓長度/字母表錯誤
2. 零重複 — 抓退化成常數
3. 零一個 `0O1IL` / `AEU` — 抓字母表誤植
4. 28 字元 one-hot 全覆蓋 — 抓字母表被截短
5. **卡方 ≤ 82** — 抓取樣偏差(唯一抓得到 M1 / M4 的那條)

🔴 **每條探針必須配自己的突變、且只紅它那一條**(`feedback_negative-test-harness-self-false-green`)。
上表已證實第 5 條是 M1/M4 的唯一守門者 ⇒ 它不能被拿掉、也不能降級成「看起來很亂就好」。

🔴 **F8(Fable nit):卡方探針的偶發假紅必須寫進 migration 註解。**
門檻 82 對應 p≈1e-6 ⇒ **每約一百萬次 apply/provision 會有一次假紅**。
註解必須逐字寫明:「本條為統計檢定,紅了**先原封重跑一次**;
連續兩次紅才代表演算法真的偏了」—— 否則未來某次假紅會被誤診成產號器壞掉,
引發不必要的緊急處置(這正是「防護命名超過它實際能力」的反面:要老實標出它的偽陽性率)。

---

## §3 N3b 設計

PG 無法只改函式體的一段 ⇒ 必須整支重下(654 行)。沿用 07-19 那支已建立的慣例:
**指紋守門 → DROP → CREATE(逐字複製、僅段 8 delta)→ ACL 鏡像 → COMMENT → 檔尾斷言**。

### 唯一的 delta(段 8)

移除:
```sql
v_seq_text := pg_catalog.nextval('public.order_display_seq')::text;
v_display_id := 'PCM-' || pg_catalog.to_char(pg_catalog.now(), 'YYYY') || '-' || CASE ... END;
INSERT INTO public.orders (...) VALUES (v_display_id, ...) RETURNING id INTO v_order_id;
```
改成:
```sql
FOR v_attempt IN 1..5 LOOP
  BEGIN
    v_display_id := public.pcm_generate_display_id();
    INSERT INTO public.orders (... 欄位列與 VALUES 逐字不動 ...) RETURNING id INTO v_order_id;
    EXIT;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
    IF v_cname <> 'orders_display_id_key' THEN
      RAISE;                                  -- 其他 unique violation 原樣上拋
    END IF;
    IF v_attempt = 5 THEN
      RAISE EXCEPTION 'create_order: display_id 連續 5 次碰撞已放棄 (pcm_display_id_exhausted)'
        USING ERRCODE = 'P0001';
    END IF;
  END;
END LOOP;
```
連帶:`DECLARE` 移除已無用的 `v_seq_text`、新增 `v_attempt integer` / `v_cname text`。
**其餘 653 行逐字不動**(含段 7 的運費 `CASE`、段 8b consent、段 9 items、段 10 return DTO)。

### 為什麼重試迴圈只包 orders INSERT
plpgsql 的 `BEGIN…EXCEPTION` 是子交易:捕捉後只回滾這一次 INSERT,
`order_legal_consents` / `order_items` 都排在迴圈之後 ⇒ 不會被重複寫入。

### 🔴 兩個容易漏的連動面

1. **#216 運費漂移守門會把 anchor 移到 N3b 這支檔**
   `shipping-rpc-drift.test.ts` 取「**最新一支定義 `create_order` 的 migration**」,
   抓不到運費 CASE 就**直接紅**(2026-07-25 R3 特別改成不准回退)。
   ⇒ N3b 必須讓 `v_subtotal >= 5000 THEN 0 ELSE 100 END` 逐字留在檔內。**該測試列入驗收必跑**。
2. **`order_display_seq` 保留不 DROP**:down migration 要靠 `nextval` 復原;
   而且它繼續存在完全無害(沒人呼它就不前進)。

### ACL / COMMENT
逐字沿用 07-19:`REVOKE ALL ... FROM PUBLIC, anon, service_role, payment_confirmer;`
+ `GRANT EXECUTE ... TO authenticated;`(事實 #6 已證實正式站 ACL 就是這個結果)。
COMMENT 追記 N3b delta。

### 指紋守門的兩個狀態

🔴 **F4(Fable 關卡1 must-fix):不得照抄 07-19 的狀態判別結構。**
`20260719120000:171-184` 是用「**8-param 存在 vs 9-param 存在**」選狀態 —— 那支改了參數數量,
所以 overload 存在性能區分「還沒套」與「套過了」。
**N3b 不改簽章** ⇒ 套用前後都是「只有 9-param」⇒ 逐字沿用會讓首次 apply
落進 `ELSIF v_oid9 IS NOT NULL AND v_oid8 IS NULL` = 判成「狀態 B(重跑)」,
拿 N3b 的自指常數去比對現況 `850e2e…` **必然不符** ⇒
**正式站 `db push` 首次套用即中止**,Sean 面對的是一片紅(fail-closed,但部署被擋)。

**⇒ 改成「指紋決定狀態」,不是「overload 存在性決定狀態」:**

```
v_fp := <同一個 helper 公式>(9-param 的 oid);
IF   v_fp = '850e2e3cf5f503391df5fe6fe0067cce' THEN 狀態 A(首次 apply,現況=07-19 版)
ELSIF v_fp = '<N3b 自身產出的自指常數>'          THEN 狀態 B(history 裂縫後重跑)
ELSE  RAISE  -- 現況是未知版本,絕不覆寫
END IF;
```

- 9-param 不存在(`to_regprocedure` 回 NULL)⇒ 也 `RAISE`(不該發生;沉默建立新函式等於繞過守門)
- 若同時存在 8-param overload ⇒ `RAISE`(現況與兩個已知狀態都不同)
- **代償控制沿用 07-19**:自指常數由檔尾斷言以**同一個 helper 公式**重算並比對同一常數
  ⇒ 常數忘了同步,首次 apply 就整批回滾並吵、不會潛伏。

---

## §4 驗證計畫

### 4.1 隔離 DB 實跑(硬前置,不可省)
教訓來源:`feedback_text-level-tests-cannot-catch-runtime-wiring` ——
產生 SQL 的片「全綠 + 突變全紅」是**必要非充分**,D1a4/D1a5 的 BLOCKER 就藏在文字層驗不到的地方。

重用既有 harness `scripts/d1t2-rehearsal.sh provision`(拋棄式 PG17 + shim + 全 migration)。
🔴 **需在 `scripts/d1-supabase-shim.sql` 補兩行**(否則事實 #2 讓 provision 直接死在 N3a):
```sql
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
```
新增 `scripts/n3-verify.sh`(`source` provision、不複製貼上,同 D1t3 做法)。

### 🔴 F2(Fable must-fix):突變**一律不改 migration 檔文字**

初稿把 B/C/D 三個突變寫成「改 N3b migration 的文字」。**那三條全部證不了事** ——
N3b 檔尾有自指指紋斷言,**任何**文字改動都會先死在那個斷言、`provision` 當場中止,
於是三個突變都紅在**同一個與被測邏輯無關的閘**上,harness 那三條斷言一次都沒被證明。
(= `feedback_negative-test-harness-self-false-green` 的變體:全部紅在同一處 = 沒有證據。)

**⇒ 突變手法改成:`provision` 正常跑完(migration 檔零改動)之後,
用 `CREATE OR REPLACE FUNCTION` 直接換掉函式本體。** 這樣紅的位置一定是 harness 的斷言。
唯一例外是 §4.1b 那組「必須死在 migration 探針」的突變,那組本來就是要驗 apply-time 守門。

### 段落與突變矩陣(修正版)

| 段 | 驗什麼 | 突變(用 `CREATE OR REPLACE`,不改檔)| 預期 |
|---|---|---|---|
| A | N3a 50,000 抽五項探針(regex / 零重複 / 禁用字元 / one-hot 28 / **卡方 ≤82**) | A-m1 字母表插入 `0` | 只有「禁用字元」與 regex 那兩條紅 |
| | | A-m2 門檻改 `>= 253` | **只有卡方那條紅**(已實測 166.3;其餘四項全綠) |
| | | A-m3 拿掉 rejection、直接 `% 28` | **只有卡方那條紅**(已實測 242.4) |
| | | A-m4 長度改 5 | 只有 regex 那條紅 |
| B | 走真 `create_order` 建單,回傳與 DB 內該列都是 6 碼 | B-m1 段 8 改回 `nextval` 舊產號 | 只有 B 段紅 |
| C | **重試路徑**:helper 換成回傳「DB 內已存在值」的固定 stub ⇒ 必須重試、第 5 次 `RAISE` 且訊息含 `pcm_display_id_exhausted` | C-m1 迴圈 `1..5` → `1..1` | 只有 C 段紅(第 1 次就 RAISE、非第 5 次) |
| D | **非 display_id 的 unique violation 不被吞、不重試**。🔴 **R2 nit N3:斷言必須驗「錯誤身分」、不是只驗「失敗」** —— 必須斷言 `SQLSTATE = '23505'` **且** `CONSTRAINT_NAME = <臨時那條>`。只斷言「呼叫失敗」的話,D-m1 突變下會變成第 5 次的 P0001 `pcm_display_id_exhausted`,**照樣失敗、D 段照樣綠 = 突變抓不到** | D-m1 拿掉 `IF v_cname <> 'orders_display_id_key' THEN RAISE;` | 只有 D 段紅 |
| E | **等長消融**:C/D 的 stub 撤掉後,同一段以**同樣的抽數與同樣的斷言**轉綠 | — | 證明 C/D 的紅來自被測邏輯、不是環境壞了 |

🔴 **F1(Fable must-fix):D 段原設計物理上做不到。**
初稿寫「stub 讓 INSERT 撞 `orders_tappay_rec_trade_id_key`」—— 但 `create_order` 的
INSERT 欄位列**根本不含 `tappay_rec_trade_id`**(`20260719120000:471-474`;plan 自己的事實 #5 也這麼寫,
初稿自相矛盾)。helper stub 只能控制 `display_id`,撞不到別的約束。
**⇒ D 段改法**:在拋棄式庫內臨時對 **`cart_session_id`**(create_order 確實會寫的欄)加一條
UNIQUE 約束 + 預埋一列衝突值,讓 INSERT 撞它。這才真的產生「名字不是
`orders_display_id_key` 的 unique violation」,證明它被原樣上拋而非被重試吞掉。

### 4.1b 🔴 F3(Fable must-fix):apply-time 探針也必須被「把 bug 放回去」證明

M1 / M4 / 字母表三個突變先前**只在原型上**證過分離度(事實 #13/#14)。
出貨的 N3a migration 是重寫的檔 ⇒ 依 `feedback_text-level-tests-cannot-catch-runtime-wiring`
必須對**實際出貨檔**再證一次。這組**刻意改 migration 檔文字**(與 F2 相反,因為要驗的正是 apply-time 守門):

| 突變(改 N3a 出貨檔) | 預期 |
|---|---|
| 門檻改 `>= 253` | `provision` **死在 N3a 的卡方探針**,錯誤訊息指向該探針 |
| 拿掉 rejection、`% 28` | 同上 |
| 字母表插入 `0` | 死在**探針 1 或探針 3**、訊息指向其中之一(🔴 **R2 nit N2**:`0` 同時違反 regex 與禁用字元兩條,若探針依 1→5 順序執行,首個 RAISE 會落在探針 1 —— 初稿寫死「探針 3」會自己判成假紅。要嘛接受兩者之一,要嘛在 migration 內明定探針執行順序) |
| 長度改 5 | 死在探針 1(regex) |

🔴 **驗收條件是「死因訊息指向該探針」,不只是「provision 失敗」** ——
死在別的地方(例如語法錯誤)不算證明。

🔴 **R2 nit N1 —— 改檔突變的還原紀律**(本組是唯一會動出貨檔的突變,污染風險真實存在):
1. **每個突變 = 一次獨立的 fresh `provision`**(不在同一個庫上疊突變)
2. 還原後 `shasum -a 256` 比對出貨檔**逐位元組**與突變前一致
3. 🔴 **禁用 `git checkout` 還原** —— 它會清掉尚未 commit 的新檔(N3a/N3b 本身就是新檔),
   讓後續突變全部變成假紅(`reference_bash-background-kill-and-mutation-restore-traps` 實錘)
4. 全組跑完後 `git status --porcelain` 必須與跑前逐字一致

### 4.1c 🔴 F9(Fable nit):B 段的 fixture 配方與證據等級

初稿寫「走真 `create_order` 建一張單(shim 的 auth + seed 資料)」——
**實跑證偽:光靠 seed 跑不起來。** 2026-07-30 在隔離庫逐一撞出缺什麼,配方定案 **3 件**:

| # | fixture | 為什麼需要 |
|---|---|---|
| 1 | `CREATE OR REPLACE FUNCTION auth.uid()` 回一個 seed 使用者的 uuid | shim 的版本是**寫死回 `NULL`**(`d1-supabase-shim.sql:32-33`)⇒ `create_order` 的 `v_uid` 為 NULL、fail-closed |
| 2 | 給要下單的變體 `UPDATE ... SET price_general = <值>` | seed 的 `product_variants.price_general` 全為 **NULL**(它造的是訂單、不是可下單的商品) |
| 3 | `setval('public.order_display_seq', <大於既有最大序號>)` | seed 插了 `PCM-2026-0001…` 卻**沒推進序號** ⇒ `nextval` 回 1、當場撞 `orders_display_id_key` |

補齊後**實跑成功**:回傳 `{"order_id":"…","display_id":"PCM-2026-9001"}`(全程在 `BEGIN…ROLLBACK` 內、零留痕)。

🔴 **證據等級誠實標定**:B 段是**煙霧測試**、跑在我自己造的 fixture 上,
**不是**「結帳真的能用」的證據。真正的證據只有 §4.4 的 **Sean 1 元真刷**。
腳本內必須逐字寫明這一點,不得讓後人以為 B 段綠了就等於結帳通了。

🔴 **R2 補充的守住條件**:B 段的斷言**不得對金額數字下「定價正確」級的結論**。
拿 fixture 價驗算 subtotal 可以(那是算術),但不能把它當成「定價邏輯正確」的證據 ——
價格是我手塞的。tier 選價 / 小計 / 運費雖然都走真 RPC 邏輯,但輸入是假的。

🔴 **順帶一個不能誤用的觀察**:fixture 3 揭露了「隔離庫裡舊產號器會當場撞號」。
換成 N3b 之後這個撞號**整類消失**(6 碼亂碼不會撞 `PCM-…`)⇒
可以拿來當 B 段的正反對比(同一環境:舊碼失敗 / 新碼成功)。
**但它不是重試迴圈的測試** —— 重試迴圈仍然只有 C 段的 stub 測得到,不得混為一談。

### 4.1d 🔴🔴 R2 指出的最大裸露面 —— 「其餘 653 行逐字不動」目前零機制在守

R2 的原話重點:**自指指紋只證明「常數 == 我實際寫出來的那個檔」,證不了「我抄對了」。**
抄漏一行、抄錯一個變數名,指紋照樣自我一致、照樣全綠;
而 #216 drift gate 只守運費 CASE **一處**。整個突變矩陣都防不到這一面 ——
它是本片**最大的人工失真面**(654 行手抄),卻是唯一沒有守門的地方。

**⇒ 加一道機械對比,列為 N3b 的硬驗收條件:**

在拋棄式庫上,`create_order` 套用 N3b **前後**各取一次
`pg_get_functiondef('public.create_order(...)'::regprocedure)`,做逐行 diff,
**斷言差異只落在**:
1. `DECLARE` 段(移除 `v_seq_text`、新增 `v_attempt` / `v_cname`)
2. 段 8(產號 + 重試迴圈)
3. `COMMENT`(追記 N3b delta)

**其他任何一行有差 ⇒ 立刻停,不得放行。**

這一步的價值高於整個突變矩陣:突變矩陣驗的是「我寫的邏輯對不對」,
這一步驗的是「我有沒有在搬 654 行的過程中弄壞了別的東西」——
後者才是 D1a4/D1a5 那顆 BLOCKER 的形狀(`feedback_text-level-tests-cannot-catch-runtime-wiring`)。

🔴 **為什麼不能用「肉眼比對」代替**:654 行、單一 delta,人眼掃過去必然宣稱「一樣」。
必須是腳本判定 + 差異白名單。

### 4.2 三綠 + 既有測試
- `/slice-checkpoint`:N2 動 `.ts` ⇒ **typecheck + lint + build 三項全跑**
- **完整 `pnpm test`**,並逐一點名必綠:`shipping-rpc-drift.test.ts`(§3 連動面 1)、
  `order-number-search.test.ts`(掃 migration 內 regex)、`shipping.test.ts`
- N2 專屬:`display-id.test.ts` 重寫後,**兩條突變各配自己的紅**
  ①`assertDisplayId` 只留新格式 regex → 舊格式那條斷言必須紅(且**只有它紅**)
  ②只留舊格式 regex → 新格式那條斷言必須紅
  🔴 若兩個突變紅的是同一條斷言 = 測試只是陪襯,重寫
  (`feedback_negative-test-harness-self-false-green`)
- N2 刪 export ⇒ 全樹重新 grep `formatDisplayId` / `parseDisplayId` 確認零殘留引用
  (含 `packages/` 與 `apps/` 兩邊;`reference_monorepo-查無斷言-grep-全樹`)

### 4.3 審查

**關卡1(審 plan)= ✅ 已跑完,見 §9 紀錄。**
- 原定 codex 兩次皆未產出結論(材料太大、死在半路;CLI 本身經最小測試證實正常)
  ⇒ 兩輪用盡、**raise Sean → 拍板換路 = Fable**
- **Fable(adversarial-reviewer)R1 = NO-GO、4 must-fix + 5 nit、全數接受、駁回 0**,已全部折入本檔
- 待跑:**Fable R2 確認輪**(R1 FAIL ⇒ 依輪次紀律必跑)

**關卡2(審 diff、commit 前)**
- codex CLI 唯讀(`-m gpt-5.6-sol`、`-s read-only`)—— 屆時材料是 diff、遠小於 plan 全文
- code-reviewer(opus)fresh context 一輪

### 4.4 Sean 手動(我不代跑)
1. `supabase db push` 套用兩支 migration(需先移開 `.env.local`,見 `reference_supabase-cli-reads-env-local-blocker`)
2. **1 元商品真刷 smoke** —— 規格 §5.4b 對 N3b 明文要求;
   🔴 這是唯一能證明「真的結帳走得通」的證據,程式測試取代不了
3. 所有 push

---

## §5 影響面與 rollback

**改到的檔**:
- N2:`packages/domain/src/order/display-id.ts`、`display-id.test.ts`、`packages/domain/src/index.ts`
- N3a/N3b:2 支新 migration
- 測試基礎設施:`scripts/d1-supabase-shim.sql`(+2 行)、`scripts/n3-verify.sh`(新)
  🔴 **F7(Fable nit)歸片明確化**:這兩個檔**歸 N3a 那一個 commit**
  (N3a 是第一個需要 pgcrypto 的片,shim 補丁與驗證腳本都是為它而存在)。
  逐片 commit 的字面必須與此一致,不得含糊。

**零改動**:任何 `.tsx`、任何 app 程式碼、`create_order` 簽章與回傳形狀、
任何 adapter / use-case / delivery 層。

**部署後的行為變化**:新單的 `display_id` 從 `PCM-2026-0105` 變成例如 `K7MTQ3`。
舊 30 張原號不動;搜尋兩種都吃(事實 #9 + `order-number-search.ts`)。

**Rollback — N2**:零 DB 足跡、零 runtime 呼叫端 ⇒ `git revert` 那個 commit 即完全復原。

**Rollback — N3a/N3b**(forward-only,不手動 DROP —— `20260729010000:410-414` 的教訓):
另立版本號更大的 migration,把段 8 改回 `nextval` 版本。
🔴 **回滾不會、也不該把已產生的 6 碼單改回去** —— 那些單號已經在客人手上。
`order_display_seq` 未被 DROP ⇒ `nextval` 從 last_value 續號,不會與舊號撞。
✅ **這句原本只是推論,現已實查證實**(事實 #16):正式站 seq last_value=105 / `is_called=true`,
orders 內舊格式最大序號也是 105 ⇒ 回滾後下一號 = 106,零碰撞。
(🔴 這條值得記著:隔離庫實跑就是因為 seed 沒推進 seq 而當場撞號 —— 序號與資料的一致性
**不是自動成立的**,回滾前應重新確認一次而非照抄本段。)
N3a 的 helper 可留著不 DROP(無呼叫端 = 無害;`shipment_reference` 之後還要用)。

**殘餘風險**(需 Sean 知情):
1. `display_id` 兩種格式永久並存 —— Sean 已拍板接受。
2. 客人**看得出自己的單號變短了**;若同一客人先後下兩單會看到兩種格式。無資料風險。
3. 產號用盡(連續 5 次碰撞)目前**只會 RAISE、不會告警** —— 見 §7 開放項 1。

---

## §6 誠實邊界(先寫在這裡,收工報告不得放寬)

- 隔離環境是**本機 PG17、不是 Supabase**;pgcrypto 版本可能與正式站不同版次
- 隔離環境的 `auth.uid()` 是 shim、不是真 GoTrue
- **本 plan 尚未對任何資料庫寫入任何東西**;本 session 對正式站只跑過**唯讀 catalog 查詢**
  (`list_extensions` / `pg_constraint` / `pg_proc`),零寫入、零 DDL
- 「結帳走得通」的最終證據只能來自 Sean 的 1 元真刷

---

## §7 開放項

1. ✅ **已拍**(Q1=A):**N3b-app 不做、記 backlog**(規格 §5.4b 的第三片)。
   規格 R7 逐字要求「N3b-app **先於** N3b 部署」——
   `placeOrder` catch `pcm_display_id_exhausted` → 走既有 `LineAlertNotifierAdapter` 送 LINE 告警。
   **這裡明寫下來,不讓缺口消失**:延後的依據是機率 ≈ `(N / 4.82e8)^5`
   (N = **新格式**單數,上線當下為 **0**;舊格式的 30 張在新空間佔 0 格)且不比現狀差
   —— 🔴 **R2 抓到的殘留**:初稿此處寫 `(6.0e-8)^5`,而事實 #12 自己已宣告那個前提是錯的,檔內自相矛盾。方向保守、結論不變
   (任何 RPC `RAISE` 現在就是回一般結帳失敗),**不是**因為它不需要。
   ⇒ 開 backlog 編號,並在 §5 殘餘風險第 3 條留紀錄。
2. ✅ **已拍**(Q2=A):關卡1 + 關卡2 兩關都跑。本檔須先過關卡1。
3. ✅ **已拍**(Q3=B):N2 併入本次施工,內容見 §2a
   (🔴 規格 N2 的「換成新格式 only」字面在 Q1=A 之後不成立,已在 §2a 修正為兩收)。
4. 🟡 **提案檔的 Q2 仍未答**:舊 30 張(提案檔寫 29)測試單要不要在後台列表隱藏
   (`2026-07-30-order-renumber-instead-of-delete.md:121-127`)。**不擋本三片。**

---

## §8 與本線無關、但不能漏掉的既有債(要記 backlog)

1. 🔴 **`packages/adapters/src/tappay/wire.ts:68` 逐字宣稱欄名「以官方 Record API reference 核實」,
   2026-07-30 對真 TapPay 正式商戶實測證明三處不符**:
   已全額退款的紀錄 `amount` 回 **0**(原額在 `original_amount`)、
   `refunded_amount` 放的是**原本金額**、
   **`transaction_time_millis` 這個欄位根本不存在**(實有 `time` / `cap_millis` /
   `transaction_complete_millis` / `bank_transaction_*_millis`)。
   ⇒ **退款線 RF2b-RF8 會直接踩到,做那條線之前必須先重查官方文件**。
   細節 = memory `project_m4b-d1c-delete-cancelled`。
2. `scripts/d1-readback.ts` 的窄化放寬有 5 條漏測突變未補(`ee24a82` commit body)——
   只有日後回頭走刪除路線才需要處理。

---

## §9 關卡1 審查紀錄(2026-07-30)

### 路線變更(Sean 拍板)
codex 兩次皆未產出結論:第 1 次 10 分鐘、第 2 次 29 分鐘,都死在「翻 repo / 載 skill」階段。
最小診斷(`只回四個字、禁止讀檔用工具`)**30 秒內正常回答** ⇒ **CLI 沒壞,是材料太大**。
`ERROR codex_models_manager::cache: missing field supports_reasoning_summaries` 經診斷確認是無害雜訊、非根因。
兩輪用盡 ⇒ 依 R3 停下 raise Sean ⇒ **Sean 拍 A:關卡1 換 Fable,codex 留給關卡2**。
兩次 codex 執行皆驗過 `git status --porcelain` **零留痕**。

### Fable(adversarial-reviewer)R1 = **NO-GO**
審查對象凍結 sha256 = `d26cec4d665dc7f23902b63055ad821e46dff6f1a364ab4f91b37910607dbbda`(341 行),
審查員已自行重算並確認一致。**4 must-fix + 5 nit,全數接受、駁回 0。**

| # | 級別 | 內容 | 折入位置 |
|---|---|---|---|
| F1 | must-fix | D 段原設計物理上做不到 —— `create_order` 的 INSERT 不含 `tappay_rec_trade_id`,撞不到那條 UNIQUE(plan 自己的事實 #5 已這麼寫,初稿自相矛盾) | §4.1 D 段改用臨時 `cart_session_id` UNIQUE |
| F2 | must-fix | B/C/D 三個突變都要改 N3b migration 文字,但檔尾自指指紋斷言會讓**任何**文字改動先死在那裡 ⇒ 三條突變全紅在同一個無關閘 = 沒有證據 | §4.1 改成 `CREATE OR REPLACE` 換函式體、不動檔案 |
| F3 | must-fix | M1/M4 只在**原型**上證過分離度;出貨檔必須「把 bug 放回去」再證一次,且 A 段的字母表突變會先死在 migration 自己的探針 | 新增 §4.1b |
| F4 | must-fix | 07-19 的指紋守門用 **overload 存在性**選狀態;N3b 不改簽章 ⇒ 照抄會讓**首次 `db push` 即中止** | §3 改成「指紋決定狀態」 |
| F5 | nit | 30 張舊單在 6 碼空間佔 0 格 ⇒ 首張新單碰撞率是 0、不是 6.0e-8 | §1 事實 #12 更正 |
| F6 | nit | 「30 張會被擋下來」是 latent 非現行錯誤 | §2a 措辭更正 |
| F7 | nit | shim +2 行與 `n3-verify.sh` 未指派歸哪一片 commit | §5 明寫歸 N3a |
| F8 | nit | 卡方探針有 p≈1e-6 偶發假紅,須寫進 migration 註解免被誤診 | §2 探針段 |
| F9 | nit | B 段可能在驗自己造的 fixture,須標明證據等級 | 新增 §4.1c(並實跑定案 fixture 配方) |

**Fable 明確判為「該角度未發現 finding」的兩項**(不是漏審,是查過):
- **plpgsql 重試迴圈語意**:成功 EXIT / 第 5 次 RAISE / helper 的 P0001 不被 `WHEN unique_violation` 吞 /
  非 display_id 約束原樣上拋 / 無 fall-through 使 `v_order_id` 未設值。
- **修法回歸**:consent / items / vehicle_snapshot / notification_email / 運費 CASE / 溢位守門
  全在迴圈外且逐字不動;RF2a-0 的 BEFORE INSERT trigger 在重試時重跑但**冪等無害**;
  drift gate anchor 移轉已被 plan 抓到。

**Fable 結論:無需新拍板題**(提案檔 Q2「隱藏舊單」已列且不擋)。

### 折入過程中我自己另外抓到的兩件事(非 Fable findings)
1. 🔴 **正式站是 30 張訂單、不是 29** —— `PCM-2026-0105` 於 07-29 建立。
   STATUS.md 與提案檔的 29 是舊數字。對 Sean 拍板語意無影響,但字面已更正(事實 #15)。
   **連帶意義**:N3b 上線前每過一天就可能再多一張永久舊格式單(Q1=A 已接受並存,非問題,但要知情)。
2. ✅ **rollback 的「續號不會撞舊號」原本只是推論** —— 已實查證實(事實 #16);
   而隔離庫實跑正好示範了「序號與資料不一致時會當場撞號」,證明這條前提不是自動成立的。

### Fable R2 確認輪 = ✅ **GO(可動工;剩餘 must-fix = 0)**

審查對象凍結 sha256 = `a76c6c3eb87bb0e76189f2dc5080b3f81b8432214762d4619b7ab7cfdda9c0a5`(488 行),
審查員已自行重算確認一致,並確認未觸碰並行 session 的兩處未追蹤檔。

**F1-F9 裁定**:F1/F2/F3/F4/F6/F7/F8/F9 = **CLOSED**(逐條附驗證位置);
**F5 = PARTIAL** —— §7 仍殘留 `(6.0e-8)^5`,與事實 #12 自己宣告的「前提是錯的」矛盾 ⇒ **已修**。

**R2 對修法本身的複核結論**(這才是 R2 的重點):
- **F4 新設計未變寬**:接受集合仍恰為兩個指紋常數;三軸(9p 存在性 × 8p 存在性 × 指紋值)全覆蓋;
  代償控制在新結構下仍成立(常數忘同步 ⇒ 首次 apply 整批回滾)。
- **F2 新手法無「測到別支」問題**:§4.1(OR-REPLACE)驗 harness 斷言的靈敏度、
  §4.1b(改檔)驗 apply-time 守門、B 段(零突變)驗出貨那支本體 —— 三層目標不同、不互相冒充。
- **F9 fixture 2 對 B 段結論範圍無實質影響**,前提是斷言不越權(已補進 §4.1c)。

**R2 新開 3 條 nit,全部接受並已折入**:
| # | 內容 | 折入 |
|---|---|---|
| N1 | 改檔突變的還原紀律(每突變獨立 fresh provision、shasum 逐位元組、**禁 `git checkout` 還原**) | §4.1b 末 |
| N2 | §4.1b「字母表插 `0` → 死在探針 3」寫死是錯的 —— `0` 同時違反 regex,首個 RAISE 可能落在探針 1 | §4.1b 表格 |
| N3 | D 段斷言若只驗「失敗」則突變抓不到(會變成第 5 次的 P0001)⇒ 必須驗 `SQLSTATE=23505` **且** constraint 名 | §4.1 D 段 |

### 🔴 R2 指出的最大裸露面 ⇒ 已新增 §4.1d 作為 N3b 硬驗收
「其餘 653 行逐字不動」**沒有任何既有機制在守** —— 自指指紋只證「常數 == 我寫出來的檔」、
證不了「我抄對了」;drift gate 只守運費 CASE 一處。
⇒ 新增機械對比:apply 前後各取 `pg_get_functiondef`,**diff 差異只准落在 DECLARE / 段 8 / COMMENT**。

### R2 另指出的一個檔外連動(待 Sean 決定,未擅自改)
`docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` 是**仍在服役的真權威**,
內含「砍 26 張改號 3 張」(26+3=29)口徑。
**我判斷該處是 D1 cohort 的歷史定義、而 D1 已全線退場** ⇒ 傾向標註而非改數字,
但它與 STATUS / 提案檔不同(那兩個是現況陳述)⇒ **列為開放項,不自行動手。**
其餘命中(07-27 v1、D1 runbooks / handoff / reviews)= 歷史紀錄,**不應回頭改寫**。

---

## §10 關卡2 審查紀錄(2026-07-30)

### 關卡2-A:code-reviewer(opus)= **FAIL,5 must-fix + 12 nit,全數接受、駁回 0**

| # | 內容 | 處置 |
|---|---|---|
| M1 | `n3-verify.sh` 的 `n3b-verbatim` / `all` 只寫在 usage、**case 沒有分支** ⇒ §4.1d 那道守門實際不在 harness 內,只能手跑 = 字面 vs 事實 | 補 case 分支 |
| **M2** | 🔴 **§4.1d 的白名單把 orders 的 INSERT 塊(13 行)整段留在「允許變動域」⇒ 零逐字比對** | 改 strip 後嚴格比對 + 縮排整塊 +4 |
| M3 | usage 宣稱「三個 OR-REPLACE 突變」、實作只有 D-m1 ⇒ B/C 段靈敏度未被證明 | 補 B-m1 / C-m1,兩者均證明有效 |
| M4 | 鐵則 12 的 codex 對抗審查未跑 | 見關卡2-B |
| M5 | STATUS 7 欄未更新;**且我給審查者的檔案清單有兩處字面錯誤**(把已 commit 的 STATUS/提案檔列為「修改」) | 已更正並在此記錄 |

**M2 的嚴重性我自己複現後做了更正 —— 審查者的例子不夠嚴重:**
- 它舉的 `v_subtotal` ↔ `v_total` 對調,**碰巧**被既有 CHECK `orders_total_balances` 擋下(訂單根本建不出來)⇒ 那是**遮蔽**,不是 §4.1d 守到的。
- 我換的例子才是真的:`'general'::member_tier` → `'premiumStore'`(經銷價 tier)——
  **沒有任何 CHECK 擋、訂單真的建立、`tier_at_checkout` 寫成 premiumStore**,而 §4.1d 印「✅ 通過」。
- 修法對**兩個**突變都證明抓得到,並在 `insert_block()` docstring 逐字記下「①是遮蔽不是守到」。

### 關卡2-B:🔴 codex 第三次同款逾時 ⇒ 換 Fable

codex 讀完指名的 4 個檔後**輸出凍結、0% CPU**(關卡1 兩次 10/29 分鐘、關卡2 一次 6.5 分鐘;
三次執行皆驗過 `git status --porcelain` 零留痕;最小測試證實 CLI 本身正常)。
依 R4「相同錯法第 2 次換路」+ 2026-07-29 同款先例 ⇒ 改由 Fable(`adversarial-reviewer`, model: fable)。

🔴 **誠實界定:Fable 是替代品,不是鐵則 12 字面要求的 codex 背書。**
本片是否接受此替代 = Sean 的判斷,不是我的。已於對話明確提出。

### Fable R1 = **NO-GO,3 must-fix + 6 nit,全數接受、駁回 0**

| # | 內容 | 處置 |
|---|---|---|
| **F0** | 🔴 **我在審查進行中改了受審檔案**(為清關卡2-A 的 nit)—— 違反凍結紀律,且**正是 F1/F2 的直接成因** | 已於對話揭露;現版重新凍結後才判定 |
| **F1 BLOCKER** | 🔴 我加的斷言寫 `strpos(v_txt, '(v_b %% 28) + 1')` —— `%%` 的轉義**只在 RAISE/format 格式字串裡成立**,普通 SQL 字串字面量裡就是兩個百分號,而 prosrc 是**一個** ⇒ 斷言恆假 ⇒ **N3a 每次 apply 必死(含 production 的 db push)**。實測 `strpos` 回 0 / 單一 `%` 回 1553 | 該條**整條刪除**(是 blocker 來源、且本來就被遮蔽) |
| **F2** | 修好 F1 後,該字面斷言排在行為探針**之前** ⇒ 四個突變全改死在它身上 = **用字面遮蔽行為證據** | 整塊移到探針之後(段 3.5),檔內寫明「行為先於字面」 |
| **F3** | 現版**從未整輪跑過自己的 harness**(F1 讓 provision 必死),註解引用的實測值全來自舊版 ⇒ 照現狀 commit 就是字面 ≠ 事實 | 已重跑至全綠 |

**Fable 明確查過但未發現問題**(節錄):段 8 plpgsql 全對(裸 `EXIT` 正確跳出 FOR、
子交易只包產號+INSERT、`IS DISTINCT FROM` 對 NULL fail-closed、helper 的 P0001 不被 handler 吃掉)/
M2 修法成立、域內後果行各有突變覆蓋 / 指紋守門窮盡且自指常數閉環 /
`CREATE OR REPLACE` 的 ACL/owner 保留有雙向斷言兜底 / **砍兩條探針成立、非自我開脫** /
消費端零壞點 / 併發撞號無死鎖面。

### 折入過程中我自己另外抓到的四個問題(非審查 findings)

1. 🔴 **計次器被交易一起回滾** —— 「重試上限 = 5」的斷言連兩次讀到 0:①stub 內表名未
   schema-qualify(`create_order` 是 `search_path=''`)②**計次寫進表裡,而建單失敗會整句
   rollback、把計次也回滾掉**。接受「0 = 沒被呼叫」就是假綠 ⇒ 改用 sequence(`nextval` 免疫回滾)。
2. 🔴 **突變連測試一起突變** —— 字母表字面在 N3a 檔內出現 **8 次**(含斷言自己的期望值兩處),
   無錨點的 perl 取代會把斷言一起改掉 ⇒ 斷言拿被改過的期望值比被改過的程式碼、當然相等。
   已加錨點只改 `c_alphabet` 宣告那一行。
3. 🔴 **註解寫死隨機數字必然過期** —— 卡方是隨機量;我剛把它從單次值改成「範圍 101-166」,
   下一次實跑就出現 **180.8**。改成**只記下界 + 實測樣本清單**。
4. 🔴 **port 前置閘擋下第二次同款污染** —— 殘留 postmaster 會讓每個突變死在 bind 失敗
   而非該紅的探針。該閘是本 session 早先踩過一次後加的,這次自己擋住了。

### 最終突變矩陣(六條,各有專屬死因;實跑證據見 §11)

| 突變 | 死在 |
|---|---|
| 門檻 `>=252` → `>=253` | 探針 3 卡方 |
| 拿掉 rejection、直接 `% 28` | 探針 3 卡方 |
| 字母表插 `0`(自我驗證仍在) | **函式自我驗證**(第一道) |
| 字母表插 `0` + 停用自我驗證 | 探針 1 regex |
| 退化成回傳固定合法值 | 探針 2 不退化 |
| 字母表補成 30 字元、取模數不動 | **段 3.5 字母表字面合約**(四條探針全綠,只有它抓得到) |
