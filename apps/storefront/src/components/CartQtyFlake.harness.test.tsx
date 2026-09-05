// @vitest-environment jsdom
//
// ⟦02-CARTQTYFLAKE4⟧ 的**重現 harness** —— 不是守門,不驗任何東西的對錯。
//
// 🔴 **它存在的理由**:那個 flake 現在有五個樣本、三種指紋,而**沒有人量過中間那一步**。
//   既有那一格只在**失敗時**印 `input.value`,而那是 blur **之後**的讀數 ⇒
//   「change 從來沒落地」與「落地了又被 re-render 蓋回去」**印同一個 `"3"`**。
//   ⇒ 🎯 本檔多量一格:**`fireEvent.change` 的正下一行就讀 `input.value`**。
//      那一格是唯一分得開這兩個世界的東西。
//
// 🔴 **預設不跑**(`FLAKE_HARNESS=1` 才跑)—— 它跑 N 發,進 CI 只會拖時間、不會守到東西。
//   跑法:
//     FLAKE_HARNESS=1 FLAKE_N=200 npx vitest run src/components/CartQtyFlake.harness.test.tsx
//   要製造「八個窗都在跑重活」那種負載(板列說那才觸發得到)再加壓:
//     for i in $(seq 1 8); do node -e 'const t=Date.now();while(Date.now()-t<120000){}' & done
//
// ⚠️ **它答不出什麼**:0 紅**不代表**沒有那個 bug —— 板列量到的頻率是 ≈3%,
//   而低負載下 42 發 0 紅是已記錄的事實。⇒ **0 紅只能寫「這一輪沒撞到」。**

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CartItem } from '@/contexts/CartContext';
import type { ResolvedCartLine } from '@/app/cart/actions';

const { cartRef, resolveMock, pushMock } = vi.hoisted(() => ({
  cartRef: {
    current: {
      items: [] as CartItem[],
      totalQty: 0,
      isHydrated: true,
      cartSessionId: 'sess-default' as string | null,
      addItem: vi.fn(),
      removeItem: vi.fn(),
      updateQty: vi.fn(),
      setItemVehicle: vi.fn(),
      setAllItemsVehicle: vi.fn(),
      clear: vi.fn(),
    },
  },
  resolveMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('@/contexts/CartContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/CartContext')>()),
  useCart: () => cartRef.current,
}));
vi.mock('@/app/cart/actions', () => ({ resolveCartLines: resolveMock }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

import { CartView } from './CartView';

beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  resolveMock.mockReset();
  pushMock.mockReset();
});

function setCart(items: CartItem[]) {
  const updateQty = vi.fn();
  cartRef.current = {
    items,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    isHydrated: true,
    cartSessionId: 'sess-default',
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateQty,
    setItemVehicle: vi.fn(),
    setAllItemsVehicle: vi.fn(),
    clear: vi.fn(),
  };
  return { updateQty };
}

function resolvedLine(over: Partial<ResolvedCartLine> & { productId: string }): ResolvedCartLine {
  return {
    variantId: undefined,
    found: true,
    slug: over.productId,
    brand: 'RPM',
    name: '碳纖維車台護蓋',
    image: 'https://cdn.example/img.jpg',
    fits: 'Aprilia RSV4',
    variantLabel: null,
    sku: null,
    unitPrice: 14600,
    fitments: [],
    ...over,
  };
}

/** 捕獲階段那個 listener 沒跑到時 `atDispatch` 會停在這個字串 —— 它是「尺沒接上」的哨兵。 */
const MISSED = '(沒收到 change 事件)';

