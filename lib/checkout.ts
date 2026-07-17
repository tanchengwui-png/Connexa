import { AgentRole, AgentStatus } from "@/lib/db-types";
import {
  getBillingDetailsErrorMessage,
  normalizeBillingDetails,
  type BillingDetails,
  validateBillingDetails
} from "@/lib/billing-details";
import {
  createAccountRecord,
  createPendingWorkspaceCheckout,
  createWorkspaceAndManager,
  findAccountByEmail,
  findPendingWorkspaceCheckoutByProviderReferenceForUpdate,
  findPendingWorkspaceCheckoutByProviderReference,
  findWorkspaceBySlug,
  updatePendingWorkspaceCheckoutProvider,
  updatePendingWorkspaceCheckoutStatus
} from "@/lib/db-auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createEmailVerification } from "@/lib/auth/verification";
import {
  getPackageBillingSnapshot,
  normalizeWorkspacePackageKey,
  PaymentStatus,
  recordWorkspacePayment,
  SubscriptionStatus
} from "@/lib/billing";
import { getAppBaseUrl } from "@/lib/app-url";
import { createBillplzBill, verifyBillplzCallbackSignature, verifyBillplzRedirectSignature } from "@/lib/billplz";
import { transaction } from "@/lib/db";
import { getPlatformConfig } from "@/lib/platform-config";
import {
  ensureCheckoutDiscountSupport,
  getCheckoutAmountSnapshot,
  recordSuccessfulDiscountRedemption,
  resolveCheckoutDiscount
} from "@/lib/platform-discounts";
import { normalizeWorkspacePlan } from "@/lib/workspace-plan";
import {
  createPaidInvoice,
  finalizeInvoiceDocumentAndEmail,
  saveBillingProfile,
  sendInvoiceIssuedEmail
} from "@/lib/billing-management";
import { normalizePackageBillingPeriod, PACKAGE_BILLING_PERIOD } from "@/lib/package-pricing";

function getNextBillingAt(billingPeriod: string | null) {
  if (billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY) {
    const next = new Date();
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }

  if (billingPeriod === PACKAGE_BILLING_PERIOD.MONTHLY) {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  return null;
}

async function generateWorkspaceSlug(workspaceName: string) {
  const baseSlug = workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  const fallbackSlug = baseSlug || "workspace";

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = attempt === 0 ? fallbackSlug : `${fallbackSlug}-${attempt + 1}`;
    const existingWorkspace = await findWorkspaceBySlug(slug);

    if (!existingWorkspace) {
      return slug;
    }
  }

  throw new Error("Unable to create a unique workspace slug.");
}

async function getBillplzCheckoutConfig() {
  const config = await getPlatformConfig();
  const apiKey = config?.billplzApiKey ?? process.env.BILLPLZ_API_KEY ?? "";
  const collectionId = config?.billplzCollectionId ?? process.env.BILLPLZ_COLLECTION_ID ?? "";
  const xSignatureKey = config?.billplzXSignatureKey ?? process.env.BILLPLZ_X_SIGNATURE_KEY ?? "";
  const sandbox = config?.billplzSandbox ?? process.env.BILLPLZ_SANDBOX === "true";

  if (!apiKey || !collectionId) {
    throw new Error("Billplz checkout is not configured yet.");
  }

  return {
    apiKey,
    collectionId,
    xSignatureKey: xSignatureKey || undefined,
    sandbox
  };
}

