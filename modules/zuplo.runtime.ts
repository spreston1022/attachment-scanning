import type { RuntimeExtensions } from "@zuplo/runtime";

/**
 * `runtimeInit` runs once when your gateway boots. Use it to register plugins
 * and lifecycle hooks. Docs:
 * https://zuplo.com/docs/programmable-api/runtime-extensions
 */
export function runtimeInit(runtime: RuntimeExtensions) {
  // `runtime` is unused until you enable a plugin below. This reference keeps
  // linters from flagging it; delete it once you call `runtime.addPlugin`.
  void runtime;

  // --- OpenTelemetry tracing (optional) ------------------------------------
  // Send traces to Zuplo's built-in tracing. This can also be configured to
  // send traces to a third-party service such as Honeycomb, Grafana, and
  // others. Docs: https://zuplo.com/docs/articles/opentelemetry
  //
  // To enable, run `npm install @zuplo/otel`, then import `OpenTelemetryPlugin`
  // from "@zuplo/otel" and `environment` from "@zuplo/runtime":
  // const isWorkingCopy =
  //   environment.ZUPLO_ENVIRONMENT_STAGE === "working-copy";
  // runtime.addPlugin(
  //   new OpenTelemetryPlugin({
  //     sampling: {
  //       headSampler: { ratio: isWorkingCopy ? 1 : 0.1 },
  //     },
  //   }),
  // );
  // --- Logging (optional) --------------------------------------------------
  // Ship request logs to Datadog. Other log integrations (New Relic, Splunk,
  // Loki, Dynatrace, and others) follow the same pattern — see the logging
  // overview at https://zuplo.com/docs/articles/logging.
  // Docs: https://zuplo.com/docs/articles/log-plugin-datadog
  //
  // To enable, import the plugin and `environment` from "@zuplo/runtime":
  // runtime.addPlugin(
  //   new DataDogLoggingPlugin({
  //     apiKey: environment.DATADOG_API_KEY,
  //     source: "my-ai-gateway",
  //   }),
  // );
}