/** 一發完整的「打 150 → 失焦」,把每一步的讀數原樣帶回來(不判對錯)。 */
async function oneRun() {
  const item: CartItem = { productId: 'rpm-1', variantId: 'v1', qty: 3 };
  const { updateQty } = setCart([item]);
  resolveMock.mockResolvedValue([resolvedLine({ productId: 'rpm-1', variantId: 'v1' })]);
  render(<CartView />);
  await screen.findByText('碳纖維車台護蓋');

  const input = screen.getByRole<HTMLInputElement>('textbox', { name: '數量' });
  // 🔴🔴 **派發【當下】的讀數 —— 這一格才分得開最後兩個世界。**
  //   `fireEvent.change` 做兩件事:①用原生 setter 寫 `input.value` ②派發 change 事件。
  //   而 RTL 的 fireEvent 外面包著 `act()` ⇒ **任何還沒 flush 的 state 更新會在它回來之前一起跑完**
  //   ⇒ 📌 「setter 根本沒寫進去」與「寫進去了、而同一個 act 裡的 re-render 把 `value={qtyText}`
  //      蓋回去」**在 fireEvent 回來之後印同一個 `"3"`**。
  //   ✅ 掛一個**捕獲階段**的原生 listener:它在派發途中跑, 在 React 的根 listener 之前
  //      ⇒ 它讀到的是 **setter 剛寫完** 的那個值。
  let atDispatch: string = MISSED;
  const spy = () => {
    atDispatch = input.value;
  };
  input.addEventListener('change', spy, true);
  fireEvent.change(input, { target: { value: '150' } });
  input.removeEventListener('change', spy, true);
  // 🔴 fireEvent 回來之後的讀數(既有那格印的就是這一種, 只是它印在 blur 之後)。
  const afterChange = input.value;
  const stillLive = screen.getByRole<HTMLInputElement>('textbox', { name: '數量' }) === input;
  const connected = document.body.contains(input);

  fireEvent.blur(input);
  const atBlur = input.value;
  const calls = updateQty.mock.calls.length;
  const arg = calls > 0 ? updateQty.mock.calls[0]?.[1] : undefined;
  return { atDispatch, afterChange, stillLive, connected, atBlur, calls, arg };
}

type Reading = Awaited<ReturnType<typeof oneRun>>;

/**
 * 指紋分類 —— 名字沿用 `CartQtyInput.tsx` 那張表, 不自創新詞。
 *
 * 🔴 **r3 的常數不能照抄舊表**(code-reviewer 2026-09-05 抓到):那張表寫的是
 *   `arg=1, input.value="150"`, 而它繼承自 `qty:1` + 舊碼 `else 1` 的時代。
 *   今天 fixture 是 `qty:3`、碼是「不是數字就什麼都不送」⇒ 真的 r3 會是 `arg=3`。
 *   ⇒ 📌 **一張沿用下來的指紋表, 它的常數綁著當時的 fixture 與當時的碼。**
 * ✅ 而 r3 與第四種**只差在 `afterChange`** —— 那正是本 harness 新加的那把尺:
 *   r3 ⇒ setter 寫進去了而沒有人蓋回來 ⇒ `"150"`;第四種 ⇒ 被 re-render 蓋回 ⇒ `"3"`。
 */
function fingerprint(r: Reading): string {
  // 🔴🔴 **量具檢查必須在【最前面】, 「正常」也不例外**(codex R1 must-fix + R2 must-fix,
  //   而 R2 抓到的正是我 R1 修完之後留下的順序):我第一版把它插在「正常」的**後面**
  //   ⇒ 節點被換掉 / 沒收到 change, 而結果**碰巧**是 99 的那幾發, 會被貼上「正常」。
  //   ⇒ 📌 **一道檢查放在快樂路徑後面, 等於宣告「結果對的時候我不檢查」** ——
  //      而那正是壞掉的量具最會產出的東西:一個看起來很正常的綠。
  if (r.atDispatch !== '150' || !r.stillLive || !r.connected) {
    return `尺沒接上 atDispatch=${JSON.stringify(r.atDispatch)} 同節點=${r.stillLive} 在文件裡=${r.connected}`;
  }
  if (r.calls === 1 && r.arg === 99 && r.atBlur === '99') return '正常';
  if (r.calls === 0 && r.atBlur === '') return 'r4(框是空的)';
  if (r.calls === 1 && r.arg === 3 && r.afterChange === '150') return 'r3(tracker 脫鉤, DOM 留著 150)';
  if (r.calls === 1 && r.arg === 3 && r.afterChange === '3') return '第四種(寫進去了而被蓋回 3)';
  return `未分類 calls=${r.calls} arg=${String(r.arg)} afterChange=${JSON.stringify(r.afterChange)} atBlur=${JSON.stringify(r.atBlur)}`;
}

