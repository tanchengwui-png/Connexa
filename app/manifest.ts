import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Connexa",
    short_name: "Connexa",
    description:
      "Shared WhatsApp inbox for property agency teams handling enquiries, follow-ups, and team handoffs.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#07111b",
    theme_color: "#07111b",
    icons: [
      {
        src: "/connexa-favicon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
