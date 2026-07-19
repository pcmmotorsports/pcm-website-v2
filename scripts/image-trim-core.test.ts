// image-trim-core 單測 — 合成圖 fixture(sharp 自產、零網路)+ 純函式邊界。
// plan docs/specs/2026-07-19-product-image-trim-plan.md v1.1 §3。

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  analyzeImageBuffer,
  buildWorklist,
  classifyTrim,
  FAILED_RETRY_MS,
  nonOkRow,
} from './image-trim-core';
import { parseArgs, runPool } from './image-trim-scan';

async function whiteWithDarkRect(
  w: number,
  h: number,
  rect: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const dark = await sharp({
    create: { width: rect.width, height: rect.height, channels: 3, background: '#222222' },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: dark, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
}

describe('analyzeImageBuffer(合成圖)', () => {
  it('白底含深色矩形 → ok、bbox 貼近矩形位置比例', async () => {
    const buf = await whiteWithDarkRect(400, 300, { left: 40, top: 30, width: 200, height: 150 });
    const row = await analyzeImageBuffer('u1', buf);
    expect(row.status).toBe('ok');
    expect(row.natural_width).toBe(400);
    expect(row.natural_height).toBe(300);
    // 容差 ±1px 比例(trim threshold 邊界像素)
    expect(row.bbox_left!).toBeCloseTo(0.1, 1);
    expect(row.bbox_top!).toBeCloseTo(0.1, 1);
    expect(row.bbox_width!).toBeCloseTo(0.5, 1);
    expect(row.bbox_height!).toBeCloseTo(0.5, 1);
  });

  it('整張深色(無白邊)→ no_trim', async () => {
    const buf = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#101015' },
    })
      .png()
      .toBuffer();
    const row = await analyzeImageBuffer('u2', buf);
    expect(row.status).toBe('no_trim');
    expect(row.bbox_width).toBeNull();
  });

  it('整張全白(trim 會清空)→ no_trim、不 throw', async () => {
    const buf = await sharp({
      create: { width: 120, height: 120, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const row = await analyzeImageBuffer('u3', buf);
    expect(row.status).toBe('no_trim');
  });
});

describe('classifyTrim(純函式邊界)', () => {
  const base = {
    url: 'u',
    naturalWidth: 1000,
    naturalHeight: 800,
    trimmedWidth: 500,
    trimmedHeight: 400,
    offsetLeft: -100,
    offsetTop: -80,
  };

  it('負 offset 取絕對值(nit-2)', () => {
    const row = classifyTrim(base);
    expect(row.status).toBe('ok');
    expect(row.bbox_left).toBeCloseTo(0.1, 5);
    expect(row.bbox_top).toBeCloseTo(0.1, 5);
  });

  it('寬高皆 >0.97 → no_trim', () => {
    expect(
      classifyTrim({ ...base, trimmedWidth: 990, trimmedHeight: 790, offsetLeft: 0, offsetTop: 0 })
        .status,
    ).toBe('no_trim');
  });

  it('面積 <2% → failed', () => {
    expect(
      classifyTrim({ ...base, trimmedWidth: 100, trimmedHeight: 100 }).status,
    ).toBe('failed');
  });

  it('零/負維度與量測不自洽(l+w>1)→ failed', () => {
    expect(classifyTrim({ ...base, trimmedWidth: 0 }).status).toBe('failed');
    expect(classifyTrim({ ...base, naturalWidth: 0 }).status).toBe('failed');
    expect(classifyTrim({ ...base, offsetLeft: -600 }).status).toBe('failed');
  });

  it('nonOkRow bbox 全 NULL(對齊 DDL bbox_null_unless_ok)', () => {
    const row = nonOkRow('u', 'failed');
    expect(row.bbox_left).toBeNull();
    expect(row.natural_width).toBeNull();
  });
});

describe('buildWorklist(增量/重試/limit)', () => {
  const now = Date.parse('2026-07-19T00:00:00Z');
  const existing = [
    { url: 'a', status: 'ok' as const, analyzed_at: '2026-07-01T00:00:00Z' },
    { url: 'b', status: 'failed' as const, analyzed_at: '2026-07-01T00:00:00Z' },
    { url: 'c', status: 'failed' as const, analyzed_at: '2026-07-18T00:00:00Z' },
  ];

  it('沒掃過的收、ok 跳過、failed 過重試窗才收、新 failed 不收', () => {
    expect(buildWorklist(['a', 'b', 'c', 'd'], existing, { full: false, now })).toEqual(['b', 'd']);
    expect(now - Date.parse(existing[1]!.analyzed_at)).toBeGreaterThan(FAILED_RETRY_MS);
  });

  it('--full 全收;去重;空白 url 剔除;limit 截斷', () => {
    expect(buildWorklist(['a', 'a', ' ', 'd'], existing, { full: true, now })).toEqual(['a', 'd']);
    expect(buildWorklist(['x', 'y', 'z'], [], { full: false, now, limit: 2 })).toEqual(['x', 'y']);
  });
});

describe('runPool(假 worker、零網路)', () => {
  it('全部跑完、同 host 同時併發 ≤2、worker throw 不掛整池', async () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://h${i % 2}.example.com/${i}`);
    const done: string[] = [];
    const activePerHost = new Map<string, number>();
    let maxPerHost = 0;
    await runPool(urls, async (u) => {
      const host = new URL(u).host;
      const n = (activePerHost.get(host) ?? 0) + 1;
      activePerHost.set(host, n);
      maxPerHost = Math.max(maxPerHost, n);
      await new Promise((r) => setTimeout(r, 5));
      activePerHost.set(host, n - 1);
      if (u.endsWith('/3')) throw new Error('boom'); // 單項失敗不得掛池
      done.push(u);
    }).catch(() => {
      /* runPool 本身不應 reject;若 reject 讓斷言抓到 */
    });
    expect(done.length).toBe(11);
    expect(maxPerHost).toBeLessThanOrEqual(2);
  });
});

describe('parseArgs', () => {
  it('旗標解析與非法輸入', () => {
    expect(parseArgs(['--confirm-write', '--limit=800'])).toEqual({
      confirmWrite: true,
      full: false,
      limit: 800,
    });
    expect(parseArgs(['--full'])).toEqual({ confirmWrite: false, full: true });
    expect(() => parseArgs(['--limit=0'])).toThrow();
    expect(() => parseArgs(['--nope'])).toThrow();
  });
});
