import type { PaymentListData } from './payment-list';

// manual-refund-entry-gate.ts — M-4b E10 D3:非卡退款登記入口「該不該渲染」的純判斷。
//
// 🔴 與 `refund-entry-gate.ts`(TapPay 線)刻意不同的兩點:
//    ① **判斷讀 `order_payments.rail`,不讀 `orders.payment_channel`** —— 片A/片B(取消線)
//       已經證明 `payment_channel` 幾乎是常數、不可靠(`cancel-view.ts:209-211,680-681`,
//       commit `0a09359b`:片A 改了 RPC 讀 `rail`,前端仍用舊判準造成兩份規格漂移的教訓)。
//    ② **不比對 `paymentStatus`**(TapPay 線用 `REFUND_ENTRY_STATUSES` 限 `paid`/`partiallyRefunded`)
//       —— `admin_record_manual_refund`(D1)不寫 `orders.payment_status`(無 trigger,D1 header
//       段自陳零寫入 GRANT 之外的行為),那顆欄位只反映 TapPay 退款的狀態機,拿來限制非卡
//       登記入口會產生假陰性(現金已付款單的 `paymentStatus` 不會因登記而改變,用它當閘
//       只會在「這張單根本沒有任何卡片退款」時錯誤地隱藏入口)。
//
// 帳本健康閘與 TapPay 線相同(同一組 `refundUnregisteredAmount`/`refundUnregisteredFailed`
// 輸入):讀不到或負值(對帳異常)時 fail-closed,理由同 refund-entry-gate.ts。

/**
 * 🔴🔴 **`#787` 臨時硬閘 —— 仍然封著。而封著它的理由,已經不是當初那個。**
 *
 * ── ① 三條解除條件 2026-08-24 全部成立(`#806` 量的)────────────────────────
 * 第③條是**對 DB 量到的**,不是照帳本推的。原始查詢與輸出:
 * ```
 * select p.proname, has_function_privilege('service_role', p.oid, 'EXECUTE') as can_exec, p.proacl
 *   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 *  where n.nspname = 'public'
 *    and p.proname in ('admin_void_manual_refund','admin_record_manual_refund','mark_charge_attempt_failed');
 *
 *  admin_record_manual_refund | true  | {postgres=X/postgres,service_role=X/postgres}     ← 正對照
 *  admin_void_manual_refund   | true  | {postgres=X/postgres,service_role=X/postgres}     ← 要查的那個
 *  mark_charge_attempt_failed | false | {postgres=X/postgres,payment_confirmer=X/postgres} ← 負對照
 * ⇒ 三個值不全一樣 ⇒ 尺是活的,那個 true 是真的。(Sean 在 SQL Editor 跑)
 * ```
 *
 * ── ② 🔴 而三條件成立【不等於】可以解除 ────────────────────────────────
 * 2026-08-24 照三條件解除之後,codex 對抗審查當場構造出一條路(主視窗與本窗各自複打成立):
 * ```
 * 持有效後台 session ⇒ 直接送 recordManualRefundAction(不經畫面)
 *   ⇒ 一張純刷卡、未付款的單 ⇒ 金額 ≤ 訂單總額
 *   ⇒ 寫進一筆假的人工退款 ⇒ **永久扣低可退餘額**
 * 擋不住它的原因有兩層:
 *   · UI 這道的 rail 條件(下方 `row.rail === 'bank_transfer' || 'cash'`)**server 端沒有重驗**
 *   · RPC 的額度上限(`20260820100000:230-231`)用的是 `o.total`(**訂單總額**),
 *     不是【該軌淨實收】⇒ 沒有收過現金的單也有額度可扣
 * ```
 * ⇒ 缺的是一道**不存在的 server 不變式**:**退款不得超過該軌(現金/匯款)的淨實收**。
 * ⇒ 🔴 **那件事有編號了:`#866`**(動 RPC ⇒ 鐵則 12③ + 12①,另一片、要 Sean 批)。
 *
 * ── ③ 🔴🔴 所以:這道封印現在的理由,與當初立它時【不是同一個】────────────
 * 當初封它是因為「登記錯了改不掉」(沖銷入口沒開);**那件事 2026-08-22 已經解決**。
 * **現在封著它的是 `#866`** —— 一個當初三條解除條件裡**一個字都沒提到**的東西。
 * ⚠️ 沒有這一段,下一個人會看到「三條件全成立而還封著」,然後**以為有人忘了解**。
 *
 * ── 📌 這一片留下來最該被帶走的一句 ──────────────────────────────────
 * > **解除一道封印之前,問的不是「條件到齊了嗎」,是「它現在還擋著什麼」。**
 *
 * 而那兩個問題的**答案來源不同**:
 * · 「條件到齊了嗎」**查得到** —— 條件是寫下來的。
 * · 「它還擋著什麼」**沒有任何檔案列得出來** —— 只能**從消費端反推**:
 *   grep 這顆旗標的每一個讀取點,逐個問「拿掉它之後,這裡還剩什麼閘」。
 * 🔴 2026-08-24 有**四個地方**都沒問那一句:backlog 條目 / 盤點清單 / 派工單 / 施工窗的 plan。
 */

