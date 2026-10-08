import {
  getFormat,
  getRequestBody,
  ZuploContext,
  ZuploRequest,
  type AiFormat,
} from "@zuplo/runtime";
import { extractAttachmentText } from "./attachments/extract";
import {
  rewriteBlocks,
  setScanState,
  type AttachmentReport,
  type AttachmentScanState,
  type Block,
} from "./attachments/request-blocks";

/**
 * Attachment Text Extraction
 *
 * Replaces file attachments in an AI request with their extracted text, so the
 * DLP policy that runs after it can scan (and mask or block) what is inside
 * the files. Without this, PDF and Office attachments pass DLP unscanned
 * because DLP only reads text blocks.
 *
 * Place it in the app's policy chain immediately before
 * `ai-gateway-dlp-inbound`. Add `attachment-restore-inbound` immediately after
 * DLP to forward the original file whenever DLP left its text unchanged (alert
 * mode, or redact mode with nothing found). Without it, the extracted text is
 * always forwarded in place of the file.
 *
 * Handles:
 * - openai-chat:        `{ type: "file", file: { filename, file_data } }`
 * - openai-responses:   `{ type: "input_file", filename, file_data }`
 * - anthropic-messages: `{ type: "document", source: { type: "base64" | "text" } }`
 *
 * Images and anything that cannot be converted to text (scanned PDFs, legacy
 * .doc/.xls, file IDs or URLs the gateway cannot read) are blocked by default.
 * Set `onUnsupported: "allow"` to forward them unscanned instead.
 */

