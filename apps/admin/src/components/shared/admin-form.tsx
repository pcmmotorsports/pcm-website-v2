import type { ComponentProps, ReactNode } from 'react';

// E11 後台 UI 積木第二片:共用卡片內嵌表單外框。
// 背景:規格 §3.3「先做積木,再做頁面」+ Sean 07-25 拍板 N4=A;現況三個消費端
// 抄了逐字元相同的 FIELD / LABEL / INPUT class 與欄位包裝,後續商品/供應商/庫存
// 若沒有積木會繼續複製。
//
// ponytail: 本片不等於規格 §3.3 的 <AdminForm> 全貌,刻意只做「卡片內嵌變體」:
//   - 未儲存變更離開警告(§4-6) = 需把目前零 client JS 的表單升級成互動元件,獨立一片做
//   - 頂部 critical banner 雙層錯誤(§4-3) = 同樣需要 client 互動,等先有錯誤狀態資料流再獨立做
//   - sticky 儲存列(§3.3) = 三個消費端都是卡片內嵌小表單,不是頁面級主側兩欄表單,
//     對它們沒有意義;等 E10 手動建單/改單的頁面級大表單有真實消費端時再做
//
// ponytail: hidden 用 Record 表達,同名鍵會靜默後蓋前(原本並排兩個 <input type='hidden'>
//   則是兩個都送出)。今天三個消費端各自的鍵互異、撞不到,但 tier 與 wallet 的
//   customer_id 字面值相同 => 日後若把多張表單併成一張,改用 Array<[name, value]>。

/** 共用輸入框 class。三個消費端原本各抄一份、逐字元相同。 */
export const ADMIN_INPUT_CLASS =
  'border-input bg-background h-9 rounded-md border px-3 text-sm';

const FORM_CLASS = {
  card: 'rounded-lg border bg-card p-4 text-card-foreground',
  section: 'mt-3 border-t pt-3',
} as const;

const GRID = {
  2: 'grid gap-3 sm:grid-cols-2',
  3: 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3',
} as const;

/** 單一欄位:label 文字 + 控制項(input/select 由呼叫端傳,樣式用 ADMIN_INPUT_CLASS)。 */
export function AdminFormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className='flex flex-col gap-1 text-sm'>
      <span className='text-muted-foreground text-xs font-medium'>{label}</span>
      {children}
    </label>
  );
}

export type AdminFormProps = {
  /** 原呼叫端的 server action;共用外框不包裝、不改寫 FormData。 */
  action: ComponentProps<'form'>['action'];
  /** card = 獨立卡片;section = 嵌在既有卡片內的分段。 */
  variant: 'card' | 'section';
  /** 有值才在欄位群上方顯示標題。 */
  heading?: string;
  /** 依物件插入順序直出 hidden inputs。 */
  hidden?: Record<string, string | number>;
  /** 響應式欄數;預設 2。 */
  columns?: 2 | 3;
  /** 動作列左側提示;省略時不留空節點。 */
  footerHint?: ReactNode;
  /** 動作列右側內容(原 submit 按鈕或既有 client island)。 */
  actions: ReactNode;
  /** 欄位群;通常放 AdminFormField。 */
  children: ReactNode;
};

export function AdminForm({
  action,
  variant,
  heading,
  hidden,
  columns = 2,
  footerHint,
  actions,
  children,
}: AdminFormProps) {
  return (
    <form action={action} className={FORM_CLASS[variant]}>
      {heading && <h2 className='mb-3 text-sm font-semibold'>{heading}</h2>}
      {hidden &&
        Object.entries(hidden).map(([name, value]) => (
          <input key={name} type='hidden' name={name} value={value} />
        ))}
      <div className={GRID[columns]}>{children}</div>
      <div className='mt-4 flex items-center justify-end gap-2'>
        {footerHint && (
          <span className='text-muted-foreground mr-auto text-xs'>{footerHint}</span>
        )}
        {actions}
      </div>
    </form>
  );
}
