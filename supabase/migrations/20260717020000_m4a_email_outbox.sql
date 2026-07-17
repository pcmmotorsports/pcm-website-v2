-- ============================================================
-- M-4a Email 通知片 E1a:email_outbox(薄 outbox 表 + ACL + 索引 + fail-closed 斷言)
-- ============================================================
-- 真權威:plan **v3.1** `/Users/sean_1/pcm-tools/review-inbox/m4a-email-notify-plan.md` §4(schema)+ §3.4/§3.5/§3.6/§3.7。
--          (v3.1 = 本片審查鏈逼出的 §3.5-1/§3.6/§4 增補;**E1b/E2a 開工前必讀那三節**。)
--          Sean 拍板(07-16 深夜)= S1=A 做完整版(薄 outbox+sweeper+自動重試+dead-man check)/
--          S2=B 每出一批寄一封 / S3=A 退款後不寄(→ §⑧ 落點)。
--          🔴 **S4(ACL)不是 Sean 主動拍的**:該題列「非必拍」,**Sean 未否決 → 照 Fable 裁示 GRANT
--          service_role 執行**(精確字面見下「ACL 偏離註記」;STATUS 待決策③ 仍掛著供他日後否決)。
--          ⚠️ 勿把「未否決」寫成「已拍板選 GRANT」——兩者不是同一件事。
-- 鐵則 8(schema:新表 + RLS + GRANT/REVOKE)+ 鐵則 12(新 schema/GRANT + 與 order/payment 相鄰)→ commit 前 codex 關卡2。
-- 鐵則 9:本表=營運狀態資料、非內容;信件**文案**分級 L2(Sean 07-16 親拍)由 E3 承擔、不在本片。
--
-- 依賴:`public.orders`(`20260604120000:92-93`,`id uuid PRIMARY KEY` 親驗)。角色沿用 Supabase 既定
--       anon / authenticated / service_role(storefront server 以 sb_secret_ 金鑰 = service_role 連線)。
--
-- 🔴 設計要點(逐條對應 plan v3;含「為什麼不是另一種寫法」):
--   ① **`UNIQUE (event_type, dedup_key)`,不是 `UNIQUE (event_type, order_id)`**(plan §3.7-1):
--      後者是「整單一封」時代的設計,Sean S2=B(每出一批寄一封)下**會擋掉同訂單的第二封出貨信**。
--      · `order_created` 的 `dedup_key = order_id::text` → 語意不變、仍一單一封。
--      · `order_shipped` 的 `dedup_key = 該批的穩定識別` → **算法待 E4 偵察後定**(plan §3.7-2:admin 現況是
--        per-item RPC;`request_id` 不可直接當 key = 雙擊產生兩 id 兩封信)。本片只立欄與唯一鍵,不預設算法。
--      · 故 dedup_key 是**通用 text**、不加格式 CHECK(兩事件型別算法不同;E4 才知第二種長相)。
--   ② **`next_retry_at` NOT NULL**(codex R1-2 銷案):若可 NULL,`next_retry_at <= now()` 對 NULL 不成立
--      → 該列永不進 due 掃描;而對帳補寄又因「outbox 已存在該事件」而略過 → **永久漏信且無人知**。
--      DEFAULT now() = 寫入即到期(立刻可被 sweeper 認領)。
--   ③ **`status='skipped_no_real_email'` 是可翻轉態、不是不可逆終態**(plan §3.4、R2 F1 銷案):
--      LINE 會員 `customers.email` = 合成假信箱 `line_{sub}@line.pcmmotorsports.local`
--      (`apps/storefront/src/lib/auth/line.ts:38` 域常數 + `:48-50` `lineSyntheticEmail()` 組前綴)
--      → E1b 在**寫入前** gate、不呼 Resend、不進 due 索引(`.local` 是 RFC 6762 保留域;寄假地址會拉高 Resend
--      bounce rate〔要求 <4%〕、傷害已驗證網域 pcmmotorsports.com 的寄件信譽 = 全站共用資產)。
--      🔴 這些列**佔住唯一鍵** → 日後 Q1(LINE 補資料獨立線)補到真實 email 時,必須以**受控 UPDATE 原地翻回
--      pending**(換 recipient、重設 next_retry_at),**不可新 INSERT**(會撞唯一鍵 = 該 cohort 永久漏信);
--      且**不得自動回灌**(數月後補寄 order_created 語意本身就錯)→ 是否翻、翻哪些,留 Q1 線設計時決定。
--      故 status CHECK 允許 skipped_no_real_email ↔ pending 互轉,**不在 DB 層鎖死狀態機**(app 層 CAS 負責)。
--   ④ **`ON DELETE RESTRICT`**:對齊 orders 家族慣例(`20260604120000:95` customer_user_id 同款)與 memory
--      `shopify-payment-first-order-phase2-target`「孤兒/未付款單絕不硬刪」→ 兩者一致、無衝突(Fable 已裁)。
--   ⑤ **payload 最小化、非 PII**(plan §4.1):只存**事件時點不可變**且渲染必需的欄(display_id / paid_at /
--      事件版本);品項/金額/地址**寄信時即時查主表**。
--      🔴 **「recipient_email 是唯一 PII 欄」是設計意圖、不是 DB 強制**(codex 關卡2 R4 must-fix,字面已收窄):
--      `payload` 只被 CHECK 約束成 jsonb object(**無 key/型別 allowlist**),`subject`/`dedup_key`/`request_id`
--      皆為自由 text → **一次 DTO spread 或把 provider 回應整包塞進 payload,就能把 email/電話/地址永久
--      複製進本表**,而清理 job 尚未實作(**backlog #281**、E3 上線後升高優先)= 無限期滯留。
--      → **REQUIRED-E1b**:①payload 走**顯式 key/型別 allowlist 組裝**,**禁任意 DTO spread / 禁 `...order`**
--        ②`subject` 只由固定模板 + display_id 組,不夾客戶欄 ③負向測試:塞含 email/phone 的物件必須被
--        組裝層擋掉(不是靠 DB)。本表能給的只有「零 client 權限 + RLS zero-policy」把已落表的 PII 關住,
--        **擋不住「不該落表的東西被寫進來」** —— 那是 E1b 的責任。
--      🔴 `shipping_method` **可後台改** → 補寄前訂單狀態可能已變 → E1b/E2a **送出前重查訂單現況 gate**
--      (S3=A:已退款/取消 → 抑制);payload 不存可變欄正是為此。
--   ⑥ **RLS zero-policy + client 全鎖**(縱深):anon/authenticated 即使誤 grant 也無 policy 可讀;
--      新表預設不在 supabase_realtime publication → 零廣播。recipient_email 絕不對前台開 SELECT/policy。
--   ⑦ 🔴 **`failed` 是雙義的 — 終態界線在 `attempts`、不在 `status`**(code-reviewer R1 must-fix 銷案):
--      每次送失敗即標 `failed` + 退避(推遠 next_retry_at)→ **仍須能被重新認領**(故 CAS 述詞與 due
--      索引都含 failed);只有 `attempts >= max_attempts` 才是「不再重試」的終態(→ 告警、plan §3.6)。
--      🔴 **REQUIRED-E2a(下游硬合約,關卡2 檢核點)**:
--        · sweeper 的 due 述詞**必須**含 `attempts < max_attempts` —— 否則達上限的死列 `next_retry_at`
--          恆已過期、CAS 述詞恆成立 → **無限重試、突破 max_attempts**(plan §3.5-1 引的 CAS 述詞
--          `WHERE id=$1 AND status IN ('pending','failed')` **本身不含此 guard**,照抄即踩)。
--        · 🔴 **CAS 述詞本身也必須含 `attempts < max_attempts`**(R2 nit:認領點才是原子決策點、索引只是
--          最佳化)。TOCTOU:sweeper A 選中 X(attempts=4)→ sweeper B 先把 X 推到 attempts=5/failed →
--          A 的 CAS `WHERE id=X AND status IN ('pending','failed')` **仍成立** → attempts 變 6、多送一次。
--          有界(非無限)但仍是突破上限;guard 下放到 CAS 才真正原子。
--        · dead-man check(plan §3.6)的「最老 pending/failed age」述詞**必須**排除死列 —— 否則終態列
--          age 永增 → 永久告警噪音,把真正的 pg_cron 靜默死亡淹掉(= liveness 唯一來源被廢)。
--        · 🔴 **但排除死列會開另一個洞**(R2 nit,必須同時補):死列僅剩 edge-triggered 終態告警可偵測,
--          而該告警管道 = `EmailAlertNotifierAdapter` = **Resend 本身** → Resend 長時中斷時,全部列耗盡
--          attempts、終態告警**自己也送不出**,恢復後死列已不在 dead-man 的 age 述詞內 → **永久漏信且無人知**
--          (正是 §② 立意要防的失效模式)。故 dead-man **除 age 訊號外,須另加獨立的 level-triggered 訊號**:
--          `dead letter count(status IN ('pending','failed') AND attempts >= max_attempts)> 0 → 告警`。
--          🔴 **必須排除 `sent`/`sending`、但必須含 `pending`**(codex R2 + Fable 實測 F1 兩輪收斂):
--          · 排除 `sent`:只寫 `attempts >= max_attempts` 會**命中第 5 次才送成功的 `sent` 列**
--            (attempts=5、max=5)→ 永久假告警;假告警一旦成常態,真告警就會被當噪音忽略
--            = 把 liveness 訊號本身廢掉。`sending` 同理(仍在途、還沒判生死)。
--          · 🔴 **但不可收窄成只有 `status='failed'`**(Fable 拋棄式 PG 實測擊破):
--            `pending` + `attempts >= max_attempts` 的列會讓**四個述詞全部回 0 = 第四種死法**——
--            訊號1 要 `attempts < max_attempts`、訊號2 要 `failed`、訊號3 要 `sending`,全不命中
--            → 永久漏信且無人知。可達性=合約自己留的門:§3.5-4 lease 回收把 stale sending 翻回
--            **pending**,若 E2a 採「認領時遞增 attempts」(自然寫法、且是唯一能鎖住 crash-loop 毒信的
--            寫法)→ 第 5 次認領後 function 死 → 回收 → `pending@5/5` = 隱形死列。
--            收進 `pending` 零誤報:在 REQUIRED-E2a 的 CAS guard 下,`pending@max` **永遠不可能再被認領**
--            = 定義上就是死列。
--          ⚠️ **E2a 定案「attempts 在認領時或記失敗時遞增」「回收落 pending 或 failed」時,必須回頭過本表**
--            (兩者交互決定第四種死法是否存在)。
--          兩訊號並存 = 保留 durable poll 偵測、又不產生 age 永增噪音。
--        · 🔴 **第三個訊號:卡在 `sending` 的列**(codex 關卡2 must-fix)。前兩個訊號有共同盲區——
--          age 訊號只掃 `pending`/`failed`,dead-letter count 只看 `attempts >= max_attempts`;
--          若 sweeper **認領後(status 已轉 sending)才死**(pg_cron 停、function timeout、部署中斷),
--          該列 **兩個訊號都不命中** → 永久卡 sending、零告警 = 靜默死亡仍然存在。
--          (lease 回收〔plan §3.5-4〕本應把它翻回 pending,但**回收器自己就跑在 sweeper 裡** → sweeper 死
--          則回收也死 = 同歸於盡,正是 §3.6「不可自我監看」的同一個坑。)
--          → dead-man **必須**另加:`status='sending' AND claimed_at < now() - <lease>` 的 count/age > 0 → 告警。
--        · 🔴 **第四個訊號:列從來沒被寫進來**(codex 關卡2 R5 must-fix = 第五種死法)。
--          🔴 **前三個訊號有一個共同的前提:「outbox 裡有那一列」** —— 它們全都在掃本表的列。
--          但「confirm RPC 成功、payment_status 轉 paid」**已提交**、程序卻在 INSERT outbox **之前**
--          掛掉(function timeout / 部署中斷 / after() 被取消)→ **這張單根本沒有列** → 三訊號全回 0。
--          ⚠️ 對帳補寄(§3.5b)本來就是這條的安全網,**但它跑在 sweeper 裡** → sweeper/pg_cron 一死,
--          補寄與偵測一起死(又是「不可自我監看」的同一個坑)。
--          ⚠️ **別以為訊號 1 會兜住**:訊號 1 要「有 pending 列」才叫得出來,而 PCM 一天只有數十封 →
--          **平時 pending 表通常是空的**(信都寄完了)→「sweeper 死 + 某單 INSERT 失敗 + 其他信都已寄完」
--          = **零訊號**。此組合在本專案量級下並不罕見。
--          → 述詞(跑在獨立管道、直接查 orders 而非 outbox):
--            `count(orders WHERE payment_status='paid' AND paid_at >= <固定下界>
--                     AND paid_at < now() - <寬限>
--                     AND NOT EXISTS (SELECT 1 FROM email_outbox e
--                                      WHERE e.order_id = orders.id AND e.event_type='order_created')) > 0`
--            → 告警。`<寬限>` 須 > sweeper 正常補寄週期(否則剛付款未及補寄的單會誤報)。
--            `<固定下界>` = §3.5b 的上線時戳(同一常數,避免回灌上線前舊單)。
--            ✅ 本片新增的 `email_outbox_order_idx (order_id, event_type)` 正是為此 anti-join 而設。
--          ⚠️ E4 定義「一批」後,`order_shipped` 亦須有對等訊號(否則同一個洞在出貨線重演)。
--        · 四訊號各自對應一種死法,缺一即留盲區:
--            ①pending 堆積 = 排程死 ②dead letter = 送不出去 ③stale sending = 認領後死
--            ④paid 但無列 = **列從沒進來**(前三者的共同盲區)
--          **四者都要跑在獨立管道(anomaly-alert daily cron),不可放進 sweeper 自己**。
--          🔴 分工界線(Fable R3 實測背書):①-③ 由**本表狀態空間**完整分割(它以 UNCOVERED probe 窮舉
--          六態 × 生死 attempts,證明「三訊號 ∪ {sent, skipped_no_real_email, skipped_order_ineligible}」
--          覆蓋全狀態空間、**DB 層無漏網列**);④ 補的是**表外**的洞(列不存在)—— 兩者不重疊、都要有。
--      本片能在 DB 層做的機械化 = 把此述詞寫進 due 索引(§2a):死列物理上不在索引內。
--      **但索引不強制查詢** → 正確性最終仍在 app 層述詞,故列為 E1b/E2a 的 REQUIRED、進關卡2 檢核。
--   ⑧ 🔴 **`skipped_order_ineligible` = S3=A 的落點**(codex 關卡2 R4 must-fix:原 5 態白名單**沒有這一格**,
--      等於逼 E2a 從四個爛選項裡挑,全部有害):
--      Sean 拍 **S3=A「退款/取消後不寄」**(§4.1 送出前 gate:寄前重查訂單現況,已不該寄 → 抑制)。
--      但「抑制」之後那一列要**變成什麼狀態**?原白名單無解 → E2a 只能:
--        · 留 `pending` → 每輪 sweeper 重新認領、重查、再抑制 = 永久 churn;且它一直落在訊號 1 的
--          age 窗內 → **永久假 dead-man 告警**(= 把 liveness 訊號廢掉,§⑦ 同一個坑)。
--        · 標 `sent` → **說謊**(對帳/稽核看起來寄了,實際沒寄)。
--        · 標 `failed` → **假 dead letter 告警**,且會被當成「送不出去」去追 Resend,查無此事。
--        · 🔴 借用 `skipped_no_real_email` → **最危險**:該態依 §③ 是**可翻轉態**,Q1(LINE 補資料獨立線)
--          日後會把它受控翻回 pending 換 recipient → **等於把已退款/已取消訂單的「付款成功」信寄出去**。
--      → 故立獨立終態 `skipped_order_ineligible`:
--        · **不可翻轉**(與 §③ 的 skipped_no_real_email 相反;Q1 線**絕不可**碰這個態)。
--        · 不進 due 索引(述詞只收 pending/failed)、不被任何 dead-man 訊號命中(訊號 1/2 要 pending|failed、
--          訊號 3 要 sending)→ 天然靜默 = **正確的靜默**(它是預期內的合法終局,不是死信)。
--        · `claimed_at` 依 §⑦ 雙向 CHECK 必須為 NULL(從 sending 轉入時要清)。
--      ⚠️ **「哪些訂單狀態算 ineligible」= E2a 定案**(plan §4.1「哪些狀態該抑制」);本片只立這一格。
--      🔴 **REQUIRED-E2a(Fable R3 指出的唯一殘餘盲區、關卡2 檢核點)**:本態**天然不被任何訊號命中**
--      (那是刻意的 —— 它是合法終局、不是死信),代價是 **E2a 若「誤判」eligible → ineligible,
--      零訊號、零對帳補救**(對帳看到列已存在就不補寄 → 該客人永遠收不到信、且無人知)。
--      → 故:①轉入本態**必寫** `last_error_code = 'order_ineligible'`(符合 regex)供事後稽核追得到
--        ②抑制路徑**必附測試**(哪些訂單狀態進、哪些不進),**gate 的正確性本身就是 E2a 的責任**,
--        DB 這層幫不上忙。
--
-- 🔴 ACL 偏離註記(plan §4.3、Fable n3 要求明寫):
--   本表 GRANT **INSERT, SELECT, UPDATE** TO service_role,**偏離** cited pattern `admin_audit_log`
--   (`20260712210000:89` 是 **INSERT-only**;`:88` 明寫「不給 SELECT」)。理由正當且必要:outbox 的
--   **DB CAS 認領**(`UPDATE … WHERE id=$1 AND status IN ('pending','failed')`,affected rows=1 為所有權憑證)
--   本質需要 SELECT(掃 due 列)+ UPDATE(認領/標記 sent/failed/退避);append-only 模型在此不適用。
--   故 §4 斷言的**允許集與 audit_log 不同**(3 權限 vs 1 權限)、非複製貼上失誤。
--   ⚠️ 此為**兩審正面對撞題**(plan §4.3):codex R2-6 裁 RPC-only;Fable R2-Q5 裁 GRANT 已足(理由:RPC-only
--   不縮小實際 blast radius——持 service_role key 者本就能讀 orders/customers 全表,價值遠高於 outbox;
--   tier 片欄級收斂的前例是「防直改高價值欄」,outbox 無此性質)。**S4 現況精確字面**:Sean 未否決
--   → 照 Fable 裁示執行(= 本檔 GRANT);此題屬「非必拍」,STATUS 待決策③ 仍掛著供 Sean 日後否決,
--   **不是 Sean 主動選了 GRANT**、也不是還在等他才能動工(gate 已解除)。
--   同時採納 codex 的 server-only 邊界要求(E1b/E2a:line-admin 式鎖死模組)。
--   DELETE **不給**(outbox 清理 job = **backlog #281**;owner/postgres 仍可刪 → append/update-only 為**角色層**強制,
--   非對 DBA 強制,與 `20260712210000:24-25` 家族界線一致)。
--
-- 🔴 鎖面(codex 關卡2 must-fix;前版註解「零既有物件接觸、零流量影響」**是錯的、已更正**):
--   本 migration **會碰 `orders`**:`REFERENCES public.orders(id)` 建 FK 時,PG 會對**被參照表**取
--   **SHARE ROW EXCLUSIVE** 鎖並在 orders 上掛內部 FK trigger。該鎖與 `ROW EXCLUSIVE` 衝突
--   → **持鎖期間結帳的 `INSERT INTO orders` 會被擋住**,且鎖持有到**交易結束**、不是到語句結束。
--   · 正常 db push:CREATE TABLE 是毫秒級 → 影響可忽略。
--   · 🔴 **但交易模擬(BEGIN → 套 → 逐條斷言 → ROLLBACK)會把這把鎖持有整段模擬時間** → 值班台若在
--     prod 邊模擬邊人工核斷言,**真實客人的建單會被卡住**。故:模擬**必須快、不可開著 txn 慢慢核**
--     (先備好整段腳本一次跑完再 ROLLBACK),或挑低流量時段。**不可照前版「零流量影響」字面放心跑。**
--   · 已加 `SET LOCAL lock_timeout='3s'`:搶不到鎖時**至多排隊 3 秒即失敗**(fail-fast),而不是無限
--     等待、把後面的結帳 INSERT 一起堵成雪崩(等鎖的 DDL 會擋住後續所有 orders 寫入 = 比 migration
--     失敗嚴重得多)。⚠️ **精確字面**(codex R3 nit;Fable 拋棄式 PG 實測 3.03s 砍掉):`lock_timeout`
--     是**每次取鎖各自計時**、不是整支 migration 的上限;且那 3 秒排隊窗內,其後的 orders 寫入照樣被擋。
--     故正確說法是「**有界、可重跑、零損失**」,**不是「立刻失敗、零影響」**。
--
-- ⚠️ 守線(字面 vs 事實):本檔**尚未執行、尚未 db push、尚未 apply**。
--   · 真 DB 交易模擬(BEGIN→套→斷言→ROLLBACK→零留痕)= **⏳ PENDING**(硬閘:Sean db push → 值班台驗 → 才放行推)。
--   · **不預先宣稱模擬 PASS**;斷言清單見檔尾。
-- ============================================================

BEGIN;

-- 🔴 fail-fast:建 FK 需在 orders 上取 SHARE ROW EXCLUSIVE(見頭註「鎖面」)。**至多排隊 3 秒即失敗**,
--    不無限等——無限等的 DDL 會擋住其後所有 orders 寫入(結帳雪崩)。失敗 = 重跑即可,零損失。
--    ⚠️ 每次取鎖各自計時、非整支上限;那 3 秒內 orders 寫入仍被擋(Fable 實測 3.03s)。
SET LOCAL lock_timeout = '3s';

-- ── 1. email_outbox 主表(plan §4)────────────────────────────────────────────
CREATE TABLE public.email_outbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text        NOT NULL,                      -- 事件型別(CHECK 白名單;新增事件 = 新 migration)
  order_id        uuid        NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,  -- 有信不可刪單(§④)
  dedup_key       text        NOT NULL,                      -- 🔴 S2=B 去重鍵(§①):order_created=order_id::text;order_shipped=該批穩定識別(算法待 E4)
  recipient_email text        NOT NULL,                      -- 🔴 本表**唯一「設計上預期存在」的 PII 欄**(非 DB 強制,見 §⑤);寫入前經假信箱 gate(§③)
  subject         text        NOT NULL,                      -- 信件主旨(L2 文案、E3 定字面)
  payload         jsonb       NOT NULL,                      -- 事件時點不可變、非 PII 最小集(§⑤)
  status          text        NOT NULL DEFAULT 'pending',    -- 6 態(CHECK 白名單):pending/sending/sent/failed/skipped_no_real_email〔可翻轉〕/skipped_order_ineligible〔不可翻轉,§⑧〕
  attempts        int         NOT NULL DEFAULT 0,            -- 已嘗試次數(退避依據)
  max_attempts    int         NOT NULL DEFAULT 5,            -- 🔴 終態界線在 attempts >= max_attempts,不在 status(見 §⑦ failed 雙義)
  last_error_code text,                                      -- 只存結構化安全碼(如 'http_422');🔴 禁存 Resend 回應全文(可能含 PII)
  request_id      text,                                      -- correlation id(對齊 repo 慣例,非 correlation_id);nullable=sweeper 補寄路徑無來源 request
  created_at      timestamptz NOT NULL DEFAULT now(),        -- DB 權威時間
  next_retry_at   timestamptz NOT NULL DEFAULT now(),        -- 🔴 NOT NULL(§②):NULL <= now() 不成立 → 永久卡信
  sent_at         timestamptz,                               -- 標記 sent 時寫
  claimed_at      timestamptz,                               -- CAS 認領時戳;lease 回收依據(plan §3.5-4:lease ≥ 1 小時 > route maxDuration)

  CONSTRAINT email_outbox_event_type_check      CHECK (event_type IN ('order_created', 'order_shipped')),
  -- 🔴 6 態(codex 關卡2 R4 must-fix:原 5 態**沒有 S3=A 的落點**,見 §⑧)。
  CONSTRAINT email_outbox_status_check          CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped_no_real_email', 'skipped_order_ineligible')),
  CONSTRAINT email_outbox_dedup_key_nonempty    CHECK (dedup_key       <> ''),
  CONSTRAINT email_outbox_recipient_nonempty    CHECK (recipient_email <> ''),
  CONSTRAINT email_outbox_subject_nonempty      CHECK (subject         <> ''),
  CONSTRAINT email_outbox_payload_is_object     CHECK (jsonb_typeof(payload) = 'object'),  -- 防 payload 存成純量/陣列(同款守門前例:20260604120000:118-119 orders_invoice_whitelist)
  CONSTRAINT email_outbox_attempts_nonneg       CHECK (attempts     >= 0),
  CONSTRAINT email_outbox_max_attempts_positive CHECK (max_attempts >= 1),
  -- 🔴 claimed_at 與 sending **雙向綁定**(codex 關卡2 R2 → R3 收嚴為 biconditional):
  --    · 「sending ⇒ claimed_at 非 NULL」:否則 stale-sending 訊號的 `claimed_at < now() - <lease>`
  --      對 NULL 恆為 UNKNOWN → 該列不告警、lease 索引也無時間可比 → **永久卡 sending 且無人知**
  --      (與 §② next_retry_at NOT NULL 同族的 NULL 吞噬坑)。
  --    · 🔴 反向「claimed_at 非 NULL ⇒ sending」**不可省**(codex R3 must-fix):單向版只擋 NULL、
  --      **不保證 claimed_at 是「本次」認領時間**。反例:T1 認領 → 失敗轉 failed(claimed_at 仍留 T1)
  --      → 下次 CAS 若漏寫 `claimed_at=now()`,單向 CHECK **照樣過** → lease 回收看到 T1 早已過期
  --      → **把正在寄送的列判成 stale 而重新認領 = 重複寄信**。雙向版逼「離開 sending 必須清 NULL、
  --      重新認領必須寫新 now()」,漏寫即 check_violation。
  --    此為 DB 級 invariant,不倚賴 app 層記得寫/清 claimed_at。
  CONSTRAINT email_outbox_sending_has_claimed_at CHECK ((status = 'sending') = (claimed_at IS NOT NULL)),
  -- 🔴 last_error_code 只收結構化安全碼(codex 關卡2 R2 must-fix):原本「禁存 Resend 回應全文」
  --    只是註解 = 願望,實作失誤即可把回應全文(含 recipient/內容 = PII)永久複製進本表。
  --    收斂為 snake_case 短碼(如 http_422 / network_timeout)→ **原始 JSON / 含空白或大小寫的
  --    provider 訊息物理上寫不進來**(Fable 實測:'http_422' 過;大寫、含換行全擋)。
  --    ⚠️ **不是「PII 物理閘」**(codex R3 nit,字面已收窄):任意 1-64 字元小寫英數底線仍可通過 ——
  --    若 E1b 把 provider message 做 lower/replace/truncate 再塞,phone / email local-part 仍可能符合。
  --    → **REQUIRED-E1b**:用**有限的內部錯誤碼 allowlist**,未知錯誤一律映射 `provider_error`;
  --      **禁**由任意 `.message` 轉碼。本 CHECK 是最後一道網,不是唯一一道。
  CONSTRAINT email_outbox_last_error_code_format CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$')
);