interface PolicyOptions {
  /** What to do with an attachment that cannot be converted to text. */
  onUnsupported?: "block" | "allow";
  /** Attachments larger than this (decoded) are treated as unsupported. */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 20 * 1024 * 1024;

interface Attachment {
  filename?: string;
  mediaType?: string;
  /** Base64 payload, or undefined when the block references external data. */
  base64?: string;
  /** Already-plain text (Anthropic `source.type: "text"` documents). */
  text?: string;
  /** Why the block cannot be read at all, e.g. a file_id or URL reference. */
  unreadable?: string;
}

export default async function attachmentTextExtraction(
  request: ZuploRequest,
  context: ZuploContext,
  options: PolicyOptions,
  policyName: string,
): Promise<ZuploRequest | Response> {
  const format = getFormat(request);
  if (!format) return request;

  const parsed = await getRequestBody(request);
  if (!parsed) return request;

  const onUnsupported = options.onUnsupported ?? "block";
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const state: AttachmentScanState = { extracted: new Map(), reports: [] };
  const reports = state.reports;
  let changed = false;

  const convert = async (block: Block): Promise<Block | undefined> => {
    const attachment = readAttachment(format, block);
    if (!attachment) return undefined;

    const filename = attachment.filename ?? "attachment";
    const text = await attachmentToText(attachment, maxFileBytes);

    if ("reason" in text) {
      const status = onUnsupported === "allow" ? "allowed-unscanned" : "blocked";
      reports.push({ filename, status, detail: text.reason });
      return undefined;
    }

    const report: AttachmentReport = { filename, status: "extracted", detail: text.summary };
    reports.push(report);
    changed = true;
    const id = crypto.randomUUID();
    const wrapped = wrap(id, filename, text.kind, text.text);
    state.extracted.set(id, { original: block, text: wrapped, report });
    return textBlock(format, block, wrapped);
  };

  await rewriteBlocks(format, parsed.body as Block, convert);

  for (const r of reports) {
    context.log.info(`${policyName}: ${r.filename} ${r.status} (${r.detail})`);
  }

  const blocked = reports.filter((r) => r.status === "blocked");
  if (blocked.length) {
    return errorResponse(
      format,
      `Attachment blocked: ${blocked
        .map((r) => `${r.filename}: ${r.detail}`)
        .join("; ")}. Attachments must be convertible to text so they can be scanned for sensitive data.`,
    );
  }

  if (reports.length) {
    setScanState(context, state);
    // Built at send time so it reflects what the restore policy decided.
    context.addResponseSendingHook((response) => {
      const headers = new Headers(response.headers);
      headers.set(
        "x-attachment-scan",
        reports.map((r) => `${r.filename}=${r.status}`).join(", "),
      );
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
  }

  if (!changed) return request;

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new ZuploRequest(request, {
    headers,
    body: JSON.stringify(parsed.body),
  });
}

// --- reading attachments ---------------------------------------------------

function readAttachment(format: AiFormat, block: Block): Attachment | undefined {
  if (!block || typeof block !== "object") return undefined;

  if (format === "openai-chat") {
    if (block.type === "image_url") {
      return { filename: "image", unreadable: "images cannot be scanned (no OCR)" };
    }
    if (block.type !== "file") return undefined;
    const file = block.file ?? {};
    if (typeof file.file_data === "string") {
      return { filename: file.filename, ...parseDataUrl(file.file_data) };
    }
    return {
      filename: file.filename ?? file.file_id,
      unreadable: "file_id references cannot be read by the gateway; send file_data",
    };
  }

  if (format === "openai-responses") {
    if (block.type === "input_image") {
      return { filename: "image", unreadable: "images cannot be scanned (no OCR)" };
    }
    if (block.type !== "input_file") return undefined;
    if (typeof block.file_data === "string") {
      return { filename: block.filename, ...parseDataUrl(block.file_data) };
    }
    return {
      filename: block.filename ?? block.file_id ?? block.file_url,
      unreadable: "file_id/file_url references cannot be read by the gateway; send file_data",
    };
  }

  // anthropic-messages
  if (block.type === "image") {
    return { filename: "image", unreadable: "images cannot be scanned (no OCR)" };
  }
  if (block.type !== "document") return undefined;
  const source = block.source ?? {};
  const filename = block.title ?? block.context ?? undefined;
  if (source.type === "base64") {
    return { filename, mediaType: source.media_type, base64: source.data };
  }
  if (source.type === "text") {
    return { filename, mediaType: source.media_type, text: String(source.data ?? "") };
  }
  if (source.type === "content" && Array.isArray(source.content)) {
    const text = source.content
      .filter((b: Block) => b?.type === "text")
      .map((b: Block) => b.text)
      .join("\n");
    const hasImages = source.content.some((b: Block) => b?.type === "image");
    return hasImages
      ? { filename, unreadable: "document contains images, which cannot be scanned" }
      : { filename, text };
  }
  return {
    filename: filename ?? source.url ?? source.file_id,
    unreadable: `document source "${source.type}" cannot be read by the gateway; send base64`,
  };
}

function parseDataUrl(value: string): Pick<Attachment, "mediaType" | "base64"> {
  const match = /^data:([^;,]*)(?:;[^,]*)?,(.*)$/s.exec(value);
  if (match) return { mediaType: match[1] || undefined, base64: match[2] };
  // OpenAI also accepts bare base64 in file_data.
  return { base64: value };
}

// --- conversion --------------------------------------------------------------

async function attachmentToText(
  attachment: Attachment,
  maxFileBytes: number,
): Promise<{ kind: string; text: string; summary: string } | { reason: string }> {
  if (attachment.unreadable) return { reason: attachment.unreadable };
  if (attachment.text !== undefined) {
    return { kind: "text", text: attachment.text, summary: `${attachment.text.length} chars` };
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(attachment.base64 ?? "");
  } catch {
    return { reason: "attachment data is not valid base64" };
  }
  if (bytes.length > maxFileBytes) {
    return { reason: `attachment is ${bytes.length} bytes, over the ${maxFileBytes} byte limit` };
  }

  const result = await extractAttachmentText(bytes, attachment.mediaType, attachment.filename);
  if (!result.ok) return { reason: result.reason };

  const pages = result.pages ? `, ${result.pages} pages` : "";
  return {
    kind: result.kind,
    text: result.text,
    summary: `${result.kind}${pages}, ${result.text.length} chars`,
  };
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function wrap(id: string, filename: string, kind: string, text: string): string {
  const name = filename.replace(/"/g, "'");
  return `<attachment id="${id}" filename="${name}" type="${kind}">\n${text}\n</attachment>`;
}

function textBlock(format: AiFormat, original: Block, text: string): Block {
  if (format === "openai-responses") return { type: "input_text", text };
  const block: Block = { type: "text", text };
  // Keep Anthropic prompt caching on the converted block.
  if (format === "anthropic-messages" && original.cache_control) {
    block.cache_control = original.cache_control;
  }
  return block;
}

function errorResponse(format: AiFormat, message: string): Response {
  const body =
    format === "anthropic-messages"
      ? { type: "error", error: { type: "invalid_request_error", message } }
      : {
          error: {
            message,
            type: "invalid_request_error",
            code: "attachment_not_scannable",
          },
        };
  return new Response(JSON.stringify(body), {
    status: 422,
    headers: { "content-type": "application/json" },
  });
}
