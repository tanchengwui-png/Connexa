import { NextRequest, NextResponse } from "next/server";
import { registerWorkspace } from "@/lib/auth/register";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    name?: string;
    email?: string;
    workspaceName?: string;
    password?: string;
    plan?: string;
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
    freeTrial?: boolean;
  };

  try {
    await registerWorkspace({
      name: body.name ?? "",
      email: body.email ?? "",
      workspaceName: body.workspaceName ?? "",
      password: body.password ?? "",
      plan: body.plan ?? "",
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
      freeTrial: Boolean(body.freeTrial)
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create workspace."
      },
      { status: 400 }
    );
  }
}
