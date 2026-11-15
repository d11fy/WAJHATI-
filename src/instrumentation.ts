import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (_error, _request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportOperationalError } = await import("@/server/ops/report");
    await reportOperationalError("request_error", context.routeType.toLowerCase());
  }
};
