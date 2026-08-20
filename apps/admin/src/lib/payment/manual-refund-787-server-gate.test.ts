import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// manual-refund-787-server-gate.test.ts — 釘 manual-refund-actions.ts:57-61 那道 server 端
// #787 硬閘(2026-08-20 深夜補,Sean 拍板「乙:先補一道閘再全推」)。
//
// 🔴 為什麼需要它(W3 對抗審查 must-fix,不是順手加的):`refund-wiring.test.tsx` 的
//    #787 那組測試量的是**畫面入口不渲染**(`manual-refund-entry-gate.ts` 那道閘),
//    跟這道 server 端閘是兩個不同的檔案、兩個不同的判斷點——那組測試綠,不代表這道閘存在。
//    在這份測試補上之前,把 manual-refund-actions.ts:57-61 那 4 行整段刪掉,**沒有任何一格
//    會變紅**——那正是這一整晚在記的那個形狀(旗標關得住畫面、關不住 server action)。
//
// 🔴🔴 兩個陷阱(W3 對抗審查、動手前先講出來的,不是事後才抓):
//   陷阱B:`denied` 有兩個出口(:54 授權失敗 / :60 #787 閘),回一模一樣的東西——
//     若 mock 沒把 authorizeAdminMutation 假裝成「有授權」,測試①在 :54 就回 denied,
//     那 4 行一次都沒執行,測試照樣綠。⇒ beforeEach 固定給有效授權,逼流程走到 :60。
//   陷阱A:負對照只斷「不是denied」是恆綠——出口不只兩種(:54/:60 denied、:73 invalid、
//     :117 rejected、成功),餵一份空表單一樣會落到 :73 invalid,invalid !== denied 一樣過,
//     卻證不出這道閘真的被讀了。⇒ 負對照必須斷【正面落點】:餵一份形狀合法的表單、
//     讓它真的走到 repository,斷言 repository 被呼叫到 + 收到的結果碼具體是什麼。
//
// 🔴 誠實邊界(W3 指出檔頭要講清楚,不然讀者會誤會這支檔案守到了什麼):本檔把整個
//    `manual-refund-entry-gate.ts` 模組 mock 掉,證的是【action 有讀那顆旗標、且旗標值真的
//    決定了分岔】,不是【那顆旗標現在的值是 true】。後者的證人是同目錄的
//    `manual-refund-787-trigger.test.ts`(它盯著旗標本身有沒有被翻掉)。兩支測試各守一半,
//    缺一不可——本檔測不出旗標被人手動改成 false,那支測不出這道 server 閘被刪掉。

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  recordManualRefund: vi.fn(),
  /** 🔴 mock 的是 manual-refund-entry-gate.ts 這個模組,不是碰正式碼裡的常數本身——
   *  正式碼那顆常數本來就該恆 true 直到 #787 解除,不該被測試檔改動(見該檔檔頭)。 */
  entryGateBlocked: true,
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('./manual-refund-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-refund-repository')>();
  return { ...actual, recordManualRefund: mocks.recordManualRefund };
});
vi.mock('../../components/orders/manual-refund-entry-gate', () => ({
  get MANUAL_REFUND_ENTRY_BLOCKED_BY_787() {
    return mocks.entryGateBlocked;
  },
}));

import { recordManualRefundAction } from './manual-refund-actions';
import type { ManualRefundActionState } from './manual-refund-action-state';
import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
} from './manual-refund-action-state';

const IDLE: ManualRefundActionState = { status: 'idle', requestToken: 'tok-idle' };
const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const REQUEST_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** 形狀合法的表單——用意是確保它能走過 `parseManualRefundForm`,一路推進到 repository 那一步。 */
function validForm(): FormData {
  const data = new FormData();
  data.set(MANUAL_REFUND_ORDER_ID_FIELD, ORDER_ID);
  data.set(MANUAL_REFUND_REQUEST_TOKEN_FIELD, REQUEST_TOKEN);
  data.set(MANUAL_REFUND_RAIL_FIELD, 'cash');
  data.set(MANUAL_REFUND_AMOUNT_FIELD, '500');
  data.set(MANUAL_REFUND_REASON_FIELD, '測試用表單,不對應真實退款');
  data.set(MANUAL_REFUND_OCCURRED_AT_FIELD, '2026-08-20T10:00');
  return data;
}

beforeEach(() => {
  // 陷阱B的解法:固定給有效授權,逼流程一定會走到 :60 的 #787 閘,不會提早在 :54 攔下。
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-test');
  // 業務性拒絕(不是denied),讓「正面落點」的結果碼具體、可斷言,同時不觸發成功路徑的
  // redirect()(那是另一件事,不屬於這道閘的驗證範圍)。
  mocks.recordManualRefund.mockResolvedValue({
    ok: false,
    code: 'rejected',
    sqlstate: 'P0001',
    logMessage: 'test-only rejection',
    staffMessage: 'test-only rejection',
  });
  mocks.entryGateBlocked = true;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('#787 server 端硬閘(manual-refund-actions.ts:57-61)', () => {
  it('世界①(現況):旗標=true ⇒ 即使已授權、表單合法,回 denied、repository 完全沒被呼叫', async () => {
    const state = await recordManualRefundAction(IDLE, validForm());
    expect(state).toMatchObject({ status: 'failed', code: 'denied' });
    expect(mocks.recordManualRefund).not.toHaveBeenCalled();
  });

  it('🔴 世界②(負對照,斷正面落點):旗標=false ⇒ 真的走到 repository,拿到具體的非denied結果', async () => {
    mocks.entryGateBlocked = false;
    const state = await recordManualRefundAction(IDLE, validForm());
    // 正面落點①:repository 真的被呼叫到,且收到的是我們餵的訂單/表單資料。
    expect(mocks.recordManualRefund).toHaveBeenCalledTimes(1);
    expect(mocks.recordManualRefund).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, requestId: REQUEST_TOKEN }),
    );
    // 正面落點②:結果碼是 repository 回的那個具體碼('rejected'),不是空泛的「不是denied」。
    expect(state).toMatchObject({ status: 'failed', code: 'rejected' });
  });
});
