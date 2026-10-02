// email-copy-catalog.ts —— 客人收到的交易信裡,【固定句子】的唯一清單(2026-10-02 信件文字第 1 片)。
// 📦 第 2 片起住在 @pcm/domain:寄信程式(packages/use-cases)與後台存檔動作(apps/admin)共用同一套檢查。
//
// PRD ~/pcm-mailbox/PRD-員工自己改交易信文案-20261002.md(Sean 10-02 答甲:做小版、所有員工可改、存檔即生效但先看預覽、主旨不開放)。
// 第 1 片只做一件事:把散在程式裡的句子收進這張清單,寄出的信一字不改(`__golden__/customer-emails.json` 逐字鎖)。
// 第 2 片才會讓後台改的字蓋過這裡的預設值;這裡永遠是「讀不到員工改的字時」的那一版。
//
// 規則:
// · `text` 是預設文字,就是今天寄出去的字,一個字都不要在這裡「順手潤飾」—— 改字是員工在後台做的事。
// · 要放訂單資料的地方寫 `{代號}`;`placeholders` 列出這句【必須】有的代號,後台存檔時少一個就擋(第 3 片)。
// · 金額、品項、單號這些會變的內容不寫在這裡;「什麼情況印哪一句」的判斷也不在這裡,留在組信的程式。
// · 資料旁邊的短標籤(「箱號:」「追蹤碼:」「訂單金額」「收件人:」)與匯款帳號資訊也不收:它們是系統排的資料列, 不是句子。
// · 不收:主旨(Sean 10-02 Q6 甲不開放)、取消原因白名單(它要和資料庫的值逐字相同, 是規則不是文案)、
//   LINE 網址與 ID(推 LINE 時用它們比對要拿掉哪一行, 是規則不是文案)。

/** 這句出現在哪一種信;`shared` = 好幾種信共用。後台列表用它分組。 */
export type EmailCopyGroup =
  | 'shared'
  | 'paid'
  | 'cancelled'
  | 'unpaid_cancelled'
  | 'partially_refunded'
  | 'partially_cancelled'
  | 'return_received'
  | 'bank_order_created'
  | 'bank_amount_changed'
  | 'shipped'
  | 'tracking_corrected';

export type EmailCopyEntry = {
  readonly group: EmailCopyGroup;
  /** 給員工看的位置說明,例如「取消信開頭(有訂單編號時)」。 */
  readonly label: string;
  /** 預設文字 = 今天寄出去的字。 */
  readonly text: string;
  /** 這句必須有的代號(不含大括號)。 */
  readonly placeholders: readonly string[];
};

