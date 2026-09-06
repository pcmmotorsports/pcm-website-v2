/**
 * @module @pcm/adapters/email/ResendEmailSenderAdapter — 交易信寄送(M-4a Email 通知片 E1b/E1c)
 *
 * **🔴 server-only**:持 Resend API key(敏感、絕不進 client bundle)。鏡像 `EmailAlertNotifierAdapter`
 * (原生 fetch、零新依賴、config 注入不直讀 env),差異三點:
 * 1. 收件者逐封不同(客戶交易信、非固定告警收件者)→ `to` 在 send 入參、不在 config。
 * 2. 🔴 帶 `Idempotency-Key: <event_type>/<outbox_id>`(plan §3.5-2;官方保留 24h、只是第一道網,
 *    DB 唯一鍵 + sent 狀態不可省)。既有告警 adapter 無此 header(告警可重複、交易信不可)。
 * 3. 可預期失敗回結構化 `EmailSendErrorCode` 不 throw(outbox 需錯誤碼落表退避;throw 會把
 *    可重試失敗與程式錯誤混流)。
 *
 * 🔴 REQUIRED-E1b(**原則**):錯誤碼**原則上只**由 HTTP 狀態碼經固定映射表產生(非 allowlist 狀態
 * → `provider_error`、transport 失敗 → `network_error`)。錯誤路徑零 PII:不 log 收件者、不把回應
 * 內容帶進任何結果。🔴 **`message` 永不參與轉碼、永不外傳 —— 此條無例外。**
 *
 * ## § 窄幅破例(E1c;Sean 2026-07-17 Q6=A 授權;關卡1 codex+Fable 雙審)
 *
 * 🔴 **定性 = 授權下的破例,不是「原則從未被違反」。** codex 關卡1 must-fix 擊破後者:`res.json()`
 * **讀取 + 緩衝 + 解析整份 body** → `message` 已在記憶體物件裡;**「不讀」≠「不使用」**。
 * 前版(E1c plan v1)宣稱「PII 風險 = 0」**是不實宣稱、已作廢**。
 *
 * **允許範圍(逾此即違規)**:
 * 1. ⛔ ~~僅 `status === 429` 時讀 body(非 429 **完全不碰**、`json` 零呼叫)。~~
 *    🔴🔴 ⛔ ~~2026-09-06 射程擴大成【兩個入口】~~ ⇒ **2026-09-07 起是【三個】**
 *    (⟦b4-NOSENTBODY⟧ 加入口乙、⟦b4-RESEND409⟧ 加入口丙;主視窗裁擴射程 + **重跑雙審**)。
 *    **舊字面留刪除線** —— 搜「兩個入口」或「非 429 完全不碰」的人要同一發撞到訂正。
 *    ```
 *    入口甲  status === 429   → classify429()   僅存取頂層 `name`(規則 2)
 *    入口乙  res.ok === true  → readSentId()    僅存取頂層 `id`,四條約束見該函式
 *    入口丙  status === 409   → classify409()   僅存取頂層 `name`(規則與入口甲逐字相同)
 *    其餘任何路徑            → body 完全不碰、零呼叫   ← 這一句【沒有放寬】
 *    ```
 *    🛑 **每加一個入口都要回來改這一格** —— codex 2026-09-07 抓到我加了丙而這裡還寫「兩個」:
 *    📌 **一份規則註解落後於它要管的實作, 讀規則的人會照著它去判別人違規, 而錯的是規則。**
 *    🛑 **入口乙的約束(逾此即違規)** —— ⛔ ~~「只解析頂層 `id`」~~ **那句逐字不成立**
 *    (codex R1-#3):`JSON.parse` **先把整份 body 解析完、配置每一個欄位**, 我才去讀一個。
 *    ⇒ 📌 **精確措辭 = 「整份解析, 只【取用】一個」** —— 與本節對 `name` 那段同一個形狀,
 *      而那個形狀當年就是被同一位審查者訂正出來的, 我第一版沒照著寫。
 *    ```
 *    ① `JSON.parse` 會解析整份 body;解析後**僅取用頂層自有屬性 `id`**,
 *       其他欄位**不得存取、不得進入任何 sink**
 *    ② 取用要過三關:`Object.hasOwn`(擋原型污染)· `typeof === 'string'`
 *       · 格式白名單 `^[A-Za-z0-9-]{1,64}$`(擋「任意非空字串都落庫」)
 *    ③ ⛔ ~~大小上限走【兩道】:`content-length` 必須是 ≤ 上限的安全整數才往下;
 *       讀回來再用 `Buffer.byteLength` 確認一次~~ **整段作廢**(opus R2 · MF1 + C1)
 *       ✅ **上限改成【自己邊讀邊數】**:逐塊讀 `res.body`, 累計位元組超過上限就
 *       **當場放棄、`cancel()`、回 `null`** ⇒ 缺標頭 / 標頭說謊 / chunked 走同一條路。
 *       📌 **判準不再依賴對方的任何宣告**, 所以「Resend 帶不帶 content-length」不必驗。
 *    ④ 任何一步不成立一律 `null`, 而**它不影響分類結果**(照樣 `sent`)
 *    ```
 *    🔬 **官方文件的成功回應逐字**(2026-09-06 親讀):`{ "id": "…" }` —— **只有一個欄位**。
 *    ⚠️ **而上面四條【不依賴那份文件】** —— wire 不可信(同本節對 `name` 的處理),
 *    所以它們對**任何** body 都成立。
 *    🛑 **入口乙的殘餘風險(訂正;opus R2 · MF1)**:
 *    ⛔ ~~「標頭缺失時仍會 `text()` ⇒ 短暫記憶體暴露」~~ —— **那個世界碼裡不存在**
 *    (舊碼在缺標頭時直接 `return null`, 根本走不到緩衝), 而**真的會緩衝**的世界
 *    (宣告騙人說小、實際很大)我一個字都沒寫。📌 **一份把暴露面指錯地方的清單, 比沒有清單糟。**
 *    ✅ **現在的形狀**:仍然緩衝, 而**緩衝有上界 = 上限 + 最後一塊**, 且
 *    **那個上界不由對方宣告** ⇒ 與入口甲(`json()` 無上界)相比**這一條更緊**, 不是同級。
 * 2. 🔴 **精確字面(codex 關卡2 nit;前版「僅讀頂層 name 單一欄」不精確、與下方殘餘風險段自相拉扯)**:
 *    `json()` **會解析整份 body**;解析後**僅存取頂層 `name`**,且**只有 `name` 可影響分類結果**;
 *    其他欄位(尤其 `message`)**不得存取、不得進入任何 sink**。`name` 以 `unknown` 處理
 *    (wire 不可信:官方 TS union 是編譯期保證、**非 runtime 封閉輸入**)。
 * 3. 僅接受 `QUOTA_ERROR_CODE_BY_NAME` 的**三個本地固定字面**,其餘一律 `http_429`
 *    (🔴 該表必須是 `Map` —— 物件字面量的原型鏈會破此條,見該表註解)。
 * 4. 🔴 **射程限定 =【入口甲】**(opus R2 · C3 補;⛔ ~~原本沒寫入口~~ ——
 *    照舊字面 grep 的人會判入口乙違規):**429 那份 body 的原文不跨出區域變數**
 *    —— 不落表、不 log、不進任何回傳結果。
 *    🛑 **入口乙【是明文例外, 而例外只有一個欄位】**:過完三關的 `id` **就是要落表的**
 *    (那正是 ⟦b4-NOSENTBODY⟧ 這一片的目的), 而它**只落 DB 那一欄** ——
 *    不 log、不進 sweep 回傳統計、不進任何其他 sink。`id` 以外的每一個欄位照第 1 條, 一律不得存取。
 *
 * **殘餘風險(誠實、非 0)**:`json()` 必然緩衝整份 body → **短暫記憶體暴露**。可接受理由 = 生命週期
 * 限於單次 `send` 呼叫、無 sink、且無同等可靠的替代方案能保住 Q5=A 的額度訊號(codex 關卡1 背書:
 * 「若完全禁止 body,目前沒有同等可靠又能保留 Q5 額度訊號的替代方案」)。
 *
 * **為什麼非做不可**:E1c 前 429 恆映射 `http_429` → 撞日額度時,可重試的信會被當一般失敗、
 * 在幾分鐘內(sweeper 每 5 分鐘一輪)燒完 5 次 attempts → **永久死信,即使隔天額度重置也不補寄**。
 * ⚠️ **精確算式(關卡2 兩審皆抓前版「33 單/日即撞」無成立假設;R2 再抓口徑混用)**:
 * Resend Free = 100 封/日 → **累計第 101 封起命中**。換算訂單數**取決於每單封數** = 1(付款信)
 * + N(出貨批數;E4 的 S2=B「每批一封」),**兩個口徑分開講**:
 * · 單批出貨 = 2 封/單 → **完整涵蓋 50 單**;首個受影響訂單 = 第 **51** 單(其第 1 封 = 第 101 封)。
 * · 雙批出貨 = 3 封/單 → **完整涵蓋 33 單**;首個受影響訂單 = 第 **34** 單(其第 2 封 = 第 101 封)。
 * **告警信與其他 Resend 用途吃同一額度**,實際門檻更低。
 */
