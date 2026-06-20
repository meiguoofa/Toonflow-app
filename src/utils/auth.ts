import u from "@/utils";

/**
 * Toonflow-app 端 token 工具。
 *
 * Stream D 实现。仅暴露给本工程内的 utils（如 Stream B 重写后的 utils/db.ts）使用。
 *
 * 现状（grep 结果）：
 * - Toonflow-app 后端 Express 没有 localStorage / electron-store 等持久化层；
 *   原 token 流向是「前端 UI 持有 → 每次请求随 Authorization header 带回来 → app.ts 中间件验签」
 * - 因此桌面端 Node 侧没有"我现在是哪个用户的 token"的概念
 * - SaaS 化后，桌面端 Node 侧本身要主动调云端后端（DB 代理 / TOS 签名），
 *   需要一份 token —— 来源优先级：
 *     1. process.env.TOONFLOW_TOKEN（CI / 自动化场景注入）
 *     2. 内存缓存：登录路由转发成功时由 setCurrentToken 写入
 *     3. 兜底：抛错（避免悄悄发匿名请求）
 *
 * 注意：本期**不**改动前端 UI 的 token 存储方式（前端继续用它原来的方式持有 token，
 * 走 Authorization header 调桌面端 Express）。这里只解决"桌面端 Node 侧自己要调后端"的问题。
 */

let cachedToken: string | null = null;

export function setCurrentToken(token: string): void {
  cachedToken = token;
}

export function clearCurrentToken(): void {
  cachedToken = null;
}

/**
 * 取当前 token，给 Stream B 的 utils/db.ts 调云端 /api/db/query 时使用。
 * 没拿到时抛错——主动暴露问题，比悄悄发匿名请求好。
 */
export function getCurrentToken(): string {
  if (process.env.TOONFLOW_TOKEN) return process.env.TOONFLOW_TOKEN;
  if (cachedToken) return cachedToken;
  throw new Error("[auth] no token available; please login first or set TOONFLOW_TOKEN");
}

/**
 * 透明验签层共用的 secret 来源。
 *
 * 必须与 Toonflow-Backend 的 JWT_SECRET 完全一致，详见 Toonflow-Backend/docs/auth-secret.md。
 *
 * 读取顺序：
 *   1. process.env.JWT_SECRET（推荐）
 *   2. 兜底：o_setting.tokenKey（迁移期与原始桌面端逻辑兼容）
 *   3. 都没有 → 返回 null，由 caller 决定如何 4xx
 */
export async function getSharedJwtSecret(): Promise<string | null> {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const setting = await u.db("o_setting").where("key", "tokenKey").select("value").first();
  if (setting?.value) return setting.value as string;
  return null;
}
