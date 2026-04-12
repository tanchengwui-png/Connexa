"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useConfirmation } from "@/components/confirmation-provider";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, LightningIcon } from "@/components/inbox/icons";
import { INBOX_LAYERS } from "@/components/inbox/layers";
import { SearchableCombobox } from "@/components/searchable-combobox";
import { useToast } from "@/components/toast-provider";
import { FINANCING_TAG_OPTIONS, formatFinancingTag } from "@/lib/financing-tags";
import { detectMapLinkProvider, extractCoordinatesFromMapLink } from "@/lib/map-links";
import {
  MALAYSIA_POPULAR_LOCATIONS,
  resolveMalaysiaArea,
  resolveMalaysiaState
} from "@/lib/malaysia-popular-locations";

type ProductSummary = {
  id: string;
  name: string;
  description: string | null;
  area: string | null;
  location: string | null;
  mapUrl: string | null;
  websiteUrl: string | null;
  financing: string | null;
  financingTags: string[];
  brochureName: string | null;
  brochureUrl: string | null;
  priceMin: number | null;
  priceMax: number | null;
  imageUrls: string[];
  latitude: number | null;
  longitude: number | null;
};

type ProductCatalogPanelProps = {
  products: ProductSummary[];
};

const MAX_GALLERY_IMAGES = 6;
const currencyFormatter = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  maximumFractionDigits: 0
});

const EMPTY_FORM = {
  name: "",
  description: "",
  area: "",
  location: "",
  mapUrl: "",
  websiteUrl: "",
  financing: "",
  financingTags: [] as string[],
  priceMin: "",
  priceMax: "",
  latitude: "",
  longitude: "",
  imageUrls: ""
};

