import express from "express";
import { success, error } from "@/lib/responseFormat";
import { peekToken } from "@/utils/auth";

const router = express.Router();
const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

// Phase 2: 转发到后端 /api/vendor/list。客户端不再读本地 vendor 代码 / 跑 vm 沙箱。
// 后端返回字段：{id, name, description, author, version, icon, inputs, inputValues, template,
// protocol, enable, models, isBuiltin}。前端 UI 字段需求与旧版基本一致，缺 code（已废弃）
// 这里补空字符串避免旧 UI 渲染时崩溃。
export default router.post("/", async (_req, res) => {
  const token = peekToken();
  const r = await fetch(`${BACKEND_URL}/api/vendor/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: "{}",
  });
  let json: any;
  try {
    json = await r.json();
  } catch {
    return res.status(502).send(error("vendor 服务返回非 JSON"));
  }
  if (!json || json.code !== 0) {
    return res.status(r.status || 502).send(error(json?.message ?? "vendor 服务调用失败"));
  }
  const list = (Array.isArray(json.data) ? json.data : []).map((v: any) => ({ ...v, code: "" }));
  res.status(200).send(success(list));
});
