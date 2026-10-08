## Zuplo AI Gateway

This is a Zuplo AI Gateway that was created with
[`create-zuplo-api`](https://zuplo.com/docs). It gives your applications one
OpenAI-compatible API in front of many AI providers, with per-app keys, model
controls, budgets, caching, and guardrails.

## Getting Started

The gateway loads each app's configuration (providers, models, and policies)
from your Zuplo account at request time, so the project must be linked to a
Zuplo project before it can serve requests.

1. Link the project. This writes your project's settings to `.env.zuplo`, which
   is gitignored:

   ```bash
   npx zuplo link
   ```

2. In the [Zuplo Portal](https://portal.zuplo.com), add a provider and create an
   app. Each app gets its own API URL and API key. See
   [Apps](https://zuplo.com/docs/ai-gateway/apps).

3. Start the development server:

   ```bash
   npm run dev
   # or
   yarn dev
   # or
   pnpm dev
   ```

4. Send a request to the local gateway. Replace `<app_id>` with the ID from your
   app's API URL and set `ZUPLO_APP_API_KEY` to the app's API key:

   ```bash
   curl http://localhost:9000/<app_id>/v1/chat/completions \
     -H "Authorization: Bearer $ZUPLO_APP_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "openai/gpt-4o-mini",
       "messages": [{ "role": "user", "content": "Say hi" }]
     }'
   ```

## Endpoints

Every request is scoped to an app by the first path segment, `/{app_id}`. For
the supported endpoints and which providers serve each one, see the
[AI Gateway documentation](https://zuplo.com/docs/ai-gateway/overview).

## Project Structure

| Path                       | What it does                                                           |
| -------------------------- | ---------------------------------------------------------------------- |
| `config/ai.oas.json`       | The catch-all route that sends `/{app_id}/*` to the AI Gateway handler |
| `config/policies.json`     | The policies an app can select for its policy chain                    |
| `modules/zuplo.runtime.ts` | Runtime plugins, such as tracing and logging                           |
| `.env.example`             | Sample environment variables. Copy it to `.env` for local development  |

An app runs only the policies listed in its policy chain, and it can select only
policies declared in `config/policies.json`. To add your own policy, write it in
`modules/` and declare it in `config/policies.json`.

## Attachment scanning

The built-in DLP policy only scans text blocks, so file attachments (base64
PDFs, Word, and Excel files) pass through it unscanned. The
`attachment-text-extraction-inbound` policy
(`modules/attachment-text-extraction-inbound.ts`) closes that gap: it converts
each attachment to text at the gateway, replaces the file block with a text
block, and DLP then scans and masks or blocks that text before the request is
forwarded to the model. Extraction runs entirely in the gateway; nothing is sent
to an external service.

| Attachment                         | Result                                   |
| ---------------------------------- | ---------------------------------------- |
| PDF with a text layer              | Replaced with its text, page by page     |
| `.docx` (body, headers, footers, footnotes, comments) | Replaced with its text |
| `.xlsx` (every sheet, tab-separated) | Replaced with its text                 |
| `.pptx` (slides and speaker notes) | Replaced with its text                   |
| txt, csv, md, json, xml, html      | Replaced with its text                   |
| Images, scanned PDFs, `.doc`/`.xls`, file IDs/URLs | Blocked with a 422       |

Request shapes handled: OpenAI chat (`file` parts), OpenAI Responses
(`input_file`), and Anthropic Messages (`document` blocks), including documents
inside Anthropic `tool_result` blocks.

Options (in `config/policies.json`):

- `onUnsupported`: `"block"` (default) or `"allow"`. `allow` forwards
  attachments it cannot read without scanning them.
- `maxFileBytes`: decoded size limit per attachment (default 20 MB).

To enable it, add `attachment-text-extraction-inbound` to the app's policy chain
in the Zuplo Portal **immediately before** `ai-gateway-dlp-inbound`. Each
response then carries an `x-attachment-scan` header listing what happened to
each file.

### Demo

`demo/fixtures/` holds sample files with fake card numbers and IBANs:

| File                    | Expected                     |
| ----------------------- | ---------------------------- |
| `statement.pdf`         | Scanned; card and IBAN masked |
| `loan-application.docx` | Scanned; card and IBAN masked |
| `customers.xlsx`        | Scanned; cards and IBANs masked |
| `scanned-contract.pdf`  | Blocked (no text layer)      |
| `receipt-photo.png`     | Blocked (image)              |

```bash
export APP_ID=<app_id> ZUPLO_APP_API_KEY=<key> MODEL=<provider/model>
node demo/send.mjs demo/fixtures/loan-application.docx
node demo/send.mjs demo/fixtures/customers.xlsx --anthropic
node demo/send.mjs demo/fixtures/scanned-contract.pdf
```

Run each request once with the extraction policy in the chain and once without
it to show the difference: without it the file reaches the model unmasked.

## Debugging

In VS Code, open **Run and Debug**, select **Launch & Attach Zuplo**, and click
the green play button.

For other editors and more details, see the
[debugging guide](https://zuplo.com/docs/articles/local-development-debugging).

## Deploying

Connect the project to source control in the Zuplo Portal. Pushes to your
default branch deploy the gateway to production.

## Learn More

To learn more about the AI Gateway, visit the
[AI Gateway documentation](https://zuplo.com/docs/ai-gateway/overview).

To connect with the community join [Discord](https://discord.zuplo.com).
