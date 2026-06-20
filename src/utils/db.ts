import type { DB } from "@/types/database";
import type { Knex } from "knex";
import { peekToken } from "@/utils/auth";

// =============================================================================
// HTTP 代理：把 Knex 链式调用序列化成 JSON，POST 给后端回放。
// 协议契约：Toonflow-Backend/docs/db-proxy-protocol.md
//
// 使用方代码（80+ 处 db("xx").where(...).select() 等）零改动。
// 原桌面端的 SQLite 初始化（initDB / fixDB / initKnexType）已迁移到后端 migrations。
// =============================================================================

type TableName = keyof DB & string;
type RowType<TName extends TableName> = DB[TName];

const BACKEND_URL = process.env.TOONFLOW_BACKEND_URL || "http://localhost:4000";

// ---- token 来源 -------------------------------------------------------------
// 统一从 utils/auth 取（登录路由 setCurrentToken 写入 / 环境变量 TOONFLOW_TOKEN）。

// ---- 终结方法 ---------------------------------------------------------------
// 与协议文档保持一致；select 不在此集合里——它会被特殊处理：作为 calls 末尾的中间方法，
// 在 await 触发 .then 时把它"提升"为 terminal。
const TERMINAL_METHODS = new Set<string>([
  "first", "find", "count", "countDistinct", "min", "max", "sum", "avg",
  "insert", "update", "del", "delete", "truncate",
  "pluck",
]);

interface Call {
  method: string;
  args: any[];
}

// ---- HTTP 调用 --------------------------------------------------------------
async function executeQuery(
  table: string,
  calls: Call[],
  terminal?: { method: string; args: any[] },
): Promise<any> {
  // await db("xx").select(...) 时 .then 触发执行：把末尾的 select 提为 terminal
  if (!terminal && calls.length > 0 && calls[calls.length - 1].method === "select") {
    const last = calls[calls.length - 1];
    terminal = { method: "select", args: last.args };
    calls = calls.slice(0, -1);
  }
  if (!terminal) {
    throw new Error("[db proxy] query has no terminal method");
  }

  const token = peekToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  // 全局 fetch（Electron renderer 与 Node 18+ 主进程都内置）
  const res = await fetch(`${BACKEND_URL}/api/db/query`, {
    method: "POST",
    headers,
    body: JSON.stringify({ table, calls, terminal }),
  });
  let json: any;
  try {
    json = await res.json();
  } catch (e: any) {
    throw new Error(`[db proxy] invalid JSON response (status ${res.status})`);
  }
  if (!json || typeof json !== "object") {
    throw new Error(`[db proxy] malformed response`);
  }
  if (json.code !== 0) {
    throw new Error(`[db proxy ${json.code}] ${json.message}`);
  }
  return json.data;
}

// ---- 链式 Proxy 构造 --------------------------------------------------------
// 使用 function 作为 target，使得 Proxy 对 then 的拦截能让 await 工作。
function createQueryBuilder(table: string, calls: Call[]): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string | symbol) {
      if (typeof prop === "symbol") {
        // Symbol.toPrimitive / Symbol.iterator 等：返回 undefined 让默认行为生效
        return undefined;
      }
      // await 时 JS 会读 .then —— 触发请求执行
      if (prop === "then") {
        return (resolve: (v: any) => void, reject: (e: any) => void) => {
          executeQuery(table, calls).then(resolve, reject);
        };
      }
      // 终结方法：返回函数，调用时立即触发请求
      if (TERMINAL_METHODS.has(prop)) {
        return (...args: any[]) => executeQuery(table, calls, { method: prop, args });
      }
      // 其它：视为中间方法，记录进 calls，返回新 proxy
      return (...args: any[]) =>
        createQueryBuilder(table, [...calls, { method: prop, args }]);
    },
    apply() {
      throw new Error("[db proxy] query builder is not directly callable");
    },
  });
}

// ---- 入口 ------------------------------------------------------------------
// 类型策略（保持"零改动"语义，避免 noImplicitAny 回归）：
//   - 调用 db("xx") 的返回类型披上一个"足够 Knex 风格"的链式 builder 外衣
//     这样使用方在 .where((qb) => ...) / .map((i) => ...) 等场景下仍能拿到类型推断
//   - DbProxy 自身允许任意属性访问（兼容 db.raw / db.schema / 直接传给 initDB(knex) 等
//     少量遗留用法）—— 这些代理在运行时不支持，会抛错；类型留口仅为避免大规模回归
// 报告中已列出非常规调用点，由主 Agent 决定是否替换桌面端代码。

type DbProxy = {
  <TName extends TableName>(
    table: TName,
  ): Knex.QueryBuilder<RowType<TName>, RowType<TName>[]>;
  // 兼容遗留代码中传 string / 别名（如 "o_event as e"）/ 不在 schema 内的表名
  // —— 运行时这些会被后端白名单拒绝（4002/4003），类型留口仅为避免大规模回归
  (table: string): Knex.QueryBuilder<any, any[]>;
} & Knex & {
  [k: string]: any;
};

const dbClient: DbProxy = ((table: string) =>
  createQueryBuilder(table, [])) as DbProxy;

export default dbClient;
export { dbClient as db };
