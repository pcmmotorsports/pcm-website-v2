'use server';

import type { MemberTier } from '@pcm/domain';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { getRequestId } from '../audit/context';
import { getAdminAuditLogRepository } from '../orders/order-repository';
import { authorizeAdminMutation } from '../session/authorize';
import {
  createManualCustomer,
  findCustomerCandidatesByPhone,
  hasSearchableChar,
  isPhoneLikeQuery,
  MANUAL_CUSTOMER_SEARCH_ACTION,
  MIN_PHONE_DIGITS,
  normalizeManualPhone,
  type ManualCustomerClient,
} from './manual-customer';

// manual-customer-actions.ts — 建單面板裡「找客人」與「就地新增客人」兩支 server action。
//
// 🔴🔴 **本檔 2026-08-28 換過形狀,而換掉的理由是 Sean 的一句話**(逐字):
//    「我不要先搜尋客人才開始建立單,這樣整個流程太複雜,一個頁面搞定。」
//    ⇒ 舊形狀是**全 PRG**(建完 `redirect()`),而**導頁 = 已填的運費與地址被清光** ——
//      那正是「選到客人之前不出建單表單」那個兩段式存在的理由。
//    ⇒ 不能只把兩段式拿掉(會做出它當初要修的病,而且更嚴重)⇒ **改成解掉成因:不導頁。**
//
// ── 🔴🔴 而「不導頁」踩到一條血淚,兩句都要讀,只讀一句會走進兩種相反的錯 ──────────────
//   `cancel-actions.ts:30-31` 逐字:
//     「原本是【失敗回 action state、成功才 redirect】—— 那個形狀在 React 19 的
//       form reset 競態下**可能誤送整單取消**(四輪修不穩,`E-011-STOP`)」
//   `cancel-form-body.tsx:17` 逐字(**同一件事被自己更正過的那半**):
//     「⚠️ 不要寫【零 client state】—— 那句在 A13b E1 之後是假的(本檔就有 state)」
//   ⇒ 只讀前者 ⇒ 不敢用 client,做不出他要的東西;只讀後者 ⇒ 以為那條路已被平反,
//     而**競態那半沒有被撤回**。
//
// 🔴🔴 **而本檔避開那個競態的方式是【形狀】,不是小心**:
//    那條教訓講的是 **`<form action={…}>` 回傳值**這個形狀 —— React 在 form action 完成後會
//    **reset 那張表單**,而非受控控制項的值就在那一刻回到 `defaultValue`。
//    ⇒ 本檔這兩支**不掛在任何 `<form action=>` 上**,它們是**事件處理器**呼叫的
//      (`manual-customer-picker.tsx` 的 `type='button'`)⇒ **沒有 form action ⇒ 沒有 form reset。**
//    ⇒ 建單那張表單仍然是全 PRG(`createManualOrderAction` 每一條路徑都 `redirect()`),一個字沒改。
//    📌 **兩個形狀共存於同一張表單:值的送出走 PRG,而查詢與建檔走事件處理器。**

/** 送到畫面上的候選 —— 🔴 **刻意不含 `email`**:畫面不顯示它,而它是 PII,沒有理由過網路。 */
export type PickerCandidate = {
  userId: string;
  name: string;
  phone: string | null;
  /** 這個帳號是不是後台自己開的(給員工看的資訊,不是授權)。 */
  isManual: boolean;
  /** 🆕 T2:客人現在的會員等級 —— 建單那格「會員等級」預設選它(掛在 radio 的 `data-customer-tier`)。 */
  tier: MemberTier;
};

export type SearchCustomersResult =
  | {
      ok: true;
      candidates: PickerCandidate[];
      /** 命中太多被截斷 ⇒ 畫面必須說出來(靜默截斷會讓員工以為就這幾個)。 */
      truncated: boolean;
      /** 同電話帳號偏多 ⇒ 出警告(Sean 2026-08-24 `Q2=甲`:**警告不是擋**)。 */
      shouldWarnDuplicates: boolean;
    }
  | { ok: false; reason: 'denied' | 'too_short' | 'error' };

