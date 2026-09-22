// url-writer.ts — :901 列表頁 / 商品頁**唯一的送網址出口**與落地處理。
//
// plan `docs/plans/2026-09-22-catalog-url-writer-plan.md` §3-1、§3-3、§3-4;行為依原型實測
//   (`~/pcm-mailbox/901-原型-20260922/實測結果-20260922.md`,Next 16.3.0,dev 與 production build)。
// 為什麼要有它:今天 10 多個地方各自讀 `window.location` 再 `router.replace`,
//   導航還沒落地時讀到的是舊網址 ⇒ 把舊車款抄回去(客人連點時車款跳回上一台)。
//
// 三種「網址」(§3-1):
//   最新目標 = 自己送出、還沒結束的最後一發(沒有就是 `window.location`)⇒ 所有寫入者組網址的底。
//   網址列   = `window.location`;replace 會預寫成最新目標(push 不預寫,實測預寫會讓上一筆紀錄留著舊畫面)。
//   已落地   = `useSearchParams` / `usePathname`;伺服器內容對應的網址。
// 🔴 本設計依賴 Next 16.3.0 的實測行為,升級 Next 要重跑原型 runner.js(plan §8-5)。
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { applyVehicleIntent, getVehicleIntent } from '@/lib/vehicle-intent';

export type RouterLike = {
  replace: (href: string, opts?: { scroll?: boolean }) => void;
  push: (href: string, opts?: { scroll?: boolean }) => void;
  refresh: () => void;
};

/** 已落地網址從哪裡來:外部導航(頁首連結、別處的網址)或瀏覽器上一頁 / 下一頁。 */
export type LandingSource = 'external' | 'history';
/** 頁面元件登記:外部導航或上一頁落地時,依網址改車款意圖與篩選狀態(需要車款字典,所以由頁面提供)。 */
export type LandingHandler = (params: URLSearchParams, source: LandingSource) => void;

type Sent = { href: string; external: boolean };

// ── 模組層狀態(跨元件卸載保留;實測 6)──
let sent: Sent[] = [];
let lastLanded: string | null = null;
let startNav: ((f: () => void) => void) | null = null;
let landingHandler: LandingHandler | null = null;

const hasWindow = () => typeof window !== 'undefined';
const hrefOf = (path: string, params: URLSearchParams) => {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
};
/**
 * 站內網址正規化成 `pathname?search`,search 一律經 `URLSearchParams` 重新編碼(去掉 hash、origin)。
 * 🔴 `yamaha:mt-07` 與 `yamaha%3Amt-07` 是同一個網址;不正規化就會被當成不同 ⇒ 多送一發導航、清單比對不到。
 * 與 `useSearchParams().toString()` 的編碼一致。
 */
function normalize(href: string): string {
  const u = new URL(href, window.location.href);
  return hrefOf(u.pathname, u.searchParams);
}
const currentHref = () => normalize(window.location.href);

function latestTargetHref(): string {
  return sent.length ? sent[sent.length - 1]!.href : currentHref();
}

/** 最新目標的參數(給需要先讀再決定的寫入者)。伺服器端回空的。 */
export function latestTarget(): URLSearchParams {
  if (!hasWindow()) return new URLSearchParams();
  return new URL(latestTargetHref(), window.location.href).searchParams;
}

function run(go: () => void) {
  if (startNav) startNav(go);
  else go();
}

/**
 * 唯一的送網址出口(§3-3):以最新目標為底 ⇒ 呼叫端只改自己的參數 ⇒ 車款一律由意圖覆寫 ⇒
 * 與最新目標相同就不送。replace 先預寫網址列(保留 Next 的 history.state,`useSearchParams` 不變);push 不預寫。
 */
export function writeSearch(
  router: RouterLike,
  edit: (p: URLSearchParams) => void,
  opts: { method?: 'replace' | 'push'; scroll?: boolean } = {},
): void {
  if (!hasWindow()) return;
  const base = new URL(latestTargetHref(), window.location.href);
  const params = new URLSearchParams(base.search);
  edit(params);
  applyVehicleIntent(params, getVehicleIntent());
  const next = hrefOf(base.pathname, params);
  if (next === latestTargetHref()) return;
  sent.push({ href: next, external: false });
  const method = opts.method ?? 'replace';
  const scroll = opts.scroll ?? false;
  if (method === 'replace') window.history.replaceState(window.history.state, '', next);
  run(() => (method === 'push' ? router.push(next, { scroll }) : router.replace(next, { scroll })));
}

/**
 * 同頁連結(`CatalogLink`)點下去當下登記目的網址,之後的操作以它為底(第三輪實測 S5)。
 * 🔴 只由那些連結自己的 onClick 呼叫;分頁連結不登記(它自己 preventDefault 改走頁碼,R3 必修 1)。
 */
