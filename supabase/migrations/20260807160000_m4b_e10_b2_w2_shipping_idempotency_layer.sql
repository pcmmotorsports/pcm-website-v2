-- ============================================================
-- M-4b E10 第 2 批 B2 · W2:五支出貨 writer RPC 的**冪等層**
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(**v4.2 已定稿**)§2 W2 列 + §1c 面 1-5 + §1d。
-- 上游 = W0b(`20260807140000`,鍵表)+ W1(`20260807150000`,五支骨架)。**兩者都在,才有本片。**
-- 驗收 harness = `scripts/w2-verify.sh`。
-- 🔴 **三綠對本片同樣是「空跑的綠」**(W0b/W1 已兩度實查):`pnpm lint` / `typecheck` **不吃 `.sql`**。
--    本片的正確性證據**只有** `scripts/w2-verify.sh` 的實跑。**不得拿三綠當背書。**
--
-- 🔴 **本檔 v2 = 對抗審查 R1(FAIL,9 must-fix / 13 nit)修完的版本。**
--    被打掉的每一條都在下面就地標了 `R1-Fn`;**首版的四個判斷錯在哪**寫在該處,不只寫修法。
--
-- ══ 本片交付什麼 ═════════════════════════════════════════════
--   ① `pcm_b2_shipping_idem_payload_hash(action, payload)` —— 冪等指紋(**canonical jsonb**,非字串串接)
--   ② `pcm_b2_shipping_idem_response(shipment_id, snapshot, replay)` —— **回傳形狀的唯一產生處**(R1-F4)
--   ③ `pcm_b2_shipping_idem_claim(action, key, hash)` —— 認領 / 重放分派,含 §1d 的 23505 雙來源分派
--   ④ `pcm_b2_shipping_idem_record(action, key, shipment_id, snapshot)` —— §1c 面 3 的**同交易回填**
--   ⑤ **兩道畫在表上的守門**(R1-F5):鍵表 `BEFORE UPDATE` 擴充(快照欄位契約 + 快照 write-once)
--      + **DEFERRED CONSTRAINT TRIGGER**(commit 當下 `shipment_id` 不得仍為 NULL)
--   ⑥ 五支 RPC 的 body 換成「隔離閘 → 指紋 → 認領 → 重放回傳 → (W3 業務層佔位 RAISE)」
--
-- ══ 🔴 本片**刻意不含**(每一項都有承接者)═════════════════════
--   · 建箱・掛品項・出貨的業務邏輯                = **W3**
--   · 作廢・unvoid 與 M4 順序前緣守門              = **W3c**
--   · **產號重試迴圈 + 耗盡碼 `P2B21`**            = **W3**(W1 檔頭已申報為本線既有欠款)
--   · 多品項取鎖序 + 禁批次行為層守門              = **W4**
--   ⇒ 本片交付後,五支**仍然任何呼叫都必拋**:認領成功之後緊接著就是 `P2B20`(W3 未實作)。
--     整支是單一交易 ⇒ 那個 `RAISE` 會把剛寫下的鍵列一起回滾。
--     🔴 **R2-F2 削弱了首版那句「不存在窗口」的絕對語氣**:交易整筆 rollback 的情況確實沒有窗口,
--        但 **W3 若用 SAVEPOINT 包住 `record()` 而那個 savepoint 被 rollback**,
--        INSERT 的 deferred 事件仍在佇列 ⇒ commit 當下 `require_complete` 會擋下整筆(方向正確、fail-closed),
--        只是它拋出的訊息會說「業務層漏了呼叫 record()」—— **歸因不精確**。訊息已改成不下斷語(見該函式)。
--
-- ══ 🔴 錯誤碼登記(R1-N12:本片新鑄四碼,repo 內原本無登記處)═══
--   | 碼      | 語意                                   | 誰擁有 |
--   |---------|----------------------------------------|--------|
--   | `P2B02` | 隔離層級不是 READ COMMITTED            | W1     |
--   | `P2B20` | 骨架未實作 / 前置閘 / 檔內斷言失敗     | W1     |
--   | `P2B21` | **保留**:產號重試耗盡                 | W3(未實作)|
--   | `P2B22` | 同鍵不同 payload(重放證據不符)       | **W2** |
--   | `P2B23` | 冪等存根不完整(半成品 / phantom)     | **W2** |
--   | `P2B24` | 重放時產物集不變式不成立               | **W2** |
--   | `P2B25` | 回填契約違反(record / 表上守門)      | **W2** |
--   ⇒ 下一片鑄新碼前先看本表。本表**沒有機制守著**(repo 無碼登記檔)—— 這是已知缺口,不假裝有守。
--
-- ══ 🔴 五個我自己拍的設計決定(plan 沒寫到這一層,不是既定分工)═══
--
--   **決定 1:抽四支 owner-only helper,不讓五支各自 inline。**
--   repo 既有慣例(A8a1/A8a2/A6)是每支 RPC 各自 inline。本片刻意不照抄:那五支共用**同一張鍵表、
--   同一個 conname、同一條 §1d 分派規則** ⇒ inline 五份等於把「23505 要分派到哪」複製五份,
--   漏改一份**不會有人紅**(本線一路踩的「枚舉寫下即過期」)。
--   四支 helper **零 GRANT、owner-only**(形狀照 N3a `pcm_generate_display_id()`)。
--   🔴 **代價**:helper **不在** W7c 那個「五支出貨 RPC」的凍結集合裡(與 W0b 的
--      `pcm_b2_shipping_idem_no_purge` 同一處境,R3 C3)⇒ **本片自帶四支的凍結格**,由 `w2-verify.sh` 守。
--
--   **決定 2:指紋用 `jsonb_build_object(...)::text` 的 canonical 形式,不用 A8a1 的 `||` 串接。**
--   A8a1 的 `'a8a1:v1:' || … || ':' || coalesce(v_detail,'') || …` 有兩個洞:
--     ① **分隔符注入**:兩組不同欄值可以串出同一條字串 ⇒ 同鍵送不同 payload **通得過比對** ⇒ 重放回錯產物。
--        🔴 **R1-N11 更正**:首版舉的例子是 `carrier_code='a:b'`,但 `carrier_code` 值域限
--        `hct/sf/other`(`…s1a1.sql:104`)⇒ 那組輸入在真實列上**不可達**,例子舉錯了。
--        真正可達的自由文字面是 **`recipient_snapshot` 的值**(收件人姓名/地址,冒號完全打得出來)
--        與 `p_items` 的內容。harness `W2-HASH-INJECT` 已改用可達的那組。
--     ② `coalesce(x,'')` 把 **NULL 與空字串混為一談**。canonical jsonb 裡 NULL 是 `null`、空字串是 `""`。
--   🔴 `jsonb_build_object` 的鍵序是**正規化**的 ⇒ 參數怎麼排,`::text` 都一樣(harness 實測,非引用文件)。
--   🔴 **誠實邊界 A**:`p_items` 是 jsonb **陣列**、陣列**保序** ⇒ 同一批品項換序 = 不同指紋
--      = 合法重試被判 `P2B22`。**保守方向(不會回錯產物),但呼叫端要負責穩定序列化 ⇒ W8 契約必寫。**
--   🔴 **誠實邊界 B(R1-N1)**:本函式標 `IMMUTABLE`(harness 要靠它自算期望指紋),而 PG **不驗證**
--      這個標記。今天五支傳進來的 payload 只有 `text/uuid/jsonb` ⇒ 與 session 設定無關、標記屬實。
--      **W3 若把 `timestamptz` 之類的值塞進 payload,這個標記就變成假的**(同一份內容會因 TimeZone
--      算出不同指紋)—— 與下面排除 `created_at` 的是同一個病。
--
--   **決定 3:重放時的「產物集不變式重驗」用<u>泛型</u>比對,不是逐動作手寫五份。**
--   做法:拿 `result_snapshot` 的每個 top-level 鍵,若它**是 `shipments` 的欄名**,就跟現況逐值比。
--   欄名清單**從 catalog 取**(`pg_attribute`),不手抄。
--   🔴 **誠實邊界 ①**:快照裡**不是 `shipments` 欄名**的鍵(例如 W3 之後的 `items`)**本層不比**
--     ⇒ 本層證的是「快照裡關於 shipments 的那部分沒有變」,**不是**「產物集完全一致」。
--   🔴 **誠實邊界 ②(R2-F7/F8 打掉了首版的說法,這條要讀完)**:
--     R1-F1 之後白名單只剩三個**永不可變**的欄 ⇒ 逐值比對在**合法資料上永遠不會不符**
--     ⇒ `P2B24 invariant_broken` 對非惡意路徑**不可達**。首版把這一節寫成「產物集不變式重驗」,
--     **那個名字超出它實際能做的事**(memory `feedback_control-named-beyond-its-actual-power`)。
--     🔴 這不是實作偷懶,是**這一層做不到的事**:可變欄放進快照會讓合法編輯永久擋死重試(R1-F1),
--     不可變欄放進快照則比不出東西 —— 兩邊夾殺。本層真正還有力氣的只有兩件:
--       ① `product_gone`:存根指向的包裹**不在了**(這條會真的響,harness 有格)
--       ② 身分三欄一致:存根指到的是**同一箱**,不是被重建過的同 id 別箱
--     🔴 **「這一批品項到底有沒有真的掛上去」這種產物驗證,本層做不到,必須由 W3/W3c 自己做**
--       —— 它們知道自己產了什麼,可以比自己的動作語意。**W3 不得引用本節當作已驗。**
--   🔴 **誠實邊界 ③(R2-F7)**:沒有任何一處保證快照**非空**。W3 傳 `'{}'` 完全合法,
--     那種列的逐鍵比對迭代 0 次 ⇒ 恆綠。⇒ **快照要放什麼是 W3 的責任**,本層不強制。
--
--   **決定 4(R1-F4):回傳形狀由 `…_idem_response()` 獨佔產生。**
--   冪等的定義就是「重試拿到同一個答案」。首版讓重放回一個自組的信封、而 W3 首次成功會回它自己組的形狀
--   ⇒ 同一把鍵、同一個請求,第一次與重試拿到**兩種 JSON**,而且沒有任何機制把它們綁在一起。
--   ⇒ 兩條路都必須呼叫這支,差別**只有** `idempotent` 那個旗標。**這是 W3 的硬契約。**
--
--   **決定 5(R1-F2):`claim()` <u>不收</u> `shipment_id`,回填只有 `record()` 一條路。**
--   首版讓四支非建箱動作在**認領當下**就把 `p_shipment_id` 寫進鍵列 ⇒ 「`shipment_id IS NULL`= 未完成」
--   這個訊號**對五支裡的四支是空的**:業務層若中途把錯誤吞成回傳值,鍵列會帶著非 NULL 的 `shipment_id`
--   + 空快照 commit,下次合法重試拿到 `idempotent:true` + 空快照 =
--   **告訴員工「已經開好箱了」而箱子根本不存在**(不變式那道對 `'{}'` 逐鍵比 0 次、恆綠)。
--   ⇒ 認領一律寫 NULL;`shipment_id` 只由 `record()` 填。**「未完成」因此對五支一致可觀察。**
--
-- ══ 🔴 `created_at` 與其他四欄**不在可入快照的白名單**(R1-F1:首版判準寫錯)═══
--   首版的判準是「**五支 writer 都不會改它**」,依此收了 `recipient_snapshot / carrier_code / carrier_note`。
--   🔴 **那個判準是錯的,而且權威檔我沒開**:`…s1a2.sql:130-135` 的
--   `pcm_b2_shipments_frozen_after_ship` 只在 `OLD.shipped_at IS NOT NULL OR OLD.deleted_at IS NOT NULL`
--   時才凍那三欄 ⇒ **draft 態員工可以自由改**。後果正是本檔自己點名的 A7b D8 形狀:
--   建箱(鍵 K)→ 員工改備註或換快遞商 → 同一把 K 的合法重試 → 逐鍵比對不符 → `P2B24` **永久硬擋**。
--   ⇒ 真權威是同檔 `pcm_b2_shipments_immutable_guard`(`…s1a2.sql:155-158`):
--     **`id` / `shipment_reference` / `customer_user_id` / `created_at` 四欄永不可改。**
--   ⇒ 白名單 = 那四欄**減去 `created_at`**。`created_at` 是不可變的,但被排除的理由是**序列化**:
--     `to_jsonb(s.*)` 把 `timestamptz` 依**當下 session 的 TimeZone / DateStyle** 算成字串
--     ⇒ 寫快照與重放若在不同 session 設定下發生,同一個時間點會算出**不同字面** ⇒ 不變式誤判
--     ⇒ `RAISE` 永久擋死唯一一條合法重試路。白名單只收 uuid / text 這類與 session 設定無關的欄。
--
-- ══ 🔴 給 W3 的三條實查發現(不是本片範圍,現在不寫下就會被漏)═══
--   1. `shipments` 上的唯一面**有三個**,不是 plan §1d 寫的兩個:
--      `shipments_pkey` / `shipments_reference_unique` / **`shipments_hct_request_id_key`**
--      (裸 unique **index**、partial `WHERE hct_request_id IS NOT NULL`)。
--      ⇒ W3 的重試迴圈要決定第三個怎麼分派,不得預設「不是鍵表就是撞號 ⇒ 重產號」。
--   2. 🔴 **R1-F7 更正(我首版寫錯,已實跑推翻)**:首版寫「裸 unique index ⇒ `CONSTRAINT_NAME` 為 NULL」。
--      **實測為假**(PG 17.10 拋棄庫:建 partial unique index `t_bare_uq`、撞它,
--      `GET STACKED DIAGNOSTICS CONSTRAINT_NAME` 回的是 **`t_bare_uq`**,不是 NULL)。
--      ⇒ 三個唯一面**都會給名字**;`IS DISTINCT FROM` 仍是對的(NULL ⇒ 拋回 = fail-closed 方向),
--        但**不得被描述成「守著一個已證實可達的 NULL 情境」**——本 schema 內沒有已知的 NULL 來源。
--   3. 🔴 **R1-F8:「同鍵 = 同一個請求」這條前提,DB 層沒有任何機制承接。**
--      鍵只被要求非空白、≤200 字元;而 `create_shipment` 的指紋只含 customer / recipient / carrier
--      (無品項、無時戳)⇒「同一位客人、同一地址、同一家快遞、**開第二箱**」與第一箱**指紋完全相同**。
--      呼叫端若用表單內容衍生鍵(常見寫法),**合法的第二次請求會被靜默當成重放**、回傳第一箱。
--      ⇒ **W8 契約必須寫死:每個使用者意圖配一把新的隨機鍵(如 uuid),不得由內容衍生。**
--        DB 層分不出來,本片不假裝分得出來。
--
-- ══ 🔴 本片的已知缺口(R2 打出來的,寫下來是因為它們**沒有機制承接**)═══
--   1. **R2-F13**:五支的隔離閘用 `current_setting(...) <> 'read committed'`(W1 寫的,本片沒動),
--      而本檔 §1d 自己立了「不得用 `<>`」的規矩。此處安全(單參數 `current_setting` 找不到會拋、不回 NULL),
--      但**兩種寫法並存**,下一個照抄的人會踩。**要改要連 W1 一起改,不在本片範圍。**
--   2. **R2-F14**:「裸 unique index 的 `CONSTRAINT_NAME` 回索引名」是我在拋棄庫實跑的結論,
--      **repo 內沒有留下可重跑的腳本** ⇒ 下次有人質疑要重做一次。這條字面**沒有機制承接**。
--   3. **R2-F15**:「W8 每個使用者意圖配一把新的隨機鍵」目前**只是本檔的一句話**,
--      **尚未落進 plan 的 W8 段**。它是 R1-F8 那條 must-fix 的唯一承接處,而文字不是機制。
--      ⇒ **W8 開工前要先把它寫進 plan 並配一格守門**,否則這條等於沒修。
--   4. **R2-F16**:`b2s2b-verify.sh` 的 `NEWEST_TS` 閘靠「有人記得重跑」,而這件事**已經漏過一次**
--      (W1)。要機制(pre-commit hook 或 CI)承接,否則下一片同樣會漏。**本片只重釘,未做機制。**
--   5. **R2-F10**:本檔 `CREATE OR REPLACE` 掉 W0b 的 `freeze_identity()`。
--      新函式體**保留了 W0b 原本的兩條**(身分四欄凍結 / shipment_id 不可改指)並新增兩條,
--      但「有沒有漏掉任何一條」不能靠我宣稱 ⇒ `scripts/w2-verify.sh` 的
--      `W2-W0B-INHERITED-*` 兩格在 **W2 套用後**重測 W0b 的原始行為。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 0. 前置閘(照 W1 的形狀:破壞性動作之前,不是之後)────────
-- 🔴 本片是**純接線**:上游少一樣,五支就會被改成呼叫不存在的東西。現在紅,不要等 apply 到正式站才紅。
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.pcm_b2_shipping_idempotency') IS NULL THEN
    RAISE EXCEPTION 'W2 前置閘失敗 — public.pcm_b2_shipping_idempotency 解析不到(W0b 未套用)。'
      USING ERRCODE = 'P2B20';
  END IF;
  IF pg_catalog.to_regprocedure('public.admin_create_shipment(text,uuid,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'W2 前置閘失敗 — W1 的五支骨架解析不到(W1 未套用)。'
      USING ERRCODE = 'P2B20';
  END IF;
  -- 🔴 R1-F5 的守門要 `CREATE OR REPLACE` W0b 的 trigger 函式 ⇒ 它必須先在。
  IF pg_catalog.to_regprocedure('public.pcm_b2_shipping_idem_freeze_identity()') IS NULL THEN
    RAISE EXCEPTION 'W2 前置閘失敗 — W0b 的 pcm_b2_shipping_idem_freeze_identity() 解析不到。'
      USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- ── 1. 冪等指紋 ─────────────────────────────────────────────
-- `IMMUTABLE` 的理由與其誠實邊界見檔頭「決定 2」。
CREATE FUNCTION public.pcm_b2_shipping_idem_payload_hash(
  p_action  text,
  p_payload jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(
               pg_catalog.jsonb_build_object('v', 'b2w2:v1', 'action', p_action, 'payload', p_payload)::text,
               'UTF8')),
           'hex');
