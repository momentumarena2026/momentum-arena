"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  Bold,
  Italic,
  Strikethrough,
  List,
  ListOrdered,
  Heading3,
  Quote,
  Link2,
  Link2Off,
  Undo2,
  Redo2,
} from "lucide-react";

/**
 * WYSIWYG editor for the admin's public-facing prose fields.
 *
 * TipTap rather than a contentEditable + execCommand toolbar, and the
 * reason is downstream: this HTML has to be re-drawn by a hand-written
 * renderer in the React Native app, which needs the tag set to be small
 * and predictable. execCommand emits browser-specific soup — <font>,
 * inline styles, stray <div> wrappers, different per engine — and
 * normalising that after the fact is worse work than constraining it up
 * front. TipTap's schema only ever produces the nodes configured below,
 * which is exactly the list lib/rich-text.ts allows and the app draws.
 *
 * Output is plain HTML, sanitised again server-side on save.
 */

function ToolButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      // Editing must not steal focus from the document, or the current
      // selection collapses and the command applies to nothing.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${
        active
          ? "bg-emerald-500/20 text-emerald-300"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-700 bg-zinc-900 px-1.5 py-1">
      <ToolButton
        title="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="h-4 w-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-zinc-700" />

      <ToolButton
        title="Heading"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="h-4 w-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-zinc-700" />

      <ToolButton title="Add link" active={editor.isActive("link")} onClick={setLink}>
        <Link2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Remove link"
        disabled={!editor.isActive("link")}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Link2Off className="h-4 w-4" />
      </ToolButton>

      <span className="mx-1 h-5 w-px bg-zinc-700" />

      <ToolButton
        title="Undo"
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        title="Redo"
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="h-4 w-4" />
      </ToolButton>
    </div>
  );
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 180,
}: {
  /** HTML. Plain text from the pre-editor era is accepted and converted. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Off because the app renderer has no way to draw them and the
        // sanitiser would strip them anyway — better the admin never
        // sees a button that silently loses their work.
        codeBlock: false,
        horizontalRule: false,
        heading: { levels: [3, 4] },
        link: false, // configured separately below
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        // The renderers decide target/rel, so the author can't set them.
        HTMLAttributes: {},
      }),
    ],
    content: toInitialHtml(value),
    // Next renders this on the server first; without the flag TipTap
    // warns about the hydration mismatch its own contenteditable causes.
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "tiptap-admin focus:outline-none",
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // The parent loads the tournament asynchronously, so `value` arrives
  // after mount. Sync it in — but only when it genuinely differs from
  // what's on screen, or every keystroke would round-trip through here
  // and reset the cursor to the start of the document.
  useEffect(() => {
    if (!editor) return;
    const incoming = toInitialHtml(value);
    if (incoming !== editor.getHTML()) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, value]);

  if (!editor) {
    return (
      <div
        className="rounded-lg border border-zinc-700 bg-zinc-800"
        style={{ minHeight: minHeight + 40 }}
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 focus-within:border-zinc-600">
      <Toolbar editor={editor} />
      <div className="px-3 py-2">
        <EditorContent editor={editor} />
        {editor.isEmpty && placeholder ? (
          <p className="pointer-events-none -mt-[1.6em] text-sm text-zinc-500">
            {placeholder}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Existing rows hold plain text with "- " bullets and real newlines,
 * written when the field was a textarea. Handing that straight to
 * TipTap collapses it into a single run-on paragraph — every line break
 * gone — so it gets turned into paragraphs first. Lines that start with
 * a bullet marker become list items, which is what the author meant.
 */
function toInitialHtml(value: string): string {
  if (!value) return "";
  if (/<(p|ul|ol|li|h3|h4|blockquote|strong|em|br)(\s|>|\/>)/i.test(value)) {
    return value;
  }
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(`<ul>${list.map((li) => `<li><p>${li}</p></li>`).join("")}</ul>`);
      list = [];
    }
  };
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) list.push(esc(bullet[1]));
    else {
      flush();
      out.push(`<p>${esc(line)}</p>`);
    }
  }
  flush();
  return out.join("");
}
