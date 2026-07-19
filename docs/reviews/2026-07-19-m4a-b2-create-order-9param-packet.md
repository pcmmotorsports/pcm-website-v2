# Codex Review Packet — M-4a 通知線 B-2:`create_order` 8-param → 9-param

Mode: **唯讀審查,不要修改檔案。** 只回 findings / 風險 / 是否可 `db push`。

Repo: `/Users/sean_1/pcm-website-v2`

🔴 **本包附了什麼、沒附什麼(誠實界定,勿假設)**

| 材料 | 是否自帶 |
|---|---|
| migration 的**檔頭註解 / `BEGIN` / 守門 DO block / `DROP` / `CREATE` 簽章段** | ✅ 逐字全文(§6.1) |
| migration 的 **ACL / `COMMENT` / `NOTIFY` / 斷言 DO block / `COMMIT`** | ✅ 逐字全文(§6.3) |
| **函式體本身(12,275 octets)** | ❌ **未附**,理由見 §6.2 |
| 函式體對 production 現行版的**逐行 diff** | ✅ 全文(§6.2,共 6 行) |
| 交易模擬的**逐字輸出**(SIM-A/B/C、守門實跑、mutation test) | ✅ 全部(§7) |
| 交易模擬的**完整 SQL** | ⚠️ 部分 —— 短的(守門原文、mutation test)逐字附;SIM-A/B/C 的建構式 SQL 只附**方法與關鍵片段**(§7.1 說明) |
| PCM 規則摘錄 | ✅(§5) |

> ⚠️ B-1 那包曾宣稱「自帶 migration 全文」實際只貼核心段,被 Codex 抓到「問了自己沒附材料的問題」。
> 本包因此**明列缺附項**。若你認為缺函式體全文就無法回答某個問題,請直接說,不要猜。

---

## 1. Slice / 目標

把建單 RPC `create_order` 從 8 參數改為 9 參數,新增 `p_notification_email text DEFAULT NULL`,
供後續片(B-4)把結帳頁收集到的通知信箱凍結進訂單層。

**內容分級**:L1(schema 契約,非使用者可編輯內容)。
**重大改動判定**:**是** —— 動 schema + 金流 RPC(鐵則 8),且命中鐵則 12 硬觸發(migration / schema / order / payment)。
**上位真權威**:`docs/specs/2026-07-18-b0-order-notification-email-prd.md` §4 B-2。
**片級 plan**:`docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md`(含三輪 codex 關卡1 審查銷案表)。

### 🔴 為什麼不能用 `CREATE OR REPLACE`(實測,非推論)

PG 不允許用 `CREATE OR REPLACE` 改參數數量 → 會產生 **overload** 而非取代。
**實測**(交易模擬、真實 8/9 參數型別簽章):8-param 與 9-param(第 9 參 `DEFAULT NULL`)共存時,
8 引數呼叫**具名與位置兩種形式皆回** `ERROR 42725 function ... is not unique` → **結帳全斷**。
故必須 `DROP` 先、`CREATE` 後,且必須原子。

## 2. Sean 拍板(不必質疑該不該問,只需質疑落地是否正確)

- **Q1=A** 不合規 email **裸傳**、由 B-1 的 CHECK 擋 → 該筆結帳失敗。**RPC 內不得加任何驗證/正規化/trim**(理由:規則只留 DB CHECK 與 B-3 app 層鏡像兩份,不新增第三份)
- **Q2=A** `database.types.ts` 留 B-4 補,本片**刻意不同步**(非漏做)
- **Q3=A** 檔內自帶 `BEGIN/COMMIT` + 兩簽章 `DROP IF EXISTS`(可重跑);**不做** disposable DB failure-injection 實驗
- **Q5=A** 守門與 DROP 之間的競態窗口記為**有界假設**(全部 schema 變更走 `db push`、Sean 單人序列執行)

## 3. 🔴 誠實揭示的殘餘風險(請重點看這幾條)

1. **原子性未被實證**:若 supabase CLI 自帶外層交易,本檔的 `COMMIT` 可能使 `schema_migrations` 寫入落到另一筆交易 → 極小機率「函式已改、套用紀錄未寫」。**靠「整支可重跑」兜底收斂,不是靠已驗證的原子性。**
2. **整份 migration 從未被 PG 完整 parse 過**:路徑① 模擬用的是在 DB 內**等價重建**的版本(見 §7),非檔案原文逐字送入。若檔案有語法問題,會在 `db push` 當下、`COMMIT` 之前失敗(fail-closed、不留半套),但仍是未驗項。
3. **守門競態窗口**:讀 catalog 與 `DROP` 之間理論上可被外部 DDL 插入。已加 `pg_advisory_xact_lock` 緩解(僅對遵守同一約定者有效)。
4. **B-2 apply 後必填尚未生效**:第 9 參仍是 `DEFAULT NULL`,`authenticated` 直呼 RPC 可省略 → 必填收緊是 B-6。