COMMENT ON TABLE public.email_outbox IS
  'M-4a Email 通知片薄 outbox(plan v3 §4;Sean 07-16 拍 S1=A 完整版)。app 層於「confirm RPC 成功、payment_status 轉 paid」後寫入(交易外、不改 create_order、不進訂單交易 → 寄信失敗絕不影響下單扣款);after() 立即嘗試送(非 durable),pg_cron(*/5)+pg_net → Next sweeper 兜底(CAS 認領→送→標記→退避重試)。送達保證來自本狀態機 + Resend Idempotency-Key,不是排程準時;liveness 靠獨立管道 dead-man check(E2a)。client(anon/authenticated)零權限 + RLS zero-policy;recipient_email 是**唯一「設計上預期存在」的 PII 欄**、絕不對前台開放 —— ⚠️ 此為設計意圖、**非 DB 強制**:payload 只被約束成 jsonb object(無 key allowlist),subject/dedup_key/request_id 皆自由 text → 防「不該落表的 PII 被寫進來」靠 REQUIRED-E1b 的組裝層 allowlist,本表只能關住已落表的東西。';
COMMENT ON COLUMN public.email_outbox.dedup_key IS
  '🔴 去重鍵(Sean S2=B「每出一批寄一封」連鎖):與 event_type 組成唯一鍵。order_created = order_id::text(一單一封);order_shipped = 該批的穩定識別(算法待 E4 偵察後定,plan §3.7-2;request_id 不可直接當 key = 雙擊會產生兩 id 兩封信)。原設計 UNIQUE(event_type, order_id) 已作廢 = 會擋掉同訂單第二封出貨信。
