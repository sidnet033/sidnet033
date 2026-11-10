// Who may use the app, and how they must sign in:
//  - only @paikane.com accounts
//  - only via Google (the user's Pai Kane Google Workspace account), so a
//    session on a new device always means Google confirmed the person
// Enforced in the proxy (every request) and the OAuth callback.
export const ALLOWED_DOMAIN = "paikane.com";

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

/** true when the session's access token says it was created by an OAuth
 * (Google) sign-in, not a password / email link */
export function signedInWithGoogle(accessToken: string | null | undefined) {
  if (!accessToken) return false;
  try {
    const part = accessToken.split(".")[1];
    const json = JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { amr?: { method?: string }[] };
    return (json.amr ?? []).some((a) => a.method === "oauth");
  } catch {
    return false;
  }
}

export const LOGIN_ERRORS: Record<string, string> = {
  domain: `Use your @${ALLOWED_DOMAIN} Google account to sign in.`,
  google: "Please sign in with your Pai Kane Google account.",
  not_invited:
    "Your account hasn't been set up yet. Ask an admin to invite you, then sign in with Google.",
  disabled: "Your account has been disabled. Contact an admin.",
  failed: "Google sign-in didn't complete. Please try again.",
};