## 4. 前序審查(本包之前已跑)

- **codex 關卡1 三輪**(R1/R2/R3 皆 FAIL):累計 18 條 findings 全數處置;另有 1 條由本 session 自行 grep 全檔補上(codex 三輪皆未點名)
- **code-reviewer R1**:FAIL,3 must-fix + 3 nit → 全數修畢;**R2 確認輪**結果見 §9

## 5. PCM 規則摘錄(供你判斷是否違反,無需 repo 存取)

- **鐵則 8**:跨 3+ 檔 / 動 schema·API·共用元件 / 影響部署 → 先提 plan 等 Sean 批准(本片已走)
- **鐵則 11**:commit 前三綠(typecheck + lint,動 .ts/.tsx 加 build),不繞道/disable/skip;**commit 訊息對應實際內容、不假裝完成沒做的事**
- **鐵則 12**:動 security/RLS/GRANT/migration/schema/API,或動 order/payment → commit 前產本包、**不 push**
- **Server 端鐵則**:會員等級驗證必在 server;client 不得 import 洩漏經銷價的模組;金額用整數或 Decimal,**禁用 float**
- **字面 vs 事實**:回報字面必須等於事實;沒驗的說未驗;自指數字不寫死

## 6. Code 改動

本片**唯一 code 改動** = 新增 1 個 migration 檔(另有 1 個測試檔註解修正,見 §6.4)。

### 6.1 migration 前段逐字全文(檔頭 / BEGIN / 守門 / DROP / CREATE 簽章)