export function registerLinkTarget(href: string): void {
  if (!hasWindow()) return;
  sent.push({ href: normalize(href), external: true });
}

/**
 * 站內導航由程式發起、目的網址是一整串新網址(`navigateToCatalog`、搜尋面板):加到清單尾端再 push。
 * `external: true` = 目的網址的車款不是意圖(落地後才依網址或意圖補寫);帶車款的呼叫端要先自己改意圖再傳 false。
 */
export function pushNavigation(router: RouterLike, href: string, opts: { external: boolean; scroll?: boolean }): void {
  if (!hasWindow()) {
    router.push(href);
    return;
  }
  const target = normalize(href);
  sent.push({ href: target, external: opts.external });
  run(() => (opts.scroll === undefined ? router.push(target) : router.push(target, { scroll: opts.scroll })));
}

/** 頁面元件登記落地處理;回傳解除登記。 */
export function setLandingHandler(handler: LandingHandler): () => void {
  landingHandler = handler;
  return () => {
    if (landingHandler === handler) landingHandler = null;
  };
}

/** 外部導航落地:先交給頁面改意圖 / 篩選,再把意圖的車款補寫回網址(網址沒車款而意圖有 ⇒ 補;一致 ⇒ 不送)。 */
function handleExternalLanding(router: RouterLike, landed: string) {
  const params = new URL(landed, window.location.href).searchParams;
  landingHandler?.(params, 'external');
  writeSearch(router, () => {});
}

/** 落地分類(§3-4 表前四列)。抽出來給單元測試直接驗。 */
export function processLanding(router: RouterLike, landedRaw: string): void {
  const landed = normalize(landedRaw);
  if (landed === lastLanded) return; // 卸載再掛載:同一個已落地不重做(實測 6)
  lastLanded = landed;
  const idx = sent.findIndex((s) => s.href === landed);
  if (idx >= 0) {
    const hit = sent[idx]!;
    sent.splice(0, idx + 1);
    if (hit.external) {
      handleExternalLanding(router, landed);
      return;
    }
    // 自己送的較早一發落地:Next 會把網址列改回那一發 ⇒ 還有沒落地的就寫回最新目標
    if (sent.length > 0 && currentHref() !== latestTargetHref()) {
      window.history.replaceState(window.history.state, '', latestTargetHref());
    }
    return;
  }
  // 不在清單裡:沒被攔到的外部導航(或第一次載入、換路徑)⇒ 清單作廢
  sent = [];
  handleExternalLanding(router, landed);
}

/** 導航完成(`isPending` true ⇒ false):這批全部結束或被丟棄 ⇒ 清單清空,網址列對齊已落地(實測 S12)。 */
export function processNavigationIdle(landedRaw: string): void {
  const landed = normalize(landedRaw);
  sent = [];
  if (currentHref() !== landed) window.history.replaceState(window.history.state, '', landed);
}

/** 上一頁 / 下一頁(§3-4):一律以歷史網址為準、一律重新載入;不看字串是否與前一筆相同(R3 必修 2)。 */
export function processPopState(router: RouterLike): void {
  sent = [];
  lastLanded = currentHref();
  landingHandler?.(new URLSearchParams(window.location.search), 'history');
  router.refresh();
}

/**
 * 掛在 `app/products/(catalog)/layout.tsx` 與 `app/products/[slug]/layout.tsx`(不跟著頁面元件卸載):
 * 提供 startTransition、落地分類、導航完成、上一頁處理。
 * effect 順序:子元件(頁面)的 effect 先跑 ⇒ 頁面先登記 `setLandingHandler`,這裡才分類。
 */
export function useUrlWriter(): void {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qs = sp.toString();
  const landed = qs ? `${pathname}?${qs}` : pathname;
  const [isPending, startTransition] = useTransition();
  const wasPending = useRef(false);

  useEffect(() => {
    startNav = (f) => startTransition(f);
    return () => {
      startNav = null;
    };
  }, [startTransition]);

  useEffect(() => {
    const onPop = () => processPopState(router);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [router]);

  // 先落地分類、再看導航完成(§3-4「處理順序」)
  useEffect(() => {
    processLanding(router, landed);
    if (isPending) {
      wasPending.current = true;
      return;
    }
    if (!wasPending.current) return;
    wasPending.current = false;
    processNavigationIdle(landed);
  }, [router, landed, isPending]);
}

/** 只給測試用:清掉模組層狀態(模擬重新整理)。 */
export function resetUrlWriterForTests(): void {
  sent = [];
  lastLanded = null;
  startNav = null;
  landingHandler = null;
}

/** 只給測試用:目前清單。 */
export function sentForTests(): readonly Sent[] {
  return sent;
}
