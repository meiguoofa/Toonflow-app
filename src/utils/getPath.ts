import path from "path";
import isPathInside from "is-path-inside";

export default (fileName?: string[] | string) => {
  let basePath: string;
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    // 打包发布版用 userData/data（启动时 initializeData 会把资源 data 拷过去）；
    // 开发环境（未打包）直接用仓库 cwd/data（自带 skills/vendor 等完整数据），
    // 与 dev 的 web 路径策略（scripts/main.ts 用 cwd/data）保持一致。
    if (app.isPackaged) {
      basePath = path.join(app.getPath("userData"), "data");
    } else {
      basePath = path.join(process.cwd(), "data");
    }
  } else {
    basePath = path.join(process.cwd(), "data");
  }
  if (fileName) {
    let dbPath: string;
    if (Array.isArray(fileName)) {
      dbPath = path.resolve(basePath, ...fileName);
    } else {
      dbPath = path.resolve(basePath, fileName);
    }
    if (!isPathInside(dbPath, basePath) && dbPath !== basePath) {
      throw new Error("路径逃逸错误，路径必须在数据目录内");
    }
    return dbPath;
  }
  return basePath;
};

export function isEletron() {
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    return true;
  } else {
    return false;
  }
}
