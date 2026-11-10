"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_DOMAIN, LOGIN_ERRORS } from "@/lib/auth-policy";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

// Sign-in is Google only, with the user's @paikane.com Workspace account.
function LoginForm() {
  const searchParams = useSearchParams();
  const errorKey = searchParams.get("error");
  const [error, setError] = useState<string | null>(
    errorKey ? (LOGIN_ERRORS[errorKey] ?? LOGIN_ERRORS.failed) : null,
  );
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    setError(null);
    const next = searchParams.get("next") || "/";
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        // only offer @paikane.com accounts on Google's account picker
        queryParams: { hd: ALLOWED_DOMAIN, prompt: "select_account" },
      },
    });
    if (error) {
      setLoading(false);
      setError(error.message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50/70 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200/90 bg-white p-8 shadow-xs">
        <div className="mb-1 flex items-center gap-2 text-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/truequote-logo.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-lg"
          />
          <h1 className="font-display text-xl font-semibold">TrueQuote LV</h1>
        </div>
        <p className="mb-6 text-sm text-slate-500">
          Sign in with your <b>@{ALLOWED_DOMAIN}</b> Google account.
        </p>

        <button
          type="button"
          onClick={signIn}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-xs hover:bg-slate-50 disabled:opacity-50"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#FFC107"
              d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
            />
            <path
              fill="#FF3D00"
              d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
            />
            <path
              fill="#4CAF50"
              d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
            />
            <path
              fill="#1976D2"
              d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
            />
          </svg>
          {loading ? "Opening Google…" : "Sign in with Google"}
        </button>

        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

        <p className="mt-6 text-xs text-slate-400">
          Only invited Pai Kane users can sign in. Ask an admin if you need
          access.
        </p>
      </div>
    </div>
  );
}
