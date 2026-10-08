import { strFromU8, unzipSync, type Unzipped } from "fflate";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

/**
 * Converts attachment bytes to plain text so the DLP policy can scan them.
 *
 * Supported: PDF (with a text layer), DOCX, XLSX, PPTX, and text-like files
 * (txt, csv, md, json, xml, html). Anything else, including images and
 * scanned PDFs, is reported as unsupported so the caller can decide whether
 * to block it.
 */

export type AttachmentKind = "pdf" | "docx" | "xlsx" | "pptx" | "text";

export type ExtractionResult =
  | { ok: true; kind: AttachmentKind; text: string; pages?: number }
  | { ok: false; reason: string };

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/html",
  "text/xml",
  "application/json",
  "application/xml",
]);

const OFFICE_MIME_TYPES: Record<string, AttachmentKind> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
};

// A PDF with fewer non-whitespace characters than this per page is treated as
// scanned (image-only) and therefore not scannable without OCR.
const MIN_PDF_CHARS_PER_PAGE = 20;

export async function extractAttachmentText(
  bytes: Uint8Array,
  mediaType: string | undefined,
  filename: string | undefined,
): Promise<ExtractionResult> {
  const kind = detectKind(bytes, mediaType, filename);
  if (!kind.ok) return kind;

  try {
    switch (kind.kind) {
      case "pdf":
        return await extractPdf(bytes);
      case "docx":
      case "xlsx":
      case "pptx":
        return extractOffice(bytes, kind.kind);
      case "text":
        return {
          ok: true,
          kind: "text",
          text: new TextDecoder("utf-8", { fatal: false }).decode(bytes),
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `could not parse ${kind.kind}: ${message}` };
  }
}

function detectKind(
  bytes: Uint8Array,
  mediaType: string | undefined,
  filename: string | undefined,
): { ok: true; kind: AttachmentKind } | { ok: false; reason: string } {
  const mime = (mediaType ?? "").split(";")[0].trim().toLowerCase();
  const ext = (filename ?? "").split(".").pop()?.toLowerCase() ?? "";

  // Trust the bytes over the declared type: apps often send
  // application/octet-stream, and a mislabelled file must not skip scanning.
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    return { ok: true, kind: "pdf" };
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const office = OFFICE_MIME_TYPES[mime] ?? officeKindFromExtension(ext);
    if (office) return { ok: true, kind: office };
    return { ok: true, kind: officeKindFromZip(bytes) ?? "docx" };
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    return {
      ok: false,
      reason:
        "legacy binary Office format (.doc/.xls/.ppt) is not supported; save as .docx/.xlsx/.pptx",
    };
  }
  if (mime.startsWith("image/") || looksLikeImage(bytes)) {
    return { ok: false, reason: "images cannot be scanned (no OCR)" };
  }
  if (
    mime.startsWith("text/") ||
    TEXT_MIME_TYPES.has(mime) ||
    ["txt", "csv", "md", "json", "xml", "html", "htm", "log"].includes(ext)
  ) {
    return { ok: true, kind: "text" };
  }
  return {
    ok: false,
    reason: `unsupported attachment type ${mime || ext || "unknown"}`,
  };
}

function officeKindFromExtension(ext: string): AttachmentKind | undefined {
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  if (ext === "pptx") return "pptx";
  return undefined;
}

function officeKindFromZip(bytes: Uint8Array): AttachmentKind | undefined {
  // Zip entry names are stored uncompressed, so a latin1 view of the archive
  // is enough to spot the well-known part names without inflating anything.
  const haystack = strFromU8(bytes, true);
  if (haystack.includes("word/document.xml")) return "docx";
  if (haystack.includes("xl/workbook.xml")) return "xlsx";
  if (haystack.includes("ppt/presentation.xml")) return "pptx";
  return undefined;
}

