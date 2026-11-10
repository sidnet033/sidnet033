import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /set-password is where invite and password-reset email links land. At
// that point the browser hasn't established a session cookie yet (the
// tokens arrive in the URL fragment, which supabase-js only picks up
// client-side), so this route must not be gated the normal way or the
// middleware would redirect the user away before that happens.
const PUBLIC_PATHS = ["/login", "/set-password"];

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
