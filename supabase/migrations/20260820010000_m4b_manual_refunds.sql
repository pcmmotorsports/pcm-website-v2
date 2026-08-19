-- 20260820010000_m4b_manual_refunds.sql
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 🔴🔴 給【按下 apply 的那個人】—— 這一段寫在最上面,因為你會先看到它        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--   **本檔 §0 有三道「指紋」斷言,它可能會在 apply 當場 RAISE 然後整支回滾。**
--   若真的停在 §0:**那不是失敗,那是這一片唯一一次證明自己有用的機會。**
--
--   為什麼:本檔用 `CREATE OR REPLACE` 改 `pcm_order_refundable_remaining(uuid)`,
--   而那支函式是「這張單還能退多少」的**唯一算式**,後台退款發起入口的閘吃它的輸出。
--   本檔是在 **#473b-1(`20260814190000`)** 的定義上【加第三段】——
--   🔴 **若正式庫現在不是那一版**(有人又改過、或它其實更舊),
--      本檔的前兩段就是過期的字面,照樣覆蓋下去 = **靜默把別人的機制倒回去**。
--   而正式庫的現況**只有在 apply 那一刻量得到** ⇒ 所以驗證放在那一刻,不放在提案裡。
--
--   ⇒ **停在 §0 時要做的事**:
--       ① **不要繞過、不要註解掉那幾道斷言。**
--       ② 回報兩件事:`SELECT prosrc FROM pg_proc WHERE oid =
--          'public.pcm_order_refundable_remaining(uuid)'::regprocedure;` 的**現況**,
--          以及本檔期望的指紋(§0 三道各自的錯誤訊息裡都寫了它在找什麼)。
--       ③ 交給人判斷「現況是哪一版」——**那是決策,不是修 bug。**
--
-- 非卡退款登記表(現金 / 匯款)。plan = ~/pcm-mailbox/W5-029b-plan-非卡退款登記-第二版-20260820.md
--
-- ── 為什麼有這張表(Sean 2026-08-20 逐字)────────────────────────────────────
--   Q8「員工把現金退給客人,需不需要跟刷卡退款一樣被管?」⇒ **乙:那只是記一筆帳。**
--   而既有的 `order_refunds` 進不去:它的 `rec_trade_id` 是 NOT NULL
--   (`20260801120000:191`),而那個 NOT NULL 的檔頭逐字已經寫了它的代價:
--     「沒有 TapPay 交易的訂單(例如匯款)無法登記退款。fail-closed 的刻意選擇。
--       ⇒ 匯款訂單的退款登記是【未解題】,已列進報告等 Sean 拍板。」
--   ⇒ 本檔就是那個「未解題」的解,而**解法不是放寬那個 NOT NULL**(見下)。
--
-- ── 🔴 為什麼【不是】放寬 `order_refunds.rec_trade_id`(甲案,已否決)─────────
--   那個 NOT NULL 不是形式上的:`20260801120000:188-190` 逐字 ——
--     「trigger 內是 `NEW.rec_trade_id <> v_rec_trade_id`,而 `NULL <> 'x'` 求值為 NULL(非 true)
--       ⇒ NULL 不會被 trigger 攔下,由本 NOT NULL 接住。」
--   ⇒ 改成 nullable **不是放寬一個限制,是把不可變守門【對新列靜默關掉】**
--     —— trigger 還在、還會跑、對 NULL 那些列求值為 NULL、放行。**沒有任何東西會紅。**
--   ⇒ 走本檔這條路,那個 NOT NULL **一個字都不用動**。
--
-- ── 🔴 為什麼【不是】記進 `order_payments`(丙案,已查掉)────────────────────
--   乍看最便宜:那張表 rail 已含 `cash`/`bank_transfer`,且「已收 = SUM(amount)」。
--   權限上**可行**(`20260810130000` OP2b 已 apply ⇒ dormant gate 已 DROP、A9 已上線)。
--   而它在【部分退款】上不成立:A9 逐字(`20260810130000:8`)
--     「沖銷列 `amount` = 被沖列 `amount` 的**反號**(`NEW.amount = -parent.amount`)」
--   ⇒ 沖銷只能整筆;退一部分要拆成三列的鏈(P +500 / R1 −500 / R2 +300),
--     而那條鏈記下來的是「我們最後收了多少」,**不是「我們退了多少、為什麼退、誰經手」**。
--   ⇒ 而後三樣正是 Sean 那句「記一筆帳」裡的**帳**;`order_payments` 沒有 reason / actor 欄。
--   🔴 **它不可行的理由是【語意】,不是【權限】** —— 而權限問題會被解決,語意問題不會。
--     ⇒ 三天後想「不如記進 order_payments」的人,請先讀完這一段。
--
-- ── 🔴🔴 本檔的順序:【先讓讀的那一支算對,再讓寫的路存在】────────────────
--   §3 改了 `pcm_order_refundable_remaining()` 讓它把本表算進去,而本表**此刻恆空**
--   ⇒ 本檔對現況的行為影響 = **零**(空表的 SUM 是 0)。
--   🔴 反過來做(先能寫、之後才改讀)會開一個窗:那段期間表裡有列而閘算不到它們
--      ⇒ 退款發起入口**開太寬**。**這個順序不是風格,是它存在的理由。**
--
-- ── ⚠️ 本檔【不做】什麼 ────────────────────────────────────────────────────
--   · 不做寫入路徑:本表零寫入 GRANT ⇒ 只有表擁有者寫得進去,service_role 只有 SELECT。
--     ⇒ 登記用的 RPC 是**下一片**。(對照 `order_refund_jobs` 用 `CHECK(false)` dormant gate ——
--        那是因為它**給了** service_role 寫權;本表沒給,所以不需要那道 gate。)
--   · 不做不可變 trigger:零寫入 GRANT 之下,唯一寫得進來的是 owner,而 owner 本來就繞得過 trigger
--     (`20260801120000:62-65` 逐字:owner 可 `DISABLE TRIGGER USER`)⇒ 那道 trigger 在這一片是裝飾。
--     ⇒ 等寫入 RPC 那一片再連同不可變性一起設計。**本檔不宣稱本表不可竄改。**
--   · 不做後台 UI:登記畫面是另一片。Sean Q6 逐字「都做,做到完成」⇒ **那一半仍在清單上,不是不做。**
--
-- ── 🔴🔴 具名缺口(**不是 TODO,是一個還沒有答案的設計題,而它在哪一片答**)──────
--   **「一筆現金退款登記錯了怎麼辦?」本表現在答不出來。**
--   卡片退款有更正鏈(`#473b-1` 的 `order_refund_effective_verdict`:人工判定可以被更正);
--   本表**沒有判定**,所以也沒有「判定被更正」——**而錯誤仍然會發生,只是形狀不同**:
--     金額打錯 / 根本沒退卻登記了 / 退給錯的訂單。
--   🔴 **它比卡片那邊更貴**:Sean 2026-07-29 建更正鏈時的病灶原文是
--     「一筆點錯的下拉,變成一筆假的法律證據」;而這裡是
--     **一筆假的「錢已經退給客人了」,而客人手上沒有錢。**
--   ⇒ **為什麼現在不解**:本表零寫入 GRANT ⇒ 在寫入 RPC 那一片之前,
--     **沒有任何路徑能把一筆現金退款登記錯** ⇒ 這一格此刻不可達。
--   ⇒ **為什麼不先猜一個形狀建進去**:答案會決定欄位(要不要 `voided_at`?要不要更正列?),
--     而**表一旦 apply 就改不動了**(`supabase/APPLIED.tsv` 記 sha256,連註解都不可變)。
--     猜錯的代價是不可逆的。
--   ⇒ **在哪一片答**:寫入路徑那一片。**那一片不得只做 INSERT 就宣稱完成** ——
--     它必須同時回答本段。(寫法對齊 `order_payments` 當初對 A9 的具名缺口。)