import 'server-only';

import type { IEmailSender, SendEmailInput, SendEmailResult, EmailSendErrorCode } from '@pcm/ports';

import { OUTBOUND_SEND_TIMEOUT_MS } from '../outbound-timeout';

/**
 * 🔴 **單封端點。要改成批次的人先讀這句**:Resend 官方明文
 * 「Attachments cannot be sent via the batch email endpoint」——
 * 換成 `/emails/batch` 之後,**附件會安靜地送不出去**(不是報錯,是信照寄而少了那份 PDF)。
 * ⇒ 客人收到一封說「附件是您的訂單明細」而沒有附件的信,而**寄出去收不回來**(鐵則 12⑤)。
 * 📎 查證來源:`~/pcm-mailbox/58-片B前置查證-附件與到達率-20260823.md`(2026-08-23 官方文件親讀)。
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * 一封信所有附件 **base64 編碼後**的 **UTF-8 位元組**總和上限。
 *
 * 🔴🔴 **名字從 `…_CHARS` 改成 `…_BYTES`**(cf 審查 MF-1)。原本叫 CHARS,而 adapter 內部
 * 早在 codex R1 MF-2 就改成量 `Buffer.byteLength` 了 ⇒ **這個名字會教呼叫端寫**
 * `myBase64.length > 上限` —— 非 ASCII 時他判「沒超過」而 adapter 照樣 throw,
 * ⇒ **呼叫端等於重現了那個剛被修掉的 bug,而是【常數的名字】教他的。**
 * 📌 形狀:**局部修正會提高未修正部分的可信度 —— 受害者是 diff 上沒有變的那幾行。**
 *    我列了「量法改了」,而**我沒有列到「名字沒跟著改」**。
 *
 * 來源:Resend 官方 attachments 段「max 40MB per email, after Base64 encoding」
 * (2026-08-23 親讀;全文 `~/pcm-mailbox/58-片B前置查證-附件與到達率-20260823.md`)。
 * ⇒ 量的是**我們真的要送出去的那份內容的 UTF-8 位元組數**(`Buffer.byteLength`),
 *   不是原始 bytes 乘 4/3(那是推出來的),**也不是字串的 `.length`**。
 * 🔴 ~~原本這裡寫「量的是那個字串長度…前者是量到的」~~(codex R2 MF-1 更正)——
 *   那句在【內容真的是 ASCII base64】時與 byte 數相等,而它是一個**前提**不是保證。
 *   ⇒ 留著它會**再一次**把呼叫端引導去用 `.length`,而那正是 cf MF-1 剛修掉的病。
 * 📌 **同一個病在這包出現三處**:名字(已修)、port 契約(已修)、**而 adapter 自己的註解沒跟**。
 *    ⇒ 「一天四例」那份清單裡的第①項,**遺漏的是兩處不是一處**。
 *
 * ⚠️ **未確認的兩格,照實寫、不編數字**:
 * · **附件【數量】上限** —— 官方那段沒給,repo 也沒有第二來源 ⇒ **本檔不設數量上限**。
 *   (設一個「看起來合理」的數字 = 發明一條沒人驗過的規則,而它會擋掉合法的信。)
 * · **檔名長度上限** —— 官方只對「用 content ID 的附件」講過 <128 字元,而我們沒用 content ID
 *   ⇒ 對本路徑**是否適用未確認** ⇒ 不設。
 */
export const RESEND_MAX_ATTACHMENTS_BASE64_BYTES = 40 * 1024 * 1024;

