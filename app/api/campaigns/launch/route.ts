import { NextRequest, NextResponse } from "next/server";
import { requireCurrentApiAgent } from "@/lib/auth/current-user";
import { launchCampaign } from "@/lib/campaigns";

export async function POST(request: NextRequest) {
  try {
    await requireCurrentApiAgent();
    const body = (await request.json()) as {
      name?: string;
      messageBody?: string;
      channelId?: string | null;
      scheduleAt?: string | null;
      selectedContactIds?: string[];
      selectedAttachmentIds?: string[];
      templateName?: string | null;
      languageCode?: string | null;
      templateVariables?: unknown[] | null;
      bodyVariables?: unknown[] | null;
      headerVariables?: unknown[] | null;
      template?: {
        name?: string;
        languageCode?: string | null;
        components?: unknown[] | null;
        variables?: unknown[] | null;
        bodyVariables?: unknown[] | null;
        headerVariables?: unknown[] | null;
      } | null;
    };

    const templateName = body.template?.name ?? body.templateName ?? null;

    const result = await launchCampaign({
      name: body.name ?? "",
      messageBody: body.messageBody ?? "",
      channelId: body.channelId ?? null,
      scheduleAt: body.scheduleAt ?? null,
      selectedContactIds: body.selectedContactIds ?? [],
      selectedAttachmentIds: body.selectedAttachmentIds ?? [],
      template: templateName
        ? {
            name: templateName,
            languageCode: body.template?.languageCode ?? body.languageCode ?? null,
            components: body.template?.components ?? [],
            variables: body.template?.variables ?? body.templateVariables ?? [],
            bodyVariables: body.template?.bodyVariables ?? body.bodyVariables ?? [],
            headerVariables: body.template?.headerVariables ?? body.headerVariables ?? []
          }
        : null
    });

    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "UNAUTHORIZED"
            ? "Unauthorized."
            : error instanceof Error
              ? error.message
              : "Unable to launch campaign."
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 }
    );
  }
}
