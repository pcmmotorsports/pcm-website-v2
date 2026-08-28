'use server';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import {
  createManualCustomer,
  findCustomerCandidatesByPhone,
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
export async function searchManualCustomersAction(rawPhone: string): Promise<SearchCustomersResult> {
  const authorization = await authorizeAdminMutation();
  if (!authorization) return { ok: false, reason: 'denied' };

  // 🔴 空字串 / 太短**不打 DB**:那支 RPC 是子字串比對,一兩個數字會撈回一大堆不相干的人
  //    (`manual-customer.ts` 的 `findCustomerCandidatesByPhone` 檔頭有同款警告)。
  //    ⚠️ 這裡的門檻**刻意比建帳號那道鬆**(建帳號要 8 碼):搜尋是唯讀、而員工常常只記得後四碼。
  const phone = normalizeManualPhone(rawPhone);
  if (phone.length < 3) return { ok: false, reason: 'too_short' };

  try {
    const res = await findCustomerCandidatesByPhone(
      createSupabaseServiceClient() as unknown as ManualCustomerClient,
      phone,
    );
    // 🔴🔴 **每一次查得動的搜尋都留一筆稽核**(codex R4 must-fix)。
    //    R4 的原話:三碼就查得動、RPC 又跨姓名/Email/電話做子字串比對 ⇒
    //    **一個合法登入的員工可以把 000-9999 跑一遍,把客戶名冊撈出來**,而現在零訊號。
    //    ⚠️ **這一行不是那個問題的解,它是【偵測】那一半** —— 缺的那一半是**限速**,本片沒做。
    //       ⇒ 判別句:少了這行,枚舉發生過與沒發生過**在系統裡印同一個東西**(什麼都沒有)。
    //    🔴 記的是**長度與筆數**,不是他打的號碼、不是撈回來的姓名 —— 那些是客人的 PII。
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_customer.searched',
        requestId: await getRequestId(),
        queryDigits: phone.length,
        hits: res.candidates.length,
        truncated: res.truncated,
      }),
    );
    return {
      ok: true,
      // 🔴 逐欄挑,不整包轉送:`ManualCustomerCandidate` 有 `email`,而畫面不需要它。
      candidates: res.candidates.map((c) => ({
        userId: c.userId,
        name: c.name,
        phone: c.phone,
        isManual: c.isManual,
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
        candidate: { userId: same.userId, name: same.name, phone: same.phone, isManual: true },
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
    },
  };
}
