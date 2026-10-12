# Frameflow 品牌图标

使用内置 imagegen 生成原创 F 图形，采用深森林绿底与荧光绿标记，粗笔画和向前倾斜的末端表达画框与制作流动。官网、账号页、团队页、工作台和浏览器图标使用同一份图形。

原始生成文件：`public/brand/frameflow-source.png`。运行 `node scripts/build-icons.mjs`，通过 Sharp 等比缩小导出，不重新绘制图形：

- `src/app/favicon.ico`：16、32、48、64、256 像素多尺寸容器。
- `src/app/icon.png`：32 像素浏览器图标。
- `src/app/apple-icon.png`：180 像素手机桌面图标。
- `public/brand/frameflow-mark.png`：96 像素界面标记。
- `public/brand/frameflow-512.png`：512 像素可复用图标。

Next.js 根目录文件约定自动为全站输出图标链接。

## 生成提示词

Use case: logo-brand. Asset type: final square favicon/app icon for Frameflow, an AI video creative production platform. Create ONE exceptionally simple bold geometric brand mark, combining an uppercase F monogram with an open cinematic frame and forward flow. Flat clean vector-like raster design. A solid deep forest green (#20382C) square canvas extending edge to edge; centered luminous lime (#C4F078) symbol, occupying about 72% of canvas. Design the F from only two or three broad interlocking geometric strokes with subtle rounded corners; a strong top horizontal bar, shorter middle bar, and confident vertical stem, with an open frame suggestion. It must remain crisp and immediately recognizable at 16px and 32px. Balanced optical spacing, precise edges, high contrast, premium editorial creative-tool identity. No wordmark, no letters besides the abstract F, no extra text, no mockup, no presentation sheet, no alternate icons, no border, no drop shadow, no gradients, no texture, no 3D, no tiny details, no film perforations, no generic play triangle. Output a single square finished icon only.