/** 見上方檔頭:`#787` 解除前這裡恆 true。寫成具名常數(不是行內 `true` 字面),
 *  是為了不讓下面保留的真實判斷邏輯被 lint 的 no-unreachable 當死碼砍掉。
 *  🔴 **匯出是為了讓 `manual-refund-787-trigger.test.ts` 讀得到它。**
 *  ⚠️ **要暫時關掉這個入口的人:兩道都要關** —— 只關這裡關不住直接送 server action 的請求
 *     (理由寫在 `lib/payment/manual-refund-actions.ts` 那道的旁邊)。
 *
 *  ── 🔴🔴 **要【開封】的那個人:先讀這一段。它不在 `#866` 裡,它在這裡,因為你會經過這裡。**
 *  ```
 *  這道封印今天擋著的那個東西,線C 2026-08-29 23:2x **開檔複量過**(不是讀註解):
 *    supabase/migrations/20260820100000_*.sql:231 逐字仍是 `SELECT o.total::bigint`
 *    ⇒ 額度上限用的是【訂單總額】,不是【該軌(現金/匯款)的淨實收】
 *    ⇒ ⇒ **一張從來沒有收過現金的單,今天仍然有額度可以被扣。**
 *  ```
 *  🔴 **而它今天【按不到】—— 因為就是這顆旗標擋著。⇒ 它是潛伏的,不是正在流血的。**
 *  🔴🔴 **而那正是它危險的地方:你把這顆旗標翻成 `false` 的那一刻,它會【跟著一起上線】。**
 *  ⇒ 📌 **所以「開封」不是一個動作,是兩個**:翻旗標 **且** `#866` 那道 server 不變式要先存在。
 *  ⚠️ 而 `#866` 命中鐵則 12①③(動 RPC)⇒ **要 Sean 批、要 Sean apply**,不是施工窗自己能收的。
 *
 *  ── 🔴🔴 **2026-09-02 更新:上面那句「要先存在」【已經成立了】—— 而它同一天又被鬆開** ──
 *  ⛔ ~~(上面那兩行不刪:它們當時完全正確, 而它們現在會把人帶去錯的結論)~~
 *  ```
 *  ① `#866` 已於 2026-08-24 完成並 apply —— 帳本上兩支各 1 列:
 *       supabase/APPLIED.tsv  20260824010000(建 pcm_manual_refund_rail_cap)
 *                             20260824011000(把它執行起來)
 *     執行的形狀是一道 trigger(不是改 RPC —— 主視窗 2026-08-24 裁【乙】):
 *       trg_pcm_manual_refund_rail_cap  BEFORE INSERT OR UPDATE OR DELETE
 *         ON public.order_manual_refunds  FOR EACH ROW
 *         EXECUTE FUNCTION public.pcm_manual_refund_rail_cap_guard()
 *
 *  ② 🔴 而 `20260902020000_m4b_pcm01_record_not_block.sql` 改的【就是那支 guard 函式】
 *       :94  CREATE OR REPLACE FUNCTION public.pcm_manual_refund_rail_cap_guard()
 *       :43  逐字「`PCM01` 與 `PCM02` 兩段都從 `RAISE EXCEPTION` 變成 `RAISE WARNING`」
 *     ⇒ **那道不變式從【擋】變成【記】。**
 *     🔵 **而那是 Sean 2026-09-02 自己拍的甲(「記得下來, 但標紅」)—— 不是退化, 是決定。**
 *  ```
 *  🛑 **⇒ 所以這道封印的前置條件, 在同一天之內【先被滿足, 又被鬆開】——**
 *     **而【沒有任何一個地方會說這件事】。**
 *  🔴 **而下一個想開封的人會【每一步都做對】然後算錯**:
 *     檔頭叫他打開這裡 → 他讀到「要等 `#866`」 → 他去查 → 做完了、apply 了 → 條件到齊
 *     ⇒ 而他不會知道那道不變式今天是 `WARNING` ⇒ 他翻旗標
 *     ⇒ ⇒ 而上面 `:73-78` 那個「潛伏的」東西(額度上限仍是 `o.total`)跟著一起上線。
 *
 *  🎯 **⇒ ⇒ 所以【開封前要問的第三個問題】, 而它才是這一段的全部價值:**
 *  ## **那道 `WARNING` 有沒有人在看?**
 *     · 有人看 ⇒ 那它仍然是一道防線(慢的那一種)
 *     · 沒人看 ⇒ 那它只是一行 log ⇒ **而封印是今天唯一還在擋的東西**
 *  🔵 而今天「有沒有人在看」那一半已經在做:`⟦b4-RAILCAPAUDIENCE⟧` 首頁那一格
 *     (`components/dashboard/today-summary.tsx` 的「目前退款超出上限」)——
 *     ⚠️ **而它數的只有【超額】那一種**;「算不出上限」那種紅目前沒有觀眾(`⟦5b-CAPUNKNOWNSTATE⟧`)。
 *
 *  ⚠️ **本段沒有驗到的一格, 而它是【驗了也不影響決定】那一種**:
 *     正式庫上那道 trigger 現在實際是哪一版 —— 我讀的是帳本與 migration 檔, 不是 `pg_proc`。
 *     ⇒ 而 `20260902020000` 是 `CREATE OR REPLACE` ⇒ 它一貼就覆蓋 ⇒ **補量也不改變上面的結論。**
 *
 *  📌 **而這一段為什麼貼在這裡而不是留在 `#866`**:
 *     風險住在檔案上,而指令下在人身上 —— 一個要開封的人**一定會打開這一行**,
 *     而他**不一定會去翻 backlog**。⇒ 把它搬到他會經過的那一格。
 *
 *  ── 🔴🔴 **第二件要一起看的事:⟦b4-CAPRACE1⟧(2026-08-31 線DB 實測補進來)** ──────────
 *  **`#866` 那道上限閘【擋得住金額,擋不住兩個人同時按】。** 拋棄式 PG 17.10、`read committed`
 *  (**與正式庫相同**,主視窗 2026-08-31 唯讀複量)實測:訂單只收 1000,兩個 session 各送 600
 *  ⇒ **兩筆都進去,合計 1200**。單發送 1200 則被 `PCM01` 擋 ⇒ **閘是活的,它就是擋不住併發**。
 *  機制:`read committed` 下 B 看不到 A 未提交的那一列 ⇒ 兩邊算出同一個 cap ⇒ 都放行。
 *  📌 **這道閘問的是「我看得到的帳」,而它要答的是「所有人的帳」。**
 *
 *  ✅ **而今天它按不到 —— 靠的不只是這顆旗標,還有一格**:
 *     每一筆人工退款都走 `admin_record_manual_refund`,而它 `20260820021000:216`
 *     **先對 orders 那一列 `FOR UPDATE`** ⇒ 走 RPC 的併發已被序列化。
 *     量測(2026-08-31):非測試碼裡 `.from('order_manual_refunds')` ⇒ **1 支且唯讀**(寫入呼叫 0);
 *     登記路徑 `rpc('admin_record_manual_refund')` ⇒ **恰 1 個呼叫點**
 *     (🔵 正對照:admin 有 `.insert(` 的檔 ⇒ 8 支 ⇒ 尺會動)。
 *  ⇒ 🔴 **所以那條路要走到,得【繞過 RPC 直接下 SQL】** —— app 層不可達。
 *
 *  ✅ **而【權限層】那把尺答得比 app 層更窄**(主視窗 2026-08-31 在正式庫唯讀量):
 *     `order_manual_refunds` 的 **INSERT 權限 ⇒ 只有 `postgres`(一列)** ——
 *     🔴 **連 `service_role` 都沒有**;`anon` / `authenticated` 的任何權限 ⇒ **0**;
 *     RLS ⇒ `true` 而政策 **0 條**(RLS 開 + 零政策 = 全擋)。
 *     🟢 正對照:那張表所有權限筆數 ⇒ 10(尺分得出兩種)· 🔵 負對照 `pcm_audit_ro` ⇒ 0
 *  ⇒ 📌 **兩把【不同層】的尺同向 ⇒ 這個結論才站得住。**
 *     只有 app 層那一發的話它站不住 —— 那是一個「太順的 0」,而好消息型的 0 最不會被回頭查。
 *
 *  🛑 **而【不要】為了修它在那道 trigger 裡加 `orders` 鎖** ——
 *     2026-08-24 主視窗已裁【不加鎖】,理由在 `20260824011000` 檔頭 `:57-72`:
 *       `admin_record_manual_refund` 是 **orders → 子表**;
 *       `admin_void_manual_refund` 對 orders 上鎖 **命中 0** ⇒ **子表 → (加鎖後)orders**
 *     ⇒ 兩種相反順序 ⇒ **死結**(而檔頭逐字記著「C 那支已經因為鎖的形狀踩過一次死結」)。
 *     🔵 **兩個鎖序 2026-08-31 在【正式庫】上被獨立複量過,仍然相反** ⇒ 那個裁定今天仍有效。
 *     ⇒ 它自己寫的失效條件是:**哪天 `admin_void_manual_refund` 改成 orders 先** ⇒ 才回訪。
 *
 *  📌 **⇒ 所以「開封」現在是【三件】不是兩件**:翻旗標 **且** `#866` 不變式存在 **且**
 *     這一格的併發缺口有答案(修法或明確接受)。
 *  🔴 **而這一段之所以貼在這裡,理由與上一段【完全相同】,只是這次是被實證的**:
 *     那個「不要加鎖」的裁定寫在 migration 檔頭第 57 行,而 2026-08-31 **兩個 session
 *     (施工窗與主視窗)各自漏掉同一段、各自推薦了加鎖。**
 *     ⇒ 📌 **一個決定不會自己跳出來說「我是被決定的,不是被漏掉的」。**
 *     ⇒ 所以它被複製到這裡 —— 要翻這一行的人一定會經過。
 *
 *  🔴🔴 **⇒ 而你要翻這一行之前,真正要做的【不是修這個洞】,是【重量那兩格前提】**
 *     (主視窗 2026-08-31 拍乙時指定的形狀,而這是本段最重要的一條):
 *       ① app 層還是零寫入路徑嗎?
 *          量法 `grep -rn "from('order_manual_refunds')" --include='*.ts' apps packages | grep -v test`
 *          ⇒ 命中的每一支都要是唯讀(當時:1 支、寫入呼叫 0)
 *       ② `service_role` 還是沒有 INSERT 嗎?(當時:INSERT 只有 `postgres`)
 *     🔴 **因為那兩格前提就是「不修」這個裁定的【全部理由】** ——
 *        任一格變了,這個洞就從**走不到**變成**走得到**,而**沒有任何東西會叫**。
 *     📌 ⇒ 這一段不是在告訴你「安全」,是在告訴你**它安全的理由是什麼、以及那個理由怎麼過期**。
 *
 *  📎 可重跑的證人:`scripts/caprace1-concurrency-probe.sh`(四個世界,含**必死正對照**:
 *     一個手工造的反向鎖序世界必須真的 `deadlock detected`,否則整發零判別力)。 */
