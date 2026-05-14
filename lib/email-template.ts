import { getResolvedPlatformEmailConfig } from "@/lib/platform-config";

type EmailTemplateInput = {
  preheader?: string;
  eyebrow: string;
  title: string;
  intro: string;
  bodyHtml: string;
  footerNote?: string;
  logoSrc?: string;
};

export async function renderEmailTemplate(input: EmailTemplateInput) {
  const config = await getResolvedPlatformEmailConfig();
  const brandName = config.emailBrandName;
  const brandTagline = config.emailBrandTagline;
  const supportEmail = config.supportEmail || config.smtpFrom || "Connexa <no-reply@connexa.local>";
  const logoSrc = input.logoSrc ?? "cid:connexa-logo";

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">
      ${input.preheader ?? input.intro}
    </div>
    <div style="margin:0;padding:24px 12px;background:#07111b;font-family:Arial,sans-serif;color:#ffffff">
      <div style="max-width:560px;margin:0 auto;border:1px solid rgba(255,255,255,0.08);border-radius:24px;overflow:hidden;background:linear-gradient(180deg,rgba(10,23,36,0.96),rgba(9,19,29,0.98));box-shadow:0 30px 100px rgba(0,0,0,0.28)">
        <div style="padding:12px 28px 4px;color:#ffffff">
          <div style="text-align:center">
            <img
              alt="${brandName}"
              src="${logoSrc}"
              style="display:block;width:300px;max-width:100%;height:auto;margin:0 auto"
            />
            <div style="display:inline-block;margin-top:4px;padding:8px 14px;border:1px solid rgba(52,211,153,0.18);border-radius:999px;background:rgba(52,211,153,0.12);font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#bbf7d0">${input.eyebrow}</div>
            <h1 style="margin:14px 0 0;font-size:26px;line-height:1.2;color:#ffffff">${input.title}</h1>
          </div>
        </div>
        <div style="padding:14px 32px 32px">
          <p style="margin:0 0 16px;color:#ffffff">${input.intro}</p>
          ${input.bodyHtml}
        </div>
        <div style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:#cbd5e1;font-size:13px;line-height:1.6">
          <div style="font-weight:700;color:#ffffff;margin-bottom:4px">${brandName}</div>
          <div>${brandTagline}</div>
          ${input.footerNote ? `<div style="margin-top:8px">${input.footerNote}</div>` : ""}
          <div style="margin-top:8px">Support: ${supportEmail}</div>
        </div>
      </div>
    </div>
  `;
}
