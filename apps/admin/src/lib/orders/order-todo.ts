// order-todo.ts — 首頁「今天要做的事」點進去的**待辦模式**(`/orders?…&todo=<格子>`)。
//    plan:`~/pcm-mailbox/計畫-後台今天要做的事-20260930.md` §2-3(主視窗 2026-09-30 Q1 甲:訂單列表加待辦模式, 不另開一頁)。
//
// 🔴 `todo` 是**顯示軸不是篩選軸**(同 `den` / `boss`):它不進 DB 查詢, 只決定列表畫成「一張單一列、一顆鈕」。
//    ⇒ 篩選照舊由網址上的篩選鍵決定 ⇒ 格子上的數字 = 點進去的筆數(`today-todo-read.ts` 檔頭那條構造)不受影響。
// 🔴 一格只有一個動作。做完那一步, 那張單不再符合這一格的篩選 ⇒ 回到同一條網址時自然不在清單裡。

/** 網址上的鍵。 */
export const ORDER_TODO_PARAM = 'todo';

/** 每一格要按的那一顆鈕打開哪個彈窗(`?pay=` 或 `?next=&do=`, 都是訂單列表既有的彈窗)。 */
export type OrderTodoAction = 'pay' | 'order' | 'ship';

/**
 * 待辦模式的格子。`label` 是首頁格子與清單標題的**唯一**來源(`today-todo-read.ts` 讀這裡)。
 * 2026-09-30 Sean Q3 甲:與訂單頁篩選列同名 —— 待收款（匯款）/ 待下訂 / 可出貨(原 待收款(匯款)/ 待訂貨 / 到貨待出貨)。
 * `actionLabel`:收款用彈窗標題「新增收款」(同一件事一個名字);下訂 / 出貨沿用列表下一步的字(`ORDER_NEXT_STEP_LABEL`)。
 */
export const ORDER_TODO_SPECS = {
  'unpaid-transfer': { label: '待收款（匯款）', action: 'pay', actionLabel: '新增收款' },
  'partial-paid': { label: '待尾款', action: 'pay', actionLabel: '新增收款' },
  'to-order': { label: '待下訂', action: 'order', actionLabel: '跟供應商下訂' },
  // 2026-09-30 有貨可先出:鈕的字跟列表下一步走(「出貨（已到 N 樣）」, `orderNextStep` 的部分到貨分支), `actionLabel` 只是後備。
  'partial-ship': { label: '有貨可先出', action: 'ship', actionLabel: '出貨' },
  'ready-ship': { label: '可出貨', action: 'ship', actionLabel: '出貨' },
} as const satisfies Record<string, { label: string; action: OrderTodoAction; actionLabel: string }>;

export type OrderTodoKey = keyof typeof ORDER_TODO_SPECS;

export const ORDER_TODO_KEYS = Object.keys(ORDER_TODO_SPECS) as OrderTodoKey[];

/** 網址值 → 格子;不認得就 `null`(= 一般列表, fail-safe 倒向預設畫面)。 */
export function readOrderTodoKey(raw: string | string[] | undefined): OrderTodoKey | null {
  if (typeof raw !== 'string') return null;
  return (ORDER_TODO_KEYS as readonly string[]).includes(raw) ? (raw as OrderTodoKey) : null;
}

/** 清單空了的那一句(不是「讀取失敗」—— 讀取失敗走列表既有的錯誤文字)。 */
export const ORDER_TODO_EMPTY = '這一格目前沒有要處理的單。';
