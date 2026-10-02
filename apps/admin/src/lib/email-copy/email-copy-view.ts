import { EMAIL_COPY, EMAIL_COPY_LOCKED, validateEmailCopyText, type EmailCopyGroup, type EmailCopyKey } from '@pcm/domain';
import { formatTaipei } from '../orders/payment-list-view';
import type { EmailCopyVersionWithAuthor } from './email-copy-repository';

// 信件文字第 3 片:畫面要的資料(純函式, 好測)。

export const EMAIL_COPY_GROUP_LABEL: Readonly<Record<EmailCopyGroup, string>> = {
  shared: '多封信共用',
  paid: '付款成功信',
  bank_order_created: '匯款單成立信',
  bank_amount_changed: '匯款金額變更信',
  shipped: '出貨信',
  tracking_corrected: '貨運單號更正信',
  unpaid_cancelled: '未付款取消信',
  cancelled: '已付款取消信',
  partially_refunded: '部分退款信',
  partially_cancelled: '部分取消信',
  return_received: '退貨收回信',
};
export const EMAIL_COPY_GROUP_ORDER: readonly EmailCopyGroup[] = [
  'shared', 'paid', 'bank_order_created', 'bank_amount_changed', 'shipped', 'tracking_corrected',
  'unpaid_cancelled', 'cancelled', 'partially_refunded', 'partially_cancelled', 'return_received',
];

/** 鎖住的句子為什麼不能改(給員工看)。 */
export const EMAIL_COPY_LOCK_REASON: Readonly<Partial<Record<EmailCopyKey, string>>> = {
  contactLead: 'LINE 通知會依這段文字找出要拿掉的那一行。改了之後，LINE 通知會多出一行加 LINE 的邀請，所以這一句不開放修改。',
  greetingHalfwidth: '匯款單成立信、匯款金額變更信與出貨信的全文是 Sean 確認過的版本。要改這一句，請先和 Sean 確認。',
};

/** 額外提醒(不是鎖住, 但員工改之前要知道)。 */
const EMAIL_COPY_NOTE: Readonly<Partial<Record<EmailCopyKey, string>>> = {
  companyLine: '帳號停用通知信不在這裡管理，那封信的公司名稱不會跟著改。',
  companyAddress: '帳號停用通知信不在這裡管理，那封信的公司地址不會跟著改。',
};

export type EmailCopyHistoryItem = { id: string; savedAt: string; savedBy: string; text: string | null };

export type EmailCopyRow = {
  key: EmailCopyKey;
  group: EmailCopyGroup;
  label: string;
  defaultText: string;
  /** 現在生效的文字(沒改過或還原了 ⇒ 預設)。 */
  currentText: string;
  isDefault: boolean;
  placeholders: readonly string[];
  lockReason: string | null;
  note: string | null;
  /** 預覽預設看哪一封範例;null = 這一句只在少見的情況出現, 範例信看不到。 */
  defaultSampleId: string | null;
  history: EmailCopyHistoryItem[];
};

export function buildEmailCopyRows(
  versions: readonly EmailCopyVersionWithAuthor[],
  sampleKeys: ReadonlyMap<string, readonly EmailCopyKey[]>,
): EmailCopyRow[] {
  const sampleIds = [...sampleKeys.keys()];
  return (Object.keys(EMAIL_COPY) as EmailCopyKey[]).map((key) => {
    const entry = EMAIL_COPY[key];
    const mine = versions
      .filter((v) => v.copyKey === key)
      .sort((a, b) => (a.savedAt === b.savedAt ? (a.id < b.id ? 1 : -1) : Date.parse(b.savedAt) - Date.parse(a.savedAt)));
    const latest = mine[0];
    const locked = EMAIL_COPY_LOCKED.has(key);
    // 最近存的字不符合現在的規則(例如之後這句多了必填代號)⇒ 寄信時會改用預設文字(resolveEmailCopyOverrides 跳過它),
    // 畫面要跟著顯示預設, 不能寫「已修改」讓員工以為客人收到的是改過的字。
    const savedText = !locked && latest !== undefined && latest.text !== null ? latest.text : null;
    const savedInvalid = savedText !== null && validateEmailCopyText(key, savedText).length > 0;
    const current = savedText !== null && !savedInvalid ? savedText : entry.text;
    return {
      key,
      group: entry.group,
      label: entry.label,
      defaultText: entry.text,
      currentText: current,
      isDefault: current === entry.text && (savedText === null || savedInvalid),
      placeholders: entry.placeholders,
      lockReason: locked ? (EMAIL_COPY_LOCK_REASON[key] ?? '這一句不開放修改。') : null,
      note:
        [EMAIL_COPY_NOTE[key], savedInvalid ? '最近一次存的文字不符合目前的規則，寄信時改用預設文字。請重新修改並儲存。' : undefined]
          .filter(Boolean)
          .join('\n') || null,
      defaultSampleId: sampleIds.find((id) => sampleKeys.get(id)?.includes(key)) ?? null,
      history: mine.map((v) => ({ id: v.id, savedAt: formatTaipei(v.savedAt) ?? v.savedAt, savedBy: v.savedBy, text: v.text })),
    };
  });
}
