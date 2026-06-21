import u from "@/utils";

/**
 * 登录后自愈：重置上次遗留的「进行中」状态。
 *
 * 背景：桌面端的提取/生成任务是内存里的异步任务（路由先返回、后台 fire-and-forget 执行）。
 * 进程重启或中断后这些内存任务会丢失，但云端 DB 的状态会停留在「进行中」，
 * 导致前端永久 loading（如「资产提取中」）。
 *
 * SaaS 化前由 lib/fixDB.ts 在每次启动时矫正；SaaS 化移除该启动副作用后丢失，故在此恢复。
 * 调用时机：登录成功（已 setCurrentToken）后。此时桌面端刚启动、无任何活跃任务，
 * 且 db proxy 会按 userId 过滤，只重置当前用户遗留的状态，安全。
 *
 * 字段/值与原 fixDB.ts 的状态矫正段保持一致。
 */
export async function recoverStuckStates(): Promise<void> {
  const reason = "上次任务被中断（软件重启），请重试";
  await u.db("o_novel").where("eventState", 0).update({ eventState: -1, errorReason: reason });
  await u.db("o_script").where("extractState", 0).update({ extractState: -1, errorReason: reason });
  await u.db("o_assets").where("promptState", "生成中").update({ promptState: "生成失败", promptErrorReason: reason });
  await u.db("o_image").where("state", "生成中").update({ state: "生成失败", errorReason: reason });
  await u.db("o_storyboard").where("state", "生成中").update({ state: "生成失败", reason });
  await u.db("o_video").where("state", "生成中").update({ state: "生成失败", errorReason: reason });
}
