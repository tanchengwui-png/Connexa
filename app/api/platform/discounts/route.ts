import { NextRequest, NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import {
  activatePlatformDiscount,
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
      percentage?: number | null;
      amountOff?: number | null;
      expiresOn?: string | null;
    };

    await createPlatformDiscount({
      code: String(body.code ?? ""),
      percentage: body.percentage ?? null,
      amountOff: body.amountOff ?? null,
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
      percentage?: number | null;
      amountOff?: number | null;
      expiresOn?: string | null;
    };

    const id = String(body.id ?? "");
    if (!id) {
      throw new Error("Discount code id is required.");
    }

    await updatePlatformDiscount(id, {
      code: String(body.code ?? ""),
      percentage: body.percentage ?? null,
      amountOff: body.amountOff ?? null,
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
    const message = error instanceof Error ? error.message : "Unable to set discount code inactive.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await requireApiPlatformAdmin();
    const body = (await request.json()) as {
      id?: string;
    };

    const id = String(body.id ?? "");
    if (!id) {
      throw new Error("Discount code id is required.");
    }

    await activatePlatformDiscount(id);
    return NextResponse.json({ ok: true, discounts: await getPlatformDiscountAdminView() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to activate discount code.";
    return NextResponse.json({ error: message === "UNAUTHORIZED" ? "Unauthorized." : message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
