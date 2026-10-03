import { describe, expect, it, vi } from 'vitest';
import { singleFlightStale } from './single-flight-stale';

function setup() {
  let t = 0;
  let calls = 0;
  let fail = false;
  const load = async () => {
    calls += 1;
    await Promise.resolve();
    if (fail) throw new Error('simulated RPC failure');
    return { v: calls };
  };
  const get = singleFlightStale(load, 1000, 'test', () => t);
  return {
    get,
    calls: () => calls,
    advance: (ms: number) => {
      t += ms;
    },
    setFail: (f: boolean) => {
      fail = f;
    },
  };
}

describe('singleFlightStale', () => {
  it('① 同時 10 發 ⇒ load 只呼叫 1 次, 10 發拿到同一份', async () => {
    const s = setup();
    const out = await Promise.all(Array.from({ length: 10 }, () => s.get()));
    expect(s.calls()).toBe(1);
    expect(new Set(out).size).toBe(1);
  });

  it('② 記憶體值未過 ttl ⇒ 0 次 load;過了 ⇒ 重建', async () => {
    const s = setup();
    await s.get();
    s.advance(999);
    await s.get();
    expect(s.calls()).toBe(1);
    s.advance(1);
    await s.get();
    expect(s.calls()).toBe(2);
  });

  it('③ 重建失敗而上一份未超過 2×ttl ⇒ 回舊值', async () => {
    const s = setup();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await s.get();
    s.advance(1500);
    s.setFail(true);
    await expect(s.get()).resolves.toBe(first);
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('④ 舊值超過 2×ttl ⇒ 不回, 照樣 throw', async () => {
    const s = setup();
    await s.get();
    s.advance(2000);
    s.setFail(true);
    await expect(s.get()).rejects.toThrow('simulated RPC failure');
  });

  it('🔵 負對照:從來沒成功過 ⇒ 失敗照樣 throw;失敗後下一發會再試', async () => {
    const s = setup();
    s.setFail(true);
    await expect(s.get()).rejects.toThrow();
    s.setFail(false);
    await expect(s.get()).resolves.toEqual({ v: 2 });
  });

  // 2026-10-04 健檢:包在 unstable_cache 的讀取函式【裡面】用時, ttl 要是 0(每次背景更新都真的去讀),
  // 而舊值能沿用多久要另外指定 —— 預設的 2×ttl 在 ttl=0 時等於不沿用。
  it('⑤ 另外指定 staleForMs:ttl 0 ⇒ 每發都重抓;失敗時舊值在 staleForMs 內照回, 超過就 throw', async () => {
    let t = 0;
    let calls = 0;
    let fail = false;
    const get = singleFlightStale(
      async () => {
        calls += 1;
        if (fail) throw new Error('simulated timeout');
        return { v: calls };
      },
      0,
      'test',
      () => t,
      600_000,
    );
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await get();
    t += 1;
    await get();
    expect(calls, 'ttl 0 ⇒ 第二發也要真的去讀').toBe(2);
    fail = true;
    t += 599_000;
    await expect(get(), '失敗、舊值未超過 staleForMs ⇒ 回上一份').resolves.toEqual({ v: 2 });
    t += 2_000;
    await expect(get(), '舊值超過 staleForMs ⇒ 照樣 throw').rejects.toThrow('simulated timeout');
    errSpy.mockRestore();
  });
});
