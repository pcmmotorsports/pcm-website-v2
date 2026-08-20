-- ============================================================
-- M-4b · 片 D2 —— **開權**(給 `admin_record_manual_refund` 開 EXECUTE)
--
-- 前一片:`20260820021000` D1(`e32a9a6b`)建了登記 RPC 而**刻意零 GRANT**。
-- 本片把那道分期開權的第二段補上:**翻轉 ACL 極性(零 → service_role only)**。
--
-- ── 🔴 本片【不做】沖銷 RPC —— 而那不是省略,是它在這張表上做不出來 ────────────
--   `W1-081` §2 原本要 D2 照 `20260810210000`(opa12)做「沖銷列(同單同軌、**金額為被沖列反號**)」。
--   而那個做法靠**兩個**機制,`order_manual_refunds` **兩個都沒有**:
--     `20260810100000:199`  order_payments.amount   CHECK (amount <> 0)        ← 允許負數
--     `20260810100000:201`  order_payments.reverses_payment_id                  ← 指向被沖列
--     `20260820010000:167`  order_manual_refunds.refund_amount CHECK (> 0)      ← 🔴 負數不可能
--     該表八欄(+ D1 加的 request_id)**沒有** reverses 那一欄
--   🔴 **而「改用正數列表示沖銷」會少退錢給客人**(實查,不是推的):
--     `pcm_order_refundable_remaining`(`20260820010000:246-249`)第三段**無條件** SUM 本表全部列,
--     而同函式 `:244` 逐字「本表**沒有 status** ⇒ 沒有值域可篩 ⇒ **全部列一律計入**」
--     ⇒ 一筆「意在取消前一筆」的正數列會被算成**又退了一筆** ⇒ 可退餘額多扣
--     ⇒ 而那個輸出**後台退款發起入口的閘在吃**(該函式 COMMENT 逐字)
--     ⇒ ⇒ **客人少拿錢,而畫面正常。壞在錢的方向,而且無聲。**
--
--   ⇒ **主視窗與 W1 各自裁定「甲」**(2026-08-20):D2 只做開權,沖銷另議。
--     決定性理由:要讓沖銷成立,`pcm_order_refundable_remaining` **必須跟著改**(否則正負不相消),
--     而它是 `#473b-1` 重複退款防線的核心、自帶 apply 期指紋斷言
--     ⇒ **拿一個已驗過的防護去換一個還沒設計完的功能,在鐵則 12① 底下不成立。**
--
-- ── ⚠️ 甲 留下的缺口,寫在這裡而不是留給人記得 ──────────────────────────────
--   🔴 **在沖銷片落地之前,一筆登記錯的退款【改不掉】**(表零 UPDATE 路徑、零寫入 GRANT)。
--     ⚠️ 措辭是 W1 收窄過的:**不是「永久」** —— 沖銷片一落地就更正得了。
--        「永久」是一個沒有時間座標的詞,會被讀成「這個設計放棄了更正」。
--   `20260820010000:75` 那個**具名缺口**(逐字「一筆現金退款登記錯了怎麼辦?本表現在答不出來」)
--   ⇒ **本片刻意不解決它。** 要解決它得付的代價寫在上面(動 `pcm_order_refundable_remaining`)。
--   ⇒ 追蹤:backlog `#787`。
--   🔴 **而「在沖銷片落地之前」這個說法不是一個承諾**(W5 R1 打到:它會被讀成「沖銷片一定會做」)
--     ⇒ 換成一個**可驗的分岔**:**若沖銷片最後決定不做 ⇒ 這張表的【登記入口】就不該上線。**
--     ~~二者擇一,沒有第三條路~~ 🔴 **收窄(W5 R2 nit-3:那是全稱句,一個反例就翻)**:
--     **我想不到第三條**,而 W5 當場舉了一條我沒想到的 —— 例如「只允許登記【等於可退餘額全額】
--     + 當日可撤」,那也讓「登記錯了改不掉」到不了。
--     ⇒ 所以正確的說法是:**上面兩條是我知道的兩條;第三條若存在,它要證明的是同一件事**
--       ——「可以登記」與「登記錯了改不掉」不同時成立。
--
--   🔴 **而這個「可接受」的判斷有一個依據,它會過期**(W1 裁定,W4 獨立重跑):
--     `grep -rn --include='*.ts' --include='*.tsx' 'admin_record_manual_refund' packages apps | wc -l` ⇒ **0**
--     正向對照 `admin_record_manual_payment` ⇒ **16**(尺是活的)
--     ⇒ 登記 RPC **目前沒有任何 app 呼叫端** ⇒ 那個窗口理論上開著、**而實際到不了**
--     ⇒ ⇒ **哪天它變成 1,這個判斷就作廢。**
--   ⇒ 所以封印**不在本片、也不在任何一封信裡**:**登記畫面那一片**必須自帶前置閘
--     (沖銷 RPC 可呼叫),形狀照片 A 的閘二 —— 驗「能不能用」不是「存不存在」。
--
-- ── 🔴 與 op5 先例的【明文偏離】(不寫出來的話,下一個人比對會以為漏了)────────
--   `20260810200000:44-46` 逐字要求開權那片同片做完三件:
--     ① `GRANT EXECUTE` 給**兩支**(登錄 + 沖銷)② 翻轉 ACL 極性 ③ 補 `has_function_privilege` 的**有效權限**斷言
--   ⇒ 本片:**① 降成【一支】**(沖銷 RPC 不存在,見上)、**②③ 照舊,一件都沒省**。
--   🔴 而 ③ 對片 A 特別重要:片 A 的前置閘二(`20260820030000:241`)吃的就是 `has_function_privilege`
--     的結果 ⇒ **本片是那道閘由假轉真的唯一原因**。
--
-- ── ⚠️ 驗證的效度限定(W5 R1 打穿的那一格,寫在這裡不要靠人記得)──────────────
--   六發表演的 D1 是**逐字同簽章的 stub**(含它的兩道 REVOKE),因為 D1 的自測需要既有訂單與 staff、
--   空庫套不進去。對 `has_function_privilege` 與 `proacl` 而言函式體不影響判斷 —— 而 W5 打穿一格:
--   🔴 **stub 換得掉 `proowner`**,而下面 §2② 的斷言逐字就是 `a.grantee <> p.proowner`。
--     我的 stub 由**我的 session** 建、正式庫的 D1 由 **apply 的那個身分**建
--     ⇒ 兩者 owner 不同時,**我在本機驗過的那一格,不等於正式庫的行為**。
--   ⇒ **「owner 相同」是我沒驗的前提。** 不擴張成「已驗」。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**。apply 要 Sean 在場,且**必須在 D1 之後**(§0 斷言會擋)。
-- ============================================================