export async function beginWorkspaceCheckout(input: {
  name: string;
  email: string;
  workspaceName: string;
  password: string;
  plan: string;
  billingPeriod: string;
  billingDetails: BillingDetails;
  remember: boolean;
  discountCode?: string | null;
}) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const workspaceName = input.workspaceName.trim();
  const password = input.password;
  const plan = normalizeWorkspacePlan(input.plan);
  const billingPeriod = normalizePackageBillingPeriod(input.billingPeriod);
  const billingDetails = normalizeBillingDetails(input.billingDetails);

  if (!name || !email || !workspaceName || !password) {
    throw new Error("Name, email, workspace name, and password are required.");
  }
  const billingValidationError = getBillingDetailsErrorMessage(validateBillingDetails(billingDetails));
  if (billingValidationError) {
    throw new Error(billingValidationError);
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const packageSnapshot = await getPackageBillingSnapshot(normalizeWorkspacePackageKey(plan), billingPeriod);

  if (packageSnapshot.priceAmount === null) {
    throw new Error("This package requires manual billing support.");
  }

  await ensureCheckoutDiscountSupport();

  const discount = await resolveCheckoutDiscount({
    code: input.discountCode ?? null,
    amount: packageSnapshot.priceAmount,
    currency: packageSnapshot.currency,
    billingPeriod: packageSnapshot.billingPeriod
  });

  const existingAccount = await findAccountByEmail(email);

  if (existingAccount && !verifyPassword(password, existingAccount.passwordHash)) {
    throw new Error("This email already belongs to an existing account. Use the same password to continue.");
  }

  const billplzConfig = await getBillplzCheckoutConfig();
  const passwordHash = existingAccount?.passwordHash ?? hashPassword(password);
  const pendingCheckout = await createPendingWorkspaceCheckout({
    plan,
    billingPeriod,
    name,
    email,
    workspaceName,
    passwordHash,
    billingName: billingDetails.billingName,
    billingPhoneNumber: billingDetails.billingPhoneNumber,
    billingAddressLine1: billingDetails.billingAddressLine1,
    billingAddressLine2: billingDetails.billingAddressLine2,
    billingCity: billingDetails.billingCity,
    billingState: billingDetails.billingState,
    billingPostcode: billingDetails.billingPostcode,
    billingCountry: billingDetails.billingCountry,
    billingTaxId: billingDetails.billingTaxId,
    remember: input.remember,
    provider: "billplz",
    discountCode: discount.code,
    discountPercentage: discount.percentage,
    originalAmount: discount.originalAmount,
    finalAmount: discount.finalAmount,
    currency: packageSnapshot.currency
  });
  const appBaseUrl = getAppBaseUrl();
  const bill = await createBillplzBill(billplzConfig, {
    name,
    email,
    amount: discount.finalAmount,
    description: `${packageSnapshot.name} ${billingPeriod === PACKAGE_BILLING_PERIOD.YEARLY ? "yearly" : "monthly"} workspace package for ${workspaceName}`,
    callbackUrl: `${appBaseUrl}/api/billing/billplz/callback`,
    redirectUrl: `${appBaseUrl}/api/public/checkout/complete`
  });

  await updatePendingWorkspaceCheckoutProvider({
    checkoutId: pendingCheckout.id,
    providerReference: bill.id,
    providerCheckoutUrl: bill.url
  });

  return {
    checkoutId: pendingCheckout.id,
    paymentUrl: bill.url
  };
}

