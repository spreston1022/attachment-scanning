import { getFormat, getRequestBody, ZuploContext, ZuploRequest } from "@zuplo/runtime";
import {
  ATTACHMENT_ID_PATTERN,
  getScanState,
  rewriteBlocks,
  type Block,
} from "./attachments/request-blocks";

/**
 * Attachment Restore
 *
 * Runs immediately after `ai-gateway-dlp-inbound` and decides, per
 * attachment, what the model receives:
 *
 * - DLP left the extracted text unchanged (alert/log mode, or nothing found):
 *   the original file is forwarded, with its formatting intact.
 * - DLP masked something in the text: the masked text is forwarded in place
 *   of the file, so the unmasked original never reaches the model.
 *
 * Requires `attachment-text-extraction-inbound` before DLP. With no
 * extracted attachments on the request it does nothing.
 */
export default async function attachmentRestore(
  request: ZuploRequest,
  context: ZuploContext,
  _options: unknown,
  policyName: string,
): Promise<ZuploRequest> {
  const state = getScanState(context);
  if (!state?.extracted.size) return request;

  const format = getFormat(request);
  const parsed = format ? await getRequestBody(request) : null;
  if (!format || !parsed) return request;

  let restored = false;
  await rewriteBlocks(format, parsed.body as Block, (block) => {
    const text = typeof block?.text === "string" ? block.text : undefined;
    const id = text && ATTACHMENT_ID_PATTERN.exec(text)?.[1];
    const entry = id ? state.extracted.get(id) : undefined;
    if (!entry) return undefined;

    if (text === entry.text) {
      entry.report.status = "original-forwarded";
      restored = true;
      return entry.original;
    }
    entry.report.status = "masked-text-forwarded";
    return undefined;
  });

  for (const r of state.reports) {
    context.log.info(`${policyName}: ${r.filename} ${r.status}`);
  }

  if (!restored) return request;

  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new ZuploRequest(request, {
    headers,
    body: JSON.stringify(parsed.body),
  });
}
