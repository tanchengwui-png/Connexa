import type { Metadata } from "next";
import { ConfirmationProvider } from "@/components/confirmation-provider";
import { ToastProvider } from "@/components/toast-provider";
import "sequential-workflow-designer/css/designer.css";
import "sequential-workflow-designer/css/designer-dark.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Connexa",
  description: "Shared WhatsApp inbox for property agency teams handling enquiries, follow-ups, and team handoffs."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <ConfirmationProvider>{children}</ConfirmationProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
