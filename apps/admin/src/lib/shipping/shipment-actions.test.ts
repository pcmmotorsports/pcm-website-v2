// shipment-actions.test.ts — 建箱送出流程的守門(片 2b-2b-2)。
//
// 🔴 **主守兩件**:
//   ① **三支 RPC 共用同一把冪等鍵**,且**本檔不得自己產鍵**。
//      自己產 ⇒ 重試是新鍵 ⇒ 冪等層失效**而且零症狀**(連按兩次真的建兩個箱、兩次都成功)。
//   ② **失敗時要把已建出的箱號帶回去**。三支不在同一個交易裡,掛品項失敗時箱子已經存在
//      ⇒ 不告訴員工箱號的話,那個草稿箱就變成沒人知道的孤兒(而 DB 禁刪、只能作廢)。
//
// ⚠️ **它擋不住什麼**:全是 mock ⇒ 證不了 RPC 真的接受這些參數、也證不了冪等層真的認得同一把鍵。
//    真行為要收割端的 write smoke(建箱→作廢→回可選)。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const createShipment = vi.fn();
const addShipmentItems = vi.fn();
const markShipmentShipped = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./shipment-candidates', () => ({ loadShipmentCandidates: vi.fn() }));
const voidShipment = vi.fn();
const unvoidShipment = vi.fn();
vi.mock('./shipment-repository', () => ({
  createShipment,
  addShipmentItems,
  markShipmentShipped,
  voidShipment,
  unvoidShipment,
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
const ACTIONS = strip(readFileSync(resolve(HERE, 'shipment-actions.ts'), 'utf8'));
const BAR = strip(
  readFileSync(resolve(HERE, '../../components/orders/shipping-selection.tsx'), 'utf8'),
);

const base = {
  idempotencyKey: 'KEY-1',
  customerUserId: 'cu-1',
  recipient: { name: 'n', phone: 'p', line: 'l' },
  carrierCode: 'hct' as const,
  items: [{ orderItemId: 'oi-1', quantity: 2 }],
  markShipped: true,
  trackingNumber: 'T-1',
};

beforeEach(() => {
  createShipment.mockReset().mockResolvedValue({
    shipmentId: 'sh-1',
    shipmentReference: 'K7X2MP',
    customerUserId: 'cu-1',
    idempotent: false,
  });
  addShipmentItems.mockReset().mockResolvedValue({ idempotent: false });
  markShipmentShipped.mockReset().mockResolvedValue({ idempotent: false });
  voidShipment.mockReset().mockResolvedValue({ idempotent: false });
  unvoidShipment.mockReset().mockResolvedValue({ idempotent: false });
});

describe('🔴 冪等鍵 — 三支共用同一把,且本檔不得自己產', () => {
  it('三支 RPC 收到的是**同一把**鍵', async () => {
    const { submitShipment } = await import('./shipment-actions');
    await submitShipment(base);
    const keys = [
      createShipment.mock.calls[0]?.[0]?.idempotencyKey,
      addShipmentItems.mock.calls[0]?.[0]?.idempotencyKey,
      markShipmentShipped.mock.calls[0]?.[0]?.idempotencyKey,
    ];
    expect(new Set(keys).size, `三支收到不同的鍵:${JSON.stringify(keys)} ⇒ 重放對不起來`).toBe(1);
    expect(keys[0]).toBe('KEY-1');
  });

  it('🔴 action 檔內不得出現任何鍵產生器(產了就等於重試每次換新鍵、冪等層失效且零症狀)', () => {
    expect(
      ACTIONS,
      'shipment-actions.ts 自己產冪等鍵 ⇒ 使用者連按兩次會真的建出兩個箱子,而兩次都回報成功',
    ).not.toMatch(/randomUUID|uuidv4|Date\.now\(\)/);
  });

  it('🔴 鍵在**開窗**時生成一次(不是送出時)—— 生成點只有一個', () => {
    const hits = [...BAR.matchAll(/randomUUID\(\)/g)].length;
    expect(
      hits,
      `shipping-selection.tsx 裡 randomUUID() 出現 ${hits} 次,期望恰好 1(開窗那一處)。` +
        '出現在送出路徑上 = 每次重試換新鍵;完全不出現 = 沒有鍵可用。',
    ).toBe(1);
    // 生成點必須在 setOpen(開窗)那一段,不在 submit 相關的 callback 裡
    const at = BAR.indexOf('randomUUID()');
    expect(
      BAR.slice(Math.max(0, at - 200), at),
      'randomUUID() 不在 setOpen(…) 附近 ⇒ 可能被移到了送出路徑上',
    ).toMatch(/setOpen\(/);
  });
});

describe('🔴 半成品 — 失敗時要把已建出的箱號帶回去', () => {
  it('掛品項失敗 → ok:false,且帶回箱號(否則那個草稿箱變孤兒,而 DB 禁刪只能作廢)', async () => {
    addShipmentItems.mockRejectedValue(new Error('掛品項:同一份清單裡有 1 個品項重複了。'));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.shipmentReference, '失敗時沒帶回箱號 ⇒ 員工不知道要去作廢哪一箱').toBe('K7X2MP');
  });

  it('建箱本身就失敗 → 箱號為 null(還沒有東西被建出來)', async () => {
    createShipment.mockRejectedValue(new Error('建立包裹:找不到這位客人'));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(r.ok === false && r.shipmentReference).toBeNull();
  });

  it('🔴 錯誤訊息原樣帶出、不改寫(DB 的 RAISE 寫的就是給員工看的中文)', async () => {
    const msg = '出貨:包裹 K7X2MP 已經寄出了(可能是別人剛按過)。不需要再出一次。';
    markShipmentShipped.mockRejectedValue(new Error(msg));
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment(base);
    expect(
      r.ok === false && r.message,
      '訊息被改寫了 ⇒ 這裡等於另立一份文案表,DB 那邊改字時不會知道',
    ).toBe(msg);
  });
});

describe('只建箱 / 建箱並出貨', () => {
  it('markShipped=false → 不呼叫 markShipmentShipped', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const r = await submitShipment({ ...base, markShipped: false });
    expect(markShipmentShipped).not.toHaveBeenCalled();
    expect(r.ok === true && r.shipped).toBe(false);
  });

  it('可選參數未給時不送出該鍵(帶 DEFAULT 的參數送 undefined 是另一種形狀)', async () => {
    const { submitShipment } = await import('./shipment-actions');
    const { trackingNumber: _t, ...noTracking } = base;
    await submitShipment({ ...noTracking, carrierCode: 'other', carrierNote: '客人自取' });
    const createArgs = createShipment.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs.carrierNote).toBe('客人自取');
    const shipArgs = markShipmentShipped.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(shipArgs)).not.toContain('trackingNumber');
  });
});

