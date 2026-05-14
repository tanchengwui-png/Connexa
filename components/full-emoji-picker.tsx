"use client";

import emojiData from "@emoji-mart/data";
import { Picker, init } from "emoji-mart";
import { useEffect, useRef } from "react";

let emojiMartInitialized = false;

export function FullEmojiPicker({ onEmojiSelect }: { onEmojiSelect: (emoji: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    if (!emojiMartInitialized) {
      init({ data: emojiData });
      emojiMartInitialized = true;
    }

    const picker = new Picker({
      autoFocus: true,
      data: emojiData,
      onEmojiSelect: (selection: { native?: string }) => {
        if (selection?.native) {
          onEmojiSelect(selection.native);
        }
      },
      previewPosition: "none",
      searchPosition: "sticky",
      skinTonePosition: "search",
      theme: "dark"
    });

    const pickerNode = picker as unknown as Node;
    containerRef.current.replaceChildren();
    containerRef.current.appendChild(pickerNode);

    return () => {
      containerRef.current?.replaceChildren();
    };
  }, [onEmojiSelect]);

  return <div className="automation-emoji-picker-mount" ref={containerRef} />;
}
