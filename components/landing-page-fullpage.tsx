"use client";

import { useEffect } from "react";

const DESKTOP_MIN_WIDTH = 901;
const SCROLL_LOCK_MS = 900;
const WHEEL_THRESHOLD = 32;

export function LandingPageFullpage() {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let activeSectionId = "";
    let isAnimating = false;
    let wheelDelta = 0;
    let lockTimer: number | null = null;

    const getHeaderOffset = () => {
      const header = document.querySelector<HTMLElement>(".connexa-header");
      return header?.offsetHeight ?? 0;
    };

    const getSections = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-landing-section]"));

    const isDesktopMode = () => window.innerWidth >= DESKTOP_MIN_WIDTH;

    const setDesktopModeClass = () => {
      document.documentElement.classList.toggle("connexa-fullpage-desktop", isDesktopMode());
    };

    const getCurrentSectionIndex = (sections: HTMLElement[]) => {
      const headerOffset = getHeaderOffset();
      const currentY = window.scrollY + headerOffset + 24;

      for (let index = sections.length - 1; index >= 0; index -= 1) {
        if (currentY >= sections[index].offsetTop) {
          return index;
        }
      }

      return 0;
    };

    const updateActiveNav = () => {
      const sections = getSections();
      if (!sections.length) {
        return;
      }

      const currentSection = sections[getCurrentSectionIndex(sections)] ?? null;
      const nextSectionId = currentSection?.id ?? "";
      if (nextSectionId === activeSectionId) {
        return;
      }

      activeSectionId = nextSectionId;
      const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".connexa-nav a"));
      for (const link of navLinks) {
        const targetId = link.getAttribute("href")?.replace(/^#/, "") ?? "";
        const isActive = targetId.length > 0 && targetId === activeSectionId;
        link.classList.toggle("active", isActive);
        if (isActive) {
          link.setAttribute("aria-current", "page");
        } else {
          link.removeAttribute("aria-current");
        }
      }
    };

    const releaseLock = () => {
      isAnimating = false;
      wheelDelta = 0;
      updateActiveNav();
    };

    const scrollToSection = (section: HTMLElement) => {
      const top = Math.max(section.offsetTop - getHeaderOffset(), 0);
      isAnimating = true;
      wheelDelta = 0;

      window.scrollTo({
        top,
        behavior: "smooth"
      });

      if (lockTimer !== null) {
        window.clearTimeout(lockTimer);
      }

      lockTimer = window.setTimeout(releaseLock, SCROLL_LOCK_MS);
    };

    const moveByDirection = (direction: 1 | -1) => {
      const sections = getSections();
      if (!sections.length) {
        return;
      }

      const currentIndex = getCurrentSectionIndex(sections);
      const nextIndex = Math.max(0, Math.min(sections.length - 1, currentIndex + direction));
      if (nextIndex === currentIndex) {
        return;
      }

      scrollToSection(sections[nextIndex]);
    };

    const handleWheel = (event: WheelEvent) => {
      if (!isDesktopMode()) {
        return;
      }

      if (isAnimating) {
        event.preventDefault();
        return;
      }

      wheelDelta += event.deltaY;
      if (Math.abs(wheelDelta) < WHEEL_THRESHOLD) {
        return;
      }

      event.preventDefault();
      moveByDirection(wheelDelta > 0 ? 1 : -1);
    };

    const handleNavClick = (event: Event) => {
      const link = event.currentTarget as HTMLAnchorElement | null;
      if (!link) {
        return;
      }

      const href = link.getAttribute("href") ?? "";
      if (!href.startsWith("#")) {
        return;
      }

      const targetSection = document.getElementById(href.slice(1));
      if (!targetSection) {
        return;
      }

      event.preventDefault();
      history.replaceState(null, "", href);
      scrollToSection(targetSection);
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (!isDesktopMode() || isAnimating) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        moveByDirection(1);
        return;
      }

      if (event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        moveByDirection(-1);
      }
    };

    const handleResize = () => {
      setDesktopModeClass();
      updateActiveNav();
      if (!isDesktopMode()) {
        isAnimating = false;
        wheelDelta = 0;
      }
    };

    const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>(".connexa-nav a"));
    for (const link of navLinks) {
      link.addEventListener("click", handleNavClick);
    }

    setDesktopModeClass();
    updateActiveNav();

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("scroll", updateActiveNav, { passive: true });
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeydown);

    return () => {
      if (lockTimer !== null) {
        window.clearTimeout(lockTimer);
      }

      for (const link of navLinks) {
        link.removeEventListener("click", handleNavClick);
      }

      document.documentElement.classList.remove("connexa-fullpage-desktop");
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("scroll", updateActiveNav);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeydown);
    };
  }, []);

  return null;
}