/**
 * 依電話找客人 —— **唯讀**,而且**不導頁**。
 *
 * 🔴 **它是一個新的入口**(以前這件事在 server component 裡做,只有那一頁載得到)
 *    ⇒ **授權閘絕對第一**。`authorizeAdminMutation` 同時擋 session、Origin 與具名 actor
 *    (`session/authorize.ts:24-56`)—— 對「可以被 client 直接呼叫的東西」那三道缺一不可。
 */
/**
 * 稽核寫入的逾時上界(毫秒)。
 *
 * 🔴 **codex R1 must-fix(2026-09-01)**:我第一版只 `catch`, 而 `catch` 只接得住
 *    **快速拒絕** —— **INSERT 卡住的時候, 搜尋會跟著卡到平台逾時**。
 *    ⇒ 那讓我原本那句「片 1 不擋任何人、零誤擋風險」變成假的。
 * 🔵 值取 2 秒:這是一個**唯讀動作的附帶紀錄**, 它沒有理由讓員工多等超過那個。
 *    (形狀抄 `lib/staff.ts` 的 `lookupWithTimeout` —— 那支跑在登入關鍵路徑上, 同一個理由。)
 * ⚠️ 而**逾時 ≠ 取消**:這裡只是「不等了」, 那筆 INSERT 可能仍然會成功。
 *    ⇒ 所以逾時之後印的降級 log **可能與一筆真的存在的稽核並存** —— 那是刻意的,
 *      寧可多一行 log, 不要為了乾淨而讓員工等。
 */
const SEARCH_AUDIT_TIMEOUT_MS = 2_000;

/** 搜尋事件記下的東西 —— **只有形狀, 沒有內容**(見下方那一段)。 */
interface SearchAuditFacts {
  /**
   * 🔴 **[2026-09-16 新增,而它是【偵測不要瞎掉】的那一半]**
   * 這一格開放用姓名找人之後(Sean 拍板),`queryDigits` 對姓名查詢**恆為 0**
   * ⇒ 📌 「員工用姓名片段掃名冊」與「打了一個沒有數字的空查詢」**在稽核裡長得一模一樣**。
   * 而我們手上**只有偵測、沒有限速**(codex R4 提過的枚舉面,Sean 知情)
   * ⇒ 少了這一欄,新開的那條路等於沒有訊號。
   * 🔵 它是**分類**不是內容:`'phone'` / `'other'`,不帶任何一個字。
   */
  readonly queryKind: 'phone' | 'other';
  readonly queryDigits: number;
  /** 🔵 查詢的**字數**(碼位計,CJK 安全)—— 一樣只有長度、沒有內容。 */
  readonly queryLength: number;
  readonly hits: number;
  readonly truncated: boolean;
}

/**
 * 把一次搜尋寫進 `admin_audit_log`。
 *
 * 🔴 **PII 紀律(原本那行 `console.warn` 就有, 這裡照舊)**:記的是**長度與筆數**,
 *    不是他打的號碼、不是撈回來的姓名。⇒ 這張表的 `before`/`after` 建表註解逐字說它
 *    「**可合法含經銷價 / 成本 / PII**」—— 而**本事件刻意不放任何一樣**。
 * ⚠️ **而不要寫成「零 PII」**(codex R1 nit, 2026-09-01 收窄):
 *    `queryDigits` 與 `hits` 沒有直接識別資料, **而它們是綁著 actor 與時間的搜尋中繼資料**
 *    ⇒ 反覆觀察可以推斷命中分布。
 *    ⇒ 📌 正確的字面是「**不含查詢值、也不含客戶的直接識別資訊**」, 不是「零 PII」。
 *
 * 🛑🛑 **寫失敗【不擋搜尋】, 而這個取捨要寫出來不要藏**:
 *    · 若讓它 throw ⇒ 稽核表打嗝時**員工查不到客人** —— 而這是一個**唯讀**動作,
 *      為了留紀錄而讓正常工作停擺, 代價不對等。
 *    · 而吞掉它的代價是:**稽核是 best-effort, 它可能漏記。**
 *    ⇒ 折衷:吞掉, **但把舊那行 `console.warn` 留成【降級訊號】** ——
 *      寫不進表的時候至少 runtime log 還有一行, **訊號降級而不是消失**。
 *    ⛔ ~~而那條路不是他控制得了的:搜尋本身就先打了同一個 DB, DB 掛了他也查不到東西。~~
 *    🔴 **codex R1 must-fix(2026-09-01)推翻了上面那句, 而它是對的**:
 *      讀與寫是**不同 client、不同請求、不同時間點** ——
 *      **高併發枚舉可以讓前段讀取完成, 而後段寫入因連線池 / 資源壓力失敗**
 *      ⇒ 那一次搜尋就只剩下沒有人在看的 runtime log。
 *      📌 ⇒ **所以正確的說法是:稽核是 best-effort, 而【蓄意的高頻使用者剛好是最可能讓它失敗的那一種】。**
 *      🛑 而這一格**片 1 不解** —— 真的要解得靠片 2 的限速(先把高頻擋掉), 或把稽核改成同交易寫入。
 *
 * 🔴 **而這一支【不是】枚舉那個問題的解** —— 它是【偵測】那一半, 而且只是把偵測
 *    從「一行沒人看的 log」變成「一列查得到的紀錄」。**限速那一半仍然是 0**
 *    (板 `⟦b4-ENUM3⟧` 片 2)。⇒ 不要因為這一片落地就把那一列關掉。
 */
