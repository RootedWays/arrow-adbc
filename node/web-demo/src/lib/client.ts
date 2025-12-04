export type RequestConfig<TData = unknown> = {
  url: string;
  method: "GET" | "PUT" | "POST" | "DELETE" | "OPTIONS" | "PATCH";
  params?: unknown;
  data?: TData;
  responseType?: "json" | "blob" | "text" | "arraybuffer";
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type ResponseErrorConfig<TError = Error> = TError; // Make generic with default

export const client = async <TData, TVariables = unknown>(
  config: RequestConfig<TVariables>,
): Promise<{ data: TData }> => {
  const baseUrl = "http://localhost:8080";
  const url = new URL(config.url, baseUrl);

  if (config.params) {
    Object.entries(config.params as Record<string, string>).forEach(
      ([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      },
    );
  }

  const response = await fetch(url.toString(), {
    method: config.method,
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: config.data ? JSON.stringify(config.data) : undefined,
    signal: config.signal,
  });

  if (!response.ok) {
    throw new Error(
      `Request failed: ${response.status} ${response.statusText}`,
    );
  }

  // Simple content-type check
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    const data = await response.json();
    return { data };
  } else if (
    contentType?.includes("application/vnd.apache.arrow.stream") ||
    contentType?.includes("application/octet-stream")
  ) {
    // For Arrow streams, we might want ArrayBuffer
    const buffer = await response.arrayBuffer();
    return { data: buffer as unknown as TData };
  }

  // Default to text or empty
  const text = await response.text();
  try {
    return { data: text ? JSON.parse(text) : {} };
  } catch {
    return { data: text as unknown as TData };
  }
};

export default client;
