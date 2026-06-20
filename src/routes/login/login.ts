import express from "express";
import { success, error } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { z } from "zod";
import { setCurrentToken } from "@/utils/auth";

const router = express.Router();

/**
 * 登录路由 —— SaaS 化后改为转发到云端后端。
 *
 * 原逻辑：本地查 o_user + 本地签 JWT（已迁移至 Toonflow-Backend Stream D）。
 * 现逻辑：转发 {name, password} 到 `${BACKEND_URL}/api/auth/login`，把 token 透传给前端 UI。
 *
 * 兼容性：
 * - 前端 UI 仍以 `username` 字段 POST 过来（与原协议一致），这里转换为后端约定的 `name` 字段
 * - 响应结构与原本一致：success({ token, name, id }, "登录成功")，前端 UI 无需改动
 * - 同时把 token 缓存到 utils/auth 模块，供 Stream B 的 db.ts 透传给云端后端时取用
 */

const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

export default router.post(
  "/",
  validateFields({
    username: z.string(),
    password: z.string(),
  }),
  async (req, res) => {
    const { username, password } = req.body;

    try {
      const upstream = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: username, password }),
      });
      const json: any = await upstream.json().catch(() => ({}));

      if (!upstream.ok || json?.code !== 0 || !json?.data?.token) {
        const msg = json?.message || "用户名或密码错误";
        return res.status(400).send(error(msg));
      }

      const token: string = json.data.token;
      const user = json.data.user || {};

      // 缓存到本地模块，供桌面端其它请求向云端后端透传
      setCurrentToken(token);

      // 保持与原响应结构兼容（token 前缀 "Bearer "，name / id 平铺）
      return res.status(200).send(
        success(
          { token: "Bearer " + token, name: user.name, id: user.id },
          "登录成功",
        ),
      );
    } catch (e: any) {
      console.error("[login] forward to backend failed:", e?.message || e);
      return res.status(502).send(error("登录服务不可用"));
    }
  },
);
