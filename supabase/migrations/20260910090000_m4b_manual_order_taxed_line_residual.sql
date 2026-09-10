-- ⟦b4-INVOICE5PCT⟧ ② 反推換算 —— 含稅那一列的稅【用減的】,而不是再正推一次。
--
-- ══ 🛑 貼這一支之前要先看的一句(給貼的人)═══════════════════════════════════
-- **這一片有兩份證據,而【沒有人同時驗過兩邊】。**
--   · codex(R1/R2)用 **400,000 組精確有理數**驗【算式】—— 而它自陳
--     「**未重跑真正 RPC、未查正式庫:本機 PostgreSQL 無回應;
--       檔頭宣稱的 PG fixture 測試不列為本次已驗證**」。
--   · 我用**拋棄式 PG + 真的那支 RPC** 驗【行為】—— 而那些讀數是**我跑的,不是它驗的**。
-- ⇒ 📌 **兩份證據各自獨立,而它們的交集沒有人看過。**
-- ⇒ 🛑 **這不是要誰補驗** —— 是**貼的人要知道自己在貼什麼**。
--
-- ══ Sean 拍的 ═══════════════════════════════════════════════════════════
-- 2026-09-10 `Q2' = 甲`:「把我們系統的算稅法改成跟那個工具一樣(**用減的**)」。
-- 📎 plan `docs/plans/2026-09-10-manual-order-tax-package-plan.md`(§8-a-2 ~ §8-a-4)。
--
-- 🔴🔴 **而【他拍的字面】與【這一片做的事】之間有一格,寫在這裡免得下一個人以為他拍過這個形狀**:
--    他拍的字面是「算稅法改成殘差」,而**常態路徑(員工 key 未稅 + 勾發票)根本沒有一個含稅數字
--    可以相減** ⇒ 殘差在那條路上**不存在**。
--    ⇒ 他拍的仍然成立,而它的意思是:**「走【反推】那條路的時候,把算出來的稅帶著走,
--      而不是讓這支函式再自己算一次。」** 📌 **那是實作端補完的,不是他說的。**
--
-- ══ 🔬 為什麼「用減的」—— 而它不是偏好 ═══════════════════════════════════
-- 那個工具(`simpany.co/invoice-helper`,Sean 指定)的算法**實際操作量到的**:
--   `未稅 = round(含稅 / 1.05)`,而 **`稅額 = 含稅 - 未稅`(殘差)**;實測 1100 ⇒ 1048 / 52。
-- 而**我們今天是正推** `round(未稅 x 5 趴)` ⇒ 🔴 兩者在 1..20,000 裡**有 952 個金額差一塊**。
--
-- ══ 🔴 而【逐列】取殘差,順帶把數量那個老問題解掉 ═══════════════════════════
-- 舊的整除閘(`manual-order-form.ts` 的 `untaxedFromTaxed`)拒絕四捨五入,理由逐字:
--   「含稅 999 ⇒ 若四捨五入成未稅 951,數量 1 加回 5 趴是 999,而**數量 2 是 1,997 而不是 1,998**」
-- 🔬 而**殘差跟著那一列走、乘以數量**之後(實算):
--   含稅1100×1 ⇒ 1100 · ×2 ⇒ 2200 · ×3 ⇒ 3300 · 含稅999×2 ⇒ 1998 · 含稅31×7 ⇒ 217
-- ⇒ 🎯 **差全部是 0** ⇒ 那個「數量 >= 2 差一塊」的理由**在殘差之下不成立**。
--
-- ══ 🔴🔴 混單那一格 —— **它不是角落,是四筆裡有一筆** ═══════════════════════
-- 甲 整包正推 · 乙 分開算(未稅那些正推 + 含稅那些取殘差)
-- 🔬 掃 600×600 組合 ⇒ **兩者分岔 94,741 / 360,000 約 26 趴**。
--   例:未稅列 1 + 含稅列 31(未稅 30)⇒ 小計 31;甲稅 2 ⇒ 那列回到 **32**(員工打的是 31);乙稅 1 ⇒ **31**
-- ⇒ **必須是乙,而它不是偏好** —— 甲會讓員工打的含稅數字回不來,
--   **而「回得來」正是 Sean 拍那一題要買的東西** ⇒ 📌 **甲直接違反那個拍板。**
--
-- ══ 🛑 這一片【不做】的事 ═════════════════════════════════════════════════
-- ⛔ **常態路徑一個字不動** —— 員工 key 未稅 + 勾發票:今天怎麼算,明天一模一樣。
-- ⛔ **沒勾發票一個字不動** —— 不換算、不加稅(Sean 逐字「沒勾就是他打的數字即總額」)。
-- ⛔ **顧客站那支 `create_order` 不碰**(Sean 2026-09-10 `Q5 = 甲`)。
--    ⚠️ 而那支的稅那一段**逐字承諾過**「算式與捨入逐字抄後台那支,**不自創第二種**」
--    ⇒ 🔴 **本片主動打破那個承諾** —— 那不是疏忽,是拍板;而它寫在這裡,不靜靜發生。
-- ⛔ 🔴 **運費那一側【不在本片】** —— 本函式**收不到運費的稅基**(實查:`prosrc` 裡
--    `shipping` 與 `basis|taxed` 同時出現的行 = 0),而 `p_invoice` 有一道 exact-key 白名單。
--    ⇒ 📌 **所以含稅運費今天仍然走舊路**(除得盡才換、除不盡整張單被擋)。
--    ⏰ **那是一個【已知而刻意留下】的缺口**,不是漏掉;要補它得動簽章 ⇒ 另一片。
--
-- ══ 🔵 形狀:不改簽章 ═════════════════════════════════════════════════════
-- `p_lines` 是 jsonb ⇒ 新增一個**選填鍵** `unit_price_taxed` 就夠,**不必加參數、不必開多載**。
-- 🔬 簽章實量(唯讀正式庫):只有 1 支多載 · secdef t · strict f · search_path 空 · proacl 含 service_role。
-- 🛑 **缺鍵 = 舊版表單** ⇒ 不 RAISE(部署順序是「先貼 migration、再上碼」)。
--
-- ══ 🔴 而它【不信 client 送的數】 ═══════════════════════════════════════════
-- 表單那一側仍然送**換算後的** `unit_price`,而本函式**自己再算一次**並比對 —— 不合就拒。
--
-- ══ 🔬 本體怎麼來的 —— **不是手打的** ═════════════════════════════════════
-- 整段本體**逐字取自正式庫**(2026-09-10 唯讀 `pg_proc.prosrc`),舊 md5
-- `3804f3463058df0062ac5ca34efcb2c9` · 長 42,865;**六處具名替換**在【編檔時】做,
-- 而**機械證明**跑過:把三段新的換回舊的 ⇒ **與原文逐字元相同**。
-- 新本體 md5 `6c7f869621c5e1781ef32af2642a9883` · 長 45,985。
-- 🔵 ⛔ ~~第一版把替換寫成【貼的時候才做】(`EXECUTE format(...)` + 字串裡的碼)~~
--    🔴 **那個形狀與這個 repo 的靜態閘【結構上】相衝**:那些閘逐行讀這一支檔,
--    而碼住在字串字面裡 ⇒ 它們讀不懂 ⇒ 連續擋了三次(RAISE 佔位、SECURITY DEFINER 的 search_path)。
--    ⇒ 📌 **那不是閘太嚴,是我把碼藏進字串裡。** 改成【編檔時替換、檔裡是完整本體】。
--
-- ══ ✅ 行為驗證 —— **用【真的那支 RPC】跑的,不是重寫一份算式來比** ═══════════
-- 拋棄式 PG 17.10,fixture 的 6 張表 / 6 個 enum / 2 支 helper **全部從正式庫 catalog 取來**;
-- 基準本體 md5 對得上 `3804f346…` ⇒ 📌 **跑的是同一支函式,不是一個長得像的。**
--
--   情境                          貼之前          貼之後          判定
--   常態 未稅1000+運100+勾        稅55 總1155     稅55 總1155     ⚪ 逐格相同
--   常態 未稅1000+運100+沒勾      稅0  總1100     稅0  總1100     ⚪ 逐格相同
--   常態 未稅1000×3+勾            稅150 總3150    稅150 總3150    ⚪ 逐格相同
--   含稅1100(送1048)×1+勾         總1100          總1100          兩邊都對(它在 952 之外)
--   🎯 含稅1100(送1048)×2+勾      總2201 🔴       總2200 ✅       修好了
--   🎯 混單 未稅1 + 含稅31(送30)  總33   🔴       總32   ✅       修好了
--
-- 🔵 而 codex R1 那四條 must-fix 的反例, 每一條各跑一格(用它給的那組數):
--   MF1 同一顆 request_id 先送含稅31 再送含稅32 ⇒ 🔴 拒(P858B「編號用過了而內容不一樣」)
--       ⚪ 而正對照:內容【完全相同】的第二次 ⇒ `idempotent: true` 回同一張 ⇒ 冪等沒被弄壞
--   MF2 沒勾發票 + 呼叫端保留原值(1050 配 1050)⇒ ✅ 建得出來(不再誤拒)
--   MF3 稽核逐字留下 `"unit_price_taxed": 31` ⇒ ✅ 原值還原得回來
--   MF4 兩列同料號同品名同規格、含稅 31 與 32 ⇒ ✅ 兩列都收(不再被當重複)
--   MF5 見 rollback 檔:貼完之後有人再改一次 ⇒ 🔴 回退前置閘三【拒】, 訊息叫人先退那一支
--
-- 🔵 而三格邊界也跑了:
--   送錯的 unit_price(1050 配 1100)⇒ 🔴 拒:「品項 [E] 的含稅 1100 換算回未稅應為 1048, 而送來的是 1050」
--   舊版表單(taxed 而缺新鍵)      ⇒ ⚪ 照舊行為, 不報錯(部署窗口活著)
--   沒勾發票 + 有新鍵              ⇒ ⚪ 稅 0, 殘差不套用
-- 📌 **前三列是【負對照】** —— 它們證明爆炸半徑真的只有走反推那條路,
--    而不是「我以為只有那條路」。
--
-- ══ ⚠️ codex R1 三條 nit —— 射程收窄(不是修碼)═══════════════════════════
-- nit 一 **驗證表不足以支持「爆炸半徑只有反推路徑」** ⇒ ✅ 收下, 已補四格(見上面 MF1~MF4),
--    而**仍然沒跑的世界寫在這裡**:同鍵更換含稅價之外的其他欄、後續修補再回滾的組合。
-- nit 二 🔴 **運費仍呼叫同一支 `untaxedFromTaxed`** ⇒ **下一片若把它改成四捨五入, 運費會【同步】被放寬**,
--    而本函式收不到運費稅基 ⇒ 反例(codex 給的):含稅品項 1,050 + 含稅運費 31,
--    運費換成 30 之後本 RPC 算總額 **1,082**, 而應收是 **1,081**。
--    ⇒ 📌 **那是【接線限制】不是本片的 bug** —— 而它必須寫在這裡, 因為踩到它的是下一片。
-- nit 三 **「與那個工具一致」只到【單價換算】為止, 不延伸到整張發票的拆稅**:
--    含稅 31 x 7 ⇒ 本片是未稅 210 / 稅 7;而對總額 217 反推是未稅 207 / 稅 10。
--    ⇒ **總額一致而拆稅不同** ⇒ 📌 那一格【沒有被證明】, 不要讀成「發票怎麼拆都一樣」。
--
-- ══ 🔴 codex R1 五條 must-fix —— 四條在這一支, 一條在 rollback ═══════════════
-- 一 **不同應收金額被判成同一筆重送**:冪等指紋是從 `v_items` 算的, 而它沒收含稅原值
--    ⇒ 含稅 31 與 32(未稅都是 30)指紋一模一樣 ⇒ 第二次回第一張單。
--    ✅ `v_items` 加 `unit_price_taxed`(不進 `product_snapshot` 的白名單;下游 INSERT 逐鍵取值)。
-- 二 **「沒勾發票一切照舊」不成立**:換算比對原本是無條件的 ⇒ 沒勾而呼叫端保留原值 ⇒ 拒單;
--    而呼叫端為了過關改送未稅 ⇒ 後面又不加稅 ⇒ 📌 **少收 5 趴**。
--    ✅ 比對改成 `IF v_invoice_requested AND v_line_taxed IS NOT NULL`。
-- 三 **原始含稅價永久遺失**:`30 x 21/20 = 31.5` 還原不回 31 或 32 ⇒ 那是資料遺失。
--    ✅ 稽核那一列(`v_line_bases`)加 `unit_price_taxed`。
-- 四 **合法的不同價代購列被壓成重複**:去重鍵用未稅價 ⇒ 31 與 32 撞在一起。
--    ✅ 去重鍵加含稅原值 —— 而那與該鍵原本「要更寬」的方向一致。
-- 五 rollback 那條 ⇒ 見 `supabase/rollbacks/20260910090000_down.sql` 檔頭。
--
-- ══ 🔴 三處 RAISE 用 `USING MESSAGE =` 而不是格式佔位 ═══════════════════════
-- 值仍然印得出來,而**零佔位** ⇒ 靜態閘第⑥道讀得懂,而它不必被調鬆。