async function recordSearchAudit(
  actorId: string,
  facts: SearchAuditFacts,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getAdminAuditLogRepository().record(
        { action: MANUAL_CUSTOMER_SEARCH_ACTION, after: facts },
        {
          actor: actorId,
          requestId: await getRequestId(),
          sourceApp: 'admin',
        },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`稽核寫入逾時(${SEARCH_AUDIT_TIMEOUT_MS}ms)`)),
          SEARCH_AUDIT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    // 降級訊號:表寫不進去 ⇒ 至少留下原本那一行, 讓 runtime log 仍然看得到這次搜尋。
    console.warn(
      JSON.stringify({
        evt: MANUAL_CUSTOMER_SEARCH_ACTION,
        degraded: 'audit_write_failed',
        ...facts,
      }),
    );
    console.error('[admin/manual-customer] 搜尋稽核寫入失敗(不擋搜尋)', error);
  } finally {
    // 清掉計時器 —— 否則 serverless 下這條 timer 會把函式生命週期拖長,
    // 即使寫入早就回來了(形狀抄 `lib/staff.ts:121-125`, 那裡有同一句理由)。
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 🟡 **已知限制(2026-09-16 對抗審查量到;主視窗裁:記著、現在不做)**
 *
 * 1. **3 碼門檻可以被一個非數字字元繞過**:打 `1a` ⇒ 判「不是電話」⇒ 跳過門檻 ⇒ 打 RPC,
 *    而 RPC 內部把非數字剝掉抽出 `1` ⇒ 電話軸 `LIKE '%1%'` ⇒ 回最新 20 位電話含 1 的客人。
 *    改前 `1a` 會被擋。⇒ 那句「一兩個數字會撈回一大堆不相干的人」的保護,加一個字母就沒了。
 *    🔵 **不做的理由**:邊際傷害**不大於** Sean 已經接受的「打『王』」(兩條都 ≤20 列);
 *    要真的關掉得動 RPC 的下限 ⇒ 新 migration。
 * 2. **全鏈零節流**:action 無限速 · picker 無 debounce · RPC 無門檻。
 *    比對是**前後萬用字元的子字串**、三軸 UNION、一發 ≤20 筆(`CANDIDATE_LIMIT`)。
 *    ⇒ 名冊 N 人的下限是 `ceil(N/20)` 發。🔬 **而正式庫 2026-09-16 只有 11 位客人
 *    ⇒ 一發「王」或「@」就整包**,連截斷提示都不會亮 ⇒ 現在做限速成本低、**效益也低**。
 * 3. **放大器**:每一發還會跑最多 20 次逐筆 GoTrue `getUserById`(既有行為,非本片造成)。
 * 4. **全形 / 阿拉伯數字電話永遠查無而畫面不說為什麼**(JS `\d` 只認 ASCII;既有行為)。
 *
 * 🔴 **觸發條件(有條件的待辦才不會爛在檔案裡)**:
 *    **客戶數超過約 500,或開始有外部帳號登入時,回頭做節流與下限。**
 *    到那時 1–3 的成本效益就反過來了 —— 今天擋的東西他已經接受,那天擋的是真的名冊。
 */
export async function searchManualCustomersAction(rawPhone: string): Promise<SearchCustomersResult> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) return { ok: false, reason: 'denied' };

  // 🔴 沒有可查的字 / 電話太短**不打 DB、也不寫稽核**:那支 RPC 是子字串比對,一兩個數字會撈回一大堆不相干的人
  //    (`manual-customer.ts` 的 `findCustomerCandidatesByPhone` 檔頭有同款警告)。
  //    ⚠️ 這裡的門檻**刻意比建帳號那道鬆**(建帳號要 8 碼):搜尋是唯讀、而員工常常只記得後四碼。
  //
  // 🔴🔴 **[2026-09-16 Sean 拍板:這一格要能用姓名找 —— 而那個能力其實早就做好了]**
  //    ⛔ ~~`const phone = normalizeManualPhone(rawPhone); if (phone.length < 3) …`(無條件輾成數字)~~
  //    🔬 病:`normalizeManualPhone` 逐字是 `raw.replace(/\D/g, '')` ⇒ 打「王小明」變成**空字串**
  //       ⇒ 當場 `too_short`、**DB 根本沒被呼叫**;而往下送的也是那個只剩數字的字串。
  //    📌 **而下層早就寫好兩條路**(`manual-customer.ts` 搜 `isPhoneLikeQuery`,2026-09-05 ⟦b4-FINDCUSTOMERPHONE⟧):
  //       為真 ⇒ 送正規化數字;為假 ⇒ **送原字串**讓 `admin_search_customers` 的 name / email 兩軸接手
  //       (那支 RPC 三軸本來就吃,姓名那軸還有索引)。
  //       ⇒ 🛑 **那次放寬沒有接到這一層,所以第二條路在唯一的畫面路徑上是死的。**
  //    ✅ 改法:**原字串往下送**,3 碼門檻**只在「這是一支電話」時才看**。
  //    ⚠️ **代價 Sean 知情**:員工能用姓名片段一直試出客戶名冊,而**目前只有稽核、沒有限速**
  //       (codex R4 提過的枚舉面)。要限速是另一片。
  //    🔵 非電話查詢的下限由下層那道 `/[\p{L}\p{N}]/u` 顧(純符號如 `-` 不打 DB);
  //       這裡**不再加第二道長度門檻** —— 兩層各一把尺正是上面那個病的成因。
  const query = rawPhone.trim();
  // 🔴🔴 **[對抗審查 M1,2026-09-16]**:3 碼門檻改成「只在是電話時才看」之後,
  //    `''` / `'-'` / `'👍'` 會**跳過門檻**往下走。下層擋得住 RPC(不會多打 DB),
  //    **而這裡照樣會寫一列稽核** ⇒ ① 那張表的摘要是 COUNT(*)、告警門檻「2 天 4 次」
  //    ⇒ 空按幾十下就能把**唯一的偵測**推到門檻,而客戶表一次都沒被讀;
  //    ② 畫面上 `too_short` 是唯一保留清單的分支 ⇒ 空按一下,他選好的客人與整張清單無聲消失。
  // 🔵 **用的是下層那支同一個述詞**(`hasSearchableChar`),不在這裡重寫一份 regex ——
  //    「兩層各一把尺」正是這一片在修的病,不用製造它的方式去修它。
  if (!hasSearchableChar(query)) return { ok: false, reason: 'too_short' };
  if (isPhoneLikeQuery(query) && normalizeManualPhone(query).length < 3) {
    return { ok: false, reason: 'too_short' };
  }

  try {
    const res = await findCustomerCandidatesByPhone(
      createSupabaseServiceClient() as unknown as ManualCustomerClient,
      query,
    );
    // 🔴🔴 **每一次查得動的搜尋都留一筆稽核**(codex R4 must-fix)。
    //    R4 的原話:三碼就查得動、RPC 又跨姓名/Email/電話做子字串比對 ⇒
    //    **一個合法登入的員工可以把 000-9999 跑一遍,把客戶名冊撈出來**,而現在零訊號。
    //    ⚠️ **這一行不是那個問題的解,它是【偵測】那一半** —— 缺的那一半是**限速**,本片沒做。
    //       ⇒ 判別句:少了這行,枚舉發生過與沒發生過**在系統裡印同一個東西**(什麼都沒有)。
    //    🔴 記的是**長度與筆數**,不是他打的號碼、不是撈回來的姓名 —— 那些是客人的 PII。
    //
    // ⛔ ~~原本這裡是一行 `console.warn`~~ 🔴 **2026-09-01 換掉,而換的理由是量到的**:
    //    板上 `⟦b4-ENUM3⟧` 逐字寫「每一次查得動的搜尋【留一筆】」—— 讀起來像寫進稽核表。
    //    **而它不是。**當場量(剝註解、帶正負對照):本檔 `admin_audit_log` / `writeAudit` /
    //    `auditRepository` / `buildAuditContext` **皆 0**;告警器 `check-anomaly-alerts.ts`
    //    (1,103 行)對 `searched` / `admin_audit_log` / `manual_customer` **皆 0**
    //    (🟢 正對照 `anomaly` ⇒ 11 ⇒ 尺是活的);`api/cron/` 底下 **0 / 10** 支讀那張表。
    //    ⇒ 📌 **它是一行沒有人在看、而且不在任何可查詢的表裡的 log。**
    //       那與「沒有偵測」對【事後查得到嗎】這個問題印同一個答案。
    await recordSearchAudit(authorization.actorId, {
      // 🔴 `phone` 這個區域變數 2026-09-16 隨「原字串往下送」一起退場 ——
      //    這裡改成當場算,而且多記 kind / 長度(理由在 `SearchAuditFacts` 那兩欄的註解)。
      queryKind: isPhoneLikeQuery(query) ? 'phone' : 'other',
      queryDigits: normalizeManualPhone(query).length,
      queryLength: [...query].length,
      hits: res.candidates.length,
      truncated: res.truncated,
    });
    return {
      ok: true,
      // 🔴 逐欄挑,不整包轉送:`ManualCustomerCandidate` 有 `email`,而畫面不需要它。
      candidates: res.candidates.map((c) => ({
        userId: c.userId,
        name: c.name,
        phone: c.phone,
        isManual: c.isManual,
        tier: c.tier,
      })),
      truncated: res.truncated,
      shouldWarnDuplicates: res.shouldWarnDuplicates,
    };
  } catch (error) {
    // 🔴 「查壞了」與「查無」**不得回同一個東西**:後者要員工去建客人(做得到),
    //    前者要他找人 —— 他建再多客人都沒用。
    console.error(
      JSON.stringify({ evt: 'admin.manual_customer.search_failed', requestId: await getRequestId() }),
      error,
    );
    return { ok: false, reason: 'error' };
  }
}

