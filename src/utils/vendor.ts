// Phase 2: vendor 元数据全部走后端 HTTP，不再读本地 vendor 代码 / 不再跑 vm 沙箱
//
// 旧行为：从 data/vendor/{id}.ts 或 src/lib/vendor.json 读 vendor 代码，sucrase + vm
// 跑出 vendor.models / vendor.name 等元信息，再合并 o_vendorConfig.models。
// 新行为：HTTP 调后端 /api/vendor/{models|info}。getCode / writeCode 已废弃（前端不再
// 持有 vendor 业务代码）。

import { peekToken } from "@/utils/auth";

const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

async function vendorApi<T>(path: string, body: any): Promise<T> {
  const token = peekToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}/api/vendor/${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`[vendor api] invalid JSON response (status ${res.status})`);
  }
  if (!json || typeof json !== "object") {
    throw new Error(`[vendor api] malformed response`);
  }
  if (json.code !== 0) {
    throw new Error(`[vendor api ${json.code}] ${json.message ?? "request failed"}`);
  }
  return json.data as T;
}

// ---- 对外 API（保持与旧版相同签名，便于上游零改动） -------------------------

export async function getModelList(id: string): Promise<Array<any>> {
  return vendorApi<any[]>("models", { vendorId: id });
}

/**
 * 注意：phase 2 起 getVendor 改为 async。原同步调用点（如 `u.vendor.getVendor(id).name`）
 * 必须改为 `(await u.vendor.getVendor(id)).name`。
 */
export async function getVendor(id: string): Promise<any> {
  return vendorApi<any>("info", { vendorId: id });
}

/**
 * 废弃：phase 2 起客户端不再持有 vendor 代码。保留同步签名是为了让旧调用点（如 getVendorList.ts
 * 的 `code: u.vendor.getCode(item.id!)`）能编译通过——返回空字符串。新前端 UI 应通过
 * /api/vendor/info 拿到模板信息再渲染，不再展示 TS 代码编辑器。
 */
export function getCode(_id: string): string {
  console.warn("[vendor] getCode is deprecated; client no longer holds vendor TS code");
  return "";
}

/**
 * 废弃：phase 2 起客户端不允许直接写 vendor 代码。Settings → 添加供应商现在通过
 * /api/vendor/create 走"模板 + 参数"路径。保留 noop 是为了让历史调用点不崩。
 */
export function writeCode(_id: string | number, _tsCode: string): void {
  console.warn("[vendor] writeCode is deprecated; use POST /api/vendor/create with a template");
}
