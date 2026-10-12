/** Verified against the vendor's CNY price table on 2026-10-12. */
export const deepseekOfficialPrice = {
  model: "deepseek-flash",
  unit: "token" as const,
  rate: 8,
  inputRate: 2,
  cachedInputRate: 0.04,
  source: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
  checkedAt: "2026-10-12",
  basis:
    "DeepSeek 官方人民币高峰价格上限，2026-10-12 核验；输入 2、缓存 0.04、输出 8 元/百万 Token。官方空闲价为一半；此配置用于保守报价及按上限计算，非供应商实际账单。https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
};
