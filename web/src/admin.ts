export interface AdminMe {
  authenticated: boolean;
  username?: string;
}

export async function adminMe(): Promise<AdminMe> {
  try {
    const res = await fetch('/api/admin/me', { credentials: 'same-origin' });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as AdminMe;
  } catch {
    return { authenticated: false };
  }
}

export type AdminDumpResult = { ok: true; id: number } | { ok: false; error: string };

export async function adminDumpRoom(roomId: number, note?: string): Promise<AdminDumpResult> {
  try {
    const res = await fetch(`/api/admin/rooms/${roomId}/dump`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note ?? '' }),
    });
    const data = (await res.json()) as { ok?: boolean; id?: number; error?: string };
    if (data.ok === true && typeof data.id === 'number') return { ok: true, id: data.id };
    return { ok: false, error: data.error ?? 'Dump failed' };
  } catch {
    return { ok: false, error: 'Dump failed' };
  }
}
