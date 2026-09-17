'use client';

import Link from 'next/link';
import { useState } from 'react';
import { splitHomeBannerTitle } from '@pcm/domain';
import {
  archiveHomeBannerAction,
  publishHomeBannerAction,
  saveHomeBannerDraftAction,
  duplicateHomeBannerAction,
} from '../../lib/home-banners/home-banner-actions';
import { HB_DB_MAX, HB_FIELD, HB_SOFT_MAX, HB_UPLOAD, publishKeepsLiveHint, titleLayoutHint } from '../../lib/home-banners/home-banner-constants';
import {
  BANNER_STATE_LABEL,
  formatBannerTime,
  gapUntil,
  isoToTaipeiLocal,
  taipeiLocalToIso,
  type BannerState,
  type HomeBannerKind,
  type HomeBannerRow,
  type HomeBannerTab,
} from '../../lib/home-banners/home-banner-view';

// home-banner-editor.tsx — 右側「編輯首頁大圖」面板(逐字搬 OD 稿 pcm-524f/admin-home-banners-v1.html 的 .panel)。
// client 只負責:預覽跟著打字動、字數計數、圖種切換、「有改動沒存」判斷、提示句。寫入全走 server action。
// 🔴 發布鈕在【有改動還沒存】時停用:DB 發布的是草稿存的那一版(帶預覽時的 updated_at),
//    沒存就按發布 ⇒ 上架的不是畫面上這一版。
// 🛑 鈕的停用不是安全邊界 —— 擋人的是 server action 的授權閘與 DB 自己那一道。
//    發布與下架都是【在職員工】(Sean 09-16 Q5 乙 + 主視窗「發得出去要收得回來」);發布另外要連結對、信件來的要配到商品。

type Draft = {
  eyebrow: string;
  title1: string;
  title2: string;
  subtitle: string;
  cta: string;
  link: string;
  imgDesktop: string;
  imgMobile: string;
  kind: HomeBannerKind;
  rights: boolean;
  rightsNote: string;
  starts: string;
  ends: string;
};

function toDraft(b: HomeBannerRow | null): Draft {
  return {
    eyebrow: b?.eyebrow ?? '',
    title1: b?.titleLine1 ?? '',
    title2: b?.titleLine2 ?? '',
    subtitle: b?.subtitle ?? '',
    cta: b?.ctaLabel ?? '',
    link: b?.linkPath ?? '',
    imgDesktop: b?.imageDesktopUrl ?? '',
    imgMobile: b?.imageMobileUrl ?? '',
    kind: b?.imageKind ?? 'scene',
    rights: b?.rightsConfirmed ?? false,
    rightsNote: b?.rightsNote ?? '',
    starts: b?.startsAt ? isoToTaipeiLocal(b.startsAt) : '',
    ends: b?.endsAt ? isoToTaipeiLocal(b.endsAt) : '',
  };
}

function Counter({ value, soft }: { value: string; soft: number }) {
  const n = [...value].length;
  return <span className={n > soft ? 'cnt over' : 'cnt'}>{n} / {soft}</span>;
}

