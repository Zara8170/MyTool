"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  id: string;
  label: string;
}

export function RevokeButton({ id, label }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (
      !confirm(
        `Sign out "${label}"? That device will need to log in again to use mytool.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code: string; message: string };
        };
        alert(body.error?.message ?? "Failed to revoke session");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="text-xs px-2 py-1 rounded border border-red-900 text-red-300 hover:bg-red-950/40 disabled:opacity-50 whitespace-nowrap"
    >
      {busy ? "..." : "Revoke"}
    </button>
  );
}
