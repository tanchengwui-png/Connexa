import { NextRequest, NextResponse } from "next/server";
import { beginWorkspaceCheckout } from "@/lib/checkout";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    name?: string;
    email?: string;
    workspaceName?: string;
    password?: string;
    plan?: string;
    remember?: boolean;
    discountCode?: string;
  };

  try {
    const result = await beginWorkspaceCheckout({
      name: body.name ?? "",
      email: body.email ?? "",
      workspaceName: body.workspaceName ?? "",
      password: body.password ?? "",
      plan: body.plan ?? "",
      remember: Boolean(body.remember),
      discountCode: body.discountCode ?? ""
    });

    return NextResponse.json({ ok: true, paymentUrl: result.paymentUrl }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to start checkout."
      },
      { status: 400 }
    );
  }
}
