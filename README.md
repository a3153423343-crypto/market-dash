# A股 + 美股 板块资金流动看板

**线上地址：https://a3153423343-crypto.github.io/market-dash/**

- 38 个 A 股板块分时资金流（东财）
- 美股：6 大指数 / 18 只大型公司 / 4 个宽基 / 11 个 SPDR 行业 / 14 个细分主题 / 2 只波动率 ETF
- VIX 恐慌指数：CBOE 官方分时（390 点）＋ 1990 年至今日线
- 24 小时时间轴回放：可选最近 20 个交易日，拖动进度条看任意时刻

数据由 GitHub Actions 每 10 分钟抓取并发布，无需本地程序。

| 文件 | 作用 |
|---|---|
| dash-build.mjs | 抓取 + 生成静态 JSON |
| public/index.html | 看板前端 |
| public/latest.json | 最新快照 |
| public/replay/日期.json | 每个交易日的 24 小时回放数据 |
| archive.json | A 股分时归档（保留 30 天） |
