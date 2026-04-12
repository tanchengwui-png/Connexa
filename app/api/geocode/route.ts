import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEOAPIFY_API_KEY not configured." }, { status: 500 });
  }

  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  const query = request.nextUrl.searchParams.get("q") ?? "";
  if (!query.trim()) {
    return NextResponse.json({ results: [] });
  }
  url.searchParams.set("text", query);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "en");

  const response = await fetch(url);
  if (!response.ok) {
    return NextResponse.json({ error: "Geoapify lookup failed." }, { status: response.status });
  }

  const payload = await response.json();
  const results = (payload?.features ?? []).map((feature: any) => ({
    display_name: feature.properties.formatted,
    lat: feature.geometry.coordinates[1],
    lon: feature.geometry.coordinates[0]
  }));

  return NextResponse.json({ results });
}
