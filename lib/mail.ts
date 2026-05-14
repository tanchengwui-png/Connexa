import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import { getResolvedPlatformEmailConfig } from "@/lib/platform-config";

async function createTransport() {
  const config = await getResolvedPlatformEmailConfig();

  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) {
    throw new Error("SMTP is not configured.");
  }

  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    }
  });
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: Mail.Attachment[];
}) {
  const transporter = await createTransport();
  const config = await getResolvedPlatformEmailConfig();

  if (!config.smtpFrom) {
    throw new Error("SMTP from address is not configured.");
  }

  await transporter.sendMail({
    from: config.smtpFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments
  });
}