/**
 * 附件超量 ⇒ **在送出去之前 throw**,而不是回 `failed`。
 *
 * 🔴 **為什麼不走 `failed` 那條路**:port 的「不 throw」約的是**可預期失敗**
 * (HTTP 非 2xx / transport / 畸形回應)—— 那些**重試會好**。附件太大不會好:
 * 重試幾次都一樣大 ⇒ 落 `failed` 只會安靜地燒完 attempts,而失敗原因被記成一個錯的碼。
 *
 * 🔴🔴 **而上面那個意圖【今天沒有達成】—— 這不是過期,是它從寫下的那天就不成立**:
 * `sweep-email-outbox.ts:229-253` 有一個 **per-job `try/catch`**,它會接住這個 throw
 * ⇒ 計 error、列留 `sending`、回收、**一樣安靜地燒完 attempts**。
 * ```
 * 那個 try/catch 進版控 = a691a9d8(2026-07-17)   本註解寫於 2026-08-24
 * ⇒ 它比本註解早【五週】。不是後來有人加上去把它蓋掉的。
 * ```
 * 📌 **形狀:一段註解宣告了一個保證,而那個保證在【一個檔案之外】就失效了 ——
 *    而註解不會知道自己出了作用域。**
 * ⇒ **本片刻意不修那個行為**:修它要動 `sweep-email-outbox` 的失敗分類 = 寄信流程的行為改動
 *   (鐵則 12⑤),會讓這一片從「零行為改變」變成「有行為改變」。**那是換一片,不是把這片做完。**
 * ⇒ 條目 **`#921`**:接 PDF 的那個人會看到「信沒寄出去、attempts 燒完了,而**沒有任何一列說是
 *   因為附件太大**」⇒ 他會去查寄信服務、查網路、查憑證,而原因在他自己剛接上的那個附件。
 * 🔴 **而更重要的是它 throw 的【時機】:一次網路呼叫都還沒發生。**
 *    超量的信送到 Resend 會被退,而被退會傷寄件信譽 —— 那是**整個信箱**的事,不只這一封
 *    (同族:`20260717020000:28-31` 的 bounce rate)。⇒ 這一發要擋在我們這一側。
 */
export class EmailAttachmentTooLargeError extends Error {
  constructor(
    readonly totalBase64Bytes: number,
    readonly limit: number,
  ) {
    super(
      `附件總量超過上限(base64 後 ${totalBase64Bytes} 位元組 > ${limit})—— 一封都沒有送出去。` +
        ' 超量的信會被 provider 退回,而退信傷的是整個網域的寄件信譽,不只這一封。',
    );
    this.name = 'EmailAttachmentTooLargeError';
  }
}

/**
 * 最小 fetch 抽象(本地定義、**刻意不共用** `payment/LineAlertNotifierAdapter` 的 `FetchLike`)。
 * 🔴 理由(codex 關卡1 must-fix):共用版回應型別只有 `{ ok, status }`、**無 `json()`** → 本 adapter
 * 若沿用,實作者只能危險 cast、或去擴張那個共用型別 → **意外波及 LINE 告警 adapter**(它也在用)。
 * 故本地窄化:`json` 為 **optional**(wire 不保證存在)、回 `unknown`(body 不可信、見檔頭 §窄幅破例-2)。
 */
export type ResendFetchLike = (
  input: string,
  // 🔴 `signal` 是**必填**(⟦mail-FETCHTIMEOUT⟧ 2026-09-06)——
  //    選填的話, **漏傳的那一支不會型別紅**, 而它的症狀是「送出去之後永遠不回」。
  //    📌 一道 fail-open 的閘比沒有閘更糟, 所以這裡讓 tsc 當那道閘。
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  // 🔴 ⟦b4-NOSENTBODY⟧(2026-09-06):成功路徑要拿 provider 的訊息 id。
  //    兩個都 optional —— 替身可以不給, 而 `readSentId` 對「不給」回 null(不 throw)。
  //    🔵 `text` 而不是 `json`:大小上限要在【parse 之前】量, 而 `json()` 直接就 parse 了。
  headers?: { get?: (k: string) => string | null };
  text?: () => Promise<string>;
}>;

/** HTTP 狀態 → 有限錯誤碼映射表(封閉;值受 EmailSendErrorCode union 型別檢查)。 */
const ERROR_CODE_BY_STATUS: Readonly<Record<number, EmailSendErrorCode>> = {
  400: 'http_400',
  401: 'http_401',
  403: 'http_403',
  404: 'http_404',
  408: 'http_408',
  409: 'http_409',
  422: 'http_422',
  // ⚠️ 死碼(關卡2 code-reviewer nit):429 在 `send` 內於查表**前**即被 §窄幅破例攔截 → 永不落此項。
  //    保留僅為映射表完整性 + 防「未來移除攔截」時無聲落 provider_error。改此項無效果、勿誤以為有。
  429: 'http_429',
  500: 'http_500',
  502: 'http_502',
  503: 'http_503',
  504: 'http_504',
};

/**
 * 🔴 429 body `name` → 內部錯誤碼(**窄幅破例的全部允許集**;三字面寫死、其餘一律 `http_429`)。
 *
 * 🔴 **必須是 `Map` 不可用物件字面量**(關卡2 code-reviewer Critical + codex must-fix **獨立雙命中**):
 * 物件字面量帶 `Object.prototype` → 429 + body `{"name":"toString"}`(或 `constructor`/`valueOf`/
 * `hasOwnProperty`/`__proto__`)會**查到繼承來的函式/物件而非 undefined** → `?? 'http_429'` 不觸發
 * → `errorCode` 在執行期**違反 union**(TS 的 `Record<string,…>` 索引簽章不會紅)→ 下游 allowlist
 * 把它改寫成 **`provider_error`(非 `http_429`)** → 走非保守退避 → 幾分鐘燒完 attempts → 死信
 * = **重開本片要關的洞**。`Map.get()` 不查原型鏈。⚠️ 勿「順手」改回物件字面量。
 *
 * 左側 = Resend **官方 enum 字面**(2026-07-17 查證):
 * · 官方 errors 頁列 21 碼、**掛 429 的恰好只有這三個**。
 * · resend-node `src/interfaces.ts`:`ErrorResponse = { message; statusCode; name: RESEND_ERROR_CODE_KEY }`,
 *   且 `src/resend.ts` `fetchRequest` 對非 2xx **把 body 解析後直接當 `ErrorResponse` 回傳**(零重組)
 *   → **強烈支持「429 body 含 `name`」此一預期**。
 *   ⚠️ **但這是 SDK 的型別宣告與預期,不是 wire 實證**(codex 關卡2 R2 nit;前版「即含 `name`…最強證據」
 *   為過度宣稱、已改)。
 * ⚠️ **殘餘不確定(誠實揭示;codex 關卡2 R1 抓出前版「三來源直證」失真)**:**兩官方 SDK 對 429 不一致**
 * —— resend-go `resend.go` 的 `case http.StatusTooManyRequests` 解成 `DefaultError{ Message string }`、
 * **不含 `Name`**(`name` 只在 400/422 的 `InvalidRequestError`)。前版註解稱「go json tag 直證 wire
 * format」**是失真引用、已刪**(Claude 親查兩 SDK 原始碼確認 codex 為對)。
 * → 🔴 **影響評估(codex 關卡2 R2 must-fix 更正前版)**:若 429 body 實際無 `name` → `classify429`
 *   恆回 `http_429` → 依 union 合約走 **≥24h 長退避** → **所有 429 的信都白等約 24h**。
 *   故**不得**宣稱「最壞情況本片無效果 / 不會壞 / 零回歸」(前版此字面**已作廢**)。
 *   此代價 = **Sean 2026-07-17 拍 Q11=A 明示接受**(理由與第三選項見 `EmailSendErrorCode.http_429`
 *   JSDoc + backlog **#285**)。
 *
 * 右側 = provider 中立內部碼(退避政策見 `EmailSendErrorCode` 逐碼 JSDoc)。
 * ⚠️ 新增 provider 或官方新增 429 碼 → 改本表 + union;**未知一律落 `http_429`**(=保守長退避)。
 */
