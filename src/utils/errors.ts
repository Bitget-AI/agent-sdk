import {
  classify,
  decodeError,
  type ErrorCategory,
} from "./error-catalog.js";

export type ErrorType =
  | "ConfigError"
  | "AuthenticationError"
  | "RateLimitError"
  | "ValidationError"
  | "BitgetApiError"
  | "NetworkError"
  | "InternalError";

export interface ToolErrorPayload {
  ok: false;
  error: {
    type: ErrorType;
    code?: string;
    /** Coarse machine-readable bucket the LLM branches on (P1). */
    category: ErrorCategory;
    message: string;
    suggestion?: string;
    /** True when the same call may succeed after a short backoff. */
    retryable: boolean;
    endpoint?: string;
  };
  timestamp: string;
}

export class BitgetMcpError extends Error {
  public readonly type: ErrorType;
  public readonly code?: string;
  public readonly suggestion?: string;
  public readonly endpoint?: string;

  public constructor(
    type: ErrorType,
    message: string,
    options?: {
      code?: string;
      suggestion?: string;
      endpoint?: string;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = type;
    this.type = type;
    this.code = options?.code;
    this.suggestion = options?.suggestion;
    this.endpoint = options?.endpoint;
  }
}

export class ConfigError extends BitgetMcpError {
  public constructor(message: string, suggestion?: string) {
    super("ConfigError", message, { suggestion });
  }
}

export class ValidationError extends BitgetMcpError {
  public constructor(message: string, suggestion?: string) {
    super("ValidationError", message, { suggestion });
  }
}

export class RateLimitError extends BitgetMcpError {
  public constructor(message: string, suggestion?: string, endpoint?: string) {
    super("RateLimitError", message, { suggestion, endpoint });
  }
}

export class AuthenticationError extends BitgetMcpError {
  public constructor(message: string, suggestion?: string, endpoint?: string) {
    super("AuthenticationError", message, { suggestion, endpoint });
  }
}

export class BitgetApiError extends BitgetMcpError {
  public constructor(
    message: string,
    options?: {
      code?: string;
      suggestion?: string;
      endpoint?: string;
      cause?: unknown;
    },
  ) {
    super("BitgetApiError", message, options);
  }
}

export class NetworkError extends BitgetMcpError {
  public constructor(message: string, endpoint?: string, cause?: unknown) {
    super("NetworkError", message, {
      endpoint,
      cause,
      suggestion:
        "Please check network connectivity and retry the request in a few seconds.",
    });
  }
}

export function toToolErrorPayload(
  error: unknown,
  fallbackEndpoint?: string,
): ToolErrorPayload {
  if (error instanceof BitgetMcpError) {
    const { category, retryable } = classify(error.type, error.code);
    return {
      ok: false,
      error: {
        type: error.type,
        code: error.code,
        category,
        message: error.message,
        suggestion: error.suggestion ?? decodeError(error.code)?.suggestion,
        retryable,
        endpoint: error.endpoint ?? fallbackEndpoint,
      },
      timestamp: new Date().toISOString(),
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      type: "InternalError",
      category: "unknown",
      message,
      suggestion:
        "Unexpected server error. Check tool arguments and retry. If it persists, inspect server logs.",
      retryable: false,
      endpoint: fallbackEndpoint,
    },
    timestamp: new Date().toISOString(),
  };
}
