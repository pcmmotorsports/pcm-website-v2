-- ⟦b4-PARTPAIDNOCANCEL1⟧ 收了訂金的匯款單【會變成不能取消】—— 放行 partiallyPaid 的【整單】取消
--
-- plan: docs/plans/2026-09-08-partpaidnocancel-plan.md(主視窗 A 2026-09-08 批)
-- codex R1 = FAIL(8 must-fix / 3 nit), 逐條開檔驗過皆屬實 ⇒ 本檔是 R1 之後的版本。
-- 鐵則 8(動 migration)+ 鐵則 12①③(錢 · DB 結構)⇒ 不 push。
--
-- ── 這一支在修什麼 ───────────────────────────────────────────────────
-- `20260904230000` 讓收到錢的匯款單自己翻成 `paid` / `partiallyPaid`
--   (逐字來源 `20260905060000_m4b_stuck_bank_orders_health.sql:4`)。
-- 而 `admin_cancel_order` 的付款守門允許集是 `unpaid` ∪ (`paid` ∧ 有收款列 ∧ 無 card 收款列)
--   ⇒ `partiallyPaid` 落在集合外 ⇒ **收了訂金的匯款單按不下取消, 而錯誤訊息是通用的**。
--
-- 🔴 **為什麼那是【不一致】而不是【嚴格】**:那道述詞有一個放行「已收錢」的逃生口(`paid` 那一支),
--    而 `paid` 與 `partiallyPaid` 都是「已收錢」⇒ 放一個進來、擋另一個, 沒有理由。
--
-- ── 🛑 而【部分取消仍然被擋】—— 那不是遺漏, 是刻意(主視窗 A `Q-account-F` 拍甲)──────
-- codex R1 must-fix ②③ 證到:放行「`partiallyPaid` + 部分取消」會開出一個**比原病更糟**的世界:
--   · 錢**已經收了**
--   · `20260901080000:60-62` 逐字:「**部分取消不開待退款**…部分取消收了的錢, 今天起【仍然】零紀錄」
--   · `20260901030000:1188-1192` 結算器 `P2` 要求**完全沒有取消痕跡** ⇒ 取消後不可計算
--     ⇒ `needs_human` ⇒ `20260904230000:289-299` 不翻狀態 ⇒ **訂單永遠停在 `partiallyPaid`**
-- ✅ **判準(A 拍甲的理由)**:`partiallyPaid` 單今天**本來就不能**做部分取消 ⇒ **擋著不是退步**;
--    而原始需求(收了訂金要退款關單)⇒ **整單取消就滿足了** ⇒ **能滿足需求的最小改動。**
-- 🔴 **下一個人請不要把它讀成「還沒做完」然後去放行它** —— 要放行的前提是先答
--    「部分取消該退多少」那個口徑題, 而 `20260901080000:60` 逐字說那題**沒有人答過**。
--
-- ── 改了哪三處(份數不是我挑的, 是碼自己寫的)──────────────────────
-- `20260903093000:321-323` 逐字:「三處述詞(步7 / 本處 / audit 快照)**必須一起改**」
--     ① 冪等路徑 ⑤ payment 允許集合   ② 主路徑 步7 付款守門   ③ audit 快照值域
-- 🔬 codex R1 獨立掃過並確認:**函式本體內真的只有三處**, 沒有第四個可執行述詞
--    (它的分母:剝行註解後逐一分類 `payment_status` 20 次 / `order_payments` 4 次 /
--     `payment_charge_attempts` 2 次 / `rail` 2 次)。
--
-- ── 刻意一個字都不動的 ───────────────────────────────────────────────
-- · `rail = 'card'` ⇒ 刷卡單照樣被擋(codex R1 確認保持不動正確)
-- · `payment_charge_attempts` ⇒ `20260809160000` L3a 跨檔不變式「cancelled ⇒ 無 active attempt」
-- · 不加 `SUM(amount) > 0` ⇒ 沿用原碼 `:416-418` 的既有理由(並行下會翻面)
--   🔴 **codex R1 nit ⑩ / R2 nit ⑪:那個並行理由【站不住】**(`admin_cancel_order` 先鎖 `orders`,
--      正常收款寫入受 FK / 同單鎖序序列化, 不會在同一個付款守門臨界區內任意翻面)。
--      ✅ **碼不動**(拿掉一個看起來多餘的保護不是本片的授權範圍),
--      🛑 **而理由要標** —— R2 逐字:「已否定的並行理由不該繼續當現行理由…
--         後續維護者把已站不住的理由當成不可碰的不變式」。
--      ⇒ 📌 **一個【碼對而理由錯】的地方, 比碼錯更難修 —— 因為沒有人會去改一個沒有紅的東西。**
--      ⇒ 函式體內 `:428-430` 那段原註解**我照抄未改**(它不是我的檔), 而**本段就是它的訂正指標**。
--
-- ── 🔴 codex R1 抓到我一句【不實】的話, 訂正在這裡 ────────────────────
-- ⛔ ~~「另外 6 支帶同款字面的函式都是光禿禿的 `<> 'unpaid'`, 沒有逃生口」~~ **那句是錯的。**
--    `confirm_order_payment` **有** `paid` 冪等出口(`20260906700000` `PF-D(3)`, 在 `<> 'unpaid'` 檢查【之前】);
--    `settle_zero_total_order` 也有;`get_stuck_bank_orders_health` **本來就明列 `partiallyPaid`**。
-- 📌 **成因**:我的判別式只看述詞【後面 8 行】, 而逃生口住在函式的別處 ⇒ **窗開得不夠大。**
-- 🎯 **而結論 5/6 仍然對, 錯的那一支是 `coupon_redeem_on_paid`(見下)** ——
--    🛑 **我不拿「結論還是對的」蓋過【尺是壞的】**:下一次那把尺會用在別的地方, 而那次不會剛好也對。
--
-- ── 🔴 一個【不是本片造成、也不在本片修】的真缺陷, 已另開板列 ──────────
-- `20260901030000:652-656` 逐字:「`OLD = 'unpaid'` 也排除掉 **`partiallyPaid` ⇒ `paid`**…
--   🔴 **部分收款那天上線 ⇒ 那種單的券【永不扣、不走丙、沒有聲音】**」
-- ⇒ 🛑 **那句「今天安全」今天不成立了** —— `20260904230000` 已經在寫 `partiallyPaid`。
--    **與本片無關**(本片不產生 `partiallyPaid`, 也不觸發券的 trigger), 而它是真的。
--
-- ── 🛑 我證不到什麼 ──────────────────────────────────────────────────
-- **本片的「缺陷存在」是讀碼推的 + 引 `-0e` 的量測, 我沒有複跑;replay 斷點修好後要回頭補跑 CTZZ27。**
--
-- 🔴🔴 **[2026-09-08 · 線【資料】`-db` 指出 —— 這一句要寫在【結論】不是註腳]**
--    探針 `scripts/cancel-gate-probe.sh` 檔頭 `:12` 逐字:
--      「拋棄式庫套了【**所有**】migration 含還沒貼的 ⇒ **它的世界 ≠ 正式站的世界**」
--    🎯 **⇒ 而本片的四格驗收正好建在那個差上**:
--       `CTZZ27` 期望「片 C 之後放行」—— 而**片 C 就是【還沒貼的那一支】**(= 本檔)。
--    ⇒ 📌 **探針會告訴你「在一個【所有 migration 都貼了】的世界裡它放行」**,
--       **而正式站不是那個世界**(`-db` 2026-09-08 盤:11 支候選裡 **5 支沒貼**)。
--    ✅ **⇒ 所以 CTZZ27-30 跑綠之後, 正確的寫法是「本片的【邏輯】對」**
--       —— 而**不是**「上線之後會放行」。後者要等**相依的 migration 真的貼進正式庫**才驗得到。
--    🛑 **下一個人若把它讀成「已驗證上線行為」, 那是本段沒寫清楚, 不是他讀錯。**
--
-- 🔴 **而還有一格【比那四格更重要】而我也沒驗:下面兩道後置斷言會不會【真的紅】。**
--    🔬 `-db` 2026-09-08 量到:`admin_cancel_order` 的 `CREATE OR REPLACE` 鏈裡
--       **中間有 2 支在 replay 中失敗**(`20260820030000` · `20260830020000`),
--       而**最後一支 `20260903093000` 成功** ⇒ **函式體是對的**。
--    ✅ 我逐支開檔核過:那兩支**只有 5 行可執行 DDL, 而 5 行都只碰這支函式**
--       (`CREATE OR REPLACE` · `COMMENT` · `REVOKE`×2 · `GRANT`)⇒ **零其他物件**
--       ⇒ 🟢 **「函式在而它叫不動」那條路關掉了。**
--    🔴 **而它們失敗真正的後果是【ACL】** —— 那三行 `REVOKE`/`GRANT` **也沒跑**
--       ⇒ **權限可能停在更早的狀態**, 而**上面那道 md5 前置閘擋不住它**
--       (md5 比 `prosrc`, 而 ACL 不在 `prosrc` 裡 —— 那正是前置閘自己寫的射程)。
--    ✅ **⇒ 而下面兩道後置斷言正好守這一格** ⇒ 貼下去時 ACL 不對會**在貼的當下炸**。
--    🛑 **而「它會炸」是我推的, 不是量到的。** 缺的檢查(已向 `-db` 要):
--       在一棵 `--keep-db` 的庫上先 `GRANT EXECUTE … TO anon` ⇒ 跑本片
--       ⇒ 🔴 **必須在後置斷言② 炸**;然後 `REVOKE` 回去再跑 ⇒ ✅ **必須過**。
--       ⇒ 📌 **那一發證的是「貼下去那一刻的安全」, 與 CTZZ27-30 證的【不是同一件事】。**
--
-- ── rollback ─────────────────────────────────────────────────────────
-- 三步, 缺一不可(codex R2 must-fix ⑩ 補第三步):
--   ① 再 `CREATE OR REPLACE` 一次, 逐字貼回 `20260903093000:90-556` 那一版
--   ② 重跑該檔 `:874-876` 的收權三行
--   ③ 🔴 **把本片附加的那段 COMMENT 拿掉** —— 否則函式退回不支援 `partiallyPaid`,
--      而 COMMENT 仍宣稱支援 ⇒ 📌 **下一位維護者會依一份假合約工作。**
--      做法:讀出現有 COMMENT, 砍掉「🔴 2026-09-08(⟦b4-PARTPAIDNOCANCEL1⟧…」那一段之後重設。
-- 🔴🔴 **資料不回滾:期間真的被取消的單, 那筆取消與它開的待退款列【會留著】。**
--    ✅ 主視窗 A 2026-09-08 拍甲(可接受), 理由逐字:
--       「**那些單是真的被取消了** —— 回滾它等於抹掉真實發生過的事, 比留著糟。」
--    🛑 而這句話必須在 rollback 這一節裡, 不能只寫在別處, 理由逐字:
--       「沒有那句話的話, 下一個做 rollback 的人會**假設回滾後是乾淨狀態**, 然後在髒資料上重跑。」

-- ══════════════════════════════════════════════════════════════════════
-- 🛑🛑🛑 **這一支【今天不可套用】—— 而理由不是它有問題** 🛑🛑🛑
-- ══════════════════════════════════════════════════════════════════════
-- 🟢 **先講對的那一半(codex R3 實算過, 三輪裡唯一一次真的算了金額)**:
--    「公式方向沒錯」—— 訂單 1,000 / 已收 400 / 尚未退款 ⇒ **開 400, 不是 1,000。**
--    ⇒ 📌 **碼是對的。而它接到的下游是關的。**
--
-- 🔴 **不可套用的理由(codex R3 must-fix ①,我開檔驗過)**:
--    本片讓 `partiallyPaid` 的單可以整單取消 ⇒ trigger 會開一筆 `order_pending_refunds`
--    ⇒ 而那筆待退款**今天沒有人處理得了, 也沒有人標得掉** ⇒ **永久未結清的財務待辦。**
--
-- ✅ **兩條前置條件, 各自可勾(2026-09-08 量;而它們【不是同一件事】)**:
-- ```
-- ✅ ① `#787` 人工退款入口解封 —— **2026-09-08 下午複量:已進 `origin/dev`, 這一格勾了。**
--      🔬 複量(唯讀, 我自己跑的):
--         `git show origin/dev:apps/admin/src/components/orders/manual-refund-entry-gate.ts`
--         ⇒ `:224` 逐字 `export const MANUAL_REFUND_ENTRY_BLOCKED_BY_787: boolean = false;`
--         而同檔 `:196` 留了訂正痕:⛔ ~~`= true`~~ ⇒ ✅ `= false`。
--      ⚠️ **而我這棵 worktree 的 `:195` 仍是 `= true`** —— 那是【我的樹落後】, 不是它沒做。
--         🔴 **兩者在 grep 上長得一模一樣** ⇒ 要問這一格, 一律問 `origin/dev` 那一份。
--      🛑 **仍未證的那半:部署。** 我證的是「碼在 dev 上」,
--         而 dev 是 pcm-admin 的 production 分支(memory `project_pcm-admin-production-tracks-dev`,
--         2026-07-16 `vercel inspect` 實查)⇒ **推上去即上線** ⇒ 但「那一次部署有沒有成功」我看不到。
--
--      ⛔ **以下為舊字面(零刪除), 已被上面取代:**
--      ⛔ ~~已完成而【未進 dev】:線 `-refund` commit `aea57bdef`(Sean 拍 `QB-14` 乙);
--         `git merge-base --is-ancestor aea57bdef origin/dev` ⇒ 否 ⇒ 要等它推上去才算勾。~~
--
-- □ ② `order_pending_refunds.settled_at` 有寫入端
--      🔴 **未完成**。`20260901080000:216` 逐字「三態的另外兩態(**今天零寫入端**)」。
--      🔬 我 2026-09-08 量:全 migrations `SET settled_at` ⇒ **0**;
--         🟢 正對照 `SET payment_status` ⇒ **20 支檔**(尺會動)· ⚪ 負對照 ⇒ **0**。
--      🔬 **2026-09-08 下午複量(換一把更寬的尺, 怕原尺太窄)**:
--         `grep -rlE "SET[[:space:]]+settled_at|settled_at[[:space:]]*="` ⇒ **1 支檔**,
--         而那一支**就是本檔**, 且**剝掉行註解後命中 0 行** ⇒ 🔴 **那是我自己的註解, 不是寫入端。**
--         🟢 正對照 `SET payment_status` ⇒ **21 支檔** · ⚪ 負對照 ⇒ **0**。
--      ⇒ 🛑 **②仍未完成。寬尺與窄尺同一個答案。**
--      ⇒ **沒有它, 開出來的待退款列永遠是「已開而未結清」, 沒有人標得掉。**
-- ```
-- 🛑 **兩條【都勾】才可以貼。** 少了這個拆分, 下一個人會以為兩件都沒動 ——
--    而其中一件已經做完了(只是還沒推)。
--
-- ⚠️ **而 codex R3 還列了 8 條 must-fix / nit, 我修了 6 條**(⑤⑥⑦⑧ 與 ③④ 的記錄面):
--    · ③ 本片沒驗它依賴的 trigger / 兜底排程還在線 ⇒ **未修, 記在這裡**:
--      前置閘只釘 `admin_cancel_order` 的本體;若別線停用 `order_pending_refund_open_au`,
--      本片仍能套用、取消仍成功, 而那筆待退款不會被開 ⇒ **而畫面與 audit 與正確案例相同。**
--      ⇒ 🔵 那一格要在【解封那天】補進前置閘(貼之前先問 `pg_trigger` 那支在不在、啟不啟用)。
--    · ④ 「不是 card 就安全」是**開放世界判斷** ⇒ **未修, 記在這裡**:
--      本片與 UI 都只排除 `card`, 而待退款計算器 `20260902030000:84` 只認 `bank_transfer` / `cash`
--      (該檔自己標著「新增第 4 條非卡軌時, 這裡與那裡都要回來改」)
--      ⇒ **第四軌一加入 ⇒ 取消放行、而那一軌不會開待退款 ⇒ 靜默。**
--      ⇒ 🔵 那是一個**跨檔契約**問題, 三個地方各自手抄一份值域;修它不在本片範圍。
-- ══════════════════════════════════════════════════════════════════════

-- ══ 交易邊界(codex R2 must-fix ⑦)════════════════════════════════════
-- 🔴 基準檔 `20260903093000` 在 `:68` / `:976` 明確包住, 而我第一版沒有。
--    ⇒ 📌 **逐句 autocommit 執行時:函式已經換掉, 而 COMMENT / ACL / 後置斷言失敗**
--       ⇒ **留下半套狀態** —— 而那個狀態裡「函式是新的、契約是舊的、權限未複查」。
BEGIN;

-- ══ 前置閘(codex R1 must-fix ⑥ · R2 must-fix ⑥ 強化)════════════════
-- 🔴 `CREATE OR REPLACE` 對一支【不存在】的函式會【建一支新的】, 而新函式帶預設 `PUBLIC EXECUTE`
--    ⇒ 📌 **一支誰都叫得動的、用 owner 權限取消訂單的 SECURITY DEFINER 函式。**
--    ⇒ 所以「它必須已經存在」不是禮貌, 是安全前提 —— 讓「順序貼錯」變成一個**會叫的錯**。
DO $$
DECLARE
  v_src        text;
  -- 🔬 **這個值怎麼來的(可重跑, 不是我抄的)**:
  --    `python3 -c "import hashlib,pathlib; L=pathlib.Path('supabase/migrations/20260903093000_m4b_b4cancelkind_reject_reserved_reason.sql').read_text(encoding='utf-8').splitlines(); print(hashlib.md5(('\n'.join(L[102:555])+'\n').encode()).hexdigest())"`
  --    (`:103` 的 `AS $fn$` 之後到 `:556` 的 `$fn$;` 之前 = PostgreSQL 存進 `prosrc` 的那一段)
  -- 🔴🔴 **而我【沒有】拿正式庫的 `prosrc` 對過 —— 我沒有連線。這個值是【推的】。**
  --    不確定的那一格很具體:**PostgreSQL 存進 `prosrc` 的那一段, 頭尾各含幾個換行**。
  --    我選了「前後各一個換行」, 而**另外兩種我也算了, 一起留在這裡** ——
  --    📌 **撞到的人不必重算, 拿實際值對一次就知道是哪一種**:
  --      前後各一個換行  bd7c79ba2ccc792d3dab5f3b54335582   ← 本片採用
  --      無外框換行      78f3c1d43fa8bd030d2eb77954790ba4
  --      只有前換行      706a5e1de62941a2911e22d33ae49eab
  --    ✅ **實際值怎麼拿(唯讀一發)**:
  --      `SELECT pg_catalog.md5(prosrc) FROM pg_catalog.pg_proc p`
  --      `  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace`
  --      ` WHERE n.nspname='public' AND p.proname='admin_cancel_order'`
  --      `   AND pg_catalog.pg_get_function_identity_arguments(p.oid)='uuid, uuid, text, text, text, jsonb';`
  --    🛑 **若實際值命中上面另外兩個之一 ⇒ 那是我框錯換行, 不是線上漂移** ⇒ 改這一行的值即可。
  --    🛑 **若三個都不是 ⇒ 那才是真的漂移** ⇒ **停下回報, 不要改這一行讓它過。**
  --    🔵 **而閘算錯的方向是 fail-closed**(它會擋住而不是放行)⇒ 代價是「貼不進去」不是「蓋掉東西」。
  v_expect_md5 text := 'bd7c79ba2ccc792d3dab5f3b54335582';
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_cancel_order'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text, text, text, jsonb';
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置閘:public.admin_cancel_order(uuid,uuid,text,text,text,jsonb) 不存在 ⇒ 停下。'
                    'CREATE OR REPLACE 會建一支【新的】而它帶預設 PUBLIC EXECUTE。先貼 20260903093000。';
  END IF;
  -- 🔴🔴 **漂移閘(codex R2 must-fix ⑥ 把弱訊號換成強指紋)**
  --    ⛔ ~~只查 `strpos(prosrc,'payment_expired') > 0`~~ —— codex 逐字:「**弱訊號**,
  --       未知 hotfix、舊版、甚至註解只要保留這個字就會通過;等價重構若移除字面則誤擋」。
  --    ✅ 改成 **md5(prosrc) 精確比對**:它對「一個字不一樣」都會叫, 而那正是這裡要的
  --       —— 我要蓋掉的是【一個我讀過的、逐字已知的版本】, 不是【一個看起來像它的版本】。
  --    🛑 **而 md5 也答不出一件事, 寫在這裡**:它比的是 `prosrc`(函式體),
  --       **`ALTER FUNCTION` 改掉的 `SET` 子句 / owner / ACL 不在 `prosrc` 裡** ⇒ md5 相同而那些可能已漂移。
  --       ⇒ 那一半交給下面的收權三行與後置斷言, **兩道各守一半, 不可只留一道。**
  IF pg_catalog.md5(v_src) <> v_expect_md5 THEN
    RAISE EXCEPTION '前置閘:線上 admin_cancel_order 的函式體 md5 = % , 而本片預期 % '
                    '⇒ 停下。線上那一支不是我讀過的那一版(可能有 hotfix / 漂移 / 更新的代), '
                    '整段 CREATE OR REPLACE 會把它安靜地蓋掉。',
                    pg_catalog.md5(v_src), v_expect_md5;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text,
  p_items           jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_order       record;
  v_existing    record;
  v_audit       record;
  v_detail      text;
  v_hash        text;
  v_reason_txt  text;
  v_canon       text;
  v_cid         uuid;
  v_bad         bigint;
  v_cnt         integer;
  v_expect      integer;
  v_partial     boolean;
  v_closed      boolean;
  v_generic_msg constant text := 'admin_cancel_order: 取消失敗';
BEGIN
  -- 步1 隔離閘(A8c 家族同款;RR 等鎖醒來舊快照會漏看真相表)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_cancel_order: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(輸入類=具體訊息;§5.1d 七值映射=可測合約)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 冪等鍵缺失';
  END IF;
  v_reason_txt := CASE p_reason_code
    WHEN 'customer_request' THEN '依您要求取消'
    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
    WHEN 'other'            THEN NULL
    ELSE NULL END;
  IF v_reason_txt IS NULL AND p_reason_code IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'admin_cancel_order: 未知取消原因碼';
  END IF;
  v_detail := pg_catalog.btrim(p_reason_detail);
  IF v_detail = '' THEN v_detail := NULL; END IF;
  IF p_reason_code = 'other' THEN
    -- 判空白=A7 CHECK 同款明列碼位(僅判定;入庫/hash/對客=btrim 原文,不剝內部字元)
    IF v_detail IS NULL OR pg_catalog.translate(v_detail,
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\00AD\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\2028\2029\202F\205F\2060\2800\3000\3164\FEFF',
         '') = '' THEN
      RAISE EXCEPTION 'admin_cancel_order: other 需填取消說明';
    END IF;
    -- 🔴🔴 **員工原文不得撞上【機器碼】**(⟦b4-CANCELKINDBYCONTENT⟧, 2026-09-03)。
    --    病:`orders.cancelled_reason` 這一欄裝的是**中文散文**(上面那張七值映射),
    --    而 `other` 這條路裝的是**員工當場打的原文**;同一欄裡混著**一個機器碼**
    --    `payment_expired`(L3 自動失效寫的,`…l3a_expire_unpaid_orders_fn.sql:174`)。
    --    而讀的那一端拿那個字面**判身分**(`order-cancel-reason.ts:82`)
    --    ⇒ 🎯 **員工打 `payment_expired` ⇒ 客人的訂單頁對他陳述一個錯的取消原因。**
    --
    -- 🛑 **為什麼是【拒絕】而不是【靜靜改寫】—— 理由是機制不是禮貌**:
    --    本檔上面那段(`:31-32`)記著:冪等回放端拿 `orders.cancelled_reason`
    --    跟**重算的映射**比,`IS DISTINCT FROM` 就 `RAISE`。
    --    ⇒ **改寫 ⇒ 冪等重放會爆。那不是權衡,那是壞掉。**
    --
    -- ⚠️ **射程:精確、大小寫敏感、不做正規化** —— 而那是【對齊讀的那一端】不是偷懶:
    --    · 讀端兩處都是 JS `===`(`order-cancel-reason.ts:82` / `cancel-view.ts:686`)
    --      ⇒ `Payment_Expired` **不會**被讀成機器碼 ⇒ 擋它就是**誤擋**員工一個合法的字。
    --    · 前後空白已由上面 `pg_catalog.btrim` 處理掉 ⇒ 這裡看到的就是入庫值。
    --    ⇒ 📌 **擋的形狀 = 讀的形狀。多擋一格是假指控, 少擋一格是漏。**
    IF v_detail = 'payment_expired' THEN
      RAISE EXCEPTION 'admin_cancel_order: 取消說明不可使用系統保留字「payment_expired」——'
        ' 那是系統給【未付款自動失效】用的代號, 填它會讓客人在訂單頁看到錯的取消原因。'
        ' 請改用其他說明, 或選擇對應的取消原因碼。';
    END IF;
    v_reason_txt := v_detail;
  ELSIF v_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 非 other 不得填說明';
  END IF;
  -- Δ p_items 具名矩陣驗(v2b;jsonb 同 object 重複 key=last-key-wins、收到前已丟失=誠實邊界)
  v_partial := p_items IS NOT NULL;
  IF v_partial THEN
    IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項清單需為非空陣列';
    END IF;
    -- 先判 typeof 再數鍵(兩段式;SQL OR 不保證短路,scalar 元素碰 jsonb_object_keys 會 22023 訊息失控)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el) <> 'object') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (SELECT count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 2
                   OR NOT (el ? 'order_item_id') OR NOT (el ? 'quantity')) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                   OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項識別碼格式錯誤';
    END IF;
    -- 數量:jsonb number 且十進位整數字面(1.0/字串/boolean/null 全拒=canonical 單一產生式)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'quantity') <> 'number'
                   OR (el->>'quantity') !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量需為正整數';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (el->>'quantity')::numeric < 1 OR (el->>'quantity')::numeric > 2147483647) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量超出範圍';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_items) e(el))
       <> (SELECT count(DISTINCT (el->>'order_item_id')::uuid) FROM pg_catalog.jsonb_array_elements(p_items) e(el)) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項重複';
    END IF;
    -- canonical 串:uuid 正規化後文字升冪、qty=驗證後 int 的 ::text(零雙 hash 面——
    -- 生 JSON 文字排序/去重會讓大寫 uuid 變體產生第二 hash 並繞過重複檢查,關卡2 抓)
    SELECT pg_catalog.string_agg(((el->>'order_item_id')::uuid)::text || '=' || ((el->>'quantity')::integer)::text,
                                 ',' ORDER BY ((el->>'order_item_id')::uuid)::text)
      INTO v_canon
      FROM pg_catalog.jsonb_array_elements(p_items) e(el);
  END IF;

  -- 步3 orders FOR UPDATE(第一觸表動作;§5.0 鎖序合約)
  SELECT id, payment_status, cancelled_at, cancelled_reason INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'a8a1:v1:' || p_order_id::text || ':' || p_reason_code || ':' || coalesce(v_detail,'')
      || CASE WHEN v_partial THEN ':partial:' || v_canon ELSE ':full' END,
    'UTF8')), 'hex');

  -- 步4 冪等格(驗全產物集+硬不變式;任一不符=fail-loud;plan v2c §3.2-4)
  SELECT id, payload_hash, actor, reason_code, reason_detail INTO v_existing
    FROM public.order_cancellations
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- hash 欄自身竄改由這裡抓(hash=輸入導出;header 欄位竄改由下方不變式抓)
    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ①header reason 欄位對輸入
    IF v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.reason_detail IS DISTINCT FROM (CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ②逐品項硬不變式 0 ≤ Σci ≤ quantity(bigint)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                 WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ③關單等價 + closing audit 判形 + reason 恰=closing header 映射
    IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (
          SELECT 1 FROM public.order_items oi
           WHERE oi.order_id = p_order_id
             AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                            WHERE ci.order_item_id = oi.id), 0) < oi.quantity::bigint)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    IF v_order.cancelled_at IS NULL THEN
      IF v_order.cancelled_reason IS NOT NULL THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      -- 恰一筆 closing audit(after.closed=true 或 A8a1 三鍵關單形)且對客文字=其 header 映射
      IF (SELECT count(*) FROM public.admin_audit_log g
           WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
             AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                  OR (NOT (g.after ? 'closed')
                      AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                      AND (g.after->>'cancelled_at') IS NOT NULL))) <> 1 THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      IF v_order.cancelled_reason IS DISTINCT FROM (
           SELECT CASE c.reason_code
                    WHEN 'customer_request' THEN '依您要求取消'
                    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
                    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
                    WHEN 'price_change'     THEN '訂單已取消,詳情請洽客服'
                    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
                    WHEN 'internal_error'   THEN '訂單已取消,詳情請洽客服'
                    WHEN 'other'            THEN c.reason_detail
                    ELSE NULL END
             FROM public.admin_audit_log g
             JOIN public.order_cancellations c ON c.id = (g.after->>'cancellation_id')::uuid
            WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
              AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                   OR (NOT (g.after ? 'closed')
                       AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                       AND (g.after->>'cancelled_at') IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ④本 header 集合等式(雙向;整單=存在性條件化)
    IF v_partial THEN
      IF (SELECT count(*) FROM public.order_cancellation_items ci WHERE ci.cancellation_id = v_existing.id)
         <> pg_catalog.jsonb_array_length(p_items)
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                     WHERE NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                        WHERE ci.cancellation_id = v_existing.id
                                          AND ci.order_item_id = (el->>'order_item_id')::uuid
                                          AND ci.cancelled_quantity = (el->>'quantity')::integer)) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        LEFT JOIN public.order_cancellation_items hc
               ON hc.cancellation_id = v_existing.id AND hc.order_item_id = oi.id
        CROSS JOIN LATERAL (SELECT oi.quantity::bigint
                 - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                              WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_existing.id), 0) AS rem) r
        WHERE oi.order_id = p_order_id
          AND ((r.rem > 0 AND hc.cancelled_quantity::bigint IS DISTINCT FROM r.rem)
               OR (r.rem <= 0 AND hc.order_item_id IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ⑤payment 允許集合(A8a3:與步7 **同一條述詞**)+ 零在途 attempts
    -- 🔴 這裡不同步改的話:現金單第一次取消得了,而重送同一顆冪等鍵會在這裡被擋
    --    ⇒ 外觀是「隨機失敗」。三處述詞(步7 / 本處 / audit 快照)必須一起改。
    IF (v_order.payment_status <> 'unpaid'::public.payment_status
         -- 🔴 partiallyPaid 只在【整單取消】那條路放行(codex R1 must-fix ②③;主視窗 A Q-F 拍甲)
         --    部分取消【刻意仍然擋著】—— 不是遺漏:那個世界裡錢已收、部分取消零紀錄
         --    (`20260901080000:60-62` 逐字「部分取消不開待退款…收了的錢仍然零紀錄」),
         --    而結算器 P2 要求「完全沒有取消痕跡」(`20260901030000:1188-1192`)
         --    ⇒ 取消之後不可計算 ⇒ needs_human ⇒ 訂單永遠停在 partiallyPaid。
         AND NOT (v_order.payment_status = 'partiallyPaid'::public.payment_status
                  AND NOT v_partial
                  AND EXISTS (SELECT 1 FROM public.order_payments op
                               WHERE op.order_id = p_order_id)
                  AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                   WHERE op.order_id = p_order_id AND op.rail = 'card'))
         AND NOT (v_order.payment_status = 'paid'::public.payment_status
                  AND EXISTS (SELECT 1 FROM public.order_payments op
                               WHERE op.order_id = p_order_id)
                  AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                   WHERE op.order_id = p_order_id AND op.rail = 'card')))
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts pa
                   WHERE pa.order_id = p_order_id AND pa.status <> 'failed') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ⑥audit 恰一列且全欄相符(request_id 非 UNIQUE ⇒ 必數恰 1;closed 鍵條件比)
    SELECT g.* INTO v_audit FROM public.admin_audit_log g
     WHERE g.request_id = p_idempotency_key::text
       AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text;
    IF (SELECT count(*) FROM public.admin_audit_log g
         WHERE g.request_id = p_idempotency_key::text
           AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text) <> 1
       OR v_audit.actor IS DISTINCT FROM p_actor
       OR v_audit.reason IS DISTINCT FROM p_reason_code
       OR v_audit.source_app IS DISTINCT FROM 'admin'
       OR (v_audit.after->>'cancellation_id')::uuid IS DISTINCT FROM v_existing.id
       -- 快照比對(A8a1/a8a2 原為「before 整顆等值 + after 恆 unpaid」)。
       -- 🔴 **A8a3 把上面那句換掉,因為它已經不成立**:payment_status 的值域從單值 'unpaid'
       --    放寬成 {'unpaid','paid'} ⇒ 「整顆等值」寫不出來了。改成五道:鍵在 + 鍵數 + 型別 + 值域 + 前後一致。
       -- 🔴 **鍵在**與**型別**缺一不可:`->>` 對【缺鍵】與【JSON null】都回 NULL
       --    ⇒ 只驗取值的話,把鍵刪掉再塞一個別的鍵會整組穿過去(codex 關卡1 R2 的 C-1)。
       -- 🔴 **本段守的是「鍵形 + 值域 + 前後一致」,不守「值被整組替換」**:
       --    把 before 與 after 同時從 paid 改成 unpaid,本段抓不到 —— 逐字寫在這裡,不藏。
       --    擋它的在別層:admin_audit_log 對 service_role **只有 INSERT**
       --    (20260712210000:110-115 兩道 apply 期 ACL 斷言)且該表零 trigger(:161)
       --    ⇒ 要改那兩個值得有表 owner 權限,已不在本函式的射程內。
       OR NOT (v_audit.before ? 'payment_status')
       OR NOT (v_audit.before ? 'cancelled_at')
       OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.before)) <> 2
       OR pg_catalog.jsonb_typeof(v_audit.before->'cancelled_at') <> 'null'
       OR pg_catalog.jsonb_typeof(v_audit.before->'payment_status') <> 'string'
       OR v_audit.before->>'payment_status' NOT IN ('unpaid', 'paid', 'partiallyPaid')
       OR v_audit.after->>'payment_status' IS DISTINCT FROM (v_audit.before->>'payment_status') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 權威值=本 op audit;缺鍵=判形 fallback(v2c:唯 A8a1 三鍵關單形 → true,其餘病理 RAISE)
    IF v_audit.after ? 'closed' THEN
      -- 鍵在:恰 4 鍵+值必 boolean(加鍵/JSON null/字串竄改=病理;codex R2 MF2)
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) <> 4
         OR pg_catalog.jsonb_typeof(v_audit.after->'closed') <> 'boolean' THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      v_closed := (v_audit.after->>'closed')::boolean;
    ELSIF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) = 3
          AND (v_audit.after->>'cancelled_at') IS NOT NULL THEN
      v_closed := true;
    ELSE
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- after.cancelled_at 與 closed 同形(codex R2 MF2:部分 audit 被塞非 NULL cancelled_at=病理)
    IF v_closed <> ((v_audit.after->>'cancelled_at') IS NOT NULL) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 值交叉核對(關卡2 折入):audit 宣稱已關 ⇒ orders 必已關(反向=部分 op 的 false
    -- 在單子後來被關掉=合法,不設反向)
    IF v_closed AND v_order.cancelled_at IS NULL THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('cancelled', true,
      'cancellation_id', v_existing.id, 'idempotent', true, 'closed', v_closed);
  END IF;

  -- 步5 已取消守門+帳本健康閘(v2:新鍵也驗;PS4 的 header-only 病理由③擋)
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_order.cancelled_reason IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_items oi
                 WHERE oi.order_id = p_order_id
                   AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                  WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint)
     OR EXISTS (SELECT 1 FROM public.order_cancellations c
                 WHERE c.order_id = p_order_id
                   AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                    WHERE ci.cancellation_id = c.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步6 actor 存在且啟用(FK 只擋不存在;A7 債⑥)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步7 允許集合(A8a3 放寬:unpaid **或** 非卡已付款;attempts 那一半逐字不動)
  -- 🔴 判準讀 public.order_payments.rail 的集合,**不讀 orders.payment_channel**
  --    (該欄 DEFAULT 就是 'tappay'、正式庫 19/19 都是它 ⇒ 它是常數不是資料;W2 2026-08-19 實量)。
  -- 🔴 零收款列 ⇒ 不放行(態 C fail-closed):正式庫有一張 refunded 而收款帳本零列的舊單。
  -- 🔴 **刻意不看淨額**(不加 SUM(amount) > 0):那道條件在並行下會翻面 ——
  --    並行插入一筆人工正額會把「不可取消」變「可取消」(codex 關卡1 R2 的 E-1)。
  --    殘餘風險與落地必驗寫在 backlog #764,不留在 commit body。
  -- 🔴 attempts 那一半**一個字不動** ⇒ 20260809160000 L3a COMMENT 的跨檔不變式
  --    「cancelled ⇒ 無 active attempt」不受影響;而刷卡單照樣被它擋住,不必為它另寫一道閘。
  IF (v_order.payment_status <> 'unpaid'::public.payment_status
       -- 🔴 partiallyPaid 只在【整單取消】那條路放行(codex R1 must-fix ②③;主視窗 A Q-F 拍甲)
       --    部分取消【刻意仍然擋著】—— 不是遺漏:那個世界裡錢已收、部分取消零紀錄
       --    (`20260901080000:60-62` 逐字「部分取消不開待退款…收了的錢仍然零紀錄」),
       --    而結算器 P2 要求「完全沒有取消痕跡」(`20260901030000:1188-1192`)
       --    ⇒ 取消之後不可計算 ⇒ needs_human ⇒ 訂單永遠停在 partiallyPaid。
       AND NOT (v_order.payment_status = 'partiallyPaid'::public.payment_status
                AND NOT v_partial
                AND EXISTS (SELECT 1 FROM public.order_payments op
                             WHERE op.order_id = p_order_id)
                AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                 WHERE op.order_id = p_order_id AND op.rail = 'card'))
       AND NOT (v_order.payment_status = 'paid'::public.payment_status
                AND EXISTS (SELECT 1 FROM public.order_payments op
                             WHERE op.order_id = p_order_id)
                AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                 WHERE op.order_id = p_order_id AND op.rail = 'card')))
     OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                 WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步8 品項守門(鎖 items NKU 按 id 序=排序契約;額度只由真相算;摘要只驗在場不讀值)
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
   ORDER BY oi.id
   FOR NO KEY UPDATE;
  SELECT count(*) INTO v_cnt FROM public.order_items x WHERE x.order_id = p_order_id;
  -- 零品項單 fail-closed(row 36「零明細 header」;A7-t presence 是 DEFERRED 且訊息非通用,不倚賴)
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 摘要在場一致閘(row 37 fail-closed 正解):真相非零的品項必有 summary 列,缺列=毀損 RAISE
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                       JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                      WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0
           OR coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0) > 0)
      AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_partial THEN
    -- 請求品項必屬本單
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE NOT EXISTS (SELECT 1 FROM public.order_items oi
                                   WHERE oi.id = (el->>'order_item_id')::uuid AND oi.order_id = p_order_id)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- 可取消量守門:增量 ≤ quantity − instock − cancelled(bigint;Q17=B;shipped 退化式)
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
      JOIN public.order_items oi ON oi.id = (el->>'order_item_id')::uuid
      WHERE (el->>'quantity')::bigint > oi.quantity::bigint
            - coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                          JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                         WHERE p.order_item_id = oi.id AND r.quantity > 0), 0)
            - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    v_expect := pg_catalog.jsonb_array_length(p_items);
  ELSE
    -- 整單(含部分歷史收尾):任一品項有到貨 ⇒ 拒(Q17=B);全增量=0 ⇒ 拒(殘態重呼)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                                  JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                                 WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    SELECT count(*) INTO v_expect FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0);
    IF v_expect = 0 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;

  -- 步9 寫入(同交易;items 按 order_item_id 序=排序契約;append-only)
  INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)
  VALUES (p_order_id, p_actor, p_idempotency_key, p_reason_code,
          CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END, v_hash)
  RETURNING id INTO v_cid;
  IF v_partial THEN
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, (el->>'order_item_id')::uuid, (el->>'quantity')::integer
      FROM pg_catalog.jsonb_array_elements(p_items) e(el)
     ORDER BY ((el->>'order_item_id')::uuid)::text;
  ELSE
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, oi.id,
           (oi.quantity::bigint - coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                              FROM public.order_cancellation_items ci
                                             WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0))::integer
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0)
     ORDER BY oi.id;
  END IF;
  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充請求集;必=預期筆數
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_expect THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 關單判定:寫後全域重算(此值=audit.closed=重放權威)
  v_closed := NOT EXISTS (
    SELECT 1 FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0));
  IF v_closed THEN
    UPDATE public.orders
       SET cancelled_at = pg_catalog.now(),
           cancelled_reason = v_reason_txt,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id;
    -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
    GET DIAGNOSTICS v_bad = ROW_COUNT;
    IF v_bad <> 1 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', CASE WHEN v_closed THEN pg_catalog.now() ELSE NULL END,
            'cancellation_id', v_cid, 'closed', v_closed),
          p_reason_code, 'admin');
  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('cancelled', true, 'cancellation_id', v_cid,
    'idempotent', false, 'closed', v_closed);
END;
$fn$;

-- ══ COMMENT 附加(codex R1 must-fix ④)════════════════════════════════
-- 🔴 現行 COMMENT 逐字寫著允許集是「unpaid 或(paid 且…)」⇒ 本片之後那句是【假合約】。
--    📌 而它會咬人的方式很具體:下一個依 COMMENT 去改三處的人, 會把 partiallyPaid 再刪掉一次。
-- 🔵 附加不覆蓋(`CREATE OR REPLACE` 保留 COMMENT;讀不到就停, 不用一句新的蓋掉四代契約)。
DO $$
DECLARE v_old text;
BEGIN
  v_old := pg_catalog.obj_description(
    'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure, 'pg_proc');
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'COMMENT 附加:讀不到既有 COMMENT ⇒ 停下(不要用一句新的蓋掉四代契約)';
  END IF;
  IF pg_catalog.strpos(v_old, '20260908060000') > 0 THEN
    RAISE NOTICE 'COMMENT 附加:已附加過 ⇒ 略過(本段冪等)';
  ELSE
    EXECUTE pg_catalog.format(
      'COMMENT ON FUNCTION public.admin_cancel_order(uuid,uuid,text,text,text,jsonb) IS %L',
      v_old || ' 🔴 2026-09-08(⟦b4-PARTPAIDNOCANCEL1⟧, 落點 20260908060000):允許集合再放寬一格 —— '
            || '**partiallyPaid 且【整單取消】且有收款列且無 rail=''card'' 的列** 亦放行。'
            || '成因:20260904230000 讓收到錢的匯款單翻成 paid / partiallyPaid, '
            || '而 partiallyPaid 落在舊允許集外 ⇒ 收了訂金的匯款單按不下取消。'
            || '🛑 **部分取消【刻意仍然擋著】, 不是遺漏**:那個世界裡錢已收、'
            || '部分取消不開待退款(20260901080000:60-62)、結算器 P2 要求無取消痕跡'
            || '(20260901030000:1188-1192)⇒ 訂單永遠停在 partiallyPaid。'
            || '要放行部分取消, 前提是先答「部分取消該退多少」那個口徑題 —— 而那題沒有人答過。'
            || 'audit 快照值域同步放寬成 {unpaid, paid, partiallyPaid}(三處述詞必須一起改)。');
  END IF;
END
$$;

-- ══ 收權(codex R1 must-fix ⑦;縱深, 逐字抄自 20260903093000:874-876)══
-- 🔴 `CREATE OR REPLACE` 本來就保留 ACL —— 而「本來就」的前提是**它已經存在**。
--    上面的前置閘擋住了不存在那條路;這三行是**第二道**, 對付 ACL 漂移。
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;

-- ══ 後置斷言:閉世界白名單(codex R1 must-fix ⑦ + 主視窗 A 指名)══════
-- 🔴 **不是查「grantee = 0」** —— 今晚 `-refund` 的 codex F4 抓過同型:
--    **只撤 PUBLIC, 而 anon / authenticated 有具名預設授權** ⇒ 那種尺會放行。
-- ✅ 改成:**owner 與 service_role 以外的任何 grantee 都炸。**
DO $$
DECLARE v_bad text;
BEGIN
  -- 🔴 **#4:owner 比 OID 不比顯示名**(codex R2:「owner 不是 postgres 時誤炸;
  --    postgres 不是 owner 卻另有權限時反而誤放」)⇒ 用 `x.grantee = p.proowner`。
  -- 🔴 **#5:再加一道【有效權限】** —— 直接 ACL 乾淨不代表叫不動:
  --    `anon` / `authenticated` 若能 `SET ROLE` 到某個被授權的角色, ACL 清單仍然漂亮。
  --    ⇒ 下面第二段用 `pg_has_role(..., 'USAGE')` 問**繼承之後的有效權限**。
  SELECT string_agg(DISTINCT a.grantee, ', ')
    INTO v_bad
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) x
    CROSS JOIN LATERAL (SELECT coalesce(pg_catalog.pg_get_userbyid(x.grantee), 'PUBLIC') AS grantee) a
   WHERE n.nspname = 'public' AND p.proname = 'admin_cancel_order'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid, uuid, text, text, text, jsonb'
     AND x.privilege_type = 'EXECUTE'
     AND x.grantee IS DISTINCT FROM p.proowner
     AND a.grantee <> 'service_role';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '後置斷言①(直接 ACL):admin_cancel_order 的 EXECUTE 出現不該有的 grantee ⇒ %', v_bad;
  END IF;

  -- 🔴 **後置斷言②(有效權限;codex R2 must-fix ⑤)** —— 前一段只看【ACL 資料列】,
  --    而「叫不叫得動」還要過角色繼承。`has_function_privilege` 問的正是繼承之後的結果。
  --    🛑 兩段【不可只留一段】:①抓「被直接授權」②抓「透過繼承拿到」, 而兩者可以獨立發生。
  SELECT string_agg(r.rolname, ', ')
    INTO v_bad
    FROM pg_catalog.pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated', 'PUBLIC')
     AND pg_catalog.has_function_privilege(
           r.rolname,
           'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure,
           'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '後置斷言②(有效權限):% 仍然叫得動 admin_cancel_order —— '
                    'ACL 資料列乾淨不代表叫不動(角色繼承 / SET ROLE)。', v_bad;
  END IF;
END
$$;

COMMIT;