/**
 * ⟦b4-NOSENTBODY⟧ 成功回應 body 的大小上限(bytes)。
 * 🔵 **4 KB 是一個【刻意寬鬆】的上限** —— 官方文件的成功回應只有一個 uuid(約 50 bytes),
 *    而這裡留兩個數量級的餘裕:它要擋的是「**回了一個我們沒預期的大東西**」,
 *    不是「精準地只放得下我預期的那一份」。
 * 🛑 而它擋 parse 不擋緩衝(見 `readSentId` 的檔頭)。
 */
const SENT_BODY_MAX_BYTES = 4096;

/**
 * provider 訊息 id 的格式白名單(⟦b4-NOSENTBODY⟧, codex R1-#5)。
 * 🔵 官方回的是 uuid;這裡放寬到 `[A-Za-z0-9-]{1,64}` —— **擋的是「那不是一個 id」**,
 *    不是「那不是我預期的那一種 id」(provider 日後換格式不該讓這一欄整個空掉)。
 * 🛑 而它**擋掉了**:信箱(有 `@`)、整封信(有空白與標點)、控制字元、超長字串。
 */
const PROVIDER_MESSAGE_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const QUOTA_ERROR_CODE_BY_NAME: ReadonlyMap<string, EmailSendErrorCode> = new Map<
  string,
  EmailSendErrorCode
>([
  ['rate_limit_exceeded', 'rate_limited'],
  ['daily_quota_exceeded', 'quota_daily_exceeded'],
  ['monthly_quota_exceeded', 'quota_monthly_exceeded'],
]);

/**
 * ⟦b4-RESEND409⟧ **409 那三種裡, 只有這一種需要換一個碼。**
 *
 * 🔬 官方(https://resend.com/docs/api-reference/errors, 2026-09-07 親讀, 不憑記憶):
 * ```
 * concurrent_idempotent_requests  Try the request again later      ⇒ 重試會成功 ⇒ 留 http_409
 * resource_locked                 Retry the request after a short delay ⇒ 重試會成功 ⇒ 留 http_409
 * invalid_idempotent_request      Change your idempotency key or payload ⇒ 🔴 重試永遠不會成功
 * ```
 * 🛑 **只列第三種是刻意的** —— 前兩種留在 `http_409` 走指數退避, 那是**對的行為**。
 *    📌 **一張「把 409 全部搬走」的表, 會把兩種【本來就會成功】的重試也一起改掉。**
 * 🔴 表必須是 `Map`(非物件字面量)—— 與 `QUOTA_ERROR_CODE_BY_NAME` 同一個理由:
 *    物件索引會查原型鏈, `name='toString'` 這種會撈到函式而非 undefined。
 */
const IDEMPOTENCY_ERROR_CODE_BY_NAME: ReadonlyMap<string, EmailSendErrorCode> = new Map<
  string,
  EmailSendErrorCode
>([['invalid_idempotent_request', 'idempotency_payload_mismatch']]);

export type ResendEmailSenderConfig = {
  /** Resend API key(server-only 密鑰)。 */
  apiKey: string;
  /** 寄件者(需 Resend 已驗證網域;E1 定案 orders@pcmmotorsports.com、由 composition 從 env 注入)。 */
  from: string;
};

