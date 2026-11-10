import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail, signedInWithGoogle } from "@/lib/auth-policy";

// /auth/callback is where Google sign-in lands before a session exists.
const PUBLIC_PATHS = ["/login", "/set-password", "/auth/callback"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Google-only, @paikane.com-only: any other session (old password login,
  // an invite email link, a non-company account) is signed out.
  if (user && !isPublic) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const reason = !isAllowedEmail(user.email)
      ? "domain"
      : !signedInWithGoogle(session?.access_token)
        ? "google"
        : null;
    if (reason) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = `?error=${reason}`;
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    }
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Phones opening the dashboard go to the phone-friendly view (/m).
  // "Desktop site" (/?desktop=1) remembers the choice; opening /m again
  // clears it.
  if (user) {
    const path = request.nextUrl.pathname;
    if (path === "/" && request.nextUrl.searchParams.get("desktop") === "1") {
      response.cookies.set("prefer_desktop", "1", {
        path: "/",
        maxAge: 60 * 60 * 24 * 180,
      });
    } else if (
      path === "/" &&
      request.cookies.get("prefer_desktop")?.value !== "1" &&
      /Mobi|Android|iPhone|iPod/i.test(request.headers.get("user-agent") ?? "")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/m";
      url.search = "";
      const redirect = NextResponse.redirect(url);
      response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      return redirect;
    } else if (path === "/m" && request.cookies.get("prefer_desktop")) {
      response.cookies.delete("prefer_desktop");
    }
  }

  return response;
}
