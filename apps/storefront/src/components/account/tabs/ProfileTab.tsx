'use client';

// ProfileTab.tsx — 會員中心「個人資料」分頁(g-1a stub → g-4a 接 prop → g-4b 真 form session-write → g-4c router.refresh)
//
// 字面從 design-reference/components/AccountPages.jsx profile tab(L662-671)直接搬(鐵則 1、不翻譯):
// - .acc-section + .acc-section-head h2「個人資料」殼(沿用 OrdersTab/FavoritesTab pattern + design L663-664)
// - .acc-profile grid:姓名 / Email / 手機 / 生日 4 欄(label > span + input)+ auth-submit 按鈕(L666-670)
// - Email input disabled(design L667)、生日 input type="date"(design L669)
// - 按鈕字面 profileSaved ? '✓ 已儲存' : '儲存變更'(design L670)、saveProfile 後 1800ms 復原(design L419-420)
//
// storefront 技術實作 adaptation(鐵則 1 例外類別 2、非視覺偏離):
// - design L417 saveProfile 寫 localStorage mock → updateProfileAction server action(五層信任邊界、g-4a)
// - controlled form + useState + useTransition(React 19、isPending disable 按鈕防重複送)
//
// #181 雙通道(沿用 register/login pattern、Sean Q2=B 釘死):
// - fieldErrors 逐欄(.auth-field-err 顯各 input 下方;ProfileInput 僅 name min(1) 會回 fieldErrors.name)
// - formError 帳號層級(.auth-err 表單頂部;請重新登入 / 儲存失敗);兩通道並存、互不取代
//
// LINE Email 替代字面(Q2-1=b net-new business override):
// - email prop = page.tsx 已過濾 LINE 合成 email 後的 displayEmail('' = LINE 用戶);LINE 用戶 Email 欄
//   value 空 + placeholder「LINE 帳號登入,無 Email」、disabled 不可編輯(design 無此分支、net-new)
//
// g-4c(g-4b 肉眼驗 UX 修、Sean 拍 A):存檔成功後 router.refresh() 重跑 page.tsx server component
// 重讀 customers SoT → 解「存檔後切 tab 回來 / 頂部 Hi 名字 + 頭像仍舊值、需手動重新整理」staleness
// (根因:useState(profile.name) 只在 mount 取一次 prop、page.tsx 只在整頁載入讀 DB、存檔沒通知頁面重讀)。
//
// 對應 backlog:無新條;#196(setTimeout 無 unmount cleanup、Nit)本 slice 保留不 fold(honor 別硬擴 scope、
// router.refresh 不卸載當前 tab、與 #196 正交、#196 仍 🟢 觀察 極低優先)。

import { useState, useTransition } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { updateProfileAction, type ProfileFieldErrors } from '@/app/account/profile/actions';
import type { AccountProfile } from '@/components/account/AccountView';

export type ProfileTabProps = {
  profile: AccountProfile;
  // displayEmail(page.tsx 已過濾 LINE 合成 email):'' = LINE 用戶(無真 Email)、走替代字面 placeholder
  email: string;
};

export function ProfileTab({ profile, email }: ProfileTabProps) {
  const router = useRouter();
  // 本地 form state(初值來自 profile prop、page.tsx 從 customers SoT 算好;phone/birthday null 已 → '')
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [birthday, setBirthday] = useState(profile.birthday);
  // #181 雙通道:fieldErrors 逐欄 / formError 帳號層級;互不取代。
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // Q3=A:成功後按鈕切「✓ 已儲存」、1800ms 後復原(對齊 design saveProfile setTimeout L419-420)。
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  // LINE 用戶(displayEmail 空)Email 欄走替代字面 + 不可編輯(Q2-1=b business override)。
  const isLineUser = email === '';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      // 信任邊界在 server(updateProfileAction 五層、g-4a);client 不重驗、收 server 逐欄回傳渲染。
      const result = await updateProfileAction({ name, phone, birthday });
      if (result.fieldErrors) {
        setFieldErrors(result.fieldErrors);
        setFormError(null);
        setSaved(false);
      } else if (result.formError) {
        setFormError(result.formError);
        setFieldErrors({});
        setSaved(false);
      } else if (result.ok) {
        setFieldErrors({});
        setFormError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
        // g-4c:重跑 page.tsx server component 重讀 customers SoT。新 profile prop 流到 AccountView
        // → 頂部「Hi, 名字」/ 頭像即時更新;下次切回 profile tab 時 ProfileTab 重 mount 讀到新 prop
        // (解 g-4b 肉眼驗發現的「存檔後切 tab 回來/頂部仍舊值、需手動重新整理」staleness、根因同一頁載入快照)。
        // router.refresh() 保留 client state(Next 官方保證)、「✓ 已儲存」態不閃。
        router.refresh();
      }
    });
  };

  return (
    <div className="acc-section" data-tab="profile">
      <div className="acc-section-head">
        <h2>個人資料</h2>
      </div>
      <form onSubmit={submit}>
        {/* 頂部:帳號層級錯(請重新登入 / 儲存失敗 = formError);逐欄錯顯各欄下方(#181 雙通道) */}
        {formError && <div className="auth-err">{formError}</div>}
        <div className="acc-profile">
          <label>
            <span>姓名</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            {fieldErrors.name && <span className="auth-field-err">{fieldErrors.name}</span>}
          </label>
          <label>
            <span>Email</span>
            <input
              value={email}
              disabled
              placeholder={isLineUser ? 'LINE 帳號登入,無 Email' : undefined}
            />
          </label>
          <label>
            <span>手機</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
            {fieldErrors.phone && <span className="auth-field-err">{fieldErrors.phone}</span>}
          </label>
          <label>
            <span>生日</span>
            <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
            {fieldErrors.birthday && <span className="auth-field-err">{fieldErrors.birthday}</span>}
          </label>
          <button type="submit" className="auth-submit" disabled={isPending}>
            {saved ? '✓ 已儲存' : '儲存變更'}
          </button>
        </div>
      </form>
    </div>
  );
}
