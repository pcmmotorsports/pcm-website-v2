-- ============================================================
-- M-4b 生命週期 L5b-0-s(甲):被讓路的 attempt 回到 ceiling/manual 閘,並讓告警看得見它
-- ============================================================
-- 真權威:docs/specs/2026-08-10-l5b-0-supersede-charge-reject-plan.md §3.5(已隨 L5b-0-m commit 進 repo)。
-- 前一片:L5b-0-m(20260810170000,三道閘)—— 本片是它的**配套**,不是它的一部分:
--   -m 守的是「錢的歸屬」、本片守的是「這族被擋下來之後,誰負責看它」。
--
-- 🔴 為什麼需要本片(-m 造成的、必須配套解掉的後果):
--   R1c1 讓 `released` 繞過 ceiling 與 manual 兩道閘,理由逐字是「持續低頻對帳**直到 terminal**」
--   (20260624120008:97)。而 -m 把**被讓路那族的 terminal 拿掉了**(它永遠不會轉 charged)
--   ⇒ 對它而言「繞 ceiling」就變成:**每 16 分鐘一發 TapPay Record API、永不停止、也永遠沒有人被通知**。
--   ⚠️ 誠實話:「錢沒來」那族**在 L5a-1 之後就已經是永久迴圈**(既有債、非 -m 造成);
--   -m 新增的只有「錢來了」那族(罕見)。本片把兩族一起收進閘內。
--
-- 🔴 四處改動缺一不可(這是本片最容易被做壞的地方,plan §3.5 有前三處的完整推導;
--    改④ 是關卡2 R1-MF1 逼出來的第四處,理由見下方「為什麼是四處不是三處」):
--   改① claim 述詞           讓路那族回到 manual/ceiling 閘 ⇒ 第 8 輪之後不再 claim(迴圈止住)
--   改② ceiling→manual       第 8 輪把 needs_manual_review 標起來 ⇒ 「停住」變成「有人知道」
--   改③ 告警計數述詞         讓那個旗標**真的被算進 attempt_manual_review_count** ⇒ 告警才會亮
--   改④ ceiling-expirer      **已經 count>=8 的既有列**(與 claim→crash→未 mark 的孤兒)也要被標起來
--   ⇒ 只做 ①:靜靜掉出對帳,沒有任何訊號。
--   ⇒ 只做 ①②:旗標設了但沒有任何計數在數它(本計數原述詞要求 status='pending',而它是 released)。
--   ⇒ 🔴 **只做 ①② 對「讓路時未滿 12h 且尚無 released_manual_review_at」那族比什麼都不做更沉默**:
--      不做的話那族至少 12h 後 released_stuck_count 還會亮;做了 ① 之後約 68 分鐘就不再 claim
--      ⇒ 12h 那個 marker 永遠寫不到。
--      ⚠️ **範圍收窄(關卡2 R1-nit2:原句寫「只做①② 比什麼都不做更沉默」過度絕對)**:
--      讓路當下 released_at 已逾 12h 的那族**不吃這句話** —— 它在第一輪 markSettleRetry 就會寫下
--      released_manual_review_at(那段是 CASE、與 ceiling 無關)⇒ released_stuck_count 照亮。
--      三處一起才對**兩族都**成立。
--
-- 🔴 為什麼是四處不是三處(關卡2 R1-MF1;plan §3.5 只推導到三處,此為實作時補上的第四處):
--   改① 的第三支帶 `settle_attempt_count < 8`(ceiling)。這條在**未來**是對的(讓路那族從 0 起跑),
--   但它把兩種**已經 >= 8** 的列孤兒化,而這兩種都不是假想:
--     (a) **既有列**:讓路發生在 L5a-1 之後,而在本片 apply 之前,released 是**繞 ceiling** 的
--         (R1c1)⇒ settle_attempt_count 無界(檔內 :174 那段防 int4 溢位的註解就是為它寫的)
--         ⇒ 「已經被讓路、count 早就 >8」的列**在機制上必然會累積**。
--         ⚠️ **R3-F1 字面收窄**:我原本寫「正式庫上這是常態不是例外」——**那是推論、我沒數過**,
--         而且與 `packages/domain/src/payment/anomaly-alert.ts` 那句「Phase1 producer-gated 0」互相打架。
--         正確說法:**存在性由機制保證、數量未知** ⇒ 數量在 apply 當天用 plan §3.6-1a 那條 SQL 現場數。
--     (b) **claim 完在 mark 之前 crash**:count 被 ++ 到 8 卻沒人標旗標 —— 這正是 3DS-4a-2 當初
--         造 expire_stuck_attempts_at_ceiling 的理由(20260615120001:79-84 逐字寫著)。
--   兩者都會落成:claim 濾掉(count>=8)⇒ mark 永不跑 ⇒ 旗標永遠是 false ⇒ 改③ 的計數(要求
--   needs_manual_review=true)**恆零** ⇒ **本片宣稱要治的「無聲消失」原封不動**,而且更難察覺,
--   因為三道改動看起來都「有做」。
--   ⇒ 改④ 把既有那道 ceiling-expirer 的 status 閘,照改①② 同一條線擴到讓路那族。
--
-- 🔴 改④ 是**明文推翻 R1c1 的〔E〕**(不是漏看):`20260624120008:24-26` 寫「expire 不改本體 ——
--   plan『expire 不碰 released』由既有 predicate `status IN ('pending','charged')` 天然排除 released
--   → 零改動即滿足」。⚠️ 那個理由的**成立條件**是「released 繞 ceiling、永遠不需要 expire」,
--   而本片改① 正是把讓路那族**送回 ceiling 之內** ⇒ 〔E〕的前提對這一族失效。
--   ⇒ 收窄成:**未讓路的 released 仍不被 expire 碰**(R1c1 行為零回歸、格 17 釘住);
--     **被讓路的 released 進 expire**(格 16 釘住)。
--
-- 🔴 改③ 的 terminal 排除也不可省:close_released_attempt 只把列翻 failed、**不清 needs_manual_review**
--   (20260624120010:121-127),而 superseded_at durable、舊單永遠 unpaid
--   ⇒ 少了 `status IN ('charged','released')`,**已結案的列會永久留在計數裡**,
--   第二筆事故的增量淹在底噪 ⇒ 下次災難當天等於沒有訊號。語意與 -m 閘三同源:
--   只算「仍持有這張單付款權」的那顆 attempt。
--
-- 🔴 零漂移:四支各自以**活本體**為 pre-image 逐字沿用(awk 抽取、非手抄),本片只改上述四處述詞 + 換 COMMENT。
--   pre-image 出處(**都經 §1.0 那條命令重驗、不是憑記憶**):
--     改① claim_stuck_unsettled_attempts      20260624120008:80
--     改② mark_attempt_settle_retry           20260809140000:89   ← **不是** 20260624120008(那是兩版之前)
--     改③ get_payment_anomaly_alert_summary   20260701130000:43   ← **三參數多載**;單參數那支已於 :41 被 DROP
--     改④ expire_stuck_attempts_at_ceiling    20260615120001:86   ← 全 repo **只有這一支定義它**
--        (查法:`grep -rn 'expire_stuck_attempts_at_ceiling' supabase/migrations/` 命中三檔,
--         另兩檔 20260621120000:17 / 20260624120008:24 都只是**註解裡提到它**、不是定義
--         ⇒ 家訓第 2 條「最後一支改這個簽章」在這支上的答案是 20260615120001;無多載、無 DROP)
--   ⚠️ 改② 那支:活本體與兩版之前在「我要改的那一行」上**逐字相同**,差異在 last_settle_error 的 allowlist
--     (#251 與 L2 各加一個碼)⇒ **引錯版本不會在 diff 上顯形**。必須以活本體全文為底重寫。
--
-- ⚠️ 能力天花板:本片只改「誰會被 claim、誰會被標、誰會被算」,**不動任何錢的狀態**;
--   它讓事故**被看見**,不讓事故**被修好**——修好是 L5b-2(退款)。
-- ⚠️ **「迴圈止住」的範圍(R3-F6;不要讀成全站)**:止的是 **sweeper 那條線**
--   (`claim_stuck_unsettled_attempts` + `expire_stuck_attempts_at_ceiling`)。
--   **B1a `claim_expired_pending_attempts`(20260627120000:88-93)是另一支 claimer**,
--   它的述詞 `status='pending'` + age≥12h + 6h throttle,**明文不濾 manual / 不濾 ceiling / 不濾 superseded**
--   ⇒ 若出現 `superseded` + `pending` 的列(schema 沒禁、正是閘二存在的理由),它仍會每 6h 被重領。
--   誠實邊界:那一族**不會無聲消失**(status='pending' 會走基線 ceiling 閘被標人工、也進改③ 的 pending 那半),
--   殘餘傷害是白打的 Record 呼叫。不在本片治(動 B1a = 第五支 RPC、超片界)⇒ 已認列在 plan §8-9。
-- ⚠️ **告警噪音**:本 use-case 無 per-anomaly 去重(刻意)⇒ 被標人工那族**每輪 cron 重推同一個數字**,
--   自動出口要等 L5b-2(人工出口 `close_released_attempt` 早就有)。apply 當天先數積壓量 ⇒ plan §3.6-1a / §8-10。
--
-- ⛔ apply 停點:commit 後不 apply;apply 由主視窗執行、Sean 批。
--   apply 前置:正式庫**四顆** pre-image md5 現場對(差異是行為就停,是格式才重算常數)。
--   apply 後:read-back 驗(plan §5.1a 四格)。
-- Rollback:見檔尾;🔴 CREATE OR REPLACE 不還原 COMMENT,三支各要配 COMMENT ON。
-- ============================================================


BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';


-- ── 0. 前置閘(fail-closed):pre-image 沒漂移才准覆蓋 ──────────────────
-- 形制與理由同 L5b-0-m:CREATE OR REPLACE 覆蓋已上線函式,若 live 定義已漂移,本片會**靜默蓋掉**它。
-- ⚠️ 四顆 md5 在**本機 PG17.10 Homebrew** 拋棄式叢集量得;綁 pg_get_functiondef 的輸出格式=伺服器版本相依。
--    對不上時先 `SHOW server_version;`:**格式差異可重算常數、行為差異一律停**。
DO $l5b0s_preflight$
DECLARE
  v_md5 text;
  c_md5_c1 constant text := '0ead909ca8710b48c1618794356b153f';  -- 20260624120008:80
  c_md5_c2 constant text := 'e9b64b6123be67f3d3cd619088c2ba7a';  -- 20260809140000:89
  c_md5_c3 constant text := 'd244cb5471dc77dde59f2d2a88f4f86e';  -- 20260701130000:43(三參數)
  c_md5_c4 constant text := 'dd34e120ca53d1c72074a1b123bdc568';                   -- 20260615120001:86(改④ ceiling-expirer)
  -- 🔴 L5b-0-m 的 **post-image** prosrc 指紋(值抄自 20260810170000:657/662/667,不是我自己量的)
  --    —— 這三顆是「-m 到底有沒有上」的判別依據,理由見下方 MF3 段。
  c_m_g1 constant text := '13dfcc0a3c7f8e35b53063ca9babf8e5';  -- 閘一 mark_charge_attempt_charged
  c_m_g2 constant text := 'ca9a7593ca05b2991d295ce93be692f4';  -- 閘二 mark_charge_attempt_charged_fallback
  c_m_g3 constant text := '184204e35edb0dba1b6d4d0909136f3c';  -- 閘三 confirm_order_payment
BEGIN
  -- superseded_at 欄必須存在(三處述詞都讀它)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.payment_charge_attempts'::regclass
       AND attname = 'superseded_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:payment_charge_attempts.superseded_at 不存在 ⇒ L5a-M 未 apply,停下';
  END IF;

  -- 🔴 L5b-0-m 必須先 apply:本片的前提是「被讓路那族永遠不會轉 charged」,
  --    而那件事是 -m 的閘一保證的。-m 沒上就先上本片 = 把還會自然收斂的東西提前趕出對帳集。
  -- 🔴 關卡2 R1-MF3:原本這道閘是 `strpos(pg_get_functiondef(...), 'v_row.superseded_at IS NOT NULL')`
  --    —— **沒剝註解**。也就是說「閘一的述詞被整條刪掉、但那行字還留在函式的註解裡」時,這道閘照樣綠。
  --    存在性斷言對「還在但失效」全盲(memory `feedback_guard-checks-existence-not-effect`)。
  --    ⇒ 改成釘 -m 三支的 **post-image prosrc 指紋**(值直接抄自 -m 檔內 :657/:662/:667)。
  --    prosrc = `$fn$…$fn$` 之間的檔內字面、跨環境穩定(前置閘上面那幾顆用 functiondef 是另一個取捨,
  --    見上方註解;兩者不要混用)。三支一起釘:-m 是三道閘,只釘閘一等於默認另兩道可以不見。
  -- ⚠️ 失效條件(誠實邊界):這三顆常數把「-m 已 apply」定義成「-m 的三支本體逐字就是 -m 當初寫的那版」。
  --    若未來有別片合法地再 REPLACE 它們(例如 L5b-2 動 confirm_order_payment),本片重跑會被這道閘擋下 ——
  --    那是 fail-closed 的**正確**行為(停下人工判斷),不是誤報;屆時對齊的方式是重新抄那片的 post-image 值。
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure)) <> c_m_g1
     OR md5((SELECT prosrc FROM pg_catalog.pg_proc
              WHERE oid = 'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure)) <> c_m_g2
     OR md5((SELECT prosrc FROM pg_catalog.pg_proc
              WHERE oid = 'public.confirm_order_payment(uuid,integer,text)'::regprocedure)) <> c_m_g3 THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:L5b-0-m(20260810170000)三道閘的 post-image prosrc 指紋對不上 ⇒ '
                    '-m 尚未 apply、或它的本體事後被改過 ⇒ 本片的前提不成立,停下。'
                    '實際=[閘一 % / 閘二 % / 閘三 %],期望=[% / % / %]',
                    md5((SELECT prosrc FROM pg_catalog.pg_proc
                          WHERE oid = 'public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure)),
                    md5((SELECT prosrc FROM pg_catalog.pg_proc
                          WHERE oid = 'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure)),
                    md5((SELECT prosrc FROM pg_catalog.pg_proc
                          WHERE oid = 'public.confirm_order_payment(uuid,integer,text)'::regprocedure)),
                    c_m_g1, c_m_g2, c_m_g3;
  END IF;

  -- 🔴 關卡2 R2-MF-A:`prosrc` 只是**函式本體字面**,`SECURITY DEFINER` 與 `SET search_path` 都不在裡面
  --    ⇒ 有人 `ALTER FUNCTION … SECURITY INVOKER`、或拿掉 `SET search_path=''`,上面三顆指紋**照樣全綠**,
  --    而 -m 的三道閘會變成「以呼叫者身分執行」或「名稱解析可被 search_path 劫持」。
  --    指紋管**本體**、這道管**執行語境**,兩道缺一不可。
  -- ⚠️ 誠實邊界:owner 換人本道抓不到(owner 名字跨環境不同、寫死會誤紅);
  --    「owner 換成前台角色構得到的角色」那一種,由本檔 assert 段的 has_function_privilege 有效權限閘接。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.mark_charge_attempt_charged(uuid,uuid,text)'::regprocedure,
                     'public.mark_charge_attempt_charged_fallback(uuid,uuid,text,uuid)'::regprocedure,
                     'public.confirm_order_payment(uuid,integer,text)'::regprocedure)
       AND ( NOT p.prosecdef
             OR p.proconfig IS NULL
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) c
                             WHERE c IN ('search_path=""', 'search_path=')) )
  ) THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:L5b-0-m 三道閘之一已非 SECURITY DEFINER、或 search_path 不再釘空 '
                    '⇒ 本體字面對得上但執行語境已變(prosrc 指紋抓不到這一種),停下人工判斷';
  END IF;

  v_md5 := md5(pg_get_functiondef('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure));
  IF v_md5 <> c_md5_c1 THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:claim_stuck_unsettled_attempts 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。停下人工對齊', v_md5, c_md5_c1;
  END IF;

  v_md5 := md5(pg_get_functiondef('public.mark_attempt_settle_retry(uuid,integer,text)'::regprocedure));
  IF v_md5 <> c_md5_c2 THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:mark_attempt_settle_retry 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。⚠️ 這支被改過三次(4a-2 → R1c1 → #251 → L2),'
                    '活本體在 20260809140000:89;若你手上的 pre-image 來自更早的版本,'
                    '**差異不會出現在要改的那一行**(在 last_settle_error 的 allowlist)。停下人工對齊', v_md5, c_md5_c2;
  END IF;

  v_md5 := md5(pg_get_functiondef('public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure));
  IF v_md5 <> c_md5_c3 THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:get_payment_anomaly_alert_summary(三參數)的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。⚠️ 這支有過**單參數多載**(20260701120000:42),'
                    '已於 20260701130000:41 被 DROP;確認你比對的是三參數那支。停下人工對齊', v_md5, c_md5_c3;
  END IF;

  v_md5 := md5(pg_get_functiondef('public.expire_stuck_attempts_at_ceiling()'::regprocedure));
  IF v_md5 <> c_md5_c4 THEN
    RAISE EXCEPTION 'L5b-0-s 前置閘:expire_stuck_attempts_at_ceiling 的 live 定義與 pre-image 不符。'
                    '實際 md5=% / 期望=%。⚠️ 這支自 20260615120001:86 起**沒有任何一片改過它**'
                    '(R1c1 的〔E〕明文寫「不改本體」)⇒ 對不上代表有人在我取 pre-image 之後動了它,'
                    '本片會靜默蓋掉那個改動。停下人工對齊', v_md5, c_md5_c4;
  END IF;
END
$l5b0s_preflight$;


-- ── 1. 改①:claim 述詞 —— 讓路那族回到 ceiling/manual 閘(pre-image = 20260624120008:80)──
CREATE OR REPLACE FUNCTION public.claim_stuck_unsettled_attempts(
  p_age_seconds integer,
  p_limit       integer
)
RETURNS TABLE(attempt_id uuid, order_id uuid, settle_attempt_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH claimed AS (
    SELECT a.id
      FROM public.payment_charge_attempts a
      JOIN public.orders o ON o.id = a.order_id
     WHERE (
             ( a.status IN ('pending', 'charged')
               AND a.needs_manual_review = false
               AND a.settle_attempt_count < 8 )       -- pending/charged 維持既有 manual/ceiling 閘
             -- 🔴 L5b-0-s 改①(甲):R1c1 讓 released 繞 manual/ceiling,理由是「持續低頻對帳直到 terminal」。
             --    L5b-0 把**被讓路那族的 terminal 拿掉了**(它永遠不會轉 charged)⇒ 對它而言
             --    「繞 ceiling」= 每 16 分鐘一發 TapPay Record API、永不停止。⇒ 這族回到閘內。
             -- ⚠️ **不可以只寫 `OR (released AND superseded_at IS NULL)`**:那樣被讓路那族的 status
             --    是 released、過不了上面 pending/charged 那支 ⇒ **整個落出 claim** ⇒ 永不再被 claim
             --    ⇒ mark_attempt_settle_retry 永不跑 ⇒ 連 12h 的 released_manual_review_at 都不會寫
             --    ⇒ 無聲消失。要的是「回到閘內」不是「排除掉」,所以是三支不是兩支。
             OR ( a.status = 'released'
                  AND a.superseded_at IS NULL )        -- 未讓路的 released:維持 R1c1 繞閘、行為不回歸
             OR ( a.status = 'released'
                  AND a.superseded_at IS NOT NULL      -- 讓路那族:回到 manual/ceiling 閘、8 輪後轉人工
                  AND a.needs_manual_review = false
                  AND a.settle_attempt_count < 8 )
           )
       AND o.payment_status = 'unpaid'::public.payment_status               -- 對所有狀態保留
       AND (a.next_settle_at IS NULL OR a.next_settle_at <= pg_catalog.now()) -- lease/throttle、對所有狀態保留
       AND p_age_seconds >= 0
       AND a.created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_age_seconds) -- age-gate、對所有狀態保留
     ORDER BY a.created_at
     FOR UPDATE OF a SKIP LOCKED
     LIMIT LEAST(GREATEST(p_limit, 1), 1000)
  )
  UPDATE public.payment_charge_attempts a
     SET settle_attempt_count = a.settle_attempt_count + 1,
         next_settle_at = pg_catalog.now() + interval '5 minutes'
    FROM claimed
   WHERE a.id = claimed.id
  RETURNING a.id AS attempt_id, a.order_id AS order_id, a.settle_attempt_count AS settle_attempt_count;
$fn$;

COMMENT ON FUNCTION public.claim_stuck_unsettled_attempts(integer, integer) IS
  'M-3 3DS-4a-2 + R1c1 + M-4b L5b-0-s(甲)改①:原子 lease claim stuck unsettled attempt(FOR UPDATE OF a SKIP LOCKED + LIMIT)。settle_attempt_count++(claim token)+ 5min lease。'
  '濾 **三支**((status IN(pending,charged) AND 非 manual AND settle_attempt_count<8)〔基線 manual/ceiling 閘〕 OR (status=released AND superseded_at IS NULL)〔R1c1:**未讓路**的 released 繞 manual/ceiling、持續低頻對帳直到 terminal〕 OR (status=released AND superseded_at IS NOT NULL AND 非 manual AND settle_attempt_count<8)〔L5b-0-s:**被讓路**的 released 回到 manual/ceiling 閘〕) AND order unpaid(含 charged-unpaid 群1)AND lease 到期 AND created_at < now()-p_age_seconds(p_age_seconds<0/NULL→空、fail-closed)。回 attempt_id/order_id/settle_attempt_count。只 payment_confirmer 可呼。'
  '🔴 為什麼讓路那族要回到閘內:R1c1 讓 released 繞閘的前提逐字是「持續低頻對帳直到 terminal」,而 L5b-0-m 把被讓路那族的 terminal 拿掉了(它永遠不會轉 charged)⇒ 繞閘等於每 16 分鐘一發 TapPay Record API、永不停止、也永遠沒有人被通知。⚠️ 不可以寫成「只排除讓路那族」——那樣它整個落出 claim、連 12h marker 都不會寫 = 無聲消失。'
  '⚠️ 本述詞的 count<8 只管得住「從 0 起跑」的列;**既有 count>=8 的列由 expire_stuck_attempts_at_ceiling 收網**(同片改④),兩者合起來才沒有孤兒。';


-- ── 2. 改②:ceiling→manual 也要涵蓋讓路那族(pre-image = 20260809140000:89)──
CREATE OR REPLACE FUNCTION public.mark_attempt_settle_retry(
  p_attempt_id    uuid,
  p_claimed_count integer,
  p_reason_code   text
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_charge_attempts a
       SET next_settle_at = pg_catalog.now()
             -- 🔴 退避指數先 cap 16 再 power 防 int4 溢位〔R1c1 G、逐字保留〕:released 繞 ceiling → settle_attempt_count
             --    無界(基線 pending/charged 受 count<8 隱含上界不溢位);2^4=16 已達分鐘 cap → 指數 cap 行為等價、純防溢位。
             + pg_catalog.make_interval(mins =>
                 LEAST(pg_catalog.power(2, LEAST(GREATEST(a.settle_attempt_count - 1, 0), 16))::integer, 16)),
           -- 🔴 M-4b L2 唯一改動:allowlist IN(...) 再加 'record_not_found'(TS SWEEP_REASON_CODES 對齊、零 PII 固定碼集)
           last_settle_error = CASE
             WHEN p_reason_code IN ('record_unreachable', 'record_unverified', 'record_not_found', 'auth_or_pending', 'released_failure_observed')
               THEN p_reason_code ELSE 'unknown' END,
           -- ceiling→manual 僅 pending/charged;released 繞 ceiling、不誤標 needs_manual_review(§2.5)〔逐字〕
           -- 🔴 L5b-0-s 改②(甲):ceiling→manual 原本只套 pending/charged(R1c1 刻意讓 released 繞)。
           --    光有改① 的話,被讓路那族會在第 8 輪停止 claim、但 needs_manual_review **永遠不會被設成 true**
           --    ⇒ 那顆 attempt 靜靜掉出對帳,沒有任何人知道。⇒ 條件擴到「或者它是被讓路的」。
           -- ⚠️ `OR` 加在 **status 集合那半邊**,`count >= 8` 維持共用 —— 位置不同語意不同,別搬。
           needs_manual_review = (a.needs_manual_review
                                  OR ( (a.status IN ('pending', 'charged') OR a.superseded_at IS NOT NULL)
                                       AND a.settle_attempt_count >= 8 )),
           -- released 達 12h 仍非 paid → 標 released_manual_review_at(獨立欄、write-once COALESCE、≠ 停止對帳)〔逐字〕
           released_manual_review_at = CASE
             WHEN a.status = 'released'
               AND a.released_at IS NOT NULL
               AND a.released_at <= pg_catalog.now() - interval '12 hours'
               THEN COALESCE(a.released_manual_review_at, pg_catalog.now())
             ELSE a.released_manual_review_at END
      FROM public.orders o
     WHERE o.id = a.order_id
       AND a.id = p_attempt_id
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.status IN ('pending', 'charged', 'released')
       AND a.settle_attempt_count = p_claimed_count
       AND a.needs_manual_review = false
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.mark_attempt_settle_retry(uuid, integer, text) IS
  'M-3 3DS-4a-2 + R1c1 + #251 + M-4b L2 + L5b-0-s(甲)改②:pending outcome 退避 retry。next_settle_at=2^(settle_attempt_count-1) 封頂 16min;**ceiling(>=8)→needs_manual_review 套用於 (status IN(pending,charged) **或** superseded_at 非 NULL)**〔R1c1 原本讓 released 全族繞 ceiling、不誤標 manual;L5b-0-s 把**被讓路**那族收回閘內,**未讓路**的 released 維持繞閘不回歸〕;**released 達 12h(released_at<=now()-12h)→ released_manual_review_at write-once COALESCE(獨立欄、≠ 停止對帳)**;last_settle_error 固定錯誤碼集(零 PII;#251 加 released_failure_observed、M-4b L2 加 record_not_found)。token guard(settle_attempt_count=p_claimed_count + needs_manual_review=false + order unpaid + status IN(pending,charged,released))防 stale/late mark/平行已付款單。不 ++(遞增唯一在 claim)。回 affected(1=已退避、0=no-op)。只 payment_confirmer 可呼。'
  '🔴 沒有改② 的話,被讓路那族會在第 8 輪停止 claim 但旗標永遠不被設 ⇒ 靜靜掉出對帳、沒有人知道。🔴 OR 加在 status 集合那半邊、count>=8 維持共用:位置不同語意不同,別搬。'
  '⚠️ 本函式只在「有人呼它」時才標旗標;claim 完在 mark 之前 crash 的孤兒由 expire_stuck_attempts_at_ceiling 收網(同片改④)。';


-- ── 3. 改③:告警計數要算得到、且結案後要回落(pre-image = 20260701130000:43,三參數)──
CREATE OR REPLACE FUNCTION public.get_payment_anomaly_alert_summary(
  p_refunding_stuck_seconds  integer,
  p_pending_dc_window_seconds integer,
  p_pending_dc_stuck_seconds  integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'open_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'open'),
    'refunding_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'refunding'),
    'refunding_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_double_charge_anomalies
        WHERE status = 'refunding'
          AND refund_claimed_at < pg_catalog.now()
              - pg_catalog.make_interval(secs => GREATEST(0, LEAST(COALESCE(p_refunding_stuck_seconds, 86400), 30 * 24 * 3600)))),
    'oldest_open_age_seconds',
      (SELECT (EXTRACT(EPOCH FROM (pg_catalog.now() - pg_catalog.min(created_at))))::bigint
         FROM public.payment_double_charge_anomalies
        WHERE status = 'open'),
    'attempt_manual_review_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        -- 🔴 L5b-0-s 改③(甲):改①② 讓被讓路那族在第 8 輪被標 needs_manual_review,
        --    但本計數的述詞要求 `status = 'pending'` ⇒ 它是 released、**算不進來**
        --    ⇒ 改①② 做完仍然沒有任何告警會亮。這一改才是讓「轉人工」真的被看見的那一步。
        -- 🔴 terminal 排除(`status IN ('charged','released')`)**不可省**:
        --    close_released_attempt 只把它翻 failed、**不清 needs_manual_review**,而 superseded_at
        --    durable、舊單永遠 unpaid ⇒ 少了這條,**已結案的列會永久留在計數裡**,
        --    第二筆事故的增量淹在底噪 ⇒ 下次災難當天等於沒有訊號。
        --    語意與 L5b-0 閘三同源:只算「仍持有這張單付款權」的那顆 attempt。
        WHERE a.needs_manual_review = true
          AND ( a.status = 'pending'
                OR ( a.superseded_at IS NOT NULL
                     AND a.status IN ('charged', 'released') ) )
          AND o.payment_status = 'unpaid'::public.payment_status),
    'released_stuck_count',
      (SELECT pg_catalog.count(*)
         FROM public.payment_charge_attempts a
         JOIN public.orders o ON o.id = a.order_id
        WHERE a.released_manual_review_at IS NOT NULL
          AND a.status = 'released'
          AND o.payment_status = 'unpaid'::public.payment_status),
    -- 🔴 #256 第 7 計數:pending-based 雙扣候選「組」數(同 user + 同 total + 窗內兩 paid + 其一卡住指紋)。
    'pending_double_charge_candidate_count',
      (SELECT pg_catalog.count(*) FROM (
         SELECT o1.customer_user_id, o1.total
           FROM public.orders o1
           JOIN public.orders o2
             ON o1.customer_user_id = o2.customer_user_id
            AND o1.total            = o2.total
            AND o1.id              <  o2.id
            AND o1.payment_status = 'paid'::public.payment_status
            AND o2.payment_status = 'paid'::public.payment_status
            AND o1.paid_at IS NOT NULL AND o2.paid_at IS NOT NULL
            AND pg_catalog.abs(EXTRACT(EPOCH FROM (o1.paid_at - o2.paid_at)))
                < GREATEST(0, LEAST(COALESCE(p_pending_dc_window_seconds, 43200), 30 * 24 * 3600))
          WHERE EXISTS (   -- 卡住指紋:兩單其一 charged attempt 從結帳到扣款拖 > 門檻(正常秒扣不觸發)
                  SELECT 1
                    FROM public.payment_charge_attempts a
                   WHERE a.order_id IN (o1.id, o2.id)
                     AND a.status = 'charged'
                     AND EXTRACT(EPOCH FROM (a.updated_at - a.created_at))
                         > GREATEST(0, LEAST(COALESCE(p_pending_dc_stuck_seconds, 600), 24 * 3600))
                )
          GROUP BY o1.customer_user_id, o1.total
       ) x)
  );
$fn$;

COMMENT ON FUNCTION public.get_payment_anomaly_alert_summary(integer, integer, integer) IS
  'M-3 #250 雙扣 anomaly 主動告警 + #256 pending-based 雙扣偵測 + M-4b L5b-0-s(甲)改③:owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀聚合計數(零 PII/零金額/零 id)。回 jsonb{open_count,refunding_count,refunding_stuck_count(逾 p_refunding_stuck_seconds 秒、營運參數非 SLA),oldest_open_age_seconds,**attempt_manual_review_count**(needs_manual_review=true AND unpaid AND (status=pending〔sweeper 放棄的 pending 孤兒〕 OR (superseded_at 非 NULL AND status IN(charged,released))〔L5b-0-s:被讓路後轉人工〕)⇒ 🔴 **本計數是兩種事故的聯集、不再只是「pending 孤兒」**;app 端文案已同片改成「sweeper 放棄:pending 孤兒 / 被讓路轉人工」,分辨靠 plan §4 值班查詢),released_stuck_count(released_manual_review_at+released+unpaid、Phase1 producer-gated 0),pending_double_charge_candidate_count(#256:同 user+同 total+兩 paid 單 paid_at 差<p_pending_dc_window_seconds〔預設 12h〕+ 其一 charged attempt updated_at-created_at>p_pending_dc_stuck_seconds〔預設 10min 卡住指紋〕的候選「組」數;候選待查證非已確認、卡住指紋降誤報非零、可與 open 重疊)}。payment_confirmer 對 anomaly 兩表/attempts/orders 零直讀、只 EXECUTE。不動 anomaly 表 grant 與 lifecycle RPC。'
  '🔴 改③ 的兩半各有理由:前半(放寬 status)讓改①②④ 標起來的旗標真的被算到(被讓路那族是 released、原述詞算不到它);後半(terminal 排除)**不可省** —— close_released_attempt 只把列翻 failed、不清 needs_manual_review,而 superseded_at durable、舊單永遠 unpaid ⇒ 少了它,已結案的列會**永久**留在計數裡變成底噪,第二筆事故的增量就看不見了。語意與 L5b-0-m 閘三同源:只算仍持有這張單付款權的那顆 attempt。';


-- ── 4. 改④:ceiling-expirer 也要收讓路那族(pre-image = 20260615120001:86)──
-- 🔴 它治的是改① 的 `count < 8` 治不到的兩種列(檔頭「為什麼是四處不是三處」有完整推導):
--   (a) 本片 apply 之前就已經被讓路、且 count 早就 >8 的**既有列**(released 在 R1c1 之下繞 ceiling、count 無界);
--   (b) claim 完在 markSettleRetry 之前 crash 的孤兒(= 這支函式當初存在的理由,20260615120001:79-84)。
-- 兩者若不收:claim 濾掉(count>=8)⇒ mark 永不跑 ⇒ 旗標永遠 false ⇒ 改③ 的計數恆零 ⇒ 無聲消失照舊。
-- ⚠️ status 分支寫成 `status = 'released' AND superseded_at IS NOT NULL`(**不是**裸 `superseded_at IS NOT NULL`):
--   後者會把已被 close_released_attempt 翻成 `failed` 的**結案列**也標成人工(旗標髒掉、且與改③ 的
--   terminal 排除自相矛盾)。只收「仍持有這張單付款權」的那一族,語意與改③ 同源。
-- ⚠️ lease 條件(`next_settle_at` 到期)逐字沿用:否則 overlap cron 會把「剛 claim、仍在 5min lease 內
--   處理中」的 attempt 提早誤標(20260615120001:83-84)。
CREATE OR REPLACE FUNCTION public.expire_stuck_attempts_at_ceiling()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH upd AS (
    UPDATE public.payment_charge_attempts a
       SET needs_manual_review = true
      FROM public.orders o
     WHERE o.id = a.order_id
       -- 🔴 L5b-0-s 改④(甲):基線只收 pending/charged(R1c1〔E〕:released 繞 ceiling ⇒ 不需要 expire)。
       --    本片改① 把**被讓路**那族送回 ceiling 之內 ⇒ 〔E〕那個理由對這一族失效 ⇒ 它也要能被收網。
       --    未讓路的 released 仍**不**進來(R1c1 行為零回歸)。
       AND ( a.status IN ('pending', 'charged')
             OR ( a.status = 'released' AND a.superseded_at IS NOT NULL ) )
       AND o.payment_status = 'unpaid'::public.payment_status
       AND a.needs_manual_review = false
       AND a.settle_attempt_count >= 8
       AND (a.next_settle_at IS NULL OR a.next_settle_at <= pg_catalog.now())
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM upd;
$fn$;

COMMENT ON FUNCTION public.expire_stuck_attempts_at_ceiling() IS
  'M-3 3DS-4a-2 + M-4b L5b-0-s(甲)改④:attempt ceiling-expirer(claim 前置、防孤兒)。達 ceiling(settle_attempt_count>=8)且 lease 到期、order unpaid、尚未轉人工,且 status 屬 **(pending|charged) 或(released 且 superseded_at 非 NULL)** → 轉 needs_manual_review;回轉換筆數。只 payment_confirmer 可呼。'
  '🔴 L5b-0-s 明文收窄 R1c1〔E〕(20260624120008:24-26「expire 不改本體、由 status 述詞天然排除 released」):那條理由的成立條件是「released 繞 ceiling、永遠不需要 expire」,而本片改① 把**被讓路**那族送回 ceiling 之內 ⇒ 前提失效。**未讓路的 released 仍不被本函式碰**(R1c1 零回歸)。收的是改① 的 count<8 治不到的兩種列:apply 前就 count>8 的既有讓路列、以及 claim 完在 mark 之前 crash 的孤兒。';


-- ── 5. 結構 assert(fail-closed)──────────────────────────────
-- 🔴 判別力來源 = **post-image `prosrc` 指紋**(prosrc 是 $fn$…$fn$ 之間的檔內字面、跨環境穩定;
--    L5b-0-m 的關卡2 用突變+消融實測過:字串錨與位置錨對「述詞被加料」全盲,指紋抓得到)。
--    下面另留兩條**形狀錨**,不是判別力來源,是給人看的:指紋紅的時候要知道紅在哪一種改動。
DO $l5b0s_asserts$
DECLARE v_who text; v_acl text; v_code text; v_role text;
BEGIN
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure))
     <> 'dda1fdbd680632432a22a3f092c4b9ec' THEN
    RAISE EXCEPTION 'L5b-0-s assert:改① claim 的 post-image prosrc 指紋不符 ⇒ 本檔的述詞被改過';
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.mark_attempt_settle_retry(uuid,integer,text)'::regprocedure))
     <> '6c3f81fce0683a4a17ffd83157f02353' THEN
    RAISE EXCEPTION 'L5b-0-s assert:改② mark_attempt_settle_retry 的 post-image prosrc 指紋不符';
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure))
     <> '12a1605c7c9705b1ab1a1c363febbd79' THEN
    RAISE EXCEPTION 'L5b-0-s assert:改③ 告警聚合的 post-image prosrc 指紋不符';
  END IF;
  IF md5((SELECT prosrc FROM pg_catalog.pg_proc
           WHERE oid = 'public.expire_stuck_attempts_at_ceiling()'::regprocedure))
     <> 'a4e1a29b202d75361ae64919f1897d09' THEN
    RAISE EXCEPTION 'L5b-0-s assert:改④ ceiling-expirer 的 post-image prosrc 指紋不符';
  END IF;

  -- 形狀錨(診斷用):四處改動各自的特徵字面要在 code 裡(剝行註解與塊註解後比對)
  v_code := pg_catalog.regexp_replace(
              pg_get_functiondef('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure),
              '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  v_code := pg_catalog.regexp_replace(v_code, '/\*.*?\*/', '', 'gs');
  IF pg_catalog.strpos(v_code, 'a.superseded_at IS NULL') = 0
     OR pg_catalog.strpos(v_code, 'a.superseded_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION 'L5b-0-s assert:改① 的**兩支** released 分支不齊 ⇒ 很可能寫成了「只排除讓路那族」那個錯版本';
  END IF;

  v_code := pg_catalog.regexp_replace(
              pg_get_functiondef('public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure),
              '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  v_code := pg_catalog.regexp_replace(v_code, '/\*.*?\*/', '', 'gs');
  IF pg_catalog.strpos(v_code, 'a.status IN (''charged'', ''released'')') = 0 THEN
    RAISE EXCEPTION 'L5b-0-s assert:改③ 少了 terminal 排除 ⇒ 已結案的列會永久留在告警計數裡、變成底噪';
  END IF;

  v_code := pg_catalog.regexp_replace(
              pg_get_functiondef('public.expire_stuck_attempts_at_ceiling()'::regprocedure),
              '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  v_code := pg_catalog.regexp_replace(v_code, '/\*.*?\*/', '', 'gs');
  IF pg_catalog.strpos(v_code, 'a.status = ''released'' AND a.superseded_at IS NOT NULL') = 0 THEN
    RAISE EXCEPTION 'L5b-0-s assert:改④ 的讓路分支不見 ⇒ 既有 count>=8 的讓路列會被孤兒化(旗標永不設、告警恆零)';
  END IF;

  -- ACL:本片一行都不改權限(allowlist;PUBLIC 顯名、GRANT OPTION 納入字面)
  FOR v_who, v_acl IN
    SELECT p.oid::regprocedure::text,
           COALESCE(string_agg(DISTINCT
                      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                      || ':' || a.privilege_type
                      || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END),
                      ',' ORDER BY
                      (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE g.rolname END)
                      || ':' || a.privilege_type
                      || (CASE WHEN a.is_grantable THEN ':GRANTABLE' ELSE '' END)), '')
      FROM pg_catalog.pg_proc p
      LEFT JOIN LATERAL pg_catalog.aclexplode(p.proacl) a ON a.grantee <> p.proowner
      LEFT JOIN pg_catalog.pg_roles g ON g.oid = a.grantee
     WHERE p.oid IN ('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure,
                     'public.mark_attempt_settle_retry(uuid,integer,text)'::regprocedure,
                     'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure,
                     'public.expire_stuck_attempts_at_ceiling()'::regprocedure)
     GROUP BY p.oid
  LOOP
    IF v_acl <> 'payment_confirmer:EXECUTE' THEN
      RAISE EXCEPTION 'L5b-0-s assert:% 的非 owner grantee 集合=[%],期望恰 [payment_confirmer:EXECUTE]', v_who, v_acl;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure,
                     'public.mark_attempt_settle_retry(uuid,integer,text)'::regprocedure,
                     'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure,
                     'public.expire_stuck_attempts_at_ceiling()'::regprocedure)
       AND p.proacl IS NULL
  ) THEN
    RAISE EXCEPTION 'L5b-0-s assert:四支之一的 proacl 是 NULL(=PUBLIC 預設可 EXECUTE)⇒ REVOKE 不見了';
  END IF;

  -- 🔴 有效權限閘(關卡2 R1-MF4):上面那個 allowlist 只讀**直接 proacl**、而且 `aclexplode` 那行明文
  --    `a.grantee <> p.proowner` 把 owner 排除掉了 ⇒ 有兩條路可以讓 SECDEF 對前台角色可呼、而 allowlist 全綠:
  --      (a) `authenticated`(或 anon/service_role)**繼承** payment_confirmer ⇒ 權限來自成員關係、不在 proacl 裡;
  --      (b) 函式的 **owner 換成** 一個前台角色會員得到的角色 ⇒ owner 的隱含 EXECUTE 被排除在斷言之外。
  --    ⇒ 改用 `has_function_privilege`(它把角色繼承閉包與 PUBLIC 都算進去)逐支逐角色問「實際上呼不呼得到」。
  --    形制沿用本 repo 既有先例 `20260615120001:241-247`(同一支 expirer 當初的 GRANT 自檢就是這樣寫的)。
  -- ⚠️ 這一道與上面的 allowlist **不是重複**:allowlist 抓「有人多 GRANT 了誰」,本道抓「權限從別的路徑漏過來」。
  --    兩者都要:只有 allowlist ⇒ 繼承路徑全盲;只有本道 ⇒ 多 GRANT 給某個不在清單裡的內部角色抓不到。
  FOR v_who IN
    SELECT p.oid::regprocedure::text
      FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure,
                     'public.mark_attempt_settle_retry(uuid,integer,text)'::regprocedure,
                     'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure,
                     'public.expire_stuck_attempts_at_ceiling()'::regprocedure)
  LOOP
    -- payment_confirmer 必須呼得到(正向:防「REVOKE 過頭 ⇒ sweeper/cron 整條啞掉」也被判成綠)
    IF NOT pg_catalog.has_function_privilege('payment_confirmer', v_who, 'EXECUTE') THEN
      RAISE EXCEPTION 'L5b-0-s assert:payment_confirmer 對 % 沒有有效 EXECUTE ⇒ sweeper/告警 cron 會整條啞掉', v_who;
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_function_privilege(v_role, v_who, 'EXECUTE') THEN
        RAISE EXCEPTION 'L5b-0-s assert:角色 % 對 % 有**有效** EXECUTE(直接 GRANT / 角色繼承 / PUBLIC / owner 成員資格 皆算)'
                        ' ⇒ SECURITY DEFINER 受控窗對前台可呼', v_role, v_who;
      END IF;
    END LOOP;
  END LOOP;

  -- 🔴 關卡2 R2-MF-C:上面那圈只問了三個**前台**角色。審查者給的反例是「**別的角色成為 payment_confirmer 的成員**」——
  --    那條路上 proacl 逐字不變(仍是 payment_confirmer:EXECUTE)、三個負測也全綠,但那個角色照樣呼得到。
  --    ⇒ 直接把來源釘死:**payment_confirmer 不得有任何成員**(它是 NOINHERIT 的專用登入角色、
  --    只由 PAYMENT_CONFIRMER_DB_URL 直接登入使用,`20260611120000:62` 建立時就沒有任何 GRANT … TO)。
  --    這比「窮舉所有角色」穩:窮舉在 Supabase 上會被 supabase_admin/authenticator 之類的平台角色誤紅。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members am WHERE am.roleid = 'payment_confirmer'::regrole) THEN
    RAISE EXCEPTION 'L5b-0-s assert:payment_confirmer 有成員 [%] ⇒ 這些角色可繼承它、直接呼得到本片四支 SECDEF RPC,'
                    ' 而 proacl 與三個前台負測都看不出來。停下人工判斷',
                    (SELECT pg_catalog.string_agg(r.rolname, ',' ORDER BY r.rolname)
                       FROM pg_catalog.pg_auth_members am
                       JOIN pg_catalog.pg_roles r ON r.oid = am.member
                      WHERE am.roleid = 'payment_confirmer'::regrole);
  END IF;

  -- 🔴 關卡2 R2-MF-B:與前置閘那道同型 —— 本片四支的 post-image 指紋也只釘**本體字面**。
  --    拿掉 `SECURITY DEFINER` 或 `SET search_path=''`,四顆指紋照樣全綠,但:
  --      非 SECDEF ⇒ 以 payment_confirmer 身分執行、它對 attempts/orders **零表權** ⇒ sweeper 與告警整條啞掉;
  --      search_path 不空 ⇒ 函式內未限定的名稱可被解析劫持。
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
     WHERE p.oid IN ('public.claim_stuck_unsettled_attempts(integer,integer)'::regprocedure,
                     'public.mark_attempt_settle_retry(uuid,integer,text)'::regprocedure,
                     'public.get_payment_anomaly_alert_summary(integer,integer,integer)'::regprocedure,
                     'public.expire_stuck_attempts_at_ceiling()'::regprocedure)
       AND ( NOT p.prosecdef
             OR p.proconfig IS NULL
             OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(p.proconfig) c
                             WHERE c IN ('search_path=""', 'search_path=')) )
  ) THEN
    RAISE EXCEPTION 'L5b-0-s assert:本片四支之一已非 SECURITY DEFINER、或 search_path 不再釘空 '
                    '⇒ 本體指紋對得上但執行語境壞了(指紋抓不到這一種)';
  END IF;
END
$l5b0s_asserts$;

COMMIT;


-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行)
-- 🔴 **四支**都要「函式本體 + COMMENT」兩件一起還原(CREATE OR REPLACE 不還原 COMMENT)。
--   1. claim_stuck_unsettled_attempts       → 回 20260624120008:80-113  + COMMENT 回同檔 :115
--   2. mark_attempt_settle_retry            → 回 20260809140000:89-130  + COMMENT 回同檔 :132
--      🔴 **不是** 20260624120008 那版(那是兩版之前,會倒掉 #251 與 L2 的 last_settle_error allowlist)
--   3. get_payment_anomaly_alert_summary    → 回 20260701130000:43-112(**三參數**)+ COMMENT 回同檔 :114
--   4. expire_stuck_attempts_at_ceiling     → 回 20260615120001:86-105  + COMMENT 回同檔 :107
-- ⚠️ rollback 後被讓路那族會**回到「繞 ceiling、永久低頻對帳」**:迴圈回來、告警又不會亮。
--    ⇒ 若 L5b-0-m 仍在(它會),值班要改回靠 plan §4 的查詢人工盯,別以為有告警。
-- ⚠️ 部分 rollback 的兩種壞法(要嘛四支全還原、要嘛都別動):
--    只還原 ①(claim)留下 ④(expire)⇒ 讓路那族繞 ceiling 又被 expire 標人工 = **假告警**;
--    只還原 ④ 留下 ①  ⇒ 既有 count>=8 的讓路列又變孤兒 = 回到本片要治的病。
-- ============================================================
