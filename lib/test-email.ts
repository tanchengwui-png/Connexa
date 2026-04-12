import path from "node:path";
import { renderEmailTemplate } from "@/lib/email-template";
import { sendEmail } from "@/lib/mail";

export async function sendBrandedTestEmail(to: string) {
  const logoPath = path.join(process.cwd(), "public", "recurvos-connexa-logo-design.png");

  await sendEmail({
    to,
    subject: "Connexa email design test",
    text: [
      "This is a branded test email from Connexa.",
      "",
      "If you received this message, SMTP delivery and the embedded logo are working."
    ].join("\n"),
    html: renderEmailTemplate({
      preheader: "Connexa branded email test.",
      eyebrow: "Email preview",
      title: "Connexa email test",
      intro: "This is a test email sent from your current SMTP configuration.",
      logoSrc: "cid:connexa-logo",
      footerNote: "Use this message to review branding, spacing, and rendering in your inbox.",
      bodyHtml: `
        <p style="margin:0 0 16px">
          If you received this email, SMTP delivery is working and the logo is being embedded correctly.
        </p>
        <div style="margin:0 0 24px;padding:16px 18px;border:1px solid #dbe7ff;border-radius:16px;background:#f7fbff">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5f7699;margin-bottom:8px">Checklist</div>
          <div style="color:#12233d">Logo visible</div>
          <div style="color:#12233d;margin-top:6px">Header spacing tightened</div>
          <div style="color:#12233d;margin-top:6px">SMTP delivery confirmed</div>
        </div>
      `
    }),
    attachments: [
      {
        filename: "recurvos-connexa-logo-design.png",
        path: logoPath,
        cid: "connexa-logo"
      }
    ]
  });
}
