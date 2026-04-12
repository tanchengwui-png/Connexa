import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { createProduct, listProducts } from "@/lib/products";

export async function GET() {
  const products = await listProducts();
  return NextResponse.json({ products });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const brochureFile = getFile(formData.get("brochure"));
  const galleryFiles = formData
    .getAll("gallery")
    .map(getFile)
    .filter((file): file is File => Boolean(file));

  const uploadedBrochure = brochureFile ? await saveProductAsset(brochureFile, "brochure") : null;
  const uploadedGallery = await Promise.all(galleryFiles.map((file) => saveProductAsset(file, "gallery")));

  const product = await createProduct({
    name: `${formData.get("name") ?? ""}`,
    description: toOptionalString(formData.get("description")),
    area: toOptionalString(formData.get("area")),
    location: toOptionalString(formData.get("location")),
    mapUrl: toOptionalString(formData.get("mapUrl")),
    websiteUrl: toOptionalString(formData.get("websiteUrl")),
    financing: toOptionalString(formData.get("financing")),
    financingTags: formData
      .getAll("financingTags")
      .map((value) => `${value}`.trim())
      .filter(Boolean),
    brochureName: uploadedBrochure?.name ?? null,
    brochureUrl: uploadedBrochure?.publicPath ?? null,
    priceMin: toOptionalNumber(formData.get("priceMin")),
    priceMax: toOptionalNumber(formData.get("priceMax")),
    latitude: toOptionalFloat(formData.get("latitude")),
    longitude: toOptionalFloat(formData.get("longitude")),
    imageUrls: uploadedGallery.map((item) => item.publicPath)
  });

  return NextResponse.json({ product });
}

function getFile(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : null;
}

function toOptionalString(value: FormDataEntryValue | null) {
  const text = `${value ?? ""}`.trim();
  return text || null;
}

function toOptionalNumber(value: FormDataEntryValue | null) {
  const text = `${value ?? ""}`.replace(/[^\d]/g, "").trim();
  return text ? Number(text) : null;
}

function toOptionalFloat(value: FormDataEntryValue | null) {
  const text = `${value ?? ""}`.trim();
  return text ? Number(text) : null;
}

async function saveProductAsset(file: File, category: "brochure" | "gallery") {
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Product uploads must be 10 MB or smaller.");
  }

  const extension = path.extname(file.name) || inferExtension(file.type);
  const fileName = `${category}-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`;
  const uploadsDir = path.join(process.cwd(), "public", "uploads", "products");
  await mkdir(uploadsDir, { recursive: true });
  const filePath = path.join(uploadsDir, fileName);
  const arrayBuffer = await file.arrayBuffer();
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    publicPath: `/uploads/products/${fileName}`
  };
}

function inferExtension(mimeType: string) {
  if (mimeType === "application/pdf") {
    return ".pdf";
  }

  if (mimeType.startsWith("image/")) {
    return `.${mimeType.slice("image/".length)}`;
  }

  return "";
}
