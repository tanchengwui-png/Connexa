"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { useToast } from "@/components/toast-provider";

type QuickRepliesManagerProps = {
  categories: string[];
  quickReplies: Array<{
    id: string;
    title: string;
    shortcut: string;
    category: string;
    isPinned: boolean;
    body: string;
  }>;
};

type ReplyFormState = {
  id: string | null;
  title: string;
  shortcut: string;
  category: string;
  isPinned: boolean;
  body: string;
};

const EMPTY_FORM: ReplyFormState = {
  id: null,
  title: "",
  shortcut: "",
  category: "General",
  isPinned: false,
  body: ""
};

const STARTER_TEMPLATES = [
  {
    category: "Lead Capture",
    description: "Simple first reply to start qualification.",
    title: "Buyer qualification",
    shortcut: "/buyer",
    body: "Thanks for reaching out. Are you looking to buy, rent, or sell a property? If buying, which area and budget range should I note for you?"
  },
  {
    category: "Viewing",
    description: "Confirms appointment and what happens next.",
    title: "Viewing confirmation",
    shortcut: "/viewing",
    body: "Your viewing is confirmed. I’ll send the exact location, access instructions, and contact person shortly before the appointment."
  },
  {
    category: "Pricing",
    description: "Guides the customer into a more useful pricing conversation.",
    title: "Pricing prompt",
    shortcut: "/price",
    body: "Please share the property name or preferred area and I’ll send the latest price range, layout, and availability for you."
  },
  {
    category: "Follow-up",
    description: "Soft re-engagement for leads who went quiet.",
    title: "Follow-up nudge",
    shortcut: "/followup",
    body: "Just checking in on your property search. If you're still looking, I can shortlist a few options based on your preferred area and budget."
  },
  {
    category: "Docs",
    description: "Useful when a buyer asks for formal materials.",
    title: "Brochure send",
    shortcut: "/brochure",
    body: "Sure. I can send the brochure, floor plan, and latest price list. Let me know the project name if you already have one in mind."
  }
] as const;

