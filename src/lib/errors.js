/**
 * supabase.functions.invoke() only gives a generic "non-2xx status code"
 * message on the `error` object when the function itself returns an error
 * response - the actual reason (e.g. "Only an Admin can invite new staff")
 * is in the response body, reachable via error.context. This digs it out,
 * falling back to the generic message if that's not possible for some reason.
 */
export async function extractFunctionErrorMessage(error, fallbackData) {
  if (fallbackData?.error) return fallbackData.error;
  if (error?.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.clone().json();
      if (body?.error) return body.error;
    } catch (e) {
      // context wasn't JSON - fall through to the generic message
    }
  }
  return error?.message || "Unknown error.";
}
