-- 20260918040000_m4b_order_payments_comments_fix.sql
-- M-4b · 窗 B(後台, worktree pcm-ops)· 版本號由主視窗 pcm-website-v2-71 指定
-- Sean 2026-09-18 拍甲「五條全改」⇒ 本片是其中的三則 DB COMMENT(④⑤ 是碼註解, 在 commit 2513ebff1)。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════════════
-- 更正三則**活在正式庫裡而今天是假的**說明。🟢 **零行為改動** —— 三句 `COMMENT ON`, 只寫 `pg_description`。
-- 零 CREATE / 零 GRANT / 零 REVOKE / 零 DDL / 零 DML / 零 ALTER OWNER。
--
-- ══ 判準:不是「舊了」, 是【照著它做會做錯事】═══════════════════════════════
-- 這一批的獵物只有那一種。掃描時另有五條「看起來很舊而仍然成立」的, **刻意不動**
-- (它們是本次的對照組 —— 一份「找到 N 條」的清單, 沒有對照組就分不出
--  【真的假了】與【我在挑毛病】)。
--
-- ══ A `order_payments` 的表 COMMENT —— 三句假的, 而第三句我差點漏掉 ═══════
-- ① 舊字面:「在 OP2b 落地之前, 本表由 dormant gate 全擋、**任何列都寫不進來**」
--    🔬 2026-09-18 唯讀正式庫:那道 `%dormant%` CHECK **已經不在**(0 列);
--       本表**有 4 列、三種 rail**(card / cash / bank_transfer), 最近一筆 **2026-09-15**;
--       5 個 trigger 全 `tgenabled='O'`, **含 `order_payments_reversal_amount_bi`** ——
--       **就是它說「還在等」的那一道。**
--    🔴 讀到的人會:以為沖銷金額**沒有人在守**而去重造一道;或以為這張表是死的**不敢用它**。
--
-- ② 舊字面:「非卡軌的退款帳本**目前還不存在** = OP6 的前置」
--    🔬 `order_manual_refunds`(現金 / 匯款登記)與 `order_pending_refunds` **兩張都在**。
--    🔴 讀到的人會:以為那條路還沒蓋 ⇒ **去蓋第二套**。
--
-- ③ 舊字面:「🔴 **零 GRANT** + RLS zero-policy」
--    🔬 `relacl` 攤開 10 列, 含 **`service_role=SELECT`** 與 **`pcm_readonly=SELECT`** ⇒ 不是零 GRANT。
--    🔴🔴 **而這一句我第一次列問題時【漏掉了】** —— 我是用讀的, 讀到前兩句就停了。
--       再讀一次全文才撞到第三句。📌 **同一份文字, 讀兩次給出兩個答案 ——
--       那不是文字變了, 是【讀】本來就不是一把可靠的尺。**
--    🔵 而它同時住在 C(`order_paid_totals_v`)裡 ⇒ **同一片一起更正**, 因為兩則都靠它做安全論證。
--
-- ══ 🎯 A 還要修【那個指向】, 不只是把話講對(主視窗指出)═══════════════════
-- 舊字面句尾逐字:「**詳見 amount 欄的 COMMENT**。」
-- 而 `order_payments.amount` 那一欄 **2026-09-17 板 208(我做的)改成了相反的意思**
-- (「🟢 沖銷金額的反號**已經有 trigger 在守**」)。
-- ⇒ 📌 **一則說明指著另一則說明, 而被指的那則現在說反話。** 而**修欄漏表的是我自己**。
--
-- 🛑 **所以新字面不可以只是「把舊的講對」** —— 那個結構會再壞一次。處置:
--    **本則【只指路、不複述那道保護現在生效了沒】。**
--    ⇒ 🎯 規矩寫進字面裡:**指路可以;指路【順便斷言那個事實的現狀】不可以**
--       —— 那會讓同一件事有兩個**會各自漂移**的來源。
--    🔵 這是板 212/213 那條「一片一句、不共用同一則 COMMENT」的親戚:
--       那條講**兩片改同一則**, 這條講**兩則講同一件事**。同一個病的兩種長法。
--
-- ══ B `order_pending_refunds.settled_at` ═════════════════════════════════════
-- 舊字面:「🛑 **今天零寫入端** —— 消化那一端等 `#787` 解封。」
-- 🔬 **有兩支函式真的在寫它**(精確查過 —— 先分「是 UPDATE SET 還是 WHERE 比對」才算數):
--      `admin_record_manual_refund` ⇒ `UPDATE … SET settled_at = pg_catalog.now(), settled_manual_refund_id …`
--      `admin_void_manual_refund`   ⇒ `UPDATE … SET settled_at = NULL, settled_manual_refund_id = NULL …`
--    🟢 正對照:同一把尺問 `payment_status\s*=` ⇒ **34 支** · ⚪ 負對照 `settled_atZZQ\s*=` ⇒ 0
--    ⚠️ 而「等 #787 解封」也過期 —— 787 早就解封。
-- 🔴 讀到的人會:以為**沒有人在結清待退款** ⇒ 去做第二條結清路徑(會跟現有的打架);
--    或看到一筆 `settled_at` 非空, 以為是髒資料**去清掉**。
--
-- ══ C `order_paid_totals_v` 的 **view** COMMENT ═════════════════════════════════════
-- 舊字面:「底表 `order_payments` **零 GRANT**, 只有 view 擁有者讀得到。**只 GRANT SELECT 給 service_role**。」
-- 🔬 兩句都假(同 A③);本 view 自己的 relacl 也含 `pcm_readonly`。
-- 🔴 **這是一句【安全論證】** —— 有人靠它推「這張表除了 view 沒人碰得到」而據以做權限盤點、
--    或放心把東西塞進去。**那個推論今天不成立。**
-- 🔵 而 `security_invoker=false` 本身**仍然是刻意的、一個字不改** —— 新字面只是把它的
--    **理由**講對(讓 view 以擁有者身分讀底表), 而不是拿「底表沒人讀得到」當理由。
--
-- ══ 影響 ═══════════════════════════════════════════════════════════════════
-- 客人:**完全不會有差別**。員工:**完全不會有差別**。三句只寫 `pg_description`。
-- 鎖:⛔ ~~兩句 `COMMENT ON TABLE` + 一句 `COMMENT ON COLUMN`~~
--    🔴 **2026-09-18 訂正(R1 C1):那句話是假的, 而它就是本片要殺的那個病 ——
--       我把動作從 `COMMENT ON TABLE` 改成 `COMMENT ON VIEW`(見下面那段), 卻沒改描述它的字面。**
--       📌 **在自己這一片的檔頭上犯一次, 比在別人的檔上找到十次更該記。**
--    ✅ 實際是 **1 句 `COMMENT ON TABLE` + 1 句 `COMMENT ON COLUMN` + 1 句 `COMMENT ON VIEW`**,
--       三句各拿 **ShareUpdateExclusive 並持到 COMMIT**(結論不變 —— 三種都拿 SUE)。
--    🔵 SUE **不與 ROW EXCLUSIVE 衝突** ⇒ 收款 / 退款那幾支 RPC 的 DML **不會被擋**;
--       最壞是 `lock_timeout 5s` 當場 abort(fail-closed, 整筆回滾)。
-- 部署時序:🟢 無空窗(零新物件、零簽章變動、**本片沒有任何碼**)。
--    🔴 而**什麼時候貼**照 CLAUDE.md〈貼板與推的順序〉第二條:跟本次程式無關的板 ⇒
--       **等推 main 那一發跑完再貼**(帳本閘 ⑦ 平台孤兒會擋)。
--
-- ══ 🔵 pcm_acl_approve_latest:不用跑(判過的, 不是漏掉)═══════════════════
-- 整支檔零權限語句, `COMMENT ON` 只寫 `pg_description`, 不碰 `relacl` / `proacl`
-- ⇒ 每日摘要那把尺讀不到本片。
-- 🔬 ⛔ ~~而後置閘**有把 order_payments 的 relacl 釘住**, 不是用講的。~~
--    🔴 **R2 consider-3 訂正:我改了那道閘, 沒改描述它的這句話 —— C1 的形狀在同一支檔裡第二次。**
--    ✅ 實際:後置**比對本片前後的 relacl 列數**(③a)+ **具名釘 service_role 的 SELECT 存在**(③b)。
--       那兩件加起來**不是**「把 relacl 釘住」。⚠️ 而「不用跑 pcm_acl_approve_latest」這個結論不變 ——
--       它真正的論據是**整支檔零權限語句**(靜態就看得出來), 上面那句只是附帶。
--
-- ══ 還原 ═══════════════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260918040000-rollback.sql` —— 三則都退, 每則前置只收「本片寫上去的那一版」。
-- 🔴 **不用先退碼** —— 本片沒有任何碼。hash 由 **follow-up commit** 補進還原檔檔頭, **不要 `--amend`**。
-- 🛑 **本片改的三則, 沒有任何一則是別片也在改的** —— 若日後有第二片要改它們,
--    那一片要先讀板 212/213 還原檔檔頭那段(共用一則 COMMENT 會靜靜弄死前一片的還原檔)。

-- ══ 🔴 一個【靜態閘抓不到、真跑當場紅】的坑, 記在這裡 ═══════════════════════
-- 我第一版對 `order_paid_totals_v` 寫的是 `COMMENT ON TABLE`。
-- 🔬 拋棄式 PG 17.10 實跑 ⇒ **`ERROR: "order_paid_totals_v" is not a table`** ——
--    PG 對 view **不吃 `COMMENT ON TABLE`**, 要 `COMMENT ON VIEW`。
-- ⇒ 📌 **那會在正式庫當場炸**, 而八道靜態檢查 / typecheck / lint **一個都不會叫**
--    (它們看的是字面形狀, 不是「這個物件是不是那個 kind」)。
-- ⇒ 🎯 **這是本週第三次「只有真跑才抓得到」**(板 208 的自我比對、板 212 的 `position(x IN y)`、本片)。
--
-- 🔴 **而同一發真跑抓到第二個**:本檔是用 python f-string 產的, 而 f-string **不處理 `%`**
--    ⇒ 我寫的 `%%` **原封不動落進 SQL**:
--      · `RAISE ... '(%%)', v` ⇒ PL/pgSQL 把 `%%` 當【一個字面的 `%`】⇒ 沒有佔位符而有 1 個參數
--        ⇒ **`ERROR: too many parameters specified for RAISE`**
--      · `LIKE '%%dormant%%'` ⇒ 變成「找字面 `%dormant%`」⇒ **永遠找不到** ⇒ 那道閘**靜靜不叫**
--    ⇒ 📌 **前者當場紅、後者【完全不會紅】** —— 而它們是同一個手滑。
--       🛑 **一個會紅的錯誤救了一個不會紅的錯誤** ——
--          `RAISE` 那個炸掉, 我才回頭看 `LIKE` 那個。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 前置閘 ────────────────────────────────────────────────────────────────
-- 🔴 一律 `IS DISTINCT FROM`, **不用 `NOT IN`** —— `obj_description` 在說明被刪掉時回 NULL,
--    而 `NULL NOT IN (a,b)` = NULL ⇒ `IF` 不成立 ⇒ **閘不叫、照放行**(板 213 R2 抓過)。
DO $pre$
DECLARE vA text; vB text; vC text; v_att smallint;
BEGIN
  IF pg_catalog.to_regclass('public.order_payments') IS NULL
     OR pg_catalog.to_regclass('public.order_pending_refunds') IS NULL
     OR pg_catalog.to_regclass('public.order_paid_totals_v') IS NULL THEN
    RAISE EXCEPTION '前置閘①:三個物件不是都在 ⇒ 這個庫不是我以為的那個 ⇒ 停下';
  END IF;

  SELECT a.attnum INTO v_att FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_pending_refunds'::pg_catalog.regclass
     AND a.attname='settled_at' AND a.attnum>0 AND NOT a.attisdropped;
  IF v_att IS NULL THEN
    RAISE EXCEPTION '前置閘①b:order_pending_refunds.settled_at 這一欄不存在(被 drop 或 rename)⇒ 停下';
  END IF;

  vA := pg_catalog.md5(pg_catalog.obj_description('public.order_payments'::pg_catalog.regclass,'pg_class'));
  vB := pg_catalog.md5(pg_catalog.col_description('public.order_pending_refunds'::pg_catalog.regclass, v_att));
  vC := pg_catalog.md5(pg_catalog.obj_description('public.order_paid_totals_v'::pg_catalog.regclass,'pg_class'));

  IF vA IS DISTINCT FROM 'ff2476c8ee366ccd441fc8a481f61dfe' AND vA IS DISTINCT FROM '5770d6dac1810330840696893d011198' THEN
    RAISE EXCEPTION '前置閘②A:order_payments 表 COMMENT(%)既不是貼前的 ff2476c8ee366ccd441fc8a481f61dfe 也不是本片要寫的 ⇒ 有人先改過(或它被刪掉了)⇒ 拒繼續', COALESCE(vA,'(沒有 COMMENT)');
  END IF;
  IF vB IS DISTINCT FROM '47cb57acafafa7c6024018411e77f922' AND vB IS DISTINCT FROM '43fb65d5fe799078d4f8f44ce33346f6' THEN
    RAISE EXCEPTION '前置閘②B:settled_at 欄 COMMENT(%)既不是貼前的 47cb57acafafa7c6024018411e77f922 也不是本片要寫的 ⇒ 拒繼續', COALESCE(vB,'(沒有 COMMENT)');
  END IF;
  IF vC IS DISTINCT FROM '3c02b85166773cb17a08acca715e226f' AND vC IS DISTINCT FROM '773a49aa09a4f585c2ef1c1377342290' THEN
    RAISE EXCEPTION '前置閘②C:order_paid_totals_v 的 view COMMENT(%)既不是貼前的 3c02b85166773cb17a08acca715e226f 也不是本片要寫的 ⇒ 拒繼續', COALESCE(vC,'(沒有 COMMENT)');
  END IF;

  -- ③ 🔵 **本片論證所依賴的那三件事, 現在還成立嗎** —— 它們是新字面裡的【事實宣稱】,
  --    而一支把事實寫死進 COMMENT 的片, 必須在寫之前再確認一次那些事實。
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint con
               JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
               JOIN pg_catalog.pg_namespace n2 ON n2.oid=c.relnamespace
              WHERE n2.nspname='public' AND c.relname='order_payments' AND con.conname LIKE '%dormant%') THEN
    RAISE EXCEPTION '前置閘③a:order_payments 上那道 dormant CHECK 又出現了 ⇒ 新字面「它已經不在」會是假的 ⇒ 停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                   JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
                   JOIN pg_catalog.pg_namespace n3 ON n3.oid=c.relnamespace
                  WHERE n3.nspname='public' AND c.relname='order_payments'
                    AND t.tgname='order_payments_reversal_amount_bi' AND t.tgenabled='O') THEN
    RAISE EXCEPTION '前置閘③b:order_payments_reversal_amount_bi 不在或沒啟用 ⇒ 新字面會是假的 ⇒ 停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
                        LATERAL pg_catalog.aclexplode(c.relacl) a
                  WHERE n.nspname='public' AND c.relname='order_payments'
                    AND a.grantee=pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type='SELECT') THEN
    RAISE EXCEPTION '前置閘③c:order_payments 上找不到 pcm_readonly 的 SELECT ⇒ 新字面「不是零 GRANT」會是假的 ⇒ 停下';
  END IF;

  -- ③d/③e 🔴 **R1 C4:前置閘③ 原本只守 A —— 而 B 與 C 的新事實【零閘】。**
  --    那不是理論的:本片檔頭自己說要**等推 main 那一發跑完才貼**
  --    ⇒ 我量到那三件事的時刻與它們被寫進 COMMENT 的時刻之間, 有一段真實的時差。
  --    📌 **我只在 A 那一邊守了** —— 補上。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                   JOIN pg_catalog.pg_namespace n4 ON n4.oid=p.pronamespace
                  WHERE n4.nspname='public' AND p.proname='admin_record_manual_refund'
                    AND p.prosrc ~ 'settled_at\s*=')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                   JOIN pg_catalog.pg_namespace n5 ON n5.oid=p.pronamespace
                  WHERE n5.nspname='public' AND p.proname='admin_void_manual_refund'
                    AND p.prosrc ~ 'settled_at\s*=') THEN
    -- 🛑 R2 nit-1:這道量的是「body 裡出現過 settled_at=」, **不是**「它在寫 settled_at」——
    --    `WHERE settled_at = x` 或註解裡留一句都會過。今天四種假陽性都打不出來
    --    (實查 20260916130000:364 / :557 是真的 SET, 其餘是 `IS NULL`), 而**訊息要說量得到的話**。
    RAISE EXCEPTION '前置閘③d:那兩支函式不在, 或它們的 body 裡已經沒有 settled_at 的賦值字面 ⇒ B 的新字面會是假的 ⇒ 停下';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n6 ON n6.oid=c.relnamespace,
                        LATERAL pg_catalog.aclexplode(c.relacl) a
                  WHERE n6.nspname='public' AND c.relname='order_paid_totals_v'
                    AND a.grantee=pg_catalog.to_regrole('pcm_readonly') AND a.privilege_type='SELECT') THEN
    RAISE EXCEPTION '前置閘③e:order_paid_totals_v 上找不到 pcm_readonly 的 SELECT ⇒ C 的新字面會是假的 ⇒ 停下';
  END IF;

  -- 🔵 把「本片執行前的 relacl 列數」記下來 ⇒ 後置比同一個數(見後置負對照③a)
  PERFORM pg_catalog.set_config('pcm.op_relacl_pre',
    (SELECT count(*) FROM pg_catalog.pg_class c
       JOIN pg_catalog.pg_namespace n7 ON n7.oid=c.relnamespace,
            LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE n7.nspname='public' AND c.relname='order_payments')::text, true);

  IF vA = '5770d6dac1810330840696893d011198' THEN
    RAISE NOTICE '🔵 前置閘:本片【已經貼過】⇒ 這是重跑, 下面三句會寫上逐字相同的內容。';
  ELSE
    RAISE NOTICE '✅ 前置閘全過(A % / B % / C %), 而新字面依賴的三件事也複查過了', vA, vB, vC;
  END IF;
END
$pre$;

-- ── 2. 動作(本片唯一會改變資料庫的三句) ───────────────────────────────────
COMMENT ON TABLE public.order_payments IS 'OP1 收款帳本(master-plan v2 :655 第 3 批第 1 項)。記的是**收款流入 + 對它的沖銷更正**。🔵 沖銷列的金額規則由 **amount 欄的 COMMENT** 定義 —— 🛑 **本則【只指路、不斷言那道保護的生效狀態】**:20260918040000 之前這裡兩件事一起做, 結果 09-17 板 208 改了 amount 欄的生效狀態而本則沒跟上, 於是**指標與被指的那則互相矛盾**。📌 規矩(2026-09-18 立):**指路可以;指路【順便斷言那道保護現在生效了沒】不可以** —— 那個狀態會變, 而兩份副本會各自漂移。(規則本身寫在哪一則都行, 但**現在式的狀態只能有一份**。)**退款不在本表**, 照 rail 分流到別的機制:卡 = order_refunds / TapPay refund job;匯款與現金 = order_manual_refunds(登記)與 order_pending_refunds(待退款)。🔴 **「已收未退總額」要跨源算** —— 不要拿本表單表當「已收未退」。🔴 本表是 A8b partiallyPaid 上限與退款分軌的唯一事實來源。RLS zero-policy;寫入一律走具名 SECDEF RPC。RLS 擋不住 service_role(BYPASSRLS)⇒ 真防線是 ACL 與金鑰保密。🔴 跨單餘額 / wallet 體系**明確不碰**(Q-C=A:留抵 = 同單折抵)。⛔ 20260918040000 更正的三句舊字面(留著不刪):① 「在 OP2b 落地之前, 本表由 dormant gate 全擋、**任何列都寫不進來**」⇒ 假(2026-09-18 唯讀實查):那道 CHECK 已經不在, 而 card / cash / bank_transfer 三種 rail 都有真實列寫進來;② 「非卡軌的退款帳本**目前還不存在**」⇒ 假:order_manual_refunds 與 order_pending_refunds 兩張都在;③ 「**零 GRANT**」⇒ 假(2026-09-18 唯讀實查):本表 relacl 含 service_role=SELECT 與 pcm_readonly=SELECT。🔴 ③ 那句同時住在 order_paid_totals_v 的 COMMENT 裡, 同一片一起更正 —— 兩則都靠它做安全論證。';

COMMENT ON COLUMN public.order_pending_refunds.settled_at IS '這筆待退款什麼時候被真的退掉了。🔵 **寫入端(2026-09-18 唯讀正式庫實查)**:admin_record_manual_refund(登記人工退款時 SET settled_at = now() 並填 settled_manual_refund_id)與 admin_void_manual_refund(作廢時把兩欄清回 NULL)。🔴 而寫它的人必須先重算(見 amount_at_cancel 那一欄), 不得直接把 amount_at_cancel 當應退金額。⛔ 20260918040000 更正的舊字面(留著不刪):「🛑 **今天零寫入端** —— 消化那一端等 #787 解封。它現在就存在的理由是【值域要一次定義完】, 不是它壞了。」⇒ 假:#787 早就解封, 而上面那兩支函式真的在寫它。📌 讀到舊字面的人會以為【沒有人在結清待退款】⇒ 去做第二條結清路徑(會跟現有的打架), 或看到一筆 settled_at 非空以為是髒資料去清掉。';

COMMENT ON VIEW public.order_paid_totals_v IS '#841:每張訂單的帳本已收淨額(直接加總 amount, 沖銷列為負)。security_invoker=false 是刻意的 —— 讓本 view 以擁有者身分讀底表, 讀本 view 的人不需要底表權限。🔴 **而【不要】把它讀成「底表沒有人讀得到」**:2026-09-18 唯讀實查, order_payments 的 relacl 含 service_role=SELECT 與 pcm_readonly=SELECT;本 view 自己也給了這兩個角色。⛔ 20260918040000 更正的舊字面(留著不刪):「底表 order_payments **零 GRANT**, 只有 view 擁有者讀得到。**只 GRANT SELECT 給 service_role**。」⇒ 兩句都假。📌 那是一句**安全論證** —— 有人會靠它推「這張表除了 view 沒人碰得到」而據以做權限盤點或放心塞東西進去, 而那個推論今天不成立。同一句也住在 order_payments 的表 COMMENT 裡, 同一片一起更正。';

-- ── 3. 後置斷言 + 負對照 ─────────────────────────────────────────────────────
DO $post$
DECLARE v_att smallint;
BEGIN
  SELECT a.attnum INTO v_att FROM pg_catalog.pg_attribute a
   WHERE a.attrelid='public.order_pending_refunds'::pg_catalog.regclass AND a.attname='settled_at'
     AND a.attnum > 0 AND NOT a.attisdropped;   -- 🔵 R1 N4:與本檔前置閘同一組條件, 原本兩邊不一致

  IF pg_catalog.md5(pg_catalog.obj_description('public.order_payments'::pg_catalog.regclass,'pg_class'))
     IS DISTINCT FROM '5770d6dac1810330840696893d011198' THEN
    RAISE EXCEPTION '後置閘A:order_payments 表 COMMENT 換上去的不是本片打算寫的 ⇒ 拒 COMMIT';
  END IF;
  IF pg_catalog.md5(pg_catalog.col_description('public.order_pending_refunds'::pg_catalog.regclass, v_att))
     IS DISTINCT FROM '43fb65d5fe799078d4f8f44ce33346f6' THEN
    RAISE EXCEPTION '後置閘B:settled_at 欄 COMMENT 換上去的不是本片打算寫的 ⇒ 拒 COMMIT';
  END IF;
  IF pg_catalog.md5(pg_catalog.obj_description('public.order_paid_totals_v'::pg_catalog.regclass,'pg_class'))
     IS DISTINCT FROM '773a49aa09a4f585c2ef1c1377342290' THEN
    RAISE EXCEPTION '後置閘C:order_paid_totals_v 的 view COMMENT 換上去的不是本片打算寫的 ⇒ 拒 COMMIT';
  END IF;

  -- 🔵 負對照①:**被指的那一則(amount 欄)本片一個字都不該碰。**
  --    📌 這一格特別重要 —— 本片整篇在講「指標與被指的那則互相矛盾」,
  --       而**最難看的收尾就是順手把被指的那則也改了**。
  IF pg_catalog.md5(pg_catalog.col_description('public.order_payments'::pg_catalog.regclass,
       (SELECT a.attnum FROM pg_catalog.pg_attribute a
         WHERE a.attrelid='public.order_payments'::pg_catalog.regclass AND a.attname='amount')))
     IS DISTINCT FROM '83193f5fc7eab104b1abc5dd26139186' THEN
    RAISE EXCEPTION '🔴 負對照①失敗:order_payments.amount 欄的 COMMENT 被動過 ⇒ 本片不該碰它 ⇒ 拒 COMMIT';
  END IF;
  -- 🔵 負對照②:settled_at 的【母表】COMMENT 也不該被碰(本片只動那一欄)
  IF pg_catalog.md5(pg_catalog.obj_description('public.order_pending_refunds'::pg_catalog.regclass,'pg_class'))
     IS DISTINCT FROM '3967a6c1e353824faa8a94358d9dcb97' THEN
    RAISE EXCEPTION '🔴 負對照②失敗:order_pending_refunds 的表 COMMENT 被動過 ⇒ 本片只動 settled_at 那一欄 ⇒ 拒 COMMIT';
  END IF;
  -- 🔵 負對照③:本片不該動到任何權限
  --    ⛔ ~~原本釘「relacl 剛好 10 列」~~ 🔴 **R1 C5 打穿了那個寫法, 三條都成立**:
  --      ① 本片整支檔**零 ACL 語句** ⇒ 那道閘**只可能被第三方漂移點燃** ——
  --         它是漂移偵測器, 而我掛了「負對照」的名字。
  --      ② **10 這個數字綁 PG 版本**:8 格 owner 權限裡的 `m`(MAINTAIN)是 **PG 17 才有的**
  --         ⇒ 同樣的授權在 PG 16 會攤成 9。
  --      ③ **它對「補償式互換」是瞎的**:有人同時 REVOKE service_role 又 GRANT authenticated
  --         ⇒ count 仍是 10、③c 也過, 而新字面裡「含 service_role=SELECT」當下已經是假的。
  --      📌 **一支專門修假說明的片, 用一把只量列數、量不到內容的尺去守它的說明。**
  --    ✅ 改成兩件各自該做的事:
  --      (a) 「本片沒動權限」⇒ 前置算一次、後置比同一個數(量的才是**本片**)
  --      (b) 「新字面那兩個 grantee 真的在」⇒ 各自具名釘存在(不靠總數推)
  --    🛑 **而 (a) 的射程講明, 不假裝它被打過**:我打不出「交易中途外部改權限」那個世界
  --       (單一交易裡外面改不進來)⇒ 拋棄式 PG 只證得到**它不誤擋**, **證不到它會叫**。
  --       ⇒ 📌 它擋的是「本片自己的語句動了權限」, 而本片整支零 ACL 語句 ⇒ 今天它是一道
  --          **結構上不可能被本片點燃**的閘。留著是為了「哪天有人往本片加一句 GRANT」。
  IF (SELECT count(*) FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
             LATERAL pg_catalog.aclexplode(c.relacl) a
       WHERE n.nspname='public' AND c.relname='order_payments')::text
     IS DISTINCT FROM pg_catalog.current_setting('pcm.op_relacl_pre', true) THEN
    RAISE EXCEPTION '🔴 負對照③a 失敗:order_payments 的 relacl 列數在本片執行前後不一樣(前 % / 後 %)⇒ 本片不該碰權限 ⇒ 拒 COMMIT',
      pg_catalog.current_setting('pcm.op_relacl_pre', true),
      (SELECT count(*) FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
              LATERAL pg_catalog.aclexplode(c.relacl) a
        WHERE n.nspname='public' AND c.relname='order_payments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                   JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace,
                        LATERAL pg_catalog.aclexplode(c.relacl) a
                  WHERE n.nspname='public' AND c.relname='order_payments'
                    AND a.grantee=pg_catalog.to_regrole('service_role') AND a.privilege_type='SELECT') THEN
    RAISE EXCEPTION '🔴 負對照③b 失敗:order_payments 上找不到 service_role 的 SELECT ⇒ 新字面③ 會是假的 ⇒ 拒 COMMIT';
  END IF;

  RAISE NOTICE '✅ 後置閘 + 三道負對照全過';
END
$post$;

COMMIT;