export const EMAIL_COPY = {
  paidNextStep: {
    group: 'paid',
    label: '付款成功信:下一步說明',
    text: '我們會盡快為您安排出貨，出貨後會再寄一封通知給您。',
    placeholders: [],
  },
  paidHtmlLead: {
    group: 'paid',
    label: '付款成功信(網頁版):明細上方那句',
    text: '這封信是這筆交易的明細。',
    placeholders: [],
  },
  contactLead: {
    group: 'shared',
    label: '結尾聯絡方式的開頭',
    text: '有任何問題，加入官方 LINE',
    placeholders: [],
  },
  lineTitleMissing: {
    group: 'shared',
    label: '品項沒有品名時顯示',
    text: '(品名未記錄)',
    placeholders: [],
  },
  memberCenter: {
    group: 'shared',
    label: '會員中心提示',
    text: '若您有 PCM 會員帳號，訂單明細與最新狀態可至會員中心查看。',
    placeholders: [],
  },
  companyLine: {
    group: 'shared',
    label: '結尾公司名稱與統編',
    text: '派達有限公司　統一編號 90003020',
    placeholders: [],
  },
  companyAddress: {
    group: 'shared',
    label: '結尾公司地址',
    text: '新北市新莊區化成路736巷18號1樓',
    placeholders: [],
  },
  cancelledHeadlineWithId: {
    group: 'cancelled',
    label: '取消信開頭(有訂單編號時;未付款取消信也用)',
    text: '您的訂單 {訂單編號} 已取消。',
    placeholders: ['訂單編號'],
  },
  cancelledHeadlineNoId: {
    group: 'cancelled',
    label: '取消信開頭(讀不到訂單編號時)',
    text: '您的訂單已取消。',
    placeholders: [],
  },
  cancelledFullRefund: {
    group: 'cancelled',
    label: '已付款取消信:全額退款',
    text: '您支付的款項已全額退回原付款方式。',
    placeholders: [],
  },
  cancelledPartialRefund: {
    group: 'cancelled',
    label: '已付款取消信:部分退款',
    text: '您支付的款項已退回 NT$ {退款金額} 至原付款方式。其餘款項如有疑問,請加入官方 LINE 與我們聯繫。',
    placeholders: ['退款金額'],
  },
  unpaidCancelledNoCharge: {
    group: 'unpaid_cancelled',
    label: '未付款取消信:沒有扣款',
    text: '這張訂單尚未付款，不會有任何款項產生。',
    placeholders: [],
  },
  refundNowFullyRefunded: {
    group: 'partially_refunded',
    label: '部分退款信:這筆退完已全數退回',
    text: '這筆退款後,這張訂單的款項已全數退回原付款方式。',
    placeholders: [],
  },
  cancelledExtraRefundHeadline: {
    group: 'partially_refunded',
    label: '部分退款信開頭(已取消的訂單又退一筆)',
    text: '您已取消的訂單 {訂單編號} 又退回一筆款項。',
    placeholders: ['訂單編號'],
  },
  partiallyCancelledHeadline: {
    group: 'partially_cancelled',
    label: '部分取消信開頭',
    text: '您的訂單 {訂單編號} 中有 {取消件數} 件商品已取消，其餘商品將照常為您處理。',
    placeholders: ['訂單編號', '取消件數'],
  },
  partiallyCancelledItemsTitle: {
    group: 'partially_cancelled',
    label: '部分取消信:取消商品標題',
    text: '【本次取消商品】',
    placeholders: [],
  },
  partiallyCancelledAmountsTitle: {
    group: 'partially_cancelled',
    label: '部分取消信:金額標題',
    text: '【調整後訂單金額】',
    placeholders: [],
  },
  partiallyCancelledSubtotalLabel: {
    group: 'partially_cancelled',
    label: '部分取消信:商品小計欄名',
    text: '商品小計',
    placeholders: [],
  },
  partiallyCancelledShippingLabel: {
    group: 'partially_cancelled',
    label: '部分取消信:運費欄名',
    text: '物流運費',
    placeholders: [],
  },
  partiallyCancelledTotalLabel: {
    group: 'partially_cancelled',
    label: '部分取消信:應付總額欄名',
    text: '應付總額',
    placeholders: [],
  },
  partiallyCancelledOverpaid: {
    group: 'partially_cancelled',
    label: '部分取消信:客人多付了',
    text: '您先前支付之款項大於調整後總額，差額 NT$ {差額} 我們將於 3 個工作天內依原付款管道辦理退款（刷卡將刷退至原信用卡，匯款將退回您的指定帳戶）。退款完成後會再寄發通知信給您。',
    placeholders: ['差額'],
  },
  partiallyCancelledExact: {
    group: 'partially_cancelled',
    label: '部分取消信:付的剛好',
    text: '您先前支付之款項與調整後總額一致，您無需補繳款項，我們亦無需辦理退款。',
    placeholders: [],
  },
  partiallyCancelledUnpaid: {
    group: 'partially_cancelled',
    label: '部分取消信:還沒付款',
    text: '本筆訂單目前尚未付款，請依調整後的應付總額 NT$ {應付總額} 完成付款即可。',
    placeholders: ['應付總額'],
  },
  partiallyCancelledShort: {
    group: 'partially_cancelled',
    label: '部分取消信:還差一些',
    text: '本筆訂單目前尚有 NT$ {尚欠金額} 未付款，請依調整後的應付總額 NT$ {應付總額} 補足差額即可。',
    placeholders: ['尚欠金額', '應付總額'],
  },
  partiallyCancelledMember: {
    group: 'partially_cancelled',
    label: '部分取消信:會員中心提示',
    text: '若您為 PCM 註冊會員，可隨時至會員中心查閱最新訂單明細與備貨進度：',
    placeholders: [],
  },
  partiallyCancelledLine: {
    group: 'partially_cancelled',
    label: '部分取消信:LINE 提示',
    text: '如有任何疑問，歡迎加入官方 LINE 由專人為您服務：@pcmmoto',
    placeholders: [],
  },
  partiallyCancelledCompanyName: {
    group: 'partially_cancelled',
    label: '部分取消信:結尾店名',
    text: 'PCM 重機零件販售',
    placeholders: [],
  },
  partiallyCancelledCompanyTaxId: {
    group: 'partially_cancelled',
    label: '部分取消信:結尾公司與統編',
    text: '派達有限公司（統一編號：90003020）',
    placeholders: [],
  },
  partiallyCancelledCompanyAddress: {
    group: 'partially_cancelled',
    label: '部分取消信:結尾地址',
    text: '新北市新莊區化成路 736 巷 18 號 1 樓',
    placeholders: [],
  },
  returnReceivedHeadline: {
    group: 'return_received',
    label: '退貨收回信開頭',
    text: '我們已收到您寄回的商品：',
    placeholders: [],
  },
  returnReceivedItem: {
    group: 'return_received',
    label: '退貨收回信:每一項商品',
    text: '・{品名} {數量} 件',
    placeholders: ['品名', '數量'],
  },
  returnReceivedRefund: {
    group: 'return_received',
    label: '退貨收回信:退款說明',
    text: '退款會在確認後盡快處理，完成時會再通知您。',
    placeholders: [],
  },
  greeting: {
    group: 'shared',
    label: '開頭問候(全形逗號;付款、取消、退款、退貨、部分取消、單號更正信)',
    text: '您好，',
    placeholders: [],
  },
  greetingHalfwidth: {
    group: 'shared',
    label: '開頭問候(半形逗號;匯款單兩封與出貨信, 三封都是 Sean 核過全文的版本, 改成全形前先問他)',
    text: '您好,',
    placeholders: [],
  },
  bankCreatedHeadline: {
    group: 'bank_order_created',
    label: '匯款單成立信開頭',
    text: '您的訂單 {訂單編號} 已成立,目前尚未付款。',
    placeholders: ['訂單編號'],
  },
  bankCreatedInstruction: {
    group: 'bank_order_created',
    label: '匯款單成立信:請轉帳',
    text: '請依下列資訊完成轉帳,我們收到款項後會再通知您。',
    placeholders: [],
  },
  bankRemittanceTitle: {
    group: 'shared',
    label: '匯款資訊標題(匯款單兩封)',
    text: '匯款資訊',
    placeholders: [],
  },
  bankCreatedLinkLead: {
    group: 'bank_order_created',
    label: '匯款單成立信:訂單連結前那句',
    text: '訂單內容與匯款資訊也可以在這裡查看:',
    placeholders: [],
  },
  bankAmountChangedHeadline: {
    group: 'bank_amount_changed',
    label: '匯款金額變更信開頭',
    text: '您的訂單 {訂單編號} 已完成部分商品取消,應付金額已同步更新。',
    placeholders: ['訂單編號'],
  },
  bankAmountChangedInstruction: {
    group: 'bank_amount_changed',
    label: '匯款金額變更信:請轉帳',
    text: '請依下列最新金額完成轉帳,我們確認款項後將儘速為您處理。',
    placeholders: [],
  },
  bankAmountChangedNoticeTitle: {
    group: 'bank_amount_changed',
    label: '匯款金額變更信:提醒標題',
    text: '※ 特別提醒:',
    placeholders: [],
  },
  bankAmountChangedNotice: {
    group: 'bank_amount_changed',
    label: '匯款金額變更信:金額可能增加的說明',
    text: '部分商品取消後,原訂單套用之優惠折扣可能隨之失效,運費亦將依調整後的金額重新計算;因此最終應付金額可能與您下單時有所不同(或略有增加),敬請見諒。',
    placeholders: [],
  },
  bankAmountChangedPaidOld: {
    group: 'bank_amount_changed',
    label: '匯款金額變更信:已照舊金額匯款怎麼辦',
    text: '若您先前已完成舊金額之匯款,請直接透過 LINE 與我們聯繫,我們將主動協助您辦理差額處理。',
    placeholders: [],
  },
  bankAmountChangedLinkLead: {
    group: 'bank_amount_changed',
    label: '匯款金額變更信:訂單連結前那句',
    text: '完整訂單明細與匯款資訊亦可點擊此處查閱:',
    placeholders: [],
  },
  paidHeadlineWithId: {
    group: 'paid',
    label: '付款成功信開頭(有訂單編號時)',
    text: '您的訂單 {訂單編號} 已付款成功。',
    placeholders: ['訂單編號'],
  },
  paidHeadlineNoId: {
    group: 'paid',
    label: '付款成功信開頭(讀不到訂單編號時)',
    text: '您的訂單已付款成功。',
    placeholders: [],
  },
  paidDetailTitle: {
    group: 'paid',
    label: '付款成功信:明細標題',
    text: '訂單明細',
    placeholders: [],
  },
  paidLinesTruncated: {
    group: 'paid',
    label: '付款成功信:品項太多只列部分時',
    text: '(品項過多，此處僅列出部分)',
    placeholders: [],
  },
  partialRefundHeadline: {
    group: 'partially_refunded',
    label: '部分退款信開頭(訂單還在時)',
    text: '您的訂單 {訂單編號} 已退回一筆款項。',
    placeholders: ['訂單編號'],
  },
  partialRefundToCard: {
    group: 'partially_refunded',
    label: '部分退款信:刷卡退回(只有刷卡才印)',
    text: '款項將退回您原本付款的信用卡。',
    placeholders: [],
  },
  partialRefundOrderActive: {
    group: 'partially_refunded',
    label: '部分退款信:其餘照常出貨(訂單還在時)',
    text: '這筆退款不影響訂單其他項目，未退款的部分仍會照常出貨。',
    placeholders: [],
  },
  shippedHeadline: {
    group: 'shipped',
    label: '出貨信開頭',
    text: '您的訂單 {訂單編號} 有一批商品已出貨。',
    placeholders: ['訂單編號'],
  },
  shippedNoTracking: {
    group: 'shipped',
    label: '出貨信:自取／自送沒有追蹤碼',
    text: '本批為自取／自送,無追蹤碼。',
    placeholders: [],
  },
  shippedTrackingLookupLead: {
    group: 'shipped',
    label: '出貨信:查詢配送進度那句',
    text: '查詢配送進度(請輸入上面的追蹤碼):',
    placeholders: [],
  },
  shippedContentsTitle: {
    group: 'shipped',
    label: '出貨信:出貨內容標題',
    text: '本批出貨內容:',
    placeholders: [],
  },
  shippedTitleMissing: {
    group: 'shipped',
    label: '出貨信:品項沒有品名時顯示',
    text: '(品名從缺)',
    placeholders: [],
  },
  shippedRecipientTitle: {
    group: 'shipped',
    label: '出貨信:收件資訊標題',
    text: '收件資訊:',
    placeholders: [],
  },
  shippedSplitNotice: {
    group: 'shipped',
    label: '出貨信:還有商品沒出(分批出貨)',
    text: '這張訂單可能分批出貨,其餘商品出貨時會另外通知您。',
    placeholders: [],
  },
  trackingCorrectedHeadlineWithId: {
    group: 'tracking_corrected',
    label: '單號更正信開頭(有訂單編號時)',
    text: '您的訂單 {訂單編號} 先前那封出貨通知上的貨運單號有誤。',
    placeholders: ['訂單編號'],
  },
  trackingCorrectedHeadlineNoId: {
    group: 'tracking_corrected',
    label: '單號更正信開頭(讀不到訂單編號時)',
    text: '您先前那封出貨通知上的貨運單號有誤。',
    placeholders: [],
  },
  trackingCorrectedLookupLead: {
    group: 'tracking_corrected',
    label: '單號更正信:查詢配送進度那句',
    text: '查詢配送進度(請輸入上面的貨運單號):',
    placeholders: [],
  },
  trackingCorrectedNote: {
    group: 'tracking_corrected',
    label: '單號更正信:以這一封為準',
    text: '請以這一封為準;先前那個號碼查不到是正常的。',
    placeholders: [],
  },
} as const satisfies Record<string, EmailCopyEntry>;

