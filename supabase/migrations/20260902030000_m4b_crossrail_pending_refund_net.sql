-- ⟦b4-CROSSRAILNET⟧ · 跨軌退款讓待退款【多報】—— 修一個已經在正式庫上的缺陷
--
-- ══ 🛑🛑 這是一個【已上線】的缺陷, 不是一片新功能 ═══════════════════════════════
--   `20260901080000`(Sean 2026-09-02 手動貼, `APPLIED.tsv` 有, 線 `-0e` 唯讀回核 trigger 啟用中)
--   在取消訂單時逐軌算「我們還欠客人多少非卡的錢」, 而它把負數丟掉。
--
-- ══ 缺陷本體(實跑重現, 不是推的)═══════════════════════════════════════════════
--   `scratchpad/crossrail-probe.sh` 三個世界(拋棄式 PG 17.10, 兩段算式【逐字抄】自原檔):
--     世界A 匯款收 1,000 · 人工退款登記成 cash 500
--       那道上限閘看到的餘裕(兩軌合計)= 500 ⇒ **它放行**
--       而待退款逐列 = `bank_transfer=1000` · 合計 **1000** ⇒ 🔴 **實際只欠 500 ⇒ 多報 500**
--     🟢 世界B 同樣 500 而登記成 bank_transfer(同軌)⇒ 餘裕 500 · 待退款 500 ✅
--       ⇒ 📌 **這一格承重**:沒有它, 世界A 那個 1000 只是「壞掉」而不是【跨軌造成的】
--     🟢 世界C 完全沒有退款 ⇒ 兩邊都 1,000 ⇒ 基線一致 ⇒ 差別確實只出在退款那一側
--
--   兩段算式為什麼會不同意(各開一次原檔看的):
--     `20260824010000:128-133`(上限閘)收款側 `rail IN ('bank_transfer','cash')` **合計**,
--       而**扣除側【沒有 rail 條件】** ⇒ 它扣掉【所有軌】的人工退款 ⇒ 跨軌退款【放行】
--     `20260901080000:436-446`(開待退款)**逐軌**相減, 而 `WHERE x.amt > 0` **把負數丟掉**
--   ⇒ 🔴 **一個逐軌扣, 一個不分軌全扣 —— 那不是「同一個公式的兩份實作」, 是【兩個不同的定義】。**
--   ⇒ 📌 而我第一版把它寫成「只差一個 group by」⇒ 用比較輕的詞把缺陷蓋掉了(codex 抓到)。
--
-- ══ 🔴 而實跑多告訴我們一件事, 它比「數字錯了」重 ═══════════════════════════════
--   待退款那一列逐字只有 `bank_transfer=1000` —— **cash 那一列(−500)被丟掉之後完全沒有痕跡**
--   ⇒ 🛑 **看那張表的人看不出來這裡發生過跨軌** —— 他看到的是一張看起來完全正常的單。
--   ⇒ ⇒ **數字錯了, 而且看起來對。**
--
-- ══ ✅ Sean 2026-09-02 01:2x 拍【甲】 ═════════════════════════════════════════════
--   題目逐字:「客人用【匯款】付的錢, 可不可以用【現金】退給他?」
--   甲(他選)= **可以** ⇒ 系統要學會逐軌算
--   乙        = 不可以 ⇒ 系統應該擋住
--   🛑 **⇒ 所以【改上限閘讓它擋跨軌】那條路關掉了 —— 那個操作是合法的。**
--   ⇒ ⇒ 要修的是**算法**。而「怎麼算」他沒有答, 那是本支的判斷(見下)。
--
-- ══ 🔵 本支選的算法:**先合計, 再把淨額分配回【還有正餘額的那幾軌】** ═════════════
--   ```
--   逐軌淨額 net(rail) = 該軌收款 − 該軌未作廢的人工退款      ← 可以是負的
--   總淨額     total   = Σ net(rail)                          ← 這才是「真的還欠多少」
--   total <= 0 ⇒ 一列都不開(我們沒有欠他錢)
--   total >  0 ⇒ 把 total 分配給 net > 0 的那幾軌, 依它們的 net 成比例;
--                餘數給【net 最大】的那一軌(整數, 而總和必須恰好等於 total)
--   ```
--   🔵 世界A ⇒ net(bank)=1000 · net(cash)=−500 · total=500 ⇒ bank 拿 500 ✅(而它就是錢進來的那一軌)
--   🔵 沒有退款時 ⇒ net 全正 · total = 全部 ⇒ 各軌拿回自己的數 ⇒ **與今天逐字相同**(無回歸)
--
--   🛑 **為什麼不選「負數也照樣記一列」**(那是另一個看起來更誠實的選項):
--     那樣 `cash = −500` 會出現在表上 ⇒ 跨軌【看得見】, 而合計仍然正確。
--     🔴 **而它有一個更貴的失敗模式**:那張表是給人【照著退錢】的。
--       一個逐列付款的人看到 `bank=1000` 就會付 1000, 而 `−500` 那一列他不會「付負的」
--       ⇒ ⇒ **他仍然會多付 500** —— 而這一次是**畫面叫他這樣做的**。
--     ⇒ 📌 **所以本支選「每一列都是可以直接照著付的數」**, 而把跨軌的可見性交給另一件事。
--
-- ══ 🛑 而【跨軌看得見】那一半, 本支【做不到】—— 具名, 不是忘記 ═══════════════════
--   主視窗要求:「修好之後那張表要看得出來這裡曾經跨軌」。
--   🔴 而那需要一個**新欄位**(例如「原始逐軌淨額」)或**另一張紀錄** ⇒ 那是 schema 決定,
--     而它動的是一張【錢】的表 ⇒ 不是本支順手做得了的。
--   ✅ 已開列 `⟦5b-CROSSRAILVISIBLE⟧`。⇒ **而在它做完之前, 那張表看不出來曾經跨軌。**
--   🔵 **而本支至少讓【數字對了】** —— 而「數字錯而看起來對」與「數字對而看不出跨軌」
--     不是同一級的傷害:前者會多退錢, 後者只是少一個線索。

