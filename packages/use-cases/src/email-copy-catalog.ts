// email-copy-catalog.ts —— 客人收到的交易信裡,【固定句子】的唯一清單(2026-10-02 信件文字第 1 片)。
//
// PRD ~/pcm-mailbox/PRD-員工自己改交易信文案-20261002.md(Sean 10-02 答甲:做小版、所有員工可改、存檔即生效但先看預覽、主旨不開放)。
// 第 1 片只做一件事:把散在程式裡的句子收進這張清單,寄出的信一字不改(`__golden__/customer-emails.json` 逐字鎖)。
// 第 2 片才會讓後台改的字蓋過這裡的預設值;這裡永遠是「讀不到員工改的字時」的那一版。
//
// 規則:
// · `text` 是預設文字,就是今天寄出去的字,一個字都不要在這裡「順手潤飾」—— 改字是員工在後台做的事。
// · 要放訂單資料的地方寫 `{代號}`;`placeholders` 列出這句【必須】有的代號,後台存檔時少一個就擋(第 3 片)。
// · 金額、品項、單號這些會變的內容不寫在這裡;「什麼情況印哪一句」的判斷也不在這裡,留在組信的程式。
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
  | 'return_received';

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

/** 取一句並填好代號。 */
export function emailCopy(key: EmailCopyKey, vars: Readonly<Record<string, string>> = {}): string {
  return fillEmailCopy(EMAIL_COPY[key].text, vars);
}