```sql
-- ============================================================
-- M-4a B-2:create_order 8-param → 9-param(新增 p_notification_email)
--
-- 上位真權威:docs/specs/2026-07-18-b0-order-notification-email-prd.md §4 B-2
-- 片級 plan:docs/specs/2026-07-19-m4a-b2-create-order-9param-plan.md
-- apply 前凍結 snapshot:docs/reviews/2026-07-19-b2-preapply-snapshot.md
-- 鐵則觸發:8(schema+金流 RPC)、12(migration/schema/order/payment → 需 Codex Packet)
--
-- Sean 2026-07-19 拍板:
--   Q1=A 不合規 email 裸傳、由 B-1 CHECK 擋;RPC 內不加驗證/正規化(不新增第三份規則)
--   Q2=A database.types.ts 留 B-4 補(本片刻意不同步、非漏做)
--   Q3=A 檔內自帶 BEGIN/COMMIT + 兩簽章 DROP IF EXISTS(可重跑)
--   Q5=A 守門與 DROP 間競態窗口記為有界假設(全部 schema 變更走 db push、Sean 單人序列執行)
--
-- 🔴 為何必須 DROP+CREATE 而非 CREATE OR REPLACE(實測,非推論):
--   PG 不允許用 CREATE OR REPLACE 改參數數量 → 會產生 overload。實測 8-param 與
--   9-param(第 9 參 DEFAULT NULL)共存時,8 引數呼叫(具名與位置皆是)一律回
--   ERROR 42725 function ... is not unique → 結帳全斷。故必須 DROP 先、CREATE 後,且原子。
--
-- 🔴 為何自帶 BEGIN/COMMIT:2026-07-18 B-1 實測,migration 檔無顯式 BEGIN 時檔內
--   SET LOCAL 會噴 WARNING 25P01 且為 no-op(=無鎖保護)。自帶顯式交易同時取得
--   鎖保護與 DROP+CREATE 的原子性。⚠️ 殘餘:若 CLI 自帶外層交易,本檔 COMMIT 可能使
--   schema_migrations 寫入落到另一筆交易(schema 已改、history 未記)→ 由「兩簽章
--   DROP IF EXISTS = 整支可重跑」兜底收斂,非已驗證的原子性。Sean 明示接受(plan §3.1)。
--
-- 🔴 函式體來源與驗證(零手動轉錄):
--   權威基底 = 2026-07-19 由 prod pg_get_functiondef 取得;prosrc md5 = a60944edb678064c468ba517391cc311
--   全屬性基線指紋 = 2b898129e49d194c30ab8039b857c0be
--   本檔函式體以程式產生,並經「反向還原後 md5 等回基線」驗證 → 除下列 1 處 delta 外零位元組偏差:
--     · orders INSERT 欄位清單 + VALUES 各加一欄(notification_email / p_notification_email)
--   ⚠️ 「1 處」= **同一個 INSERT 敘述**;跑 unified diff 會看到 **2 個 hunk**(欄位清單與
--      VALUES 分屬兩段上下文),兩者皆屬同一處 delta,勿誤判為字面不符。
--   (簽章與 COMMENT 不在 prosrc 內,故 prosrc 層 delta = 1 處、檔面 = 3 處)
--   新函式體 prosrc md5 = 0bc0d256b7483c5dd6ef1f8f97b4e9a7
--
-- 驗收(詳 plan §6):三綠 / 路徑① apply 前模擬(須剔除本檔 BEGIN;COMMIT; 兩行,
--   否則內層 COMMIT 會真的提交 → prod 留痕)/ 路徑② apply 後含 PostgREST smoke。
-- rollback:見 plan §9 —— 只認 apply 前凍結副本,禁止重新拿舊 migration 當權威。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 🔴 Q5=A 緩解:令遵守同一約定的 migration 互斥(對不遵守約定的外部 DDL 無效,已誠實揭示)
SELECT pg_advisory_xact_lock(20260719120000);

-- ── 段 2.5:apply-time 基線守門(codex R3 BLOCKER-1)──────────────────
--   目的:DROP IF EXISTS 會願意輾過『任何』現況,包含別人後來改過的較新版本。
--   守門要求當下必為兩個預期狀態之一,否則中止,絕不覆寫未知版本。
--   指紋涵蓋 prosrc + 簽章 + default + secdef + proconfig + acl + owner + 回傳型別
--   + 語言 + volatility + parallel + strict + leakproof + cost + rows + COMMENT。
DO $guard$
DECLARE
  v_fp8   text;
  v_src9  text;
  v_args9 text;
  v_n8    int;
  v_n9    int;
BEGIN
  SELECT count(*) INTO v_n8 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  SELECT count(*) INTO v_n9 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_order'
     AND p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');

  IF v_n8 = 1 AND v_n9 = 0 THEN
    -- 狀態 A:首次 apply。要求完整指紋 == 基線(body 相同但屬性被動過也會被擋)
    SELECT md5(
      coalesce(p.prosrc,'')                       || '|' ||
      pg_get_function_arguments(p.oid)            || '|' ||
      coalesce(pg_get_expr(p.proargdefaults,0),'')|| '|' ||
      p.prosecdef::text                           || '|' ||
      coalesce(p.proconfig::text,'')              || '|' ||
      coalesce(p.proacl::text,'')                 || '|' ||
      pg_get_userbyid(p.proowner)::text           || '|' ||
      p.prorettype::regtype::text                 || '|' ||
      l.lanname::text                             || '|' ||
      p.provolatile::text                         || '|' ||
      p.proparallel::text                         || '|' ||
      p.proisstrict::text                         || '|' ||
      p.proleakproof::text                        || '|' ||
      p.procost::text                             || '|' ||
      p.prorows::text                             || '|' ||
      coalesce(obj_description(p.oid,'pg_proc'),'')
    ) INTO v_fp8
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
     WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
    IF v_fp8 IS DISTINCT FROM '2b898129e49d194c30ab8039b857c0be' THEN
      RAISE EXCEPTION 'B-2 守門:8-param 完整指紋與基線不符(實際=%,預期=%)。現行 create_order 已被本 migration 之外的變更動過 → 中止,不覆寫未知版本。'
        , v_fp8, '2b898129e49d194c30ab8039b857c0be';
    END IF;

  ELSIF v_n9 = 1 AND v_n8 = 0 THEN
    -- 狀態 B:裂縫後重跑(schema 已建成 9-param、history 未記)。
    --   此處比對 prosrc md5 + 簽章字串(而非完整指紋):完整指紋含 ACL/COMMENT,
    --   而本 migration 接下來本就會把它們重建成 canonical 值,故不構成覆寫風險。
    --   若 prosrc 或簽章不符 → 是別人的 9-param 版本,一樣中止。
    SELECT md5(p.prosrc), pg_get_function_arguments(p.oid) INTO v_src9, v_args9
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
    IF v_src9 IS DISTINCT FROM '0bc0d256b7483c5dd6ef1f8f97b4e9a7' THEN
      RAISE EXCEPTION 'B-2 守門:既存 9-param 的 prosrc md5 與本檔預期產出不符(實際=%,預期=%)→ 非本 migration 所建,中止。', v_src9, '0bc0d256b7483c5dd6ef1f8f97b4e9a7';
    END IF;
    IF v_args9 IS DISTINCT FROM 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text' THEN
      RAISE EXCEPTION 'B-2 守門:既存 9-param 簽章與預期不符(實際=%)→ 中止。', v_args9;
    END IF;

  ELSE
    RAISE EXCEPTION 'B-2 守門:create_order 現況非預期狀態(8-param 數=%,9-param 數=%)。預期為「僅 8-param」或「僅 9-param」→ 中止,交人工判斷。', v_n8, v_n9;
  END IF;
END
$guard$;

-- ── DROP:兩簽章皆 IF EXISTS = 整支可重跑(正確性由上方守門保證,非靠 IF EXISTS)──
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text);

-- ── CREATE 9-param(屬性全部顯式寫出,不倚賴 PG 預設值日後不變)──
CREATE FUNCTION public.create_order(
  p_lines              jsonb,
  p_address_id         uuid,
  p_shipping_method    text,
  p_invoice            jsonb,
  p_cart_session_id    uuid,
  p_terms_version      text,
  p_client_ip          text,
  p_client_ua          text,
  p_notification_email text DEFAULT NULL   -- 🔴 B-2 過渡期 DEFAULT;B-6 移除
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
PARALLEL UNSAFE
COST 100
SET search_path = ''
AS $fn$
```

