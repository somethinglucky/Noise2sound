export interface AccountInfo {
  email: string;
  premium: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, opts: { body?: unknown; token?: string; method?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new ApiError(res.status, typeof json.error === "string" ? json.error : "Something went wrong. Please try again.");
  return json as T;
}

export const api = {
  requestLogin: (email: string) => call<{ ok: true }>("/api/auth/request", { body: { email } }),
  verifyCode: (email: string, code: string) => call<{ token: string; user: AccountInfo }>("/api/auth/verify", { body: { email, code } }),
  verifyToken: (token: string) => call<{ token: string; user: AccountInfo }>("/api/auth/verify", { body: { token } }),
  me: (token: string) => call<AccountInfo>("/api/me", { token }),
  checkout: (token: string) => call<{ url?: string; alreadyPremium?: boolean }>("/api/checkout", { method: "POST", token, body: {} }),
  logout: (token: string) => call<{ ok: true }>("/api/auth/logout", { method: "POST", token, body: {} }),
};