🔴 **E4 選 key 時的硬約束**:唯一鍵是 (event_type, dedup_key)、**不含 order_id** → dedup_key 必須在同一 event_type 內**全域唯一**,不可只在單筆訂單內唯一(例:用「該單第 N 批」這種 per-order 序號 → 不同訂單的第 1 批會撞鍵 → 第二張單的出貨信被誤擋 = 漏信)。候選算法若是 item id 集合排序後 hash,因 item id 全域唯一 → 天然滿足此約束。';
COMMENT ON COLUMN public.email_outbox.status IS
  '6 態:pending(待送)/ sending(CAS 已認領、在途)/ sent(終態)/ failed(🔴 **可重試失敗態、非終態**;見下)/ skipped_no_real_email(合成假信箱、不呼 Resend、不進 due 索引;**可翻轉態**)/ 🔴 skipped_order_ineligible(S3=A 落點:寄前 gate 重查發現訂單已退款/取消 → 抑制;**不可翻轉終態**、Q1 線絕不可碰它,否則等於把已退款訂單的付款成功信寄出去;不進 due、不被任何 dead-man 訊號命中 = 預期內的正確靜默)。
🔴 **failed 是雙義的、終態界線不在 status 而在 attempts**:每次送失敗即標 failed + 進退避(next_retry_at 推遠)→ 仍會被 sweeper 重新認領(CAS 述詞含 failed);只有 attempts >= max_attempts 才是「不再重試」的終態。故**任何掃描 due 列的述詞都必須含 `attempts < max_attempts`**(REQUIRED-E2a),否則達上限的死列 next_retry_at 恆已過期 → 無限重試、突破 max_attempts。同理 dead-man check(plan §3.6)的「最老 pending/failed age」述詞亦須排除 attempts >= max_attempts 的死列,否則終態列 age 永增 → 永久告警噪音淹掉真正的靜默死亡(= liveness 唯一來源被廢)。DB 層以 due 索引述詞把此約束機械化(見 email_outbox_due_idx)。🔴 skipped_no_real_email 是「可翻轉態」非不可逆終態:它佔住唯一鍵,Q1(LINE 補資料獨立線)補到真實 email 時須以受控 UPDATE 原地翻回 pending、不可新 INSERT(會撞唯一鍵 = 該 cohort 永久漏信);且不得自動回灌。DB 層刻意不鎖狀態機,轉移正確性由 app 層 CAS 負責。';
COMMENT ON COLUMN public.email_outbox.next_retry_at IS
  '🔴 NOT NULL(codex R1-2 銷案):若為 NULL 則 next_retry_at <= now() 恆不成立 → 該列永不進 due 掃描,而對帳補寄又因「事件已存在」略過 → 永久漏信且無人知。DEFAULT now() = 寫入即到期。';
