import type { MetadataRoute } from "next";

// "Add to Home Screen": opens the phone-friendly projects list.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TrueQuote",
    short_name: "TrueQuote",
    start_url: "/m",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#154b91",
    icons: [{ src: "/truequote-logo.png", sizes: "any", type: "image/png" }],
  };
}
