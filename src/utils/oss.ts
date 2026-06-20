import path from "node:path";
import { isEletron } from "@/utils/getPath";

// =============================================================================
// TOS 适配版 OSS 客户端。
//
// 与原本地实现保持完全相同的公共 API（getFileUrl / writeFile / getFile /
// getImageBase64 / deleteFile / deleteDirectory / fileExists / getSmallImageUrl），
// 让上游 80+ 处调用零改动。
//
// 核心策略：
//   - writeFile  →  POST /api/tos/sign?op=put → fetch PUT TOS
//   - getFileUrl →  POST /api/tos/sign?op=get（带 60s 内存缓存）
//   - getFile / getImageBase64 → 通过 GET URL 拉取
//   - deleteFile / deleteDirectory → POST /api/tos/sign?op=delete|deletePrefix
//
// prefix 兼容：
//   - 默认 prefix=oss   → 走 TOS（key 直接是 normalized path）
//   - prefix=skills/assets → 仍走桌面端本地静态服务（应用内置资源，未上 TOS）
//
// key 规范：保持现有 `{projectId}/assets/{uuid}.ext` 等结构，去掉前导 `/`。
// 详见 Toonflow-Backend/docs/tos-migration.md。
// =============================================================================

const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

// ---- token：复用 db.ts 同源约定 ---------------------------------------------
let _runtimeToken: string | null = null;
export function setToken(token: string | null) {
  _runtimeToken = token;
}
function getStoredToken(): string {
  return _runtimeToken || process.env.TOONFLOW_TOKEN || "";
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(extra || {}) };
  const token = getStoredToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

// ---- key 规范化（去前导 /，统一 posix 分隔符） ------------------------------
function toKey(userPath: string): string {
  if (!userPath) return "";
  return userPath.replace(/^[/\\]+/, "").split(path.sep).join("/").split("\\").join("/");
}

// ---- 后端签名调用 ----------------------------------------------------------
async function callSign(body: Record<string, any>): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/api/tos/sign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new Error(`[oss] invalid JSON from /api/tos/sign (status ${res.status})`);
  }
  if (!json || json.code !== 0) {
    throw new Error(`[oss] /api/tos/sign failed: ${json?.code} ${json?.message}`);
  }
  return json.data;
}

// ---- GET URL 60s 内存缓存 ---------------------------------------------------
const SIGN_TTL = 60 * 1000;
const getUrlCache = new Map<string, { url: string; expireAt: number }>();

async function signedGet(key: string): Promise<string> {
  const now = Date.now();
  const hit = getUrlCache.get(key);
  if (hit && hit.expireAt > now) return hit.url;
  const data = await callSign({ op: "get", key, expires: 3600 });
  // 比签名实际时长短一点缓存，避免边界过期
  getUrlCache.set(key, { url: data.url, expireAt: now + SIGN_TTL });
  return data.url;
}

// 简陋 mime 推断（仅用于 PUT contentType）
const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
function guessContentType(p: string): string | undefined {
  const ext = path.extname(p).toLowerCase();
  return EXT_MIME[ext];
}

class OSS {
  /**
   * 获取指定相对路径文件的访问 URL。
   *
   * 默认 prefix=oss → TOS 签名 GET URL。
   * prefix=skills/assets → 仍指向桌面端本地静态目录（应用内置资源）。
   */
  async getFileUrl(userRelPath: string, prefix?: string): Promise<string> {
    if (prefix && prefix !== "oss") {
      // 非 TOS 内容（应用内置 skills/assets），保留原本地静态地址逻辑
      const key = toKey(userRelPath);
      let base = `/${prefix}/`;
      if (process.env.ossURL && process.env.ossURL !== "") base = process.env.ossURL + `/${prefix}/`;
      if (process.env.NODE_ENV == "dev") base = `http://localhost:10588/${prefix}/`;
      if (isEletron()) base = `http://localhost:${process.env.PORT}/${prefix}/`;
      return `${base}${key}`;
    }
    return signedGet(toKey(userRelPath));
  }

  /** 读取 TOS 对象为 Buffer。 */
  async getFile(userRelPath: string): Promise<Buffer> {
    const url = await signedGet(toKey(userRelPath));
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[oss] getFile failed: ${res.status} ${userRelPath}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  /** 读取图片为 base64 Data URL。 */
  async getImageBase64(userRelPath: string): Promise<string> {
    const ext = path.extname(userRelPath).toLowerCase();
    const mimeType = EXT_MIME[ext];
    if (!mimeType) {
      throw new Error(`不支持的图片格式: ${ext}。支持的格式: ${Object.keys(EXT_MIME).join(", ")}`);
    }
    const buf = await this.getFile(userRelPath);
    return `data:${mimeType};base64,${buf.toString("base64")}`;
  }

  /** 删除单个对象。 */
  async deleteFile(userRelPath: string): Promise<void> {
    const key = toKey(userRelPath);
    if (!key) return;
    await callSign({ op: "delete", key });
    getUrlCache.delete(key);
  }

  /** 删除指定 prefix 下的全部对象（兼容原本地 deleteDirectory 语义）。 */
  async deleteDirectory(userRelPath: string): Promise<void> {
    let prefix = toKey(userRelPath);
    if (!prefix) throw new Error("[oss] deleteDirectory: empty prefix");
    if (!prefix.endsWith("/")) prefix += "/";
    await callSign({ op: "deletePrefix", key: prefix });
    // 清掉相关缓存
    for (const k of getUrlCache.keys()) {
      if (k.startsWith(prefix)) getUrlCache.delete(k);
    }
  }

  /**
   * 写入文件。
   * data 为 string 时按 base64 解码（兼容原 base64 Data URL）。
   */
  async writeFile(userRelPath: string, data: Buffer | string): Promise<void> {
    const key = toKey(userRelPath);
    if (!key) throw new Error("[oss] writeFile: empty key");
    const buffer =
      typeof data === "string"
        ? Buffer.from(data.replace(/^data:[^;]+;base64,/, ""), "base64")
        : data;
    const contentType = guessContentType(userRelPath);
    const signed = await callSign({ op: "put", key, contentType, expires: 3600 });
    const headers: Record<string, string> = {};
    if (contentType) headers["Content-Type"] = contentType;
    const res = await fetch(signed.url, {
      method: "PUT",
      headers,
      // 把 Buffer 转成 ArrayBuffer 视图，符合 fetch 的 BodyInit 类型
      body: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`[oss] PUT TOS failed: ${res.status} ${text}`);
    }
    // 失效缓存（写入后下次 getFileUrl 拿到新签名）
    getUrlCache.delete(key);
  }

  /** 文件是否存在。通过 HEAD GET-URL 探测。 */
  async fileExists(userRelPath: string): Promise<boolean> {
    try {
      const url = await signedGet(toKey(userRelPath));
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * 缩略图 URL。
   *
   * 原本地实现通过 `?size=20` 让 /oss 路由生成缩略图。TOS 不做服务端缩略图；
   * 这里直接返回签名 GET URL。前端需要时由 UI 自行处理（保持 API 兼容）。
   */
  async getSmallImageUrl(userRelPath: string): Promise<string> {
    return this.getFileUrl(userRelPath);
  }
}

export default new OSS();
