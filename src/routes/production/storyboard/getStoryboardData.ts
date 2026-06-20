import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

export default router.post(
  "/",
  validateFields({
    scriptId: z.number(),
    page: z.number(),
    limit: z.number(),
    name: z.string().optional().nullable(),
  }),
  async (req, res) => {
    const { scriptId, page, limit, name } = req.body;
    const offset = (page - 1) * limit;

    let dataQuery: any = u.db("o_storyboard").where({ scriptId });
    if (name) dataQuery = dataQuery.andWhere("title", "like", `%${name}%`);
    const storyboardData = await dataQuery.offset(offset).limit(limit);
    const data = await Promise.all(
      storyboardData.map(async (i: any) => {
        return {
          id: i.id,
          prompt: i.prompt,
          state: i.state,
          src: i.filePath ? await u.oss.getSmallImageUrl(i.filePath!) : "",
        };
      }),
    );
    let countQuery: any = u.db("o_storyboard").where({ scriptId });
    if (name) countQuery = countQuery.andWhere("title", "like", `%${name}%`);
    const totalQuery = (await countQuery.count("* as total").first()) as any;

    res.status(200).send(success({ data: data, total: totalQuery?.total }));
  },
);