export function HomeBannerEditor({
  banner,
  state,
  live,
  liveCount,
  closeHref,
  view,
  nowIso,
}: {
  banner: HomeBannerRow | null;
  state: BannerState | null;
  live: HomeBannerRow | null;
  /** 現在掛在首頁的張數。Sean 09-16 Q9 乙可以多張 ⇒ 只剩一張時,「首頁會空窗」那句提示才成立。 */
  liveCount: number;
  closeHref: string;
  view: HomeBannerTab;
  nowIso: string;
}) {
  const initial = toDraft(banner);
  const [d, setD] = useState<Draft>(initial);
  const [phone, setPhone] = useState(false);
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const text = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => set(k)(e.target.value as never);

  const isDraft = banner === null || banner.status === 'draft';
  const dirty = (Object.keys(initial) as (keyof Draft)[]).some((k) => initial[k] !== d[k]);
  // 🔵 首頁還有別張在播 ⇒ 這張早早下架也不會空窗 ⇒ 不提示(Sean 09-16 Q9 乙)
  const gap = isDraft && liveCount <= 1
    ? gapUntil(live, { id: banner?.id ?? null, startsAt: taipeiLocalToIso(d.starts), endsAt: taipeiLocalToIso(d.ends) }, new Date(nowIso))
    : null;

  // 🔴 Sean 09-16 Q5 乙:發布不再看管理者(所有在職員工都能按)⇒ 這裡不再判 canManage。
  //    Q6 乙:信件來的草稿要配到商品、連結要指到 /products;員工自己新增的不受這條管(見 20260916180000 檔頭)。
  const fromMail = banner !== null && banner.sourceEmailId !== null;
  const link = d.link.trim();
  const publishWhy =
    banner === null ? '先存草稿再發布'
    : dirty ? '有改動還沒存,先存草稿再發布'
    : !/^\/(products|brands)($|[?/])/.test(link) ? '連結要指到商品或品牌頁(/products… 或 /brands…)才能發布'
    : fromMail && banner.matchedVariantIds.length === 0 ? '這張還沒配到商品,配到商品才能發布'
    : fromMail && !/^\/products($|[?/])/.test(link) ? '連結要指到商品列表或商品頁(/products…)才能發布'
    : null;
  // 跟首頁同一條分層規則:第一行純英文(車款)+ 有第二行 ⇒ 第一行小字、第二行大標
  const title = splitHomeBannerTitle(d.title1, d.title2);
  const keepsLive = publishKeepsLiveHint(liveCount);
  const img = phone && d.imgMobile.trim() !== '' ? d.imgMobile : d.imgDesktop;

  return (
    <aside className='hb-panel' aria-label='編輯首頁大圖' data-testid='home-banner-panel'>
      <form action={saveHomeBannerDraftAction}>
        <input type='hidden' name={HB_FIELD.view} value={view} />
        {banner !== null ? <input type='hidden' name={HB_FIELD.id} value={banner.id} /> : null}
        {/* 🔴 原字串原樣送回(微秒);不要改成 new Date(...).toISOString() */}
        {banner !== null ? <input type='hidden' name={HB_FIELD.expected} value={banner.updatedAt} /> : null}

        <div className='hd'>
          <h3>{banner === null ? '新增首頁大圖' : '編輯首頁大圖'}</h3>
          <span className={`hb-cap ${state ?? 'draft'}`}>{BANNER_STATE_LABEL[state ?? 'draft']}</span>
          <Link href={closeHref} className='x' aria-label='關閉'>×</Link>
        </div>

        <div className='bd'>
          <div className='sec'>
            <h4>預覽</h4>
            <div className='pvtab'>
              <button type='button' className={phone ? '' : 'on'} onClick={() => setPhone(false)}>桌機</button>
              <button type='button' className={phone ? 'on' : ''} onClick={() => setPhone(true)}>手機</button>
            </div>
            <div className={`mini${phone ? ' phone' : ''}${d.kind === 'product' ? ' product' : ''}`}>
              {img.startsWith('https://') ? <img src={img} alt='' /> : null}
              <div className='tx'>
                {d.eyebrow ? <div className='eb'>{d.eyebrow}</div> : null}
                <div className='tt'>
                  {title.model ? <span className='md'>{title.model}</span> : null}
                  {title.main.filter((t) => t.trim() !== '').map((t, i) => <span key={i}>{i > 0 ? <br /> : null}{t}</span>)}
                </div>
                {d.subtitle ? <div className='sb'>{d.subtitle}</div> : null}
                {d.cta ? <span className='ct'>{d.cta} →</span> : null}
              </div>
            </div>
          </div>

          {/* 🔴 這一段是今天那個 bug 的本體:他不是找不到鈕, 是【不知道「不能改」是規則而不是壞掉】。
              ⇒ 先解釋為什麼, 再指路。順序反過來就只是一句藉口。 */}
          {!isDraft ? (
            <p className='locked' role='status' data-testid='home-banner-locked'>
              {/* 🔴 R1 N1:原本一律寫「已經發布過」—— 而**從草稿直接封存、從沒發布過**的那種列,
                  那句話是【假的】(封存鈕對草稿也在)。⇒ 依狀態講實話, 不要為了省一個分支而說錯。 */}
              {state === 'archived'
                ? <>這張已經封存,<strong>不能直接改</strong>。</>
                : <>這張已經發布,<strong>不能直接改</strong> —— 線上的內容要跟按發布的人看到的一樣。</>}
              要改請按下面的<strong>「複製一張來改」</strong>,舊的這張不會動。
            </p>
          ) : null}
          <fieldset disabled={!isDraft}>
            <div className='sec'>
              <div className='kind' role='radiogroup' aria-label='圖的類型'>
                圖的類型:
                <label className={d.kind === 'scene' ? 'on' : ''}>
                  <input type='radio' name={HB_FIELD.kind} value='scene' checked={d.kind === 'scene'} onChange={() => set('kind')('scene')} />
                  情境照(滿版)
                </label>
                <label className={d.kind === 'product' ? 'on' : ''}>
                  <input type='radio' name={HB_FIELD.kind} value='product' checked={d.kind === 'product'} onChange={() => set('kind')('product')} />
                  白底商品照(放展示台)
                </label>
              </div>
            </div>

            <div className='sec'>
              <h4>圖片</h4>
              <div className='grid2'>
                <label className='f'>桌機圖
                  <input name={HB_FIELD.imgDesktop} value={d.imgDesktop} onChange={text('imgDesktop')} maxLength={HB_DB_MAX.url} placeholder='https://…' />
                </label>
                <label className='f'>手機圖(空白 = 用桌機圖)
                  <input name={HB_FIELD.imgMobile} value={d.imgMobile} onChange={text('imgMobile')} maxLength={HB_DB_MAX.url} placeholder='選填' />
                </label>
              </div>
              {/* 片 C:選檔上傳。🔴 **只給桌機圖那一格**;手機圖仍然只收貼的網址 ——
                  兩格塞同一張不是省事, 是替員工做了一個他沒有做的決定(server 端同一條註解)。
                  ⚠️ `accept` 只是**檔案選擇器的過濾**, 擋不住人硬選別的 ⇒ 真正的擋在 server 端嗅探實際位元組。
                  🔵 沒選檔 ⇒ 這格不送任何東西 ⇒ 走上面那格貼的網址, 舊路一個字沒動。 */}
              <label className='f'>或直接選一張圖上傳(桌機圖)
                <input
                  type='file'
                  name={HB_FIELD.imgDesktopFile}
                  accept={HB_UPLOAD.types.join(',')}
                  data-testid='hb-upload-desktop'
                />
                <span className='hint'>
                  只收 JPG / PNG / WebP,最大 {Math.round(HB_UPLOAD.maxBytes / 1024 / 1024)} MB。
                  選了檔就用這張,上面那格貼的網址會被蓋掉。
                </span>
              </label>
            </div>

            <div className='sec'>
              <h4>文字</h4>
              <div className='grid2'>
                <label className='f full'>眉標
                  <input name={HB_FIELD.eyebrow} value={d.eyebrow} onChange={text('eyebrow')} maxLength={HB_DB_MAX.eyebrow} />
                </label>
                <label className='f'>標題第一行
                  <input name={HB_FIELD.title1} value={d.title1} onChange={text('title1')} maxLength={HB_DB_MAX.title} />
                  <Counter value={d.title1} soft={title.model ? HB_SOFT_MAX.model : HB_SOFT_MAX.title} />
                </label>
                <label className='f'>標題第二行
                  <input name={HB_FIELD.title2} value={d.title2} onChange={text('title2')} maxLength={HB_DB_MAX.title} />
                  <Counter value={d.title2} soft={HB_SOFT_MAX.title} />
                </label>
                {/* 🔴 2026-09-17:那兩格的名字叫「標題第一行 / 第二行」, 而它們【不一定都是標題】——
                    `splitHomeBannerTitle` 看第一行是不是純英數字來分。Sean 09-16 建的那張就踩到:
                    第一行填中文 ⇒ 「2026 Ninja ZX-10R」被當成中文大標印出來(pcm-banner T2 禁止)。
                    ⇒ 這句話由 `title.model` 算出來 ⇒ 與版型走同一條分支, 不會有「規則改了而說明還在講舊的」。 */}
                <div className='f full'><span className='hint'>{titleLayoutHint(title.model)}</span></div>
                <label className='f full'>副標(一行)
                  <input name={HB_FIELD.subtitle} value={d.subtitle} onChange={text('subtitle')} maxLength={HB_DB_MAX.subtitle} />
                  <Counter value={d.subtitle} soft={HB_SOFT_MAX.subtitle} />
                </label>
                <label className='f'>按鈕字
                  <input name={HB_FIELD.cta} value={d.cta} onChange={text('cta')} maxLength={HB_DB_MAX.cta} />
                  <Counter value={d.cta} soft={HB_SOFT_MAX.cta} />
                </label>
              </div>
            </div>

            <div className='sec'>
              <h4>連結</h4>
              <label className='f full'>站內路徑(例 /brands/akrapovic、/search?pbrands=akrapovic)
                <input name={HB_FIELD.link} value={d.link} onChange={text('link')} maxLength={HB_DB_MAX.link} placeholder='/…' />
              </label>
              {d.link ? <div className='path'><code>{d.link}</code></div> : null}
            </div>

            <div className='sec'>
              <h4>授權</h4>
              <div className='rights'>
                <label className='must'>
                  <input type='checkbox' name={HB_FIELD.rights} value='1' checked={d.rights} onChange={(e) => set('rights')(e.target.checked)} />
                  我確認這家廠商的圖與文字可以用(發布必勾)
                </label>
                <label className='f' style={{ marginTop: 6 }}>備註
                  <input name={HB_FIELD.rightsNote} value={d.rightsNote} onChange={text('rightsNote')} maxLength={HB_DB_MAX.rightsNote} placeholder='例如:9/15 業務 email 同意' />
                </label>
              </div>
            </div>

            <div className='sec'>
              <h4>上架時間</h4>
              <div className='grid2'>
                <label className='f'>上架(空白 = 按發布當下)
                  <input type='datetime-local' name={HB_FIELD.starts} value={d.starts} onChange={text('starts')} />
                </label>
                <label className='f'>下架(空白 = 14 天後)
                  <input type='datetime-local' name={HB_FIELD.ends} value={d.ends} onChange={text('ends')} />
                </label>
              </div>
              <div className='eta'>發布後約 1 分鐘內出現在首頁。</div>
            </div>
          </fieldset>
        </div>

        <div className='ft'>
          {gap !== null ? (
            <p className='gap' role='status' data-testid='home-banner-gap'>
              這張下架後到 {formatBannerTime(gap)} 之前首頁不會有新品大圖
            </p>
          ) : null}
          {/* 🔴 Sean 2026-09-17 Q3 甲:按發布那一刻要有一句提醒。
              理由是時機 —— 「舊的不會自動收掉」原本只出現在按【複製】那一步的結果條上,
              到按發布時早就被蓋掉了。📌 話說過了而時機不對, 與沒說一樣。
              🔵 只在 isDraft 畫:只有草稿按得到發布。張數與該不該印都在 publishKeepsLiveHint 裡判。 */}
          {isDraft && keepsLive !== null ? (
            <p className='gap' role='status' data-testid='home-banner-publish-keeps-live'>{keepsLive}</p>
          ) : null}
          {banner !== null && state !== 'archived' ? (
            <button type='submit' formAction={archiveHomeBannerAction} className='hb-btn hb-btn-d'>
              {state === 'draft' ? '封存' : '下架'}
            </button>
          ) : null}
          {/* 🔴 複製那顆(板 20260916250000)。三種狀態都給 —— 草稿也可以分岔兩版。
              新增中(banner === null)還沒有東西可以複製 ⇒ 那時不畫。 */}
          {banner !== null ? (
            <button type='submit' formAction={duplicateHomeBannerAction} className='hb-btn' data-testid='hb-duplicate'>
              複製一張來改
            </button>
          ) : null}
          <span className='sp' />
          {isDraft && publishWhy !== null ? <span className='why' data-testid='home-banner-publish-why'>{publishWhy}</span> : null}
          {isDraft ? <button type='submit' className='hb-btn'>存草稿</button> : null}
          {isDraft ? (
            <button type='submit' formAction={publishHomeBannerAction} className='hb-btn hb-btn-p' disabled={publishWhy !== null}>
              發布
            </button>
          ) : null}
        </div>
      </form>
    </aside>
  );
}
