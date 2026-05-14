import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { path: pathSegments } = await context.params;
    const relativePath = pathSegments.filter(Boolean);

    if (!relativePath.length) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const absolutePath = path.join(UPLOADS_ROOT, ...relativePath);
    const normalizedRoot = `${path.resolve(UPLOADS_ROOT)}${path.sep}`;
    const normalizedTarget = path.resolve(absolutePath);

    if (!normalizedTarget.startsWith(normalizedRoot)) {
      return NextResponse.json({ error: "Invalid file path." }, { status: 400 });
    }

    const fileStat = await stat(normalizedTarget).catch(() => null);
    if (!fileStat?.isFile()) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }

    const fileName = path.basename(normalizedTarget);
    const contentType = getContentType(fileName);
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
      const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/i);
      if (!rangeMatch) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileStat.size}`
          }
        });
      }

      const start = rangeMatch[1] ? Number.parseInt(rangeMatch[1], 10) : 0;
      const end = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : fileStat.size - 1;

      if (
        Number.isNaN(start) ||
        Number.isNaN(end) ||
        start < 0 ||
        end < start ||
        start >= fileStat.size
      ) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileStat.size}`
          }
        });
      }

      const boundedEnd = Math.min(end, fileStat.size - 1);
      const chunkSize = boundedEnd - start + 1;
      const stream = Readable.toWeb(createReadStream(normalizedTarget, { start, end: boundedEnd }));

      return new NextResponse(stream as ReadableStream, {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=0, must-revalidate",
          "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
          "Content-Length": `${chunkSize}`,
          "Content-Range": `bytes ${start}-${boundedEnd}/${fileStat.size}`,
          "Content-Type": contentType
        }
      });
    }

    const stream = Readable.toWeb(createReadStream(normalizedTarget));

    return new NextResponse(stream as ReadableStream, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=0, must-revalidate",
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
        "Content-Length": `${fileStat.size}`,
        "Content-Type": contentType
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load uploaded file."
      },
      { status: 400 }
    );
  }
}

function getContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mp3":
      return "audio/mpeg";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}
