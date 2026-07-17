import { NextRequest, NextResponse } from "next/server";
import { getPackageBillingSnapshot } from "@/lib/billing";
import { resolveCheckoutDiscount } from "@/lib/platform-discounts";
import { normalizePackageBillingPeriod, PACKAGE_BILLING_PERIOD } from "@/lib/package-pricing";
import { isPublicPackageKey } from "@/lib/public-packages";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      plan?: string;
      billingPeriod?: string;
      discountCode?: string;
    };

    const plan = String(body.plan ?? "");
    if (!isPublicPackageKey(plan)) {
      throw new Error("Invalid package selected.");
    }

    const billingPeriod = normalizePackageBillingPeriod(body.billingPeriod ?? PACKAGE_BILLING_PERIOD.MONTHLY);
    const selectedPackage = await getPackageBillingSnapshot(plan, billingPeriod);
    if (selectedPackage.priceAmount === null) {
      throw new Error("Discount codes are only available for fixed-price packages.");
    }

    const discount = await resolveCheckoutDiscount({
      code: body.discountCode ?? "",
      amount: selectedPackage.priceAmount,
      currency: selectedPackage.currency,
      billingPeriod: selectedPackage.billingPeriod
    });

    return NextResponse.json({ ok: true, discount });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to apply discount code."
      },
      { status: 400 }
    );
  }
}
