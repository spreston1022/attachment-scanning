// Sends a file through the gateway as an attachment, the way an app would.
//
//   node demo/send.mjs <file> [--anthropic] [--prompt "..."]
//
// Env: GATEWAY_URL (default http://localhost:9000), APP_ID, ZUPLO_APP_API_KEY,
//      MODEL (e.g. "vertex/gemini-2.5-flash" or "vertex/claude-sonnet-4-5").
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error('usage: node demo/send.mjs <file> [--anthropic] [--prompt "..."]');
  process.exit(1);
}
const anthropic = args.includes("--anthropic");
const promptIndex = args.indexOf("--prompt");
const prompt =
  promptIndex >= 0 ? args[promptIndex + 1] : "Summarise this attachment. Quote any account or card numbers you see.";

const { GATEWAY_URL = "http://localhost:9000", APP_ID, ZUPLO_APP_API_KEY, MODEL } = process.env;
if (!APP_ID || !ZUPLO_APP_API_KEY || !MODEL) {
  console.error("Set APP_ID, ZUPLO_APP_API_KEY and MODEL.");
  process.exit(1);
}

const MEDIA_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
};
const filename = basename(file);
const mediaType = MEDIA_TYPES[filename.split(".").pop().toLowerCase()] ?? "application/octet-stream";
const data = readFileSync(file).toString("base64");

const [path, body] = anthropic
  ? [
      "/v1/messages",
      {
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              mediaType.startsWith("image/")
                ? { type: "image", source: { type: "base64", media_type: mediaType, data } }
                : { type: "document", title: filename, source: { type: "base64", media_type: mediaType, data } },
              { type: "text", text: prompt },
            ],
          },
        ],
      },
    ]
  : [
      "/v1/chat/completions",
      {
        model: MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              mediaType.startsWith("image/")
                ? { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } }
                : { type: "file", file: { filename, file_data: `data:${mediaType};base64,${data}` } },
            ],
          },
        ],
      },
    ];

const res = await fetch(`${GATEWAY_URL}/${APP_ID}${path}`, {
  method: "POST",
  headers: { authorization: `Bearer ${ZUPLO_APP_API_KEY}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

console.log(`HTTP ${res.status}`);
const scan = res.headers.get("x-attachment-scan");
if (scan) console.log(`x-attachment-scan: ${scan}`);
const text = await res.text();
try {
  const json = JSON.parse(text);
  console.log(json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? JSON.stringify(json, null, 2));
} catch {
  console.log(text);
}
