import type { AiFormat, ZuploContext } from "@zuplo/runtime";

export type Block = Record<string, any>;

type Visit = (block: Block) => Promise<Block | undefined> | Block | undefined;

/**
 * Calls `visit` on every content block in an AI request body and replaces the
 * block with whatever `visit` returns (or leaves it when it returns
 * undefined). Covers `messages[].content` (openai-chat, anthropic-messages),
 * `input[].content` (openai-responses), and Anthropic `tool_result` content.
 */
export async function rewriteBlocks(format: AiFormat, body: Block, visit: Visit) {
  if (format === "openai-responses") {
    if (!Array.isArray(body.input)) return;
    for (const item of body.input) {
      if (Array.isArray(item?.content)) await rewriteList(item.content, visit);
    }
    return;
  }

  if (!Array.isArray(body.messages)) return;
  for (const message of body.messages) {
    if (!Array.isArray(message?.content)) continue;
    await rewriteList(message.content, visit);
    // Anthropic tool results can themselves contain documents.
    for (const block of message.content) {
      if (block?.type === "tool_result" && Array.isArray(block.content)) {
        await rewriteList(block.content, visit);
      }
    }
  }
}

async function rewriteList(blocks: Block[], visit: Visit) {
  for (let i = 0; i < blocks.length; i++) {
    const replacement = await visit(blocks[i]);
    if (replacement) blocks[i] = replacement;
  }
}

// --- state shared between the extraction and restore policies ---------------

export interface AttachmentReport {
  filename: string;
  status:
    | "extracted"
    | "original-forwarded"
    | "masked-text-forwarded"
    | "blocked"
    | "allowed-unscanned";
  detail: string;
}

export interface ExtractedAttachment {
  /** The file block as the app sent it. */
  original: Block;
  /** The text block that replaced it, exactly as handed to DLP. */
  text: string;
  report: AttachmentReport;
}

export interface AttachmentScanState {
  extracted: Map<string, ExtractedAttachment>;
  reports: AttachmentReport[];
}

const STATE_KEY = "attachmentScan";

export function getScanState(context: ZuploContext): AttachmentScanState | undefined {
  return context.custom[STATE_KEY] as AttachmentScanState | undefined;
}

export function setScanState(context: ZuploContext, state: AttachmentScanState) {
  context.custom[STATE_KEY] = state;
}

/** Matches the id the extraction policy writes into each text block. */
export const ATTACHMENT_ID_PATTERN = /^<attachment id="([^"]+)"/;