export type EmailCopyKey = keyof typeof EMAIL_COPY;

/**
 * 把句子裡的 `{代號}` 換成值。只換 `vars` 裡有的代號;其他大括號原樣留著。
 * 🔴 用函式取代而不是 `String.replace(pattern, 字串)`:值裡如果有 `$&`、`$1` 這種字, 後者會把它當成取代語法。
 */
export function fillEmailCopy(text: string, vars: Readonly<Record<string, string>>): string {
  return text.replace(/\{([^{}]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] as string) : whole,
  );
}

// ─────────────── 第 2 片:員工改的字(計畫 ~/pcm-mailbox/計畫-信件文字第2片-資料庫與寄信接線-20261002.md)───────────────

/**
 * 鎖住、不開放員工改的句子。
 * · contactLead:LINE 推播靠「加入官方 LINE @pcmmoto」這段字找出要拿掉的那一行(order-email-copy.ts stripLineInviteForLinePush)。
 * · greetingHalfwidth:匯款單兩封與出貨信的全文是 Sean 核過的版本, 改成全形前先問他。
 */
export const EMAIL_COPY_LOCKED: ReadonlySet<EmailCopyKey> = new Set<EmailCopyKey>(['contactLead', 'greetingHalfwidth']);

export const EMAIL_COPY_MAX_LENGTH = 300;
/**
 * LINE 推播拿掉整行的依據(= `加入官方 LINE ${PCM_LINE_ID}`, order-email-copy.ts)。員工的字不能含這段, 否則那一行在 LINE 版會整行消失。
 * 本檔零 import(order-email-copy.ts 匯入本檔), 所以字面寫在這裡;測試釘住兩邊相同。
 */
