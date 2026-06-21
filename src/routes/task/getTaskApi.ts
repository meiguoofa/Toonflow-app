import express from "express";
import u from "@/utils";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
import { number, z } from "zod";
const router = express.Router();
export default router.post(
  "/",
  validateFields({
    state: z.string().optional().nullable(),
    taskClass: z.string().optional().nullable(),
    projectId: z.number().optional().nullable(),
    page: z.number(),
    limit: z.number(),
  }),
  async (req, res) => {
    const { taskClass, state, projectId, page = 1, limit = 10 }: any = req.body;
    const offset = (page - 1) * limit;
    let dataQuery = u
      .db("o_tasks")
      .leftJoin("o_project", "o_project.id", "o_tasks.projectId");
    if (taskClass) dataQuery = dataQuery.andWhere("o_tasks.taskClass", taskClass);
    if (state) dataQuery = dataQuery.andWhere("o_tasks.state", state);
    if (projectId) dataQuery = dataQuery.andWhere("o_tasks.projectId", projectId);
    const data = await dataQuery
      .select("o_tasks.*", "o_project.*")
      .offset(offset)
      .limit(limit)
      .orderBy("o_tasks.id", "desc");
    let countQuery = u.db("o_tasks");
    if (taskClass) countQuery = countQuery.andWhere("o_tasks.taskClass", taskClass);
    if (projectId) countQuery = countQuery.andWhere("o_tasks.projectId", projectId);
    if (state) countQuery = countQuery.andWhere("o_tasks.state", state);
    const totalQuery = (await countQuery.count("* as total").first()) as any;
    res.status(200).send(success({ data, total: totalQuery?.total }));
  },
);