BEGIN;

-- ══ 0. 前置閘:D1 必須已落地,而且極性必須還是【零】═══════════════════════════
DO $$
DECLARE
  v_fn oid;
BEGIN
  -- ① D1 在不在。🔴 先判存在再問權限 —— `has_function_privilege` 對**不存在**的函式是 **throw**
  --    (實測 PG17,2026-08-20),不是回 false ⇒ 少了這一格,「D1 沒套」會給一句 PG 原文,
  --    而本片精心寫的訊息不會出現。(同形狀:片 A `20260820030000:236` 也先判存在。)
  v_fn := pg_catalog.to_regprocedure(
    'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'D2 前置閘:登記 RPC admin_record_manual_refund 不存在 ⇒ **D1 尚未 apply**。'
                    '本片只做開權,沒有那支函式就沒有東西可開。先套 20260820021000 再回來';
  END IF;

  -- ①-b 🔴 **role 也要先判存在**(W5 R1 nit-2):`has_function_privilege` 對**不存在的 role**
  --    吐 `42704` PG 原文 ⇒ 與 ① 的症狀逐字相同,而下面那些精心寫的訊息一句都不會出現。
  --    我為**函式**做了這件事,同一條理由對 **role** 一樣成立 —— 而我原本漏了。
  --    repo 前例:`20260811060000:81` 逐字 `IF pg_catalog.to_regrole('payment_confirmer') IS NULL THEN`。
  --    ⚠️ 誠實邊界:`42704` 這個碼是 **W5 讀出來的、兩人都沒實跑**;而「先判存在」本身不依賴那個碼對不對。
  IF pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('authenticator') IS NULL THEN
    RAISE EXCEPTION 'D2 前置閘:service_role / anon / authenticated / authenticator 至少一個不存在 ⇒ '
                    '這不是 Supabase 的標準佈局,本片的權限斷言在這個環境沒有意義;拒繼續';
  END IF;

  -- ② 🔴 **先驗「底破了沒」,再驗「開過了沒」**(W5 R1 nit-4:順序讓最危險那格被蓋掉)。
  --    兩者同時為真時,若先報「已套過」,值班就**不會知道底是破的** —— 而那是比較嚴重的那一件。
  --    anon/authenticated 在 D1 之後就該是零(D1 自己 REVOKE 過)。
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'D2 前置閘:anon/authenticated 對登記 RPC 有 EXECUTE ⇒ D1 的兩道 REVOKE 沒生效;'
                    '拒繼續(不要在一個已破的底上開權)';
  END IF;

  -- ③ 極性必須還是【零】—— 這一格同時是「開之前呼不到」的證據,而它跟著 migration 走。
  -- 🔴 而訊息**給得出判別命令**(W5 R1 MF-2):原版把「已套過」與「有人手動 GRANT」並列,
  --    而值班會挑成本低的那個解釋 ⇒ 一個真正的權限事件會被當成「重跑而已」略過。
  --    ⚠️ 那條命令的表名/欄位 **W5 與我都沒有在正式庫實跑過**(repo 內 12 支檔提到那張表)
  --       ⇒ 訊息裡標成「查法」而不是「事實」,而**第二條查法(APPLIED.tsv)是我們自己的可查帳、一定在**。
  IF has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'D2 前置閘:service_role **已經**呼得到登記 RPC。兩種可能,而處置完全不同 —— '
                    '請先分辨,不要直接重跑:'
                    '① 本片已套過(forward-only)⇒ 查 `supabase/APPLIED.tsv` 有沒有 20260820022000 那一列;'
                    '或查 `supabase_migrations.schema_migrations` 有沒有 version = 20260820022000。'
                    '② **兩處都查無、而 EXECUTE 卻已經在** ⇒ 有人在 D1 與本片之間手動 GRANT 過 '
                    '⇒ **那是鐵則 12② 的權限事件,不是重跑**,請當成事件查';
  END IF;

  RAISE NOTICE 'D2 前置:登記 RPC 存在、service_role=false、anon/authenticated=false(開權【前】的極性已記錄)';
END $$;

-- ══ 1. 開權(唯一的一支;沖銷 RPC 不在本片,見檔頭)═══════════════════════════
GRANT EXECUTE ON FUNCTION
  public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz)
  TO service_role;

