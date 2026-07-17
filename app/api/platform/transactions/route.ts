import { NextResponse } from "next/server";
import { requireApiPlatformAdmin } from "@/lib/platform-auth/current-user";
import { listPlatformTransactions } from "@/lib/platform-transactions";

export async function GET(request: Request) {
  try {
    await requireApiPlatformAdmin();
    const searchParams = new URL(request.url).searchParams;
    const transactions = await listPlatformTransactions({
      search: searchParams.get("search"),
      status: searchParams.get("status"),
      currency: searchParams.get("currency"),
      dateFrom: searchParams.get("date_from"),
      dateTo: searchParams.get("date_to"),
      sort: searchParams.get("sort"),
      page: searchParams.get("page"),
      pageSize: searchParams.get("page_size")
    });

    return NextResponse.json(transactions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load transactions.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
