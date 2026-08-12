export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
