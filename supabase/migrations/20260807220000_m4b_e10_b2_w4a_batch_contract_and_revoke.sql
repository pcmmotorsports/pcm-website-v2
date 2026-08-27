-- ============================================================
-- M-4b E10 第 2 批 B2 · W4-1:禁批次契約 + W0b 兩支 trigger 函式補 REVOKE
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(v4.2)§2 W4 列 / §1 **Q3=A** / §0.3 交棒 10。
-- 開工令 = 主視窗 `B-203-A` ④(開工前置三條)。驗收 harness = `scripts/w4a-verify.sh`。
-- 🔴 **三綠對本片是「空跑的綠」**:`pnpm lint` / `typecheck` 不吃 `.sql`。證據只有 harness 實跑。
--
-- ══ 🔴 **W4 當場再拆**(鐵則 4;前例照 W3/W3c)═══════════════════
--   plan 的 W4 列 = 取鎖序 + **Q3=A 的禁批次契約守門**,開工令又加了三條前置。
--   三條的性質差很遠:
--     · **W4-1(本片)**:W0b 補 REVOKE(一行)+ **禁批次契約**(Q3=A)+ 取鎖序的守門格。
--     · **W4-2**:把 `admin_add_shipment_items` 的 body 抽成 helper、由薄封裝掛 handler
--       ⇒ 接上 W3-3 已備好的 **23505 轉譯**(裁定 `B-197-A` ②-2,W3-3 申報偏離時就說要在 W4 做)。
--       那是**重構既有 writer**,體積與風險都跟本片不同類。
--   🔴 **縮片界、不縮範圍**:W4-2 的內容一項未減,STOP 逐項列。
--
-- ══ ① W0b 兩支 trigger 函式補 REVOKE(W5 線級 oracle 抓到的缺口)═══
--   `…w0b_shipping_idempotency.sql:210` **只 REVOKE 了表**,它自己建的兩支 trigger 函式沒 REVOKE
--   ⇒ 它們留著 shim 的 default privileges(非 owner grantee = PUBLIC + anon/authenticated/service_role)。
--   🔴 **實害有限**:`RETURNS trigger` 的函式被直呼時 PG 會擋(「只能當 trigger 呼叫」),
--      而掛 trigger 需要目標表的 TRIGGER 權限、對外三角色沒有表權限 ⇒ **沒有可用的攻擊路**。
--   🔴 **但它讓「出貨線 helper 全部零 GRANT」這句宣稱是假的** —— W5 為此掛了一份具名例外清單。
--      本片補上之後,那份例外清單要一起拿掉(harness 有格釘住這件事,否則例外會變成永久的謊)。
--
-- ══ ② 🔴 Q3=A 的禁批次契約(plan §1 Q3,含 **F7 的更正**)═════════
--   交棒 10 的風險:**一句 `UPDATE shipments … WHERE <多列>`** 會逐列發火,跨 shipment 的取鎖順序
--   = 該 UPDATE 的列序、**無排序保證** ⇒ 兩句併發即可能真 40P01。
--   Q3=A 的處置:**RPC 契約上禁止批次** —— 一次只處理一個 `shipment_id`,
--   並「在檔內寫死禁止 + **一格守門證明 RPC 內沒有那種語句**」。
--   🔴 **F7 逐字更正過 v1 的過度宣稱**:「風險面被消滅」**太滿** ——
--      **owner / break-glass 走多列 UPDATE 仍然逐列亂序**。⇒ **契約只管應用路徑。**
--      本檔照這個字面寫,不寫成「擋住了」。
--
-- ══ 🔴 守門為什麼**不做成 DB 層 trigger**(本片拍板)═══════════════
--   看起來最「機制」的作法是:在 `shipments` 掛一發 STATEMENT 級 AFTER UPDATE,
--   用 transition table 數列數、>1 就 RAISE。**但那會擋掉 Q3=A 明文允許的 break-glass 路徑**
--   —— 災難日 owner 要一句 UPDATE 修一批資料時,那發 trigger 會擋住他,而那正是 Q3=A 說「不管」的面。
--   🔴🔴 **但「只能做 harness」是假二分**(跨模型審查 F4,我原本把取捨寫成了不可能):
--      本 repo 已有 **GUC 旗標制**的前例(A4a 的直寫守門:`SET LOCAL` 旗標放行合法路徑)
--      ⇒ statement trigger 數列 >1 就 RAISE、break-glass 用旗標放行,**機制與逃生口可以兼得**。
--      現行取捨(只做 harness)在 Q3=A 的字面下不算錯,但**它是取捨、不是唯一解** ⇒ STOP 列為決策題。
--   ⇒ 本片的守門**做在 harness**(測試時安裝計數 trigger、跑完拆掉):
--     那裡過度強制不會傷到任何人,而且它是**行為格**(真的去數 RPC 改了幾列),
--     不是拿 `prosrc` 做字串比對的文字層守門(文字層對動態 SQL 與別名全盲)。
--   🔴 **誠實邊界**:因此本片**沒有任何執行期機制**在擋批次 —— 擋它的是契約 + 測試。
--      這與 Q3=A 的字面一致,但不得被讀成「DB 擋得住」。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_no_purge()') IS NULL
     OR pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_freeze_identity()') IS NULL THEN
    RAISE EXCEPTION 'W4-1 前置閘失敗 — W0b 的兩支 trigger 函式解析不到。' USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- ── ① 補 REVOKE ─────────────────────────────────────────────
