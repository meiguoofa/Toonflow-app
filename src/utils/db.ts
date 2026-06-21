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
// 与协议文档保持一致；select 不在此集合里——它会被特殊处理：作为 calls 中的中间方法，
// 在 await 触发 .then 时把它"提升"为 terminal（见 executeQuery）。
// first 与聚合方法（count/min/...）也单独处理：见 createQueryBuilder。
const TERMINAL_METHODS = new Set<string>([
  "find", "insert", "update", "del", "delete", "truncate",
  "pluck",
]);

// 聚合方法：在 Knex 中可继续 .first() 取首行，也可直接 await 取数组。
// 故惰性记录为"待定 terminal"，由后续 .first() / await 决定如何取值。
const AGGREGATE_METHODS = new Set<string>([
  "count", "countDistinct", "min", "max", "sum", "avg",
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
  // await db("xx")...（无显式终结方法）时 .then 触发执行：等价于一次 select 查询。
  // select 在 Knex 链中可出现在任意位置（其后可再跟 where/offset/limit/orderBy 等），
  // 故把链中所有 select 的列参数抽出合并为 terminal，其余调用保留为中间方法；
  // 链中完全没有 select 时按 `select *`（空参）处理。后端协议允许 select 作为终结方法。
  if (!terminal) {
    const selectArgs: any[] = [];
    const rest: Call[] = [];
    for (const c of calls) {
      if (c.method === "select") selectArgs.push(...c.args);
      else rest.push(c);
    }
    terminal = { method: "select", args: selectArgs };
    calls = rest;
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
// pendingTerminal：聚合方法（count 等）惰性记录的待定 terminal，等 .first() / await 决定取值方式。
function createQueryBuilder(
  table: string,
  calls: Call[],
  pendingTerminal?: { method: string; args: any[] },
): any {
  const target: any = function () {};
  return new Proxy(target, {
    get(_t, prop: string | symbol) {
      if (typeof prop === "symbol") {
        // Symbol.toPrimitive / Symbol.iterator 等：返回 undefined 让默认行为生效
        return undefined;
      }
      // await 时 JS 会读 .then —— 触发请求执行（pendingTerminal 存在则按聚合直接返回数组）
      if (prop === "then") {
        return (resolve: (v: any) => void, reject: (e: any) => void) => {
          executeQuery(table, calls, pendingTerminal).then(resolve, reject);
        };
      }
      // 聚合方法：惰性记录为待定 terminal，可继续 .first() 取首行，或直接 await 取数组
      if (AGGREGATE_METHODS.has(prop)) {
        return (...args: any[]) =>
          createQueryBuilder(table, calls, { method: prop, args });
      }
      // .first()：若前面是聚合（如 count().first()），执行聚合并取首行；否则作为普通 first 终结
      if (prop === "first") {
        return (...args: any[]) => {
          if (pendingTerminal) {
            return executeQuery(table, calls, pendingTerminal).then(
              (r: any) => (Array.isArray(r) ? r[0] ?? null : r),
            );
          }
          return executeQuery(table, calls, { method: "first", args });
        };
      }
      // 其它终结方法：返回函数，调用时立即触发请求
      if (TERMINAL_METHODS.has(prop)) {
        return (...args: any[]) => executeQuery(table, calls, { method: prop, args });
      }
      // 其它：视为中间方法，记录进 calls，返回新 proxy
      return (...args: any[]) =>
        createQueryBuilder(table, [...calls, { method: prop, args }], pendingTerminal);
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