/**
 * 🔴🔴 **你要把下面那個 `true` 改成 `false` 之前 —— 讀這 6 行。**
 *    (⟦c7-LEDGERGATEREFUSES⟧ 線【信】`-mail` 2026-09-07 21:1x 加;
 *     🎯 **寫在這裡而不是只寫在板上, 是因為【打開它的人會打開這支檔, 不會先去讀板】。**)
 *
 * ① **打開它 ⇒ `⟦c7-LEDGERGATEREFUSES⟧` 的四條驗收要【同一天再跑一次】** ——
 *    尤其**真瀏覽器那一格**。📌 **接線對 ≠ 看得見**:
 *    2026-09-07 那一輪證的是「碼寫對了」(`manualRefundRedState` 兩條紅、`defaultOpen` 接同一支判準),
 *    而**入口打開那天要證的是「那個人真的看得到」** —— 那兩件在 code / diff / 三綠上完全一樣。
 *    (R3/Fable 打過的形狀:紅可以從【不存在】變成【存在但沒有人走得到】。)
 *
 * ② **今天的基準線**(`origin/dev=c9a596439` · 2026-09-07 21:14 實跑, 落板文字在
 *    `~/pcm-mailbox/落板文字-LEDGERGATEREFUSES-mail-20260907.md`):**上面那兩格前提【都成立】** ——
 *    · app 層對 `order_manual_refunds` **零寫入路徑**(2 支碼皆 `.select`, 寫入動詞各 0;
 *      `packages/` 側命中全在 `database.types.ts`)
 *    · 唯讀正式庫問**現在的 ACL**:`service_role` ⇒ `sr_insert = f`
 *      (acl 逐字 `service_role=r/postgres`);`anon_insert` 也是 `f`
 *
 * ③ 🔴 **這是【今天】的讀數 —— 它明天不會自己重跑。**
 *    ⇒ 而上面 `:160-172` 那段已經寫明:**那兩格前提就是「不修」這個裁定的全部理由**,
 *      任一格變了這個洞就從走不到變成走得到, **而沒有任何東西會叫。**
 */