export function ProductCatalogPanel({ products }: ProductCatalogPanelProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const brochureInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const editorPaneRef = useRef<HTMLDivElement | null>(null);
  const states = useMemo(
    () => Array.from(new Set(MALAYSIA_POPULAR_LOCATIONS.map((item) => item.state))).sort(),
    []
  );
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showAdvancedLocation, setShowAdvancedLocation] = useState(false);
  const [selectedBrochure, setSelectedBrochure] = useState<File | null>(null);
  const [selectedGallery, setSelectedGallery] = useState<File[]>([]);
  const [galleryViewer, setGalleryViewer] = useState<{ productName: string; imageUrls: string[]; index: number } | null>(null);
  const [existingBrochure, setExistingBrochure] = useState<{ name: string | null; url: string | null }>({
    name: null,
    url: null
  });
  const [existingGalleryUrls, setExistingGalleryUrls] = useState<string[]>([]);
  const normalizedState = useMemo(() => resolveMalaysiaState(form.location), [form.location]);
  const availableAreas = useMemo(
    () => MALAYSIA_POPULAR_LOCATIONS.filter((item) => item.state === normalizedState).map((item) => item.name),
    [normalizedState]
  );
  const galleryPreviews = useMemo(
    () =>
      selectedGallery.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file)
      })),
    [selectedGallery]
  );

  useEffect(() => {
    return () => {
      galleryPreviews.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, [galleryPreviews]);

  const editingProduct = useMemo(
    () => products.find((product) => product.id === editingProductId) ?? null,
    [editingProductId, products]
  );
  const activeGalleryImage = galleryViewer ? galleryViewer.imageUrls[galleryViewer.index] ?? null : null;

  const resetEditor = () => {
    setEditingProductId(null);
    setForm(EMPTY_FORM);
    setSelectedBrochure(null);
    setSelectedGallery([]);
    setExistingBrochure({ name: null, url: null });
    setExistingGalleryUrls([]);
    setShowAdvancedLocation(false);
    setError(null);
  };

  const startEditProduct = (product: ProductSummary) => {
    setEditingProductId(product.id);
    setForm({
      name: product.name,
      description: product.description ?? "",
      area: product.area ?? "",
      location: product.location ?? "",
      mapUrl: product.mapUrl ?? "",
      websiteUrl: product.websiteUrl ?? "",
      financing: product.financing ?? "",
      financingTags: product.financingTags,
      priceMin: product.priceMin ? new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 }).format(product.priceMin) : "",
      priceMax: product.priceMax ? new Intl.NumberFormat("en-MY", { maximumFractionDigits: 0 }).format(product.priceMax) : "",
      latitude: product.latitude?.toString() ?? "",
      longitude: product.longitude?.toString() ?? "",
      imageUrls: ""
    });
    setSelectedBrochure(null);
    setSelectedGallery([]);
    setExistingBrochure({
      name: product.brochureName,
      url: product.brochureUrl
    });
    setExistingGalleryUrls(product.imageUrls);
    setShowAdvancedLocation(Boolean(product.latitude || product.longitude));
    setError(null);
    editorPaneRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const submitProduct = async () => {
    const normalizedArea = resolveMalaysiaArea(form.area, normalizedState);
    const payload = new FormData();
    payload.append("name", form.name.trim());
    payload.append("description", form.description.trim());
    payload.append("area", normalizedArea);
    payload.append("location", normalizedState);
    payload.append("mapUrl", form.mapUrl.trim());
    payload.append("websiteUrl", form.websiteUrl.trim());
    payload.append("financing", form.financing.trim());
    payload.append("priceMin", normalizeCurrencyInput(form.priceMin));
    payload.append("priceMax", normalizeCurrencyInput(form.priceMax));
    payload.append("latitude", form.latitude.trim());
    payload.append("longitude", form.longitude.trim());
    form.financingTags.forEach((tag) => payload.append("financingTags", tag));
    existingGalleryUrls.forEach((url) => payload.append("existingImageUrls", url));
    if (existingBrochure.name) {
      payload.append("existingBrochureName", existingBrochure.name);
    }
    if (existingBrochure.url) {
      payload.append("existingBrochureUrl", existingBrochure.url);
    }
    if (!existingBrochure.url) {
      payload.append("removeBrochure", "true");
    }

    if (selectedBrochure) {
      payload.append("brochure", selectedBrochure);
    }

    selectedGallery.forEach((file) => payload.append("gallery", file));

    const response = await fetch(editingProductId ? `/api/products/${editingProductId}` : "/api/products", {
      method: editingProductId ? "PATCH" : "POST",
      body: payload
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      const message = payload?.error ?? `Unable to ${editingProductId ? "update" : "create"} property.`;
      setError(message);
      showError(editingProductId ? "Property not saved" : "Property not created", message);
      return;
    }

    success(
      editingProductId ? "Property updated" : "Property created",
      editingProductId
        ? `${form.name.trim() || "The property"} has been updated in the catalog.`
        : `${form.name.trim() || "The property"} has been added to the catalog.`
    );
    resetEditor();
    router.refresh();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      const message = "Property name is required.";
      setError(message);
      showError("Property not saved", message);
      return;
    }

    setError(null);
    const accepted = await confirm({
      title: editingProduct ? "Save property changes?" : "Create property?",
      description: editingProduct
        ? `This will update ${editingProduct.name} for future lead and inbox linking.`
        : `This will add ${form.name.trim()} to the Property Catalog.`,
      confirmLabel: editingProduct ? "Save changes" : "Create property"
    });

    if (!accepted) {
      return;
    }

    startTransition(async () => {
      await submitProduct();
    });
  };

  const handleDeleteProduct = async (productId: string) => {
    const product = products.find((item) => item.id === productId);
    const accepted = await confirm({
      title: "Delete property?",
      description: `This will permanently remove ${product?.name ?? "this property"} from the catalog.`,
      confirmLabel: "Delete property",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(`/api/products/${productId}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = payload?.error ?? "Unable to delete property.";
        setError(message);
        showError("Property not deleted", message);
        return;
      }

      if (editingProductId === productId) {
        resetEditor();
      }

      success("Property deleted", `${product?.name ?? "The property"} has been removed from the catalog.`);
      router.refresh();
    });
  };

  const openGalleryViewer = (product: ProductSummary) => {
    if (!product.imageUrls.length) {
      return;
    }

    setGalleryViewer({
      productName: product.name,
      imageUrls: product.imageUrls,
      index: 0
    });
  };

  return (
    <>
      <div className="content-card lead-record-page-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{editingProduct ? `Editing ${editingProduct.name}` : "Property Catalog"}</h3>
            <p className="muted">
              Configure property listings once, then tag leads to those catalog entries when chats arrive.
            </p>
          </div>
          {editingProduct ? (
            <button className="inbox-search-tool" onClick={resetEditor} type="button">
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="lead-record-layout product-catalog-layout">
          <div className="product-catalog-editor-pane" ref={editorPaneRef}>
            <form className="lead-record-form-sections" onSubmit={handleSubmit}>
        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Property basics</strong>
            <span>Name the property and give the team a short summary.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field lead-record-field-wide">
              <span>Name</span>
              <input
                className="lead-record-input"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Description</span>
              <input
                className="lead-record-input"
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              />
            </label>
          </div>
        </section>

        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Location</strong>
            <span>Use Malaysia state and area fields so products stay consistent in search.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field">
              <span>State</span>
              <SearchableCombobox
                emptyText="No matching states."
                onCommit={(nextValue) => resolveMalaysiaState(nextValue)}
                onValueChange={(nextValue) =>
                  setForm((current) => ({
                    ...current,
                    location: nextValue,
                    area: MALAYSIA_POPULAR_LOCATIONS.some(
                      (item) => item.state === resolveMalaysiaState(nextValue) && item.name === current.area
                    )
                      ? current.area
                      : ""
                  }))
                }
                options={states}
                placeholder="Search state, for example Selangor or KL"
                value={form.location}
              />
            </label>
            <label className="lead-record-field">
              <span>Area / city</span>
              <SearchableCombobox
                disabled={!normalizedState}
                emptyText="No matching areas."
                onCommit={(nextValue) => resolveMalaysiaArea(nextValue, normalizedState)}
                onValueChange={(nextValue) => setForm((current) => ({ ...current, area: nextValue }))}
                options={availableAreas}
                placeholder={normalizedState ? "Search area, for example PJ or Mont Kiara" : "Select a state first"}
                value={form.area}
              />
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Map link</span>
              <input
                className="lead-record-input"
                placeholder="Paste a Google Maps or Waze link"
                value={form.mapUrl}
                onBlur={(event) => {
                  const nextValue = event.target.value.trim();
                  const coords = extractCoordinatesFromMapLink(nextValue);

                  setForm((current) => ({
                    ...current,
                    mapUrl: nextValue,
                    latitude: coords?.latitude ?? current.latitude,
                    longitude: coords?.longitude ?? current.longitude
                  }));
                }}
                onChange={(event) => setForm((current) => ({ ...current, mapUrl: event.target.value }))}
              />
              <small className="muted">
                Supports {`Google Maps`} and Waze links. Coordinates auto-fill when the link includes them.
              </small>
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Website URL</span>
              <input
                className="lead-record-input"
                placeholder="Paste a listing URL, for example PropertyGuru"
                type="url"
                value={form.websiteUrl}
                onChange={(event) => setForm((current) => ({ ...current, websiteUrl: event.target.value }))}
              />
              <small className="muted">
                Use this for the public property listing page you want agents to share.
              </small>
            </label>
          </div>

          <button
            className="inbox-search-tool lead-record-inline-toggle"
            onClick={() => setShowAdvancedLocation((current) => !current)}
            type="button"
          >
            {showAdvancedLocation ? "Hide coordinates" : "Add coordinates"}
          </button>

          {showAdvancedLocation ? (
            <div className="lead-record-form-grid">
              <label className="lead-record-field">
                <span>Latitude</span>
                <input
                  className="lead-record-input"
                  value={form.latitude}
                  onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))}
                />
              </label>
              <label className="lead-record-field">
                <span>Longitude</span>
                <input
                  className="lead-record-input"
                  value={form.longitude}
                  onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Commercial terms</strong>
            <span>Capture pricing and financing data that can later map against chats.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field">
              <span>Price min (MYR)</span>
              <div className="currency-input-wrap">
                <span className="currency-input-prefix">RM</span>
                <input
                  className="lead-record-input currency-input"
                  inputMode="numeric"
                  placeholder="500,000"
                  value={form.priceMin}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priceMin: formatCurrencyInput(event.target.value)
                    }))
                  }
                />
              </div>
            </label>
            <label className="lead-record-field">
              <span>Price max (MYR)</span>
              <div className="currency-input-wrap">
                <span className="currency-input-prefix">RM</span>
                <input
                  className="lead-record-input currency-input"
                  inputMode="numeric"
                  placeholder="800,000"
                  value={form.priceMax}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      priceMax: formatCurrencyInput(event.target.value)
                    }))
                  }
                />
              </div>
            </label>
            <label className="lead-record-field lead-record-field-wide">
              <span>Financing notes</span>
              <input
                className="lead-record-input"
                value={form.financing}
                onChange={(event) => setForm((current) => ({ ...current, financing: event.target.value }))}
              />
            </label>
            <div className="lead-record-field lead-record-field-wide">
              <span>Financing tags</span>
              <div className="inbox-detail-chip-row">
                {FINANCING_TAG_OPTIONS.map((tag) => {
                  const isSelected = form.financingTags.includes(tag);

                  return (
                    <button
                      className={`inbox-search-tool${isSelected ? " active-financing-tag" : ""}`}
                      key={tag}
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          financingTags: isSelected
                            ? current.financingTags.filter((item) => item !== tag)
                            : [...current.financingTags, tag]
                        }))
                      }
                      type="button"
                    >
                      {formatFinancingTag(tag)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="lead-record-panel">
          <div className="lead-record-section-head">
            <strong>Media</strong>
            <span>Upload brochure PDF and gallery images that agents can reuse in follow-up.</span>
          </div>
          <div className="lead-record-form-grid">
            <label className="lead-record-field">
              <span>Brochure PDF</span>
              <input
                accept="application/pdf"
                className="product-hidden-file-input"
                onChange={(event) => {
                  setSelectedBrochure(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
                ref={brochureInputRef}
                type="file"
              />
              <button
                className="product-upload-trigger"
                onClick={() => brochureInputRef.current?.click()}
                type="button"
              >
                <span className="product-upload-trigger-label">Choose brochure</span>
                <strong>{selectedBrochure?.name ?? existingBrochure.name ?? "No brochure selected"}</strong>
              </button>
              <div className="product-upload-field-status">
                {selectedBrochure || existingBrochure.url ? (
                  <button
                    className="inbox-search-tool"
                    onClick={() =>
                      selectedBrochure ? setSelectedBrochure(null) : setExistingBrochure({ name: null, url: null })
                    }
                    type="button"
                  >
                    Remove brochure
                  </button>
                ) : (
                  <small className="muted">Optional. Upload one brochure PDF.</small>
                )}
              </div>
            </label>
            <label className="lead-record-field">
              <span>Gallery images</span>
              <input
                accept="image/*"
                className="product-hidden-file-input"
                multiple
                onChange={(event) => {
                  const incomingFiles = Array.from(event.target.files ?? []);
                  const mergedFiles = [...selectedGallery];

                  incomingFiles.forEach((file) => {
                    const isDuplicate = mergedFiles.some(
                      (existing) =>
                        existing.name === file.name &&
                        existing.size === file.size &&
                        existing.lastModified === file.lastModified
                    );

                    if (!isDuplicate) {
                      mergedFiles.push(file);
                    }
                  });

                  const availableSlots = Math.max(0, MAX_GALLERY_IMAGES - existingGalleryUrls.length);
                  const nextFiles = mergedFiles.slice(0, availableSlots);

                  if (existingGalleryUrls.length + mergedFiles.length > MAX_GALLERY_IMAGES) {
                    setError(`You can keep up to ${MAX_GALLERY_IMAGES} gallery images in total.`);
                  } else if (incomingFiles.length && mergedFiles.length === selectedGallery.length) {
                    setError("Those gallery images are already selected.");
                  } else {
                    setError(null);
                  }

                  setSelectedGallery(nextFiles);
                  event.target.value = "";
                }}
                ref={galleryInputRef}
                type="file"
              />
              <button
                className="product-upload-trigger"
                onClick={() => galleryInputRef.current?.click()}
                type="button"
              >
                <span className="product-upload-trigger-label">Choose images</span>
                <strong>
                  {selectedGallery.length
                    ? `${selectedGallery.length} new image(s) selected`
                    : existingGalleryUrls.length
                      ? `${existingGalleryUrls.length} saved image(s)`
                      : "No images selected"}
                </strong>
              </button>
              <div className="product-upload-field-status">
                <small className="muted">
                  {selectedGallery.length || existingGalleryUrls.length
                    ? `${existingGalleryUrls.length + selectedGallery.length} of ${MAX_GALLERY_IMAGES} image(s) prepared`
                    : `Optional. Upload up to ${MAX_GALLERY_IMAGES} images.`}
                </small>
              </div>
            </label>
          </div>
          {existingGalleryUrls.length ? (
            <div className="product-upload-preview-grid">
              {existingGalleryUrls.map((imageUrl, index) => (
                <div className="product-upload-preview-card" key={imageUrl}>
                  <img alt={`Existing gallery ${index + 1}`} className="product-upload-preview-image" src={imageUrl} />
                  <div className="product-upload-preview-copy">
                    <strong>{`Saved image ${index + 1}`}</strong>
                    <button
                      className="inbox-search-tool"
                      onClick={() =>
                        setExistingGalleryUrls((current) => current.filter((item) => item !== imageUrl))
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {galleryPreviews.length ? (
            <div className="product-upload-preview-grid">
              {galleryPreviews.map(({ file, previewUrl }, index) => (
                <div className="product-upload-preview-card" key={`${file.name}-${index}`}>
                  <img alt={file.name} className="product-upload-preview-image" src={previewUrl} />
                  <div className="product-upload-preview-copy">
                    <strong title={file.name}>{file.name}</strong>
                    <button
                      className="inbox-search-tool"
                      onClick={() =>
                        setSelectedGallery((current) => current.filter((_, currentIndex) => currentIndex !== index))
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="product-form-footer">
          <div className="product-form-footer-copy">
                <strong>{editingProduct ? "Ready to save your changes?" : "Ready to publish this property?"}</strong>
            <span>
              {editingProduct
                ? "The catalog entry will be updated immediately for leads and inbox linking."
                : "The catalog entry will be available immediately for leads and inbox linking."}
            </span>
          </div>
          <button className="button button-primary product-submit-button" type="submit" disabled={isPending}>
            <span className="product-submit-button-icon" aria-hidden="true">
              <LightningIcon />
            </span>
            <span className="product-submit-button-kicker">{isPending ? "Working" : "Catalog"}</span>
                <strong>{isPending ? (editingProduct ? "Saving changes..." : "Saving property...") : editingProduct ? "Save changes" : "Create property"}</strong>
          </button>
        </div>
            </form>
          </div>

          <aside className="lead-record-panel product-catalog-list-pane">
            <div className="product-catalog-list-head">
              <div className="lead-record-section-head">
                <strong>Existing properties</strong>
                <span>Browse, edit, and keep this list independent from the editor.</span>
              </div>
              <span className="product-catalog-count">
                {products.length} {products.length === 1 ? "property" : "properties"}
              </span>
            </div>

            <div className="product-catalog-list" aria-label="Existing properties">
              {products.length ? (
                products.map((product) => (
                  <article
                    className={`product-catalog-item product-catalog-list-item${
                      editingProductId === product.id ? " active" : ""
                    }`}
                    key={product.id}
                  >
                    <button
                      className="product-catalog-select"
                      onClick={() => startEditProduct(product)}
                      type="button"
                    >
                      <div className="product-catalog-item-head">
                        <div>
                          <span>{product.name}</span>
                          <strong>{product.area ?? "Unknown area"}</strong>
                        </div>
                        <small className="product-catalog-price">{formatCurrencyRange(product.priceMin, product.priceMax)}</small>
                      </div>
                      <div className="product-catalog-subline">
                        <span>{product.location ?? "Unknown location"}</span>
                        {product.mapUrl ? <span>{detectMapLinkProvider(product.mapUrl)}</span> : null}
                      </div>
                      <div className="product-catalog-meta-row product-catalog-meta-row-compact">
                        {product.brochureUrl ? <span className="product-catalog-asset-count">Brochure</span> : null}
                        {product.websiteUrl ? <span className="product-catalog-asset-count">Website</span> : null}
                        {product.imageUrls.length ? (
                          <span className="product-catalog-asset-count">
                            {product.imageUrls.length} image{product.imageUrls.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {product.financingTags.length ? (
                          <span className="product-catalog-asset-count">
                            {product.financingTags.length} financing tag{product.financingTags.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <div className="product-card-actions product-catalog-actions">
                      {product.brochureUrl ? (
                        <a
                          className="inbox-search-tool product-catalog-asset-link"
                          href={product.brochureUrl}
                          rel="noreferrer"
                          target="_blank"
                          title={product.brochureName ?? "Open brochure"}
                        >
                          Open brochure
                        </a>
                      ) : null}
                      {product.mapUrl ? (
                        <a className="inbox-search-tool" href={product.mapUrl} rel="noreferrer" target="_blank">
                          {`Open ${detectMapLinkProvider(product.mapUrl)}`}
                        </a>
                      ) : null}
                      {product.websiteUrl ? (
                        <a className="inbox-search-tool" href={product.websiteUrl} rel="noreferrer" target="_blank">
                          Open website
                        </a>
                      ) : null}
                      {product.imageUrls.length ? (
                        <button className="inbox-search-tool" onClick={() => openGalleryViewer(product)} type="button">
                          View images
                        </button>
                      ) : null}
                      <button
                        className="inbox-search-tool product-delete-button"
                        onClick={() => handleDeleteProduct(product.id)}
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="lead-record-empty product-catalog-empty">
                  No properties configured yet. Create one in the editor to start tagging leads.
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
      {galleryViewer && activeGalleryImage
        ? createPortal(
            <div
              className="inbox-dialog-backdrop"
              onClick={() => setGalleryViewer(null)}
              style={{ zIndex: INBOX_LAYERS.modal }}
            >
              <div
                aria-modal="true"
                className="inbox-dialog product-gallery-dialog"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                style={{ zIndex: INBOX_LAYERS.modal + 1 }}
              >
                <div className="inbox-dialog-head product-gallery-dialog-head">
                  <div>
                    <strong>{galleryViewer.productName}</strong>
                    <p>
                      Image {galleryViewer.index + 1} of {galleryViewer.imageUrls.length}
                    </p>
                  </div>
                  <button className="product-gallery-close" onClick={() => setGalleryViewer(null)} type="button">
                    <CloseIcon />
                  </button>
                </div>
                <div className="product-gallery-dialog-body">
                  <button
                    aria-label="Previous image"
                    className="product-gallery-nav"
                    disabled={galleryViewer.index === 0}
                    onClick={() =>
                      setGalleryViewer((current) =>
                        current
                          ? {
                              ...current,
                              index: Math.max(0, current.index - 1)
                            }
                          : current
                      )
                    }
                    type="button"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <img
                    alt={`${galleryViewer.productName} image ${galleryViewer.index + 1}`}
                    className="product-gallery-dialog-image"
                    src={activeGalleryImage}
                  />
                  <button
                    aria-label="Next image"
                    className="product-gallery-nav"
                    disabled={galleryViewer.index === galleryViewer.imageUrls.length - 1}
                    onClick={() =>
                      setGalleryViewer((current) =>
                        current
                          ? {
                              ...current,
                              index: Math.min(current.imageUrls.length - 1, current.index + 1)
                            }
                          : current
                      )
                    }
                    type="button"
                  >
                    <ChevronRightIcon />
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function normalizeCurrencyInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

function formatCurrencyInput(value: string) {
  const digits = normalizeCurrencyInput(value);

  if (!digits) {
    return "";
  }

  return new Intl.NumberFormat("en-MY", {
    maximumFractionDigits: 0
  }).format(Number(digits));
}

function formatCurrencyRange(min: number | null, max: number | null) {
  const formattedMin = typeof min === "number" ? currencyFormatter.format(min) : "?";
  const formattedMax = typeof max === "number" ? currencyFormatter.format(max) : "?";
  return `${formattedMin} - ${formattedMax}`;
}