-- 🔴 **裸 `CREATE`, 不是 `OR REPLACE`**(`migration-new-file-static-checks` ①)——
--   這是一個【新物件】⇒ 撞名要當場紅。
--   `OR REPLACE` 會把撞名**靜靜蓋掉**, 而 REVOKE 與後置斷言【照樣綠】
--   ⇒ 📌 拿到綠燈, 卻蓋掉了一個你不知道存在的東西。
CREATE FUNCTION public.pcm_pending_refund_amounts(p_order_id uuid)
RETURNS TABLE (rail text, amount bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- 🔴 **【codex must-fix】`search_path = ''`, 不是 `public, pg_temp`。**
--   `SECURITY DEFINER` + 可被污染的 search_path = 這個 repo 記過的那一類。
--   ⇒ 空 search_path + 【每一個物件都完整限定】(本函式已經是, 逐個 `public.` 開頭)。
--   🔵 而隔壁 `pcm_pending_refund_on_cancel`(`20260901080000`)用的就是 `''` ——
--     ⇒ 📌 **我抄了它的本體, 而沒有抄它的這一行。**
SET search_path = ''
AS $fn$
  WITH net AS (
    SELECT r.rail,
           COALESCE((SELECT SUM(p.amount) FROM public.order_payments p
                      WHERE p.order_id = p_order_id AND p.rail = r.rail), 0)::bigint
         - COALESCE((SELECT SUM(m.refund_amount) FROM public.order_manual_refunds m
                      WHERE m.order_id = p_order_id AND m.rail = r.rail
                        AND m.voided_at IS NULL), 0)::bigint AS net
      -- 🔴 這是 `order_payments.rail` 值域的【手抄副本】(主人 `20260810100000:189`, 三值含 card)
      --    —— 與 `20260901080000:441-442` 同一份, 而那個問題本支【沒有解決】:
      --    新增第 4 條非卡軌時, 這裡與那裡【都要】回來改。⇒ 已在該檔記過, 本支不重複開列。
      FROM (VALUES ('bank_transfer'), ('cash')) AS r(rail)
  ),
  -- 🔴 **只有【還有正餘額】的軌拿得到分配** —— 負的那幾軌已經在 `total` 裡被扣掉了
  pos AS (SELECT n.rail, n.net FROM net n WHERE n.net > 0),
  agg AS (
    SELECT (SELECT SUM(n.net) FROM net n)  AS total,      -- 真的還欠多少(可負)
           (SELECT SUM(p.net) FROM pos p)  AS pos_total   -- 分配的分母
  ),
  -- 🔴 **整數分配用【前綴和差分】** —— 兩件事要同時成立:
  --   ① 每一列都 > 0(它要能被直接照著付)
  --   ② Σ 每一列 **恰好等於** `total`(不能因為取整而多付或少付一塊錢)
  --      🔴 **而它【只有加上 `trunc()` 才成立】** —— 見下方那段(SUM(bigint) 回 numeric)。
  --   ⇒ 前綴和差分天生滿足 ②:相鄰兩個「已分配累計」相減, 誤差不會累積, 也不必事後補餘數。
  -- ⛔ ~~第一版用 `LEFT JOIN net n2 ON n2.rail <= n.rail` + `GROUP BY` 做同一件事~~
  -- 🔴 **那一版是錯的, 而【對照組抓到它】**:兩軌都有收款且沒有退款時, 它只吐 `bank_transfer=600`
  --    —— **`cash=400` 整列不見了** ⇒ 合計 600 而不是 1000 ⇒ **那是一個回歸, 不是新缺陷。**
  --    ⇒ 📌 而抓到它的是【無回歸】那一格, 不是缺陷本體那一格 ——
  --      缺陷本體(世界A)在錯的版本下**照樣過**, 因為那個世界只有一條正軌。
  --    ⇒ ⇒ **一個只有一條正軌的世界, 對「多條軌怎麼分」零判別力。**
  cum AS (
    SELECT p.rail,
           SUM(p.net) OVER (ORDER BY p.rail ROWS UNBOUNDED PRECEDING)          AS c,
           SUM(p.net) OVER (ORDER BY p.rail ROWS UNBOUNDED PRECEDING) - p.net  AS c_prev
      FROM pos p
  )
  -- 🔴🔴 **`trunc(...)` 不是保險, 它是這個算式成立的前提**(`-c7` 2026-09-02 複驗抓到, 本窗自己重量過)。
  --   🛑 **`SUM(bigint)` 在 Postgres 回的是 `numeric`, 不是 `bigint`** ⇒ 上面 `total` / `pos_total`
  --     都是 numeric ⇒ 那兩個 `/` **不是整數除法**, 而是精確有理數除法。
  --   ⇒ 而 `::bigint` 是**逐列四捨五入** ⇒ 📌 **前綴和差分的遞移抵銷【根本沒有發生】。**
  --
  --   實測(本窗拋棄式 PG 17.10, LC_ALL=C):
  --     pg_typeof(SUM(1::bigint))            ⇒ numeric
  --     ((7::numeric*9)/17)::bigint          ⇒ 4      而 (7::bigint*9)/17 ⇒ 3
  --     `total=2` · `pos_total=3` · 三條正軌各 1:
  --       現行(無 trunc)⇒ 逐列 1 | 1 | 1 = 3  🔴 **比 total 多付 1 元**
  --       trunc 版      ⇒ 逐列 0 | 1 | 1 = 2  ✅ 而那個 0 會被下面的 WHERE 濾掉
  --     ⚠️ **而這一組是【四軌】不是三軌**(codex 2026-09-02 must-fix 更正我原本的標籤):
  --       三條正軌各 1 ⇒ `pos_total = 3`, 而 `total = 2` **還需要第四條 `−1`**。
  --       ⇒ 📌 我寫「三軌」是因為我腦子裡只數了【正的那幾條】—— 而 `total` 是**全部**的和。
  --
  --   🛑 **而【零元列】不只是多一列, 它會炸掉整筆取消**:WHERE 比的是 numeric(0.333… > 0 為真)
  --     而 SELECT 的 `::bigint` 得 0 ⇒ 撞 `20260901080000` 的 `amount_at_cancel CHECK (> 0)`
  --     ⇒ INSERT 失敗 ⇒ **整筆取消回滾**。⇒ ✅ 兩處都套 trunc ⇒ WHERE 與 SELECT 算同一個值。
  --
  -- 🔵 **而今天(兩軌)【本來就是對的】, 這一改是行為中性的** —— `-c7` 窮舉 nets 各 -50..50
  --   ⇒ 10,201 個世界, 合計不符 0、零元列 0(正對照:多餵一條軌 ⇒ 不符 50 ⇒ 那把尺會動)。
  --   理由:一軌負 ⇒ `pos` 只剩一列 ⇒ 分配 = `total` 本身;兩軌都正 ⇒ `total = pos_total`
  --   ⇒ 各拿自己的數。
  --   ⛔ ~~⇒ 分數要【三條正軌】才生得出來。~~ 🔴 **假的**(codex must-fix):`[1, 2, −2]`
  --     只有**兩條**正軌, 而 `total=1` / `pos_total=3` ⇒ 生出 `1/3` 與 `2/3`。
  --   ✅ **正確的條件是兩個【同時】成立**:`total ≠ pos_total`(⇒ 至少一條負軌)
  --     **而且** `pos` 有兩列以上(⇒ 至少兩條正軌)⇒ **合計至少【三條軌】, 不是三條正軌。**
  --   ⇒ 📌 而今天恰好兩軌 ⇒ 那兩個條件**不可能同時成立** ⇒ 這就是今天安全的完整理由。
  --
  -- 🛑🛑 **而這一格真正的教訓是【警告的方向】**:
  --   本檔已經警告了「新增第 4 條非卡軌時, rail 值域**兩處**都要回來改」——
  --   ⇒ 而**沒有警告【回來改算式】** ⇒ 📌 **而回來改值域的那個人, 會以為算式是安全的**
  --     ⇒ ⇒ **因為 COMMENT 是這樣告訴他的。**
  --   ⛔ ~~原 COMMENT 逐字:「⇒ Σ 每一列**恰好等於** total, 不會因取整多付或少付。」~~
  --     🔴 **那句話在三軌以上【不成立】, 而它是我寫的。留著加刪除線, 因為它正是那個誤導。**
  SELECT cu.rail,
         (trunc((a.total * cu.c) / a.pos_total)
        - trunc((a.total * cu.c_prev) / a.pos_total))::bigint AS amount
    FROM cum cu
    CROSS JOIN agg a
   WHERE a.total > 0
     AND (trunc((a.total * cu.c) / a.pos_total)
        - trunc((a.total * cu.c_prev) / a.pos_total)) > 0;
$fn$;

COMMENT ON FUNCTION public.pcm_pending_refund_amounts(uuid) IS
  '⟦b4-CROSSRAILNET⟧ 取消時「每一軌該開多少待退款」。'
  '🔴 先合計再分配:逐軌淨額可以是負的(跨軌退款 —— Sean 2026-09-02 拍甲說那是合法的),'
  '而總淨額才是真的還欠多少;total <= 0 回零列。'
  '🔴 分配用【前綴和差分 + trunc()】⇒ Σ 每一列恰好等於 total,不會因取整多付或少付。'
  '🛑 那個 trunc() 不是保險:SUM(bigint) 在 Postgres 回 numeric ⇒ 少了它, 除法是精確有理數除法, '
  '而 ::bigint 是逐列四捨五入 ⇒ 遞移抵銷不會發生 ⇒ 三軌以上會多付, 而零元列會撞 '
  'amount_at_cancel 的 CHECK (> 0) 讓整筆取消回滾。(2026-09-02 -c7 複驗抓到, 本窗實測複現。)'
  '⚠️ 而「三軌以上會多付」講得太絕對(codex 更正):[1,1,1] 這種 total = pos_total 的三軌'
  '舊版也完全正確。⇒ 正確說法是【可能多付, 也可能生出零元列】, 而零元列那一種比較貴。'
  '🔴🔴 所以【回來改 rail 值域的人, 也要回來看這個算式】—— 而它今天之所以安全, '
  '是因為兩軌時分數生不出來(一軌負 ⇒ pos 只剩一列;兩軌都正 ⇒ total = pos_total)。'
  '🛑 而它【看不出來曾經跨軌】—— 那要新欄位或另一張紀錄,已開列 ⟦5b-CROSSRAILVISIBLE⟧。'
  '⚠️ rail 值域是手抄副本(同 20260901080000:441-442):新增第 4 條非卡軌時兩處都要改。'
  '🛑 而【只改值域不夠】—— 上面那條 trunc 的理由講的就是第 3 條軌會發生什麼。'
  '📌 原本這裡只警告了值域, 而回來改值域的人會以為算式是安全的 —— 因為本 COMMENT 這樣告訴他。'
  '🛑 它是【取消那一刻的快照】:取消後再登記退款或沖銷收款,既有那幾列【不會跟著變】'
  '(那是 20260901080000 的既有設計,不是本支引入的)⇒ 已開列 ⟦5b-PENDINGSTALE⟧。';

-- 🔴🔴 **【codex must-fix】權限:新物件【出生就自帶 PUBLIC 的 EXECUTE】** ——
--   而本函式是 `SECURITY DEFINER` 且回的是【財務數字】⇒ 不收掉的話, 任何角色餵一個訂單 uuid
--   就讀得到「這張單還欠多少」。
--   ⇒ 📌 **而我在同一夜的 `20260902040000` 有寫這四行, 在這一支【忘了】** ——
--     ⇒ ⇒ 兩支檔、同一個作者、同一個小時, 而只有一支記得。**「知道那條規矩」不等於「這一次做了」。**
--   ⇒ 形狀對齊 `20260824010000:149-151`(同族的那支 cap 函式)。
REVOKE ALL ON FUNCTION public.pcm_pending_refund_amounts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_amounts(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_pending_refund_amounts(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_pending_refund_amounts(uuid) TO service_role;
-- ── 新物件收權斷言(`scripts/migration-new-file-static-checks.sh` ③ 要這份清單可被數)──
-- 🔴 **它防的不是「忘記收權」, 是「忘記列」** —— 下面那個迴圈只檢查你列出來的物件。
--   ⇒ 📌 `REVOKE` 是【我做的動作】;這份清單是【下一個在這支檔加新物件的人會撞到的東西】。
-- 🔴 簽章逐字從上面的 `CREATE FUNCTION` 抄 —— `to_regprocedure` 對參數型別逐字比對,
--   打錯會**回 NULL**, 而第一道 IF 就是讓那件事 fail-loud、不靜默通過。
-- 🔴 結尾的 `::text[]` 不能拿掉(清單清空時 `ARRAY[]` 無法推斷型別)。
DO $grant_assert$
DECLARE
  v_functions text[] := ARRAY[
    'public.pcm_pending_refund_amounts(uuid)'
  ]::text[];
  v_fn oid;
  r    text;
BEGIN
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '收權斷言失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '收權斷言失敗:% 對 service_role 沒有 EXECUTE(收太多)⇒ 呼叫端會被 42501 擋掉', r;
    END IF;
  END LOOP;
  RAISE NOTICE '✅ 收權斷言過:% 支函式 —— anon/authenticated 零 EXECUTE、service_role 有',
    cardinality(v_functions);
END
$grant_assert$;


-- ── 而把那支 trigger 函式接到新算式上(本體逐字沿用 `20260901080000`,只換那一段 SELECT)──
-- 🔴 **不接的話這一支等於沒做** —— 新函式建好了而沒有人呼叫它,
--    而三綠會全綠、它自己的後置斷言也會過。⇒ 那正是今晚一再撞到的「寫對了而沒接上」。
CREATE OR REPLACE FUNCTION public.pcm_pending_refund_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_cid uuid;
  v_n   int;
BEGIN
  -- 🔴 只在【由無變有】那一刻發火。`AFTER UPDATE OF cancelled_at` 已經限定了欄位,
  --    這一道再擋「已經取消過、只是又被 UPDATE 一次」。
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN
    RETURN NULL;
  END IF;

  -- ══ 🔴 步 1:**先算錢**(codex R1 #1 的修法)═════════════════════════════════
  --    舊版先找 cancellation、找不到就 RAISE ⇒ 而【逾期 cron 那條路沒有 cancellation】
  --    ⇒ 整批 rollback。搬到後面之後,零收款的單一列都不開 ⇒ 根本不需要 cancellation。
  --    📌 **這不是把 cron 豁免掉,是把這段邏輯的射程收窄到它真正管的世界。**
  --
  -- ══ 🔴🔴 步 2:**哪一次取消 —— 用【交易時刻】精確配對, 不用「最新一筆」**(codex R2 #1/#3)══
  --    舊版取「`created_at` 最大的那一筆」⇒ 兩個錯:
  --      ① 訂單有【舊的部分取消】、之後被逾期 cron 寫 `cancelled_at`
  --         ⇒ 抓到那筆與本次無關的舊取消單 ⇒ **掛錯歸屬**(R2 #3)
  --      ② 「先數一次確認唯一、再查一次拿 id」中間別人可以 commit ⇒ race(R2 #1)
  --    ✅ 而 `pg_catalog.now()` 是**交易時刻**不是語句時刻(2026-09-01 當場實測:
  --       同一交易內隔 `pg_sleep(0.3)` 的兩句, `DEFAULT now()` 與 `SET = pg_catalog.now()`
  --       兩個值**逐字相同**)⇒ `admin_cancel_order` 同一交易寫的 cancellation 與 `cancelled_at`
  --       **必然同值** ⇒ 直接用它配對:精確、單發、不需要排序也不需要平手規則。
  --    🔵 而逾期 cron 那條路沒有 cancellation ⇒ 自然配不到 ⇒ `v_cid` 留 NULL(那是合法值)。
  --    ⚠️ **誠實邊界**:哪天有人把 `cancelled_at` 寫成**非** `now()` 的值(例如回填舊單),
  --       這裡會配不到 ⇒ 退化成 NULL。**那是安全的退化(留白),不是錯的歸屬。**
  -- 📌 **為什麼這裡沒有 `ORDER BY … LIMIT 1`**:那個寫法是【找最接近的那一筆】= 啟發式,
  --    而這裡是【找同一個值的那一筆】= 等式。**啟發式永遠有「猜錯」那一格,等式沒有。**
  SELECT c.id INTO v_cid
    FROM public.order_cancellations c
   WHERE c.order_id = NEW.id
     AND c.created_at = NEW.cancelled_at;
  -- 同一交易理論上只會有一筆;真的有兩筆(同值)時 `SELECT INTO` 取其一 ⇒ 顯式數一次,
  -- 平手就不猜(寧可留白, 也不要掛一個擲骰子的歸屬)。
  SELECT count(*) INTO v_n
    FROM public.order_cancellations c
   WHERE c.order_id = NEW.id AND c.created_at = NEW.cancelled_at;
  IF v_n <> 1 THEN
    -- 🔴 F5(Fable R3):NULL 是三義的 —— ①無取消單路徑 ②非 now() 寫入 ③這裡的平手。
    --    前兩義在 COMMENT 裡查得到,而【平手】原本零留痕 ⇒ 出事那天沒有人查得出來它發生過。
    -- 🔴🔴 **而只在 `> 1` 時叫,不在 `= 0` 時叫** —— 這一格是實跑之後改的:
    --    第一版寫 `v_n <> 1` ⇒ 而**逾期 cron 那條路(零取消單)是【預期的正常路徑】**
    --    ⇒ 每一張被 cron 取消的單都會噴一則 WARNING。
    --    📌 **⇒ 一個對【常態】發的警報,會讓人學會忽略它 —— 而那正好殺掉它要保護的那個訊號。**
    IF v_n > 1 THEN
      RAISE WARNING
        '待退款歸屬留白 — 訂單 % 在 cancelled_at=% 這個時刻有 % 筆取消單(期望 1)⇒ cancellation_id 留 NULL 不猜。',
        NEW.id, NEW.cancelled_at, v_n;
    END IF;
    v_cid := NULL;
  END IF;

  -- ══ 🔴🔴 步 3:**兩軌一發算完、一發寫入**(codex R2 #4/#5)═══════════════════
  --    舊版兩軌各跑一次 `SELECT`, 而 `READ COMMITTED` 之下兩句之間別人可以 commit
  --    ⇒ 兩筆 `amount_at_cancel` 可能來自**不同的資料庫時點**;更糟的是舊版還多一發
  --      「先算 count 決定要不要繼續」⇒ 那一發與後面兩發之間也會漂。
  --    ✅ 改成單一 `INSERT … SELECT`:兩軌在**同一個快照**裡算完, 而且沒有「先看一眼再決定」。
  --    🔴 而溢位那一族(R1 #3 / R2)不在這裡守 —— **欄位型別就是 `bigint`**, 見上面的欄位註解。
  -- 🔴🔴 **2026-09-02 `⟦b4-CROSSRAILNET⟧`:這一段【原本是就地算的, 而它會多報】。**
  --   原本是逐軌相減再把負數濾掉 ⇒ 跨軌退款時那一軌的負值被丟掉 ⇒ 合計偏高。
  --   實測(拋棄式 PG):匯款收 1000 · 現金退 500 ⇒ 它記 **1000**, 而實際只欠 **500**。
  --   ⇒ ✅ 改成呼叫 `pcm_pending_refund_amounts()` —— **先合計再分配**, 見那支函式的 COMMENT。
  --   ⇒ 📌 而【搬出去】本身也是修法的一部分:這個公式從今天起只有一份,
  --     而它有自己的後置斷言(四個世界)⇒ 下一個改它的人會被那四格擋。
  -- 🔴🔴 **【R3 must-fix】「有收款而一列都不開」在本夜之後從【構造上不可達】變成【線上可達】**
  --   在 `20260902020000` 之前, 上限閘會擋掉「退得比收的多」⇒ `total <= 0` 只可能是零收款。
  --   而現在它記得下來 ⇒ **一個打字錯誤就到得了那個世界**:
  --     匯款收 10,000 · 員工把 1,500 打成 **15,000** ⇒ 照記(那是拍板要的)
  --     ⇒ 取消時 total = 10000 − 15000 = −5000 ⇒ **一列都不開、一句話都不說**
  --     ⇒ 🛑 **而公司真正還欠客人的 8,500 就這樣從帳本上消失了。**
  --   ⇒ 📌 而我原本的世界C 把那個沉默【斷言成正確】—— 它在舊世界是對的, 在新世界是錯的。
  --   ⇒ ⇒ **一個對照組可以因為別人的改動而過期, 而它過期時仍然全綠。**
  --   ✅ 所以:**收過錢而算出來不欠 ⇒ 出聲**。不擋(那不是拍板要的), 但不准安靜。
  IF EXISTS (SELECT 1 FROM public.order_payments p
              WHERE p.order_id = NEW.id AND p.rail IN ('bank_transfer', 'cash'))
     AND NOT EXISTS (SELECT 1 FROM public.pcm_pending_refund_amounts(NEW.id)) THEN
    RAISE WARNING
      '取消單 %:這張單【收過非卡的錢】, 而算出來一列待退款都不用開。'
      '🔴 最常見的成因是【人工退款登記打錯金額】(例如多一個 0)—— 那會讓帳面看起來不欠錢。'
      '⇒ 請對一次 order_manual_refunds 上那幾筆的金額。', NEW.id;
  END IF;

  INSERT INTO public.order_pending_refunds
    (order_id, cancellation_id, rail, amount_at_cancel)
  SELECT NEW.id, v_cid, a.rail, a.amount
    FROM public.pcm_pending_refund_amounts(NEW.id) AS a
  -- 🔴 `ON CONFLICT` 指向【部分唯一索引】(codex R1 #7):它只在「未作廢且未結清」的列
  --    之間唯一 ⇒ 重放不會長出第二列, 而**作廢過的舊列不會吞掉一次新的取消**。
  -- 🔴🔴 **2026-09-02 從 `DO NOTHING` 改成 `DO UPDATE`(主視窗裁, 而理由是【窗口只有現在】)**
  --   codex 逐字:「第一次取消開待退 1,000;之後實退 400, 再解除／重新取消時**雖重算為 600**,
  --   既有未結清列會讓 `ON CONFLICT DO NOTHING` **吞掉新值**, 畫面仍顯示 1,000。」
  --   ⇒ 📌 **那與跨軌是【同一個症狀】:待退款的數字錯, 而它看起來對。**
  --   ⇒ ⇒ 只修算的那一半 ⇒ 下一個人會以為那張表可信了 ⇒ **那比沒修更危險。**
  --
  -- 🔵 **為什麼現在改是零風險**(線 `-0e` 唯讀正式庫實查, `stats_reset` 從未 reset):
  --   `order_pending_refunds` 的 `n_tup_ins = 0` ⇒ **這張表建庫以來一列都沒有過。**
  --   ⇒ 改它的寫入語意**不可能弄壞任何已經發生的東西**。
  --   🛑 **而那個窗口會關上** —— 第一筆進去之後, 改寫入語意就變成一個有回歸風險的動作。
  --
  -- 🔴 **覆蓋的邊界(這一格是判斷, 寫清楚)**:
  --   `ON CONFLICT` 指向的是【部分唯一索引】—— 它只在「**未作廢且未結清**」的列之間唯一。
  --   ⇒ **已結清 / 已作廢的列根本不在這個索引裡** ⇒ 它們不會被碰到, 也不該被碰到:
  --     那些是【已經處理完的歷史】, 覆蓋它們等於改寫已經發生的事。
  --   ⇒ ✅ 所以會被覆蓋的只有【還沒有人處理的那一列】—— 而那正是「重算的新值該取代舊值」的那一格。
  --   ⚠️ 而 `cancellation_id` 也一起更新:同一張單第二次取消時, 歸屬要跟著新的那一次走。
  ON CONFLICT (order_id, rail) WHERE voided_at IS NULL AND settled_at IS NULL
  DO UPDATE SET amount_at_cancel = EXCLUDED.amount_at_cancel,
                cancellation_id  = EXCLUDED.cancellation_id;

  RETURN NULL;
END;
$fn$;

-- ── 後置斷言:三個世界, 而它們是那支 probe 的縮影 ──────────────────────────────
-- 🔴 這一段【真的算】, 不是數字面 —— 它建拋棄式的假資料、跑那支函式、然後全部回滾。
--    ⇒ 而那正是本支要證的東西:**它算出來的數對不對**, 不是「那幾行字面在不在」。
DO $post$
DECLARE
  v_o    uuid := '00000000-0000-0000-0000-0000000c0de1';
  v_sum  bigint;
  v_rows int;
BEGIN
  INSERT INTO public.orders(id) VALUES (v_o) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_o) THEN
    RAISE EXCEPTION '後置斷言:造不出測試訂單 ⇒ 這一段【沒有跑】, 而那不等於通過';
  END IF;

  -- 世界A:匯款收 1000 · 現金退 500 ⇒ 應該恰好一列, 而合計 500
  INSERT INTO public.order_payments(order_id, rail, amount) VALUES (v_o, 'bank_transfer', 1000);
  INSERT INTO public.order_manual_refunds(order_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES (v_o, 'cash', 500, '後置斷言', 'assert', pg_catalog.now());
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_sum, v_rows
    FROM public.pcm_pending_refund_amounts(v_o);
  IF v_sum <> 500 THEN
    RAISE EXCEPTION '世界A(跨軌):合計應為 500, 實得 % ⇒ 本支沒有修好那個多報', v_sum;
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION '世界A:應恰好 1 列(只有 bank 還有正餘額), 實得 % 列', v_rows;
  END IF;

  -- 🟢 世界B 正對照:把那筆現金退款作廢 ⇒ 回到「完全沒有退款」⇒ 合計要變回 1000
  --    ⇒ 少了這一格,一個「永遠回 500」的實作也會通過世界A。
  -- 🔵 **【R3 nit】帶上 `voided_at IS NULL`** —— 少了它會再碰一次已作廢的那列。
  --   它今天沒紅是因為 `pg_catalog.now()` 在同一交易內恆等;換成 `clock_timestamp()` 就當場炸。
  --   ⇒ 📌 **一發「今天剛好不會紅」的寫法, 與一發對的寫法, 在綠燈下長得一樣。**
  UPDATE public.order_manual_refunds SET voided_at = pg_catalog.now()
   WHERE order_id = v_o AND voided_at IS NULL;
  SELECT COALESCE(SUM(amount), 0) INTO v_sum FROM public.pcm_pending_refund_amounts(v_o);
  IF v_sum <> 1000 THEN
    RAISE EXCEPTION '世界B(作廢後):合計應為 1000, 實得 % ⇒ 這把尺不會動', v_sum;
  END IF;

  -- 🟢🟢 世界E 正對照:**同軌部分退款** ⇒ 匯款收 1000、匯款退 500 ⇒ 恰好一列合計 500
  --    🔴 **這一格是 `-c7` 2026-09-02 指出來的缺口, 而它是本支【最該有】的一格**:
  --      上面 A/B/C/D 全部沒有演過「一條軌自己收自己退」—— 而那是**平常每天都在發生**的那一種。
  --      ⇒ 📌 A 證的是「跨軌那一種會算對」;而**沒有東西在證「本來對的那一種沒有被改壞」**。
  --      ⇒ ⇒ 🛑 **這一片的風險方向是【修過頭】, 不是【沒修到】** —— 而那需要不同的對照。
  --    🔵 而 `-c7` 自報它就是寫 `WHERE x.amt > 0` 那一行的人, 而它給的形狀是:
  --      「一個【過濾掉零】的條件, 在有負數的世界裡變成【丟資訊】」
  --      ⇒ 而它躲過三輪審查的方式:每一輪都在問「這一列該不該開」,
  --        **沒有人問那個負數去哪了**。
  --    ⚠️ 本窗的拋棄式 harness 有演過同軌那一格(commit body 的「🟢 同軌 500」),
  --      **而 migration 自己的後置斷言沒有** ⇒ 📌 **harness 演過, 不等於【貼下去的那一刻】會驗。**
  --      而 Sean 貼的是這支檔, 不是我的 harness。
  DELETE FROM public.order_manual_refunds WHERE order_id = v_o;
  DELETE FROM public.order_payments WHERE order_id = v_o;
  INSERT INTO public.order_payments(order_id, rail, amount) VALUES (v_o, 'bank_transfer', 1000);
  INSERT INTO public.order_manual_refunds(order_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES (v_o, 'bank_transfer', 500, '後置斷言', 'assert', pg_catalog.now());
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_sum, v_rows
    FROM public.pcm_pending_refund_amounts(v_o);
  IF v_sum <> 500 OR v_rows <> 1 THEN
    RAISE EXCEPTION
      '世界E(同軌部分退款):應為 1 列合計 500, 實得 % 列合計 % ⇒ 平常那一種被改壞了',
      v_rows, v_sum;
  END IF;

  -- 🟢 世界C 正對照:退款超過收款 ⇒ total <= 0 ⇒ **一列都不准開**
  INSERT INTO public.order_manual_refunds(order_id, rail, refund_amount, reason, actor, occurred_at)
    VALUES (v_o, 'cash', 1200, '後置斷言', 'assert', pg_catalog.now());
  SELECT count(*) INTO v_rows FROM public.pcm_pending_refund_amounts(v_o);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION '世界C(退款超過收款):應開 0 列, 實得 % 列 ⇒ 它會開一筆我們不欠的錢', v_rows;
  END IF;

  -- 🟢 世界D 正對照:**兩軌都有收款而沒有退款** ⇒ 各拿自己的, 而合計恰好等於總收款
  --    🔴 **這一格是後補的, 而補它的是一個回歸**:第一版的分配式在這個世界裡
  --      **把 `cash` 那一整列弄不見**(合計 600 而不是 1000)⇒ 而世界A/B/C 三格【全部照過】。
  --    ⇒ 📌 **世界A 只有一條正軌 ⇒ 它對「多條軌怎麼分」零判別力。**
  --      ⇒ ⇒ **缺陷本體那一格證不了分配對不對, 而我原本以為它可以。**
  -- 🔵 **【R3 nit】帶上 `voided_at IS NULL`** —— 少了它會再碰一次已作廢的那列。
  --   它今天沒紅是因為 `pg_catalog.now()` 在同一交易內恆等;換成 `clock_timestamp()` 就當場炸。
  --   ⇒ 📌 **一發「今天剛好不會紅」的寫法, 與一發對的寫法, 在綠燈下長得一樣。**
  UPDATE public.order_manual_refunds SET voided_at = pg_catalog.now()
   WHERE order_id = v_o AND voided_at IS NULL;
  INSERT INTO public.order_payments(order_id, rail, amount) VALUES (v_o, 'cash', 400);
  SELECT COALESCE(SUM(amount), 0), count(*) INTO v_sum, v_rows
    FROM public.pcm_pending_refund_amounts(v_o);
  IF v_sum <> 1400 OR v_rows <> 2 THEN
    RAISE EXCEPTION
      '世界D(兩軌都有收款、無退款):應為 2 列合計 1400, 實得 % 列合計 % ⇒ 分配式弄丟了一整軌',
      v_rows, v_sum;
  END IF;

  RAISE NOTICE '✅ 五個世界都對:跨軌 500(1 列)· 作廢後 1000 · 同軌部分退 500(1 列)· 超退 0 列 · 兩軌 1400(2 列)';
  RAISE EXCEPTION '後置斷言跑完 —— 刻意回滾這段測試資料(這不是失敗)'
    USING ERRCODE = 'P0001';
EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM NOT LIKE '後置斷言跑完%' THEN
    RAISE;
  END IF;
  RAISE NOTICE '🔵 測試資料已回滾(那一發 EXCEPTION 是刻意的)';
END
$post$;
