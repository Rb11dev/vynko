export class ApiError extends Error {
  status: number; code: string; field?: string;
  constructor(status: number, code: string, message: string, field?: string) {
    super(message); this.status = status; this.code = code; this.field = field;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong. Please try again.', e?.field);
  }
  return data as T;
}
export const get = <T,>(p: string) => api<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T,>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T,>(p: string, b?: unknown) => api<T>('DELETE', p, b);
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