export class ResendEmailSenderAdapter implements IEmailSender {
  constructor(
    private readonly cfg: ResendEmailSenderConfig,
    private readonly fetchImpl: ResendFetchLike = globalThis.fetch as unknown as ResendFetchLike,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    // 🔴 冪等鍵由本 adapter 組字面(codex 關卡2 R1:port 收結構化座標、不收自由字串,
    // 呼叫端無法誤餵 orderId/dedupKey/亂數)。
    const idempotencyKey = `${input.idempotency.eventType}/${input.idempotency.outboxId}`;
    // 🔴 **空陣列與沒給,一律當作沒有附件**(port 明文)——
    //    帶一個空的 `attachments: []` 會讓既有呼叫端的 payload 逐位元改變,
    //    而那個改變沒有任何人要求;也讓「沒有附件」與「附件掉了」在 wire 上長得一樣。
    // 🔴 **只認【自己身上】那個 key**(codex R1 MF-1):`input.attachments` 會走原型鏈,
    //    `Object.prototype.attachments` 被污染成非空陣列或 getter 時,**既有那個一個字都沒改的呼叫端會突然送出附件、或直接 throw** —— 而改動前那份碼**根本不會讀這一欄**。
    //    ⇒ 「零行為改變」這個宣稱在那個世界會破掉,而三綠不會紅。
    const raw = Object.prototype.hasOwnProperty.call(input, 'attachments')
      ? (input.attachments ?? [])
      : [];
    // 🔵 **html 這一欄照抄上面那三個決定,而【第四個決定刻意不同】——**(2026-09-01 片1)
    //    ⛔ ~~第一版這裡寫「逐字照抄」~~ **那是假的**(code-reviewer 抓到):
    //    🔴 attachments 對畸形輸入 **throw**(見下方兩處 TypeError);html 對畸形輸入 **安靜丟掉**。
    //    ⇒ 而差別是刻意的,理由在【丟掉的東西是什麼】:
    //      · 畸形 attachment ⇒ 呼叫端**要求寄一份文件**而它壞了 ⇒ 安靜丟 = 客人收到一封少了附件的信
    //      · 畸形 html      ⇒ 那封信**仍然完整**(`text` 必填且原樣)⇒ 丟掉 = 退回今天的行為
    //    🛑 ⇒ 所以這裡選的是「**退回純文字**」而不是「**擋下整封信**」。
    //      而擋下整封信會讓一個模板 bug 變成**客人收不到付款通知** —— 那比收到純文字糟。
    //    ⛔ ~~第一版把它寫成「fail-closed 方向」~~ **用詞錯了**(codex nit):
    //      **fail-closed 是【擋下整封信】那一個**;這裡做的是 graceful degradation / fail-safe。
    //      ⇒ 📌 而那不只是名詞 —— 用錯名詞會讓下一個人以為這裡已經是最嚴的那一檔。
    //    ① 只認【自己身上】那個 key —— `Object.prototype.html` 被污染時,
    //       **一個字都沒改的既有呼叫端會突然送出一份 HTML**,而改動前那份碼根本不讀這一欄。
    //       ⚠️ **而它擋的範圍要講準**(codex nit):它擋的是**一般物件的原型污染**。
    //       惡意 `Proxy` 的 `has`/`get` trap、被換掉的內建 `hasOwnProperty`、或會 throw 的 own getter
    //       **都繞得過** ⇒ 那些不在這道門的射程裡(而今天唯一的生產呼叫端是個物件字面量)。
    //    ② 空字串當作沒給 —— 帶 `"html":""` 出去會讓既有信的 payload 逐位元改變,
    //       也讓「這封信沒有 HTML」與「HTML 組出來是空的」在 wire 上長得一樣。
    //    ③ **不驗內容**(不 sanitize / 不量長度 / 不判合法性)—— 那是產出側的契約,
    //       理由與 Gmail 102KB 那條為什麼不在這一層,全文寫在 port 的 `html?` 那一格。
    //    🛑 而型別上它是 `string | undefined`,**runtime 不能只信型別** ——
    //       污染來的值可以是任何東西 ⇒ 這裡用 `typeof === 'string'` 當實際的門。
    const rawHtml: unknown = Object.prototype.hasOwnProperty.call(input, 'html')
      ? input.html
      : undefined;
    const html = typeof rawHtml === 'string' && rawHtml.length > 0 ? rawHtml : null;
    // 🔴 **一次讀完並定住**(codex R1 MF-3):原本量一次、送出時再讀一次
    //    ⇒ getter / Proxy 可以第一次回短字串、第二次回一份超量的有效 base64,**繞過前面那道 throw**。
    //    ⇒ 之後所有用到的都是這份快照,`input` 那一側再怎麼變都影響不到已經量過的東西。
    // 🔴🔴 **上一版這裡的註解說錯了它自己在做什麼**(codex R2 MF-2)——
    //    我寫「`String(...)` 擋的是欄位不是字串」「`Array.from` 對非陣列會安靜產出 `[]`」,
    //    而 codex 實測兩句都不對:
    //    ```
    //    String(x)          是【強制轉型】不是擋住 ⇒ undefined 會變成字串 "undefined"
    //    Array.from('AB')   不是 []  ⇒ 字串是可迭代的 ⇒ 得到兩個元素
    //    ⇒ 傳 attachments: 'AB' ⇒ **送出兩個 filename/content 都是 "undefined" 的附件**
    //    ```
    //    📌 **這一條與「我改了 A 而 B 沒跟」不同族:那句話從來就不對,不是後來過期的。**
    //
    // ⇒ 處置:**只收真正的陣列,而元素的兩個欄位必須真的是字串**,否則 throw。
    //    🔴 **而這【不是】我在替一個沒人問過的產品決定拍板** —— 我選的是
    //      **唯一不與這個檔已經寫下的決定牴觸的那個**:
    //      · 「安靜忽略」會走到本檔已經寫下要防的那條路:**信說有附件而沒有附件**
    //      · 「假裝有附件」(現況)比兩個候選都差 —— 它會把 "undefined" 當成客人的訂單明細寄出去
    //      · 而 port 已定的紀律是:**重試不會好的失敗要 throw,不要回 `failed`** —— 畸形輸入不會好
    //    ⚠️ 若日後有人要改成「忽略」,那是一個**產品決定**,而它是一行:把 throw 換成 `[]`。
    //      **這一格留著這句話,不要讓下一個人以為它從來沒有被想過。**
    if (!Array.isArray(raw)) {
      throw new TypeError('attachments 必須是陣列 —— 收到別的東西時不得猜,否則會寄出假的附件。');
    }
    const attachments = raw.map((a) => {
      // 🔴🔴 **先讀進區域變數,再驗那個區域變數** —— 順序反過來就會讀兩次。
      //    我第一版寫成「先 `typeof a.contentBase64` 驗、再 `a.contentBase64` 取值」
      //    ⇒ **兩次讀取** ⇒ getter 可以第一次回合法短字串、第二次換成超量的
      //    ⇒ **我折 R2-MF2 的時候,把 R1-MF3 那道守門打壞了**,而是那格測試當場叫的。
      //    📌 又一次「折 A 開出 B」—— 而這次擋住它的是**上一輪留下來的那格測試**。
      const filename: unknown = a?.filename;
      const contentBase64: unknown = a?.contentBase64;
      if (typeof filename !== 'string' || typeof contentBase64 !== 'string') {
        throw new TypeError('附件的 filename 與 contentBase64 必須是字串(不轉型、不猜)。');
      }
      return { filename, contentBase64 };
    });
    // 🔴 **量在送出去之前**:一次 fetch 都還沒發生(見 `EmailAttachmentTooLargeError`)。
    if (attachments.length > 0) {
      // 🔴 **量 byte 不量 `.length`**(codex R1 MF-2):`.length` 數的是 UTF-16 code unit。
      //    合法 base64 全是 ASCII ⇒ 兩者相同;而**那是一個前提,不是一個保證** ——
      //    餵進 CJK / emoji / 落單 surrogate 時,真正送出去的 UTF-8 bytes 可以是 `.length` 的三倍,
      //    ⇒ 低於門檻而照樣發出一發超量的請求。
      //    ⚠️ 刻意**不驗 base64 格式**:那是產出側的契約(檔名同理,見 port)。
      //       改量 byte 之後,這道閘**對內容是什麼一律成立**,所以不需要先假設它是 base64。
      const totalBytes = attachments.reduce(
        (sum, a) => sum + Buffer.byteLength(a.contentBase64, 'utf8'),
        0,
      );
      if (totalBytes > RESEND_MAX_ATTACHMENTS_BASE64_BYTES) {
        throw new EmailAttachmentTooLargeError(totalBytes, RESEND_MAX_ATTACHMENTS_BASE64_BYTES);
      }
    }
    try {
      const res = await this.fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
      // 🔴🔴 **逾時上界(⟦mail-FETCHTIMEOUT⟧ 2026-09-06;opus R2 · C2)** ——
      //    沒有它, 一個【送完 header 就停住】的伺服器會讓這個 await 永遠不回,
      //    而平台會在 60 秒砍掉整個 function ⇒ 那一列留在 `sending`、燒一次 attempt。
      // 🔴🔴 **逾時會走進【兩條】完全不同的路, 而它們的結果相反**(codex R1 #4 訂正我原本只寫一條):
      //    ⛔ ~~「逾時 ⇒ 收成 network_error」~~ **那句只對【其中一半】**。
      //    ```
      //    ① header 都還沒回來就到期  ⇒ fetch 本身 reject ⇒ 下面的 catch ⇒ failed / network_error
      //    ② header 已經回來(ok:true), 讀 body 時才到期
      //       ⇒ 🛑 fetch 那個 promise 【已經 resolve 了, 不會再 reject】
      //       ⇒ abort 打在 body 的 stream 上 ⇒ `readSentId` 內部收成 `null`
      //       ⇒ **結果是 `sent` 而 `providerMessageId` 是 null**
      //    ```
      //    ✅ **而②是【對的】** —— 200 已經回來了, 代表 provider **收下了那封信**;
      //      標 `sent` 是正確的, 只是我們沒拿到編號。📌 兩條路都不會讓那一列卡在 `sending`,
      //      而那才是這個 signal 要買的東西。
      // 🛑 **逾時【不等於】沒寄**(對①而言):伺服器可能已經收下並寄出了, 只是回應沒回來。
      //    ⇒ 📌 **`failed` 在①這一格的意思是「我不知道」, 不是「沒寄」。**
      //    ⇒ 自動重試不會變成兩封:冪等鍵 `<event_type>/<outbox_id>` **跨重試穩定**, Resend 保留 24h。
      //    ⚠️ **而那個保證有射程**(codex R1 #5):`attempts` 燒完進死信之後,
      //      **人手重排若已超過 24 小時, 去重窗已經過期 ⇒ 客人【會】收到第二封。**
      //      ⇒ 那不是本片引進的, 而它是「標 failed 可重排」這個裁定的**已知代價**, 寫在這裡不藏。
      // ⚠️ **秒數的未量前提**:`email-sweep/route.ts:97` 那句「單封 ~數百 ms」是註解不是量測
      //    ⇒ **上線第一天量 `sent_at − claimed_at` 的 p99, > 3 s 這個 10 秒要重談**
      //      (板列 ⟦mail-FETCHTIMEOUT⟧;全文在 `outbound-timeout.ts`)。
      signal: AbortSignal.timeout(OUTBOUND_SEND_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
          // 🔴 **有 html 才出現這個 key**(同一個形狀,見上面 `rawHtml` 那段)。
          //    寫成 `html: html ?? undefined` 也會被 `JSON.stringify` 丟掉 ——
          //    ⚠️ 而那個寫法**誘導下一個人給空字串**(以為「反正會被丟掉」),而空字串會真的送出去。
          //    ⇒ 用條件展開,讓「不出現」是**結構決定的**,不是靠序列化的副作用。
          ...(html !== null ? { html } : {}),
          // 🔴 **有附件才出現這個 key**(展開一個空物件 ⇒ 零改變)。
          //    寫成 `attachments: attachments` 的話,既有的信 body 會多一個 `"attachments":[]`
          //    —— 那是一個**沒有人要求的、對外可見的**改變,而三綠不會紅。
          ...(attachments.length > 0
            ? {
                // 🔴 逐欄具名,**不用 `...a` 展開** —— 展開會把未來新增的欄自動送給 provider。
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  content: a.contentBase64,
                })),
              }
            : {}),
        }),
      });
      // 回應形狀驗證留在 try 內(畸形回應/getter 拋錯 → fail closed,不外洩為程式錯誤)。
      if (res?.ok === true) {
        // 🔴🔴 **§窄幅破例的【第二個入口】(2026-09-06 擴大射程, 主視窗裁 + 雙審)** ——
        //    在此之前這一行逐字是 `return { kind: 'sent' }`, 成功路徑 `json` 零呼叫。
        //    ⇒ 📌 **它不是「多讀一個欄位」, 是【多開一條讀 body 的路】** ——
        //      那正是我一開始判它超出原授權的理由, 而射程是被【重新裁過】才擴大的。
        // 🔵 **拿不到 id 不影響結果** —— 照樣 `sent`(信真的寄出去了)。
        return { kind: 'sent', providerMessageId: await readSentId(res) };
      }
      const status = typeof res?.status === 'number' ? res.status : null;
      // 🔴 §窄幅破例的**入口甲**:429 這一條碰 body(⛔ ~~唯一入口~~ —— 2026-09-06 起有兩個,
      //    入口乙在上面那個 `res?.ok === true` 分支;舊字面留刪除線, 見檔頭)。
      if (status === 429) {
        return { kind: 'failed', errorCode: await classify429(res) };
      }
      // 🔴 §窄幅破例的**入口丙**(⟦b4-RESEND409⟧ 2026-09-07):409 這一條也碰 body,
      //    而規則與入口甲逐字相同 —— **只取頂層 `name`, 原文不跨出區域變數**。
      //    ⇒ 理由:409 有三種而它們不同命(見 `IDEMPOTENCY_ERROR_CODE_BY_NAME`),
      //      只看數字狀態碼分不出來, 而分不出來的代價是**一整封信進死信**。
      if (status === 409) {
        return { kind: 'failed', errorCode: await classify409(res) };
      }
      // 非 429:只看數字狀態碼、不讀回應 body;非映射表內(含畸形回應無 status)→ provider_error 兜底。
      return {
        kind: 'failed',
        errorCode: status === null ? 'provider_error' : (ERROR_CODE_BY_STATUS[status] ?? 'provider_error'),
      };
    } catch {
      // transport 失敗(DNS / 連線 / 逾時)。🔴 刻意不讀 error.message 轉碼(REQUIRED-E1b 原則)。
      return { kind: 'failed', errorCode: 'network_error' };
    }
  }
}

