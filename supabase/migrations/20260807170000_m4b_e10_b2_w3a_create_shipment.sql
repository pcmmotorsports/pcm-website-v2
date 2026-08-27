-- ============================================================
-- M-4b E10 第 2 批 B2 · W3-1:`admin_create_shipment` 業務層 + **W0 三件結清**
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2 定稿)§2 W3 列 / §1d / §7 F2。
-- 開工令 = 主視窗 `B-195-A` ③(四條硬前置契約,**高於 plan 字面**)。
-- 上游 = W0b(`…140000`)+ W1(`…150000`)+ W2(`…160000`)。
-- 驗收 harness = `scripts/w3a-verify.sh`。
-- 🔴 **三綠對本片是「空跑的綠」**(W0b/W1/W2 已三度實查):`pnpm lint` / `typecheck` **不吃 `.sql`**。
--    正確性證據**只有** harness 實跑。**不得拿三綠當背書。**
--
-- ══ 🔴 **W3 當場再拆**(鐵則 4;plan §7 F9 早就預言)═══════════════
--   plan §2 的 W3 列 = 建箱 + 掛品項 + 出貨**三個 writer** + 交棒 1 前緣拒絕 + 交棒 2 引導訊息,
--   再加開工令的四條硬前置與 W0 三件。plan §7 **F9 逐字**:「W3 一片裝三個 writer + 守門 + 訊息,
--   對照 a8a2 **單一動作就 640 行** ⇒ **估時偏低,預期還要再拆**;開工後超過 45 分照鐵則 4 當場再拆」。
--   ⇒ **拆成三片,本片是第一片**(片名避開 plan 已占用的 `W3b`/`W3c`):
--     · **W3-1(本片)**:`admin_create_shipment` + **W0 三件**(產號重試迴圈 / 23505 分派 / 耗盡碼 `P2B21`)
--     · **W3-2**:`admin_add_shipment_items` + 交棒 1 的 `增量 ≤ instock − shipped` 前緣拒絕 + 多品項取鎖序
--     · **W3-3**:`admin_mark_shipment_shipped` + Q8=A 的 23514 攔截轉譯 + 交棒 2 引導訊息 + 交棒 10 批次面
--   🔴 產號三件**只與建箱有關**(只有建箱會 INSERT `shipments`)⇒ 切在這裡沒有把耦合切斷。
--   🔴 這是**縮片界、不是縮範圍**:W3-2 / W3-3 的內容一項未減,STOP 會逐項列。
--
-- ══ 🔴 開工令 `B-195-A` ③ 的四條硬前置,本片認領哪幾條 ═══════════
--   ① 23514 轉譯必 `RAISE` 不得 `RETURN` jsonb —— **本片遵守**(見下方「零 RETURN 錯誤值」),
--      但它要攔的那個 C9(`oiqs_shipped_le_instock`)在**建箱**這條路上不可達(建箱不碰數量)
--      ⇒ **攔截轉譯本體在 W3-3**,本片只負責不違反它。
--   ② 快照一律 `to_jsonb` 同源字面 —— **本片認領且做成構造性保證**(見「快照怎麼組」)。
--   ③ 23505 分派要**三個唯一面全覆蓋** —— **本片認領**(見「§1d 分派」),plan §1d 只列兩面=已知漏、本檔申報偏離。
--   ④ **W0 三件在本片結清** —— **本片認領**,W1/W2 的偏離申報鏈到此為止。
--
-- ══ 🔴 快照怎麼組(開工令 ②:`to_jsonb` 同源)═══════════════════
--   跨模型審查(Fable)F3:白名單三欄的**值的字面形**沒有機制 —— W3 若用 `p_x::text` 之類自組字面
--   (例如大寫 uuid),重放時 `v_live -> key IS DISTINCT FROM e.value` 會判不一致
--   ⇒ **合法重試永久 `P2B24`**(本線一路在防的 A7b D8 形狀)。
--   ⇒ 本片的做法是**構造性的**,不是紀律性的:`INSERT … RETURNING pg_catalog.to_jsonb(s.*)`,
--     快照的每個值**直接取自那個 jsonb**,程式裡**沒有任何一處自己把值轉成字串**。
--   ⇒ 只要 W3-2 / W3-3 照抄這個形狀,那條契約就不需要有人記得。harness 有格用大寫 uuid 反證。
--
-- ══ 🔴 §1d 分派:`shipments` 上的**三個**唯一面(plan 只列兩個)═══
--   | conname | 何時撞 | 本片的分派 |
--   |---|---|---|
--   | `shipments_reference_unique` | 產號撞號 | **重產號、重試**(上限 5) |
--   | `shipments_pkey` | uuid 撞號 | **原封拋回** —— `gen_random_uuid()` 撞號等於亂數源壞了,重試只會蓋掉症狀 |
--   | `shipments_hct_request_id_key` | hct 單號撞號(**裸 unique index**) | **原封拋回** —— 建箱不寫 `hct_request_id`(留 NULL、partial index 不收 NULL)⇒ 本片不可達,但**分派要寫齊**,W3-3 接手時才不必回頭補 |
--   🔴 分派用 `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME` + **`IS DISTINCT FROM`**,不得用 `<>`
--     (conname 為 NULL 時 `<>` 回 NULL、`IF` 不成立 ⇒ **靜默吞掉**;A5a `20260803160000:365-368` 的前科)。
--   🔴 **誠實邊界(W2 已實測)**:本 schema 內**沒有已知會回 NULL conname 的來源**
--     —— 裸 unique index 實測也回索引名。`IS DISTINCT FROM` 是**方向正確的保險**,不是守著一個已證實可達的情境。
--
-- ══ 🔴 零 `RETURN` 錯誤值(開工令 ①)═══════════════════════════
--   本片所有拒絕路徑**一律 `RAISE`**,沒有任何一條回傳「帶錯誤碼的 jsonb」。
--   理由:整支是單一交易,`RETURN` 會讓 W2 的鍵列**照樣 commit** ⇒ 那把鍵被燒掉、
--   下一次合法重試拿到一個**假成功**的重放。harness 有格證「錯誤路徑後鍵表零列」。
--
-- ══ 🔴 訊息層:回可操作的人話(plan §1 Q1 的 C2 裁定)═══════════
--   本片五支是**員工面內部工具**,A8a1 的「不洩存在性」是為顧客面寫的、**在此不適用**。
--   ⇒ 業務拒絕必須講清楚「哪一箱、哪個欄位、要怎麼改」,不得退回單一通用訊息。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘 ────────────────────────────────────────────────
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_claim(text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_record(text,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'W3-1 前置閘失敗 — W2 的冪等層解析不到(claim/record)。' USING ERRCODE = 'P2B20';
  END IF;
  IF pg_catalog.to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION 'W3-1 前置閘失敗 — public.pcm_generate_display_id() 解析不到(N3a 未套用)。'
      USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- ── 1. 建箱 ──────────────────────────────────────────────────
-- 🔴 簽章一字不動(W1 凍結、W2 未改)。帶 DEFAULT 的參數改一個字就變成新 overload,
--    舊入口連同它的 GRANT 會活著 —— a9h 事故(PGRST202,正式站壞 8 小時)的形狀。
CREATE OR REPLACE FUNCTION public.admin_create_shipment(
  p_idempotency_key   text,
  p_customer_user_id  uuid,
  p_recipient_snapshot jsonb,
  p_carrier_code      text,
  p_carrier_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  c_max_tries constant int := 5;   -- 🔴 上界 5 照 N3b(`20260730120100:12` 逐字「包在上限 5 次的重試迴圈裡」)
  v_replay  jsonb;
  v_row     jsonb;
  v_snap    jsonb;
  v_con     text;
  v_ref     text;
  v_id      uuid;
  v_try     int := 0;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_create_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;

  -- ── 冪等層(W2)。🔴 **必須在任何業務寫入之前**,且**絕不得被搬進下面的重試迴圈**
  --    (plan §1c 面 4:第二圈會撞到自己上一圈寫的鍵列 ⇒ 誤判成併發 ⇒ 轉重放 ⇒ 回半成品)。
  v_replay := public.pcm_b2_shipping_idem_claim(
    'create_shipment', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object(
      'customer_user_id',   p_customer_user_id,
      'recipient_snapshot', p_recipient_snapshot,
      'carrier_code',       p_carrier_code,
      'carrier_note',       p_carrier_note)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;

  -- ── 前緣人話驗證(訊息層)────────────────────────────────
  -- 🔴 這一段**不是正確性層** —— 真正擋住壞資料的是 `shipments` 上的 CHECK 與 FK。
  --    它存在的理由只有一個:讓員工看到「哪個欄位、要怎麼改」,而不是一句 raw 23514。
  --    ⇒ 拿掉這段資料仍然進不去(harness 有格證這件事),但訊息會退化。
  IF p_carrier_code IS NULL OR p_carrier_code NOT IN ('hct', 'sf', 'other') THEN
    RAISE EXCEPTION '建立包裹:快遞商代號只能是 hct(新竹物流)/ sf(順豐)/ other(其他),收到的是 %',
                    coalesce(p_carrier_code, '(空白)')
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_carrier_code_domain';
  END IF;
  IF (p_carrier_code = 'other') <> (NOT public.pcm_b2_is_blank(p_carrier_note)) THEN
    IF p_carrier_code = 'other' THEN
      RAISE EXCEPTION '建立包裹:快遞商選「其他」時必須填快遞商說明'
        USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_carrier_note_pair';
    ELSE
      RAISE EXCEPTION '建立包裹:快遞商是 % 時不可填快遞商說明(說明只給「其他」用)', p_carrier_code
        USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_carrier_note_pair';
    END IF;
  END IF;
  -- 🔴 跨模型審查(Fable):檔頭宣稱「業務拒絕講清楚哪個欄位」,但收件資料為 NULL 會噴 raw 23502、
  --    形狀錯會噴 raw `shipments_recipient_snapshot_shape`(23514)—— 正是檔頭說不該出現的東西。
  --    ⇒ 補這一道。真正的權威仍是 s1a1 的 CHECK(本段拿掉資料照樣進不去)。
  IF p_recipient_snapshot IS NULL
     OR pg_catalog.jsonb_typeof(p_recipient_snapshot) <> 'object'
     OR NOT (p_recipient_snapshot ?& ARRAY['name','phone','line'])
     OR (p_recipient_snapshot - ARRAY['name','phone','line']) <> '{}'::jsonb THEN
    RAISE EXCEPTION '建立包裹:收件資料必須是**恰好**含 name / phone / line 三個欄位的物件(收到的是 %)',
                    coalesce(p_recipient_snapshot::text, '(空)')
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_recipient_shape';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = p_customer_user_id) THEN
    RAISE EXCEPTION '建立包裹:找不到這位客人(user_id=%),請確認是從客人頁面進來的', p_customer_user_id
      USING ERRCODE = 'P2B26', CONSTRAINT = 'pcm_b2_w3a_customer_missing';
  END IF;

  -- ── 產號 + INSERT,包在重試迴圈裡(W0 三件之一)──────────
  -- 🔴 迴圈**必須包住 INSERT** —— 產號器產的只是**候選值**,唯一性由 UNIQUE 約束強制
  --    ⇒ 撞號只有在 INSERT 當下才觀察得到(這正是 W1 把三件推到本片的理由)。
  LOOP
    v_try := v_try + 1;
    v_ref := public.pcm_generate_display_id();
    BEGIN
      INSERT INTO public.shipments (shipment_reference, customer_user_id, recipient_snapshot, carrier_code, carrier_note)
      VALUES (v_ref, p_customer_user_id, p_recipient_snapshot, p_carrier_code,
              CASE WHEN p_carrier_code = 'other' THEN p_carrier_note ELSE NULL END)
      RETURNING pg_catalog.to_jsonb(shipments.*) INTO v_row;
      EXIT;                                   -- 成功 ⇒ 離開迴圈
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      -- 🔴 三面全覆蓋(開工令 ③)。`IS DISTINCT FROM`、不得用 `<>`(NULL 會被靜默吞掉)。
      IF v_con IS DISTINCT FROM 'shipments_reference_unique' THEN
        RAISE;   -- pkey / hct_request_id_key / 未知面 ⇒ 原封拋回,不得當成撞號重產
      END IF;
      IF v_try >= c_max_tries THEN
        -- 🔴 耗盡要有自己的碼、不得靜默回一般失敗(W0 三件之三)
        RAISE EXCEPTION '建立包裹:連續 % 次都撞到重複的包裹單號,已放棄。這通常表示單號空間異常,請回報工程。', c_max_tries
          USING ERRCODE = 'P2B21', CONSTRAINT = 'pcm_b2_w3a_reference_exhausted';
      END IF;
      -- 否則:下一圈重產號重試
    END;
  END LOOP;

  -- ── 快照 + 回填(§1c 面 3:同一交易)──────────────────────
  -- 🔴 **構造性的 `to_jsonb` 同源**(開工令 ②):三個值全部**直接取自 `v_row`**,
  --    程式裡沒有任何一處自己把值轉成字串 ⇒ 重放比對必然相等,不靠任何人記得這條契約。
  v_snap := pg_catalog.jsonb_build_object(
    'id',                 v_row -> 'id',
    'shipment_reference', v_row -> 'shipment_reference',
    'customer_user_id',   v_row -> 'customer_user_id');
  v_id := (v_row ->> 'id')::uuid;

  -- 🔴 回傳值由 `record()` 產(W2 的 R1-F4 契約):首次成功與重放**逐鍵相同、只差 idempotent 旗標**。
  RETURN public.pcm_b2_shipping_idem_record('create_shipment', p_idempotency_key, v_id, v_snap);
END
$fn$;

COMMENT ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) IS
  'B2 建箱 writer(W3-1)。冪等層在最前、產號重試迴圈包住 INSERT、快照由 to_jsonb 同源構造。'
  '🔴 W0 三件在本片結清:重試上界 5(N3b)/ 23505 三面分派(reference 重試、pkey 與 hct_request_id 拋回)/ 耗盡碼 P2B21。'
  '🔴 所有拒絕路徑一律 RAISE、零 RETURN 錯誤值 —— RETURN 會讓冪等鍵列照樣 commit,那把鍵就被燒掉了。'
  '🔴 前緣人話驗證不是正確性層(真正擋壞資料的是 CHECK/FK),拿掉它資料仍進不去、只是訊息退化。';

-- ── 2. 🔴 檔內 fail-closed 斷言(形狀照 W1/W2)────────────────
DO $$
DECLARE v_n bigint; v_bad text := '';
BEGIN
  -- ① 簽章沒漂、無 overload(a9h 風險面)
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_create_shipment';
  IF v_n <> 1 THEN
    v_bad := v_bad || 'admin_create_shipment signature 數 = ' || v_n || '(期望 1,CREATE OR REPLACE 生了 overload)';
  END IF;
  -- ② ACL 未漂
  IF NOT pg_catalog.has_function_privilege('service_role', 'public.admin_create_shipment(text,uuid,jsonb,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.admin_create_shipment(text,uuid,jsonb,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.admin_create_shipment(text,uuid,jsonb,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticator', 'public.admin_create_shipment(text,uuid,jsonb,text,text)', 'EXECUTE') THEN
    v_bad := v_bad || 'admin_create_shipment ACL 漂了 ';
  END IF;
  -- ③ 🔴 產號器仍是零 GRANT(N3a 的設計:被 GRANT 就可被取樣、單號可預測性下降)
  -- 🔴 跨模型審查(Fable):`aclexplode(NULL)` 回**零列** ⇒ 只數 grantee 的話,
  --    `proacl IS NULL`(= 函式預設 EXECUTE to PUBLIC、也就是「重建後沒 REVOKE」)**恆過** ——
  --    而那正是本斷言要抓的漂移(`feedback_guard-checks-existence-not-effect` 同型)。
  --    ⇒ NULL 要單獨判;並補 namespace 過濾(proname 不唯一)。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
               JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'pcm_generate_display_id'
                AND p.proacl IS NULL) THEN
    v_bad := v_bad || 'pcm_generate_display_id 的 proacl 是 NULL(= 預設 EXECUTE to PUBLIC,沒被 REVOKE)';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace,
        pg_catalog.aclexplode(p.proacl) a
       WHERE n.nspname = 'public' AND p.proname = 'pcm_generate_display_id'
         AND a.grantee <> p.proowner) > 0 THEN
    v_bad := v_bad || 'pcm_generate_display_id 被 GRANT 了 ';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'W3-1 斷言失敗:%', v_bad USING ERRCODE = 'P2B20';
  END IF;
  RAISE NOTICE 'W3-1 斷言通過:建箱單一 signature + ACL 未漂 + 產號器零 GRANT';
END
$$;

COMMIT;
