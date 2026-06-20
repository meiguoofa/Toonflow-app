import express from "express";
import u from "@/utils";
import { z } from "zod";
import { success } from "@/lib/responseFormat";
import { validateFields } from "@/middleware/middleware";
const router = express.Router();

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

    const novelRows: { id: number; chapterIndex: number }[] = await u
      .db("o_novel")
      .where("projectId", projectId)
      .select("id", "chapterIndex");
    if (novelRows.length === 0) {
      return res.status(200).send(success({ list: [], total: 0 }));
    }
    const novelIds = novelRows.map((r) => r.id);
    const novelChapterMap = new Map(novelRows.map((r) => [r.id, r.chapterIndex]));

    let eventIdFilter: number[] | null = null;
    if (search) {
      const searched: { id: number }[] = await u.db("o_event").where("name", "like", `%${search}%`).select("id");
      eventIdFilter = searched.map((r) => r.id);
      if (eventIdFilter.length === 0) {
        return res.status(200).send(success({ list: [], total: 0 }));
      }
    }

    let ecQuery: any = u.db("o_eventChapter").whereIn("novelId", novelIds);
    if (eventIdFilter) ecQuery = ecQuery.whereIn("eventId", eventIdFilter);
    const ec: { eventId: number; novelId: number }[] = await ecQuery.orderBy("eventId").select("eventId", "novelId");

    const eventToNovelIds = new Map<number, number[]>();
    for (const { eventId, novelId } of ec) {
      const arr = eventToNovelIds.get(eventId);
      if (arr) arr.push(novelId);
      else eventToNovelIds.set(eventId, [novelId]);
    }

    const total = eventToNovelIds.size;
    const allEventIds = Array.from(eventToNovelIds.keys());
    const pageEventIds = allEventIds.slice(offset, offset + limit);
    if (pageEventIds.length === 0) {
      return res.status(200).send(success({ list: [], total }));
    }

    const events: { id: number; name: string; detail: string; createTime: number }[] = await u
      .db("o_event")
      .whereIn("id", pageEventIds)
      .select("id", "name", "detail", "createTime");
    const eventMap = new Map(events.map((e) => [e.id, e]));

    const list = pageEventIds
      .map((id) => {
        const e = eventMap.get(id);
        if (!e) return null;
        const chapters = (eventToNovelIds.get(id) || [])
          .map((nid) => novelChapterMap.get(nid))
          .filter((x): x is number => x !== undefined);
        return {
          id: e.id,
          eventName: e.name,
          detail: e.detail,
          createTime: e.createTime,
          chapters,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    res.status(200).send(success({ list, total }));
  },
);
