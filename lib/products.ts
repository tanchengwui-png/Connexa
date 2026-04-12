import { prisma } from "@/lib/prisma";
import { requireCurrentWorkspaceId, requireCurrentApiAgent } from "@/lib/auth/current-user";

export async function listProducts() {
  const workspaceId = await requireCurrentWorkspaceId();
  const products = await prisma.product.findMany({
    where: {
      workspaceId
    },
    orderBy: {
      name: "asc"
    }
  });

  return products.map((product) => ({
    ...product,
    financingTags: parseStringArray(product.financingTags),
    imageUrls: parseImageUrls(product.imageUrls)
  }));
}

export async function createProduct(input: {
  name: string;
  description?: string | null;
  area?: string | null;
  location?: string | null;
  mapUrl?: string | null;
  websiteUrl?: string | null;
  financing?: string | null;
  financingTags?: string[];
  brochureName?: string | null;
  brochureUrl?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  imageUrls?: string[];
}) {
  await requireCurrentApiAgent();
  const workspaceId = await requireCurrentWorkspaceId();
  return prisma.product.create({
    data: {
      workspaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      area: input.area?.trim() || null,
      location: input.location?.trim() || null,
      mapUrl: input.mapUrl?.trim() || null,
      websiteUrl: input.websiteUrl?.trim() || null,
      financing: input.financing?.trim() || null,
      financingTags: input.financingTags?.length ? JSON.stringify(input.financingTags) : null,
      brochureName: input.brochureName?.trim() || null,
      brochureUrl: input.brochureUrl?.trim() || null,
      priceMin: input.priceMin ?? null,
      priceMax: input.priceMax ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      imageUrls: input.imageUrls?.length ? JSON.stringify(input.imageUrls) : null
    }
  });
}

export async function getProductById(productId: string) {
  const workspaceId = await requireCurrentWorkspaceId();
  return prisma.product.findFirst({
    where: {
      id: productId,
      workspaceId
    }
  });
}

export async function updateProduct(
  productId: string,
  input: {
    name: string;
    description?: string | null;
    area?: string | null;
    location?: string | null;
    mapUrl?: string | null;
    websiteUrl?: string | null;
    financing?: string | null;
    financingTags?: string[];
    brochureName?: string | null;
    brochureUrl?: string | null;
    priceMin?: number | null;
    priceMax?: number | null;
    latitude?: number | null;
    longitude?: number | null;
    imageUrls?: string[];
  }
) {
  const agent = await requireCurrentApiAgent();
  const existing = await prisma.product.findFirst({
    where: {
      id: productId,
      workspaceId: agent.workspaceId
    }
  });

  if (!existing) {
    throw new Error("Product not found.");
  }

  return prisma.product.update({
    where: {
      id: productId
    },
    data: {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      area: input.area?.trim() || null,
      location: input.location?.trim() || null,
      mapUrl: input.mapUrl?.trim() || null,
      websiteUrl: input.websiteUrl?.trim() || null,
      financing: input.financing?.trim() || null,
      financingTags: input.financingTags?.length ? JSON.stringify(input.financingTags) : null,
      brochureName: input.brochureName?.trim() || null,
      brochureUrl: input.brochureUrl?.trim() || null,
      priceMin: input.priceMin ?? null,
      priceMax: input.priceMax ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      imageUrls: input.imageUrls?.length ? JSON.stringify(input.imageUrls) : null
    }
  });
}

export async function deleteProduct(productId: string) {
  const agent = await requireCurrentApiAgent();
  const existing = await prisma.product.findFirst({
    where: {
      id: productId,
      workspaceId: agent.workspaceId
    }
  });

  if (!existing) {
    throw new Error("Product not found.");
  }

  return prisma.product.delete({
    where: {
      id: productId
    }
  });
}

function parseImageUrls(value: string | null) {
  return parseStringArray(value);
}

function parseStringArray(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const payload = JSON.parse(value) as string[];
    return payload.filter((item) => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}
