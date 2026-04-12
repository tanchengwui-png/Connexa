import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";

function getRequiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} environment variable.`);
  }

  return value;
}

function createTransport() {
  return nodemailer.createTransport({
    host: getRequiredEnv("SMTP_HOST"),
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: getRequiredEnv("SMTP_USER"),
      pass: getRequiredEnv("SMTP_PASS")
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
  const transporter = createTransport();

  await transporter.sendMail({
    from: getRequiredEnv("SMTP_FROM"),
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    attachments: input.attachments
  });
}
