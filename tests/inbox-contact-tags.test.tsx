import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContactLabelsManager, CreateContactTagDialog } from "@/components/inbox/contact-labels-manager";
import {
  addTagToContact,
  buildCreateContactTagDraft,
  createAndApplyContactTag,
  DUPLICATE_CONTACT_TAG_MODAL_MESSAGE
} from "@/lib/contact-tag-utils";

const availableTags = [
  {
    id: "tag-1",
    name: "Buyer",
    description: "Customer is looking to buy.",
    source: "library" as const
  },
  {
    id: "tag-2",
    name: "Priority",
    description: "Fast follow-up needed.",
    source: "library" as const
  }
];

test("existing tag dropdown renders created tags", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ContactLabelsManager, {
      availableTags,
      selectedTags: [],
      onAddTag: async () => ({ ok: true }),
      onCreateTag: async () => ({ ok: true, tag: availableTags[0] }),
      onRemoveTag: () => {}
    })
  );

  assert.match(markup, /Select a tag/);
  assert.match(markup, />Buyer</);
  assert.match(markup, />Priority</);
});

test("sidebar shows existing tags controls and create button without inline create input", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ContactLabelsManager, {
      availableTags,
      selectedTags: ["Buyer"],
      onAddTag: async () => ({ ok: true }),
      onCreateTag: async () => ({ ok: true, tag: availableTags[0] }),
      onRemoveTag: () => {}
    })
  );

  assert.match(markup, /Existing tags/);
  assert.match(markup, /Create new tag/);
  assert.doesNotMatch(markup, /Create or search/);
  assert.doesNotMatch(markup, /placeholder="Type a tag name"/);
});

test("Add applies selected existing tag without duplicating case-insensitive matches", () => {
  assert.deepEqual(addTagToContact(["buyer"], "Buyer"), ["buyer"]);
  assert.deepEqual(addTagToContact(["whatsapp"], "Priority"), ["whatsapp", "Priority"]);
});

test("Create new dialog renders required fields and actions", () => {
  const draft = buildCreateContactTagDraft("  Follow up  ");
  const markup = renderToStaticMarkup(
    React.createElement(CreateContactTagDialog, {
      description: draft.description,
      error: null,
      isPending: false,
      name: draft.name,
      onCancel: () => {},
      onDescriptionChange: () => {},
      onNameChange: () => {},
      onSave: () => {}
    })
  );

  assert.match(markup, /Create new tag/);
  assert.match(markup, /Tag Name/);
  assert.match(markup, /Description/);
  assert.match(markup, /value="Follow up"/);
  assert.match(markup, /Cancel/);
  assert.match(markup, /Save &amp; Create/);
});

test("Save & Create creates and applies the new tag", async () => {
  const calls: Array<{ description: string | null; name: string } | string[]> = [];

  const result = await createAndApplyContactTag(
    {
      availableTags,
      currentTags: ["Buyer"],
      description: "Need a quick response",
      name: " Hot Lead "
    },
    {
      createTag: async (input) => {
        calls.push(input);
        return {
          id: "tag-3",
          name: input.name,
          description: input.description,
          source: "library" as const
        };
      },
      applyTags: async (tags) => {
        calls.push(tags);
      }
    }
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.tag.name, "Hot Lead");
  assert.deepEqual(calls, [
    {
      name: "Hot Lead",
      description: "Need a quick response"
    },
    ["Buyer", "Hot Lead"]
  ]);
});

test("duplicate tag cannot be created", async () => {
  let createCalled = false;
  let applyCalled = false;

  const result = await createAndApplyContactTag(
    {
      availableTags,
      currentTags: [],
      description: null,
      name: " priority "
    },
    {
      createTag: async () => {
        createCalled = true;
        return availableTags[1];
      },
      applyTags: async () => {
        applyCalled = true;
      }
    }
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.error, DUPLICATE_CONTACT_TAG_MODAL_MESSAGE);
  assert.equal(createCalled, false);
  assert.equal(applyCalled, false);
});

test("duplicate create dialog renders the inline duplicate message", () => {
  const markup = renderToStaticMarkup(
    React.createElement(CreateContactTagDialog, {
      description: "",
      error: DUPLICATE_CONTACT_TAG_MODAL_MESSAGE,
      isPending: false,
      name: "Priority",
      onCancel: () => {},
      onDescriptionChange: () => {},
      onNameChange: () => {},
      onSave: () => {}
    })
  );

  assert.match(markup, /This tag already exists\. Please select it from the Existing tags dropdown\./);
});
