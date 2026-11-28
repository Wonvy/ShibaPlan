# ShibaPlan 信息仪表盘实用脚本

本目录包含可直接搭配 ShibaPlan「信息」仪表盘使用的通用脚本（遵循 `shibaplan-info/v1` 协议）。所有个人参数均通过 ShibaPlan 卡片的自定义参数（`SHIBA_PARAM_*`）注入，不在脚本内硬编码隐私信息；历史记录自动保存在仓库外的 `$env:SHIBA_DATA_DIR\metrics-history\`。

## 1. B站粉丝数监控 (`bilibili-fans.ps1`)
- **功能**：获取指定 B站账号的实时粉丝数、今日涨跌、关注数及近期趋势折线。
- **卡片参数配置（推荐在 ShibaPlan 卡片编辑页 -> 自定义参数中配置）**：
  - `uid`：你的 B站数字 UID（或个人主页链接 `https://space.bilibili.com/<uid>`）
  - `name`（可选）：指标显示名称，默认 `B站粉丝`
- **命令行直接测试**：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/bilibili-fans.ps1 -Uid 123456
  ```

## 2. SSL 证书到期监控 (`check-ssl.ps1`)
- **功能**：检查一个或多个域名的 TLS 证书有效期，剩余天数 `<= 7` 天、已过期或校验异常时自动以红色文本告警；悬停可查看颁发机构、生效/过期时间等详情。
- **卡片参数配置**：
  - `targets`（可选）：待检查域名或 URL，多个用逗号或分号分隔
  - `warning_days`（可选）：告警阈值天数，默认 `7`
- **命令行直接测试**：
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-ssl.ps1 -Targets "example.com"
  ```

## 隐私与 Git 隔离说明
- 本目录中的脚本与 `extensions/shibaplan-companion/` 均只保留通用代码，可安全纳入 Git 版本控制。
- 运行产生的历史曲线（`*.history.json`）、本地配置备份（`*.local.json`）、Cookie/密钥文件及浏览器数据目录（`browser-data/`、`.chrome-profile/`）已在 `.gitignore` 中被忽略，不会被提交到 Git。
