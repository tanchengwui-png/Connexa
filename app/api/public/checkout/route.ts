import { NextRequest, NextResponse } from "next/server";
import { beginWorkspaceCheckout } from "@/lib/checkout";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    name?: string;
    email?: string;
    workspaceName?: string;
    password?: string;
    plan?: string;
    billingPeriod?: string;
    billingDetails?: {
      billingName?: string;
      billingPhoneNumber?: string;
      billingAddressLine1?: string;
      billingAddressLine2?: string;
      billingCity?: string;
      billingState?: string;
      billingPostcode?: string;
      billingCountry?: string;
      billingTaxId?: string;
    };
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
      billingPeriod: body.billingPeriod ?? "monthly",
      billingDetails: {
        billingName: body.billingDetails?.billingName ?? "",
        billingPhoneNumber: body.billingDetails?.billingPhoneNumber ?? "",
        billingAddressLine1: body.billingDetails?.billingAddressLine1 ?? "",
        billingAddressLine2: body.billingDetails?.billingAddressLine2 ?? "",
        billingCity: body.billingDetails?.billingCity ?? "",
        billingState: body.billingDetails?.billingState ?? "",
        billingPostcode: body.billingDetails?.billingPostcode ?? "",
        billingCountry: body.billingDetails?.billingCountry ?? "Malaysia",
        billingTaxId: body.billingDetails?.billingTaxId ?? ""
      },
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
