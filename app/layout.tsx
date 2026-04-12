import type { Metadata } from "next";
import { ConfirmationProvider } from "@/components/confirmation-provider";
import { ToastProvider } from "@/components/toast-provider";
import { Inter, Space_Grotesk } from "next/font/google";
import "sequential-workflow-designer/css/designer.css";
import "sequential-workflow-designer/css/designer-dark.css";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

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
      <body className={`${inter.variable} ${spaceGrotesk.variable}`}>
        <ToastProvider>
          <ConfirmationProvider>{children}</ConfirmationProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