BEGIN;

-- ── 前置閘 ────────────────────────────────────────────────────
DO $pre$
DECLARE
  v_src text;
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text)'
     ) IS NULL THEN
    RAISE EXCEPTION '前置閘一:找不到那支函式(簽章不對, 或它還沒貼)';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure(
     'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text)');

  -- 🔴 **本體指紋** —— 本片的三處替換是對【那一版】做的, 而那個前提要有值可以比。
  IF pg_catalog.md5(v_src) <> '3804f3463058df0062ac5ca34efcb2c9' THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘二:函式體 md5 不是 2026-09-10 取來的那一版(實得 ' || pg_catalog.md5(v_src)
      || ')⇒ 有人動過它, 本片的替換基準已失效';
  END IF;

  -- 🔴 **防重貼**
  IF pg_catalog.strpos(v_src, 'unit_price_taxed') > 0 THEN
    RAISE EXCEPTION '前置閘三:函式體裡已經有 unit_price_taxed ⇒ 這一片貼過了, 拒重貼';
  END IF;

  -- 🔵 **正對照:那把尺不是恆回 0**
  IF pg_catalog.strpos(v_src, 'v_line_basis') = 0 THEN
    RAISE EXCEPTION '前置閘四(正對照):連 v_line_basis 都找不到 ⇒ 這把尺在錯的東西上';
  END IF;

  -- ⚪ **負對照**
  IF pg_catalog.strpos(v_src, 'zzz_never_a_literal') > 0 THEN
    RAISE EXCEPTION '前置閘五(負對照):現造字面竟然命中 ⇒ 這把尺壞了';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.admin_create_manual_order(
  p_customer_user_id uuid,
  p_manual_request_id uuid,
  p_actor text,
  p_order_source text,
  p_payment_channel text,
  p_shipping_method text,
  p_ship_to jsonb,
  p_invoice jsonb,
  p_shipping_fee integer,
  p_lines jsonb,
  p_notification_email text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_line        jsonb;
  v_qty         integer;
  v_unit_price  integer;
  v_sku         text;
  v_title       text;
  v_spec        jsonb;
  v_variant_id  uuid;
  v_line_total  bigint;
  v_subtotal    bigint := 0;
  v_total       bigint;
  -- 🔴 **第 6 代新增**:稅額。`bigint` 與 `v_subtotal`/`v_total` 同族, 溢位在同一道閘擋。
  v_tax         bigint;
  -- 🔴 **這個值出現在兩個地方**(INSERT 的值列 + audit payload)⇒ 收成一個變數。
  --    兩份字面會分岔, 而分岔時**沒有東西會叫** —— audit 說 inclusive 而資料是 exclusive。
  -- 🔴🔴 **第 7 代:它不再是 `constant`**(⟦b4-INVOICE5PCT⟧, Sean 2026-09-04 逐字
  --    「那如果我沒有勾選開發票價錢都不加」)⇒ 由 `v_invoice_requested` 決定, 見下方稅那一段。
  --    🛑 **拿掉 `constant` 這件事本身沒有守門** —— 它只是讓賦值合法;
  --       真正釘住「兩個世界各是什麼」的是那一段 `IF`, 與事後斷言③。
  v_price_tax_mode text;
  v_items       jsonb := '[]'::jsonb;
  -- 🔴🔴 **第 7 代新增:員工在每一列選的「未稅 / 含稅」—— 只為了記進稽核。**
  --    codex R3(2026-09-09 換模型換角度)打出來的那一條:沒勾開發票時兩種稅基**都不換算**
  --    ⇒ 「填 1,050 選含稅」與「填 1,050 選未稅」在資料庫裡**長得一模一樣**
  --    ⇒ 📌 三個月後退款爭議, 查不到他當初的意思。🛑 **不是 log 難找, 是那個資訊沒有被存下來。**
  --    ✅ Sean 2026-09-09 拍甲逐字:「先上, 而同一片多做一件:把他選的『未稅/含稅』記進稽核紀錄」。
  v_line_basis  text;
  v_line_bases  jsonb := '[]'::jsonb;
  -- 🔴🔴 **稽核要對得回 `order_items` 的【那一列】, 而唯一穩定的身分是它的 id。**
  --    ⛔ ~~第一版記 `line_key`(去重用的那把:料號|品名|單價|規格)~~ **codex R5 打掉它**:
  --      🔬 失敗情境逐字可構造:兩列合法代購, 料號品名規格相同而單價 1,000 / 1,200
  --      ⇒ 兩把 key 不同;而未開發票未付款的單**合法**可用 `admin_update_order_item_amount`
  --        把第一列改成 1,200 ⇒ 📌 **原本 1,000 那把對不到任何列, 原本 1,200 那把同時命中兩列。**
  --      🎯 **⇒ 它把一個【可以被改的值】當成身分的一部分。**
  --    ⛔ 而 `line_key` 還有第二個病:它明文含品名與規格(自由文字)⇒ 把員工輸入
  --      **多抄一份**進 append-only 的稽核表, 而那與本函式 G9 那段「少抄一份 = 少一個
  --      會過期、會外洩的副本」直接衝突。**我當時寫「不含敏感值」是錯的** —— 規格是自由文字。
  --    ✅ ⇒ 改成**自己生 id、明確寫進 `order_items`**, 稽核只記那個 id + 稅基 + 單價。
  --      🔵 **不動表結構**(`order_items.id` 本來就是 uuid 主鍵, 只是原本走 DEFAULT)。
  --      🔵 **不進冪等指紋** —— 它不進 `v_items`(那是指紋的來源);重送在指紋比對那一步就
  --        早退了, 根本走不到這個 INSERT。
  v_item_id     uuid;
  v_item_ids    jsonb := '[]'::jsonb;
  v_ship_to     jsonb;
  v_invoice     jsonb;
  -- 🔴 第④代新增(`⟦b4-INVOICE5PCT⟧` 第 2 步):**這張單開不開發票**。
  --    🛑 與 `v_invoice` 是兩件事:那個講「開的話抬頭寫誰」, 本欄講「開不開」。
  v_invoice_requested boolean;
  -- 🔴 ⟦b4-INVOICE5PCT⟧二:含稅那一列的【原值】與【殘差】。
  v_line_taxed     integer;
  v_taxed_residual bigint := 0;
  v_untaxed_base   bigint := 0;
  v_tier        public.member_tier;
  v_display_id  text;
  v_order_id    uuid;
  v_existing    record;
  v_attempt     integer;
  v_cname       text;
  v_n           integer;
  -- codex R1 `:186`:跨列去重的累積器(形狀照 `create_order` `20260730120100:322-325`)
  v_seen        text[] := ARRAY[]::text[];
  v_key         text;
  -- codex R1 `:143`/`:248`:正規化後的整包輸入 + 它的指紋
  v_canonical   jsonb;
  v_payload_sha text;
  -- 🔴 `''` 必須收斂成 NULL:`orders_notification_email_valid`(`20260718120000:125-127`)的
  --    `~ '^[!-~]+$'` 對空字串**不成立** ⇒ 直接寫 `''` 會被 CHECK 擋、整張單建不出來。
  --    而員工「留白」送過來的就是 `''`(HTML 表單的空欄不是 NULL)。
  v_notification_email text;
  -- codex R1 `:138`:兩個**業務上限**。
  -- 🔴 **這兩個數字是我挑的,Sean 沒有拍過。** 挑法=比實務用量大一個數量級、
  --    又小到擋得住「一發打爆」:電話單實務上個位數筆、單筆數量兩位數。
  --    ⇒ 撞到它們的時候要**改這裡並問 Sean**,不要在呼叫端拆單繞過去。
  c_max_lines   constant integer := 50;
  c_max_qty     constant integer := 9999;
BEGIN
  -- ── G1 輸入:每一格各自一道,訊息講【哪一格】不講「輸入有誤」 ──────────────
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定客人(customer_user_id 是 NULL);拒絕建出無主單';
  END IF;
  IF p_manual_request_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 缺冪等鍵(manual_request_id);沒有它,重送會建出第二張單';
  END IF;
  -- 🔴🔴 F1(R3 f5):**憑空建單卻記不住是誰做的** —— 而「憑空建單」正是本片新增的能力。
  --    對照:退款登記那支(`20260820021000`)提到 actor **29 次**;本檔上一版**零次**。
  --    f5 的框架句(收下,不改寫):兩片一起上線之後,能力邊界變成
  --    「**有後台密碼的人可以造出一條完整的假金流鏈,而鏈上第一環查不出是誰做的**」
  --    (建單 → 灌假收款 → 退款,三片各自都說「那不歸我管」,而沒有一片說錯)。
  --    ⇒ 走 `admin_audit_log`,**不在 `orders` 加欄**(那張表本來就沒有 actor 欄,
  --      而 audit 是這個 repo 既有的、對的載體)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, E' \t\r\n') = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有指定經手人(actor);'
                    '手動單是憑空建出來的,**不知道是誰建的單不准建**';
  END IF;
  -- 🔴 FK 只擋「不存在」,**擋不到已停用的** ⇒ 這一道查 is_active(逐字同 `20260820021000:198-199`)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = pg_catalog.btrim(p_actor, E' \t\r\n') AND s.is_active) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 經手人 [%] 不是啟用中的員工 ⇒ 拒絕建單。'
                    '🔴 手動建單的失敗模式是【人】,而 actor 是唯一的線索 —— '
                    '拿一個查不到的名字建單,等於這張單沒有來源。', p_actor;
  END IF;
  IF p_order_source IS NULL OR p_order_source NOT IN ('manual_phone', 'manual_line', 'manual_other') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 來源 [%] 不是手動三值之一', p_order_source;
  END IF;
  -- 🔴 具名拒 tappay:刷卡那條路由 TapPay 那一側寫,人工建單不得宣稱一筆卡片交易。
  IF p_payment_channel = 'tappay' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 手動單不得標記為線上刷卡(tappay);那條路由付款確認寫入';
  END IF;
  IF p_payment_channel IS NULL OR p_payment_channel NOT IN ('bank_transfer', 'cash') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金流管道 [%] 不是 bank_transfer 或 cash', p_payment_channel;
  END IF;
  IF p_shipping_method IS NULL OR p_shipping_method NOT IN ('home', 'store') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 配送方式非白名單(%);僅 home/store', p_shipping_method;
  END IF;
  IF p_shipping_fee IS NULL OR p_shipping_fee < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 運費必須是 0 或正整數(收到 %)', p_shipping_fee;
  END IF;
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 沒有品項;一張單至少要有一個品項';
  END IF;
  -- 🔴 codex R1 `:138`:**沒有上限的迴圈**。舊版靠「總額 > integer 上限」兜底,而那道
  --    對 `unit_price = 0` 的品項**零判別力** ⇒ 幾萬筆零元品項可以整包穿過去。
  IF pg_catalog.jsonb_array_length(p_lines) > c_max_lines THEN
    RAISE EXCEPTION 'admin_create_manual_order: 一張單最多 % 個品項(收到 %);超過請拆單,'
                    '或這個上限要調整 ⇒ 找系統維護(它是保守預設值、未經拍板)',
                    c_max_lines, pg_catalog.jsonb_array_length(p_lines);
  END IF;

  -- 🔴🔴 **冪等格搬到 G6 之後了**(codex R1 `:143`)。
  --    原本它在這裡 = 「鍵在就回成功」,**完全不看內容** ⇒ 同鍵裝不同內容時,
  --    員工以為新單建好了,實際拿到的是**舊那張單**。
  --    ⇒ 要比對內容,就必須**先把內容正規化完**(G4/G5/G6 做那件事)⇒ 冪等格只能排在它們之後。
  --    ⚠️ 排序安全性:重送同一包輸入時,G3-G6 全部是**決定性**的(同輸入同結果)
  --       ⇒ 不存在「完全相同的重試被前面某道閘誤擋」那個坑
  --       (退款 RPC `20260820021000:238-242` 踩過的正是那個坑,方向相反)。

  -- ── G3 客人必須存在(FK 也會擋,而這裡先擋是為了給員工看得懂的訊息) ────────
  SELECT c.tier INTO v_tier FROM public.customers c WHERE c.user_id = p_customer_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_create_manual_order: 找不到這位客人(user_id=%);請先建立客人資料',
                    p_customer_user_id;
  END IF;

  -- ── G4 收件快照:逐鍵白名單重組,**不收員工原樣的 jsonb** ───────────────────
  -- 🔴 表上有 exact-key CHECK(`20260604120000` orders_ship_addr_whitelist)
  --    ⇒ 多一個鍵就整筆回滾。這裡自己組,壞掉的輸入在這裡就講清楚。
  IF p_ship_to IS NULL OR pg_catalog.jsonb_typeof(p_ship_to) <> 'object'
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'name', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'phone', '')) = ''
     OR pg_catalog.btrim(COALESCE(p_ship_to ->> 'line', '')) = '' THEN
    RAISE EXCEPTION 'admin_create_manual_order: 收件資料要有收件人 / 電話 / 地址三格,不得留空';
  END IF;
  v_ship_to := pg_catalog.jsonb_build_object(
    'name',  pg_catalog.btrim(p_ship_to ->> 'name'),
    'phone', pg_catalog.btrim(p_ship_to ->> 'phone'),
    'line',  pg_catalog.btrim(p_ship_to ->> 'line'));

  -- ── G5 發票:同樣逐鍵白名單 ────────────────────────────────────────────────
  IF p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) <> 'object'
     OR COALESCE(p_invoice ->> 'type', '') NOT IN ('personal', 'company', 'donate') THEN
    RAISE EXCEPTION 'admin_create_manual_order: 發票類型要是 personal / company / donate 之一';
  END IF;
  -- 🔴 codex R2 `N1`:上一版這裡**沒有 trim** ⇒ 載具打成 `" ABC "` 與 `"ABC"` 會被算成
  --    兩包不同的內容 ⇒ 合法重送被拒。`NULLIF(btrim(…), '')` 讓「只打了空白」與「沒填」歸位到同一個值。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴,那不是漏掉的,是唯一寫得對的寫法。**
  --    本函式其他每一個呼叫都寫成 `pg_catalog.xxx(...)`(因為 `SET search_path = ''`)
  --    ⇒ 照著那個風格會很自然地把這裡寫成 `pg_catalog.nullif(...)` —— **我自己就是這樣寫的。**
  --    而 `NULLIF` / `COALESCE` / `CASE` 是 **SQL 的語法構造,不是 `pg_catalog` 裡的函式**
  --    ⇒ `pg_catalog.nullif(...)` 會在**執行期**炸「function does not exist」。
  --    🔴 **那一發:靜態閘四道 + typecheck + lint + build + 本檔的 apply 斷言 —— 全綠。**
  --       plpgsql 的函式本體到**被呼叫**那一刻才解析名稱 ⇒ 上面每一道對它都是零判別力。
  --    ⚠️ ⇒ 誰要「統一風格」把前綴加回去:**請先跑一次真的呼叫**,不要只看它有沒有 apply 成功。
  v_invoice := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'type',       pg_catalog.btrim(p_invoice ->> 'type'),
    'carrier',    NULLIF(pg_catalog.btrim(p_invoice ->> 'carrier'), ''),
    'title',      NULLIF(pg_catalog.btrim(p_invoice ->> 'title'), ''),
    'taxId',      NULLIF(pg_catalog.btrim(p_invoice ->> 'taxId'), ''),
    'donateCode', NULLIF(pg_catalog.btrim(p_invoice ->> 'donateCode'), '')));

  -- 🔴🔴 **第④代:`p_invoice.requested` = 這張單開不開發票**(`⟦b4-INVOICE5PCT⟧` 第 2 步;
  --    Sean 2026-09-04 第十八題拍甲)。
  --
  --    🛑 **為什麼搭 `p_invoice` 的順風車而不另開參數**:不動簽名 ⇒ 不會多出一個 overload,
  --       呼叫端不必 `DROP + CREATE`。⛔ ~~我原本在 TS 那邊寫「多一個參數必然 PGRST203」~~ ——
  --       **那句是錯的**(codex R1 查 PostgREST 官方打掉);真正的理由只是**不動簽名比較便宜**。
  --
  --    🔴 **`NULL`(這個鍵不在)必須【拒絕】, 不得當成 `true` 或 `false`** ——
  --       第③代以前的呼叫端不送這個鍵, 而它們建的單靠 `orders.invoice_requested` 的
  --       DEFAULT `true` 落地。⇒ 若這裡把 NULL 當 `true`, **舊呼叫端與「員工勾了要開」
  --       會落在同一個值上而分不出來**;若當 `false`, 那是**替他做一個他沒做的決定**。
  --       ⇒ 📌 而本函式**只有一個呼叫端**(後台建單), 而它與本片同一顆 commit 開始送這個鍵
  --       ⇒ **拒絕是安全的, 而且它會【立刻】叫** —— 不是一個要等很久才顯形的洞。
  -- 🔴🔴 **相容期設計:缺這個鍵【不是錯誤】, 而是「照舊」**(codex R3 must-fix #1/#2 改的)。
  --
  --    ⛔ ~~我第一版寫「缺鍵 ⇒ RAISE(必填)」~~ —— **那個設計讓上線這件事沒有安全順序**:
  --      · 先貼 migration、碼還沒部署 ⇒ 舊碼不送這個鍵 ⇒ 🔴 **每一張手動單都建不出來**
  --      · 先部署碼、migration 還沒貼 ⇒ 沒勾的單靜靜落成 `true`
  --      ⇒ 📌 **兩個方向都壞, 只是壞法不同** ⇒ 那不是「順序寫清楚就好」, 是設計本身有問題。
  --
  --    ✅ **改成:缺鍵 ⇒ `true`, 而 `true` 正是 `orders.invoice_requested` 今天的 DEFAULT**
  --      ⇒ 🎯 **兩個部署順序的最壞情況都變成「與今天一模一樣」** ——
  --         先貼 migration ⇒ 舊碼照常建單, 行為零改變;先部署碼 ⇒ 舊函式忽略該鍵, 行為零改變。
  --      ⇒ 那不是把問題往後推, 是**把一個必須協調的上線, 換成一個不必協調的上線**。
  --
  --    ⚠️ **代價寫出來, 不藏**:相容期裡「舊呼叫端沒送」與「員工明確勾了要開」
  --      **在資料上是同一個 `true`, 分不出來**。
  --      ✅ 而它為什麼可接受:本函式**今天只有一個呼叫端**(後台建單 `manual-order-repository.ts`),
  --         而它與本片**同一顆 commit** 開始送這個鍵 ⇒ 分不出來的那段期間 = **部署的那幾分鐘**。
  --      🛑 而**要真的關掉它**, 需要之後另一支 migration 把缺鍵改回 RAISE。
  --         ⇒ 📌 那支**還沒有人排** —— 這是一個**已知未關的缺口**, 不是「做完了」。
  --
  --    🔵 **而「送了但不是 boolean」仍然要叫** —— 那是呼叫端寫錯, 不是舊版本。
  --      實測(PG 17, 2026-09-04):鍵不存在 ⇒ `jsonb_typeof` 回 **SQL NULL**;
  --      鍵是 JSON null ⇒ 回字串 `'null'`。⇒ 兩者要分開處理, 而 `?` 運算子分得出來。
  --      🔵 **六個世界逐一在 PG 17 上量過**(不是推的):
  --         鍵不存在 ⇒ true · 鍵=true ⇒ true · 鍵=false ⇒ **false** ·
  --         鍵=JSON null ⇒ RAISE · 鍵=字串 ⇒ RAISE · 鍵=數字 ⇒ RAISE
  --      ⇒ 📌 中間那個 `false` 是重點:**它證明這道閘不是恆真的** ——
  --         有一個真實的輸入會讓它印出與其他五個不同的東西。
  IF p_invoice ? 'requested'
     AND pg_catalog.jsonb_typeof(p_invoice -> 'requested') <> 'boolean' THEN
    RAISE EXCEPTION 'admin_create_manual_order: p_invoice.requested 送了但不是 true / false'
                    '(收到型別:%)。要嘛送 true / false,要嘛整個不要送(視同 true)。',
                    pg_catalog.jsonb_typeof(p_invoice -> 'requested')
                    USING ERRCODE = 'P0001';
  END IF;
  -- 缺鍵 ⇒ `->>` 回 SQL NULL ⇒ COALESCE 成 `true`(= 今天的 DEFAULT = 行為零改變)。
  v_invoice_requested := COALESCE((p_invoice ->> 'requested')::boolean, true);

  -- ── G6 品項:逐筆驗 + 自算金額(**價錢不信 client 送的合計**) ──────────────
  FOR v_line IN SELECT * FROM pg_catalog.jsonb_array_elements(p_lines) LOOP
    v_sku   := pg_catalog.btrim(COALESCE(v_line ->> 'sku', ''));
    v_title := pg_catalog.btrim(COALESCE(v_line ->> 'title', ''));
    IF v_sku = '' OR v_title = '' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 每個品項都要有料號與品名(收到 sku=[%] title=[%])',
                      v_sku, v_title;
    END IF;
    v_qty := NULLIF(v_line ->> 'qty', '')::integer;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量要是正整數', v_sku;
    END IF;
    -- 🔴 codex R1 `:138`:`qty = 2147483647` 配 `unit_price = 0` ⇒ 金額守門**不會紅**
    --    (0 × 任何數還是 0)⇒ 一張「兩億件、零元」的單會真的建出來。
    IF v_qty > c_max_qty THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的數量 % 超過單筆上限 %;'
                      '真的要這個量 ⇒ 找系統維護(這個上限是保守預設值、未經拍板)',
                      v_sku, v_qty, c_max_qty;
    END IF;
    v_unit_price := NULLIF(v_line ->> 'unit_price', '')::integer;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的單價要是 0 或正整數', v_sku;
    END IF;
    -- 🔴 代購品項:`variant_id` 允許 NULL(`20260604120000:143`)⇒ 網站上沒有的商品也建得起來。
    v_variant_id := NULLIF(v_line ->> 'variant_id', '')::uuid;
    -- 🔵 ⟦b4-SPEC1⟧ 的權威 spec **不在這裡取** —— 見下方 G8 的 INSERT。
    --    🔴 **本檔第一版取在這裡, 而 codex R1 must-fix 1 打穿它**:
    --       這裡在 G6.5 冪等比對【之前】⇒ `v_items` 進指紋 ⇒ 指紋會跟著
    --       `product_variants.spec` 這個**可變的外部狀態**跑。
    --       ⇒ 首次成功之後那個變體的 spec 被改過 ⇒ **同鍵同內容的合法重送算出不同指紋**
    --          ⇒ 被判成「同鍵不同內容」而拒絕;變體被刪掉 ⇒ 直接 RAISE, **連既有那張單都回不了**。
    --    📌 而本函式檔頭 `:207` 自己寫著「重送同一包輸入時 G3-G6 全部是**決定性**的」——
    --       **我那一版把那句話變成假的, 而三綠 / 四個世界 / 四發突變全部沒有紅。**
    --    ⇒ ✅ 分成兩個問題:**指紋回答「這是不是同一個請求」(看呼叫端送什麼);
    --       快照回答「真相是什麼」(看權威)。** 兩者不該共用同一份值。
    -- 🔴 `spec` 只收物件,而且**每個值都必須是字串**(表上 CHECK 會擋,這裡先講清楚)。
    v_spec := COALESCE(v_line -> 'spec', '{}'::jsonb);
    IF pg_catalog.jsonb_typeof(v_spec) <> 'object' THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格要是物件', v_sku;
    END IF;
    -- 🔴🔴 codex R1 `:203`:舊版**只驗到這裡為止**,底下三句話是靠
    --    `order_items_snapshot_whitelist` 這道表上的 CHECK 幫我擋的。
    --    ⇒ 那是**別人家的守門**:正式庫若缺它或它漂移了,**本檔的 apply 斷言不會紅**,
    --      而經銷價 / cost 會直接寫進快照裡。⇒ **自己驗一遍**(判準逐字對齊 `20260604120000:157-165`)。
    --    ⚠️ 這不是重複勞動:表上那道是**縱深**,這一道是**訊息** —— CHECK 紅的時候
    --       員工看到的是一串約束名,這裡紅的時候他看得到是哪一個品項的哪一種問題。
    IF NOT public.m3_jsonb_values_all_string(v_spec) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格裡有不是字串的值(數字 / 巢狀物件 / 陣列);'
                      '規格只收「字串對字串」,那是為了擋價格欄藏在巢狀值裡', v_sku;
    END IF;
    IF v_spec ?| ARRAY['price_store', 'price_by_tier', 'cost'] THEN
      RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的規格出現價格欄名(price_store / price_by_tier / cost);'
                      '訂單快照**絕不放經銷價與成本**', v_sku;
    END IF;
    -- 🔴 codex R2 `N1`:規格的鍵與值也要 trim —— 它們**進指紋**,而空白差異會讓合法重送被拒。
    --    ⚠️ 順序有意義:**先驗全值皆字串**(上面那道)**才能** `jsonb_each_text`,
    --       否則數字會被靜靜轉成字串、把該紅的那一發變綠。
    v_spec := COALESCE((SELECT pg_catalog.jsonb_object_agg(pg_catalog.btrim(k), pg_catalog.btrim(val))
                          FROM pg_catalog.jsonb_each_text(v_spec) AS t(k, val)), '{}'::jsonb);

    -- 🔴🔴 codex R1 `:186`:舊版**沒有任何跨列比對** ⇒ 員工手滑送兩列同一個變體,
    --    兩列各自計價 ⇒ `subtotal` / `total` **與退款分母**直接加倍。
    --    既有 `create_order` 明文要求同變體合併數量(`20260730120100:323` 逐字:「同變體應合併 qty」)。
    --    ⚠️ **代購品項(`variant_id` 是 NULL)怎麼去重**:它沒有變體可比 ⇒ 退而用 `料號 + 品名` 當鍵。
    --       兩列**料號與品名都一樣**幾乎只會是重送;真的是兩個不同東西 ⇒ 品名寫得出差別。
    -- 🔴🔴 codex R2 `N3`:上一版的代購鍵**只有 sku + 品名** ⇒ 兩個病一起犯:
    --    ① **太窄**:同料號同品名、但**規格或單價不同**的兩個代購品 ⇒ 被錯誤拒絕。
    --       ⚠️ 這一格的後果是**擋到合法的**(這裡是拒絕、不是合併)
    --       ⇒ 修的方向必須是**讓鍵更寬**,不是更嚴。
    --    ② **太鬆**:把品名中間的空白改一下 ⇒ 換一把鑰匙 ⇒ 真正的重複列繞過去。
    --    ⇒ 兩個方向一起修:**加進規格與單價**(變寬)+ **內部連續空白壓成一個**(變嚴)。
    v_key := COALESCE('variant:' || v_variant_id::text,
                      'custom:' || pg_catalog.lower(pg_catalog.regexp_replace(v_sku,   '\s+', ' ', 'g'))
                        || '|' || pg_catalog.lower(pg_catalog.regexp_replace(v_title, '\s+', ' ', 'g'))
                        || '|' || v_unit_price::text
                        -- 🔴 **含稅原值也要進這把鑰匙**(codex R1 must-fix 四)。
                        --    出事世界:兩列代購同料號同品名同規格, 含稅 31 與 32
                        --    ⇒ 兩者換算後都是未稅 30 ⇒ 舊鑰匙一模一樣 ⇒ 第二列被當重複拒掉,
                        --    而它們是【兩個不同的應收金額】。合併數量也救不了(31 或 32 都不對)。
                        --    ⇒ 📌 這把鑰匙的方向本來就是「變寬」, 而這一格正是同一個方向。
                        || '|' || COALESCE(NULLIF(v_line ->> 'unit_price_taxed', ''), '-')
                        || '|' || v_spec::text);
    IF v_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'admin_create_manual_order: 重複品項 [%];同一個東西請**合併數量**寫成一列,'
                      '不要送兩列 —— 送兩列會讓總額與**可退金額**都變成兩倍', v_sku;
    END IF;
    v_seen := v_seen || v_key;

    v_line_total := v_unit_price::bigint * v_qty::bigint;
    v_subtotal := v_subtotal + v_line_total;
    -- 🔴🔴 ⟦b4-INVOICE5PCT⟧二:這一列是不是【員工打含稅價】那一種。
    --    🛑 **缺鍵 = 舊版表單** ⇒ 當作「沒有含稅原值」, **不 RAISE**(先貼 migration 再上碼)。
    v_line_taxed := NULL;
    IF v_line ? 'unit_price_taxed' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'unit_price_taxed') <> 'number' THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_create_manual_order: 品項 [' || v_sku || '] 的 unit_price_taxed 不是數字';
      END IF;
      v_line_taxed := (v_line ->> 'unit_price_taxed')::integer;
      IF v_line_taxed IS NULL OR v_line_taxed < 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'admin_create_manual_order: 品項 [' || v_sku || '] 的 unit_price_taxed 要是 0 或正整數';
      END IF;
    END IF;
    -- 🔴🔴 **換算比對【只在勾了發票時】做**(codex R1 must-fix 二)。
    --    ⛔ ~~無條件比對~~ ⇒ 出事世界:沒勾發票而呼叫端保留原值(送 unit_price=1050 · taxed=1050)
    --      ⇒ 無條件比對會要求未稅是 1000 ⇒ **直接拒單**;而呼叫端為了過關改送 1000
    --      ⇒ 後面又不加稅 ⇒ 📌 **少收 50。**
    --    ⇒ ✅ 沒勾那條路 = 他打的數字即總額 ⇒ 這裡【什麼都不做】, 與檔頭那句「沒勾一個字不動」一致。
    IF v_invoice_requested AND v_line_taxed IS NOT NULL THEN
      -- 🔴 **這一格是「不信 client 送的數」那條線**:本函式自己再算一次並比對, 不合就拒。
      IF v_unit_price <> pg_catalog.round((v_line_taxed::numeric) * 20 / 21)::integer THEN
        RAISE EXCEPTION USING MESSAGE = '品項 [' || v_sku || '] 的含稅 ' || v_line_taxed::text || ' 換算回未稅應為 ' || pg_catalog.round((v_line_taxed::numeric) * 20 / 21)::integer::text || ', 而送來的是 ' || v_unit_price::text;
      END IF;
      -- 🎯 殘差【跟著這一列走、乘以數量】⇒ 員工打的那個含稅數乘以數量剛好回得來。
      v_taxed_residual := v_taxed_residual + (v_line_taxed - v_unit_price)::bigint * v_qty::bigint;
    ELSE
      -- 🔵 未稅那些列(與沒勾發票的每一列)才進【正推】的稅基。
      v_untaxed_base := v_untaxed_base + v_line_total;
    END IF;
    v_items := v_items || pg_catalog.jsonb_build_object(
      'variant_id', v_variant_id,
      'variant_sku', v_sku,
      -- 🔴 exact-key 白名單:title / sku / spec 三鍵,**不得把員工輸入原樣塞進去**
      --    (`order_items_snapshot_whitelist`:多一鍵整筆回滾)。
      'product_snapshot', pg_catalog.jsonb_build_object('title', v_title, 'sku', v_sku, 'spec', v_spec),
      'quantity', v_qty,
      'unit_price', v_unit_price,
      -- 🔴🔴 **含稅原值要進 `v_items`**(codex R1 must-fix 一)——
      --    因為【冪等指紋是從 v_items 算的】。出事世界:同一顆 manual_request_id,
      --    第一次送含稅 31(未稅 30)、第二次送含稅 32(未稅仍 30)⇒ 舊指紋一模一樣
      --    ⇒ 📌 **第二次直接回第一張 31 元的單, 而他要建的是 32 元那張。**
      --    🔵 它【不進 product_snapshot】—— 那裡有 exact-key 白名單(多一鍵整筆回滾)。
      --    🔵 而下游 INSERT 是【逐鍵取值】的, 多一個鍵不會被寫進 order_items。
      'unit_price_taxed', v_line_taxed,
      'line_total', v_line_total);

    -- ══ 第 7 代:把這一列的稅基收起來, 等一下寫進 audit ═══════════════════════
    -- 🔵 **缺鍵 ⇒ NULL, 不是報錯** —— 部署順序是「先貼 migration、再上碼」
    --    ⇒ 中間那段窗口裡, **舊版表單不會送這個鍵**。報錯的話那段窗口所有手動單都建不出來。
    --    ⇒ 📌 而 NULL 在 audit 裡是誠實的:它的意思是「這一筆沒有人告訴我」。
    -- 🛑 **已知未關的缺口**:窗口過後「舊呼叫端沒送」與「真的缺」仍然都是 NULL, 分不出來。
    --    要關掉需要**之後另一支 migration** 把缺鍵改成 RAISE ⇒ 那支還沒有人排, 所以寫在這裡。
    -- 🔴 **第三種值一律拒** —— 同本函式對 order_source / payment_channel 的做法:
    --    「看不懂就當未稅」會讓一個壞掉的表單靜默送出一個**沒有人宣告過**的稅基。
    -- 🔴🔴 **「缺鍵」與「送了一個空的」要分得開**(codex R4 2026-09-09 must-fix ④, 它對)。
    --    ⛔ ~~`v_line_basis := NULLIF(v_line ->> 'tax_basis', '');`~~ —— 那一版有兩條路悄悄變成 NULL:
    --      `{"tax_basis": ""}` 被 `NULLIF` 轉成 NULL · `{"tax_basis": null}` 經 `->>` 也是 NULL
    --      ⇒ 📌 **兩者都跳過下面那道 RAISE, 留下與「舊版沒送鍵」一模一樣的紀錄。**
    --      而它們的意思完全不同:一個是「那個版本還沒有這一格」, 另一個是**表單壞了**。
    --    ✅ 改成先用 `?` 問【鍵在不在】, 只有**缺鍵**才准是 NULL。
    --    🔵 `?` 是 jsonb 的存在運算子;運算子住在 `pg_catalog`, 而 `pg_catalog` 永遠隱含可見
    --      ⇒ `SET search_path = ''` 之下照樣解析得到(與本函式其他 `->>` / `||` 同理)。
    IF v_line ? 'tax_basis' THEN
      IF pg_catalog.jsonb_typeof(v_line -> 'tax_basis') <> 'string'
         OR (v_line ->> 'tax_basis') NOT IN ('untaxed', 'taxed') THEN
        RAISE EXCEPTION 'admin_create_manual_order: 品項 [%] 的稅基 [%] 不是 untaxed / taxed',
                        v_sku, COALESCE(v_line ->> 'tax_basis', '<null>');
      END IF;
      v_line_basis := v_line ->> 'tax_basis';
    ELSE
      -- 🔵 **只有這一條路允許 NULL** —— 部署順序是「先貼 migration、再上碼」,
      --    中間那段窗口舊版表單不送這個鍵。報錯的話那段窗口所有手動單都建不出來。
      v_line_basis := NULL;
    END IF;
    -- 🔵 **`unit_price` 一起記** —— 它是【送進來的那個值】(表單那一側已經換算過了)。
    --    配上這一列的 `tax_basis` 與這張單的 `invoice_requested`, 三個湊起來就答得出
    --    「他當初打的是哪個數字、當成什麼」:
    --      勾了 + taxed ⇒ 他打的是 unit_price × 21/20   ·   沒勾 ⇒ 他打的就是 unit_price
    -- ✅ **這一列的 id 在這裡就決定**, 下面的 INSERT 明確寫它, 稽核記同一個。
    --    ⇒ 📌 **稽核那一列與 `order_items` 那一列從此靠【同一個 uuid】綁著, 不靠任何會變的值。**
    --    🔵 只記三樣:id + 稅基 + **建單當下**的單價。單價記的是「那一刻是多少」——
    --      它日後可能被 `admin_update_order_item_amount` 改掉, 而**那正是要留一份原值的理由**。
    --    🛑 **不記品名 / 規格 / 料號** —— 那些是自由文字, 抄進 append-only 的表就是多一份
    --      會過期、會外洩的副本(本函式 G9 那段逐字)。要看它們 ⇒ 拿 id 去 `order_items` 查。
    v_item_id := pg_catalog.gen_random_uuid();
    v_item_ids := v_item_ids || pg_catalog.to_jsonb(v_item_id);
    v_line_bases := v_line_bases || pg_catalog.jsonb_build_object(
      'order_item_id', v_item_id,
      'tax_basis',     v_line_basis,
      'unit_price',    v_unit_price,
      -- 🔴🔴 **原始含稅價要留下來**(codex R1 must-fix 三)。
      --    出事世界:A/B 兩列含稅 31/32 與 32/31, 兩種輸入在庫裡【長得一模一樣】
      --    (單價 30/30 · 小計 60 · 稅 3 · 總 63)⇒ 事後分不出哪一列原本收多少。
      --    而 `30 × 21/20 = 31.5` **還原不回去** ⇒ 📌 那是資料遺失, 不是推得出來的東西。
      'unit_price_taxed', v_line_taxed);
  END LOOP;

  -- ══ 第 6 代:稅在這裡算(Sean 2026-09-05 拍甲)═══════════════════════════════
  -- 🔴 **稅基 = 小計 + 運費 − 折扣**。而 `discount_total` 在本函式**寫死成 0**(見下面 INSERT)
  --    ⇒ 折扣那一項今天**恆為 0**, 而算式仍然把它寫出來:它天生正確, 且折扣功能上線那天不必再改一次。
  --    ⚠️ **而那也代表「折扣在稅前」這條規則今天走不到任何一條路** ⇒ 它未被任何測試涵蓋。
  -- 🔴 **先轉 `numeric` 再 `ROUND`** —— `numeric` 的 `ROUND` 對 `.5` 是**遠離零**(四捨五入),
  --    而 `double precision` 是銀行家捨入(進偶數)。營業稅尾數依財政部法規是四捨五入
  --    ⇒ 📌 **型別決定了合不合法, 那不是風格。**
  IF (v_subtotal + p_shipping_fee - 0) < 0 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稅基是負的(小計 % + 運費 % − 折扣 0)⇒ 拒絕建單。'
                    '請檢查品項金額與運費。', v_subtotal, p_shipping_fee;
  END IF;
  -- ══ 第 7 代:**稅只有在「這張單要開發票」時才加**(⟦b4-INVOICE5PCT⟧)══════════
  -- 🔴 **Sean 2026-09-04 16:2x 逐字**(`~/pcm-mailbox/Sean拍板-20260904-七題.md:363`):
  --    「我們傾向於我輸入單價，然後勾選開發票自己幫我+5 %上去，
  --      **那如果我沒有勾選開發票價錢都不加**」
  --    ⇒ 同一份檔 `:367-369` 已整理成規格:勾了 ⇒ +5%;**沒勾 ⇒ 價錢都不加**。
  -- 🛑 **第 6 代的 `v_tax :=` 是無條件的** ⇒ 沒勾也加了 5%, 而那顆勾選**預設不勾**
  --    (`manual-order-form-body.tsx:234` 逐字「預設不勾選,也就是預設不開發票」)
  --    ⇒ 📌 **不加稅才是常態路徑, 而它一直在加。** 本段就是那一格。
  -- 🔴 **沒勾那一邊為什麼是 `inclusive` 而不是 `exclusive` + 稅 0**:
  --    Sean 同段逐字「**沒勾就是他打的數字即總額**」⇒ 那張單沒有另計的稅
  --    ⇒ `inclusive` 正是 `orders.price_tax_mode` 的 DEFAULT、也是第 6 代之前每一張單的語意
  --    ⇒ 🎯 **沒勾那條路 = 回到第 6 代之前的行為, 一個位元都沒有多。**
  --    🛑 **而寫成 `exclusive` + 稅 0 會有一個看不見的副作用**:
  --       `admin_update_order_item_amount` 的 `pcm_e13_no_edit_when_taxed`(本檔下游, 未改)
  --       判準逐字是 `price_tax_mode = 'exclusive' OR tax_total <> 0`
  --       ⇒ 一張**沒有稅**的單會被擋著不給改金額, 而員工看到的是一句在講稅的錯誤訊息。
  -- ⚠️ **這一格是【判斷】不是拍板** —— Sean 說的是「價錢都不加」, 沒有說欄位填什麼。
  --    理由寫在上面兩點, 而 `⟦b4-INVOICE5PCT⟧` 那一列要記著它可翻。
  -- 🔵 **負稅基閘與溢位閘刻意留在 IF 外面** —— 它們是這張單的不變式, 不是稅的附屬品;
  --    沒勾那一邊 `v_tax = 0`, 兩道閘照樣成立而且零成本。
  IF v_invoice_requested THEN
    -- 🔴🔴 ⟦b4-INVOICE5PCT⟧二:【混單】要分開算。整包正推會讓員工打的含稅數字回不來
    --    (實測:未稅列 1 + 含稅列 31 ⇒ 總額 33 而不是 32;掃 600x600 分岔約 26 趴)。
    --    ✅ 未稅那些列(與運費)照舊【正推】;含稅那些列的稅用【減的】(殘差)。
    --    ⚠️ **運費永遠進正推那一邊** —— 本函式收不到運費的稅基(見本片 migration 檔頭)。
    v_tax := pg_catalog.round(((v_untaxed_base + p_shipping_fee - 0)::numeric) * 0.05)::bigint
             + v_taxed_residual;
    v_price_tax_mode := 'exclusive';
  ELSE
    v_tax := 0;
    v_price_tax_mode := 'inclusive';
  END IF;
  v_total := v_subtotal + p_shipping_fee + v_tax;
  -- 🔴 **溢位那道連 `v_tax` 一起看** —— 照 `20260604130000:229` 同一種寫法, 不自創第二種。
  IF v_total > 2147483647 OR v_subtotal > 2147483647 OR v_tax > 2147483647 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 金額超出 integer 上限;這張單請拆開建';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════════

  -- ── G6.5 冪等格(codex R1 `:143`;形狀照退款 RPC `20260820021000:245-270`)─────
  -- 🔴🔴 **這一段的上一版是一句假話,而它讀起來像一句保證**(codex R2 `N1` 抓到):
  --    ~~「多打一個空白、鍵的順序不同、發票欄位給了 NULL,都不會被誤判成不同內容」~~
  --    R1 當下的實情是:**發票與規格根本沒有 trim,品項也照原順序進指紋**
  --    ⇒ 那三件事**每一件都會**讓合法重送被拒。
  --    ⚠️ 這句話的危害不只是錯:**它會讓下一個人不去測那三件事** —— 我自己就沒測。
  --    ⇒ R2 把碼補齊之後,下面這句話**現在才成立**,而它成立是因為有三件事真的做了:
  --      ① 收件 / 發票 / 規格的鍵與值**全部 btrim**(空白只打了空白 ⇒ 等於沒填)
  --      ② 品項**排序後**才進指紋(順序不再影響指紋)
  --      ③ `jsonb` 本身把鍵排序、重複鍵消掉(這一件是 PG 給的,不是我做的)
  --    ⇒ 多打一個空白、品項換順序、鍵的順序不同、發票欄位給了 NULL,**都不會**被誤判成「不同內容」。
  --    📌 三件事各有一格負測釘著(`docs/probes/2026-08-24-858-manual-order-rpc-r2-negatives.sql` 的 R2-1b/1c/1e),不是只有這段話。
  -- ⚠️ **上限(誠實揭示)**:比的是**指紋**,所以只答得出「一樣 / 不一樣」,
  --    答不出**哪一欄**不一樣 —— 退款 RPC 那支比得出來,因為它比的是欄位。
  --    這裡的輸入是一整包(含品項陣列),逐欄比會隨著欄位增加而**靜靜漏掉新欄**;
  --    指紋不會漏,代價就是訊息比較鈍。**這是選擇,不是疏忽。**
  -- ⚠️ 另一格上限:`jsonb::text` 的輸出在**同一個 PG 大版本內**是決定性的(鍵已排序、
  --    重複鍵已消)。跨大版本若渲染改變 ⇒ 舊指紋對不上 ⇒ 會被判成「內容不同」而**拒絕**
  --    ⇒ 方向是 fail-closed(擋下來、不是放行)。
  -- 🔴 **`p_actor` 刻意【不進指紋】** —— 這是與 `20260820021000` 的**有意分歧**,不是漏掉:
  --    那支把 actor 放進逐欄比對,結果它必須為此寫一整段訊息教人怎麼辦
  --    (`:262-264` 逐字:「若你是在重送同一筆(**例如原經手人已停用而你換了人**)
  --     ⇒ 不要用新的 request_id」)。
  --    ⇒ 指紋要回答的問題是「**這是不是同一張單**」,而**誰按下送出不會改變那張單**。
  --      同事幫忙重送同一包內容 ⇒ 應該拿到 idempotent,不該被判成「內容不同」。
  --    ⇒ 「**誰建的**」由 `admin_audit_log` 那一列回答,那才是它該住的地方。
  --    ⚠️ **代價講明(2026-08-24 擴寫:我原本只寫了併發那一半,而它比那寬)**:
  --       **任何重送**,audit 都只會有**最初建單那一位**。
  --       · 併發:後到那發拿 `P858A`、不落 audit(它什麼都沒建)。
  --       · **非併發**:A 建單、B 一小時後拿同一顆 id 重送 ⇒ 回 `idempotent` ⇒ **B 這次操作零紀錄**。
  --    🔴 而**後者正是本設計自己舉的主要使用情境**(「原經手人已停用而你換了人」)
  --       ⇒ 它是**常態,不是邊角**。~~原本寫「併發時」~~ 那個限定把常態寫成了例外。
  --    ✅ 而這**不是缺陷**:B 沒有建單。`admin_audit_log` 記的是「**建單**」事件,不是「**請求**」事件
  --       ⇒ 不記 B 是**一致的**。⚠️ 但「誰碰過這張單」這條線索**確實不在系統裡** —— 要就得另立事件。
  -- 🔴🔴 **正規化要在指紋【之前】** —— 否則 `'a@b.c'` 與 `' a@b.c '` 會算出兩個指紋,
  --    而它們是**同一個請求** ⇒ 合法重送被判成「同鍵不同內容」而被拒。
  --    📌 這與同檔 `:420` 對規格鍵值做 trim 的理由**逐字是同一條**(codex R2 `N1`)。
  -- 🔴🔴 **`NULLIF` 不加 `pg_catalog.` 前綴 —— 它是【SQL 語法構造】, 不是函式。**
  --    ⚠️ **本檔 `:245-247` 逐字警告過這一格, 而我照樣寫成了 `pg_catalog.nullif(...)`**
  --       ⇒ code-reviewer 2026-09-05 抓到(must-fix 1)。它會在**執行期**炸
  --         `function pg_catalog.nullif(text, unknown) does not exist` —— 而 **apply 全綠**。
  --    📌 **一段寫在同一支檔裡、講得完全正確的警告, 沒有阻止寫它的那個人再犯一次。**
  --       ⇒ 擋住它的不是那段字, 是一發【真的呼叫】(§7b)。
  -- 🔵 `btrim` 的字元集對齊同檔 `p_actor`(`:163`/`:168`)—— 只剝空格會讓
  --    貼上時帶進來的尾端換行留著, 而 CHECK 的 `~ '^[!-~]+$'` 不成立 ⇒ 整張單被擋、
  --    訊息只有約束名。fail-closed, 而那不是我們要給員工看的訊息。(nit 3)
  v_notification_email := NULLIF(pg_catalog.btrim(p_notification_email, E' \t\r\n'), '');

  v_canonical := pg_catalog.jsonb_build_object(
    'customer_user_id', p_customer_user_id,
    'order_source',     p_order_source,
    'payment_channel',  p_payment_channel,
    'shipping_method',  p_shipping_method,
    'shipping_fee',     p_shipping_fee,
    'ship_to',          v_ship_to,
    'invoice',          v_invoice,
    -- 🔴 第④代:**開不開發票要進指紋** —— 少了它, 「只改了這一格再送一次」會被
    --    判成「內容相同」⇒ 回上一張單 ⇒ **員工以為改掉了而其實沒有**。
    -- ⚠️ **代價寫出來**:指紋多一個鍵 ⇒ apply 之後算出來的 sha 與 apply 之前**不同**。
    --    ⛔ ~~我原本寫「窗口 = 貼這支的那幾秒」~~ —— **那句話寫窄了**(codex R2 must-fix):
    --    🔴 **apply 之前建立的每一顆 `manual_request_id`, 它的 sha 是用【舊指紋】算的,
    --       而那個值已經落表、永遠不會重算** ⇒ 那些單**在任何時候**被原樣重送, 都會算出新 sha
    --       ⇒ 判成 `P858B`(內容不同)。⇒ **不是幾秒, 是【所有舊單, 永久】。**
    --    ✅ **而它為什麼仍可接受**:重送只發生在「員工按了送出而沒看到結果」那一刻的補救,
    --       而那是**當下**的動作 —— 沒有人會去重送一張三天前的單。⇒ 影響面 = apply 那一刻
    --       正在飛的請求, 而 Sean 手動在安靜時段貼。
    --    🛑 **但那是一個【業務面的判斷】, 不是資料面的保證** —— 真的撞到 `P858B` 的人看到的
    --       是「內容不同」而他明明沒改東西 ⇒ 📌 那句錯誤訊息在這個情境下會誤導他。已知, 未修。
    'invoice_requested', v_invoice_requested,
    'notification_email', v_notification_email,
    -- 🔴🔴 codex R2 `N1`:上一版直接把 `v_items` **照員工送來的順序**丟進指紋
    --    ⇒ 同樣的品項換個順序 ⇒ 指紋不同 ⇒ **合法重放被判成「內容不同」而拒絕**。
    --    ⇒ 排序後再算。排序鍵用 `x::text`:jsonb 轉文字時鍵已排序、重複鍵已消
    --      ⇒ 同一個 jsonb 值恆得同一個字串 ⇒ 是個穩定的鍵。
    --    ⚠️ **只有指紋排序,落表的 `order_items` 仍照員工原順序** —— 那是他要看的順序。
    'items',            (SELECT COALESCE(pg_catalog.jsonb_agg(x ORDER BY x::text), '[]'::jsonb)
                           FROM pg_catalog.jsonb_array_elements(v_items) AS x));
  v_payload_sha := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_canonical::text, 'UTF8')), 'hex');

  SELECT o.id, o.display_id, o.manual_request_payload_sha256 INTO v_existing
    FROM public.orders o
   WHERE o.manual_request_id = p_manual_request_id;
  IF FOUND THEN
    IF v_existing.manual_request_payload_sha256 IS NOT DISTINCT FROM v_payload_sha THEN
      -- 同一顆鍵、同一包內容 ⇒ 這就是重送。回既有那張單。
      RETURN pg_catalog.jsonb_build_object(
        'order_id', v_existing.id, 'display_id', v_existing.display_id, 'idempotent', true);
    END IF;
    -- 🔴 同鍵不同內容 ⇒ **拒絕**(合約逐字對齊 `20260820021000:257`)
    -- 🔴 codex R2 `N2` 連帶:這一條與上面那條的**下一步完全相反**
    --    (那條要「原樣重送」,這條是「**不准重送**」)⇒ 呼叫端必須分得出來
    --    ⇒ 兩條都給代碼,不能只給一條。
    RAISE EXCEPTION 'admin_create_manual_order: 這個建單請求的編號已經用過了,而**內容不一樣** ⇒ 拒絕。'
                    '🔴 **呼叫端合約**:SQLSTATE P858B / constraint pcm_858_manual_order_payload_mismatch ⇒ '
                    '**不要重送**(重送幾次都會是同一個答案)。'
                    '🔴 這不是「重複建單」的警告 —— 系統裡那張單(%)與你這次送來的至少有一處不同'
                    '(客人 / 品項 / 數量 / 單價 / 運費 / 收件資料 / 發票 / 來源 / 付款方式)。'
                    '⚠️ **先確認你要的是哪一件事**:'
                    '① 要**改**那張既有的單 ⇒ 去那張單上改,不要用建單重送(這裡不會幫你覆蓋它);'
                    '② 這是**另一張**單 ⇒ 請重新開一張建單表單(它會產一顆新編號),'
                    '   不要把舊表單改一改再送 —— 那顆編號綁的是**上一次那包內容**。',
                    v_existing.display_id
                    USING ERRCODE = 'P858B',
                          CONSTRAINT = 'pcm_858_manual_order_payload_mismatch';
  END IF;

  -- ── G7 建單(display_id 有界重試;形狀照 create_order `:432-463`) ───────────
  v_order_id := NULL;
  FOR v_attempt IN 1 .. 5 LOOP
    BEGIN
      v_display_id := public.pcm_generate_display_id();
      INSERT INTO public.orders (
        display_id, customer_user_id, address_id, shipping_address_snapshot, tier_at_checkout,
        subtotal, shipping_fee, discount_total, total, shipping_method, invoice,
        invoice_requested,
        -- 🔴 **`tax_total` 顯式寫 0(片 B2丙, 2026-08-29)** —— 不是「忘了寫所以走 DEFAULT」。
        --
        -- 🔴🔴 **而這個 0 是一個【假設】, 不是一個保證。codex 2026-08-29 must-fix, 它是對的。**
        --    ~~我原本寫「為什麼 0 是對的:單價來自 `price_general`, 而它含稅」~~ **那句話太寬**:
        --    **那是【今天唯一那個呼叫端】的性質, 不是【本函式的契約】。**
        --    本函式**直接收** `p_lines.unit_price`, 而它:
        --      · **不查也不驗** `price_general`
        --      · 代購品項(`variant_id` 是 NULL)的單價是**員工自己打的**
        --      · `p_shipping_fee` 同樣沒有任何「已含稅」的保證
        --      · 其他 service_role 呼叫端可以送任意合法非負單價
        --    ⇒ **有人送未稅價進來時, `tax_total = 0` 會少收稅。**
        --
        --    **⇒ 所以這一行的正確講法是**:
        --      「**假設**送進來的每一筆單價與運費都是【含稅】的 ⇒ 稅已內含在 `total` 裡 ⇒ `tax_total = 0`。
        --        而**本函式不強制那個假設**。」
        --    ✅ **今天那個假設成立**, 因為唯一的呼叫端是後台建單, 而它的目錄
        --       **只讀 `price_general`**(`apps/admin/src/lib/orders/manual-order-catalog.ts:84` 欄位表逐字),
        --       而 `price_general` 是含稅的(Sean 2026-08-29 逐字:
        --       「網站售價都含稅沒問題, 但是經銷價都是未稅。」)
        --    ⚠️ **而代購品項那一格【今天就已經沒有保證】** —— 它的單價是人打的。
        --       本片**沒有**擋它, 也沒有替它算稅 ⇒ **那是一個已知缺口, 寫在這裡而不是被靜靜帶過。**
        --
        -- 🔴 **⇒ 契約落地之前, 不得無條件宣稱這個 0 是對的。**
        --    要讓它變成保證, 需要下面「下一片」清單裡的第 1、2 項(價格基礎欄位 + 參數)。
        --    🔴 **而【那一天】要改這裡**:後台建單那顆兩段切換([定價][經銷])一旦做出來,
        --       經銷價(**未稅**)就會第一次變成訂單金額
        --       ⇒ 那一刻本行要開始**真的算稅**
        --       (進位依據:營業稅法 §14 第一項「尾數不滿通用貨幣一元者, 按四捨五入計算」)
        --    ⚠️ **而【不要】把它讀成 `ROUND(未稅小計 × 0.05)` 就好**(codex 2026-08-29 consider):
        --       那個式子**沒有處理**:應稅運費(營業稅法 §16:價額外收取的一切費用都進銷售額)、
        --       折扣怎麼分攤、代購品項的稅制、免稅品項。
        --       ⇒ **真正的算式要等【價格基礎與稅基契約】落地之後才寫得出來**
        --       ⇒ **這段註解不是規格。**
        --    ⚠️ **而本函式今天沒有任何參數說得出「這張是定價單還是經銷單」** ——
        --       那顆切換要加參數 ⇒ 而 `CREATE OR REPLACE` 加不了參數 ⇒ 要 `DROP + CREATE`。
        tax_total,
        order_source, payment_channel, manual_request_id, manual_request_payload_sha256,
        notification_email,
        -- 🔴 **第 6 代新增**:這張單的單價是【未稅】的 ⇒ 顯式寫 'exclusive'。
        --    🛑 **不可以靠 DEFAULT** —— DEFAULT 是 'inclusive'(顧客站與所有既有單),
        --       走 DEFAULT 等於讓這張單**自稱含稅**, 而它的 `subtotal` 是未稅的。
        price_tax_mode
      ) VALUES (
        v_display_id, p_customer_user_id, NULL, v_ship_to, v_tier,
        v_subtotal::integer, p_shipping_fee, 0, v_total::integer, p_shipping_method, v_invoice,
        v_invoice_requested,  -- 🔴 顯式寫入,**不是走 DEFAULT** —— 走 DEFAULT 就等於忽略員工那一勾。
        v_tax::integer,  -- 🔴 **第 6 代:這裡不再是 0** —— ⛔ ~~顯式的 0,不是預設的 0~~
                         --    舊字面留刪除線:搜「顯式的 0」的人要同一發撞到這裡。
        -- 🔴 這兩欄顯式寫。不寫的後果見檔頭 §2。
        p_order_source, p_payment_channel, p_manual_request_id, v_payload_sha,
        v_notification_email,
        v_price_tax_mode
      )
      RETURNING id INTO v_order_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      -- 🔴🔴 codex R1 `:248`:**這條路不得回 `idempotent: true`。**
      --    舊版在這裡直接把既有那張單回出去 —— 而**它從來沒有比對過對方寫了什麼**
      --    ⇒ 上面 G6.5 那道逐內容比對,在「兩發並行」這條路上等於不存在。
      --    ⇒ 處置逐字沿用退款 RPC 對同一條路的定位(`20260820021000:311-316`):
      --      **拒絕本次、請呼叫端重試一次** —— 重試時 G6.5 就看得到那一列,也就會比對內容。
      --    ⚠️ 走到這裡只有一種情況:兩發並行、兩發都在 G6.5 查無、其中一發先寫進去。
      IF v_cname = 'orders_manual_request_id_uniq' THEN
        -- 🔴🔴 codex R2 `N2`:**上一版這裡是一顆沒有代碼的 RAISE,而它對呼叫端說「請重送」。**
        --    那句話有一個致命前提:**重送的人要用同一顆 request id。**
        --    而**今天 repo 裡沒有任何呼叫端實作那件事** ⇒ 前端最可能的行為是
        --    「這次失敗了 ⇒ 開新表單 ⇒ 產一顆新 id ⇒ 再送」
        --    ⇒ 🔴 **第一張單其實已經建好了,於是變成兩張真訂單、要出兩次貨。**
        --    ⇒ 病灶不是訊息寫得不夠清楚:**是我把一個決定交給了一個還沒被寫出來的呼叫端**,
        --      而它的預設行為剛好是錯的那一邊。
        --    ⇒ 修法=給它**機器讀得懂的把手**(SQLSTATE + CONSTRAINT token,體例照 repo 既有
        --      `P2B02` 那族),而不是只給人看的字。
        RAISE EXCEPTION 'admin_create_manual_order: 同一個建單請求正在被並行送出 ⇒ 拒絕本次。'
                        '🔴 **呼叫端合約(這一句是給程式看的,不是給人看的)**:'
                        '收到 SQLSTATE P858A / constraint pcm_858_manual_order_concurrent_request ⇒ '
                        '**保留同一顆 manual_request_id 原樣重送**,'
                        '⚠️ **絕對不要產生新的 manual_request_id** —— '
                        '這一刻另一發很可能已經成功建好那張單了,換新 id 會建出【第二張真訂單】。'
                        '重送時會走內容比對:內容相同 ⇒ 回那張已建好的單(idempotent:true);'
                        '內容不同 ⇒ 回 P858B。'
                        USING ERRCODE = 'P858A',
                              CONSTRAINT = 'pcm_858_manual_order_concurrent_request';
      END IF;
      -- 🔴 只吞 display_id 的碰撞;其他 unique violation 原樣上拋(重試會把語意訊號吃掉)。
      IF v_cname IS DISTINCT FROM 'orders_display_id_key' THEN
        RAISE;
      END IF;
      v_order_id := NULL;
      IF v_attempt = 5 THEN
        RAISE EXCEPTION 'admin_create_manual_order: display_id 連續 5 次碰撞、已放棄'
                        ' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001';
      END IF;
    END;
  END LOOP;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'admin_create_manual_order: 建單迴圈離開時沒有訂單 id;拒絕繼續';
  END IF;

  -- ── G8 品項落表 + 筆數守 ───────────────────────────────────────────────────
  -- ══ 🔴🔴 ⟦b4-SPEC1⟧ codex R2 MF1:**真正落表的是 `pv.spec`, 而上面三道驗證驗的是呼叫端那一份** ══
  --   G6 那三道(值全字串 / 不得含價格欄 / 是物件)跑在迴圈裡, 吃的是 `v_line -> 'spec'`。
  --   而本片把落表的值換成了 `pv.spec` ⇒ **被驗的與被寫的不再是同一個東西。**
  --   📌 這正是本片自己製造的:改之前它們是同一份, 所以那三道涵蓋得到;改之後就不是了,
  --      **而那三道一個字都不用改就會繼續全綠。**
  --   ⚠️ 今天 `order_items_snapshot_whitelist` 那道表上的 CHECK 仍會擋 ⇒ 不是立即可利用;
  --      🔴 而那是**別人家的守門** —— 正式庫若缺它或它漂移了, 經銷價 / cost 會直接寫進快照。
  --      (本函式檔頭 codex R1 `:203` 講過同一句話, 而本片讓它重新成立。)
  --   ⇒ 自己驗一遍, 判準逐字對齊上面那兩道。
  --
  --   🛑🛑 **codex R3:這一道【不是原子的】, 而我原本沒有講。**
  --      這個 `EXISTS` 與下面那個 `INSERT` 是**兩個 statement**;本函式跑在 READ COMMITTED
  --      ⇒ 兩者各自取一次快照 ⇒ **供應商同步若剛好夾在中間, 會「驗 A 而寫 B」。**
  --      📌 ⇒ 所以這一道的正確定位是**訊息**, 不是防線 —— 它讓員工看得懂哪裡不對,
  --         而**原子的保證來自 `order_items_snapshot_whitelist` 那道表上的 CHECK**
  --         (同一句 INSERT 裡求值 ⇒ 沒有中間狀態)。
  --      ⚠️ **而那正好是本函式檔頭 codex R1 `:203` 說的「別人家的守門」** ——
  --         ⇒ 兩句話一起讀才是完整的:**它是別人家的, 而它是這裡唯一原子的那一道。**
  --      🔴 **我沒有把這道合進 INSERT** —— 那要嘛用 CTE 重寫整段、要嘛在 SQL 裡想辦法 RAISE,
  --         兩條都會把一支「只加一個覆蓋」的 migration 變成重寫 G8。**那是另一片。**
  --         ⇒ 已明寫, 不假裝這裡是原子的。
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.jsonb_array_elements(v_items) AS it
      JOIN public.product_variants AS pv
        ON pv.id = NULLIF(it ->> 'variant_id', '')::uuid
     WHERE NOT public.m3_jsonb_values_all_string(pv.spec)
        OR pv.spec ?| ARRAY['price_store', 'price_by_tier', 'cost']
  ) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 權威規格本身不合格(有非字串值, 或出現價格欄名)'
                    ' —— 這不是員工送錯, 是 product_variants.spec 那一列要先修好';
  END IF;

  -- ══ 🔴 三個陣列必須等長, 不等長就停(codex R6 2026-09-09 nit)═══════════════
  --   `v_items`(要插的列)· `v_item_ids`(它們的 id)· `v_line_bases`(稽核那一份)
  --   是**同一個迴圈裡平行 append 的三份**, 而下面靠「第 n 筆對第 n 筆」把它們接起來。
  -- 🛑 **今天走不到這一格** —— 迴圈裡沒有 `CONTINUE`、沒有早退, 三個一定同步。
  --   ⇒ 📌 **所以它不是在修一個現在的 bug, 是在釘住一個【維護時很容易破壞】的不變式**:
  --     未來有人在「append id」與「append v_items」之間插一個 `CONTINUE`,
  --     多出來的 id 會被 INSERT **靜靜忽略**, 而稽核那一份已經 append
  --     ⇒ 留下一筆**指向不存在品項**的稽核紀錄。
  -- 🔴 **而那個世界【今天沒有任何東西會叫】**:短的那一邊會撞主鍵 NOT NULL 而紅,
  --   **長的那一邊不會** —— 兩個方向的傷害不對稱, 而不會叫的那個方向才是安靜的那個。
  IF pg_catalog.jsonb_array_length(v_item_ids) <> pg_catalog.jsonb_array_length(v_items)
     OR pg_catalog.jsonb_array_length(v_line_bases) <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 內部三個陣列長度不一致(items % / ids % / bases %)'
                    ' ⇒ 稽核會指到不存在的品項, 整筆停下。',
                    pg_catalog.jsonb_array_length(v_items),
                    pg_catalog.jsonb_array_length(v_item_ids),
                    pg_catalog.jsonb_array_length(v_line_bases);
  END IF;

  -- 🔴 **`id` 改成明確寫**(原本走欄位 DEFAULT)—— 稽核那一列要指得回這一列。
  --    對位靠 `WITH ORDINALITY`:`v_item_ids` 是在同一個迴圈裡、同一個順序 append 的,
  --    而 `jsonb_array_elements` 依陣列順序展開 ⇒ 第 n 個元素配第 n 個 id。
  --    🛑 **不靠 `RETURNING` 的回傳順序** —— 那個順序 SQL 標準沒有保證。
  INSERT INTO public.order_items (
    id, order_id, variant_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  SELECT (v_item_ids ->> (it.ord - 1)::integer)::uuid,
         v_order_id,
         NULLIF(it.val ->> 'variant_id', '')::uuid,
         it.val ->> 'variant_sku',
         -- ══ 🔴🔴 ⟦b4-SPEC1⟧:規格【不信呼叫端】—— 在這裡用權威那一份覆蓋 ═══════════
         --   病:這份快照是**不可變**的 ⇒ 送錯一次就永遠錯, 客人訂單明細上的顏色/尺寸補不回來。
         --   🔴 應用層 `284ee4cf`(2026-08-24)已修, 而**那顆 commit 動的檔在 `supabase/` 底下是 0 支**
         --      ⇒ 修法整個在應用層 ⇒ **任何不走那支 repository 的 `service_role` 呼叫端仍然繞得過。**
         --   ⇒ 本片是 DB 那一半。
         --   🔴 **為什麼取在這裡而不是迴圈裡**(codex R1 MF1):這裡在冪等比對【之後】
         --      ⇒ 指紋仍然只吃呼叫端送的東西 ⇒ 檔頭 `:207` 那句「決定性」保住;
         --      而重送時走的是上面那條 early return, **根本不會跑到這一行**
         --      ⇒ 變體事後被改被刪都不影響既有那張單。
         --   🛑 代購品項(`variant_id` 是 NULL)⇒ `LEFT JOIN` 不命中 ⇒ 走 `it -> 'product_snapshot'` 原樣,
         --      它恆 `{}` 是**既有的刻意限制**(`manual-order-repository.ts:265` 同款判斷), 不是本片要解的。
         --   ⚠️ 變體不存在(被刪)而 `variant_id` 非 NULL ⇒ `pv.spec` 是 NULL ⇒ `COALESCE` 成 `{}`;
         --      **而那一列的 FK 會在同一句 INSERT 裡擋下整筆** ⇒ 不會留下空規格的真訂單。
         --   ⚠️ `SET search_path = ''` ⇒ 表名寫全 `public.product_variants`。
         --   📎 權威來源:`20260531142533_init_product_variants.sql:43`(`spec jsonb NOT NULL DEFAULT '{}'`)
         --      · `:62` CHECK 只保證 object · `:40` `id uuid PRIMARY KEY` ⇒ 一個 variant 恰一份 spec。
         -- ══ 🔴🔴 Sean 2026-09-01 12:0x 拍【甲】—— 原話一個字:「甲」 ══════════════
         --   題目逐字:「員工手動建單選了網站上有的商品, 而那個商品在我們目錄裡沒有填規格。
         --             員工自己打了規格。訂單上要留哪一份?」
         --     甲 留員工打的(目錄有填才用目錄的)  ← **他選這個**
         --     乙 一律用目錄的(目錄空的就寫空的)  ← ⛔ **本檔原本的行為, 已被推翻**
         --     丙 擋下來, 叫員工先去補目錄
         --   落點 `~/pcm-mailbox/決策-手動建單目錄沒填規格時用誰的-20260901.md`
         --
         --   🔴 **為什麼**(端題時給他的那一句):目錄是空的時候, 它**不是一個更可信的真相,
         --      它是【沒有值】** ⇒ 拿沒有值去蓋掉有值, 不是取權威, 是**把資料弄丟**,
         --      而且丟得很安靜 —— 員工打了字、按了送出、單子成立了, 而那格是空的, 畫面零訊號。
         --   🔴 **而它踩得到多少**:`product_variants` 54,000 列 / 空規格 **13,112(24%)**
         --      (2026-08-31 主視窗唯讀跑正式庫, 數字與範圍見本檔 `:31`)。
         --
         --   ══ 「空」的定義:三種都處理, 而只有第三種在今天可達 ═══════════════════
         --     ① `pv.spec IS NULL`  ⇒ 🔵 **今天不可達**:欄位是 `NOT NULL DEFAULT '{}'`
         --        (`20260531142533_init_product_variants.sql:43`)。仍然寫進條件, 理由是
         --        **它今天不可達的依據是【另一支檔的欄位定義】** —— 那支哪天放寬了,
         --        這裡會安靜地把 NULL 當成「有值」丟進 `jsonb_set` ⇒ 整格變 NULL。
         --     ② 空字串 `''` ⇒ 🔵 **結構上不可達**:`pv_spec_is_object` CHECK 要求
         --        `jsonb_typeof(spec) = 'object'`(同檔 `:62`)⇒ 字串進不了這一欄。
         --        ⇒ 所以**不為它寫條件** —— 寫了會是一句永遠為假的死碼, 而死碼讀起來像防護。
         --     ③ `pv.spec = '{}'::jsonb` ⇒ 🔴 **這才是那 13,112 列** ⇒ 本片真正要擋的那一種。
         --   ⛔ ~~我原本寫「`{"a": null}` 算有值, 會贏過員工那份, 那是刻意的」~~ **作廢**
         --      (codex R1 抓的):`{"a": null}` **根本走不到這裡** ——
         --      上面 `m3_jsonb_values_all_string` 那道(`:549` 一族)要求值全部是字串,
         --      `null` 不是 ⇒ **整張單直接 RAISE**。⇒ 我描述了一個不存在的行為。
         --      📌 而它讀起來完全合理, 因為它在講一個**看起來會發生**的情境。
         --
         --   ══ 🔴🔴 **「空」在這一格有【兩個意思】, 而 Sean 分開答了兩次** ══════════
         --      ① **空的 jsonb `{}`**(整個規格沒有任何鍵)⇒ **留員工打的**
         --         依據:Sean 2026-09-01 12:0x 原話一個字「甲」。
         --      ② **鍵在、而值是空字串**(`{"color": ""}`)⇒ 🔴 **用目錄的那個空白**
         --         依據:Sean 2026-09-01 12:1x 原話逐字「**算有填(用目錄的空白)**」。
         --      ⇒ ✅ 所以本 CASE 只判 `{}`, 是**對的**, 不是漏掉 ②。
         --
         --      🔵 **這一格的來歷寫下來, 因為它差一點被我自己決定掉**:
         --      codex R1 舉了 `{"color": ""}` 當 must-fix 反例(「用空字串蓋掉員工打的紅」)。
         --      🛑 而我判它**不是 bug, 是一格沒有被問到的業務規則** ⇒ 沒有自行擴張拍板, 端上去問。
         --      ⇒ 他花一行答完, 而答案是 ②(與我原本猜的方向相反 —— 我以為他會想保住員工那份)。
         --      📌 **⇒ 我猜錯了, 而因為我沒有把猜的東西寫成碼, 那個錯不需要任何人來修。**
         --      ⇒ ⇒ 若當時自己決定, 他永遠不會知道有這一格,
         --         而它會變成一個沒有人記得為什麼的行為。
         CASE WHEN pv.id IS NULL
                OR pv.spec IS NULL
                OR pv.spec = '{}'::jsonb
              THEN it.val -> 'product_snapshot'
              ELSE pg_catalog.jsonb_set(it.val -> 'product_snapshot', '{spec}', pv.spec)
         END,
         (it.val ->> 'quantity')::integer,
         (it.val ->> 'unit_price')::integer,
         (it.val ->> 'line_total')::integer
    FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS it(val, ord)
    LEFT JOIN public.product_variants AS pv
           ON pv.id = NULLIF(it.val ->> 'variant_id', '')::uuid;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> pg_catalog.jsonb_array_length(v_items) THEN
    RAISE EXCEPTION 'admin_create_manual_order: 品項落 % 列、期望 %;整筆回滾',
                    v_n, pg_catalog.jsonb_array_length(v_items);
  END IF;

  -- ── G9 稽核落列(F1;形狀逐字對齊 `20260804180000:251-260`)────────────────
  -- 🔴 `before` 是 NULL 而不是 `{}` —— **這張單建立之前不存在**,那不是「空的狀態」是「沒有狀態」。
  -- 🔴 `after` 只放**訂單層**的欄與**筆數**,不逐品項展開:
  --    ① 品項細節在 `order_items`,`target` 指得到那張單 ⇒ 查得到,不必抄一份
  --    ② 稽核表是 append-only、永久留存 ⇒ **少抄一份 = 少一個會過期、會外洩的副本**
  --    ⚠️ 零經銷價、零 cost(本函式從頭到尾不查價,見檔頭 §4)。
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (pg_catalog.btrim(p_actor, E' \t\r\n'), 'order.manual_create',
          -- ⚠️ **`request_id` 這一欄的語意在這裡與別的 admin 操作不同源**(f5 R3 nit,記一筆):
          --    建表註解(`20260712210000:51`)說它是「correlation id(貫穿 admin 寫入→audit→DB→外部服務 log)」,
          --    而本函式填的是**本片自己的冪等鍵** `manual_request_id`。
          --    ✅ 它**串得回那一次操作**(那正是 correlation 要的),所以合理、不改。
          --    ⚠️ 但**它不是別處那個 request_id 的同一條血脈** ⇒ 拿它跨操作做關聯查詢時要知道這件事。
          'order:' || v_order_id::text, p_manual_request_id::text,
          NULL,
          pg_catalog.jsonb_build_object(
            'display_id',       v_display_id,
            'customer_user_id', p_customer_user_id,
            'order_source',     p_order_source,
            'payment_channel',  p_payment_channel,
            'shipping_method',  p_shipping_method,
            -- 🔴 **第 6 代加這兩格**(codex 2026-09-05 must-fix #3):
            --    audit 記了 subtotal/total 卻沒記稅與價別 ⇒ **事後從建立事件看不出這張單是哪一種**,
            --    而 `tax_total = 0` 時尤其分不出(免稅 vs 含稅價)。
            'tax_total',        v_tax,
            'price_tax_mode',   v_price_tax_mode,
            'subtotal',         v_subtotal,
            'shipping_fee',     p_shipping_fee,
            'total',            v_total,
            'item_count',       pg_catalog.jsonb_array_length(v_items),
            -- 🔴🔴 **第 7 代加這一格** —— 它是本片唯一「事後查得到員工原始意思」的落點。
            --    🛑 而它**只在 audit**:不進 `order_items`(那要動表結構, 不在 Sean 拍的範圍)、
            --      不進冪等指紋(🔴 加進去會在部署窗製造真的失敗:舊版表單不送這個鍵
            --      ⇒ 新舊兩版對同一筆重送算出不同指紋 ⇒ 被判「同鍵不同內容」而拒;
            --      而它不影響「這是不是同一個請求」的答案 —— **錢一模一樣**)。
            --    🔬 **怎麼查**(寫在這裡, 因為三個月後那個人不會回頭讀 migration):
            --      SELECT after -> 'line_tax_bases'
            --        FROM public.admin_audit_log
            --       WHERE action = 'order.manual_create'
            --         AND target = 'order:' || '<那張單的 id>';
            'line_tax_bases',   v_line_bases),
          NULL, 'admin');
  -- 🔴 筆數守:trigger 抑制 / FORCE RLS ⇒ **零稽核的成功建單**,而那正是 F1 要擋的東西
  --    ⇒ 落不進去就整筆回滾,**不接受「單建好了但沒人知道是誰建的」**。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'admin_create_manual_order: 稽核落 % 列(期望恰 1)⇒ 整筆回滾;'
                    '這張單不准在沒有經手人紀錄的情況下存在', v_n;
  END IF;

  -- ⚠️ **重送(idempotent)那條路【不落 audit】** —— 它在 G6.5 就 return 了。
  --    理由:那一發**什麼都沒建**,而 audit 記的是「發生了什麼」不是「誰按過按鈕」。
  --    ⇒ 一張單 = 恰一列 `order.manual_create`。查「誰建的」不會查到兩個人。

  -- 🔴 **刻意不寫 `order_legal_consents`** —— 手動單沒有客人的同意動作,偽造它是錯的。
  RETURN pg_catalog.jsonb_build_object(
    'order_id', v_order_id, 'display_id', v_display_id, 'idempotent', false);
END;
$fn$;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE
  v_src text;
  v_acl text;
BEGIN
  SELECT p.prosrc, pg_catalog.array_to_string(p.proacl, ',')
    INTO v_src, v_acl
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure(
     'public.admin_create_manual_order(uuid,uuid,text,text,text,text,jsonb,jsonb,integer,jsonb,text)');

  -- 🔴 **貼進去的就是我編檔時算過的那一版** —— 逐字元。
  IF pg_catalog.md5(v_src) <> '6c7f869621c5e1781ef32af2642a9883' THEN
    RAISE EXCEPTION USING MESSAGE =
      '後置閘一:新本體 md5 是 ' || pg_catalog.md5(v_src)
      || ', 而編檔時算的是 6c7f869621c5e1781ef32af2642a9883 ⇒ 貼進去的不是我驗過的那一份';
  END IF;

  -- 三段新碼都在
  IF pg_catalog.strpos(v_src, 'unit_price_taxed') = 0 THEN
    RAISE EXCEPTION '後置閘二:找不到 unit_price_taxed ⇒ 這一片貼了等於沒貼';
  END IF;
  IF pg_catalog.strpos(v_src, 'v_taxed_residual') = 0 THEN
    RAISE EXCEPTION '後置閘三:找不到 v_taxed_residual ⇒ 殘差那一半沒接上';
  END IF;

  -- 🔴 **舊的那一行不該還在**
  IF pg_catalog.strpos(v_src, 'round(((v_subtotal + p_shipping_fee - 0)::numeric) * 0.05)') > 0 THEN
    RAISE EXCEPTION '後置閘四:舊的整包正推那一行還在 ⇒ 混單那一格沒有被修掉';
  END IF;

  -- 🔵 **沒勾那一邊一個字都沒動**
  IF pg_catalog.strpos(v_src, 'v_price_tax_mode := ''inclusive''') = 0 THEN
    RAISE EXCEPTION '後置閘五:沒勾發票那一邊不見了 ⇒ 本片動到了它不該動的東西';
  END IF;

  -- 🔵 收權沒有被 CREATE OR REPLACE 洗掉
  IF v_acl IS NULL OR v_acl NOT LIKE '%service_role=X/%' THEN
    RAISE EXCEPTION USING MESSAGE = '後置閘六:proacl 裡看不到 service_role(收到 ' || COALESCE(v_acl, '<null>') || ')';
  END IF;

  -- ⚪ 負對照
  IF pg_catalog.strpos(v_src, 'zzz_never_a_literal') > 0 THEN
    RAISE EXCEPTION '後置閘七(負對照):現造字面竟然命中 ⇒ 上面那幾格不算數';
  END IF;

  RAISE NOTICE '⟦b4-INVOICE5PCT⟧二 貼好了:含稅列的稅改用減的(殘差), 未稅列與運費照舊正推;沒勾發票那條路一個字沒動。';
END
$post$;

COMMIT;
