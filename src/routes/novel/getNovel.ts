import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

// 获取原文数据
export default router.post(
  "/",
  validateFields({
    projectId: z.number(),
    page: z.number(),
    limit: z.number(),
    search: z.string().optional(),
  }),
  async (req, res) => {
    const { projectId, page, limit, search } = req.body;
    const offset = (page - 1) * limit;
    let dataQuery = u
      .db("o_novel")
      .where("projectId", projectId)
      .select("id", "chapterIndex as index", "reel", "chapter", "chapterData", "event", "eventState", "errorReason");
    if (search) dataQuery = dataQuery.where("chapter", "like", `%${search}%`);
    const data = await dataQuery.orderBy("chapterIndex", "asc").limit(limit).offset(offset);

    // 统计总数
    let countQuery = u.db("o_novel").where("projectId", projectId);
    if (search) countQuery = countQuery.where("chapter", "like", `%${search}%`);
    const totalQuery = (await countQuery.count("* as total").first()) as any;

    res.status(200).send(success({ data, total: totalQuery.total }));
  },
);
