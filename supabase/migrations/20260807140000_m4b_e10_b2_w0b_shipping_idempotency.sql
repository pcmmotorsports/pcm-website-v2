-- ============================================================
-- M-4b E10 第 2 批 B2 · W0b:出貨 writer RPC 的冪等落腳表
--   `public.pcm_b2_shipping_idempotency`(收據存根簿)
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(**v4.2 已定稿**)。
-- 本片 = 該 plan 的 **W0b**:只建這一張機械帳表 + 它自己的守門 + ACL/RLS。
-- 驗收 harness = `scripts/w0b-verify.sh`(**46 格 = 45 格 + CELL-ACCOUNT 自身**,含消融靶與 meta 突變)。
-- 🔴 **三綠對本片是「空跑的綠」**(code review 實查):`pnpm lint` = `turbo run lint && eslint 'scripts/*.ts'`、
--    `typecheck` 走 `tsconfig.scripts.json` —— **兩者都不吃 `.sql` 與 `.sh`**。
--    ⇒ 本片的正確性證據**只有** `scripts/w0b-verify.sh` 的實跑,不是三綠。**不得拿三綠當背書。**
--
-- 🔴 **本表是純機械帳表(防重放)、無業務語意**(Q6=A 裁定時附的前提,主視窗 `B-174-A`)。
--    白話:出貨的每個動作都帶一把「收據號碼」,本表是**收據存根簿**——
--    同一把號碼再來一次,系統回上次的結果、不重做。**存根永遠不清**;
--    清掉的那天,同一把號碼會被當成新的,就會**真的多出一箱貨**。
--
-- 🔴 本片刻意不含(每一項都有承接者,不是忘了):
--   · 冪等**行為**(重放路徑 / hash 比對時機 / 同鍵併發回填)   = W2
--   · 五支 writer RPC 本體與它們的 ACL                          = W1 / W3 / W3c
--   · 產號重試迴圈與 23505 雙來源分派(plan §1d)               = W1(鍵列 INSERT 必在迴圈**外**)
--   ⇒ **本片交付後零 writer** —— 沒有任何 RPC 會寫這張表。它先存在,W2 才有落腳處。
--
-- 已拍板約束(逐條落在下方欄位、CHECK 或 trigger):
--   Q6=A 新表(B-174-A)/ 四要素見 plan §1c / W-a 表名 = `pcm_b2_*` 族(B-183-A ②)/
--   W-b **不加 FK**(同上)/ N2 永不清理 / R3 **B2** 快照禁含重算衍生欄 /
--   R3 **D2** 效果斷言(兩發 trigger)/ R3 **C3** 守門函式自帶凍結面。
--
-- 內容分級:冪等鍵由系統寫入、員工不編輯 ⇒ 不適用 L1/L2/L3(非內容),走資料層。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 表 ───────────────────────────────────────────────────
CREATE TABLE public.pcm_b2_shipping_idempotency (
  action           text        NOT NULL,
  idempotency_key  text        NOT NULL,
  payload_hash     text        NOT NULL,
  shipment_id      uuid        NULL,
  result_snapshot  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),

  -- 🔴 **這個 conname 是 plan §1d 分派的錨**:同一支 RPC 內兩個 UNIQUE 都丟 `23505` ——
  --    `shipments_reference_unique`(→ 重產號)vs 本鍵(→ **轉重放**,那是同鍵併發的正常路)。
  --    分派用 `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME` + `IS DISTINCT FROM`
  --    (A5a 前科:conname 為 NULL 時 `<>` 會**靜默吞掉**錯誤)。
  --    ⇒ **改這個名字等於改 W2 的分派邏輯**,不是重新命名而已。
  CONSTRAINT pcm_b2_shipping_idem_pk
    PRIMARY KEY (action, idempotency_key),

  -- 🔴 五個動作值與 W1 的五支函式名同源;W1 定名後**同一 commit** 回填(plan §1c-1 W-c)。
  --    權威來源是 W7c 的凍結集合,本 CHECK 由它對帳,不各寫各的。
  CONSTRAINT pcm_b2_shipping_idem_action_known
    CHECK (action IN ('create_shipment','add_items','ship','void','unvoid')),

  -- 空白判定復用 S1a-1 的 helper(它涵蓋 7 種空白,含全形空格 U+3000 —— 後台是繁中輸入環境)。
  CONSTRAINT pcm_b2_shipping_idem_key_not_blank
    CHECK (NOT public.pcm_b2_is_blank(idempotency_key)
           AND length(idempotency_key) <= 200),

  CONSTRAINT pcm_b2_shipping_idem_hash_sha256
    CHECK (payload_hash ~ '^[0-9a-f]{64}$'),

  -- 🔴 **R3 B2:快照禁含重算衍生欄。** 為什麼要做成 CHECK 而不是寫註解 ——
  --    含衍生欄的快照會讓災難日 forward 之後、**合法的同鍵重試**被不變式重驗判成不一致
  --    ⇒ `RAISE` **永久擋死唯一一條合法重試路**(A7b D8 同型)。
  --    寫成註解的話,第一個趕工的人就會塞 `shipped_quantity`,而後果要到災難日才爆。
  -- 🔴 **誠實邊界(明文,不是預設)**:黑名單只擋**top-level 的這五個鍵名**。
  --    改名(`shipped_qty`)或巢狀塞(`{"a":{"shipped_quantity":1}}`)**擋不到**
  --    —— `?|` 只看 top-level key,`scripts/w0b-verify.sh` 的 `B2-NESTED-HOLE` 格
  --    就是**實測**這個洞、把它釘成可觀察事實。它擋的是「順手塞」,**不是「刻意繞」**,
  --    不得被讀成後者(memory `feedback_control-named-beyond-its-actual-power`)。
  CONSTRAINT pcm_b2_shipping_idem_snapshot_no_derived
    CHECK (NOT (result_snapshot ?| ARRAY[
      'shipped_quantity','instock_quantity','cancelled_quantity',
      'quantity','procured_quantity'
    ])),

  -- 🔴 **對抗審查 F1(must-fix,實測證實)**:上面那條 `?|` 對**非物件**的 jsonb 全盲 ——
  --    `'null'::jsonb` / `'123'::jsonb` / `'[1,2]'::jsonb` 三種**全部寫得進去**(親驗)。
  --    後果:W2 的不變式重驗會拿到 JSON null 而不是快照,而 `?|` 在它們身上恆為 false ⇒ 上面那條**看起來**還在守。
  --    🔴 這條同時關掉 F2:頂層陣列包裝 `[{"shipped_quantity":1}]` 也不再是入口。
  CONSTRAINT pcm_b2_shipping_idem_snapshot_is_object
    CHECK (jsonb_typeof(result_snapshot) = 'object')
);