async function completePendingCheckout(providerReference: string, paidAt: Date | null) {
  await ensureCheckoutDiscountSupport();

  const completion = await transaction(async (client) => {
    const pendingCheckout = await findPendingWorkspaceCheckoutByProviderReferenceForUpdate(
      providerReference,
      client
    );

    if (!pendingCheckout) {
      throw new Error("Pending checkout not found.");
    }

    if (pendingCheckout.status === "COMPLETED" && pendingCheckout.workspaceId && pendingCheckout.agentId) {
      return {
        pendingCheckout,
        createdAgentId: null as string | null,
        verificationRequired: false,
        invoiceId: null as string | null
      };
    }

    const existingAccount = await findAccountByEmail(pendingCheckout.email);
    const account =
      existingAccount ??
      (await createAccountRecord({
        email: pendingCheckout.email,
        passwordHash: pendingCheckout.passwordHash
      }));

    const packageSnapshot = await getPackageBillingSnapshot(
      normalizeWorkspacePackageKey(pendingCheckout.plan),
      pendingCheckout.billingPeriod ?? PACKAGE_BILLING_PERIOD.MONTHLY
    );
    const checkoutAmountSnapshot = getCheckoutAmountSnapshot({
      originalAmount: pendingCheckout.originalAmount,
      finalAmount: pendingCheckout.finalAmount
    });
    const checkoutPriceAmount = checkoutAmountSnapshot.originalAmount ?? packageSnapshot.priceAmount;
    const paidAmount = checkoutAmountSnapshot.finalAmount ?? checkoutPriceAmount;
    const nextBillingAt = getNextBillingAt(packageSnapshot.billingPeriod);
    const result = await createWorkspaceAndManager({
      accountId: account?.id ?? null,
      workspaceName: pendingCheckout.workspaceName,
      slug: await generateWorkspaceSlug(pendingCheckout.workspaceName),
      plan: pendingCheckout.plan,
      trialEndsAt: null,
      subscriptionNextBillingAt: nextBillingAt,
      packageCode: packageSnapshot.code,
      packageName: packageSnapshot.name,
      packageDescription: packageSnapshot.description,
      packagePriceAmount: packageSnapshot.monthlyPriceAmount,
      packageCurrency: pendingCheckout.currency ?? packageSnapshot.currency,
      packageBillingPeriod: packageSnapshot.packageBillingPeriod,
      subscriptionPriceAmount: checkoutPriceAmount,
      subscriptionBillingPeriod: packageSnapshot.billingPeriod,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      agentName: pendingCheckout.name,
      agentEmail: pendingCheckout.email,
      passwordHash: pendingCheckout.passwordHash,
      role: AgentRole.MANAGER,
      status: AgentStatus.ACTIVE,
      executor: client
    });

    await saveBillingProfile({
      workspaceId: result.workspace.id,
      billingName: pendingCheckout.billingName,
      billingEmail: pendingCheckout.email,
      billingPhoneNumber: pendingCheckout.billingPhoneNumber,
      billingAddressLine1: pendingCheckout.billingAddressLine1,
      billingAddressLine2: pendingCheckout.billingAddressLine2,
      billingCity: pendingCheckout.billingCity,
      billingState: pendingCheckout.billingState,
      billingPostcode: pendingCheckout.billingPostcode,
      billingCountry: pendingCheckout.billingCountry,
      billingTaxId: pendingCheckout.billingTaxId,
      executor: client
    });

    const invoice =
      result.subscription && paidAmount !== null
        ? await createPaidInvoice({
            workspaceId: result.workspace.id,
            subscriptionId: result.subscription.id,
            packageId: result.subscription.packageId,
            customerName: pendingCheckout.name,
            customerEmail: pendingCheckout.email,
            packageName: packageSnapshot.name,
            amount: paidAmount,
            currency: pendingCheckout.currency ?? packageSnapshot.currency ?? "MYR",
            transactionType: "NEW_SUBSCRIPTION",
            subscriptionStartDate: result.subscription.startedAt,
            subscriptionEndDate: nextBillingAt,
            paymentDate: paidAt ?? new Date(),
            providerReference,
            executor: client
          })
        : null;

    if (result.subscription && paidAmount !== null) {
      await recordWorkspacePayment({
        workspaceId: result.workspace.id,
        subscriptionId: result.subscription.id,
        invoiceId: invoice?.id ?? null,
        transactionId: providerReference,
        amount: paidAmount,
        currency: pendingCheckout.currency ?? packageSnapshot.currency ?? "MYR",
        provider: "billplz",
        providerReference,
        paymentMethod: "Billplz",
        receiptNumber: invoice?.receiptNumber ?? null,
        receiptIssuedAt: invoice?.receiptIssuedAt ?? null,
        status: PaymentStatus.PAID,
        paidAt,
        executor: client
      });
    }

    const updatedCheckout = await updatePendingWorkspaceCheckoutStatus({
      checkoutId: pendingCheckout.id,
      status: "COMPLETED",
      paidAt,
      workspaceId: result.workspace.id,
      agentId: result.agent.id,
      completedAt: new Date(),
      executor: client
    });

    if (pendingCheckout.discountCode) {
      await recordSuccessfulDiscountRedemption(
        {
          code: pendingCheckout.discountCode,
          redeemedByName: pendingCheckout.name,
          redeemedByEmail: pendingCheckout.email,
          redeemedByWorkspaceName: pendingCheckout.workspaceName,
          redeemedAt: paidAt ?? new Date()
        },
        client
      );
    }

    return {
      pendingCheckout: updatedCheckout,
      createdAgentId: result.agent.id,
      verificationRequired: !existingAccount?.emailVerifiedAt,
      invoiceId: invoice?.id ?? null
    };
  });

  if (completion.verificationRequired && completion.createdAgentId) {
    await createEmailVerification(completion.createdAgentId);
  }
  if (completion.invoiceId) {
    await sendInvoiceIssuedEmail(completion.invoiceId).catch((error) => {
      console.error("[billing] unable to send checkout invoice email", error);
    });
    await finalizeInvoiceDocumentAndEmail(completion.invoiceId).catch((error) => {
      console.error("[billing] unable to finalize checkout invoice", error);
    });
  }

  return completion.pendingCheckout;
}

export async function finalizeCheckoutFromRedirect(params: Record<string, string>) {
  await ensureCheckoutDiscountSupport();

  const config = await getBillplzCheckoutConfig();

  if (!verifyBillplzRedirectSignature(params, config.xSignatureKey)) {
    throw new Error("Invalid Billplz redirect signature.");
  }

  const billId = params["billplz[id]"] ?? "";
  const paid = params["billplz[paid]"] === "true";
  const paidAt = params["billplz[paid_at]"] ? new Date(params["billplz[paid_at]"]) : null;

  if (!billId) {
    throw new Error("Missing Billplz bill id.");
  }

  if (!paid) {
    return {
      status: "PENDING" as const,
      pendingCheckout: await findPendingWorkspaceCheckoutByProviderReference(billId)
    };
  }

  return {
    status: "COMPLETED" as const,
    pendingCheckout: await completePendingCheckout(billId, paidAt)
  };
}

export async function finalizeCheckoutFromCallback(params: Record<string, string>) {
  await ensureCheckoutDiscountSupport();

  const config = await getBillplzCheckoutConfig();

  if (!verifyBillplzCallbackSignature(params, config.xSignatureKey)) {
    throw new Error("Invalid Billplz callback signature.");
  }

  if (!params.id) {
    throw new Error("Missing Billplz bill id.");
  }

  if (params.paid !== "true") {
    return findPendingWorkspaceCheckoutByProviderReference(params.id);
  }

  const paidAt = params.paid_at ? new Date(params.paid_at) : new Date();
  return completePendingCheckout(params.id, paidAt);
}
