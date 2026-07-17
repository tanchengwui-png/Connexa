import type { Metadata } from "next";
import { ConfirmationProvider } from "@/components/confirmation-provider";
import { PwaRegistration } from "@/components/pwa-registration";
import { SessionExpiryRedirect } from "@/components/session-expiry-redirect";
import { ToastProvider } from "@/components/toast-provider";
import "sequential-workflow-designer/css/designer.css";
import "sequential-workflow-designer/css/designer-dark.css";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Connexa",
  title: "Connexa",
  description: "Shared WhatsApp inbox for property agency teams handling enquiries, follow-ups, and team handoffs.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Connexa"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    apple: "/apple-icon",
    icon: "/icon"
  }
};

export const viewport = {
  themeColor: "#f5f7ff"
};

const themeBootstrapScript = `
  (function () {
    var storageKey = "connexa.theme";
    var forceLightTheme = function () {
      try {
        window.localStorage.setItem(storageKey, "light");
      } catch (error) {}

      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
    };

    try {
      forceLightTheme();
      var observer = new MutationObserver(function () {
        if (document.documentElement.dataset.theme !== "light") {
          forceLightTheme();
        }
      });

      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });
    } catch (error) {
      forceLightTheme();
    }
  })();
`;

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-theme="light" lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <SessionExpiryRedirect />
        <PwaRegistration />
        <ToastProvider>
          <ConfirmationProvider>{children}</ConfirmationProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
