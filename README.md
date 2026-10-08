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