/**
 * 這一發到底發生了什麼 —— 🔴 **三種,不是兩種**(codex R7 must-fix)。
 *
 * · `created`   全新建立 ⇒ 畫面自動選起來(是我們剛做出來的東西,沒有身分疑慮)
 * · `idempotent` 同一顆冪等鍵重送 ⇒ 自動選起來(**同一次操作**的重試,身分是同一個)
 * · `existing`  🔴 **建立前的預檢撞到一位很像的人** ⇒ **不得自動選起來**
 *
 * 🔴🔴 **為什麼 `existing` 一定要跟前兩種分開**:
 *   「同姓名 + 同電話 + 後台開的帳號」**只是一組長得很像的資料,不是同一個人的證明**
 *   (一家人共用市話 + 剛好同名)。而上一版把它自動選起來、只加一句警告 ——
 *   ⇒ **警告出現的時候, 客人已經被選好了、送出鈕也已經亮了** ⇒ 員工按下去就掛錯帳。
 *   📌 **一句警告如果沒有把下一步收回來, 它只是在旁邊講話。**
 *   ⇒ 改成:把它當**候選**丟回畫面、**一顆都不選**,要員工自己點。
 */
export type CreateCustomerOutcome = 'created' | 'idempotent' | 'existing';

export type CreateCustomerResult =
  | { ok: true; candidate: PickerCandidate; idempotent: boolean; outcome: CreateCustomerOutcome }
  | {
      ok: false;
      reason: 'denied' | 'invalid_name' | 'invalid_phone' | 'invalid_request_id' | 'error';
      message: string;
    };