function looksLikeImage(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
    startsWith(bytes, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF
    (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45) || // WEBP
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || // TIFF
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  );
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

// --- PDF --------------------------------------------------------------------

async function extractPdf(bytes: Uint8Array): Promise<ExtractionResult> {
  // pdf.js takes ownership of the buffer, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractPdfText(pdf, { mergePages: false });
  await pdf.cleanup();

  const visibleChars = text.join("").replace(/\s+/g, "").length;
  if (visibleChars < MIN_PDF_CHARS_PER_PAGE * Math.max(totalPages, 1)) {
    return {
      ok: false,
      reason: "PDF has no text layer (scanned document); cannot scan without OCR",
    };
  }

  const body = text
    .map((page, i) => `--- page ${i + 1} ---\n${page.trim()}`)
    .join("\n\n");
  return { ok: true, kind: "pdf", text: body, pages: totalPages };
}

// --- Office (OOXML) ---------------------------------------------------------

function extractOffice(
  bytes: Uint8Array,
  kind: "docx" | "xlsx" | "pptx",
): ExtractionResult {
  const files = unzipSync(bytes);
  const read = (path: string) =>
    files[path] ? strFromU8(files[path]) : undefined;

  let text: string;
  if (kind === "docx") text = docxText(files, read);
  else if (kind === "xlsx") text = xlsxText(files, read);
  else text = pptxText(files, read);

  return { ok: true, kind, text };
}

type Read = (path: string) => string | undefined;

function docxText(files: Unzipped, read: Read): string {
  // Body first, then everything else that can carry user text: headers,
  // footers, footnotes, endnotes, and comments.
  const parts = [
    "word/document.xml",
    ...sortedParts(files, /^word\/(header|footer)\d*\.xml$/),
    "word/footnotes.xml",
    "word/endnotes.xml",
    "word/comments.xml",
  ];
  return parts
    .map((p) => {
      const xml = read(p);
      return xml ? wordprocessingText(xml) : "";
    })
    .filter((t) => t.trim())
    .join("\n\n");
}

function wordprocessingText(xml: string): string {
  let out = "";
  const tokens =
    /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>|<\/w:p>|<\/w:tc>/g;
  for (const m of xml.matchAll(tokens)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0] === "<w:tab/>" || m[0] === "</w:tc>") out += "\t";
    else out += "\n";
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function xlsxText(files: Unzipped, read: Read): string {
  const shared: string[] = [];
  const sharedXml = read("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(innerTexts(si[1], "t"));
    }
  }

  const sheets = sheetNames(read);
  const sheetPaths = sortedParts(files, /^xl\/worksheets\/sheet\d+\.xml$/);

  return sheetPaths
    .map((path) => {
      const xml = read(path)!;
      const rows: string[] = [];
      for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const c of row[1].matchAll(
          /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
        )) {
          const attrs = c[1];
          const inner = c[2] ?? "";
          const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
          if (type === "s" && v !== undefined) cells.push(shared[Number(v)] ?? "");
          else if (type === "inlineStr") cells.push(innerTexts(inner, "t"));
          else cells.push(v !== undefined ? decodeXml(v) : "");
        }
        if (cells.some((c) => c.trim())) rows.push(cells.join("\t"));
      }
      const name = sheets[path] ?? path.split("/").pop()!.replace(".xml", "");
      return `## Sheet: ${name}\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

function sheetNames(read: Read): Record<string, string> {
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) return {};

  const targets: Record<string, string> = {};
  for (const r of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(r[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(r[0])?.[1];
    if (id && target) {
      targets[id] = target.startsWith("/")
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, "")}`;
    }
  }

  const names: Record<string, string> = {};
  for (const s of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /\bname="([^"]+)"/.exec(s[0])?.[1];
    const rid = /\br:id="([^"]+)"/.exec(s[0])?.[1];
    if (name && rid && targets[rid]) names[targets[rid]] = decodeXml(name);
  }
  return names;
}

function pptxText(files: Unzipped, read: Read): string {
  const slides = sortedParts(files, /^ppt\/slides\/slide\d+\.xml$/).map(
    (path, i) => `--- slide ${i + 1} ---\n${drawingText(read(path)!)}`,
  );
  const notes = sortedParts(files, /^ppt\/notesSlides\/notesSlide\d+\.xml$/)
    .map((path) => drawingText(read(path)!))
    .filter((t) => t.trim());
  if (notes.length) slides.push(`--- speaker notes ---\n${notes.join("\n")}`);
  return slides.join("\n\n");
}

function drawingText(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<a:t>([^<]*)<\/a:t>|<\/a:p>/g)) {
    out += m[1] !== undefined ? decodeXml(m[1]) : "\n";
  }
  return out.trim();
}

// --- helpers ----------------------------------------------------------------

function sortedParts(files: Unzipped, pattern: RegExp): string[] {
  const num = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);
  return Object.keys(files)
    .filter((p) => pattern.test(p))
    .sort((a, b) => num(a) - num(b));
}

function innerTexts(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "g");
  return Array.from(xml.matchAll(re), (m) => decodeXml(m[1])).join("");
}

function decodeXml(s: string): string {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
    switch (e.toLowerCase()) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    return String.fromCodePoint(
      e[1] === "x" || e[1] === "X"
        ? parseInt(e.slice(2), 16)
        : parseInt(e.slice(1), 10),
    );
  });
}
