export async function managerRequest<T>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error ?? 'Request failed.');
  return result as T;
}
