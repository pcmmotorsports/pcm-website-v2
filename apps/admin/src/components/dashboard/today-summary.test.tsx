// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TodaySummaryCards } from './today-summary';
import type { TodaySummary } from '../../lib/dashboard/today-read';

// today-summary.test.tsx — `#16` **三格**的顯示 smoke(🪦 原為四格,退款那格 2026-08-15 拆掉)。
// 🔴 這支不驗算術(那在 `today-view.test.ts`)、也不驗查詢形狀(那在 `today-read.test.ts`),
//    只驗**三格都在、數字有出來、措辭不騙人**。

function summary(over: Partial<TodaySummary> = {}): TodaySummary {
  return {
    ymd: '2026-08-14',
    receivedAmount: 12345,
    newOrderCount: 7,
    refundExceptionCount: 2,
    refundExceptionTruncated: false,
    failedSections: [],
    ...over,
  };
}

afterEach(cleanup);

describe('TodaySummaryCards', () => {
  it('三格都在,且金額有千分位', () => {
    render(<TodaySummaryCards summary={summary()} />);
    expect(screen.getByText('今日實收(淨)')).toBeTruthy();
    expect(screen.getByText('今日新單')).toBeTruthy();
    expect(screen.getByText('目前待處理退款異常')).toBeTruthy();
    expect(screen.getByText('NT$ 12,345')).toBeTruthy();
    // 🪦 「今日退款(已完成)」那格於 2026-08-15 拆掉(見 `lib/dashboard/today-view.ts` 墓碑段)。
    // 🔴 **反向釘住,不是只把斷言刪掉**:有人把 `reduce` 版加回來,這行會紅 ——
    //    而不是靜默通過讓他以為自己補好了一個「漏做」的格子。
    expect(screen.queryByText('今日退款(已完成)')).toBeNull();
  });

  it('日期與時區講明白(員工要知道這是台北的今天)', () => {
    const { container } = render(<TodaySummaryCards summary={summary()} />);
    expect(container.textContent).toContain('2026-08-14');
    expect(container.textContent).toContain('台北時間');
  });

  it('🔴 異常那格不得寫成「今日」—— 它是累計待辦、不是今天新增的', () => {
    const { container } = render(<TodaySummaryCards summary={summary()} />);
    expect(container.textContent).toContain('目前待處理退款異常');
    expect(container.textContent).not.toContain('今日異常');
    // 正向對照:證明掃描字集真的看得到「今日」二字(否則上一條對任何字串恆真)。
    expect(container.textContent).toContain('今日實收');
  });

  it('🔴 截斷時數字要標成下限,不能讓員工以為就這麼多', () => {
    const { container } = render(
      <TodaySummaryCards summary={summary({ refundExceptionTruncated: true })} />,
    );
    expect(container.textContent).toContain('2+ 筆');
    expect(container.textContent).toContain('實際可能更多');
  });

  it('未截斷時不得出現那個 `+`(免得數字看起來永遠是下限)', () => {
    const { container } = render(<TodaySummaryCards summary={summary()} />);
    expect(container.textContent).toContain('2 筆');
    expect(container.textContent).not.toContain('2+ 筆');
  });

  // 🪦 「金額被截斷時要當場講出來」(MF4 顯示半)隨退款那格於 2026-08-15 一起刪掉。
  //    🔴 **但 R2 MF-D 那半不能跟著消失** —— 它守的是「React 不解析 markdown,
  //       寫 `**…**` 員工會原樣看到星號」,與退款無關。⇒ 改釘還活著的失敗警語。
  it('🔴 R2 MF-D:警語不得出現原樣的 `**`(React 不解析 markdown)', () => {
    const { container } = render(
      <TodaySummaryCards summary={summary({ receivedAmount: null, failedSections: ['今日實收'] })} />,
    );
    // 正向對照:先證明這條警語真的渲染出來了,否則下一行對空字串恆真。
    expect(container.textContent).toContain('沒讀到');
    expect(container.textContent).not.toContain('**');
    expect(container.querySelector('strong')?.textContent).toContain('今日實收');
  });

  it('🔴 當天收款當天被沖銷 ⇒ 實收可能是負數,先把現行顯示釘住(R2 nit8)', () => {
    // ⚠️ **這格只釘「現在長這樣」,不代表 Sean 認可這個顯示。**
    //    `formatOrderAmount` = `toLocaleString('en-US')`(`lib/orders/order-list-view.ts:746-748`)
    //    ⇒ 負數輸出 `NT$ -500`。要不要換形狀(紅字 / 括號 / `-NT$ 500`)是**品味題、Sean 拍**。
    //    釘住的價值:哪天有人加 `Math.max(0, …)` 之類的「修正」把負數藏起來,這格會紅 ——
    //    而藏起來正好會讓沖銷當天的帳**看起來是對的**。
    const { container } = render(<TodaySummaryCards summary={summary({ receivedAmount: -500 })} />);
    expect(container.textContent).toContain('NT$ -500');
    expect(container.textContent).not.toContain('NaN');
  });

  it('🔴 R2 nit7:只有一格掛 ⇒ 那格顯示「讀取失敗」,其餘三格照常顯示數字', () => {
    const { container } = render(
      <TodaySummaryCards
        summary={summary({ newOrderCount: null, failedSections: ['今日新單'] })}
      />,
    );
    expect(container.textContent).toContain('讀取失敗');
    // 🔴 本體:另外兩格**沒有**被一起蓋掉。
    expect(container.textContent).toContain('NT$ 12,345');
    expect(container.textContent).toContain('2 筆');
    // 講得出是哪一格 —— 只說「對帳壞了」等於要員工自己猜哪個數字能信。
    expect(container.textContent).toContain('今日新單');
    // 🔴 失敗**絕不**渲染成金額(一個安靜的 NT$ 0 看起來就像「今天沒退款」)。
    expect(container.textContent).not.toContain('NT$ 0');
  });

  it('沒有任何一格掛 ⇒ 不得出現「讀取失敗」(否則上一格恆真)', () => {
    const { container } = render(<TodaySummaryCards summary={summary()} />);
    expect(container.textContent).not.toContain('讀取失敗');
    expect(container.textContent).not.toContain('沒讀到');
  });

  it('🔴 「今日新單」的口徑與另三格不同,必須講出來(R2 nit5)', () => {
    const { container } = render(<TodaySummaryCards summary={summary()} />);
    // 另三格數的是「錢真的動了」,這格數的是「今天建了幾張單」—— 含未付款、含當天取消。
    expect(container.textContent).toContain('含未付款與當天取消的');
  });

  it('沒截斷時不得出現那句警語(否則變成恆顯示的雜訊)', () => {
    const { container } = render(<TodaySummaryCards summary={summary()} />);
    expect(container.textContent).not.toContain('不完整');
  });

  it('零資料 ⇒ 顯示 0,不出現 NaN / undefined', () => {
    const { container } = render(
      <TodaySummaryCards
        summary={summary({
          receivedAmount: 0,
          newOrderCount: 0,
          refundExceptionCount: 0,
        })}
      />,
    );
    expect(container.textContent).toContain('NT$ 0');
    expect(container.textContent).toContain('0 筆');
    expect(container.textContent).not.toContain('NaN');
    expect(container.textContent).not.toContain('undefined');
  });
});
