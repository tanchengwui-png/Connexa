import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const agent = await requireCurrentApiAgent();
    const { id } = await context.params;

    const conversation = await prisma.conversation.findFirst({
      where: {
        id,
        workspaceId: agent.workspaceId
      },
      select: {
        contact: {
          select: {
            photoUrl: true
          }
        }
      }
    });

    const photoUrl = conversation?.contact.photoUrl?.trim();
    if (!photoUrl) {
      return new NextResponse(null, { status: 404 });
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