/**
 * 🟢🟢 **2026-09-08 開封** —— ⛔ ~~`= true`~~ ⇒ ✅ `= false`。**舊字面留刪除線**,
 *    讓搜 `BLOCKED_BY_787: boolean = true` 的人同一發撞到訂正。
 *
 * **依據**:Sean `QB-14` 拍**乙 = 打開退款登記**;`Q2` 拍**甲 = 在那道測試裡加第三態**。
 *
 * 🔴🔴 **而上面 `:153` 那句「開封現在是【三件】不是兩件」怎麼被滿足的 —— 逐條答,不要跳過**:
 * ```
 * ① 翻旗標                    ⇒ 就是這一行
 * ② #866 那道 server 不變式存在 ⇒ 存在, 而它 2026-09-02 被 Sean 自己拍成【記不擋】
 *                                (RAISE WARNING, 見上方 :93-97)
 *    🛑 ⇒ 所以它今天【不是一道擋門】—— 那是拍板, 不是退化, 而【它就是被接受的那個殘餘風險】
 * ③ 併發缺口(⟦b4-CAPRACE1⟧)有答案 ⇒ 有:「明確接受」而不是「修好了」
 *    🔴 **codex 2026-09-08 收窄**:而 `ACCEPTED_RESIDUAL_RISK` 的 `what` / `row` 只描述
 *       【假收款灌水】那條路(`⟦mail-PAYMENTNOCAP⟧`)—— **它沒有記 `⟦b4-CAPRACE1⟧`。**
 *    🛑 ⇒ **日後 `#885` 關掉時, 不可以據那個物件判定 CAPRACE1 的接受也一起退場。**
 *       📌 兩個殘餘風險, 一份紀錄 ⇒ 而退場條件只寫了其中一個的。
 * ```
 * 🎯 **⇒ 開封不是因為那三件都變綠了, 是因為【第三件被明確接受了】。**
 * ⇒ 📌 **那個接受記在 `manual-refund-787-trigger.test.ts` 的 `ACCEPTED_RESIDUAL_RISK`**,
 *    含 `by` / `on` / `what` / `row` / `expiresWhen` / `why` —— **尤其 `expiresWhen`**:
 *    `E8-B 落地 ⇒ #885 根因消失 ⇒ 該列可關, 本接受同時退場`。
 * 🛑 **⇒ 一個沒有失效條件的「已知情接受」, 與「我們決定不管它」是同一個東西。**
 *
 * ⚠️ **而開封【不會】讓上面 `:73-78` 那個潛伏的東西消失** —— 它跟著一起上線了。
 *    上面 `:178-193` 那段(`⟦c7-LEDGERGATEREFUSES⟧` 的四條驗收要同一天重跑)**現在到期了**。
 *    🔴 **尤其真瀏覽器那一格** —— 09-07 那輪證的是「碼寫對了」,
 *    而今天要證的是「**那個人真的看得到**」。⇒ `bash scripts/admin-probe/up.sh`
 */
