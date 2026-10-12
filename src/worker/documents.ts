import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { assert } from "../lib/errors";
export type Section = { label: string; start: number; end: number };
export async function parseDocument(
  buffer: Buffer,
  mime: string,
  name: string,
) {
  const sections: Section[] = [];
  let text = "";
  const add = (label: string, value: string) => {
    const start = text.length;
    text += `\n[${label}]\n${value}\n`;
    assert(text.length <= 2000000, 422, "文档文字超过解析上限，请拆分后上传");
    sections.push({ label, start, end: text.length });
  };
  if (mime.startsWith("text/")) {
    add(
      mime === "text/csv" ? "CSV 原始表格" : "正文",
      buffer.toString("utf8").replace(/^\uFEFF/, ""),
    );
  } else if (mime === "application/pdf") {
    const parse = (await import("pdf-parse/lib/pdf-parse.js")).default;
    let page = 0;
    await (parse as any)(Uint8Array.from(buffer), {
      version: "v2.0.550",
      pagerender: async (p: any) => {
        page++;
        assert(page <= 500, 422, "PDF 超过 500 页，请拆分后上传");
        const content = await p.getTextContent();
        let y: number | undefined,
          value = "";
        for (const item of content.items) {
          if (y !== undefined && y !== item.transform[5]) value += "\n";
          value += item.str;
          y = item.transform[5];
        }
        add(`第 ${page} 页`, value);
        return value;
      },
    });
    assert(
      text.replace(/\[第 \d+ 页\]/g, "").trim(),
      422,
      "PDF 没有可提取文字，扫描件需要先进行 OCR",
    );
  } else if (/\.(docx|xlsx|pptx)$/i.test(name)) {
    let total = 0,
      count = 0;
    // Check declared expansion before any Office parser inflates archive contents.
    const files = unzipSync(buffer, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        assert(
          count <= 20000 &&
            total <= 128 * 1024 * 1024 &&
            f.originalSize <= 32 * 1024 * 1024,
          422,
          "Office 文档解压体积过大",
        );
        return (
          name.toLowerCase().endsWith(".pptx") &&
          /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/.test(
            f.name,
          )
        );
      },
    });
    if (/\.docx$/i.test(name)) {
      const mammoth = await import("mammoth");
      add("正文与表格", (await mammoth.extractRawText({ buffer })).value);
    } else if (/\.xlsx$/i.test(name)) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      let cells = 0;
      workbook.eachSheet((sheet) => {
        const rows: string[] = [];
        sheet.eachRow((row) => {
          const values: string[] = [];
          row.eachCell((cell) => {
            assert(
              ++cells <= 100000,
              422,
              "表格超过 10 万个非空单元格，请拆分",
            );
            const v: any = cell.value;
            let display = cell.text;
            if (v && typeof v === "object") {
              if ("formula" in v || "sharedFormula" in v)
                display =
                  v.result === undefined
                    ? "[公式无缓存结果]"
                    : String(v.result);
              else if ("richText" in v)
                display = v.richText.map((t: any) => t.text).join("");
            }
            values.push(`${cell.address}: ${display}`);
          });
          rows.push(values.join(" | "));
        });
        add(`工作表 ${sheet.name}`, rows.join("\n"));
      });
    } else {
      const parser = new XMLParser({
        ignoreAttributes: false,
        processEntities: false,
      });
      const words = (node: any): string[] => {
        if (!node || typeof node !== "object") return [];
        return Object.entries(node).flatMap(([key, value]) =>
          key === "a:t"
            ? [String(value)]
            : Array.isArray(value)
              ? value.flatMap(words)
              : words(value),
        );
      };
      const keys = Object.keys(files).sort(
        (a, b) =>
          Number(/(\d+)\.xml$/.exec(a)?.[1]) -
          Number(/(\d+)\.xml$/.exec(b)?.[1]),
      );
      for (const key of keys)
        add(
          `${key.includes("notesSlides") ? "备注" : "幻灯片"} ${/(\d+)\.xml$/.exec(key)![1]}`,
          words(parser.parse(new TextDecoder().decode(files[key]))).join("\n"),
        );
    }
  } else return null;
  assert(
    sections.length && text.replace(/\[[^\]]+\]/g, "").trim(),
    422,
    "文件没有可提取的文字",
  );
  return { text, sections };
}
