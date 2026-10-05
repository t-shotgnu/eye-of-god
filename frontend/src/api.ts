export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method, signal, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error(`Server returned HTTP ${response.status}. Reload and try again.`); }
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Request failed (HTTP ${response.status}).`);
  return data as T;
}
