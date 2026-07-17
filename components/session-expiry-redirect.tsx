"use client";

import { useEffect } from "react";

export function SessionExpiryRedirect() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);

      if (response.status === 401) {
        const targetPath = window.location.pathname.startsWith("/platform")
          ? "/platform/login?reason=session-expired"
          : "/login?reason=session-expired";

        window.location.assign(targetPath);
      }

      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
