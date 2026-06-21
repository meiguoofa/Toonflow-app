# 客户端构建与发布指南

Toonflow 桌面客户端（Electron）打包成 Windows / Mac / Linux 安装包的流程。推荐用 **GitHub Actions CI** 出包（macOS 安装包必须在 macOS 上构建，CI 已配好对应 runner）。

构建产物：
- Windows：`ToonFlow-*-win-<arch>-setup.exe`（NSIS 安装程序）
- macOS：`ToonFlow-*-mac-<arch>.dmg`
- Linux：`ToonFlow-*-linux-<arch>.AppImage`

---

## 一、配置后端地址与共享密钥（必做）

客户端在**构建期**把后端地址和 JWT 密钥烧进安装包（由 `scripts/build.ts` 通过 esbuild `define` 注入）。两个值：

| 变量 | 含义 | 取值 |
|------|------|------|
| `TOONFLOW_BACKEND_URL` | 生产后端地址 | `http://<服务器IP>:4000` |
| `JWT_SECRET` | 与后端共享的 JWT 密钥 | **必须**与服务器 `Toonflow-Backend/.env` 中的 `JWT_SECRET` 完全一致 |

> ⚠️ `JWT_SECRET` 不一致会导致客户端验签失败、登录态不通。它由部署后端时生成（`openssl rand -hex 32`），构建客户端时复用同一个值。
>
> 安全说明：该密钥会被打进安装包，理论上可被提取。内部工具可接受；如需更高安全性应改用按用户下发密钥的方案。

### 在 GitHub 仓库配置（CI 构建用）
仓库 **Settings → Secrets and variables → Actions**：
- **Variables** 标签：新增 `TOONFLOW_BACKEND_URL` = `http://<服务器IP>:4000`
- **Secrets** 标签：新增 `JWT_SECRET` = 与后端一致的密钥

CI 的 `release.yml` 已在三平台构建步骤注入这两个值。

---

## 二、CI 发布流程（推荐）

```bash
# 打 tag 并推送，触发 .github/workflows/release.yml
git tag v1.1.9
git push origin v1.1.9
```

CI 会并行构建 Windows(x64/arm64) + macOS(intel/arm) + Linux(x64/arm64)，全部完成后自动创建 GitHub Release 并附带所有安装包。

- 手动触发：Actions 页面选 “Build and Release” → Run workflow。
- 产物位置：对应 tag 的 GitHub Release 页面。

---

## 三、本机构建（兜底，需在目标 OS 上）

> Windows 包在 Windows 上构建，Mac 包在 Mac 上构建（Linux 无法交叉构建 Mac 的 .dmg）。

```bash
# 1. 准备配置
cp env/.env.production.example env/.env.production
#   编辑 env/.env.production 填入 TOONFLOW_BACKEND_URL 与 JWT_SECRET

# 2. 导入到环境变量后构建
set -a && source env/.env.production && set +a   # Windows PowerShell 见下
yarn install --frozen-lockfile
yarn dist:win      # 或 yarn dist:mac / yarn dist:linux
```

Windows PowerShell 导入方式：
```powershell
Get-Content env\.env.production | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') { Set-Item "env:$($matches[1].Trim())" $matches[2].Trim() }
}
yarn install --frozen-lockfile
yarn dist:win
```

产物在 `dist/` 目录。

---

## 四、验证安装包是否连对后端

1. 安装并启动应用，用 **admin / admin123** 登录。
2. 在服务器执行 `docker compose logs -f backend`，应能看到来自客户端的 `/api/auth/login` 请求——说明请求打到了服务器 IP 而非 localhost。

---

## 五、安装说明（发给员工）

- **Windows**：双击 `.exe` 走安装向导。若提示缺 DLL，安装 [VC++ 运行库](https://aka.ms/vs/17/release/vc_redist.x64.exe)。
- **macOS**：打开 `.dmg` 拖入「应用程序」。安装包未做签名/公证，首次打开需在「系统设置 → 隐私与安全性」点「仍要打开」。
- **Linux**：`chmod +x ToonFlow-*.AppImage` 后运行。