-- 🔴 兩支都是 `RETURNS trigger`、由表上的 trigger 呼叫;trigger 執行**不看函式的 EXECUTE 權限**
--    ⇒ REVOKE 之後既有 trigger 照常運作(harness 有格證這件事,不是我推論)。
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_no_purge()        FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_freeze_identity() FROM PUBLIC, anon, authenticated, authenticator, service_role;

-- ── ② 禁批次契約(寫進 catalog,讓讀 catalog 的人看得到)────────
COMMENT ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) IS
  'B2 出貨 writer(W3-3)。前緣人話 → 單列 UPDATE shipments(觸發 S2b 重算)→ 轉譯 → 同交易回填。'
  '🔴 交棒 2 的引導訊息(先作廢 → 改到貨 → 重新出貨)由 pcm_b2_shipping_human_error 產。'
  '🔴 **Q3=A 禁批次契約(W4-1)**:本函式一次只處理一個 shipment_id,'
  '**禁止一句 UPDATE 改多列 shipments** —— 那種語句會逐列發火、跨 shipment 取鎖順序等於該 UPDATE 的列序、無排序保證。'
  '🔴 **契約只管應用路徑**(plan §1 Q3 的 F7 更正):owner / break-glass 走多列 UPDATE 仍然逐列亂序,'
  'DB 層**沒有**任何執行期機制在擋它;擋它的是本契約 + scripts/w4a-verify.sh 的行為格。';

-- 🔴 五支裡只有出貨與作廢/復原會 `UPDATE shipments`;建箱是 INSERT、掛品項寫的是 shipment_items。
--    契約字面掛在**會寫 shipments 的那三支**上,不是全掛(掛在不寫那張表的函式上=沒有意義的宣告)。
--    🔴 **不是「掛品項沒有批次面」** —— 它一箱多品項、確實有面,只是那個面由 W3-2 自己的
--       `ORDER BY order_item_id` 排序契約管(`…w3b2…:258-268`),不歸本契約。理由要說完整,不留半句。
COMMENT ON FUNCTION public.admin_void_shipment(text, uuid, text) IS
  'B2 作廢 writer(W3c-1)。前緣人話 → 單列 UPDATE(deleted_at + void_reason 同時寫)→ 轉譯 → 同交易回填。'
  '🔴 **退量不在本函式裡** —— 它由 S2b 的 shipments AFTER UPDATE OF deleted_at 重算完成'
  '(SHIPPED-TRUTH 只認 shipped_at IS NOT NULL AND deleted_at IS NULL)。本片做的是觸發它。'
  '🔴 **已出貨的箱可以作廢**:s1a2:170 逐字「撤銷出貨的唯一路徑 = 作廢」,擋掉等於砍了唯一補救路。'
  '🔴 「已作廢再作廢」刻意**不做成 no-op**:第二次帶的是另一個理由,吞掉等於丟稽核資訊。'
  '🔴 **Q3=A 禁批次契約(W4-1 追加)**:一次只處理一個 shipment_id,禁止一句 UPDATE 改多列 shipments;'
  '**契約只管應用路徑**(F7 更正),owner / break-glass 多列 UPDATE 仍逐列亂序、DB 層無執行期機制。';

COMMENT ON FUNCTION public.admin_unvoid_shipment(text, uuid) IS
  'B2 復原 writer(W3c-2)+ **M4 順序前緣守門**。'
  '🔴 M4:作廢退量 → 採購下修 instock → 復原回加 ⇒ shipped > instock 撞 C9。**這條不需要併發**,順序做完就到。'
  '🔴 守門只在 shipped_at IS NOT NULL 時算(草稿箱的 shipment_items 數量非零但不進 SHIPPED-TRUTH,'
  '少了這個條件會**誤擋安全的草稿復原** ⇒ 它是正確性條件、不是省算)。'
  '🔴 X8/X2 都不卡 unvoid(前者只凍收件三欄、後者只凍 shipped_at)。'
  '🔴 但**數量那一維有 C9 兜底**(繞過本函式直寫也會被擋);沒有第二道的是**訊息**與非數量原因的復原正當性。'
  '🔴 交棒 2 的引導在本方向是反過來的:箱子已作廢,改成「改回到貨數量」或「照這箱內容開新的並調整數量」。'
  '🔴 **Q3=A 禁批次契約(W4-1 追加)**:一次只處理一個 shipment_id;契約只管應用路徑,DB 層無執行期機制。';

-- ── ③ 檔內 fail-closed 斷言 ──────────────────────────────────
DO $$
DECLARE v_bad text := ''; r record;
BEGIN
  -- ①的驗收:兩支 trigger 函式現在零非 owner grantee,且 proacl **不是 NULL**
  --   (`aclexplode(NULL)` 回零列 ⇒ 只數 grantee 對「沒 REVOKE 過」全盲 —— W3-1 學到的那條)
  FOR r IN SELECT p.proname, p.proacl IS NULL AS nullacl,
                  (SELECT pg_catalog.count(*) FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee <> p.proowner) AS n
             FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
            WHERE ns.nspname = 'public'
              AND p.proname IN ('pcm_b2_shipping_idem_no_purge','pcm_b2_shipping_idem_freeze_identity')
  LOOP
    IF r.nullacl OR r.n <> 0 THEN
      v_bad := v_bad || r.proname || '(nullacl=' || r.nullacl::text || ' grantee=' || r.n || ') ';
    END IF;
  END LOOP;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'W4-1 斷言失敗:%', v_bad USING ERRCODE = 'P2B20';
  END IF;
  RAISE NOTICE 'W4-1 斷言通過:W0b 兩支 trigger 函式零 GRANT 且 proacl 非 NULL';
END
$$;

COMMIT;
