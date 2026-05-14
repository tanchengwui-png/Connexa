import { NextRequest, NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import {
  createPlatformDiscount,
  getPlatformDiscountAdminView,
  removePlatformDiscount,
  updatePlatformDiscount
} from "@/lib/platform-discounts";

export async function GET() {
  try {
    await requireApiPlatformAdmin();
    const discounts = await getPlatformDiscountAdminView();
    return NextResponse.json({ discounts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load discount codes.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      code?: string;
      percentage?: number;
      expiresOn?: string | null;
    };

    await createPlatformDiscount({
      code: String(body.code ?? ""),
      percentage: Number(body.percentage ?? 0),
      expiresOn: body.expiresOn ?? null
    });

    return NextResponse.json({ ok: true, discounts: await getPlatformDiscountAdminView() }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create discount code.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      id?: string;
      code?: string;
      percentage?: number;
      expiresOn?: string | null;
    };

    const id = String(body.id ?? "");
    if (!id) {
      throw new Error("Discount code id is required.");
    }

    await updatePlatformDiscount(id, {
      code: String(body.code ?? ""),
      percentage: Number(body.percentage ?? 0),
      expiresOn: body.expiresOn ?? null
    });

    return NextResponse.json({ ok: true, discounts: await getPlatformDiscountAdminView() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update discount code.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      id?: string;
    };

    const id = String(body.id ?? "");
    if (!id) {
      throw new Error("Discount code id is required.");
    }

    await removePlatformDiscount(id);
    return NextResponse.json({ ok: true, discounts: await getPlatformDiscountAdminView() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete discount code.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