COMMENT ON TABLE public.pcm_b2_shipping_idempotency IS
  'B2 出貨 writer RPC 的冪等落腳表(收據存根簿)。純機械帳表、無業務語意。'
  '🔴 **永存:禁止 TTL、禁止清理排程、禁止在災難 runbook 裡被 DROP/TRUNCATE/重放。**'
  '冪等鍵是**稽核證據**不是快取 —— 鍵過期後同鍵重試會被當成新請求 ⇒ at-most-once 保證被優化掉 ⇒ 真的多出一箱貨。'
  '這條由 pcm_b2_shipping_idem_block_delete / _block_truncate / _block_identity_update **三發** trigger 執行(不是只靠本註解),'
  '且三發皆 `ENABLE ALWAYS` —— 否則 `SET session_replication_role = ''replica''` 一句就能全部繞過(對抗審查 F5,實測)。'
  '🔴 **改名也是清空**:UPDATE 改掉 idempotency_key 等於釋放冪等鍵,後果與 DELETE 相同(對抗審查 F4,實測)。';

COMMENT ON COLUMN public.pcm_b2_shipping_idempotency.shipment_id IS
  '建箱時先無、產出後**同一交易內**回填(否則會有「鍵列在、shipment_id 仍 NULL」的中間態被讀到)。'
  '🔴 **刻意不加 FK**(plan W-b,主視窗 B-183-A ② 核可):FK 會在寫鍵列時對 shipments 取 KEY SHARE,'
  '而 plan §6a 組② 的判別力論證正建立在「KEY SHARE 不與 NO KEY UPDATE 衝突」上 ⇒ 加 FK 等於在證明面上多一個變數。'
  '🔴 **前提**:shipments **無硬刪路徑**(soft delete only)⇒ 孤兒鍵不可達。**未來若出現硬刪,本裁定同步重估。**';

