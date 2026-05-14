declare module "qrcode" {
  const QRCode: {
    toDataURL(input: string, options?: Record<string, unknown>): Promise<string>;
  };

  export default QRCode;
}
