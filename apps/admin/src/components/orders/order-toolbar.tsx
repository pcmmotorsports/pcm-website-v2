import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AdminOrderFilter } from '@pcm/domain';
import {
  PANEL_CLOSED,
  buildOrderListHref,
  type OrderDatePresetOption,
  type OrderListDisplayState,
  type OrderPanelTarget,
} from '../../lib/orders/order-list-view';
import {
  STATUS_CHIPS,
  VIEW_CHIPS,
  applyStatusChip,
  applyViewChip,
  currentTaipeiMonth,
  monthFilterRange,
  monthLabel,
  monthOfFilter,
  shiftMonth,
  statusChipActive,
  viewChipActive,
  type StatusChipSpec,
} from '../../lib/orders/order-toolbar-view';
import { MANUAL_ORDER_DIALOG_PATH } from '../../lib/orders/manual-order-action-state';
import { applyOrderKeywordSearchAction } from '../../lib/orders/keyword-search-action';
import { ORDER_KEYWORD_FIELD, ORDER_KEYWORD_RETURN_TO_FIELD } from '../../lib/orders/order-keyword-cookie';
import { ORDER_SEARCH_CAVEAT, ORDER_SEARCH_LABELS } from './order-search-dimensions';
import type { OrderListCount } from '../../lib/orders/order-list-count';

// order-toolbar.tsx — 訂單頁表格上面那一整塊,照 v22 稿(OD pcm-524f `orders-admin-v22-A-出貨彈窗收斂.html`,
//    真值 `scripts/tool-final-css.py` 抽:`.head` flex gap 8 / `h1` 16px / `.month button` 5×10 / `.todo button`
//    4×8 12.5px 圓角 8 / `.todo button b` 13px 600 / `.search` 30px 高 260 寬 圓角 8 / `.btn-sm` 26px /
//    `.summary` 13px fg2 / `.sub .chip` 5×11 12px 圓角 9999)。**三列**:
//    ① 訂單 · 月份「08 | 2026 / 09 | 10」· 篩選:六顆狀態 chip 帶計數 · 搜尋框 · ＋ 新增
//    ② 「{狀態} N 張單」(+ 搜尋中:「搜尋「X」· 命中 N 筆 · 清除」)
//    ③ 只看:全部 · 尾款未收 · 已退款 · 含刷卡未付款 ｜ 來源 ｜ 管道 · (右)匯出這一頁
//    🪦 舊的 h1 26px + 三顆 tab + 「共 N 筆」+ 搜尋區塊(兩行說明)+ 篩選卡 + 匯出鈕四層,本片整個拿掉(不是藏)。
//       舊檔的版面量測與 35px 列高那段理由隨檔退場(`git show 81f668d41:apps/admin/src/components/orders/order-toolbar.tsx`)。
//
// 🔴 chip 定義與選中判定在 `lib/orders/order-toolbar-view.ts`(純函式,可測);本檔只排版。
// 🔴 六顆計數走 `lib/orders/order-list-count.ts`(與首頁 / 側欄同一支):數字 = 點那顆進去的「共 N 筆」。
// 🔴 搜尋仍是 POST + httpOnly cookie(搜尋詞是客人姓名 / 電話 ⇒ 不得進 URL),`return_to` 帶現在的列表網址。
//    placeholder 由 `ORDER_SEARCH_LABELS` 產,不手打(手打就有第二份會過期的清單)。
// 🔴 稿的「老闆:成本」勾 = `bossSlot`(A1, 2026-09-14):page 只在 `isActiveManager` 為真時給節點(`order-boss-toggle.tsx`),本檔只擺位置(＋ 新增左邊)。
//    稿的「多樣的單 / 車行 / 直客」今天沒有篩選軸,不畫。
// 🎨 `leading-[1.4]` 不省(globals.css FIX-27 會把沒帶 `leading-*` 的 `text-xs/sm` 撐大)。

