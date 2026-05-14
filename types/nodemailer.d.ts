declare module "nodemailer" {
  type TransportOptions = {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };

  type SendMailOptions = {
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
    attachments?: import("nodemailer/lib/mailer").Attachment[];
  };

  type Transporter = {
    sendMail(options: SendMailOptions): Promise<unknown>;
  };

  const nodemailer: {
    createTransport(options: TransportOptions): Transporter;
  };

  export default nodemailer;
}

declare module "nodemailer/lib/mailer" {
  export type Attachment = {
    filename?: string;
    path?: string;
    cid?: string;
    contentType?: string;
    content?: string | Buffer;
    [key: string]: unknown;
  };
}