COMMENT ON COLUMN public.pcm_b2_shipping_idempotency.result_snapshot IS
  '產物快照:只含 shipments / shipment_items 的**不可變事實**,供「部分成功重試」做不變式重驗。'
  '🔴 禁含任何重算衍生欄(見 pcm_b2_shipping_idem_snapshot_no_derived 與其誠實邊界)。';

-- ── 2. 永不清理(R3 D2:效果斷言,不是註解)──────────────────
-- 🔴 為什麼是**兩發**:`DELETE` trigger **不會**被 `TRUNCATE` 觸發。
--    只掛 DELETE 就是把防護命名成超出它實際能力的樣子 —— 一句 `TRUNCATE` 照樣清光。
--    這條**已實測**(2026-08-07,拋棄庫 PG 17.10):只掛 DELETE 時 `TRUNCATE` 無錯誤、剩餘列數 0;
--    補掛之後由紅轉綠 ⇒ `scripts/w0b-verify.sh` 的 `TMUT-TRUNCATE` 就是那發突變靶。
-- 🔴 兩發**共用同一個函式** ⇒ 守門**不得**用「函式在不在」或「trigger 數 >= 1」當斷言:
--    拿掉 TRUNCATE 那發之後,那兩種斷言**全綠**(實測:函式仍在、**trigger 數 2**——
--    F4 補了第三發之後這個觀察值從 1 變 2,字面已同批更新;`-ge 1` 才是本格真正的斷言)。
--    只有**逐發量 `tgtype`** 分得出來(實測基準:block_delete=11 / block_truncate=34)。這就是 R3 C3。
-- 🔴 **誠實邊界(對抗審查 F5 後<u>擴充過</u>)**:擋不住的是 —— `DROP TABLE`、owner 的
--    `ALTER TABLE … DISABLE TRIGGER`、以及 `ALTER TABLE … ENABLE REPLICA/ALWAYS` 的再變更。
--    🔴 `SET session_replication_role='replica'` **原本擋不住、現在擋得住**(三發改 ALWAYS)——
--    這條是對抗審查實測打出來的,**不是我原本想到的**。
--    本表與 `shipments` 同一條誠實邊界:**DB 層擋不住 owner**(S1a-1 檔頭已立)。
CREATE FUNCTION public.pcm_b2_shipping_idem_no_purge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION '出貨冪等存根禁止刪除或清空:冪等鍵是稽核證據、不是快取'
    USING ERRCODE = 'P0001', CONSTRAINT = 'pcm_b2_shipping_idem_no_purge';
END
$$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_no_purge() IS
  'W0b 永不清理守門(R3 D2)。由 _block_delete(ROW)與 _block_truncate(STATEMENT)兩發共用。'
  '🔴 凍結面:本函式**不在** W7c 那個「五支出貨 RPC」的凍結集合裡(R3 C3)⇒ 由 W0b 自帶的 tgtype 凍結格守。';

CREATE TRIGGER pcm_b2_shipping_idem_block_delete
  BEFORE DELETE ON public.pcm_b2_shipping_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipping_idem_no_purge();

CREATE TRIGGER pcm_b2_shipping_idem_block_truncate
  BEFORE TRUNCATE ON public.pcm_b2_shipping_idempotency
  FOR EACH STATEMENT EXECUTE FUNCTION public.pcm_b2_shipping_idem_no_purge();

