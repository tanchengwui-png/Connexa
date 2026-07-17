import { NextRequest, NextResponse } from "next/server";
import { createAppointment } from "@/lib/appointments";
import { AppointmentType } from "@/lib/db-types";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      conversationId?: string;
      title?: string;
      type?: AppointmentType;
      startAt?: string;
      endAt?: string;
      location?: string | null;
      note?: string | null;
    };

    if (!body.conversationId) {
      return NextResponse.json({ error: "Conversation is required." }, { status: 400 });
    }

    if (!body.type || !Object.values(AppointmentType).includes(body.type)) {
      return NextResponse.json({ error: "Invalid appointment type." }, { status: 400 });
    }

    await createAppointment({
      conversationId: body.conversationId,
      title: body.title ?? "",
      type: body.type,
      startAt: body.startAt ?? "",
      endAt: body.endAt ?? "",
      location: body.location ?? null,
      note: body.note ?? null
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create appointment.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "EMAIL_NOT_VERIFIED"
          ? 403
          : 400;

    return NextResponse.json({ error: status === 401 ? "Unauthorized." : status === 403 ? "Forbidden." : message }, { status });
  }
}
