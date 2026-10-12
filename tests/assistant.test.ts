import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import ExcelJS from "exceljs";
import { parseDocument } from "../src/worker/documents";
import { isPublicAddress } from "../src/worker/public-video";
import { normalizeVideoResult } from "../src/worker/video-analysis";

describe("document content and source locations", () => {
  it("PDF preserves page labels and rejects empty/scanned documents", async () => {
    const parsed = await parseDocument(
      readFileSync("tests/fixtures/assistant-brief.pdf"),
      "application/pdf",
      "brief.pdf",
    );
    expect(parsed?.text).toContain("Verified product brief");
    expect(parsed?.sections[0].label).toBe("第 1 页");
    await expect(
      parseDocument(
        readFileSync("tests/fixtures/assistant-scan.pdf"),
        "application/pdf",
        "scan.pdf",
      ),
    ).rejects.toThrow("OCR");
  });
  for (const mime of ["text/plain", "text/markdown", "text/csv"])
    it(mime + " preserves content", async () => {
      const result = await parseDocument(
        Buffer.from("第一行\n第二行"),
        mime,
        "test",
      );
      expect(result?.text).toContain("第一行\n第二行");
      expect(result?.sections[0].start).toBe(0);
    });
  it("xlsx uses cached formula values and names worksheets", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("价格");
    sheet.getCell("A1").value = "产品";
    sheet.getCell("B1").value = { formula: "1+2", result: 3 };
    sheet.getCell("B2").value = {
      formula: 'HYPERLINK("https://invalid.test")',
    };
    const r = await parseDocument(
      Buffer.from(await workbook.xlsx.writeBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "table.xlsx",
    );
    expect(r?.text).toContain("B1: 3");
    expect(r?.text).toContain("[公式无缓存结果]");
    expect(r?.sections[0].label).toContain("价格");
  });
  it("pptx extracts slide text, table text and notes", async () => {
    const zip = zipSync({
      "ppt/slides/slide1.xml": strToU8(
        '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>产品介绍</a:t></a:r></a:p><a:tbl><a:t>规格表</a:t></a:tbl></p:sld>',
      ),
      "ppt/notesSlides/notesSlide1.xml": strToU8(
        '<p:notes xmlns:p="p" xmlns:a="a"><a:t>讲者备注</a:t></p:notes>',
      ),
    });
    const r = await parseDocument(
      Buffer.from(zip),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "deck.pptx",
    );
    expect(r?.text).toContain("产品介绍");
    expect(r?.text).toContain("讲者备注");
    expect(r?.text).toContain("规格表");
    expect(r?.sections).toHaveLength(2);
  });
  it("docx extracts paragraphs and table cells", async () => {
    const zip = zipSync({
      "[Content_Types].xml": strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
      "_rels/.rels": strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
      "word/document.xml": strToU8(
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>真实卖点</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格内容</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
      ),
    });
    const r = await parseDocument(
      Buffer.from(zip),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "brief.docx",
    );
    expect(r?.text).toContain("真实卖点");
    expect(r?.text).toContain("表格内容");
  });
});
describe("public video and timeline boundaries", () => {
  it("rejects localhost, private, metadata and mapped private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "0.0.0.0",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
  });
  it("keeps valid timestamps and labels model estimates", () => {
    const result = normalizeVideoResult(
      JSON.stringify({
        summary: "test",
        shots: [
          { start: "00:01", end: "00:02", visual: "画面" },
          { start: -1, end: 6 },
          { start: 3, end: 99 },
        ],
      }),
      5,
    );
    expect(result.shots).toHaveLength(1);
    expect(result.shots[0].start).toBe(1);
    expect(result.uncertainties.length).toBe(2);
    expect(result.timingSource).toContain("非逐帧");
  });
  it("preserves non-JSON model reports without inventing a timeline", () => {
    expect(normalizeVideoResult("未识别清晰画面", 5).shots).toEqual([]);
  });
});
