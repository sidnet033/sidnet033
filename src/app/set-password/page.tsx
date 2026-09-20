"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/icon";

export default function SetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <SetPasswordForm />
    </Suspense>
  );
}

function SetPasswordForm() {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (settled) return;
      if (session) {
        settled = true;
        setStatus("ready");
      }
    });

    // The invite/reset link's session is established from the URL by the
    // time getSession() resolves in practice, but the listener above is
    // the primary signal -- this is just a fallback for that first check.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!settled && session) {
        settled = true;
        setStatus("ready");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setStatus("invalid");
      }
    }, 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setSaving(false);
      setError(error.message);
      return;
    }
    // no-ops for a plain password reset (status is already "active");
    // flips an invited user's row to "active" for the Users table label
    await supabase.rpc("accept_invite");
    setSaving(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/70">
      <div className="w-full max-w-sm rounded-xl border border-slate-200/90 bg-white p-8 shadow-xs">
        <div className="mb-1 flex items-center gap-2 text-slate-900">
          <Icon name="bolt" size={22} className="text-slate-700" />
          <h1 className="font-display text-xl font-semibold">AmpQuote LV</h1>
        </div>

        {status === "checking" && <p className="mt-4 text-sm text-slate-500">Checking your link...</p>}

        {status === "invalid" && (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-rose-600">
              This link is invalid or has expired. Ask your admin to send a new invite or password reset.
            </p>
          </div>
        )}

        {status === "ready" && (
          <>
            <p className="mb-6 text-sm text-slate-500">Choose a password for your account.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Confirm password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              {error && <p className="text-sm text-rose-600">{error}</p>}

              <button
                type="submit"
                disabled={saving}
                className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Set password & continue"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
