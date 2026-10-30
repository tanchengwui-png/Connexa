"use client";

import { useEffect, useState, type ReactNode } from "react";

type ContactAvatarProps = {
  className: string;
  fallback: ReactNode;
  profilePicUrl: string | null;
};

export function ContactAvatar({ className, fallback, profilePicUrl }: ContactAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    setImageFailed(false);
    setRetryAttempt(0);
  }, [profilePicUrl]);

  useEffect(() => {
    if (!profilePicUrl || !imageFailed || retryAttempt >= 2) {
      return;
    }

    // Profile pictures are cached locally by the sync worker. A browser can
    // briefly request the URL before that file becomes available, or retain a
    // transient failed image request. Retry with a cache-busting URL instead
    // of showing initials for the rest of the Inbox session.
    const retryTimer = window.setTimeout(() => {
      setRetryAttempt((current) => current + 1);
      setImageFailed(false);
    }, 1_000);

    return () => window.clearTimeout(retryTimer);
  }, [imageFailed, profilePicUrl, retryAttempt]);

  const imageUrl =
    profilePicUrl && retryAttempt
      ? `${profilePicUrl}${profilePicUrl.includes("?") ? "&" : "?"}avatarRetry=${retryAttempt}`
      : profilePicUrl;

  return (
    <div aria-hidden="true" className={className}>
      {imageUrl && !imageFailed ? (
        <img
          alt=""
          className="chatbox-avatar-image"
          onError={() => setImageFailed(true)}
          src={imageUrl}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
