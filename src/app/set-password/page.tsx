import { redirect } from "next/navigation";

// Passwords are no longer used: sign-in is Google only (@paikane.com).
// Old invite / reset links that point here go to the login page.
export default function SetPasswordPage() {
  redirect("/login");
}