export const LINE_INVITE_MARKER = '加入官方 LINE @pcmmoto';

export function isEmailCopyKey(key: string): key is EmailCopyKey {
  return Object.prototype.hasOwnProperty.call(EMAIL_COPY, key);
}

/**
 * 員工改的字合不合格。回傳要給員工看的問題清單;空陣列 = 可以存。
 * 存檔時(後台)與寄信時(讀到表裡的字)都用這一支 ⇒ 兩道檢查同一套規則。
 */
export function validateEmailCopyText(key: string, text: string): string[] {
  if (!isEmailCopyKey(key)) return ['不認得這一句'];
  if (EMAIL_COPY_LOCKED.has(key)) return ['這一句不開放修改'];
  const problems: string[] = [];
  if (text.trim() === '') problems.push('不能是空白');
  if ([...text].length > EMAIL_COPY_MAX_LENGTH) problems.push(`不能超過 ${EMAIL_COPY_MAX_LENGTH} 個字`);
  if (/[\r\n]/.test(text)) problems.push('不能換行');
  if (/[<>]/.test(text)) problems.push('不能有 < 或 >');
  if (text.includes(LINE_INVITE_MARKER)) problems.push(`不能含「${LINE_INVITE_MARKER}」這段字`);
  const required = EMAIL_COPY[key].placeholders;
  for (const name of required) {
    if (!text.includes(`{${name}}`)) problems.push(`缺少 {${name}}，請加回去`);
  }
  // 拿掉認得的代號之後, 不能再剩任何大括號(單邊或不認得的代號, 客人會原樣看到)。
  const stripped = required.reduce((acc, name) => acc.split(`{${name}}`).join(''), text);
  if (/[{}]/.test(stripped)) problems.push('有不認得的 {代號} 或多出來的大括號');
  return problems;
}