/**
 * ⟦b4-NOSENTBODY⟧ 成功回應裡的 provider 訊息 id —— **§窄幅破例的第二個實作點**。
 *
 * 🔴🔴 **四條約束逐字寫死在這裡, 而它們就是那一裁的內容**(主視窗 2026-09-06):
 * ```
 * ① 只解析【頂層 id】, 其餘欄位一律不讀、不存、不印
 * ② 型別必須是 string, 否則 null
 * ③ body 超過上限就【不 parse】, 直接 null
 * ④ 拿不到一律 null —— 而它【不影響分類結果】(照樣 sent)
 * ```
 * 🔬 **官方文件的成功回應逐字**(2026-09-06 親讀):`{ "id": "49a3999c-…" }`
 *    ⇒ **只有一個欄位**, 沒有 `to`、沒有內容。
 *    ⚠️ **而我不靠那個文件當保證** —— wire 不可信(同檔頭對 `name` 的處理),
 *      所以上面三道約束是**對任何 body 都成立**的, 不是「因為文件說只有 id」。
 *
 * 🔴🔴 **上限的實作方式已改**(opus R2 · MF1 + C1;主視窗 2026-09-06 裁「用設計讓它消失」)——
 *    ⛔ ~~先看 `content-length`, 是 ≤ 上限的安全整數才叫 `text()`~~ **整段作廢**。
 *    🛑 **兩個獨立的理由, 各殺掉那個設計的一半**:
 *    ```
 *    MF1  我寫的殘餘風險描述的是一個【碼裡不存在的世界】——
 *         「標頭缺失時仍會 text()」⇒ 而碼在缺標頭時【直接 return null】, 那個世界到不了緩衝。
 *         而【真的會緩衝】的世界(宣告騙人說小、實際很大)我一個字都沒寫。
 *         📌 一份把暴露面【指錯地方】的清單, 比沒有清單糟 —— 下一個審邊界的人會照它去看錯的地方。
 *    C1   判準綁在 `content-length` 上, 而 HTTP/2 與 chunked 【合法地不帶它】
 *         ⇒ 那時每一列都是 null, 而 null 不影響分類、不進計數、無 log
 *         ⇒ 🛑 **「這個功能完全沒生效」與「一切正常」在儀表上同形。**
 *    ```
 *    ✅ **改法 = 不再問任何人 body 有多大, 自己【邊讀邊數】**:逐塊讀 `res.body`,
 *      **累計位元組超過上限就當場放棄、`cancel()` 掉、回 `null`**。
 *      ⇒ 缺標頭 / 標頭說謊 / chunked **走【同一條路】**, 而
 *      ⇒ 📌 **「Resend 到底帶不帶 content-length」這個問題不必再驗** —— 它已經不在判準裡。
 *
 * 🛑 **而【緩衝】這一項仍然不是 0, 誠實寫清楚它現在的形狀**:
 *    最壞情況記憶體 = **上限 + 最後一塊的大小**(踩線那一塊要先讀進來才數得到)。
 *    ⇒ 那是**有上界**的, 而舊設計在標頭說謊時**沒有上界**(`text()` 會把整份讀完)。
 *    ⇒ 📌 這是本次改動真正買到的東西:**不是「不緩衝」, 是「緩衝有上界, 而上界不由對方宣告」。**
 *
 * 🔵 **任何一步失敗都回 `null`, 不 throw** —— 這一格不可以讓一封【已經寄出去的信】變成失敗。
 *
 * 🛑🛑 **已知缺口, 不折而寫下來(opus R2 · C2)——【一個沒有上界的 await】**:
 *    上面那個上限管的是**位元組數**, 它**管不到時間**。伺服器送完 header 之後**停住不送 body**
 *    ⇒ `read()` 永遠不 resolve ⇒ `send()` 不回 ⇒ 平台 60s kill
 *    ⇒ 那一列留在 `sending`、燒掉一次 attempt, **而信【已經寄出去了】**。
 *    🔴 **這是本片【新增】的阻塞點** —— 改動前成功路徑完全不碰 body(429 那條路早就有同型的)。
 *    ⚠️ **而換成 reader 沒有改善它, 也沒有惡化它** —— `text()` 一樣會停在那裡。
 *    ✅ 真正的修法是**給 fetch 一個 signal/timeout**(`composition.ts:82` 目前用預設 `globalThis.fetch`,
 *      無 signal、無 timeout)⇒ 那會動到**每一條**送信路徑, **不屬本片射程** ⇒ 已回報主視窗排板。
 */