### 6.2 函式體 —— **未附全文**,以下說明為何不需要

函式體 = **12,275 octets**,md5 `0bc0d256b7483c5dd6ef1f8f97b4e9a7`。

🔴 **它與 production 此刻正在執行的 `create_order` 函式體,除下列 diff 外逐位元組相同。**
換句話說:這 12KB **不是新程式碼**,是已經在線上跑的同一份。

**驗證鏈(每一步都可由你要求重跑)**:

1. production `pg_proc.prosrc` 的 md5 = `a60944edb678064c468ba517391cc311`(12,225 octets)
2. 本檔函式體反向還原(移除下列 delta)後的 md5 = **同上,精確相等**
3. **交易模擬中由資料庫自行**從 production 現行 `prosrc` 施加同一 delta 推導 →
   md5 = `0bc0d256b7483c5dd6ef1f8f97b4e9a7` = 本檔函式體 md5,**獨立推導結果與檔案一致**

**完整逐行 diff(production 現行版 → 本檔版,`n=1` 上下文)**:

```diff
     display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
-    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id
+    subtotal, shipping_fee, discount_total, total, shipping_method, invoice, cart_session_id,
+    notification_email
   ) VALUES (
     v_display_id, v_uid, p_address_id, v_addr_snapshot, 'general'::public.member_tier,
-    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id
+    v_subtotal::integer, v_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice, p_cart_session_id,
+    p_notification_email
   )
```

→ **`prosrc` 層 delta = 1 處**(訂單 INSERT 欄位清單 + VALUES 各加一欄)。
簽章與 `COMMENT` 不在 `prosrc` 內,故**檔面** delta = 3 處。

⚠️ **若你認為必須看函式體全文才能判斷,請直接說** —— 它可由
`SELECT pg_get_functiondef('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)'::regprocedure)` 取得,
亦已凍結於 `docs/reviews/2026-07-19-b2-preapply-snapshot.md` §4。

### 6.3 migration 後段逐字全文(ACL / COMMENT / NOTIFY / 斷言 / COMMIT)