/** 版本表的一列(寄信端讀到的形狀)。text = null 代表還原成程式預設。 */
export type EmailCopyVersion = { id: string; copyKey: string; text: string | null; savedAt: string };

/**
 * 算出「某一刻生效」的員工字:每個代號取 saved_at ≤ asOf 的最新一列(同時間看 id)。
 * · 寄信用「這封信排進佇列那一刻」⇒ 同一封信重試時文字不變(Resend 擋內容不同的重送)。
 * · 最新那列是 NULL(還原)、鎖住的句子、或檢查不過的字 ⇒ 不蓋, 用預設;檢查不過的代號回在 invalidKeys 讓呼叫端記錯誤。
 */
export function resolveEmailCopyOverrides(
  rows: readonly EmailCopyVersion[],
  asOfIso: string,
): { overrides: ReadonlyMap<EmailCopyKey, string>; invalidKeys: string[] } {
  const asOf = Date.parse(asOfIso);
  const latest = new Map<string, EmailCopyVersion>();
  if (Number.isFinite(asOf)) {
    for (const r of rows) {
      const t = Date.parse(r.savedAt);
      if (!Number.isFinite(t) || t > asOf) continue;
      const cur = latest.get(r.copyKey);
      const curT = cur === undefined ? -Infinity : Date.parse(cur.savedAt);
      if (cur === undefined || t > curT || (t === curT && r.id > cur.id)) latest.set(r.copyKey, r);
    }
  }
  const overrides = new Map<EmailCopyKey, string>();
  const invalidKeys: string[] = [];
  for (const [key, r] of latest) {
    if (r.text === null) continue;
    if (validateEmailCopyText(key, r.text).length > 0) {
      invalidKeys.push(key);
      continue;
    }
    overrides.set(key as EmailCopyKey, r.text);
  }
  return { overrides, invalidKeys };
}