/**
 * 就地建一位新客人 —— **不導頁**,把建好的那位直接回給畫面選起來。
 *
 * 🔴 `requestId` = 這一次面板開啟的冪等鍵,由 server 每次 render 給一顆(見 `manual-order-view.tsx`)。
 *    · 同一份畫面連按兩次 ⇒ **同一顆** ⇒ 撞佔位信箱的唯一鍵 ⇒ 回同一位、不會建出第二個
 *    · 重新載入 ⇒ 換一顆 ⇒ 真的要開第二個帳號時做得到(Sean 08-24「一支電話不設硬上限」)
 * 🔴 **而它不再進網址** —— 舊形狀是靠 `?mrid=` 跨導頁帶回來的,而導頁沒了、那顆鍵就不必跨任何東西。
 *    (那正是 R3 指出的根:「為什麼建帳號的冪等鍵要跟建單的冪等鍵是同一顆」。)
 */
export async function createManualCustomerInlineAction(input: {
  name: string;
  phone: string;
  requestId: string;
}): Promise<CreateCustomerResult> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) {
    return { ok: false, reason: 'denied', message: '你的登入已經過期。請重新登入之後再試一次。' };
  }
  const requestId = await getRequestId();

  // ── 🔴🔴 建之前先看一眼「這個人是不是已經在裡面了」(codex R5 must-fix,推翻我自己的降級)──
  //
  //   我上一輪把 R4 的「重整之後同一人被建兩次」判為【擋在搜尋那道閘】,理由是:
  //   「要走到建立那顆鈕,必須先搜一次而且查無」。
  //   🔴 **而 codex 直接構造出反例,那個反例我看得懂而且它是對的**:
  //     員工搜 `0912345677`(**打錯一碼**)⇒ 查無 ⇒ 建立區塊出現
  //     ⇒ 而**建立區塊裡的電話欄是【可以改的】** ⇒ 他把它改回正確的 `0912345678` ⇒ 建立
  //     ⇒ 那位客人其實早就存在,而搜尋那道閘**看的是他打錯的那一支**。
  //   📌 **形狀:我以為那道閘看的與這一步用的是同一個值 —— 而它們是兩個欄位。**
  //      「先搜再建」讀起來像一條管線,實際上是兩個獨立輸入。
  //
  //   ⇒ 所以要用**真正要建的那支電話**再問一次。冪等鍵擋的是同一份畫面連按兩次;
  //     這一道擋的是「換了畫面、而人是同一個」。**兩道各擋一半。**
  //   ⚠️ 判別條件三個都要中:電話正規化後相同 + 姓名修剪後相同 + **是後台開的帳號**。
  //     少了第三個 ⇒ 客人自己在前台註冊的帳號會被當成「我們建的」而重用。
  //     而 Sean 2026-08-24「一支電話不設硬上限」不受影響:**同電話不同姓名照樣建得出來。**
  const wantPhone = normalizeManualPhone(input.phone);
  const wantName = input.name.trim();
  // 🔴 **太短就不要打 DB**(codex R6 must-fix)。舊條件只擋空字串 ⇒ 電話打一個 `1`
  //    也會跑一發**寬廣的子字串查詢 + 最多 20 發 auth 查詢**,最後才被建立層判 invalid。
  //    ⇒ 門檻直接對齊建立層的 `MIN_PHONE_DIGITS`:**它不合格的話,這一趟本來就沒有意義。**
  if (wantPhone.length >= MIN_PHONE_DIGITS && wantName !== '') {
    let prior: Awaited<ReturnType<typeof findCustomerCandidatesByPhone>>;
    try {
      prior = await findCustomerCandidatesByPhone(
        createSupabaseServiceClient() as unknown as ManualCustomerClient,
        wantPhone,
      );
    } catch (error) {
      // 🔴 **查不動就不要建** —— 查不動時建出去的那一個,正是這道閘要擋的那一個。
      //    ⚠️ 代價明寫:搜尋掛掉的時候**建客人也跟著不能用**。那是刻意的取捨,不是漏。
      console.error(
        JSON.stringify({ evt: 'admin.manual_customer.precheck_failed', requestId }),
        error,
      );
      return {
        ok: false,
        reason: 'error',
        message: '現在查不到客人資料,所以【還不能】幫你建 —— 硬建可能會多出一個重複的客人。請等一下再按一次。',
      };
    }
    const same = prior.candidates.find(
      (c) => c.isManual && c.name.trim() === wantName && normalizeManualPhone(c.phone ?? '') === wantPhone,
    );
    if (same) {
      console.warn(JSON.stringify({ evt: 'admin.manual_customer.precheck_hit', requestId }));
      return {
        ok: true,
        idempotent: true,
        // 🔴 **`existing` ≠ `idempotent`** —— 前者是「有一位很像的人」,後者是「同一次操作重送」。
        //    畫面對這兩者的處置**相反**(不選 vs 自動選)⇒ 它們不得共用一個值。
        outcome: 'existing',
        candidate: { userId: same.userId, name: same.name, phone: same.phone, isManual: true, tier: same.tier },
      };
    }
    // 🔴🔴 **查無 + 被截斷 ⇒ 不建**(codex R6 must-fix)。
    //    那支 RPC 最多回 20 筆,而它是**子字串**比對 ⇒ 構造 20 位較新的、電話包含這一串的人,
    //    就能把**那位精確吻合的舊帳號擠出清單** ⇒ 預檢查無 ⇒ 照建 ⇒ 重複帳號。
    //    📌 **「我沒看到他」在【他不存在】與【他被擠掉了】兩個世界印同一句話,而 `truncated` 是唯一分得開的那一格。**
    //    ⇒ 這裡 fail-closed:寧可叫員工把電話打完整,也不要靜默開出第二個帳號。
    if (prior.truncated) {
      console.warn(JSON.stringify({ evt: 'admin.manual_customer.precheck_truncated', requestId }));
      return {
        ok: false,
        reason: 'error',
        message:
          '這支電話符合的人太多,我沒辦法確定這位客人是不是已經在系統裡了,所以【還不能】幫你建。' +
          '請把電話打完整一點再試一次;電話已經是完整的還出現這句,就找人看一下(不要一直按)。',
      };
    }
  }

  let created: Awaited<ReturnType<typeof createManualCustomer>> | null = null;
  let threw = false;
  try {
    created = await createManualCustomer(
      createSupabaseServiceClient() as unknown as ManualCustomerClient,
      { name: input.name, phone: input.phone, requestId: input.requestId },
    );
  } catch (error) {
    // 🔴 這條路**可能已經留下一個真的帳號**:`createManualCustomer` 自陳建帳號與回頭確認
    //    **不在同一個交易**裡。⇒ 文案叫他**先找一次**,不得叫他直接再建一個。
    console.error(
      JSON.stringify({ evt: 'admin.manual_customer.failed', requestId }),
      error,
    );
    threw = true;
  }
  if (threw || created === null) {
    return {
      ok: false,
      reason: 'error',
      message:
        '這位客人沒有建成功,而且系統裡可能已經留下一筆壞掉的資料。請【先不要再按一次】——' +
        '再按會多出一個重複的客人。請用同一支電話再找一次;找不到就找人看一下。',
    };
  }
  if (!created.ok) {
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_customer.invalid',
        requestId,
        // 🔴 只記**理由代碼**,不記他打的值:那些值是客人姓名與電話。
        reason: created.reason,
      }),
    );
    return { ok: false, reason: created.reason, message: created.message };
  }
  if (created.idempotent === true) {
    // 🔴 重送這條路要留下訊號 —— 它與「全新建立」回的是同一種東西,零 log 的話災難當天查不到。
    //    ⚠️ 不記姓名與電話(PII);`requestId` 是我們自己產的 uuid。
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_customer.idempotent_hit',
        requestId,
        manualRequestId: input.requestId,
      }),
    );
  }
  return {
    ok: true,
    idempotent: created.idempotent === true,
    outcome: created.idempotent === true ? 'idempotent' : 'created',
    candidate: {
      userId: created.userId,
      // 🔴 回**正規化後**的電話與**修剪過**的姓名 —— 畫面上顯示的要與存進去的是同一份,
      //    否則員工看到自己打的原文、而系統存的是另一個樣子。
      name: input.name.trim(),
      phone: normalizeManualPhone(input.phone),
      isManual: true,
      // 現場新建的客人 = 一般會員(plan §1-b);`createManualCustomer` 沒給 tier ⇒ DB DEFAULT 就是 general。
      tier: 'general',
    },
  };
}