COMMENT ON COLUMN public.email_outbox.payload IS
  '事件時點不可變、非 PII 的最小集(display_id / paid_at / 事件版本 / event 專屬欄);品項/金額/地址寄信時即時查主表。🔴 刻意不存 shipping_method 等可後台改的欄:補寄前狀態可能已變 → 送出前另有 gate 重查訂單現況(S3=A:已退款/取消則抑制)。';
COMMENT ON COLUMN public.email_outbox.last_error_code IS
  '只存結構化安全碼(如 ''http_422'' / ''network_timeout'');🔴 禁存 Resend 回應全文(可能含 recipient/內容 = PII 二次落表)。';

-- ── 2. 索引(plan §4)────────────────────────────────────────────────────────
-- 2a. due 掃描(sweeper 主路徑):partial → sent/sending/skipped 列不佔索引、不被掃到。
-- 🔴 述詞含 `attempts < max_attempts`(§⑦ failed 雙義):達上限的死列 next_retry_at 恆已過期,
--    若留在 due 索引內,sweeper 述詞一旦漏掉 attempts guard 就會無限重試、突破 max_attempts。
--    此處把約束機械化 = 死列物理上不在索引內。E2a 的查詢述詞**必須明確含 `attempts < max_attempts`、
--    或能被 planner 證明涵蓋本述詞**才吃得到索引(PG partial index 是「可推導涵蓋」、非逐字比對;
--    但實務上請沿用同一式,避免 planner 推不出來 → 退化 seq scan)。
--    ⚠️ **偏離 plan §4 的索引字面**(原 `WHERE status IN ('pending','failed')`)= code-reviewer R1
--    must-fix 銷案(failed 雙義縫);同列兩欄比較為 IMMUTABLE → partial index 合法。
CREATE INDEX email_outbox_due_idx ON public.email_outbox (next_retry_at)
  WHERE status IN ('pending', 'failed') AND attempts < max_attempts;