-- ══ 2. fail-closed 斷言:翻轉後的極性 ═══════════════════════════════════════
DO $$
DECLARE
  v_fn oid := pg_catalog.to_regprocedure(
    'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)');
  v_bad text;
BEGIN
  -- ① 🔴 **有效權限**(op5:44-46 的第三件):`has_function_privilege` 看得到 role 繼承,
  --    而 `proacl` 看不到 ⇒ 只驗 proacl 會漏掉「透過繼承拿到 EXECUTE」那條路。
  IF NOT has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'D2:GRANT 之後 service_role 仍呼不到登記 RPC;拒繼續';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('authenticator', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'D2:開權之後 anon/authenticated/authenticator 也拿到了 EXECUTE;拒繼續';
  END IF;

  -- ② 🔴 **對【直接 grantee】全稱**(W5 R1 nit-3 收窄了我原本的「全稱」二字):
  --    把 proacl 攤平,任何非 owner、非 service_role 的**直接** grantee 一律紅。
  --    ⚠️ **它看不到 role 繼承**:`GRANT service_role TO some_role` 之後,`some_role` 呼得到,
  --       而 proacl 裡只有 service_role ⇒ **本格仍綠**。
  --       anon/authenticated/authenticator 有上面 `has_*` 那格蓋到,**第四個角色沒有**。
  --    ⇒ 不是新曝險(D1 的底 + 本格 + `has_*` 三層仍在),而是**這一格的射程要寫準**。
  --    形狀取自 `scripts/l5am-verify.sh:338-363`(同日 W4 把那支的枚舉閘改成全稱)。
  --    這一格擋的是「REVOKE 清單只列舉 role 名」那個已知的洞 —— `20260810210000:431-432` 自陳過。
  --    ⚠️ 而它擋得住的是**現在有誰**,擋不住**之後有人再 GRANT**(那要靠常設 harness,本片不宣稱)。
  SELECT COALESCE(string_agg(
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
           || ':' || a.privilege_type, ','), '')
    INTO v_bad
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = v_fn
     AND a.grantee <> p.proowner
     AND a.grantee <> 'service_role'::regrole;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'D2:登記 RPC 的 proacl 出現非 service_role 的 grantee:[%];拒繼續', v_bad;
  END IF;

  -- ③ ~~proacl 非 NULL~~ 🔴 **拿掉了**(W5 R1 nit-1):它跑在 `GRANT` **之後**,
  --    而上面 §0 的閘已保證這一發 GRANT 真的改了 ACL ⇒ 執行到這裡時 **proacl 不可能是 NULL**
  --    ⇒ 那是一格**恆真守門**:它在任何世界都綠,而看起來像有人在守。
  --    📌 它的用途只在 GRANT **之前**成立,而 §0 的 ②③ 已經覆蓋了那個時點(兩者都會因 REVOKE 沒生效而紅)。

  RAISE NOTICE 'D2 後置:service_role=true、anon/authenticated/authenticator=false、proacl 全稱乾淨(極性已翻轉)';
END $$;

COMMIT;

-- ── Rollback(Supabase forward-only;手動)────────────────────────────────────
--   REVOKE EXECUTE ON FUNCTION
--     public.admin_record_manual_refund(uuid, uuid, text, text, integer, text, timestamptz)
--     FROM service_role;
--   ⚠️ 而回頭之後**片 A 就套不上去了**(它的前置閘二吃 has_function_privilege)——
--      那是設計,不是副作用:沒有可用的登記路徑就不該放行取消。
