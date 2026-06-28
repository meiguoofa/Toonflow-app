import express from "express";
import { success, error } from "@/lib/responseFormat";
import { peekToken } from "@/utils/auth";

const router = express.Router();
const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

// Phase 2: 转发后端 /api/vendor/templates，供前端"添加供应商"对话框渲染模板下拉 + inputs 表单。
// 前端 baseURL 是桌面端 10588，不直连后端 4000，故经此 BFF 转发。
export default router.post("/", async (_req, res) => {
  const token = peekToken();
  const r = await fetch(`${BACKEND_URL}/api/vendor/templates`, {
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
  res.status(200).send(success(json.data));
});
