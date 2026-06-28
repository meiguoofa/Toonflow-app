import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { peekToken } from "@/utils/auth";
import { z } from "zod";

const router = express.Router();
const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

// Phase 2: 契约变更
//   旧：接收完整 vendor TS 代码（tsCode），在客户端 sandbox 验 schema 后写本地文件 +
//       插入 o_vendorConfig。phase 1 后这套代码不再被实际执行，等同死功能。
//   新：用户选模板（如 openai-compatible）+ 填参数（apiKey/baseUrl/models），转发后端
//       POST /api/vendor/create。
//
// 旧客户端 UI 在 phase 2 前端 UI 改造完成前仍可能上传 tsCode；此时返回 410 明确告知。
export default router.post(
  "/",
  validateFields({
    template: z.string().optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    inputValues: z.record(z.string(), z.string()).optional(),
    models: z.array(z.any()).optional(),
    tsCode: z.string().optional(),
  }),
  async (req, res) => {
    const { template, id, name, inputValues, models, tsCode } = req.body;

    if (tsCode && !template) {
      return res.status(410).send(
        error("此接口已迁移：客户端不再支持上传 vendor 代码。请通过模板（如 openai-compatible）+ 参数添加供应商。"),
      );
    }
    if (!template || !id) {
      return res.status(400).send(error("template 和 id 必填"));
    }

    const token = peekToken();
    const r = await fetch(`${BACKEND_URL}/api/vendor/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ template, id, name, inputValues: inputValues ?? {}, models: models ?? [] }),
    });
    let json: any;
    try {
      json = await r.json();
    } catch {
      return res.status(502).send(error("vendor 服务返回非 JSON"));
    }
    if (!json || json.code !== 0) {
      return res.status(r.status || 502).send(error(json?.message ?? "vendor 创建失败"));
    }
    res.status(200).send(success(json.data));
  },
);
