"use client";

import { useEffect } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";

const ParagraphIndent = Extension.create({
  name: "paragraphIndent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element: HTMLElement) =>
              Math.min(
                5,
                Math.max(
                  0,
                  Math.round(parseFloat(element.style.marginLeft || "0") / 24),
                ),
              ),
            renderHTML: (attributes: Record<string, unknown>) => ({
              style: `margin-left: ${Number(attributes.indent) * 24}px`,
            }),
          },
        },
      },
    ];
  },
});

export function RichTextEditor({
  onChange,
  disabled,
}: {
  onChange: (html: string, text: string) => void;
  disabled: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false },
      }),
      TextStyleKit.configure({ color: false, backgroundColor: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ParagraphIndent,
    ],
    content: "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": "Email body",
        "aria-multiline": "true",
        "data-placeholder": "Type Your Reply…",
        class: "compose-editable",
      },
    },
    onUpdate: ({ editor: current }) =>
      onChange(current.getHTML(), current.getText()),
  });
  useEditorState({
    editor,
    selector: ({ transactionNumber }) => transactionNumber,
  });
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);
  function indent(direction: number) {
    if (!editor) return;
    if (editor.isActive("listItem")) {
      if (direction > 0) editor.chain().focus().sinkListItem("listItem").run();
      else editor.chain().focus().liftListItem("listItem").run();
    } else
      editor
        .chain()
        .focus()
        .command(({ state, tr }) => {
          state.doc.nodesBetween(
            state.selection.from,
            state.selection.to,
            (node, position) => {
              if (["paragraph", "heading"].includes(node.type.name))
                tr.setNodeMarkup(position, undefined, {
                  ...node.attrs,
                  indent: Math.max(
                    0,
                    Math.min(5, Number(node.attrs.indent ?? 0) + direction),
                  ),
                });
            },
          );
          return true;
        })
        .run();
  }
  if (!editor)
    return (
      <div className="compose-editor" role="status">
        Loading editor…
      </div>
    );
  const button = (
    label: string,
    content: React.ReactNode,
    action: () => void,
    active = false,
    unavailable = false,
  ) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled || unavailable}
      onMouseDown={(event) => event.preventDefault()}
      onClick={action}
    >
      {content}
    </button>
  );
  return (
    <div
      className="compose-editor"
      data-empty={editor.isEmpty}
      data-placeholder="Type Your Reply…"
    >
      <div
        className="compose-editor-toolbar"
        role="toolbar"
        aria-label="Message formatting"
      >
        {button(
          "Undo",
          "↶",
          () => {
            editor.chain().focus().undo().run();
          },
          false,
          !editor.can().undo(),
        )}
        {button(
          "Redo",
          "↷",
          () => {
            editor.chain().focus().redo().run();
          },
          false,
          !editor.can().redo(),
        )}
        <span className="editor-toolbar-divider" />
        <select
          aria-label="Font family"
          disabled={disabled}
          value={String(
            editor.getAttributes("textStyle").fontFamily ?? "Arial",
          )}
          onChange={(event) => {
            editor.chain().focus().setFontFamily(event.target.value).run();
          }}
        >
          {["Arial", "Georgia", "Verdana", "monospace"].map((font) => (
            <option key={font}>{font}</option>
          ))}
        </select>
        <select
          aria-label="Font size"
          disabled={disabled}
          value={String(editor.getAttributes("textStyle").fontSize ?? "14px")}
          onChange={(event) => {
            editor.chain().focus().setFontSize(event.target.value).run();
          }}
        >
          {[12, 14, 16, 18, 20, 24, 28, 32].map((size) => (
            <option key={size} value={`${size}px`}>
              {size}
            </option>
          ))}
        </select>
        <select
          aria-label="Paragraph style"
          disabled={disabled}
          value={
            editor.isActive("heading", { level: 1 })
              ? "1"
              : editor.isActive("heading", { level: 2 })
                ? "2"
                : editor.isActive("heading", { level: 3 })
                  ? "3"
                  : "paragraph"
          }
          onChange={(event) => {
            if (event.target.value === "paragraph")
              editor.chain().focus().setParagraph().run();
            else
              editor
                .chain()
                .focus()
                .setHeading({ level: Number(event.target.value) as 1 | 2 | 3 })
                .run();
          }}
        >
          <option value="paragraph">Text</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
        </select>
        <span className="editor-toolbar-divider" />
        {button(
          "Bold",
          <b>B</b>,
          () => {
            editor.chain().focus().toggleBold().run();
          },
          editor.isActive("bold"),
        )}
        {button(
          "Italic",
          <i>I</i>,
          () => {
            editor.chain().focus().toggleItalic().run();
          },
          editor.isActive("italic"),
        )}
        {button(
          "Underline",
          <u>U</u>,
          () => {
            editor.chain().focus().toggleUnderline().run();
          },
          editor.isActive("underline"),
        )}
        <span className="editor-toolbar-divider" />
        <select
          aria-label="Text alignment"
          disabled={disabled}
          value={String(
            editor.getAttributes("paragraph").textAlign ??
              editor.getAttributes("heading").textAlign ??
              "left",
          )}
          onChange={(event) => {
            editor.chain().focus().setTextAlign(event.target.value).run();
          }}
        >
          {["left", "center", "right", "justify"].map((value) => (
            <option key={value} value={value}>
              {value[0]!.toUpperCase() + value.slice(1)}
            </option>
          ))}
        </select>
        <select
          aria-label="Line spacing"
          disabled={disabled}
          value={String(editor.getAttributes("textStyle").lineHeight ?? "1.5")}
          onChange={(event) => {
            editor.chain().focus().setLineHeight(event.target.value).run();
          }}
        >
          {["1", "1.25", "1.5", "1.75", "2"].map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
        {button(
          "Numbered list",
          "1.",
          () => {
            editor.chain().focus().toggleOrderedList().run();
          },
          editor.isActive("orderedList"),
        )}
        {button(
          "Bullet list",
          "•",
          () => {
            editor.chain().focus().toggleBulletList().run();
          },
          editor.isActive("bulletList"),
        )}
        {button(
          "Increase indent",
          "⇥",
          () => indent(1),
          false,
          editor.isActive("listItem") && !editor.can().sinkListItem("listItem"),
        )}
        {button(
          "Decrease indent",
          "⇤",
          () => indent(-1),
          false,
          editor.isActive("listItem") && !editor.can().liftListItem("listItem"),
        )}
        {button(
          "Quote",
          "❝",
          () => {
            editor.chain().focus().toggleBlockquote().run();
          },
          editor.isActive("blockquote"),
        )}
        {button("Horizontal rule", "―", () => {
          editor.chain().focus().setHorizontalRule().run();
        })}
        {button(
          "Strikethrough",
          <s>S</s>,
          () => {
            editor.chain().focus().toggleStrike().run();
          },
          editor.isActive("strike"),
        )}
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