-- ── 2b. 🔴 對抗審查 F4(must-fix):UPDATE 這條路**原本完全沒有守門** ────
-- 實測(親驗):`UPDATE … SET idempotency_key = 'k1-void'` **零錯誤成功**,
-- 原鍵被釋放 ⇒ 同鍵重來被當成新請求 ⇒ 表註解那句「真的多出一箱貨」**當場成立**。
-- 🔴 病根:兩發 trigger 只擋 DELETE/TRUNCATE,而**「清空」與「改名」對冪等而言是同一件事**——
--    守門畫在「刪除」這個動作上,但不變量是「**鍵一旦寫下就不再改變**」。
--    (memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`,本線第 N 次)
-- 🔴 **不能全擋 UPDATE**:plan §1c 面 3 要求 `shipment_id` 在**同一交易內回填**。
--    ⇒ 凍結「身分 + 證據」四欄,放行「產物」兩欄。
CREATE FUNCTION public.pcm_b2_shipping_idem_freeze_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.action IS DISTINCT FROM OLD.action
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '出貨冪等存根的身分與證據四欄不可變更(action / idempotency_key / payload_hash / created_at):改鍵等於釋放冪等鍵,同鍵重來會多出一箱貨'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pcm_b2_shipping_idem_freeze_identity';
  END IF;
  -- 🔴 `shipment_id` 只允許 NULL → 值(建箱後回填)。**一旦指向某箱就不可改指別箱** ——
  --    否則重放路徑會回到錯誤的產物,那比沒有冪等更糟(它會**看起來**成功)。
  IF OLD.shipment_id IS NOT NULL AND NEW.shipment_id IS DISTINCT FROM OLD.shipment_id THEN
    RAISE EXCEPTION '出貨冪等存根的 shipment_id 一旦回填即不可改指(舊=% 新=%)', OLD.shipment_id, NEW.shipment_id
      USING ERRCODE = 'P0001', CONSTRAINT = 'pcm_b2_shipping_idem_freeze_identity';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_freeze_identity() IS
  'W0b 身分凍結守門(對抗審查 F4)。凍 action / idempotency_key / payload_hash / created_at 四欄;'
  'shipment_id 只放行 NULL→值 一次;result_snapshot 不凍(W2 需回填產物)。'
  '🔴 「清空」與「改名」對冪等是同一件事 —— 只擋 DELETE/TRUNCATE 不擋 UPDATE 等於沒擋。';

CREATE TRIGGER pcm_b2_shipping_idem_block_identity_update
  BEFORE UPDATE ON public.pcm_b2_shipping_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipping_idem_freeze_identity();

-- ── 2c. 🔴 對抗審查 F5(must-fix):三發 trigger 全部改 ALWAYS ────────
-- 實測(親驗):`SET session_replication_role = 'replica';` 之後 `DELETE` **零錯誤清光**(5 列 → 0)。
-- 🔴 它比 `DISABLE TRIGGER` **更隱蔽**:session-local、事後**零 schema 痕跡**,
--    而且正是 `pg_restore --disable-triggers`、邏輯複製套用、以及本表註解自己點名的
--    「災難 runbook」會用到的模式 —— 也就是說,**最可能觸發它的正是災難日**。
-- 🔴 原本的誠實邊界只列了 `DROP TABLE` 與 owner 的 `DISABLE TRIGGER`,**漏了這一條**。
--    這不是「誠實邊界寫得不夠謙虛」,是**防護被命名成超出它實際能力的樣子**。
ALTER TABLE public.pcm_b2_shipping_idempotency
  ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_delete;
ALTER TABLE public.pcm_b2_shipping_idempotency
  ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_truncate;
ALTER TABLE public.pcm_b2_shipping_idempotency
  ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_block_identity_update;

-- ── 3. ACL / RLS ────────────────────────────────────────────
-- 🔴 **service_role 也不給**:五支 writer RPC 是 `SECURITY DEFINER`、以 owner 身分寫這張表,
--    應用連線**沒有任何理由**直接碰它。給了就等於留一條**繞過 RPC 的寫入路**——
--    而繞過 RPC 就等於繞過冪等,那正是本表存在的目的。
-- 🔴 零 policy 的 RLS 是**縱深防禦、不是主鎖**;主鎖是 ACL。
--    且 **owner 不受兩者限制**(本表刻意不 FORCE,同 S1a-1)——
--    **不得把「零 writer」讀成「沒有任何東西寫得進去」。**
-- 🔴 對抗審查 F6(nit):清單補 `authenticator`,與本 repo 既有樣板(`b2s2b-verify.sh` 的
--    `SA-rolesnone` 量四個角色)對齊。現況 Supabase 不給它 table 權限故無實洞,但**清單不齊本身**
--    就是下次有人照抄時的洞。
REVOKE ALL ON TABLE public.pcm_b2_shipping_idempotency FROM PUBLIC, anon, authenticated, service_role, authenticator;
ALTER TABLE public.pcm_b2_shipping_idempotency ENABLE ROW LEVEL SECURITY;

COMMIT;
