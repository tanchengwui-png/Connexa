"use client";

import type { ReactNode, RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INBOX_LAYERS } from "@/components/inbox/layers";

type PortalDropdownProps = {
  align?: "start" | "end";
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  matchTriggerWidth?: boolean;
  offset?: number;
  onClose: () => void;
  open: boolean;
  side?: "bottom" | "top";
  zIndex?: number;
};

type DropdownPosition = {
  left: number;
  maxHeight: number;
  minWidth?: number;
  top: number;
};

const VIEWPORT_PADDING = 12;

export function PortalDropdown({
  align = "start",
  anchorRef,
  children,
  className,
  matchTriggerWidth = false,
  offset = 10,
  onClose,
  open,
  side = "bottom",
  zIndex = INBOX_LAYERS.dropdown
}: PortalDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<DropdownPosition | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (dropdownRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }

      onClose();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const dropdown = dropdownRef.current;

      if (!anchor || !dropdown) {
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const dropdownRect = dropdown.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - anchorRect.bottom - VIEWPORT_PADDING;
      const spaceAbove = anchorRect.top - VIEWPORT_PADDING;
      const shouldOpenBelow =
        side === "bottom"
          ? spaceBelow >= dropdownRect.height || spaceBelow >= spaceAbove
          : !(spaceAbove >= dropdownRect.height || spaceAbove >= spaceBelow);
      const dropdownWidth = dropdownRect.width;

      let left =
        align === "end" ? anchorRect.right - dropdownWidth : anchorRect.left;
      left = Math.min(
        Math.max(left, VIEWPORT_PADDING),
        viewportWidth - dropdownWidth - VIEWPORT_PADDING
      );

      const top = shouldOpenBelow
        ? Math.min(anchorRect.bottom + offset, viewportHeight - VIEWPORT_PADDING)
        : Math.max(anchorRect.top - dropdownRect.height - offset, VIEWPORT_PADDING);
      const maxHeight = Math.max(
        120,
        shouldOpenBelow ? spaceBelow - offset : spaceAbove - offset
      );

      setPosition({
        left,
        maxHeight,
        minWidth: matchTriggerWidth ? anchorRect.width : undefined,
        top
      });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const anchor = anchorRef.current;
    const dropdown = dropdownRef.current;
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            updatePosition();
          })
        : null;

    if (anchor && resizeObserver) {
      resizeObserver.observe(anchor);
    }

    if (dropdown && resizeObserver) {
      resizeObserver.observe(dropdown);
    }

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [align, anchorRef, matchTriggerWidth, offset, open, side]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div
      className={className}
      ref={dropdownRef}
      style={{
        left: position?.left ?? VIEWPORT_PADDING,
        maxHeight: position?.maxHeight,
        minWidth: position?.minWidth,
        opacity: position ? 1 : 0,
        position: "fixed",
        top: position?.top ?? VIEWPORT_PADDING,
        visibility: position ? "visible" : "hidden",
        zIndex
      }}
    >
      {children}
    </div>,
    document.body
  );
}
