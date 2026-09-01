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
 * 1. 僅 `status === 429` 時讀 body(非 429 **完全不碰**、`json` 零呼叫)。
 * 2. 🔴 **精確字面(codex 關卡2 nit;前版「僅讀頂層 name 單一欄」不精確、與下方殘餘風險段自相拉扯)**:
 *    `json()` **會解析整份 body**;解析後**僅存取頂層 `name`**,且**只有 `name` 可影響分類結果**;
 *    其他欄位(尤其 `message`)**不得存取、不得進入任何 sink**。`name` 以 `unknown` 處理
 *    (wire 不可信:官方 TS union 是編譯期保證、**非 runtime 封閉輸入**)。
 * 3. 僅接受 `QUOTA_ERROR_CODE_BY_NAME` 的**三個本地固定字面**,其餘一律 `http_429`
 *    (🔴 該表必須是 `Map` —— 物件字面量的原型鏈會破此條,見該表註解)。
 * 4. 原文**不跨出區域變數**:不落表、不 log、不進任何回傳結果。
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
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json?: () => Promise<unknown> }>;

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
const QUOTA_ERROR_CODE_BY_NAME: ReadonlyMap<string, EmailSendErrorCode> = new Map<
  string,
  EmailSendErrorCode
>([
  ['rate_limit_exceeded', 'rate_limited'],
  ['daily_quota_exceeded', 'quota_daily_exceeded'],
  ['monthly_quota_exceeded', 'quota_monthly_exceeded'],
]);

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
        return { kind: 'sent' };
      }
      const status = typeof res?.status === 'number' ? res.status : null;
      // 🔴 §窄幅破例的唯一入口:只有 429 才碰 body(其餘路徑 `json` 零呼叫)。
      if (status === 429) {
        return { kind: 'failed', errorCode: await classify429(res) };
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
 * 🔴 §窄幅破例的唯一實作點(見檔頭)。只在 `status === 429` 被呼叫;任何失敗 → `http_429`
 * (= E1c 前的既有行為,零回歸)。
 *
 * 🔴 **獨立內層 try/catch,不可併入 `send` 的外層 try**(codex 關卡1 must-fix):否則 `json()`
 * reject(body 已消耗 / 非 JSON / getter throw)會被外層吸走 → 誤回 `network_error` 而非 `http_429`
 * → **誤導 E2a 退避**(transport 短退避 vs 429 保守長退避,語意天差地別)。外層 try 只留給 fetch/transport。
 */
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
