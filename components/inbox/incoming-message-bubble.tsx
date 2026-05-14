type IncomingMessageBubbleProps = {
  attachmentMimeType?: string | null;
  attachmentName?: string | null;
  attachmentUrl?: string | null;
  body: string;
  direction: "inbound" | "outbound";
  canDelete?: boolean;
  id: string;
  isConnexaOutbound?: boolean;
  isDeleted?: boolean;
  onDelete?: (messageId: string) => void;
  onReply?: (messageId: string) => void;
  replyToMessage?: {
    sender: string | null;
    body: string | null;
    attachmentName: string | null;
  } | null;
  reactions?: Array<{
    id: string;
    emoji: string;
    sender: string;
    sentAtIso: string;
  }>;
  sender: string;
  sentAt: string;
};

export function IncomingMessageBubble({
  attachmentMimeType,
  attachmentName,
  attachmentUrl,
  body,
  canDelete = false,
  direction,
  id,
  isConnexaOutbound = false,
  isDeleted = false,
  onDelete,
  onReply,
  reactions = [],
  replyToMessage,
  sender,
  sentAt
}: IncomingMessageBubbleProps) {
  const resolvedAttachmentUrl = resolveAttachmentUrl(attachmentUrl);
  const parsedBody = parseInteractiveBody(isDeleted ? "" : body);
  const attachmentKind = getAttachmentKind(attachmentMimeType);
  const shouldHidePlaceholderBody = !parsedBody.kind && shouldHideSyncedPlaceholderBody(parsedBody.text, resolvedAttachmentUrl);
  const outboundClassName = direction === "outbound" ? (isConnexaOutbound ? "connexa" : "external") : "";
  const outboundLabel =
    direction === "outbound"
      ? isConnexaOutbound
        ? "Sent via Connexa"
        : "Sent outside Connexa"
      : "Received";
  const reactionSummary = summarizeReactions(reactions);

  return (
    <div className={`chat-bubble-row ${direction}`}>
      <div className={`chat-bubble ${direction} ${outboundClassName}`.trim()}>
        <div className="chat-bubble-sender">{sender}</div>
        {!isDeleted && replyToMessage ? (
          <div className="chat-bubble-reply-context">
            <span>{replyToMessage.sender ?? "Previous message"}</span>
            <strong>
              {replyToMessage.body?.trim()
                ? renderWhatsAppFormattedText(replyToMessage.body.trim())
                : replyToMessage.attachmentName || "Attachment"}
            </strong>
          </div>
        ) : null}
        {resolvedAttachmentUrl ? (
          <div className="chat-bubble-attachment-wrap">
            {attachmentKind === "image" ? (
              <a className="chat-bubble-image-link" href={resolvedAttachmentUrl} rel="noreferrer" target="_blank">
                <img
                  alt={attachmentName ?? "Image attachment"}
                  className="chat-bubble-image"
                  loading="lazy"
                  src={resolvedAttachmentUrl}
                />
              </a>
            ) : null}
            {attachmentKind === "audio" ? (
              <audio className="chat-bubble-audio" controls preload="metadata" src={resolvedAttachmentUrl}>
                Your browser does not support audio playback.
              </audio>
            ) : null}
            {attachmentKind === "video" ? (
              <video
                className="chat-bubble-video"
                controls
                playsInline
                preload="metadata"
                src={resolvedAttachmentUrl}
              >
                Your browser does not support video playback.
              </video>
            ) : null}
            <a className="chat-bubble-attachment" href={resolvedAttachmentUrl} rel="noreferrer" target="_blank">
              <span>{getAttachmentLabel(attachmentKind)}</span>
              <strong>{attachmentName ?? "Open file"}</strong>
            </a>
            <div className="chat-bubble-attachment-actions">
              <a className="chat-bubble-action chat-bubble-action-link" href={resolvedAttachmentUrl} rel="noreferrer" target="_blank">
                Open
              </a>
              <a
                className="chat-bubble-action chat-bubble-action-link"
                download={attachmentName ?? true}
                href={resolvedAttachmentUrl}
              >
                Download
              </a>
            </div>
          </div>
        ) : null}
        {isDeleted ? <div className="chat-bubble-deleted">Message deleted for everyone</div> : null}
        {parsedBody.text && !shouldHidePlaceholderBody ? (
          <div className="chat-bubble-body">{renderWhatsAppFormattedText(parsedBody.text)}</div>
        ) : null}
        {parsedBody.kind ? (
          <div className="chat-bubble-interactive">
            <div className="chat-bubble-interactive-label">
              {parsedBody.kind === "buttons" ? "Reply buttons" : parsedBody.actionLabel || "Choose option"}
            </div>
            <div className="chat-bubble-interactive-options">
              {parsedBody.options.map((option) => (
                <div className="chat-bubble-interactive-option" key={option}>
                  {option}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!isDeleted && reactionSummary.length ? (
          <div className="chat-bubble-reactions">
            {reactionSummary.map((reaction) => (
              <div className="chat-bubble-reaction" key={reaction.emoji} title={reaction.senders.join(", ")}>
                <span>{reaction.emoji}</span>
                {reaction.count > 1 ? <strong>{reaction.count}</strong> : null}
              </div>
            ))}
          </div>
        ) : null}
        <div className="chat-meta">
          <span>{outboundLabel}</span>
          <span>{sentAt}</span>
        </div>
        {!isDeleted && (onReply || (onDelete && canDelete)) ? (
          <div className="chat-bubble-actions">
            {onReply ? (
              <button className="chat-bubble-action" onClick={() => onReply(id)} type="button">
                Reply
              </button>
            ) : null}
            {onDelete && canDelete ? (
              <button className="chat-bubble-action" onClick={() => onDelete(id)} type="button">
                Delete
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function getAttachmentKind(mimeType?: string | null) {
  if (!mimeType) {
    return "file" as const;
  }

  if (mimeType.startsWith("image/")) {
    return "image" as const;
  }

  if (mimeType.startsWith("audio/")) {
    return "audio" as const;
  }

  if (mimeType.startsWith("video/")) {
    return "video" as const;
  }

  return "file" as const;
}

function getAttachmentLabel(kind: ReturnType<typeof getAttachmentKind>) {
  if (kind === "image") {
    return "Image";
  }

  if (kind === "audio") {
    return "Audio";
  }

  if (kind === "video") {
    return "Video";
  }

  return "Attachment";
}

function parseInteractiveBody(body: string) {
  const normalizedBody = body.replace(/\r\n/g, "\n").trim();

  const listMarkerMatch = normalizedBody.match(/\[List:\s*(.+?)\]/);
  if (listMarkerMatch) {
    const marker = listMarkerMatch[0];
    const markerIndex = normalizedBody.indexOf(marker);
    const text = normalizedBody.slice(0, markerIndex).trim();
    const options = extractNumberedOptions(normalizedBody.slice(markerIndex + marker.length));

    if (options.length) {
      return {
        text,
        kind: "list" as const,
        actionLabel: listMarkerMatch[1].trim(),
        options
      };
    }
  }

  const buttonsMarker = "[Buttons]";
  const buttonsMarkerIndex = normalizedBody.indexOf(buttonsMarker);
  if (buttonsMarkerIndex >= 0) {
    const text = normalizedBody.slice(0, buttonsMarkerIndex).trim();
    const options = extractNumberedOptions(
      normalizedBody.slice(buttonsMarkerIndex + buttonsMarker.length)
    );

    if (options.length) {
      return {
        text,
        kind: "buttons" as const,
        actionLabel: null,
        options
      };
    }
  }

  return {
    text: normalizedBody,
    kind: null,
    actionLabel: null,
    options: [] as string[]
  };
}

function extractNumberedOptions(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);
}

function resolveAttachmentUrl(url?: string | null) {
  const normalizedUrl = url?.trim();
  if (!normalizedUrl) {
    return null;
  }

  if (normalizedUrl.startsWith("/uploads/")) {
    return `/api${normalizedUrl}`;
  }

  return normalizedUrl;
}

function shouldHideSyncedPlaceholderBody(body: string, attachmentUrl: string | null) {
  const normalized = body.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/^\[\s*\]$/.test(normalized)) {
    return true;
  }

  if (attachmentUrl) {
    return [
      "[image]",
      "[video]",
      "[audio]",
      "[document]",
      "[media]",
      "[file]",
      "[attachment]",
      "[unsupported message]"
    ].includes(normalized);
  }

  return ["[unsupported message]"].includes(normalized);
}

function renderWhatsAppFormattedText(text: string) {
  const segments = text.split(/(\*[^*\n][^*\n]*\*)/g);

  return segments.map((segment, index) => {
    if (/^\*[^*\n][^*\n]*\*$/.test(segment)) {
      return <strong key={index}>{segment.slice(1, -1)}</strong>;
    }

    return segment;
  });
}

function summarizeReactions(reactions: NonNullable<IncomingMessageBubbleProps["reactions"]>) {
  const summary = new Map<string, { emoji: string; count: number; senders: string[] }>();

  for (const reaction of reactions) {
    const current = summary.get(reaction.emoji) ?? { emoji: reaction.emoji, count: 0, senders: [] };
    current.count += 1;
    if (!current.senders.includes(reaction.sender)) {
      current.senders.push(reaction.sender);
    }
    summary.set(reaction.emoji, current);
  }

  return Array.from(summary.values());
}