export type OrderToolbarProps = {
  filter: AdminOrderFilter;
  display: OrderListDisplayState;
  panelTarget: OrderPanelTarget;
  /** 這一頁的總筆數(列表同一支查詢);`null` = 列表讀失敗。 */
  total: number | null;
  /** 六顆狀態 chip 的計數(順序 = `STATUS_CHIPS`);缺 = 沒算(顯示「—」)。 */
  chipCounts: readonly (OrderListCount | null)[];
  /** 現在(台北月份切換的中心;由 page 傳進來,元件不自己拿時鐘)。 */
  now: Date;
  datePresetOptions: readonly OrderDatePresetOption[];
  selectedDatePresetKey: string;
  keyword: string | null;
  keywordMatchCount: number | null;
  keywordTruncated: boolean;
  /** 匯出鈕(client 元件,page 算好 props);列表讀失敗時不給。 */
  exportSlot?: ReactNode;
  /** 🆕 A1:「老闆:成本」勾(稿 `label.boss`, ＋ 新增左邊)。**非 manager 的請求 page 給 null** ⇒ 本檔不做權限判斷。 */
  bossSlot?: ReactNode;
};

const H1 = 'm-0 text-[16px] leading-[1.4] font-semibold text-foreground';
const MONTH_BTN = 'inline-flex items-center px-[10px] py-[5px] text-[13px] leading-[1.4]';
const MONTH_BTN_OFF = 'text-(--fg-2)';
const MONTH_BTN_ON = 'bg-(--fg-2) text-white';
const STATUS_BTN =
  'inline-flex items-center gap-[5px] rounded-lg border px-2 py-1 text-[12.5px] leading-[1.4] hover:border-border';
const STATUS_BTN_OFF = 'border-transparent text-muted-foreground';
const STATUS_BTN_ON = 'border-border bg-card text-(--fg-2)';
// 🔴 顏色不放進共用底 class:`text-(--fg-2)` 與 `text-white` 同屬性,Tailwind 的輸出順序決定誰贏,
//    實測(2026-09-13 鑽機截圖)選中那顆變成深底深字、看不見字。⇒ 底 class 零顏色,兩態各自給。
const VIEW_CHIP = 'inline-flex items-center rounded-full border px-[11px] py-[5px] text-[12px] leading-[1.3]';
const VIEW_CHIP_OFF = 'border-border bg-card text-(--fg-2)';
const VIEW_CHIP_ON = 'border-(--fg-2) bg-(--fg-2) text-white';

function StatusChip({
  chip,
  filter,
  count,
  display,
  panelTarget,
}: {
  chip: StatusChipSpec;
  filter: AdminOrderFilter;
  count: OrderListCount | null;
  display: OrderListDisplayState;
  panelTarget: OrderPanelTarget;
}) {
  const active = statusChipActive(chip, filter);
  // 🔴 連結用 chip 自己算好的那條(日期寫死的)—— 那正是計數用的網址;沒算到才退回 page 這邊組的。
  const href = count?.href ?? buildOrderListHref(applyStatusChip(filter, chip), display, 1, panelTarget);
  const n = count === null ? '—' : count.count === null ? '?' : String(count.count);
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`${STATUS_BTN} ${active ? STATUS_BTN_ON : STATUS_BTN_OFF}`}
      data-chip={chip.key}
    >
      {chip.label}
      <b className={`text-[13px] leading-[1.4] font-semibold ${chip.tone === 'warn' ? 'text-(--warning)' : 'text-(--fg-2)'}`}>
        {n}
      </b>
    </Link>
  );
}

