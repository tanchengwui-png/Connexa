declare module "web-push" {
  export function sendNotification(
    subscription: unknown,
    payload?: string | Buffer | null,
    options?: Record<string, unknown>
  ): Promise<unknown>;

  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string
  ): void;

  const webPush: {
    sendNotification: typeof sendNotification;
    setVapidDetails: typeof setVapidDetails;
  };

  export default webPush;
}