-- 2b. 依 correlation id 追蹤(跨層 debug:一個 request 的 outbox 列);partial:request_id nullable
--     (sweeper 補寄路徑無來源 request)→ 對齊 20260712210000:76 target 的 partial-on-nullable 寫法
--     (⚠️ 同檔 :78 的 request_id 索引**未** partial = 該檔兩種寫法並存;本片刻意取較嚴者、非「慣例」)。
CREATE INDEX email_outbox_request_idx ON public.email_outbox (request_id) WHERE request_id IS NOT NULL;
-- 2c. 🔴 唯一事件鍵(§①):S2=B 下以 dedup_key 取代 order_id;DB 層防重(Idempotency-Key 只保留 24h < 重試總跨度)。
CREATE UNIQUE INDEX email_outbox_event_uniq ON public.email_outbox (event_type, dedup_key);
-- 2d. lease 回收(找出認領後卡在途的列);partial:只索引 sending。
CREATE INDEX email_outbox_lease_idx ON public.email_outbox (claimed_at) WHERE status = 'sending';
-- 2e. 🔴 FK referencing-side 索引(codex 關卡2 R4:**PG 不會自動為 FK 的來源側建索引**)。兩個真實痛點:
--     ①`ON DELETE RESTRICT` 的 RI 檢查:每次 DELETE/UPDATE orders 都要反查本表 → 無索引 = **全表掃**。
--     ②§3.5b 對帳補寄的 `NOT EXISTS (SELECT 1 FROM email_outbox WHERE order_id = o.id AND event_type=…)`
--       每 5 分鐘全量重疊掃描 → 無索引 = 每張訂單一次 seq scan(表隨時間長大、清理 job 見 backlog #281)。
--     含 event_type 是因為對帳述詞恆帶它(order_created / order_shipped 分開判)。
CREATE INDEX email_outbox_order_idx ON public.email_outbox (order_id, event_type);

-- ── 3. RLS zero-policy + table ACL(client 全鎖;service_role 三權限 = 認領模型所需)──
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- 先撤 Supabase 對新表的 default-privilege re-grant(含 service_role),再精準補回。
REVOKE ALL ON TABLE public.email_outbox FROM PUBLIC, anon, authenticated, service_role;

-- storefront server 以 sb_secret_ 金鑰(= service_role)寫入/認領/標記。
-- 🔴 偏離 audit_log 的 INSERT-only pattern = CAS 認領本質需 SELECT+UPDATE(理由見頭註「ACL 偏離註記」)。
-- 🔴 不給 DELETE(清理 job = backlog #281,走 owner);TRUNCATE/REFERENCES/TRIGGER 亦零。
GRANT INSERT, SELECT, UPDATE ON TABLE public.email_outbox TO service_role;

-- ── 4. fail-closed 斷言:表層 ACL 終態 ─────────────────────────────────────────
DO $$
DECLARE
  v_role text;
  v_priv text;
  v_cnt  integer;
BEGIN
  -- 4a. client 角色(anon/authenticated)7 權限全零(recipient_email = PII,前台零可及)。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_role, 'public.email_outbox', v_priv) THEN
        RAISE EXCEPTION 'email_outbox ACL 異常 — client 角色 % 不應有 % 權限(client 須全鎖、本表含 PII);拒繼續', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  -- 4b. service_role 必須有 INSERT/SELECT/UPDATE(寫入 + CAS 認領 + 標記路徑;缺任一 = runtime 42501 炸在寄信路徑)。
  FOREACH v_priv IN ARRAY ARRAY['INSERT', 'SELECT', 'UPDATE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.email_outbox', v_priv) THEN
      RAISE EXCEPTION 'email_outbox ACL 異常 — service_role 應有 %(outbox 寫入/認領/標記路徑);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4c. service_role 其餘 4 權限全零(最小權限:無 DELETE = 清理只走 owner;無 TRUNCATE/REFERENCES/TRIGGER)。
  FOREACH v_priv IN ARRAY ARRAY['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
    IF has_table_privilege('service_role', 'public.email_outbox', v_priv) THEN
      RAISE EXCEPTION 'email_outbox ACL 異常 — service_role 不應有 %(最小權限;DELETE 留 owner = 清理 job backlog #281);拒繼續', v_priv;
    END IF;
  END LOOP;

  -- 4d. role_table_grants 顯式 grant:anon/authenticated 零;service_role 恰 3 筆。
  --     ⚠️ 本段**不是 PUBLIC 的權威驗證**(codex 關卡2 R2 nit:role_table_grants 只呈現 grantor 或 grantee
  --     為 enabled role 的列,PUBLIC 授權在此的可見性隨 grantor 而異、不可倚賴)→ **PUBLIC 由 4e 的
  --     `grantee = 0` 權威把關**;查詢仍保留 'PUBLIC' 字面當輔助訊號(命中即異常),但不當唯一防線。
  SELECT count(*) INTO v_cnt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'email_outbox'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'email_outbox role_table_grants 異常 — anon/authenticated/PUBLIC 應零顯式 grant(實 % 筆);拒繼續', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'email_outbox'
     AND grantee = 'service_role';
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'email_outbox role_table_grants 異常 — service_role 應恰 3 筆(INSERT/SELECT/UPDATE,偏離 audit_log 的 1 筆 = CAS 認領所需),實 % 筆;拒繼續', v_cnt;
  END IF;

  -- 4e. 🔴 **aclexplode 全 allowlist**(codex 關卡2 must-fix:4a-4d 只查「具名三角色」,
  --     **第三方角色的 grant 會整個沒被看到**——Supabase default privileges / 未來某支 migration /
  --     dashboard 操作若授權了別的角色,前四段全數放行、表照建 → 該角色即可讀 recipient_email〔本表唯一 PII〕)。
  --     此段改問反向問題:「relacl 裡到底有誰?」不在 {owner, service_role} 就炸。
  --     ⚠️ 精確範圍(codex R3 nit):這是「**直接 relacl allowlist** 的 fail-closed 斷言」,
  --     **不等於「有效權限」的窮舉** —— relacl 證明不了 role inheritance / owner / superuser /
  --     BYPASSRLS / read-all 這類不走 object grant 的路徑(那些本就不是本表能防的層級)。
  --     註:PUBLIC 在 aclexplode 是 grantee = 0(oid),與具名角色分開判;此處一併涵蓋。
  SELECT count(*) INTO v_cnt
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS a
   WHERE c.oid = 'public.email_outbox'::regclass
     AND a.grantee <> c.relowner                      -- owner(postgres)= 合法
     AND a.grantee <> 'service_role'::regrole::oid;   -- service_role = 合法(§4.3 Fable 裁示)
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'email_outbox ACL 異常 — relacl 出現 owner/service_role 以外的 grantee(含 PUBLIC=oid 0)共 % 筆;本表含 PII、allowlist 外一律拒;拒繼續', v_cnt;
  END IF;

  -- 4f. 欄級 ACL 必須全空(codex 關卡2:表級 allowlist 過了,仍可能有人只對 recipient_email 開欄級 grant
  --     → has_table_privilege 與 relacl 都看不到)。本表設計零欄級授權 → attacl 應全 NULL。
  SELECT count(*) INTO v_cnt
    FROM pg_attribute
   WHERE attrelid = 'public.email_outbox'::regclass
     AND attnum > 0 AND NOT attisdropped
     AND attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'email_outbox ACL 異常 — 不應有任何欄級 grant(attacl 非空 % 欄);拒繼續', v_cnt;
  END IF;

  -- 4g. RLS 終態納入同一 fail-closed DO(codex 關卡2:前版只在檔尾清單要求值班台手動查 → apply 時不設防)。
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.email_outbox'::regclass) THEN
    RAISE EXCEPTION 'email_outbox RLS 異常 — 未 ENABLE ROW LEVEL SECURITY(縱深:誤 grant 時的第二道);拒繼續';
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_outbox';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'email_outbox RLS 異常 — 應為 zero-policy(實 % 條 policy);拒繼續', v_cnt;
  END IF;
END
$$;

COMMIT;

-- ============================================================
-- Rollback(Supabase forward-only、僅供參考、逆序手動執行):
--   DROP TABLE IF EXISTS public.email_outbox;   -- 連帶 5 具名索引 + PK / 10 CHECK / FK / grant 一併消失
-- ============================================================

-- ============================================================
-- 交易模擬斷言清單(plan §7;於 project bmpnplmnldofgaohnaok)
--
-- 🔴🔴🔴 **本檔自帶行首 `BEGIN;` 與 `COMMIT;` → 不可外包一層 BEGIN…ROLLBACK**
--       (⚠️ 此處刻意**不寫行號**:本檔頭註歷經 8 輪審查增補,行號已漂移三次〔:105→:119→:147→實際更後〕,
--        寫死必再失效 → 用 `grep -n '^BEGIN;\|^COMMIT;' <本檔>` 當場取,勿信任何寫死的行號)
--       (codex 關卡2 R2 must-fix;前版此處字面「BEGIN → 套本 migration → 斷言 → ROLLBACK → 零留痕」
--        **是錯的、會在 prod 留痕**):在既有交易中再下 `BEGIN` 只會 WARNING 並被忽略,接著本檔的
--        **`COMMIT` 會把外層交易真的提交掉** → 表就此永久建立,最後那句 `ROLLBACK` 什麼都退不了。
--        照前版字面跑 = 以為在模擬、實際已寫進 prod。
--   → **兩種腳本、擇一,不可混用**:
--     ① **apply 前模擬(零留痕)**:BEGIN → 貼**本檔 §1-§4 的本體**(**手動剔除本檔自帶的 BEGIN/COMMIT**;
--        `SET LOCAL lock_timeout` 保留)→ 逐條斷言 → ROLLBACK → 再查零留痕。
--     ② **db push 之後驗收(表已存在、不可能零留痕)**:直接對既存表跑斷言;寫入型斷言(5/6/9b)包在
--        BEGIN…ROLLBACK 內用合成資料跑 → ROLLBACK 後**表必須仍在**(此時「表消失」才是異常)。
--        ⚠️ 此路徑下「ROLLBACK 後零留痕」指的是**資料**零留痕,不是表零留痕(第 13 條只適用 ①)。
--
-- 🔴 **總則 A — 斷言分四類,只有「預期報錯型」需要隔離**(Fable F2;codex R4 修正分類:
--   前版把 7b/7c/8 也塞進「預期報錯型」= 分類錯誤,值班台照字面跑會誤讀):
--   | 類 | 哪幾條 | 怎麼跑 |
--   |---|---|---|
--   | **預期 SQLSTATE(報錯)** | 2 / 4 / 6 / 7d / 10 | 🔴 **各自包 SAVEPOINT 或 DO…EXCEPTION**(見下) |
--   | **預期 rowcount** | 7b(=0)、5(=1) | 正常執行、比對 affected rows,不會報錯、**不必包 SAVEPOINT** |
--   | **唯讀 catalog 查詢** | 0 / 1 / 3 / 4(ACL 部分)/ 8 / 9 / 11 / 12 | 純 SELECT,零副作用、無需隔離 |
--   | **需寫 fixture 才能驗** | 9b(要 INSERT 兩列:failed@1/5 與 failed@5/5) | 寫入型;包 BEGIN…ROLLBACK 或 SAVEPOINT |
--   | **disposable DB 雙連線** | 7 / 7c | 🔴 依總則 B 移出 prod 腳本 |
--
--   **預期報錯型為何必須隔離**:單一 txn 內第一個預期錯誤即進入
--   25P02(current transaction is aborted)→ **其後每一條斷言都回「transaction is aborted」**,
--   看起來像全過、實則全部沒驗到;而此時 orders 的 SHARE ROW EXCLUSIVE **仍持有到 ROLLBACK**
--   → 被操作困惑拉長的那段時間,結帳一直卡著。
--   → **每一條預期報錯斷言各自包 `SAVEPOINT … / ROLLBACK TO SAVEPOINT …`,或包 `DO … EXCEPTION WHEN …`**
--     (第 10 條已示範 DO 包法,其餘比照)。
--
-- 🔴 **總則 B — 併發型斷言(7 / 7c)不可能在 rollback-only 腳本內做**(codex R3 must-fix;前版把它列進
--   單一 txn 腳本 = 要求值班台跑一個物理上不成立的測試):
--   雙 session CAS 需要**兩個並行連線看到同一列**,但未提交的列**對另一 session 不可見**
--   (PostgreSQL 交易可見性:其他交易只能看已提交資料)→ ①路徑下 session B 連表都看不到;
--   ②路徑下若 fixture 在 session A 的 BEGIN 內 INSERT,session B 同樣看不到 → **永遠拿不到 1/0 winner**。
--   → **7 / 7c 移出 prod 腳本**,改在 **disposable 本地/preview DB**:先 **COMMIT** fixture → 雙 session 跑
--     → 用完銷毀。若堅持在 prod 做,必須**明說需要短暫 committed fixture + 可靠 cleanup**,
--     且**不得再宣稱「全程 ROLLBACK、零資料留痕」**(兩者不可兼得)。
--
-- 🔴🔴 **跑模擬前必讀(codex 關卡2 must-fix 更正;前版此處寫「只鎖自己剛建的表、零既有物件接觸、零流量影響」
--       = 錯的,照那句在 prod 開著 txn 慢慢核會卡住真實結帳)**:
--   · 本支**會碰 orders**:建 FK 時對 orders 取 **SHARE ROW EXCLUSIVE** 鎖 + 掛內部 FK trigger;
--     該鎖與 ROW EXCLUSIVE 衝突 → **持鎖期間 `INSERT INTO orders`(= 客人結帳建單)被擋**,
--     且鎖持有到**交易結束**(ROLLBACK 才放),不是到語句結束。
--   · → **模擬必須「整段腳本一次跑完再 ROLLBACK」**,不可 BEGIN 後開著交易人工逐條核(那等於把結帳
--     鎖住整段時間)。或挑低流量時段。migration 內已有 `SET LOCAL lock_timeout = '3s'` fail-fast。
--   · 可逆 + 零留痕仍成立(ROLLBACK 後表/索引/grant/FK trigger 全消失)。
-- 若模擬中發現要碰既有物件的**其他**意外(publication / role 屬性)→ 立即停、回報,不硬幹。
-- ============================================================
-- 0. 🔴 **db push 前的唯讀探針(Fable 建議;唯一「未確認」項的收斂法)**:Fable 已在拋棄式 PG 以
--    Supabase 式 defacl 實測本檔全過,但**本專案 prod 實際的 default privileges 無法從 repo 側查證**。
--    → 值班台 db push 前先跑(唯讀、零副作用;**須展開 acl 並限定 table 型**,codex R4 nit:
--      不過濾會把 function/sequence/其他 schema 的正常 default ACL 一起列出 → 假警報):
--      ```
--      SELECT d.defaclrole::regrole AS 定義者,
--             d.defaclnamespace::regnamespace AS schema,   -- 0 render 成 '-' = 全域 defacl,正常
--             a.grantee::regrole AS 被授權者, a.privilege_type
--        FROM pg_default_acl d
--        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
--       WHERE d.defaclobjtype = 'r'                        -- r = table(排除 function/sequence)
--         AND d.defaclnamespace IN (0, 'public'::regnamespace);
--      ```
--    🔴 **判讀(Fable R2 實測校正,前版字面會害值班台做錯事)**:
--      · **定義者自身的 self-entry 是正常的、不要動**(實測 `defaclacl` 幾乎必含 `postgres=arwdDxtm/postgres`)。
--        前版寫「出現三角色**以外**的 grantee 就補 REVOKE」→ postgres 不在三角色名單 →
--        **會叫人對 owner 補 REVOKE = 錯誤操作**。
--      · 真正要看的:**扣掉 defacl 定義者自身**後,被授權者是否只有 anon/authenticated/service_role。
--      · 若出現第四個角色 → 4e 會在 apply 時準確 RAISE(Fable 以流氓角色實測:**整個 txn 中止、表零留痕**,
--        不是留半套)→ 先在本檔 §3 補上該角色的 REVOKE 再重跑,**不要拿掉 4e**。
-- 1. 表存在、16 欄型別/NOT NULL 正確(information_schema.columns);next_retry_at **NOT NULL 生效**(§②)。
-- 2. 10 CHECK 生效(皆 check_violation):event_type 非白名單被擋;
--    status 非白名單被擋、且 **6 態全部可寫入**(pending/sending/sent/failed/skipped_no_real_email/
--    🔴 skipped_order_ineligible〔§⑧ S3=A 落點〕)。
--    ⚠️ **寫 `sending` 時必須連帶 `claimed_at = now()`**,否則會撞雙向 CHECK —— 那是**預期行為**、
--    不是 status_check 壞掉(Fable R3 實測時就先撞了這個並誤讀,故在此標明,免得值班台重蹈)。
--    dedup_key/recipient_email/subject = '' 各被擋;payload 存純量(如 '"x"'::jsonb)被擋;
--    attempts = -1 被擋;max_attempts = 0 被擋;
--    🔴 雙向 claimed_at(email_outbox_sending_has_claimed_at)兩個方向都要驗:
--       ①status='sending' 但 claimed_at IS NULL 被擋;
--       ②status ∈ {pending,sent,failed,skipped_*} 但 claimed_at 非 NULL **亦被擋**(= 危害態不可表示,見 7d③);
--    🔴 last_error_code 存回應全文/大寫/含空白(如 'Resend 422: {"to":"a@b.com"}')被擋、
--       'http_422' 可過(email_outbox_last_error_code_format = **格式 backstop、最後一道網**;
--       🔴 **不是 PII 物理閘**〔對齊本檔 §「last_error_code」註〕:小寫英數底線的 email local-part 仍可通過
--       → 真防線 = REQUIRED-E1b 的**有限錯誤碼 allowlist**,該項由 E1b 的測試驗、不在本清單)。
-- 3. RLS enabled(pg_class.relrowsecurity = true)、零 policy(pg_policies count = 0)。〔已進 DO 4g、apply 時自驗〕
-- 4. 表層 ACL 終態(§4 DO 4a-4g 已在 migration 內自驗 = apply 失敗即拒;模擬時**仍獨立再查一次**,
--    因為 DO 與斷言查詢共用同一組假設,獨立查才抓得到「DO 本身寫錯」):
--    · has_table_privilege anon/authenticated × 7 權限全 false。〔DO 4a〕
--    · service_role:INSERT/SELECT/UPDATE = true;DELETE/TRUNCATE/REFERENCES/TRIGGER = false。〔DO 4b/4c〕
--    · 🔴 aclexplode 全 allowlist:relacl 的 grantee 只有 owner + service_role,無第三者、無 PUBLIC(grantee=0)。〔DO 4e〕
--    · 🔴 欄級 ACL 全空(pg_attribute.attacl 全 NULL)= 無人對 recipient_email 單開欄級 grant。〔DO 4f〕
--    · anon/authenticated 實跑驗證(SET LOCAL ROLE + SELECT → 預期 42501),不只信 has_table_privilege。
-- 5. 合法 INSERT 落地(用**既有真實 order_id**;FK 生效)、id/created_at/next_retry_at/status/attempts 預設值正確。
-- 6. 🔴 **唯一鍵擋第二封**(§①核心):同 (event_type='order_created', dedup_key=<order_id>) 第二筆 INSERT → unique_violation;
--    **但** (event_type='order_shipped', dedup_key='<批A>') 與 ('order_shipped','<批B>') **兩筆皆須成功落地**
--    (= S2=B「同訂單多封出貨信」不被誤擋 → 這正是 UNIQUE(event_type,order_id) 作廢的理由,必須實證)。
-- 7. 🔴 **CAS 認領併發模擬**(plan §3.5-1、多輪審查擊不破處)。
--    ⚠️ **本條與 7c 依總則 B 移出 prod rollback-only 腳本 → 在 disposable DB 做(fixture 需先 COMMIT)**;
--    7b / 7d 是單 session 的預期報錯/rowcount 斷言,可留 prod 腳本、但依總則 A 各自包 SAVEPOINT。
--    兩個 session 對同一列跑同一句 → **恰一 winner**(affected rows 1 / 0)。
--    🔴 述詞**必須含 attempts guard**(codex 關卡2 R2 must-fix:
--    前版此處範例只寫 `status IN ('pending','failed')`,**與 §⑦ 的 REQUIRED-E2a 硬合約自相矛盾** →
--    值班台照舊字面驗,等於把「突破重試上限的 CAS」驗成通過):
--      `UPDATE … SET status='sending', claimed_at=now()
--         WHERE id=$1 AND status IN ('pending','failed') AND attempts < max_attempts`
--    7b. **上限邊界**:同一列 attempts = max_attempts 時跑上句 → **affected rows 必須 = 0**(死列不可被認領)。
--    7c. **TOCTOU 邊界**(§⑦):A 讀到 attempts=4 後、B 先把該列推到 attempts=5 → A 的 CAS **必須** 0 rows
--        (證明 guard 真的在 CAS 內原子生效,而非只在 due-select 階段擋)。
--    7d. `claimed_at` **雙向** invariant(codex R3 收嚴後;Fable R2 實測校正 ③):
--        ①認領時漏寫 `claimed_at=now()`(status→sending 但 claimed_at 仍 NULL)→ check_violation。
--        ②**離開 sending(轉 sent/failed/pending/skipped_order_ineligible)時漏清 `claimed_at=NULL`**
--          → 亦 check_violation。⚠️ Fable 實測:漏這條 → **每次 mark-sent 都炸** → 信已送出但列卡 sending
--          → lease 回收 → 重認領 → 系統性重複寄信。
--        ③ 🔴 **危害態不可表示**(改寫;前版字面「對『claimed_at 殘留舊值的 failed 列』重新認領」
--          **是不可執行的** —— Fable 實測:該 fixture **本身就建不起來**,值班台會在建 fixture 處撞牆、
--          誤以為測試壞掉):正確驗法 = **直接嘗試 INSERT/UPDATE 出 `failed`/`sent`/`pending` + claimed_at
--          非 NULL 的列 → 每一種都必須 check_violation**(= 單向版會誤過的那個危害態,在雙向版下
--          於 DB 層根本無法存在)。
-- 8. FK ON DELETE RESTRICT。🔴 **不可用「DELETE 該 order → 預期 foreign_key_violation」當證明**
--    (codex R3 must-fix:**會假通過**)—— orders 另有 `payment_charge_attempts` /
--    `bank_txn_pending_invoices` / `double_charge_anomalies` 等非 CASCADE FK,**即使本表 FK 寫成
--    CASCADE/SET NULL,DELETE 一樣會被別張表擋下並噴 foreign_key_violation** → 測不出本表的 FK。
--    → **權威驗法 = 直接查 catalog**(精確、零副作用、無 orders 鎖):
--      `SELECT conname, confdeltype FROM pg_constraint
--         WHERE conrelid='public.email_outbox'::regclass AND contype='f'
--           AND confrelid='public.orders'::regclass;`
--      → 須恰 1 筆且 `confdeltype = 'r'`(r = RESTRICT;a=NO ACTION / c=CASCADE / n=SET NULL 皆 FAIL)。
--    · 功能性 DELETE 測試(選配)**只在 disposable DB** 用「已確認無其他限制型子列」的合成 order 做。
-- 9. 5 支具名索引存在(pg_indexes;另有 PK 索引 email_outbox_pkey → 該表共 6 筆);indexdef **語意等價**
--    比對(⚠️ 不可逐字比對:pg_indexes 會 render 成正規化形,例 due 的述詞實際長相 =
--    `WHERE ((status = ANY (ARRAY['pending'::text, 'failed'::text])) AND (attempts < max_attempts))`
--    ——與下列簡寫語意相同、字面不同;逐字比對會誤判 FAIL):
--    · due  = `(next_retry_at) WHERE status IN ('pending','failed') AND attempts < max_attempts`
--             🔴 **attempts guard 必須在述詞內**(§⑦ failed 雙義;偏離 plan §4 索引字面 = R1 must-fix 銷案)。
--    · request = `(request_id) WHERE request_id IS NOT NULL`(partial;對齊 20260712210000:76 慣例)。
--    · lease = `(claimed_at) WHERE status = 'sending'`;event_uniq = UNIQUE `(event_type, dedup_key)`。
--    · 🔴 order = `(order_id, event_type)`(**FK referencing-side 索引**;PG 不自動建 → 無它則
--      orders 的 RESTRICT 檢查與 §3.5b 對帳的 NOT EXISTS 皆全表掃,codex R4 nit)。
-- 9b. 🔴 **failed 雙義實證**(§⑦、R1 must-fix):同一列 status='failed'
--    · attempts=1 / max_attempts=5 → **在** due 索引述詞內(可重試)。
--    · attempts=5 / max_attempts=5 → **不在** due 索引述詞內(死列;= 不會被無限重試)。
--    驗法:兩列各 INSERT 後,以 `EXPLAIN` 或直接查 `WHERE status IN ('pending','failed')
--    AND attempts < max_attempts AND next_retry_at <= now()` → 恰回第一列。
--    ⚠️ 索引不強制查詢 → 這只證明 DB 側述詞可用;E2a 的 app 述詞是否含 guard 由關卡2 核(REQUIRED-E2a)。
-- 10. service_role 無 DELETE 實證(SET LOCAL ROLE service_role、非 SET ROLE〔pooled MCP SET ROLE 斷線前科,
--     memory reference_pooled-mcp-set-role-secdef-terminates〕;DELETE 預期 42501,用 DO … EXCEPTION WHEN
--     insufficient_privilege 捕、免 abort 主模擬 txn;RESET ROLE 收尾)。
-- 11. 無 trigger:SELECT count(*) FROM pg_trigger WHERE tgrelid='public.email_outbox'::regclass AND NOT tgisinternal → 0。
-- 12. realtime 縱深:SELECT count(*) FROM pg_publication_tables WHERE tablename='email_outbox' → 0(新表不在 publication)。
-- 13. ROLLBACK 後零留痕:表 / 索引 / grant 全消失(information_schema 再查為 0)。
--
-- 明知不做(防未來重提):
--   · DB 層狀態機鎖(如 status 轉移 trigger)= 不做:skipped_no_real_email 須可翻回 pending(§③),
--     且 CAS 認領已是 app 層唯一寫入路徑;加 trigger 會在 orders 相鄰面開全站第一個 outbox trigger、無收益。
--   · dedup_key 格式 CHECK = 不做:order_shipped 算法待 E4 偵察後定(§①),此刻加格式約束 = 憑猜想鎖死。
--   · DELETE grant / 清理 job = 不做:**backlog #281**(已開立實體條目、含保留政策待定與三視角痛點);
--     現階段給 DELETE 只擴大 blast radius、無使用者。