```sql
$fn$;   -- (函式體結束)
-- ── ACL 鏡像重建(DROP 後權限歸零;🔴 實測 Supabase 對新函式預設 GRANT 給
--    PUBLIC + anon + authenticated + service_role,anon 可執行 → 必須全部 REVOKE)──
REVOKE ALL ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) FROM PUBLIC, anon, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) TO authenticated;
-- 🔴 SECURITY DEFINER 的執行身分 = owner;實測 db push 以 postgres 連線,本行為保險
ALTER FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) OWNER TO postgres;

COMMENT ON FUNCTION public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text) IS
  'M-3 建單 RPC(SECURITY DEFINER 零 service_role、search_path='''')+ 3DS-0b cart_session_id + #214a availability 快照 + #241 同意紀錄 + M-4a V-3a vehicle_snapshot + M-4a B-2 notification_email(9-param)。client 送 variant+qty+address+method+cart_session_id+invoice,每 line 可帶 optional vehicle(白名單重組逐 kind 隔離、非法=NULL 不擋單、字面凍結零猜),永不送價/tier;server 注入 terms_version + best-effort client_ip/ua。notification_email 由 app 層送入(canonical 化由 B-3 的 app 層鏡像規則保證,**RPC 本身不驗不正規化**);⚠️ B-2 當下無任何呼叫端送第 9 參(TS 仍 8 參,B-4 才接)。p_notification_email 為 B-2 過渡期 DEFAULT NULL(必填收緊=B-6 移除 DEFAULT);RPC 內不做任何 email 正規化或驗證(Sean 07-19 拍 Q1=A:規則只留 DB CHECK 與 B-3 app 層鏡像兩份,不新增第三份),不合規值由 orders_notification_email_valid CHECK 擋下、整筆回滾。其餘 executable 逐字同 20260716200000(prosrc 僅 1 處 delta=orders INSERT 欄位與 VALUES);return 只 {order_id,display_id}。';

-- 🔴 codex R1 #1:不只依賴 pgrst_ddl_watch / pgrst_drop_watch,顯式再送一次。
--    NOTIFY 於 COMMIT 才送達 → 快取在新函式可見之後才重載,順序天然正確。
NOTIFY pgrst, 'reload schema';

-- ── fail-closed 斷言矩陣 ───────────────────────────────────────────
DO $assert$
DECLARE
  v_n8 int; v_sigs int; v_acl text; v_owner text; v_args text; v_def text;
  v_secdef boolean; v_cfg text; v_ret text; v_lang text; v_vol text; v_par text;
  v_strict boolean; v_leak boolean; v_cost real; v_rows real;
  v_retset boolean; v_support text;
  v_nargs int; v_ndef int; v_names text; v_cmt_md5 text; v_cmt_len int; v_src text;
  v_seclabel int; v_shseclabel int;
BEGIN
  SELECT count(*) INTO v_n8 FROM pg_proc WHERE oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text)');
  IF v_n8 <> 0 THEN RAISE EXCEPTION '斷言②失敗:舊 8-param 仍存在(=overload 風險)'; END IF;

  -- 🔴 斷言①:public.create_order 的**簽章總數**必須恰為 1。
  --    只驗「8-param 不在 + 9-param 在」不夠 —— 若另有型別相異的第三個 overload
  --    (例如末參 varchar),上面兩查都看不見,apply 後 8 引數呼叫會撞 42725
  --    is not unique = 結帳全斷(plan E4 實測過的災難模式)。
  SELECT count(*) INTO v_sigs FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_order';
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION '斷言①失敗:public.create_order 簽章總數=%(必須恰為 1;>1 即 overload 歧義風險)', v_sigs;
  END IF;

  SELECT p.prosecdef, coalesce(p.proconfig::text,''), pg_get_userbyid(p.proowner)::text,
         p.prorettype::regtype::text, l.lanname::text, p.provolatile::text, p.proparallel::text,
         p.proisstrict, p.proleakproof, p.procost, p.prorows,
         p.proretset, p.prosupport::text,
         p.pronargs, p.pronargdefaults, p.proargnames::text,
         pg_get_function_arguments(p.oid), coalesce(pg_get_expr(p.proargdefaults,0),''),
         coalesce(p.proacl::text,''), md5(obj_description(p.oid,'pg_proc')),
         length(obj_description(p.oid,'pg_proc')), md5(p.prosrc)
    INTO v_secdef, v_cfg, v_owner, v_ret, v_lang, v_vol, v_par, v_strict, v_leak, v_cost,
         v_rows, v_retset, v_support, v_nargs, v_ndef, v_names, v_args, v_def, v_acl,
         v_cmt_md5, v_cmt_len, v_src
    FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)');
  IF NOT FOUND THEN RAISE EXCEPTION '斷言①失敗:9-param create_order 不存在'; END IF;

  IF NOT v_secdef THEN RAISE EXCEPTION '斷言⑤失敗:prosecdef 非 true'; END IF;
  IF v_cfg <> '{"search_path=\"\""}' THEN
    RAISE EXCEPTION '斷言⑤失敗:proconfig 非預期(實際=%)', v_cfg; END IF;
  IF v_owner <> 'postgres' THEN RAISE EXCEPTION '斷言⑤失敗:owner=%(SECURITY DEFINER 執行身分)', v_owner; END IF;
  IF v_ret <> 'jsonb' THEN RAISE EXCEPTION '斷言⑤失敗:回傳型別=%', v_ret; END IF;
  IF v_lang <> 'plpgsql' THEN RAISE EXCEPTION '斷言⑤失敗:語言=%', v_lang; END IF;
  IF v_vol <> 'v' THEN RAISE EXCEPTION '斷言⑤失敗:volatility=%', v_vol; END IF;
  IF v_par <> 'u' THEN RAISE EXCEPTION '斷言⑤失敗:parallel=%', v_par; END IF;
  IF v_strict THEN RAISE EXCEPTION '斷言⑤失敗:proisstrict 非 false'; END IF;
  IF v_leak THEN RAISE EXCEPTION '斷言⑤失敗:proleakproof 非 false'; END IF;
  IF v_cost <> 100 THEN RAISE EXCEPTION '斷言⑤失敗:cost=%', v_cost; END IF;
  IF v_rows <> 0 THEN RAISE EXCEPTION '斷言⑤失敗:rows=%', v_rows; END IF;
  IF v_retset THEN RAISE EXCEPTION '斷言⑤失敗:proretset 非 false(應為純量回傳)'; END IF;
  IF v_support <> '-' THEN RAISE EXCEPTION '斷言⑤失敗:prosupport=%(基線為無)', v_support; END IF;

  -- 斷言⑦:第 9 參契約 —— 精確等值,禁 substring
  IF v_nargs <> 9 THEN RAISE EXCEPTION '斷言⑦失敗:參數數=%', v_nargs; END IF;
  IF v_ndef <> 1 THEN RAISE EXCEPTION '斷言⑦失敗:default 數=%', v_ndef; END IF;
  IF v_args <> 'p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb, p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text, p_notification_email text DEFAULT NULL::text' THEN
    RAISE EXCEPTION '斷言⑦失敗:簽章字串不符(實際=%)', v_args; END IF;
  -- 🔴 實測:PG 把 DEFAULT NULL 正規化為 NULL::text(非裸 NULL),照直覺寫會失敗
  IF v_def <> 'NULL::text' THEN
    RAISE EXCEPTION '斷言⑦失敗:default expression=%(預期 NULL::text)', v_def; END IF;
  IF v_names <> '{p_lines,p_address_id,p_shipping_method,p_invoice,p_cart_session_id,p_terms_version,p_client_ip,p_client_ua,p_notification_email}' THEN
    RAISE EXCEPTION '斷言⑦失敗:proargnames=%', v_names; END IF;

  -- 斷言③④:ACL 六角色矩陣 + proacl 字面
  IF v_acl <> '{postgres=X/postgres,authenticated=X/postgres}' THEN
    RAISE EXCEPTION '斷言④失敗:proacl=%', v_acl; END IF;
  IF NOT has_function_privilege('authenticated','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:authenticated 無 EXECUTE(結帳會全斷)'; END IF;
  IF has_function_privilege('anon','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:anon 可執行(未登入者可建單)'; END IF;
  IF has_function_privilege('service_role','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:service_role 可執行'; END IF;
  IF has_function_privilege('payment_confirmer','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:payment_confirmer 可執行'; END IF;
  IF has_function_privilege('authenticator','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:authenticator 可執行'; END IF;
  IF has_function_privilege('public','public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION '斷言③失敗:PUBLIC 可執行'; END IF;

  -- 斷言⑥:COMMENT 已重建且為實質內容。
  --   🔴 刻意**不**驗 md5:COMMENT 就寫在本檔上方 3 個語句處,寫死其 md5 = 自指字面
  --   (改一個字就得同步改 md5,正是本專案反覆踩過的坑)。改以「非空 + 長度下限」
  --   證明它不是空字串或佔位符;逐字內容由 plan §6-B 第 4 項對照**本檔上方的
  --   COMMENT ON FUNCTION 語句字面**覆核(⚠️ 不是對照 snapshot —— snapshot 凍的是
  --   8-param 的舊 COMMENT,與本檔的 9-param 版本本就不同)。
  --   🔴 上一行 md5 IS NULL 檢查是承重的:若只留長度檢查,COMMENT 為 NULL 時
  --   NULL < 400 求值為 NULL 會靜默放行。日後勿「簡化」掉。
  IF v_cmt_md5 IS NULL THEN RAISE EXCEPTION '斷言⑥失敗:COMMENT 為空(DROP 後未重建)'; END IF;
  IF v_cmt_len < 400 THEN RAISE EXCEPTION '斷言⑥失敗:COMMENT 長度=%(疑為佔位符)', v_cmt_len; END IF;

  -- 斷言:函式體 = 已驗證產出(除 1 處 delta 外與 prod 基線零偏差)
  IF v_src <> '0bc0d256b7483c5dd6ef1f8f97b4e9a7' THEN
    RAISE EXCEPTION '斷言失敗:prosrc md5=%(預期=%)', v_src, '0bc0d256b7483c5dd6ef1f8f97b4e9a7'; END IF;

  SELECT count(*) INTO v_seclabel FROM pg_seclabel
   WHERE objoid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)')::oid;
  SELECT count(*) INTO v_shseclabel FROM pg_shseclabel
   WHERE objoid = to_regprocedure('public.create_order(jsonb,uuid,text,jsonb,uuid,text,text,text,text)')::oid;
  IF v_seclabel <> 0 OR v_shseclabel <> 0 THEN
    RAISE EXCEPTION '斷言⑤失敗:seclabel=%,shseclabel=%(基線皆 0)', v_seclabel, v_shseclabel; END IF;

  RAISE NOTICE 'B-2 斷言矩陣全數通過(9-param / ACL / 全屬性 / 簽章 / prosrc)';
END
$assert$;

COMMIT;
```

