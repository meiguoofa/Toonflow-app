import express from "express";
import { error } from "@/lib/responseFormat";

const router = express.Router();

// SaaS 化后该功能下线：DB 管理由云端后台统一处理
export default router.post("/", async (_req, res) => {
  res.status(410).send(error("该功能已迁移至云端管理后台"));
});