BEGIN;

-- 改形狀要 ACCESS EXCLUSIVE lock;5 秒等不到就整支放棄(對齊 20260725130100:72)。
SET LOCAL lock_timeout = '5s';

-- ══ 0. 前置斷言(fail-closed;本檔不冪等,重放會在這裡或第一句 CREATE 失敗)══════
DO $pre$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — public.orders 不存在;拒繼續';
  END IF;
  IF to_regclass('public.order_refunds') IS NULL THEN
    RAISE EXCEPTION '前置失敗 — public.order_refunds 不存在(本檔要改的函式讀它);拒繼續';
  END IF;
  -- 🔴 正向對照:確認我們要改的那支函式【現在真的存在】。
  --    少了這道,函式名打錯時 CREATE OR REPLACE 會安靜地建出第二支,而舊的那支繼續被閘讀。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'pcm_order_refundable_remaining'
  ) THEN
    RAISE EXCEPTION '前置失敗 — public.pcm_order_refundable_remaining 不存在(本檔要改它);拒繼續';
  END IF;

  -- 🔴🔴 認【版本】,不只認【存在】。本檔第一版就是死在這一格上:
  --    我讀了 20260801120000(grep 第一個命中)當成現況,而真正的現況是 20260814190000
  --    就地 CREATE OR REPLACE 過的版本(#473b-1)⇒ 我的「改寫」會把那一片的機制整個倒回去,
  --    而 DB 層不會有任何東西紅。抓到它的是 packages/domain 那道 gate,不是我。
  --
  -- 🔴 這一格被打回過兩次,兩次的理由不同,兩個修法都在下面:
  --   ① W6 2026-08-20:比對 `prosrc` **含註解** ⇒ 未來某人拿掉那段 JOIN、
  --      **並寫一句註解說明為什麼拿掉**(那是好習慣)⇒ 字串仍在 ⇒ 斷言通過 ⇒ 守門靜靜死掉。
  --      ⇒ **這道守門會懲罰把話講清楚的人。** ⇒ 修法 = 比對前先剝掉行註解。
  --      ⚠️ `regexp_replace(…, '--[^\n]*', '', 'g')` 的限定(W6 給,寫下來因為它是修法成立的條件):
  --         **不處理區塊註解 `/* */`;會誤剝字串字面量裡的 `--`。**
  --         🔴 **本檔要比對的那支函式體【沒有字串字面量】所以安全** ——
  --            下一個人若在那支函式裡加了含 `--` 的字串字面量,這個修法就靜靜壞掉。
  --   ② codex 2026-08-20:只認函式**名**不認**簽章** ⇒ 同名 overload 可以代它答題;
  --      而且「含那個 view 名」不是 #473b-1 的完整指紋 —— 一個**更新的**版本(多第四段)也會通過,
  --      然後被本檔靜默覆蓋。⇒ 修法 = 用 `regprocedure` 鎖死簽章 + 比對**正規化後的三段字面**。
  DECLARE
    v_src text;
  BEGIN
    -- 鎖死簽章(uuid),不靠 proname;查無會由 regprocedure 自己丟錯。
    SELECT p.prosrc INTO v_src
      FROM pg_proc p
     WHERE p.oid = 'public.pcm_order_refundable_remaining(uuid)'::regprocedure;
    IF v_src IS NULL THEN
      RAISE EXCEPTION '前置失敗 — 取不到 pcm_order_refundable_remaining(uuid) 的定義;拒繼續';
    END IF;
    -- 剝行註解 + 空白正規化,之後只比對真正的 code。
    v_src := regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');

    -- 指紋 ①:#473b-1 的 allowlist 那一段(不是舊版的 `status <> 'failed'`)。
    IF v_src NOT LIKE '%r.status IN (''processing'', ''confirmed'')%' THEN
      RAISE EXCEPTION '前置失敗 — 現行 pcm_order_refundable_remaining 不含 #473b-1 的 allowlist 段;拒繼續。本檔是在 20260814190000 的定義上【加一段】,現況不是那一版 ⇒ 停下來重讀最後一支改過它的 migration';
    END IF;
    -- 指紋 ②:更正鏈那一段(本檔要原封保留它)。
    IF v_src NOT LIKE '%v.corrected_to = ''money_moved''%' THEN
      RAISE EXCEPTION '前置失敗 — 現行 pcm_order_refundable_remaining 不含 #473b-1 的更正鏈段;拒繼續(理由同上)';
    END IF;
    -- 🔴 指紋 ③:**段數**。#473b-1 恰好兩段 COALESCE。
    --    少了這一格,一個【更新的、多第四段】的版本也會通過前兩個指紋,然後被本檔靜默覆蓋掉
    --    —— 那正是本檔第一版犯的錯的下一個變形(codex must-fix ①)。
    IF (length(v_src) - length(replace(v_src, 'COALESCE(', ''))) / length('COALESCE(') <> 2 THEN
      RAISE EXCEPTION '前置失敗 — 現行 pcm_order_refundable_remaining 的 COALESCE 段數不是 2(=#473b-1 的形狀);拒繼續。它可能已被更新過 ⇒ 本檔會靜默覆蓋掉那次更新 ⇒ 停下來重讀最後一支改過它的 migration';
    END IF;
  END;
END;
$pre$;

-- ══ 1. 表 ════════════════════════════════════════════════════════════════════
CREATE TABLE public.order_manual_refunds (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT 而非 CASCADE(對齊 order_payments / order_refunds):退款是要留存的事實,
  -- 不得因為刪一張單就無聲消失。
  order_id      uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,

  -- 值域刻意**不含 card**:卡片退款有自己的帳本(order_refunds)與自己的狀態機。
  -- 兩本帳的分界就是這一行 —— 而分界寫在 CHECK 裡,不是寫在約定裡。
  rail          text        NOT NULL CHECK (rail IN ('bank_transfer', 'cash')),

  -- 整數元(對齊 order_refunds.refund_amount)。只有 > 0、沒有上界
  -- (對齊 A7c 拍板⑤:DB 不做防超退)。
  refund_amount integer     NOT NULL CHECK (refund_amount > 0),

  -- 🔴 btrim 的**預設字集只有一般空格** —— `reason = E'\n\t'` 會通過 `btrim(reason) <> ''`,
  --    留下一筆看起來非空、實際不可稽核的金流紀錄(codex 對抗審查 2026-08-20 must-fix ④)。
  --    ⇒ 顯式給字集。既有的 order_refunds 用的是預設 btrim,那是它的問題,本檔不重蹈。
  reason        text        NOT NULL CHECK (btrim(reason, E' \t\r\n') <> ''),
  actor         text        NOT NULL CHECK (btrim(actor,  E' \t\r\n') <> ''),

  -- 🔴 兩個時間刻意分開,見 COMMENT。
  occurred_at   timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_manual_refunds_order_idx ON public.order_manual_refunds (order_id);

-- ══ 2. COMMENT:🔴 這一節的重點是【刻意沒有的欄】═══════════════════════════════
-- ⚠️ 為什麼寫在這裡而不是寫在別的檔:已 apply 的 migration 連註解都不能再改
--    (`supabase/APPLIED.tsv` 記 sha256)⇒ **這幾句話只有這一次機會寫。**
COMMENT ON TABLE public.order_manual_refunds IS
  '非卡退款登記(現金 / 匯款)。Sean 2026-08-20 Q8=乙 逐字「那只是記一筆帳」。'
  '🔴 本表記的是【一件已經發生的事】,不是【一個要發起的動作】—— 錢是人交回去的,系統沒有動作可做。'
  '🔴 **刻意沒有 status**:它出生就是既成事實。卡片退款需要 processing/failed 是因為要等 provider 回答;'
  '現金不必 —— 這【不是還沒加】,是這張表的語意裡沒有那個狀態。'
  '🔴 **刻意沒有 bank_refund_id**:沒有 provider,就沒有 provider 的冪等鍵。同樣不是還沒加。'
  '🔴 **刻意沒有 rec_trade_id**:那正是本表存在的全部理由(order_refunds 那個 NOT NULL 因此一個字都不用動)。'
  '⚠️ 本表零寫入 GRANT ⇒ 只有 owner 寫得進來,登記用的 RPC 是下一片;**本檔不宣稱本表不可竄改**。';

COMMENT ON COLUMN public.order_manual_refunds.rail IS
  '退款管道。刻意不含 card —— 卡片退款走 order_refunds。兩本帳的分界寫在這個 CHECK 裡,不是寫在約定裡。';
COMMENT ON COLUMN public.order_manual_refunds.actor IS
  '誰經手把錢交回去。🔴 現金退款的失敗模式是【人】(到底有沒有真的交出去),不是 API ⇒ 這一欄不是稽核裝飾,是唯一的線索。';
COMMENT ON COLUMN public.order_manual_refunds.occurred_at IS
  '錢【實際】交回去的時刻,由登記的人填。🔴 與 created_at(登記時刻)刻意分成兩欄 —— '
  '現金退款常常是先退、後登記,合成一欄會讓「拖了三天才登記」變得看不見。'
  '⚠️ 未來時間的檢查【不在 DB 層】:CHECK 不接受 now() 這種非 IMMUTABLE 函式 ⇒ 由寫入路徑(下一片的 RPC)負責。';
COMMENT ON COLUMN public.order_manual_refunds.refund_amount IS
  '本筆退款金額(元,整數)。只有 > 0、沒有上界(對齊 A7c 拍板⑤:DB 不做防超退)。';

-- ══ 3. 🔴 讓可退餘額把本表算進去(本片真正會改變行為的那一格)═══════════════════
-- 原本它只讀 order_refunds ⇒ 新表有列而它算不到 ⇒ 那個數字偏高。
-- 🔴 後果不是少顯示一個數字:**後台退款發起入口的閘吃它的輸出**
--    (`apps/admin/src/components/orders/order-detail.tsx:165-167`,讀取失敗 ⇒ fail-closed 關閉)
--    ⇒ 算少了退款 ⇒ 閘開太寬。
-- ⚠️ 而它是「顯示用函式」(舊 COMMENT 逐字「不是守門、沒有任何 trigger 讀它」)——
--    🔴 **那個標籤本身就是陷阱**:它宣告自己不承重,而有一道閘正踩在它上面
--    ⇒ DB 層不會替這個錯誤把關,只有測試會。
CREATE OR REPLACE FUNCTION public.pcm_order_refundable_remaining(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.total::bigint
       -- ↓↓ 前兩段【逐字取自 20260814190000 的現行定義,一個字都沒改】↓↓
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
             WHERE r.order_id = o.id
               AND r.status IN ('processing', 'confirmed')), 0)
       - COALESCE(
           (SELECT SUM(r.refund_amount)
              FROM public.order_refunds r
              JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
             WHERE r.order_id = o.id
               AND r.status = 'failed'
               AND r.failed_reason = 'manual_failed'
               AND v.corrected_to = 'money_moved'), 0)
       -- ↑↑ 以上為現行機制(#473b-1),本檔【只加不改】↑↑
       -- 第三段:非卡退款(本檔新表)。刻意【不】join 上面那張更正判定 view ——
       -- 那張 view 是【卡片退款的人工判定被更正】的產物,而本表沒有判定 ⇒ join 會是零列、純裝飾。
       -- 🔴🔴 **刻意不寫出那張 view 的名字** —— 下一個維護者會想「為什麼這裡不寫清楚?」,答案在這:
       --    本檔 §0 的前置斷言與 §5e 都比對 `prosrc` 的**字面**,而 **`prosrc` 含註解**
       --    ⇒ 在函式本體裡寫出那個名字,會讓那兩道斷言對「把 JOIN 整段刪掉」**恆真**。
       --    (2026-08-20 突變 N2 實測抓到:刪掉 JOIN 之後 5e **沒紅** —— 因為這行註解替它答了。)
       --    📌 通則:`prosrc` / 檔案內容 / diff 這類「整包字串」當比對對象時,
       --       **註解與 code 在裡面是同一種東西**。要寫說明,寫在函式本體【外面】。
       -- 🔴 本表【沒有 status】⇒ 沒有值域可篩 ⇒ 全部列一律計入。
       --    這不是疏忽:它記的是既成事實,不存在「還沒生效的那種列」。
       - COALESCE(
           (SELECT SUM(m.refund_amount)
              FROM public.order_manual_refunds m
             WHERE m.order_id = o.id), 0)
    FROM public.orders o
   WHERE o.id = p_order_id;
$$;

COMMENT ON FUNCTION public.pcm_order_refundable_remaining(uuid) IS
  'A7c 顯示用(RW1a → #473b-1 → 本檔 第三次改版):orders.total 減去【三段】—— '
  '① order_refunds 的 processing + confirmed;'
  '② 人工判定沒動錢、事後被更正成 money_moved 的 failed 列(#473b-1);'
  '③ order_manual_refunds 全部列(非卡退款;該表沒有 status,不存在「還沒生效」的列)。'
  '🔴 ①②③ 三段值域互斥 ⇒ 不會重複扣。'
  '🔴 ① 仍為 allowlist:**未來新增任何 order_refunds.status 值預設不佔額度 —— 新增狀態時必須回訪本函式**。'
  '🔴 **不是守門、沒有 trigger 讀它**(拍板⑤)—— 而後台退款發起入口的閘吃它的輸出,'
  '⇒ 「顯示用」這個標籤不代表它不承重。'
  '🔴 只反映本帳本;Portal 場外退款不在其中 ⇒ 真實剩餘額 ≤ 本值,要真相請打 TapPay Record API。查無訂單回 NULL。';

-- ══ 4. RLS zero-policy + 表 ACL(樣板 = 20260725130100:317-326)═══════════════
ALTER TABLE public.order_manual_refunds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.order_manual_refunds FROM PUBLIC, anon, authenticated, service_role;
-- service_role 只給 SELECT(後台顯示路徑);寫入走下一片的 SECURITY DEFINER owner RPC。
GRANT SELECT ON TABLE public.order_manual_refunds TO service_role;

-- 🔴 函式 EXECUTE 收斂:CREATE OR REPLACE **不會**重設既有函式的 ACL,
--    但也不保證它是對的 ⇒ 照舊重新收斂一次,讓「唯 service_role 可執行」在本檔字面成真。
REVOKE ALL ON FUNCTION public.pcm_order_refundable_remaining(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pcm_order_refundable_remaining(uuid) TO service_role;

-- ══ 5. fail-closed 驗收斷言 ═══════════════════════════════════════════════════
-- 🔴 本節被 codex 對抗審查(2026-08-20)打回三條,修法都在各格註解裡。
DO $post$
DECLARE
  v_src   text;
  v_bad   text;
  v_owner oid;
BEGIN
  -- ── 5a. 🔴 表 ACL:**閉世界**,不是角色黑名單(codex must-fix ③)────────────────
  --    原版逐一問 anon/authenticated/service_role ⇒ 若 default privileges 讓【第四個角色】
  --    多拿到權限,它一格都看不見。⇒ 改成:把 relacl 攤開,除了 owner 之外
  --    **只准剩下 service_role 的 SELECT**,多一筆就炸。
  -- ⚠️ `aclexplode(NULL)` 回零列 ⇒ 只寫 EXISTS 的話,「relacl 是 NULL」會靜默通過
  --    (memory:ACL 欄是 NULL 時 PUBLIC 看不見)⇒ 先顯式擋 NULL。
  SELECT c.relowner INTO v_owner FROM pg_class c WHERE c.oid = 'public.order_manual_refunds'::regclass;
  IF (SELECT c.relacl FROM pg_class c WHERE c.oid = 'public.order_manual_refunds'::regclass) IS NULL THEN
    RAISE EXCEPTION 'ACL 異常 — order_manual_refunds 的 relacl 是 NULL(表示本檔的 REVOKE/GRANT 沒生效);拒繼續';
  END IF;
  SELECT string_agg(x.who || ':' || x.priv, ', ' ORDER BY x.who, x.priv) INTO v_bad
    FROM (
      SELECT a.grantee::regrole::text AS who, a.privilege_type AS priv
        FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.oid = 'public.order_manual_refunds'::regclass
         AND a.grantee <> v_owner
         AND NOT (a.grantee = 'service_role'::regrole AND a.privilege_type = 'SELECT')
    ) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ACL 異常 — order_manual_refunds 除了 owner 只准 service_role 的 SELECT,實際多出:%;拒繼續', v_bad;
  END IF;

  -- ── 5b. service_role 的 SELECT 必須真的在(缺了 runtime 42501;閉世界只擋多、不擋少)──
  IF NOT has_table_privilege('service_role', 'public.order_manual_refunds', 'SELECT') THEN
    RAISE EXCEPTION 'ACL 異常 — service_role 應有 SELECT(後台顯示路徑);拒繼續';
  END IF;

  -- ── 5c. 🔴 函式 ACL 也要閉世界(codex must-fix ③:CREATE OR REPLACE **保留**既有 proacl)──
  --    既有若另有 reporting_role / authenticator 的 EXECUTE,本檔的 REVOKE 清單點不到它。
  -- 🔴 `proacl IS NULL` 的前擋(W6 R2 nit):同一個坑,表那邊補了、函式這邊漏了。
  --    而**函式那一側的預設比表更兇** —— `proacl IS NULL` = 走預設,
  --    **而函式的預設是 `PUBLIC EXECUTE`**。`aclexplode(NULL)` 回零列 ⇒ 下面的閉世界掃不到任何東西
  --    ⇒ **靜默通過**,而真實狀態是一支 `SECURITY DEFINER` 函式對 PUBLIC 開著。
  -- ⚠️ 在【這一發 apply】裡它不可能是 NULL(本檔上面剛做過 REVOKE + GRANT)——
  --    可達的情境是**未來某支 migration 改簽章**:`DROP FUNCTION` + `CREATE FUNCTION`
  --    (不是 `CREATE OR REPLACE`)⇒ `proacl` 重置成 NULL ⇒ PUBLIC EXECUTE 悄悄回來,
  --    而這段檢查若被複製過去,**照樣說沒問題**。⇒ 補在這裡,連同理由一起被複製走。
  IF (SELECT p.proacl FROM pg_proc p
       WHERE p.oid = 'public.pcm_order_refundable_remaining(uuid)'::regprocedure) IS NULL THEN
    RAISE EXCEPTION 'ACL 異常 — pcm_order_refundable_remaining 的 proacl 是 NULL(=走預設,而函式預設是 PUBLIC EXECUTE);拒繼續';
  END IF;
  SELECT string_agg(x.who || ':' || x.priv, ', ' ORDER BY x.who, x.priv) INTO v_bad
    FROM (
      SELECT a.grantee::regrole::text AS who, a.privilege_type AS priv
        FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid = 'public.pcm_order_refundable_remaining(uuid)'::regprocedure
         AND a.grantee <> p.proowner
         AND NOT (a.grantee = 'service_role'::regrole AND a.privilege_type = 'EXECUTE')
    ) x;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'ACL 異常 — pcm_order_refundable_remaining 除了 owner 只准 service_role 的 EXECUTE,實際多出:%;拒繼續', v_bad;
  END IF;

  -- ── 5d. RLS 必須 enabled(零 policy 之下少了它 = 表對非 owner 敞開)────────────
  --    ⚠️ 誠實邊界(codex):RLS 零 policy **只擋一般非 owner 角色** —— owner 與 BYPASSRLS 角色
  --       仍讀得到(正式 Supabase 的 service_role 就是 BYPASSRLS),`TRUNCATE` 也不受 RLS 管。
  --       本表的實際保護來自 5a 的零寫入 ACL,RLS 是縱深不是主力。
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'order_manual_refunds' AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS 異常 — order_manual_refunds 未啟用 row level security;拒繼續';
  END IF;

  -- ── 5e. 🔴🔴 函式本體:**三段都要在,而且方向與有效性都要對**(codex must-fix ②)─────
  --    原版只問「有沒有提到那兩個名字」⇒ 把第三段的 `-` 改成 `+`、或塞一個 `AND false`,
  --    表名與名字全部照樣命中 ⇒ 全綠,而非卡退款會【完全不扣】或【反向增加可退額】。
  --    ⇒ 改成比對**正規化後的整段字面**(剝行註解 + 空白壓成一格)。
  SELECT regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')
    INTO v_src
    FROM pg_proc p
   WHERE p.oid = 'public.pcm_order_refundable_remaining(uuid)'::regprocedure;

  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(r.refund_amount) FROM public.order_refunds r WHERE r.order_id = o.id AND r.status IN (''processing'', ''confirmed'')), 0)%' THEN
    RAISE EXCEPTION '函式異常 — 第①段(order_refunds allowlist)不是預期字面(可能被改了方向、值域或加了條件);拒繼續';
  END IF;
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(r.refund_amount) FROM public.order_refunds r JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id WHERE r.order_id = o.id AND r.status = ''failed'' AND r.failed_reason = ''manual_failed'' AND v.corrected_to = ''money_moved''), 0)%' THEN
    RAISE EXCEPTION '函式異常 — 第②段(#473b-1 更正鏈)不是預期字面 ⇒ 本檔可能把它改掉或弄丟了;拒繼續';
  END IF;
  IF v_src NOT LIKE '%- COALESCE( (SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m WHERE m.order_id = o.id), 0)%' THEN
    RAISE EXCEPTION '函式異常 — 第③段(非卡退款)不是預期字面 ⇒ 減號被改成加號 / 多了 AND false / 表名不對,任一都會讓非卡退款不扣或反向加額;拒繼續';
  END IF;
END;
$post$;

COMMIT;