### 6.4 另一處改動(非 migration)

`packages/domain/src/order/shipping-rpc-drift.test.ts:9-13` —— **僅註解**。
原文稱「create_order 走 `CREATE OR REPLACE`、後者勝」,B-2 起改參數數量的片走 `DROP`+`CREATE`,
該字面已與事實脫節。**測試行為不受影響**(它只取檔名最大且含運費 CASE 的 migration)。
由 code-reviewer 抓到:此為本片**自己造成**的字面過期。

## 7. 交易模擬 —— 方法與逐字輸出

### 7.1 方法與其已知限制(請重點質疑這段)

🔴 **模擬用的不是 migration 檔原文**,而是在資料庫內**等價重建**的版本:
由 `SELECT prosrc FROM pg_proc`(production 現行 8-param)取出本體 → 以 `replace()` 施加
與 migration 檔完全相同的那一處 delta → `EXECUTE format(...)` 建出 9-param。

**為何用這個方法**:MCP 只能把 SQL 當參數傳,而人工轉錄 12,275 octets 的函式體會引入
轉錄風險(正是本片費力消除的東西)。此法零轉錄,且**由資料庫獨立推導出預期值**再與檔案對照。

**代價(誠實揭示)**:整份 migration 檔**從未被 PG 完整 parse 過**。
未覆蓋面 = 檔頭註解、`BEGIN`/`COMMIT`、`SET LOCAL`、`pg_advisory_xact_lock`、
`COMMENT ON FUNCTION` 語句的 SQL 逸出正確性。
→ 這些若有語法問題,會在 `db push` 當下、`COMMIT` **之前**失敗(fail-closed、不留半套),
  但仍屬**未驗項**。**請把這條列入你的風險評估。**

