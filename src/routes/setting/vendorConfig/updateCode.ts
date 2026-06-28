import express from "express";
import { error } from "@/lib/responseFormat";

const router = express.Router();

// Phase 2: 废弃。客户端不再持有 / 写入 vendor TS 代码。
// 如需修改供应商参数（apiKey/baseUrl 等），用 POST /api/vendor/update（通过 vendorConfig/agentSetKey 等路由）。
export default router.post("/", async (_req, res) => {
  res.status(410).send(
    error("vendor 代码更新接口已下线：phase 2 起客户端不再持有 vendor 代码，请通过模板 + 参数方式管理供应商。"),
  );
});
