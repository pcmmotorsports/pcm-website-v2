'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { ItemAmountForm, type ItemAmountFormProps } from './item-amount-form';

// item-amount-row.tsx — 品項列 + 「改金額」展開列(M-4b E10 #13 片1c-2 版面片)。
//
// 🔴 **為什麼要這一支**:1c-2 第一版把表單塞進「單價」那格,而那格是
//    `text-right tabular-nums whitespace-nowrap`、實測寬 **155px**(主視窗 2026-08-16 量;
//    品項表是該頁第 [1] 張、6 欄、表寬 1150)。
//    ⚠️ **口徑:那個「6 欄」是 2026-08-19 片5【之前】量的,現值 8 欄**(片5 三軸拆三欄)。
//       155px 那個結論(表單塞不進單價格)在 8 欄下只會更成立 ⇒ **不必重量,補上時點即可。**
//    表單裡有 label、輸入框、checkbox 與「我確認這個品項要改成 0 元」——
//    `nowrap` 會讓它一行到底,**要嘛擠爆別欄、要嘛整張表出現橫向捲軸**。
//
// 🔴🔴 **本檔是【唯一】的 client 島 —— `ItemsTable` 與 `order-detail.tsx` 仍是 server component。**
//    (`grep -c "use client" order-detail.tsx` ⇒ **0**,那個 0 要維持。)
//    ⚠️ 作法:**那幾格的內容仍由 server 算好、當 `ReactNode` 傳進來**(`before` / `priceText` / `after`),
//       (原字面「六格」= 片5 之前的欄數;現值 8,見上方口徑註記。)
//    本檔只負責「**展開誰**」這個狀態與那一列的殼。
//    ⇒ 不要為了方便把 `ItemsTable` 標成 `'use client'` —— 那會把整張表(含金額格式化、三軸彙總)
//    整包送進 client bundle。
//
// 🔴 **收合時不多一列**:trigger 就放在單價格裡(一個小連結),
//    **展開才多出那一列** ⇒ 品項多的訂單不會平白變兩倍長。

/**
 * 🔴 **「只展開正在編輯的那一項」需要【共用】狀態**(codex 版面片 R1 must-fix 1)。
 *
 * 第一版每一列各自 `useState(open)` ⇒ **點 A 再點 B,兩列會同時展開** —— 不符合那條約束。
 * ⇒ 改成一個 client provider 握 `openId`,每一列讀它。
 * ⚠️ **provider 包住的 children 仍是 server 算好的** ⇒ `ItemsTable` 與 `order-detail.tsx`
 * **維持 server component**(那個 `grep -c "use client" ⇒ 0` 要保持)。
 */
const OpenRowContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

export function ItemAmountRowGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <OpenRowContext.Provider value={{ openId, setOpenId }}>{children}</OpenRowContext.Provider>
  );
}

export type ItemAmountRowProps = {
  /**
   * 單價格**之前**的那幾格 —— server 算好傳進來。
   * 🔴 2026-08-19 片5 更新(原字面「品項 / SKU / 數量」已過期):現在是**六格**
   * `商品名稱 / 料號 / 訂 / 到 / 出 / 數量`。**三軸在這裡,不在 `after`。**
   */
  before: ReactNode;
  /** 單價格要顯示的字(已格式化)—— server 算好傳進來 */
  priceText: ReactNode;
  /**
   * 單價格**之後**的那幾格 —— server 算好傳進來。
   * 🔴 2026-08-19 片5 更新(原字面「小計 / 三軸」已過期):現在**只剩小計一格**,
   * 三軸已搬到 `before`。⚠️ 照舊字面接線會把三軸放到單價的**右邊**,而版面不會報錯。
   */
  after: ReactNode;
  /**
   * 片6a-1:那一列的**殼**要畫成什麼。
   *
   * · `table-row` —— 舊殼:`<tr>` + `<td>`(整頁版沿用)。
   * · `card-line` —— 新殼:`<details class="icard">`,`<summary>` 是 `.iline` grid
   *   (設計稿 08-17 `:280-299`;Sean 2026-08-19 逐字選「一個商品一張卡片,沒有表格」)。
   *
   * 🔴🔴 **兩個殼共用同一條錢的路徑,而那是本 prop 存在的理由**:
   *    `blockedReason` 同時決定①入口文案(「無法改金額(看原因)」)②傳給 `ItemAmountForm`。
   *    **殼換了,那條路徑一個字都不能變** —— 而「一道閘在殼被重寫的過程中被漏掉」
   *    **不會有東西紅**(主視窗 2026-08-19 裁本片中鐵則 12① 用的就是這個理由)。
   *    ⇒ 守門在 `item-amount-row.test.tsx`:**兩個 variant 各驗兩個世界**
   *      (已收款 ⇒ 擋住、未收款 ⇒ 放行)。**只驗放行那半不算過。**
   */
  variant?: 'table-row' | 'card-line';
  /** 展開列要跨幾欄(= 表格欄數)。`card-line` 用不到它(卡片沒有欄)。 */
  colSpan: number;
  /** 單價格的 class(沿用表格既有的對齊與字體) */
  /**
   * 🔴 **只有 `table-row` 殼吃它** —— 卡片殼沒有 `<td>` / `<tr>` 可以掛 class。
   *    改成選填是為了讓**型別自己說出「這是舊殼專用」**,而不是留一個在卡片殼裡被默默忽略的 prop。
   */
  priceCellClassName?: string;
  /**
   * 🔴 **只有 `table-row` 殼吃它** —— 卡片殼沒有 `<td>` / `<tr>` 可以掛 class。
   *    改成選填是為了讓**型別自己說出「這是舊殼專用」**,而不是留一個在卡片殼裡被默默忽略的 prop。
   */
  rowClassName?: string;
} & ItemAmountFormProps;