export function OrderToolbar({
  filter,
  display,
  panelTarget,
  total,
  chipCounts,
  now,
  datePresetOptions,
  selectedDatePresetKey,
  keyword,
  keywordMatchCount,
  keywordTruncated,
  exportSlot,
  bossSlot,
}: OrderToolbarProps) {
  // 🔴 `#742`:搜尋的 return_to 是「回到列表這個動作本身」⇒ 刻意關掉面板(`PANEL_CLOSED` 要 import 才寫得出來)。
  const searchReturnTo = buildOrderListHref(filter, display, 1, PANEL_CLOSED);
  const month = monthOfFilter(filter);
  const center = month ?? currentTaipeiMonth(now);
  const prev = shiftMonth(center, -1);
  const next = shiftMonth(center, 1);
  const monthHref = (k: typeof center) =>
    buildOrderListHref({ ...filter, ...monthFilterRange(k) }, display, 1, panelTarget);
  // 🔴 中間那顆**永遠印月份**(主視窗 2026-09-13:「稿那格永遠是 2026 / 09 這種月份,不能印範圍名」):
  //    整月模式 ⇒ 實心、按了回到「近半年」預設(清掉日期);非整月(近半年 / 自訂)⇒ 印當月、整組灰掉、按了進入月份模式。
  //    現在生效的範圍名(近半年 / 自訂)改放 title,不佔版面。
  const presetLabel =
    datePresetOptions.find((o) => o.key === selectedDatePresetKey)?.label ?? selectedDatePresetKey;
  const centerLabel = monthLabel(center);
  const centerHref = month
    ? buildOrderListHref({ ...filter, createdFrom: undefined, createdTo: undefined }, display, 1, panelTarget)
    : monthHref(center);
  const activeStatus = STATUS_CHIPS.find((c) => statusChipActive(c, filter));

  return (
    <div className='space-y-2' data-testid='order-toolbar'>
      {/* ① 主列 */}
      <div className='flex flex-wrap items-center gap-2'>
        <h1 className={`${H1} mr-[6px]`}>訂單</h1>
        <div
          className={`inline-flex overflow-hidden rounded-lg border border-border bg-card ${month ? '' : 'opacity-60'}`}
          aria-label='月份'
          data-month-mode={month ? 'on' : 'off'}
        >
          <Link href={monthHref(prev)} className={`${MONTH_BTN} ${MONTH_BTN_OFF}`} aria-label={`上個月 ${monthLabel(prev)}`}>
            {String(prev.m).padStart(2, '0')}
          </Link>
          <Link
            href={centerHref}
            className={`${MONTH_BTN} ${month ? MONTH_BTN_ON : MONTH_BTN_OFF}`}
            aria-current={month ? 'true' : undefined}
            title={month ? '按了回到近半年' : `現在看的是「${presetLabel}」;按了只看 ${centerLabel}`}
          >
            {centerLabel}
          </Link>
          <Link href={monthHref(next)} className={`${MONTH_BTN} ${MONTH_BTN_OFF}`} aria-label={`下個月 ${monthLabel(next)}`}>
            {String(next.m).padStart(2, '0')}
          </Link>
        </div>
        <div className='ml-1 flex items-center gap-1' role='group' aria-label='篩選'>
          <span className='mr-[2px] text-[11.5px] leading-[1.4] text-muted-foreground'>篩選:</span>
          {STATUS_CHIPS.map((chip, i) => (
            <StatusChip
              key={chip.key}
              chip={chip}
              filter={filter}
              count={chipCounts[i] ?? null}
              display={display}
              panelTarget={panelTarget}
            />
          ))}
        </div>
        <span className='flex-1' />
        <form
          action={applyOrderKeywordSearchAction}
          className='flex min-h-[30px] w-[260px] items-center gap-[6px] rounded-lg border border-border bg-card px-2'
          role='search'
        >
          <span className='text-muted-foreground' aria-hidden='true'>
            ⌕
          </span>
          <label htmlFor='order-keyword-search' className='sr-only'>
            搜尋
          </label>
          <input
            id='order-keyword-search'
            type='text'
            name={ORDER_KEYWORD_FIELD}
            autoComplete='off'
            defaultValue={keyword ?? ''}
            placeholder={ORDER_SEARCH_LABELS.join(' / ')}
            /* 🔴 那句「品牌搜的是現在的品牌」不能丟(少了它,拿舊品牌搜歷史單會得到「查無此單」而不知道為什麼);
               稿沒有第二行說明 ⇒ 放進 title(滑過 / 長按看得到),字面仍由常數供應。 */
            title={`可以搜:${ORDER_SEARCH_LABELS.join('、')}。${ORDER_SEARCH_CAVEAT}`}
            className='min-w-0 flex-1 border-0 bg-transparent text-[13px] leading-[1.4] outline-none'
          />
          <input type='hidden' name={ORDER_KEYWORD_RETURN_TO_FIELD} value={searchReturnTo} />
          <button type='submit' className='sr-only'>
            搜尋
          </button>
        </form>
        {bossSlot !== undefined && bossSlot !== null && bossSlot}
        {/* 🔴 不掛 loadFailed:列表讀失敗與「能不能建新單」無關。樣式 = 稿 `.btn.btn-sm.btn-p`。 */}
        <Link
          href={MANUAL_ORDER_DIALOG_PATH}
          className='inline-flex min-h-[26px] items-center gap-[6px] rounded-lg bg-primary px-2 text-[12px] leading-[1.4] text-primary-foreground'
        >
          ＋ 新增訂單
        </Link>
      </div>

      {/* ② 摘要列 */}
      <p
        className='m-0 flex flex-wrap items-center gap-x-2 text-[13px] leading-[1.4] text-(--fg-2)'
        data-testid='order-summary'
      >
        {total === null ? (
          <span className='text-destructive'>列表讀取失敗</span>
        ) : (
          <span>
            {activeStatus?.label ?? '全部'} <b className='text-[15px] leading-[1.4]'>{total}</b> 張單
          </span>
        )}
        {keyword !== null && (
          <>
            <span className='text-muted-foreground'>·</span>
            <span>
              搜尋「{keyword}」
              {keywordMatchCount !== null && (
                <span className='text-muted-foreground'>
                  {' '}
                  命中 {keywordTruncated ? `${keywordMatchCount}+` : keywordMatchCount} 筆
                </span>
              )}
            </span>
            {/* 🔴 清除走同一支 action(cookie 只有它清得到),不做 client 捷徑。 */}
            <form action={applyOrderKeywordSearchAction} className='inline'>
              <input type='hidden' name={ORDER_KEYWORD_FIELD} value='' />
              <input type='hidden' name={ORDER_KEYWORD_RETURN_TO_FIELD} value={searchReturnTo} />
              <button type='submit' className='text-muted-foreground underline hover:text-foreground'>
                清除搜尋
              </button>
            </form>
          </>
        )}
      </p>

      {/* ③ 只看列 */}
      <div
        className='flex flex-wrap items-center gap-[6px] text-[12.5px] leading-[1.4] text-muted-foreground'
        data-testid='order-view-chips'
      >
        <span>只看:</span>
        {VIEW_CHIPS.map((chip, i) => {
          const active = viewChipActive(chip, filter);
          const prevGroup = VIEW_CHIPS[i - 1]?.group;
          return (
            <span key={chip.key} className='contents'>
              {prevGroup !== undefined && prevGroup !== chip.group && (
                <span className='mx-1 text-border' aria-hidden='true'>
                  ｜
                </span>
              )}
              <Link
                href={buildOrderListHref(applyViewChip(filter, chip), display, 1, panelTarget)}
                aria-current={active ? 'true' : undefined}
                className={`${VIEW_CHIP} ${active ? VIEW_CHIP_ON : VIEW_CHIP_OFF}`}
                data-chip={chip.key}
              >
                {chip.label}
              </Link>
            </span>
          );
        })}
        {exportSlot !== undefined && exportSlot !== null && <span className='ml-auto'>{exportSlot}</span>}
      </div>
    </div>
  );
}