// 🔴 **分類器的正對照 —— 這一格【不跳過】**(它 0ms, 而它答的是「這把尺分得出四個世界嗎」)。
//   ⚠️ 它證明的是**分類器**會動, **不是**那四個世界在真實跑動中造得出來。兩件事不要混。
describe('⟦02-CARTQTYFLAKE4⟧ 指紋分類器', () => {
  it('四個標籤各自撈得到, 而且互不相同', () => {
    const base = { atDispatch: '150', stillLive: true, connected: true };
    const labels = [
      fingerprint({ ...base, afterChange: '150', atBlur: '99', calls: 1, arg: 99 }),
      fingerprint({ ...base, afterChange: '150', atBlur: '150', calls: 1, arg: 3 }),
      fingerprint({ ...base, afterChange: '150', atBlur: '', calls: 0, arg: undefined }),
      fingerprint({ ...base, afterChange: '3', atBlur: '3', calls: 1, arg: 3 }),
    ];
    expect(labels).toEqual([
      '正常',
      'r3(tracker 脫鉤, DOM 留著 150)',
      'r4(框是空的)',
      '第四種(寫進去了而被蓋回 3)',
    ]);
    // 🔴 負對照兩發:①完全沒對上的讀數 ②**只差 `afterChange` 一格**的兩發不得被歸成同一類
    //   —— 第二發才是這把尺真正的判別力所在(r3 與第四種的其餘欄位一模一樣)。
    expect(fingerprint({ ...base, afterChange: '7', atBlur: '7', calls: 2, arg: 7 })).toMatch(/^未分類/);
    expect(fingerprint({ ...base, afterChange: '150', atBlur: '150', calls: 1, arg: 3 })).not.toBe(
      fingerprint({ ...base, afterChange: '3', atBlur: '3', calls: 1, arg: 3 }),
    );
    // 🔴 第三發:「尺沒接上」的三個世界都不得被貼成指紋標籤
    expect(fingerprint({ ...base, atDispatch: MISSED, afterChange: '3', atBlur: '3', calls: 1, arg: 3 })).toMatch(/^尺沒接上/);
    expect(fingerprint({ ...base, stillLive: false, afterChange: '3', atBlur: '3', calls: 1, arg: 3 })).toMatch(/^尺沒接上/);
    expect(fingerprint({ ...base, connected: false, afterChange: '3', atBlur: '3', calls: 1, arg: 3 })).toMatch(/^尺沒接上/);
    // 🔴 第四發(codex R2):**結果碰巧正常**而量具沒接上 ⇒ 仍然不得被貼成「正常」
    expect(fingerprint({ ...base, stillLive: false, afterChange: '150', atBlur: '99', calls: 1, arg: 99 })).toMatch(/^尺沒接上/);
  });
});

const ON = process.env.FLAKE_HARNESS === '1';
// 🔴 `FLAKE_N=0` / 非數字會讓迴圈跑 0 圈而整格【通過】(codex 2026-09-05 nit)——
//   一個跑了 0 發的 harness 印出來的綠, 與跑了 N 發都沒撞到印出來的綠**是同一個字**。
const N = Math.max(1, Math.trunc(Number(process.env.FLAKE_N ?? '200')) || 200);

describe.skipIf(!ON)('⟦02-CARTQTYFLAKE4⟧ 重現 harness', () => {
  it(`連跑 ${N} 發, 逐發記讀數`, { timeout: 600_000 }, async () => {
    const tally = new Map<string, number>();
    const oddities: string[] = [];
    let missedDispatch = 0;
    for (let i = 0; i < N; i += 1) {
      const r = await oneRun();
      if (r.atDispatch === MISSED) missedDispatch += 1;
      const fp = fingerprint(r);
      tally.set(fp, (tally.get(fp) ?? 0) + 1);
      if (fp !== '正常') {
        oddities.push(
          `第 ${i + 1} 發 · ${fp} · 派發當下 input.value=${JSON.stringify(r.atDispatch)}` +
            ` · change 正下一行=${JSON.stringify(r.afterChange)}` +
            ` · 還是同一顆節點=${r.stillLive} · 還在文件裡=${r.connected}` +
            ` · blur 後 input.value=${JSON.stringify(r.atBlur)}`,
        );
      }
      cleanup();
    }
    // 🔵 本檔的產物就是這份讀數表, 不是斷言(測試檔沒有 no-console 規則, 不需要 disable 指令)
    console.log(
      `\n══ ⟦02-CARTQTYFLAKE4⟧ ${N} 發 ══\n` +
        [...tally.entries()].map(([k, v]) => `  ${v} 發  ${k}`).join('\n') +
        (oddities.length > 0 ? `\n── 非正常那幾發 ──\n  ${oddities.join('\n  ')}` : '\n(這一輪沒撞到)'),
    );
    // 🔴 **本檔不斷言 flake 不存在** —— 它只斷言【量具自己有接上】。
    //   ⛔ ~~`總和 === N`~~:`tally` 每圈必 +1 ⇒ 那條恆真, 除了「oneRun 丟例外」之外零判別力,
    //      而丟例外本來就會紅(code-reviewer 2026-09-05 抓到)。
    //   ✅ 改成斷「**捕獲階段那個 listener 每一發都收到了 change**」—— 它掛在節點上,
    //      節點被換掉 / 事件沒派發 / 我把 listener 掛錯相位, 這三種世界它都會停在哨兵字串上。
    expect(missedDispatch, `有 ${missedDispatch} 發沒收到 change 事件 ⇒ 尺沒接上, 讀數不能用`).toBe(0);
  });
});