export function ItemAmountRow({
  before,
  priceText,
  after,
  colSpan,
  priceCellClassName,
  rowClassName,
  blockedReason = null,
  variant = 'table-row',
  ...formProps
}: ItemAmountRowProps) {
  const ctx = useContext(OpenRowContext);
  // 🔴 沒有 provider 就 fail-closed 成「永遠收合」——**不要退回各自為政的 local state**,
  //    那正是這條 must-fix 要修掉的行為。少包 provider 的症狀是「按了沒反應」,查得出來;
  //    退回 local state 的症狀是「兩列同時開」,而那**看起來像正常運作**。
  const open = ctx?.openId === formProps.orderItemId;

  /**
   * 🔴 **入口與表單抽成兩個區域變數,兩個殼吃【同一份】** ——
   *    複製一份到卡片殼裡,就是給那道錢閘開第二條路徑,而兩條會各自漂。
   */
  const trigger = (
    // 🔴 **不能改時,入口的字要先講出來**(codex must-fix 2)。
    //    第一版註解寫「改成一個停用的按鈕」而 code **根本沒有 disabled** —— 那是字面 vs 事實。
    //    ⚠️ 而**真的 disabled 也不對**:原因就寫在展開列裡,停用等於把原因鎖住看不到。
    //    ⇒ 折衷:**入口先說「無法改金額」,點開才看原因**。
    <button
      type='button'
      onClick={() => ctx?.setOpenId(open ? null : formProps.orderItemId)}
      className='mt-0.5 text-xs underline'
      aria-expanded={open}
    >
      {blockedReason ? (open ? '收起' : '無法改金額(看原因)') : open ? '收起' : '改金額'}
    </button>
  );
  const form = <ItemAmountForm {...formProps} blockedReason={blockedReason} />;

  if (variant === 'card-line') {
    return (
      // 🔴 逐字搬設計稿 08-17 `:116-117`:`.icard` 只有 `border-bottom`、`summary` 去掉三角形。
      //    `open` 受控 —— 卡片在「改金額」展開時要跟著開,否則表單被 `<details>` 藏起來
      //    而按鈕看起來沒反應。⚠️ 片6b 把採購那層放進 `.icardbody` 之後,
      //    卡片要能【獨立於改金額】開合 ⇒ 那時這裡的受控條件要一起重想,不要照抄。
      <details
        className='icard'
        open={open}
        // 🔴🔴 **codex 關卡2 must-fix 2**:上一版寫 `open={open || undefined}`,
        //    那讓 DOM 與 `OpenRowContext` **會分岔**:表單展開後(`open === true`)使用者
        //    **直接點 `<summary>` 手動收合** ⇒ 瀏覽器把 DOM 的 `open` 拿掉,而 context 仍是開的
        //    ⇒ **表單被藏住、按鈕仍寫「收起」、`aria-expanded` 仍是 `true`,而要按兩次才回得來。**
        //    ⇒ 改成**單一狀態模型**:`open` 完全由 context 決定,而 `onToggle` 把使用者的手動操作
        //      同步回 context ⇒ **兩邊不可能分岔**(點卡片 = 展開改金額,與點那顆入口同一件事)。
        // ⚠️ **片6b 的交棒**:那時 `.icardbody` 會多出採購那層,**卡片就需要能【獨立於改金額】開合**
        //    ⇒ 到那時要拆成兩個狀態,**不要照抄這裡**。
        onToggle={(e) => {
          const next = e.currentTarget.open;
          if (next !== open) ctx?.setOpenId(next ? formProps.orderItemId : null);
        }}
      >
        {/* 🔴 `.iline` **必須包住全部六格** —— 它與 `.ihead` 共用同一組軌道,
            而設計稿 `:119-120` 記著:兩個獨立 grid 的 `auto` 欄各自依內容算寬
            ⇒ **實測整排錯開 8px**。少了這層包裹,六格就不在同一個 grid 裡。 */}
        <summary>
          <div className='iline'>
            {before}
            <div className='text-right'>
              <div className='tabular-nums text-xs whitespace-nowrap'>{priceText}</div>
              {trigger}
            </div>
            {after}
          </div>
        </summary>
        {open ? <div className='icardbody'>{form}</div> : null}
      </details>
    );
  }

  return (
    <>
      <tr className={rowClassName}>
        {before}
        <td className={priceCellClassName}>
          <div>{priceText}</div>
          {/* 🔴 **不能改時也要看得見那顆入口的位置** —— 直接不畫會讓員工找不到而懷疑自己。
              **入口本體已抽成上面的 `trigger`,兩個殼共用**(見 `variant` 那段:
              複製一份到卡片殼裡 = 給那道錢閘開第二條路徑,而兩條會各自漂)。 */}
          {trigger}
        </td>
        {after}
      </tr>
      {open ? (
        <tr className={rowClassName}>
          {/* 🔴 展開列**跨滿整張表** ⇒ 表單有自己的橫向空間,
              確認句、原因欄、之後的錯誤提示都放得下,不必再為每個新欄位打一次版面仗。 */}
          <td colSpan={colSpan} className='bg-muted/30 px-3 py-2'>
            {form}
          </td>
        </tr>
      ) : null}
    </>
  );
}