$fn$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_payload_hash(text, jsonb) IS
  'B2 出貨冪等指紋。輸入走 canonical jsonb(鍵序正規化、NULL 與空字串可分、無分隔符注入面)。'
  '🔴 action 進指紋:同一把鍵跨動作重用時指紋也分得開(鍵表 PK 已分,這是第二道)。'
  '🔴 IMMUTABLE 是**未被 PG 驗證的宣告**:payload 一旦含 timestamptz 之類 session 相關型別,這個標記就變成假的。'
  '🔴 零 GRANT、owner-only(形狀照 N3a pcm_generate_display_id)。';

-- ── 2. 回傳形狀的唯一產生處(R1-F4)──────────────────────────
-- 🔴 **W3 的硬契約**:首次成功與重放**都**必須用這支組回傳值,差別只有最後那個旗標。
--    不這樣做,同一把鍵的第一次與重試會拿到兩種 JSON —— 那不叫冪等。
CREATE FUNCTION public.pcm_b2_shipping_idem_response(
  p_shipment_id uuid,
  p_snapshot    jsonb,
  p_replay      boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
BEGIN
  -- 🔴 R2-F5:`jsonb || jsonb` 對**非 object** 的左運算元語意會翻成**陣列串接**
  --    ⇒ 回傳一個 array、`idempotent` 旗標整個消失(呼叫端讀不到冪等訊號卻以為成功)。
  --    走 `record()` 這條路不可達(W0b `…w0b.sql:85` 的 `snapshot_is_object` CHECK 先擋),
  --    但本函式是 owner 可直呼的 helper ⇒ **W3 直接餵 `'[]'::jsonb` 就構造得出**。
  --    ⇒ 在這裡自己擋,不倚賴「呼叫端一定先經過 record()」。
  IF pg_catalog.jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '出貨冪等回傳:snapshot 必須是 jsonb object(實得 %)—— 非 object 會讓信封的 || 變成陣列串接、idempotent 旗標消失',
                    coalesce(pg_catalog.jsonb_typeof(p_snapshot), 'NULL')
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_response_not_object';
  END IF;
  RETURN p_snapshot || pg_catalog.jsonb_build_object(
           'shipment_id', p_shipment_id,
           'idempotent',  p_replay);
END
$fn$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_response(uuid, jsonb, boolean) IS
  'B2 出貨 writer 的回傳形狀唯一產生處(對抗審查 R1-F4)。'
  '🔴 W3 首次成功必須回 response(id, snapshot, false)、重放由 claim() 回 response(id, snapshot, true) —— '
  '兩者**逐鍵相同、只差 idempotent 旗標**,由 scripts/w2-verify.sh 的 W2-RESPONSE-SHAPE 格釘住。'
  '🔴 信封的兩個鍵會蓋掉 snapshot 裡的同名鍵(方向正確:信封是權威)。';

-- ── 3. 認領 / 重放 ───────────────────────────────────────────
-- 回傳 NULL = **首次認領成功**(呼叫端繼續做業務);回傳非 NULL = **重放**(呼叫端直接回傳它)。
--
-- 🔴 §1c 面 4:**鍵列 INSERT 必須在產號重試迴圈<u>之外</u>。** 本 helper 就是那個「之外」——
--    五支都在做任何業務寫入**之前**呼叫它一次。W3 的重試迴圈只包 `shipments` 的 INSERT,
--    絕不得把本 helper 搬進迴圈:第二圈會撞到自己上一圈寫的鍵列 ⇒ 誤判成併發 ⇒ 轉重放 ⇒ 回半成品。
--
-- 🔴 §1c 面 3:同鍵並發撞唯一鍵 = **正常路、要轉重放**,不是錯誤。
--    READ COMMITTED 下第二個請求的 INSERT 會**卡在唯一索引上**等第一個結束:
--      第一個 commit ⇒ 我們拿到 23505 ⇒ 重讀(RC 的新 statement snapshot 看得到那列)⇒ 轉重放
--      第一個 abort  ⇒ 我們的 INSERT 直接成功 ⇒ 首次認領
--
-- 🔴 R1-F2:**不收 `shipment_id`**。認領一律寫 NULL,回填只有 `record()` 一條路(理由見檔頭決定 5)。
CREATE FUNCTION public.pcm_b2_shipping_idem_claim(
  p_action text,
  p_key    text,
  p_hash   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_row  public.pcm_b2_shipping_idempotency%ROWTYPE;
  v_con  text;
  v_live jsonb;
  v_bad  bigint;
BEGIN
  SELECT * INTO v_row FROM public.pcm_b2_shipping_idempotency
   WHERE action = p_action AND idempotency_key = p_key;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.pcm_b2_shipping_idempotency (action, idempotency_key, payload_hash)
      VALUES (p_action, p_key, p_hash);
      RETURN NULL;                       -- 首次認領(shipment_id 必為 NULL,等 record() 回填)
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      -- 🔴 §1d:**`IS DISTINCT FROM`,不得用 `<>`** —— conname 為 NULL 時 `<>` 回 NULL,
      --    `IF NULL THEN` 不成立 ⇒ 會**靜默吞掉**一個不該轉重放的 23505。
      --    (A5a `20260803160000:365-368` 逐字有這條註解,關卡1 R1-15 的前科。)
      --    🔴 R1-F7:本 schema 內**沒有已知會給 NULL conname 的來源**(裸 unique index 實測也給名字)
      --    ⇒ 這裡用 `IS DISTINCT FROM` 是**方向正確的保險**,不是「守著一個已證實可達的情境」。
      IF v_con IS DISTINCT FROM 'pcm_b2_shipping_idem_pk' THEN
        RAISE;                           -- 不是鍵表撞的 ⇒ 原封拋回,交給呼叫端(W3 的重試迴圈)分派
      END IF;
      SELECT * INTO v_row FROM public.pcm_b2_shipping_idempotency
       WHERE action = p_action AND idempotency_key = p_key;
      IF NOT FOUND THEN
        -- 撞了鍵表的唯一鍵、卻讀不到那列 = 不該發生。**不得靜默當成首次認領。**
        RAISE EXCEPTION '出貨冪等:撞到鍵表唯一鍵卻讀不到該列(action=% key=%)', p_action, p_key
          USING ERRCODE = 'P2B23', CONSTRAINT = 'pcm_b2_w2_idem_phantom';
      END IF;
    END;
  END IF;

  -- ── 以下是重放路徑 ──
  -- ① 重放證據比對(§1c 面 2:**取得鍵列之後、任何寫入之前**;不得先寫再回滾)
  -- 🔴 R1-F3:訊息**不得**叫員工「換一把新的冪等鍵」。本碼最常見的成因不是惡意送不同內容,
  --    而是呼叫端序列化不穩(品項陣列換序 / NULL↔'' / 使用者重整頁面)。員工照著換新鍵重送
  --    ⇒ 業務層當成全新請求 ⇒ **真的多出一箱貨** = 這一整層存在的理由被訊息自己推翻。
  IF v_row.payload_hash IS DISTINCT FROM p_hash THEN
    RAISE EXCEPTION '出貨冪等:這把單號(%)上次送的內容和這次不一樣,系統不敢猜要用哪一份。'
                    '🔴 請**不要換新單號重送** —— 那會真的多開一箱。請找出上次那筆確認要保留哪一份內容。(action=%)',
                    p_key, p_action
      USING ERRCODE = 'P2B22', CONSTRAINT = 'pcm_b2_w2_idem_payload_mismatch';
  END IF;

  -- ② §1c 面 4 的 fail-closed:半成品**不得**被當成成功重放回去
  -- 🔴 **誠實話(R2-F4 打掉了首版的說法)**:下面那發 DEFERRED 閘保證**已 commit 的列**不可能
  --    帶著 NULL 的 shipment_id ⇒ 本條的 `IS NULL` 分支對正常資料**恆假**,它**沒有獨立的判別力**。
  --    首版把它寫成「第二道防線 / 縱深」是**把一個恆假的分支說成防線**。
  --    留著的真實理由只有一個:**DEFERRED 閘擋不住 owner 的 `DISABLE TRIGGER` 或 `DROP`**,
  --    那條路走掉之後本條是唯一還會說話的東西 ⇒ 純 defense-in-depth,**不計入本片的守門帳**。
  --    harness 的 `W2-REPLAY-INCOMPLETE` 因此要靠「先關掉 DEFERRED 閘」才種得出負測 —— 那正是它的處境。
  IF v_row.shipment_id IS NULL THEN
    RAISE EXCEPTION '出貨冪等:這把單號(%)上次那筆沒有完成,系統不回傳半成品。請重新送一次同樣的內容。(action=%)',
                    p_key, p_action
      USING ERRCODE = 'P2B23', CONSTRAINT = 'pcm_b2_w2_idem_incomplete';
  END IF;

  -- ③ 產物集不變式重驗(泛型:快照裡凡是 shipments 欄名的鍵,逐值比現況)
  SELECT pg_catalog.to_jsonb(s.*) INTO v_live
    FROM public.shipments s WHERE s.id = v_row.shipment_id;
  IF v_live IS NULL THEN
    RAISE EXCEPTION '出貨冪等:存根指向的包裹已不存在(shipment_id=%)', v_row.shipment_id
      USING ERRCODE = 'P2B24', CONSTRAINT = 'pcm_b2_w2_idem_product_gone';
  END IF;
  SELECT pg_catalog.count(*) INTO v_bad
    FROM pg_catalog.jsonb_each(v_row.result_snapshot) e
   WHERE v_live ? e.key
     AND (v_live -> e.key) IS DISTINCT FROM e.value;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '出貨冪等:重放時發現包裹內容與上次的紀錄不一致(shipment_id=%,不符欄位 % 個)', v_row.shipment_id, v_bad
      USING ERRCODE = 'P2B24', CONSTRAINT = 'pcm_b2_w2_idem_invariant_broken';
  END IF;

  RETURN public.pcm_b2_shipping_idem_response(v_row.shipment_id, v_row.result_snapshot, true);
END
$fn$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_claim(text, text, text) IS
  'B2 出貨冪等認領:回 NULL = 首次認領(呼叫端繼續);回非 NULL = 重放結果(呼叫端直接回傳)。'
  '🔴 必須在**任何業務寫入之前**呼叫,且**絕不得被搬進 W3 的產號重試迴圈裡**(plan §1c 面 4)。'
  '🔴 認領一律把 shipment_id 寫成 NULL —— 回填只有 record() 一條路(對抗審查 R1-F2)。'
  '🔴 23505 分派用 CONSTRAINT_NAME + IS DISTINCT FROM;非鍵表撞的原封拋回。'
  '🔴 重放**四道**:payload_hash 不符 P2B22 / shipment_id 仍 NULL P2B23 / 產物已不存在 P2B24 / 不變式不符 P2B24。'
  '（首版此處寫「三道」而實際有四條 RAISE —— code review 的字面 vs 事實 nit,已更正。）'
  '🔴 零 GRANT、owner-only;不在 W7c 的五支凍結集合裡 ⇒ 由 scripts/w2-verify.sh 自帶凍結格守。';

-- ── 4. 回填(§1c 面 3:同一交易內)────────────────────────────
CREATE FUNCTION public.pcm_b2_shipping_idem_record(
  p_action      text,
  p_key         text,
  p_shipment_id uuid,
  p_snapshot    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $fn$
DECLARE
  v_n bigint;
BEGIN
  IF p_shipment_id IS NULL THEN
    RAISE EXCEPTION '出貨冪等回填:shipment_id 不得為 NULL(action=% key=%)', p_action, p_key
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_record_null_shipment';
  END IF;
  -- 🔴 R1-N13:不驗存在的話,傳錯 uuid 會寫進去成功,之後被 W0b 的 freeze 永久釘死,
  --    唯一症狀是往後所有重放都拿到 P2B24 product_gone —— 事後救比這一句貴得多。
  IF NOT EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = p_shipment_id) THEN
    RAISE EXCEPTION '出貨冪等回填:shipment_id % 不存在', p_shipment_id
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_record_no_such_shipment';
  END IF;

  -- 🔴 快照欄位契約**不在這裡**(R1-F5)—— 它畫在鍵表的 BEFORE UPDATE trigger 上,見下一節。
  --    畫在本函式上等於「守門畫在最窄的面」:五支是 SECURITY DEFINER、以 owner 執行,
  --    body 裡直接寫一句 UPDATE 就完全繞過本函式、零錯誤。
  UPDATE public.pcm_b2_shipping_idempotency
     SET shipment_id = p_shipment_id, result_snapshot = p_snapshot
   WHERE action = p_action AND idempotency_key = p_key;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '出貨冪等回填:改到 % 列(期望 1)⇒ 存根不見了或鍵不符(action=% key=%)', v_n, p_action, p_key
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_record_rowcount';
  END IF;

  -- 🔴 回傳首次成功的信封,讓 W3 直接 `RETURN public.pcm_b2_shipping_idem_record(...)`
  --    —— 形狀與重放**由構造保證相同**(R1-F4),不靠 W3 記得。
  RETURN public.pcm_b2_shipping_idem_response(p_shipment_id, p_snapshot, false);
END
$fn$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_record(text, text, uuid, jsonb) IS
  'B2 出貨冪等回填(plan §1c 面 3:與產物同一交易),並回傳**首次成功的信封**。'
  '三道:shipment_id 非 NULL / 該包裹存在 / ROW_COUNT=1。'
  '🔴 「改到 0 列」若不當場拋,存根會停在 shipment_id IS NULL ⇒ 下一次合法重試被 P2B23 卡死。'
  '🔴 快照欄位契約與 write-once **不在本函式**,在鍵表的 BEFORE UPDATE trigger 上(對抗審查 R1-F5:'
  '守門要畫在不變量成立的那個面 —— 畫在函式上,owner 直寫一句 UPDATE 就繞過去了)。'
  '🔴 零 GRANT、owner-only。';

-- ── 5. 🔴 R1-F5:把快照契約搬到**表**上(擴充 W0b 的 BEFORE UPDATE 守門)───
-- 首版把「快照不得含可變欄」寫在 `record()` 裡。實測面:五支是 SECURITY DEFINER、以 owner 執行,
-- 任何一支 body 裡寫一句 `UPDATE pcm_b2_shipping_idempotency SET result_snapshot = …` 就**完全繞過**,零錯誤。
-- 同處還缺 `result_snapshot` 的 write-once(W0b 的 freeze_identity 刻意不凍它)
-- ⇒ 已完成鍵列的重放證據**可被覆寫** = 重放會回到一份被改過的「上次結果」。
-- 🔴 兩條都是**表級不變量**,不是函式的內務 ⇒ 搬進 W0b 既有那發 trigger 的函式體
--    (memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`,本線第 N 次)。
-- 🔴 `CREATE OR REPLACE` 只換函式體,**trigger 本身不動**(仍是 W0b 建的、仍是 ENABLE ALWAYS)。
CREATE OR REPLACE FUNCTION public.pcm_b2_shipping_idem_freeze_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- 🔴 **可以進快照的 shipments 欄**。權威 = `…s1a2.sql:155-158` 的 pcm_b2_shipments_immutable_guard
  --    所凍的四欄,**減去 `created_at`**(排除理由 = timestamptz 的序列化,見檔頭)。
  --    🔴 這份清單會過期 —— shipments 或 s1a2 的凍結集合改了,沒人會想到來改它。
  --      ⇒ `w2-verify.sh` 的 `W2-SNAPSHOTABLE-REALLY-IMMUTABLE` 格**逐欄實測**:
  --        對 draft 態的列改該欄,必須被擋。清單裡混進可變欄 ⇒ 當場紅。
  c_snapshotable constant text[] := ARRAY['id','shipment_reference','customer_user_id'];
  v_ship_cols text[];
  v_bad_keys  text;
BEGIN
  IF NEW.action IS DISTINCT FROM OLD.action
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '出貨冪等存根的身分與證據四欄不可變更(action / idempotency_key / payload_hash / created_at):改鍵等於釋放冪等鍵,同鍵重來會多出一箱貨'
      USING ERRCODE = 'P0001', CONSTRAINT = 'pcm_b2_shipping_idem_freeze_identity';
  END IF;
  IF OLD.shipment_id IS NOT NULL AND NEW.shipment_id IS DISTINCT FROM OLD.shipment_id THEN
    RAISE EXCEPTION '出貨冪等存根的 shipment_id 一旦回填即不可改指(舊=% 新=%)', OLD.shipment_id, NEW.shipment_id
      USING ERRCODE = 'P0001', CONSTRAINT = 'pcm_b2_shipping_idem_freeze_identity';
  END IF;

  -- 🔴 W2 新增①:快照 **write-once**。
  --    🔴 **R2-F6:哨兵不得用 `OLD.result_snapshot <> '{}'`** —— `'{}'` 既是 W0b 的 DEFAULT
  --       **也是一個合法的快照值**(W3 傳空快照沒有任何守門攔它)⇒ 第一次就寫 `'{}'` 的列,
  --       `OLD` 永遠等於 `'{}'`,write-once **永不生效**、之後可被任意覆寫。
  --       (memory `feedback_fixture-value-makes-guard-vacuous`:哨兵值與合法值撞號。)
  --    ⇒ 改用 `OLD.shipment_id IS NOT NULL` 當「這列已完成」的判準:`record()` 把 shipment_id
  --      與 snapshot **同一句 UPDATE 一起寫**,所以 shipment_id 非空 ⇔ 快照已經寫過一次。
  IF OLD.shipment_id IS NOT NULL
     AND NEW.result_snapshot IS DISTINCT FROM OLD.result_snapshot THEN
    RAISE EXCEPTION '出貨冪等存根的 result_snapshot 一旦寫下即不可再改:它是重放要回給員工的「上次結果」,改了等於竄改重放證據'
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_snapshot_write_once';
  END IF;

  -- 🔴 W2 新增②:快照不得含**會被改動的 shipments 欄**(理由見檔頭 R1-F1 那節)。
  --    欄名從 catalog 取、不手抄:shipments 改欄名時本守門不會靜默失效。
  SELECT pg_catalog.array_agg(a.attname::text) INTO v_ship_cols
    FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = 'public.shipments'::pg_catalog.regclass
     AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT pg_catalog.string_agg(e.key, ', ' ORDER BY e.key) INTO v_bad_keys
    FROM pg_catalog.jsonb_each(NEW.result_snapshot) e
   WHERE e.key = ANY (v_ship_cols)
     AND NOT (e.key = ANY (c_snapshotable));
  IF v_bad_keys IS NOT NULL THEN
    RAISE EXCEPTION '出貨冪等存根:快照不得含會被改動的 shipments 欄(%)—— 放進去會讓合法的後續動作把不變式打成不一致,永久擋死那把鍵的重試', v_bad_keys
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_snapshot_mutable_col';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_freeze_identity() IS
  'W0b 身分凍結守門,**W2 擴充**(對抗審查 R1-F5)。凍 action / idempotency_key / payload_hash / created_at;'
  'shipment_id 只放行 NULL→值 一次;result_snapshot **write-once**;快照不得含可變 shipments 欄。'
  '🔴 這四條都是**表級不變量** —— 畫在 record() 上會被 owner 的一句直寫 UPDATE 繞過。'
  '🔴 誠實邊界不變:DB 層擋不住 owner 的 DROP / DISABLE TRIGGER(本 trigger 由 W0b 建、ENABLE ALWAYS)。';

-- ── 6. 🔴 R1-F2 的機制面:commit 當下不准留半成品 ──────────────
-- 「認領了但什麼都沒做」若能 commit,那把鍵就**永久卡死**(往後所有合法重試都撞 P2B23)。
-- 🔴 必須是 **DEFERRED**:回填發生在同一交易的後面,語句結束時檢查一定誤判。
-- 🔴 必須**重讀表**、不得用 `NEW`:deferred AFTER trigger 的 `NEW` 是**觸發當下**那個列版本
--    (仍是 NULL),用它會把每一筆正常流程都判死。這條已實測。
CREATE FUNCTION public.pcm_b2_shipping_idem_require_complete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_sid uuid;
BEGIN
  SELECT shipment_id INTO v_sid FROM public.pcm_b2_shipping_idempotency
   WHERE action = NEW.action AND idempotency_key = NEW.idempotency_key;
  IF v_sid IS NULL THEN
    -- 🔴 R2-F2/F3:訊息**不得下斷語說「業務層漏了呼叫 record()」** —— 同樣的觀察還有兩個成因:
    --    ① `record()` 被 SAVEPOINT 包住而該 savepoint 被 rollback ② 該列在本交易外被移除。
    --    歸因寫死會把人導去查錯地方。⇒ 只陳述觀察 + 列出可能成因。
    RAISE EXCEPTION '出貨冪等:交易結束時這把單號的存根仍未回填包裹(action=% key=%)⇒ 整筆擋下,單號不會被燒掉。'
                    '可能成因:業務層沒有呼叫 pcm_b2_shipping_idem_record()、或那次呼叫被 SAVEPOINT 回捲、或該存根列被移除。',
                    NEW.action, NEW.idempotency_key
      USING ERRCODE = 'P2B25', CONSTRAINT = 'pcm_b2_w2_stub_incomplete_at_commit';
  END IF;
  RETURN NULL;
END
$$;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_require_complete() IS
  'W2 半成品閘(對抗審查 R1-F2)。DEFERRED ⇒ 在 commit 當下才看,讓同交易的回填來得及。'
  '🔴 重讀表而非用 NEW:deferred trigger 的 NEW 是觸發當下的列版本(shipment_id 仍 NULL),用它會誤殺正常流程。'
  '🔴 它讓 claim() 裡的 P2B23 在正常情況下不可達 —— 兩層刻意都留,harness 用「拆掉本層才構造得出 P2B23」證各自的判別力。';

CREATE CONSTRAINT TRIGGER pcm_b2_shipping_idem_require_complete
  AFTER INSERT ON public.pcm_b2_shipping_idempotency
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.pcm_b2_shipping_idem_require_complete();

-- 🔴 照 W0b F5 的實測:不改 ALWAYS 的話,`SET session_replication_role='replica'` 一句就全繞過,
--    而那正是 `pg_restore --disable-triggers` 與災難 runbook 會用到的模式。
ALTER TABLE public.pcm_b2_shipping_idempotency
  ENABLE ALWAYS TRIGGER pcm_b2_shipping_idem_require_complete;

-- ── 7. helper 的 ACL:零 GRANT ────────────────────────────────
-- 🔴 五支 RPC 是 SECURITY DEFINER、以 owner 身分執行 ⇒ 呼得到,不需要任何 GRANT。
--    給了就等於開一條**繞過五支 RPC 直接動冪等帳**的路。
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_payload_hash(text, jsonb)       FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_response(uuid, jsonb, boolean)  FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_claim(text, text, text)         FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_record(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated, authenticator, service_role;
REVOKE ALL ON FUNCTION public.pcm_b2_shipping_idem_require_complete()              FROM PUBLIC, anon, authenticated, authenticator, service_role;

ALTER FUNCTION public.pcm_b2_shipping_idem_payload_hash(text, jsonb)       OWNER TO postgres;
ALTER FUNCTION public.pcm_b2_shipping_idem_response(uuid, jsonb, boolean)  OWNER TO postgres;
ALTER FUNCTION public.pcm_b2_shipping_idem_claim(text, text, text)         OWNER TO postgres;
ALTER FUNCTION public.pcm_b2_shipping_idem_record(text, text, uuid, jsonb) OWNER TO postgres;
ALTER FUNCTION public.pcm_b2_shipping_idem_require_complete()              OWNER TO postgres;

-- ── 8. 五支 RPC:接上冪等層 ──────────────────────────────────
-- 🔴 **簽章一字不動**(W1 已凍結):帶 DEFAULT 的參數若改了,`CREATE OR REPLACE` 會變成**新 overload**,
--    舊入口連同它的 `GRANT … TO service_role` 會活著 —— a9h 事故(PGRST202,正式站壞 8 小時)的形狀。
-- 🔴 body 順序刻意固定:**隔離閘 → 指紋 → 認領 → 重放回傳 → 業務層佔位**。

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
DECLARE v_replay jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_create_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  v_replay := public.pcm_b2_shipping_idem_claim(
    'create_shipment', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('create_shipment', pg_catalog.jsonb_build_object(
      'customer_user_id',   p_customer_user_id,
      'recipient_snapshot', p_recipient_snapshot,
      'carrier_code',       p_carrier_code,
      'carrier_note',       p_carrier_note)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  RAISE EXCEPTION 'admin_create_shipment:W2 冪等層已就位,業務層尚未實作(W3)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_add_shipment_items(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE v_replay jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_add_shipment_items:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  v_replay := public.pcm_b2_shipping_idem_claim(
    'add_items', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('add_items', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'items',       p_items)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  RAISE EXCEPTION 'admin_add_shipment_items:W2 冪等層已就位,業務層尚未實作(W3)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_mark_shipment_shipped(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_tracking_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE v_replay jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_shipment_shipped:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  v_replay := public.pcm_b2_shipping_idem_claim(
    'ship', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('ship', pg_catalog.jsonb_build_object(
      'shipment_id',     p_shipment_id,
      'tracking_number', p_tracking_number)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  RAISE EXCEPTION 'admin_mark_shipment_shipped:W2 冪等層已就位,業務層尚未實作(W3)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_void_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_void_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE v_replay jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_void_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  v_replay := public.pcm_b2_shipping_idem_claim(
    'void', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('void', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id,
      'void_reason', p_void_reason)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  RAISE EXCEPTION 'admin_void_shipment:W2 冪等層已就位,業務層尚未實作(W3c)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE OR REPLACE FUNCTION public.admin_unvoid_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE v_replay jsonb;
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_unvoid_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  v_replay := public.pcm_b2_shipping_idem_claim(
    'unvoid', p_idempotency_key,
    public.pcm_b2_shipping_idem_payload_hash('unvoid', pg_catalog.jsonb_build_object(
      'shipment_id', p_shipment_id)));
  IF v_replay IS NOT NULL THEN RETURN v_replay; END IF;
  RAISE EXCEPTION 'admin_unvoid_shipment:W2 冪等層已就位,業務層尚未實作(W3c)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

-- ── 9. 🔴 檔內 fail-closed 斷言(形狀照 W1 §4)────────────────
-- harness 跑在**裸 PG**,ACL 格證不了正式站。正式站唯一會在 apply 當下說話的,就是這一段。
DO $$
DECLARE
  r record;
  v_bad text := '';
  v_n   bigint;
  c_helpers constant text[] := ARRAY['pcm_b2_shipping_idem_payload_hash','pcm_b2_shipping_idem_response',
                                     'pcm_b2_shipping_idem_claim','pcm_b2_shipping_idem_record',
                                     'pcm_b2_shipping_idem_require_complete'];
  c_rpcs    constant text[] := ARRAY['admin_create_shipment','admin_add_shipment_items',
                                     'admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment'];
BEGIN
  -- ① 五支 helper 都在、且**零非 owner grantee**
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (c_helpers)
  LOOP
    -- 🔴 不得 join pg_roles(它會靜默丟掉 PUBLIC / grantee=0 那列;W0b n-1 實測)
    IF (SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
         WHERE p.oid = r.sig::regprocedure AND a.grantee <> p.proowner) > 0 THEN
      v_bad := v_bad || r.sig || '(helper 有非 owner grantee) ';
    END IF;
  END LOOP;
  SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = ANY (c_helpers);
  -- 🔴 迴圈若一支都沒跑到,上面每個 IF 都不會執行 ⇒ 恆真。這道擋的就是那個。
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'W2 斷言:五支 helper 不齊(實得 %)', v_n USING ERRCODE = 'P2B20';
  END IF;

  -- ② 五支 RPC 各自**恰好一個** signature(無 overload)。
  --    🔴 R1-N10:首版用 `proname LIKE 'admin\_%shipment%'` 數到恰 5 ⇒ W3/W4 只要新增第六支
  --       名字含 shipment 的 admin 函式,本斷言會紅在一個與 W2 無關的原因上。改成逐名點驗。
  FOR r IN SELECT pg_catalog.unnest(c_rpcs) AS sig LOOP
    SELECT pg_catalog.count(*) INTO v_n FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = r.sig;
    IF v_n <> 1 THEN
      v_bad := v_bad || r.sig || '(signature 數 = ' || v_n || ',期望 1)';
    END IF;
  END LOOP;

  -- ③ 🔴 code review nit:五支對 service_role 的 EXECUTE 必須**仍在**。
  --    首版只間接依賴「簽章不變 ⇒ PG 保留 ACL」,而檔頭自己點名的 a9h 事故正是這個風險面。
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = ANY (c_rpcs)
  LOOP
    IF NOT pg_catalog.has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      v_bad := v_bad || r.sig || '(service_role 掉了 EXECUTE) ';
    END IF;
    IF pg_catalog.has_function_privilege('anon', r.sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r.sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticator', r.sig, 'EXECUTE') THEN
      v_bad := v_bad || r.sig || '(對外角色仍可執行) ';
    END IF;
  END LOOP;

  -- ④ 🔴 **R2-F12:兩發 trigger 的存在與 `tgenabled` 必須在這裡驗。**
  --    F2/F4/F6 的整條安全論證都建立在「trigger 在、而且是 ENABLE ALWAYS」上,
  --    而正式站 apply 當下唯一會說話的就是本段 —— 首版卻**漏掉最關鍵的那個物件**。
  --    `tgenabled`:'A'=ALWAYS / 'O'=ORIGIN(預設)/ 'D'=DISABLED / 'R'=REPLICA。
  --    只有 'A' 擋得住 `SET session_replication_role='replica'`(W0b F5 實測)。
  FOR r IN SELECT pg_catalog.unnest(ARRAY['pcm_b2_shipping_idem_block_delete',
                                          'pcm_b2_shipping_idem_block_truncate',
                                          'pcm_b2_shipping_idem_block_identity_update',
                                          'pcm_b2_shipping_idem_require_complete']) AS sig
  LOOP
    SELECT pg_catalog.count(*) INTO v_n
      FROM pg_catalog.pg_trigger t
     WHERE t.tgrelid = 'public.pcm_b2_shipping_idempotency'::pg_catalog.regclass
       AND t.tgname = r.sig AND NOT t.tgisinternal AND t.tgenabled = 'A';
    IF v_n <> 1 THEN
      v_bad := v_bad || r.sig || '(trigger 不在、或 tgenabled 不是 ALWAYS) ';
    END IF;
  END LOOP;
  -- 🔴 併驗「恰為這四發」:多一發沒人知道的 trigger 也是風險面(集合軸,不只點名軸)。
  SELECT pg_catalog.count(*) INTO v_n
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.pcm_b2_shipping_idempotency'::pg_catalog.regclass AND NOT t.tgisinternal;
  IF v_n <> 4 THEN
    v_bad := v_bad || '鍵表 trigger 數 = ' || v_n || '(期望 4)';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'W2 斷言失敗:%', v_bad USING ERRCODE = 'P2B20';
  END IF;
  RAISE NOTICE 'W2 斷言通過:五支 helper 零 GRANT + 五支 RPC 無 overload + ACL 未漂 + 鍵表四發 trigger 皆 ALWAYS';
END
$$;

COMMIT;