export function QuickRepliesManager({ categories, quickReplies }: QuickRepliesManagerProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [form, setForm] = useState<ReplyFormState>(EMPTY_FORM);
  const [isStarterOpen, setIsStarterOpen] = useState(false);

  const pinnedReplies = useMemo(() => quickReplies.filter((item) => item.isPinned), [quickReplies]);

  const filteredReplies = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    return quickReplies.filter((item) => {
      if (selectedCategory !== "All" && item.category !== selectedCategory) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [item.title, item.shortcut, item.category, item.body].join(" ").toLowerCase().includes(query);
    });
  }, [quickReplies, searchValue, selectedCategory]);

  const starterTemplates = useMemo(() => {
    const usedShortcuts = new Set(quickReplies.map((item) => item.shortcut.toLowerCase()));
    return STARTER_TEMPLATES.filter((item) => !usedShortcuts.has(item.shortcut.toLowerCase()));
  }, [quickReplies]);

  const createOrUpdateReply = async () => {
    setError(null);

    const accepted = await confirm({
      title: form.id ? "Save quick reply?" : "Create quick reply?",
      description: form.id
        ? `This will update ${form.title || "this quick reply"} in the shared library.`
        : `This will add ${form.title || "a new quick reply"} to the shared library.`,
      confirmLabel: form.id ? "Save reply" : "Create reply"
    });

    if (!accepted) {
      return;
    }

    startTransition(async () => {
      const response = await fetch(form.id ? `/api/quick-replies/${form.id}` : "/api/quick-replies", {
        method: form.id ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(form)
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to save quick reply.";
        setError(message);
        showError("Quick reply not saved", message);
        return;
      }

      setForm(EMPTY_FORM);
      success(form.id ? "Quick reply updated" : "Quick reply created", `${form.title || "Quick reply"} is ready for the inbox.`);
      router.refresh();
    });
  };

  const installStarterTemplate = async (template: (typeof STARTER_TEMPLATES)[number]) => {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/quick-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...template,
          isPinned: false
        })
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to install starter template.";
        setError(message);
        showError("Starter template not installed", message);
        return;
      }

      success("Starter template added", `${template.title} is now available in the shared library.`);
      router.refresh();
    });
  };

  const beginEdit = (reply: QuickRepliesManagerProps["quickReplies"][number]) => {
    setForm({
      id: reply.id,
      title: reply.title,
      shortcut: reply.shortcut,
      category: reply.category,
      isPinned: reply.isPinned,
      body: reply.body
    });
    setError(null);
  };

  const removeReply = async (id: string) => {
    const reply = quickReplies.find((item) => item.id === id);
    const accepted = await confirm({
      title: "Delete quick reply?",
      description: `This will remove ${reply?.title ?? "this quick reply"} from the shared library.`,
      confirmLabel: "Delete reply",
      tone: "danger"
    });

    if (!accepted) {
      return;
    }

    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/quick-replies/${id}`, {
        method: "DELETE"
      });

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        const message = payload?.error ?? "Unable to delete quick reply.";
        setError(message);
        showError("Quick reply not deleted", message);
        return;
      }

      if (form.id === id) {
        setForm(EMPTY_FORM);
      }

      success("Quick reply deleted", `${reply?.title ?? "Quick reply"} has been removed.`);
      router.refresh();
    });
  };

  return (
    <section className="quick-replies-compact-shell">
      <article className="table-card quick-replies-library-pane">
        <div className="card-header">
          <div>
            <h3 className="card-title">Reply Library</h3>
            <p className="muted">Search or filter, then open a reply on the right to edit it.</p>
          </div>
          <span className="product-catalog-count">{filteredReplies.length} shown</span>
        </div>

        <div className="quick-replies-library-tools">
          <label className="inbox-search-field quick-replies-search" htmlFor="quick-replies-search">
            <input
              className="inbox-search-input"
              id="quick-replies-search"
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search title, shortcut, category, or reply body"
              type="text"
              value={searchValue}
            />
          </label>

          <div className="quick-replies-category-chips">
            {["All", "Pinned", ...categories].map((category) => (
              <button
                className={`inbox-search-tool${
                  selectedCategory === category ? " active" : ""
                }`}
                key={category}
                onClick={() => setSelectedCategory(category)}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
        </div>

        <div className="timeline-list">
          {(selectedCategory === "Pinned" ? pinnedReplies : filteredReplies).length ? (
            (selectedCategory === "Pinned" ? pinnedReplies : filteredReplies).map((item) => (
              <button className={`quick-replies-library-item${form.id === item.id ? " active" : ""}`} key={item.id} onClick={() => beginEdit(item)} type="button">
                <div className="quick-replies-library-item-head">
                  <strong>{item.title}</strong>
                  <span className="lead-chip">{item.shortcut}</span>
                </div>
                <div className="quick-replies-library-item-meta">
                  <span>{item.category}</span>
                  {item.isPinned ? <span>Pinned</span> : null}
                </div>
                <p>{item.body}</p>
              </button>
            ))
          ) : (
            <div className="lead-record-empty">No quick replies match the current filter.</div>
          )}
        </div>
      </article>

      <article className="content-card quick-replies-editor-pane">
        <div className="card-header">
          <div>
            <h3 className="card-title">{form.id ? "Edit reply" : "Create reply"}</h3>
            <p className="muted">Keep the editor focused. Use the library on the left to switch context.</p>
          </div>
          {form.id ? (
            <button className="inbox-search-tool" onClick={() => setForm(EMPTY_FORM)} type="button">
              New reply
            </button>
          ) : null}
        </div>

        <div className="quick-replies-editor-grid">
          <label className="control-block">
            <span className="control-label">Title</span>
            <input className="control-input" onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Viewing confirmation" value={form.title} />
          </label>

          <label className="control-block">
            <span className="control-label">Shortcut</span>
            <input className="control-input" onChange={(event) => setForm((current) => ({ ...current, shortcut: event.target.value }))} placeholder="/viewing" value={form.shortcut} />
          </label>

          <label className="control-block">
            <span className="control-label">Category</span>
            <select className="control-input app-select" onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} value={form.category}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="control-block quick-replies-pin-toggle">
            <span className="control-label">Priority</span>
            <label className="automation-toggle-row quick-replies-pin-inline">
              <input checked={form.isPinned} onChange={(event) => setForm((current) => ({ ...current, isPinned: event.target.checked }))} type="checkbox" />
              <span>Pin to top</span>
            </label>
          </label>

          <label className="control-block full-span">
            <span className="control-label">Reply body</span>
            <textarea className="composer-textarea quick-replies-editor-textarea" onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder="Your viewing is confirmed for tomorrow at 3pm..." rows={8} value={form.body} />
          </label>
        </div>

        <div className="quick-replies-preview-card">
          <span className="control-label">Preview</span>
          <div className="quick-replies-preview-bubble">
            <div className="quick-replies-preview-head">
              <strong>{form.title || "Untitled reply"}</strong>
              <div className="quick-replies-preview-meta">
                <span>{form.shortcut || "/shortcut"}</span>
                <span>{form.category}</span>
                {form.isPinned ? <span>Pinned</span> : null}
              </div>
            </div>
            <p>{form.body || "Your saved reply preview will appear here."}</p>
          </div>
        </div>

        <details className="quick-replies-starter-collapse" open={isStarterOpen}>
          <summary onClick={(event) => {
            event.preventDefault();
            setIsStarterOpen((current) => !current);
          }}>
            {isStarterOpen ? "Hide starter templates" : "Browse starter templates"}
          </summary>
          {isStarterOpen ? (
            <div className="quick-replies-starter-grid">
              {starterTemplates.length ? (
                starterTemplates.map((template) => (
                  <div className="quick-replies-starter-card" key={template.shortcut}>
                    <div className="quick-replies-starter-head">
                      <span className="lead-chip">{template.category}</span>
                      <strong>{template.title}</strong>
                    </div>
                    <p>{template.description}</p>
                    <div className="table-subtle">{template.body}</div>
                    <button className="button button-secondary compact-button" disabled={isPending} onClick={() => void installStarterTemplate(template)} type="button">
                      Add template
                    </button>
                  </div>
                ))
              ) : (
                <div className="lead-record-empty">All starter templates are already installed.</div>
              )}
            </div>
          ) : null}
        </details>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="composer-actions quick-replies-editor-actions">
          {form.id ? (
            <button className="button button-secondary" disabled={isPending} onClick={() => void removeReply(form.id as string)} type="button">
              Delete
            </button>
          ) : null}
          <button className="button button-primary" disabled={isPending} onClick={() => void createOrUpdateReply()} type="button">
            {isPending ? "Saving..." : form.id ? "Save quick reply" : "Create quick reply"}
          </button>
        </div>
      </article>
    </section>
  );
}