describe('作廢 / 復原(片 2c)', () => {
  it('🔴 作廢按鈕的冪等鍵:失敗重按沿用同一把、成功後才清掉', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const src = readFileSync(
      resolve(HERE, '../../components/orders/shipment-void-button.tsx'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m: string) => m.replace(/[^\n]/g, ' '));
    // 生成點恰好 1 個,且必須是 `key ?? crypto.randomUUID()` 這種「沒有才生」的形狀 ——
    // 寫成無條件 `crypto.randomUUID()` = 每次重按換新鍵、冪等失效(連按兩次會作廢兩次)。
    expect([...src.matchAll(/randomUUID\(\)/g)].length, '鍵生成點不是恰好 1 個').toBe(1);
    expect(src, '不是「沒有才生」的形狀 ⇒ 每次重按都換新鍵').toMatch(/key\s*\?\?\s*crypto\.randomUUID\(\)/);
    expect(src, '成功後沒有把鍵清掉 ⇒ 下一次作廢別箱會沿用舊鍵').toMatch(/setKey\(null\)/);
  });

  it('作廢必須帶原因(RPC 的 p_void_reason 是必填)', async () => {
    const { voidShipmentAction } = await import('./shipment-actions');
    await voidShipmentAction({ idempotencyKey: 'K', shipmentId: 's', voidReason: '客人改地址' });
    expect(voidShipment).toHaveBeenCalledWith({
      idempotencyKey: 'K',
      shipmentId: 's',
      voidReason: '客人改地址',
    });
  });

  it('作廢失敗 → ok:false 帶原訊息(不改寫)', async () => {
    voidShipment.mockRejectedValue(new Error('作廢:包裹 K7X2MP 已經寄出了,不能作廢。'));
    const { voidShipmentAction } = await import('./shipment-actions');
    const r = await voidShipmentAction({ idempotencyKey: 'K', shipmentId: 's', voidReason: 'r' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.message).toContain('已經寄出');
  });
});
