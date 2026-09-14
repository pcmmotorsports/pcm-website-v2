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
});