type BodyReader = {
  read: () => Promise<{ done?: boolean; value?: Uint8Array }>;
  cancel: () => Promise<unknown>;
};

// 🔴 參數收成 `unknown` 而不是一個結構型別 —— **wire 不可信**(同本檔對 `name` 的處理):
//    型別上長得對不代表 runtime 真的有那些方法, 所以每一步都在下面**當場**驗過才用。
async function readSentId(res: unknown): Promise<string | null> {
  try {
    // ══════════════════════════════════════════════════════════════
    // ③ 大小上限 —— 🔴 **自己邊讀邊數, 不採信任何宣告**(opus R2 · MF1 + C1)
    // ══════════════════════════════════════════════════════════════
    // ⛔ ~~`const declared = res.headers.get('content-length'); … if (!Number.isSafeInteger(n)) return null;`~~
    //    那個設計有兩個病:①它的殘餘風險描述指錯了世界 ②它綁在一個【合法地可以不存在】的標頭上。
    // ✅ 現在的形狀:拿 reader 逐塊讀, **累計超過上限就當場放棄**。
    //    📌 缺標頭 / 標頭說謊 / chunked 三個世界走**同一條路** ⇒ 沒有一條路是靠對方誠實才安全的。
    // 🔵 順帶收掉 opus R2 的 N1/N2:`Number('')===0`(存在而空 ⇒ 判成「宣告 0 bytes」⇒ 照樣緩衝)
    //    與 `Number()` 吃 `0x10`/`1e3`/前後空白 —— 那些輸入現在**沒有地方可以進來**。
    const stream = (res as { body?: { getReader?: unknown } | null } | null | undefined)?.body;
    const getReader = stream?.getReader;
    // 🛑 **拿不到 reader 就放棄, 不退回 `text()`** —— 退回去等於把剛拆掉的無上界緩衝裝回來,
    //    而它會**只在某些 runtime 上**裝回來 ⇒ 那種不一致比缺功能難查得多。
    if (typeof getReader !== 'function') return null;
    const reader = (getReader as () => BodyReader).call(stream);

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done === true) break;
        if (!value) continue;
        total += value.byteLength;
        // 🔴 **上界 = 上限 + 最後一塊** —— 踩線的那一塊要先讀進來才數得到, 這一句在檔頭寫明了。
        if (total > SENT_BODY_MAX_BYTES) return null;
        chunks.push(value);
      }
    } finally {
      // 🔵 提早放棄時要把連線收掉;它自己失敗不可以把一封【已經寄出去的信】變成失敗。
      await Promise.resolve(reader.cancel()).catch(() => undefined);
    }

    const buf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // 🔵 `TextDecoder` 而不是 `Buffer` —— 位元組已經自己數過了, 這裡只負責轉字串,
    //    而 `Buffer` 在 Edge runtime 上不存在(舊版靠 try/catch 收, 現在根本不依賴它)。
    const raw = new TextDecoder().decode(buf);

    const body: unknown = JSON.parse(raw);
    if (typeof body !== 'object' || body === null) return null;

    // ══════════════════════════════════════════════════════════════
    // ①+② 取 `id`:自有屬性 · string · 而且【長得像一個 id】
    // ══════════════════════════════════════════════════════════════
    // 🔴 `Object.hasOwn` —— `Object.prototype.id = '…'` 之下, `body.id` 會拿到繼承值
    //    ⇒ 那個值會被當成 provider 的 id 落庫(codex R1-#4)。
    //    📌 **同一族的坑本檔對 `name` 已經用 `Map.get` 擋過一次** —— 而我沒有照著做。
    if (!Object.hasOwn(body as object, 'id')) return null;
    const id: unknown = (body as { id?: unknown }).id;
    if (typeof id !== 'string') return null;
    // 🔴 **格式白名單** —— 沒有它, **任意非空字串**(信箱、整封信、控制字元)都會進 DB(codex R1-#5)。
    //    🔵 值域取得寬:官方回的是 uuid, 而這裡允許 `[A-Za-z0-9-]{1,64}`
    //      —— 📌 **它要擋的是「那不是一個 id」, 不是「那不是我預期的那一種 id」。**
    // ⚠️ **射程說明(opus R2 · N3, 實測)**:`sk-live-…`、`SeanChen` 這種 64 字內的 token
    //    **過得了這道白名單** ⇒ 它擋得掉信箱與整封信, 擋不掉「一個看起來像 id 的敏感字串」。
    //    🔵 今天的值來自 provider ⇒ 無實際威脅;**寫下來是為了下一個人不必再量一次**。
    return PROVIDER_MESSAGE_ID_RE.test(id) ? id : null;
  } catch {
    // ④ 非 JSON / body 已消耗 / reader throw ⇒ null。**信照樣算寄出去了。**
    return null;
  }
}