export const MANUAL_REFUND_ENTRY_BLOCKED_BY_787: boolean = false;

/**
 * 🔴🔴 ⟦b4-SETTLEDFORMVANISHES⟧ 2026-09-08:**閘拆成兩層, 而拆的位置是有理由的。**
 *
 * 本層 = **結構條件**(這張單有沒有資格出現這個入口)—— 它**不看金額**。
 * 金額那一格由 `manualRefundLedgerSettled` 單獨回答, 而它下放給元件(見該函式的檔頭)。
 *
 * 🛑 **為什麼要拆**:金額那一格會在**送出之後當場改變**
 *    (成功登記 ⇒ `remaining` 掉到 0 ⇒ `manual-refund-actions.ts:139` 的 `revalidateOrderViews`
 *     讓 server 資料當場重取)。而結構條件**不會**。
 * 🔴 ⇒ 把會變的那一格留在 server ⇒ **元件在「有話要說的那一刻」被卸載, 訊息跟著消失。**
 *    ⇒ 📌 所以金額那一格**下放給 client**(當成 `ledgerSettled` 傳進去),
 *       由元件自己決定「我手上有沒有一個未讀的失敗要講」。
 * 🔵 **而結構條件【不下放】** —— 那樣每一張訂單頁都會掛載那個 client 元件
 *    (它有 `useRouter()` 與 `pageshow` listener)。**只有結構上該有入口的單才掛載。**
 */