**已被實跑覆蓋的**:守門 DO block(原文)、斷言 DO block(原文)、DROP/CREATE 機制、
ACL 重建、六角色矩陣、真建單三案。

### 7.2 SIM-A:DDL + 全屬性斷言(逐字輸出)

```text
SIM_A_RESULT || body_md5_match=YES || n8=0 n9=1
 || args=[p_lines jsonb, p_address_id uuid, p_shipping_method text, p_invoice jsonb,
          p_cart_session_id uuid, p_terms_version text, p_client_ip text, p_client_ua text,
          p_notification_email text DEFAULT NULL::text]
 || default=[NULL::text]
 || acl=[{postgres=X/postgres,authenticated=X/postgres}]
 || owner=postgres
 || names={p_lines,p_address_id,p_shipping_method,p_invoice,p_cart_session_id,
           p_terms_version,p_client_ip,p_client_ua,p_notification_email}
 || cfg=[{"search_path=\""}]
 || secdef=t vol=v par=u cost=100
 || anon=f svc=f pub=f auth=t pc=f ator=f
```

🔴 `body_md5_match=YES` = **資料庫自行推導的函式體 md5 == migration 檔內函式體 md5**。

### 7.3 SIM-B:真建單三案(逐字輸出)

```text
SIM_B || case1_valid=[OK email=[buyer@example.com]]
      || case2_omit9th=[OK email=[<NULL>]]
      || case3_synthetic=[BLOCKED 23514]
      || orders_before=30 after=32
```

- case1 合法 email → 建單成功、該欄存入正確值
- case2 **省略第 9 參** → 建單成功、該欄 NULL(= B-3 之前現行 TS 呼叫端不會斷)
- case3 合成域 `x@line.pcmmotorsports.local` → **`23514 check_violation`**(B-1 的 CHECK 擋下)
  → **Q1=A 的行為已驗證**:RPC 不驗、由 CHECK 擋、整筆回滾
- 交易內建了 2 筆(30→32),case3 被擋故未增;**全程 ROLLBACK**

### 7.4 SIM-C:把 migration 檔的**斷言 DO block 原文**抽出實跑(逐字輸出)

```text
SIM_C_ASSERT_BLOCK_ALL_PASSED sigs=1 nargs=9 ndef=1 cmtlen=792
                              src=0bc0d256b7483c5dd6ef1f8f97b4e9a7
```

