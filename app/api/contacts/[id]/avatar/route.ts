import path from "node:path";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { findContactInWorkspace } from "@/lib/db-contacts";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;

    const contact = await findContactInWorkspace(id, agent.workspaceId);
    const photoUrl = contact?.photoUrl?.trim();

    if (!photoUrl) {
      return new NextResponse(null, { status: 404 });
    }

    if (photoUrl.startsWith("/")) {
      const normalizedPath = path.normalize(photoUrl).replace(/^(\.\.(\/|\\|$))+/, "");
      const candidatePaths = [
        path.join(process.cwd(), "public", normalizedPath.replace(/^\//, "")),
        normalizedPath.startsWith("/whatsapp-profile/")
          ? path.join(process.cwd(), "public", "uploads", normalizedPath.replace(/^\/whatsapp-profile\//, "whatsapp-profile/"))
          : null
      ].filter((value): value is string => Boolean(value));

      let body: Buffer | null = null;
      for (const absolutePath of candidatePaths) {
        body = await readFile(absolutePath).catch(() => null);
        if (body) {
          break;
        }
      }

      if (!body) {
        return new NextResponse(null, { status: 404 });
      }

      const contentType = photoUrl.endsWith(".png")
        ? "image/png"
        : photoUrl.endsWith(".webp")
          ? "image/webp"
          : photoUrl.endsWith(".gif")
            ? "image/gif"
            : "image/jpeg";

      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=300"
        }
      });
    }

    const upstream = await fetch(photoUrl, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 Connexa Avatar Proxy"
      }
    });

    if (!upstream.ok) {
      return new NextResponse(null, { status: 404 });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    return new NextResponse(null, {
      status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 404
    });
  }
}
