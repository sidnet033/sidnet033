import { redirect } from "next/navigation";

// Old name of the "How it works" page -- kept so existing links still land.
export default function DimensionsMasterPage() {
  redirect("/how-it-works#dimensions");
}