(此區塊在 code-reviewer R1 當時從未被執行過,R1 據此開了 must-fix。)

### 7.5 守門 DO block 原文實跑 + mutation test(逐字輸出)

**正向**:把 migration 檔的守門區塊原文送 production 執行 → **無例外拋出**
(= 正確判定為狀態 A、完整指紋與基線相符)。

**Mutation test**(證明守門不是裝飾品):把預期指紋改成 `deadbeef...` 後重跑 →

```text
ERROR P0001: MUTATION_TEST_GUARD_FIRED
  實際=2b898129e49d194c30ab8039b857c0be
  預期(故意餵錯)=deadbeefdeadbeefdeadbeefdeadbeef
```

→ 守門**確實會觸發**。(本 repo 有「拔掉檢查測試仍全綠」的事故史,故補此驗證。)

### 7.6 零留痕複查(逐字輸出)

```text
sigs=1
args=p_lines jsonb, ..., p_client_ua text        (仍為 8-param)
src_md5=a60944edb678064c468ba517391cc311          (與基線相同,未被動過)
orders_now=30
comment_len=584                                   (仍為 8-param 版 COMMENT)
```

## 8. 已跑的驗證(三綠)

```text
pnpm typecheck  → Tasks: 8 successful, 8 total
pnpm lint       → Tasks: 10 successful, 10 total
運費 drift test → Test Files 1 passed (1) / Tests 3 passed (3)
```

`pnpm build` = **N/A**(本片零 `.ts`/`.tsx` 行為改動;唯一 TS 檔異動為測試檔註解)。

⚠️ 過程中曾以 `| tail -3` 取輸出,導致 `Tasks:` 判定行被截掉 → **已重跑取完整判定行**。
(交接檔 §6-① 記載過同款事故:`pnpm x | tail` 會讓 tail 的 exit code 蓋掉真實結果。)

## 9. 前序審查結果

| 輪次 | 審查者 | 結果 |
|---|---|---|
| 關卡1 R1 | codex(gpt-5.5) | FAIL,6 must-fix + 1 OK → 全數處置 |
| 關卡1 R2 | codex | FAIL,3 CLOSED / 4 PARTIAL / 2 新 BLOCKER → 全數處置 |
| 關卡1 R3 | codex(Sean 明示破例加開) | FAIL,剩 3 條 → 全數處置 |
| 階段C R1 | code-reviewer(Claude/Opus,fresh context) | FAIL,3 must-fix + 3 nit → 全數處置 |
| 階段C R2 | code-reviewer | **PASS**,0 Critical、鐵則 1-12 無違反;1 Important + 4 Minor 已順手清畢 |

codex 三輪累計 18 條 findings 全數處置;另有 **1 條 codex 三輪皆未點名、由本 session 自行
grep 全檔補上**(§1「一句話」同時含兩個已作廢字面)。

## 10. 請你(Codex)重點看

1. **§3 那四條殘餘風險是否被低估?** 特別是第 1 條(原子性未實證、靠可重跑兜底)
   與第 2 條(整份檔從未被 PG 完整 parse)。這兩條是 Sean 明示接受的,請評估接受得是否合理。
2. **§6.1 的守門邏輯**:狀態 A / 狀態 B 二分是否漏掉合法狀態?兩者指紋強度不一致
   (A 用全屬性、B 只用 prosrc + 簽章)是否構成漏洞?
3. **§6.3 的 ACL 重建**:`REVOKE ALL ... FROM PUBLIC, anon, service_role, payment_confirmer`
   + `GRANT ... TO authenticated` + `ALTER ... OWNER TO postgres` 是否足以復原?
   有沒有 DROP 後會消失、而本檔沒重建的東西?
4. **Q1=A 的落地**:RPC 內真的沒有任何 email 驗證/正規化嗎?這個設計(髒值直接撞 CHECK →
   結帳 500)在 B-3 尚未實作的期間是否可接受?
5. **是否可以 `db push`?**(這是本包要的結論)

## 11. Claude Code 自評

**可 commit,但不可 push、不可 `db push`。**
- 三綠全過、prod 交易模擬全過且零留痕已驗、code-reviewer R2 PASS
- 尚未取得的:本包的 Codex 審查結論、Sean 的 `db push` 授權
- 🔴 **B-2 apply 後不等於「必填生效」**:第 9 參仍是 `DEFAULT NULL`、可被直呼 RPC 省略,
  必填收緊是 B-6。**在 PRD §6 八項上線 gate 全數達成前,禁用「通知功能上線」「孤兒已消滅」字面。**