// 目前這封信用的員工字。只在 withEmailCopyOverrides 的同步區段裡有值 ⇒ 不會被別封信用到。
let activeOverrides: ReadonlyMap<EmailCopyKey, string> | null = null;

/**
 * 用這一組員工字組一封信。`build` 必須是同步函式:組信的全程沒有 await, 別封信插不進來。
 * 🔴 不支援巢狀, 也不接受回傳 Promise(那代表有人把非同步的東西放進來, 員工字會在 await 之後失效或串到別封)。
 */
export function withEmailCopyOverrides<T>(overrides: ReadonlyMap<EmailCopyKey, string>, build: () => T): T {
  if (activeOverrides !== null) throw new Error('withEmailCopyOverrides 不能巢狀使用');
  activeOverrides = overrides;
  try {
    const out = build();
    if (out instanceof Promise) throw new Error('withEmailCopyOverrides 的 build 必須是同步函式');
    return out;
  } finally {
    activeOverrides = null;
  }
}

/** 取一句並填好代號。在 withEmailCopyOverrides 裡呼叫時, 員工改過的字優先。 */
export function emailCopy(key: EmailCopyKey, vars: Readonly<Record<string, string>> = {}): string {
  return fillEmailCopy(activeOverrides?.get(key) ?? EMAIL_COPY[key].text, vars);
}