/**
 * 🔴 §窄幅破例的**入口甲**的實作點(⛔ ~~唯一實作點~~ —— 入口乙是 `readSentId`, 見檔頭)。
 * 只在 `status === 429` 被呼叫;任何失敗 → `http_429`
 * (= E1c 前的既有行為,零回歸)。
 *
 * 🔴 **獨立內層 try/catch,不可併入 `send` 的外層 try**(codex 關卡1 must-fix):否則 `json()`
 * reject(body 已消耗 / 非 JSON / getter throw)會被外層吸走 → 誤回 `network_error` 而非 `http_429`
 * → **誤導 E2a 退避**(transport 短退避 vs 429 保守長退避,語意天差地別)。外層 try 只留給 fetch/transport。
 */
/**
 * ⟦b4-RESEND409⟧ **409 分流** —— 形狀**逐字照 `classify429`**(下面那支), 而那不是複製貼上的偷懶:
 * 那支的每一道防禦都是 codex 兩輪換來的(獨立 try/catch、body 視為 `unknown`、`Map` 非物件索引),
 * 📌 **把同一個形狀寫成第二種樣子, 等於把那兩輪重打一次而且大概會漏一道。**
 *
 * 🛑 **任何失敗一律回 `http_409`** = 改動前的既有行為 ⇒ **零回歸**:
 *    body 非 JSON / 沒有 `name` / `name` 不是那個字面 ⇒ 走原本的指數退避。
 *    ⇒ 📌 **這支只會把【明確是第三種】的那一封改判**, 其餘一封都不動。
 */
async function classify409(res: { json?: () => Promise<unknown> }): Promise<EmailSendErrorCode> {
  try {
    if (typeof res?.json !== 'function') {
      return 'http_409';
    }
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) {
      return 'http_409';
    }
    // 🔴 只取頂層 `name`;`message` 永不觸碰(原文不跨出本區域變數)。
    const name: unknown = (body as { name?: unknown }).name;
    if (typeof name !== 'string') {
      return 'http_409';
    }
    return IDEMPOTENCY_ERROR_CODE_BY_NAME.get(name) ?? 'http_409';
  } catch {
    return 'http_409';
  }
}

async function classify429(res: { json?: () => Promise<unknown> }): Promise<EmailSendErrorCode> {
  try {
    if (typeof res?.json !== 'function') {
      return 'http_429';
    }
    // 🔴 body 視為不可信 `unknown`(codex 關卡1 nit:官方 TS union 只是編譯期保證,wire 不封閉)。
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) {
      return 'http_429';
    }
    // 🔴 只取頂層 `name` 單一欄;`message` 永不觸碰(原文不跨出本區域變數、不落表/不 log/不外傳)。
    const name: unknown = (body as { name?: unknown }).name;
    if (typeof name !== 'string') {
      return 'http_429';
    }
    // 🔴 `Map.get`(非物件索引):不查原型鏈 —— `name='toString'` 等必須落 `http_429`(見上方註解)。
    return QUOTA_ERROR_CODE_BY_NAME.get(name) ?? 'http_429';
  } catch {
    // body 已消耗(真實 Response 二讀 → TypeError)/ 非 JSON / getter throw → 退回既有行為。
    return 'http_429';
  }
}