export function manualRefundEntryEligible(input: {
  payments: PaymentListData;
  refundUnregisteredFailed: boolean;
}): boolean {
  if (MANUAL_REFUND_ENTRY_BLOCKED_BY_787) return false;
  return (
    !input.refundUnregisteredFailed &&
    input.payments.status === 'ok' &&
    input.payments.rows.some((row) => row.rail === 'bank_transfer' || row.rail === 'cash')
  );
}

/**
 * 帳本**已結清**(沒有東西可登記)。⟦b4-ZEROREMAININGSHOWSFORM⟧ 2026-09-08。
 *
 * ⛔ ~~本檔原有一支 `shouldShowManualRefundEntry`(= 結構條件 **且** 金額為正)~~
 * 🔴 **2026-09-08 刪除, 而【刪它的理由是一發存活的突變】**:
 *    ⟦b4-SETTLeDFORMVANISHES⟧ 把閘拆兩層之後, 渲染點改叫 `manualRefundEntryEligible`
 *    ⇒ 那支舊函式**零生產呼叫端**(當場 grep:非測試檔命中 0, 正對照新那支命中 3)
 *    ⇒ 而它**還帶著 8 格測試** ⇒ 📌 **8 格全綠, 而它們守的東西不在路上。**
 *    🛑 抓到它的不是覆蓋率, 是**一發打在結構條件上的突變【存活】** ——
 *       我拿掉 `rail` 那道, 75 格全綠, 因為**沒有一格在測真正決定渲染的那支**。
 *    🎯 ⇒ **一支函式被繞過之後, 它的測試不會變紅 —— 它們會【繼續全綠】。**
 *
 * 🔵 而金額那一格的四個 bucket 值得留在**純函式**裡(不是塞進 tsx 的算式)——
 *    否則它只剩渲染層測得到, 而那一層一發要跑整頁。
 */
export function manualRefundLedgerSettled(refundUnregisteredAmount: number | null): boolean {
  // 🔴 **只有正數才算「還有東西可登記」**。`0`(帳本已把全額佔走)與 `null`(讀不到)都算結清。
  //    而 DB 那端對這兩種**一律拒絕**(`20260905280000:273-276` NULL fail-closed · `:277` 超額)
  //    ⇒ 📌 兩道閘看同一件事就不會分岔。
  // 🔬 `null > 0` 在 JS 是 `false`, 所以 `!== null` 那道**在行為上是冗餘的** ——
  //    而拿掉它 `typecheck` 會紅(`TS18047 possibly null`)⇒ **守它的是型別那把尺, 不是測試。**
  return !(refundUnregisteredAmount !== null && refundUnregisteredAmount > 0);
}
