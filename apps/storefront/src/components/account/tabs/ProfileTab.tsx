// ProfileTab.tsx — 會員中心「個人資料」分頁(g-1a stub;g-4a 接 prop pass-through;g-4b form rewrite)
//
// g-4a:接 profile prop(name/phone/birthday、page.tsx 從 customers SoT 算好傳入)、但暫保持 stub markup。
// g-4b 才把 stub 換成真 form(form + 本地 state + submit updateProfileAction + 錯誤渲染 + design saved
// button 切換 + LINE 用戶 Email 欄空 input + 替代字面「LINE 帳號登入,無 Email」+ 8 條 acc-profile CSS)。
//
// g-4a 不在 ProfileTab 用 profile prop 的原因:UI 仍 stub、g-4b 才渲染 form;但 prop signature 提早
// 在 g-4a 對齊、避免 g-4b 同時改 prop signature + UI 增加風險。Sean 拍 Q1=B 拆 g-4a/g-4b SOP。
//
// eslint:profile prop 在 g-4a 未使用會被 lint 紅(unused vars),用 `_profile` 慣例標 unused、
// g-4b 改回 `profile` 並真用。
//
// 對應 backlog:無新條(g-4b 接續、本 stub 為 g-4 中間態、g-4b 完即退場)。
import type { AccountProfile } from '@/components/account/AccountView';

export type ProfileTabProps = {
  profile: AccountProfile;
};

export function ProfileTab({ profile: _profile }: ProfileTabProps) {
  return (
    <section className="acc-stub" data-tab="profile">
      <h2>個人資料</h2>
      <p>(本段於 g-4b 接入)</p>
    </section>
  );
}
