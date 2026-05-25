// lib/auth/constants.ts — 會員認證共用常數(M-1-14e-f1-a)
//
// POST_AUTH_REDIRECT:登入 / 註冊直登 / OAuth callback 成功後統一導向(plan v4 §4 [D]、三處共用)。
// /account(會員中心 7 tab)留 stage g;屆時改此一常數即可(one-line、backlog #179 會員態條件路由)。

export const POST_AUTH_REDIRECT = '/';
