type IncomingMessageBubbleProps = {
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  body: string;
  direction: "inbound" | "outbound";
  sender: string;
  sentAt: string;
};

export function IncomingMessageBubble({
  attachmentMimeType,
  attachmentName,
  attachmentUrl,
  body,
  direction,
  sender,
  sentAt
}: IncomingMessageBubbleProps) {
  return (
    <div className={`chat-bubble-row ${direction}`}>
      <div className={`chat-bubble ${direction}`}>
        <div className="chat-bubble-sender">{sender}</div>
        {attachmentUrl ? (
          <a className="chat-bubble-attachment" href={attachmentUrl} rel="noreferrer" target="_blank">
            <span>{attachmentMimeType?.startsWith("image/") ? "Image" : "Attachment"}</span>
            <strong>{attachmentName ?? "Open file"}</strong>
          </a>
        ) : null}
        <div className="chat-bubble-body">{body}</div>
        <div className="chat-meta">
          <span>{direction === "outbound" ? "Sent" : "Received"}</span>
          <span>{sentAt}</span>
        </div>
      </div>
    </div>
  );
}
