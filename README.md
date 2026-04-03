# 黄金看板 (Gold Dashboard)

实时追踪黄金价格与宏观经济指标，基于 FRED API 数据。

## 功能

- 📊 **多维度指标监控**
  - 参考价格：国际金价
  - 机会成本：实际收益率、通胀预期、联邦基金利率
  - 美元与流动性：美元指数、汇率
  - 通胀与增长：PCE、工业生产、失业率
  - 财政与信用：债务总额、债务/GDP、赤字/GDP
  - 风险温度：黄金波动率

- 📈 **可视化图表**：点击任意卡片查看历史走势
- 🔄 **自动更新**：通过 GitHub Actions 每日自动抓取数据
- 📱 **响应式设计**：支持移动端和桌面端

## 快速开始

### 1. 获取 FRED API Key

1. 访问 [FRED API](https://fred.stlouisfed.org/docs/api/api_key.html)
2. 注册账号并创建免费 API Key
3. FRED API 每天可调用 1000 次，个人使用完全足够

### 2. 配置 GitHub Secrets

在你的 GitHub 仓库中添加 Secret：

1. 进入仓库 Settings → Secrets and variables → Actions
2. 点击 "New repository secret"
3. Name: `FRED_API_KEY`
4. Value: 你的 FRED API Key

### 3. 本地测试（可选）

```bash
# 安装依赖（无需安装，纯 Node.js）
# 设置环境变量
export FRED_API_KEY=你的API密钥

# 运行数据采集脚本
node scripts/fetch-data.js

# 本地预览（使用任意静态服务器）
npx serve .
# 或
python -m http.server 8080
```

### 4. 部署到 GitHub Pages

1. 推送代码到 GitHub
2. 进入仓库 Settings → Pages
3. Source 选择 "Deploy from a branch"
4. Branch 选择 "main" 或 "master"，目录选择 "/ (root)"
5. 保存后等待部署完成

GitHub Actions 会自动每天更新数据并推送到仓库。

## 项目结构

```
gold/
├── index.html              # 主页面
├── scripts/
│   └── fetch-data.js       # 数据采集脚本
├── data/                   # 静态 JSON 数据（自动生成）
│   ├── GOLD_USD.json       # 黄金价格
│   ├── DFII10.json         # 10年TIPS
│   ├── all_indicators.json # 指标汇总
│   └── ...
├── .github/
│   └── workflows/
│       └── update-data.yml # 自动更新工作流
└── README.md
```

## 数据格式

每个指标 JSON 文件结构：

```json
{
  "id": "GOLD_USD",
  "name_zh": "国际金价",
  "unit": "美元/盎司",
  "section": "参考价格",
  "direction": null,
  "updated": "2026-04-01",
  "latest": {
    "date": "2026-03-28",
    "value": 2918.50
  },
  "changes": {
    "5d": 15.30,
    "20d": -45.20,
    "3m": 120.50,
    "yoy": 352.80
  },
  "percentiles": {
    "1y": 76,
    "3y": 92
  },
  "series": [
    { "date": "2025-01-01", "value": 2850.00 }
  ]
}
```

## 自定义配置

### 添加新指标

编辑 `scripts/fetch-data.js`，在 `FRED_SERIES` 对象中添加：

```javascript
const FRED_SERIES = {
  // ...
  'NEW_SERIES_ID': { 
    name_zh: '指标中文名', 
    unit: '单位', 
    section: '分区名称', 
    direction: 'positive' | 'negative' | null 
  },
};
```

然后在 `index.html` 的 `INDICATORS` 对象中添加到对应分区。

### 修改更新频率

编辑 `.github/workflows/update-data.yml`：

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'  # 每 6 小时更新一次
```

### 添加更多数据源

`fetch-data.js` 可以扩展支持：
- Yahoo Finance API（股票、ETF）
- 世界黄金协会 API（央行购金）
- CFTC API（持仓数据）
- Blockchain.com API（比特币）

## 常见问题

**Q: 为什么有些指标加载失败？**  
A: 检查 FRED API Key 是否正确配置，以及该指标 ID 在 FRED 是否存在。

**Q: 数据多久更新一次？**  
A: GitHub Actions 每天北京时间 08:30 自动更新。也可以在 Actions 页面手动触发。

**Q: 如何添加其他贵金属（白银、铂金）？**  
A: FRED 的贵金属数据有限，建议使用 Yahoo Finance API 获取。

## 数据来源

- [FRED (Federal Reserve Economic Data)](https://fred.stlouisfed.org/)
- 所有数据均为公开数据，仅供参考

## License

MIT
