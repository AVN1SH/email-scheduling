import sanitizeHtml from "sanitize-html";
import { convert } from "html-to-text";
import { AppError } from "../../errors/app-error.js";

export function messageContent(body: string, html?: string) {
  if (html === undefined) return { body, bodyHtml: null };
  const bodyHtml = sanitizeHtml(html, {
    allowedTags: [
      "p",
      "div",
      "br",
      "span",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "del",
      "blockquote",
      "ul",
      "ol",
      "li",
      "h1",
      "h2",
      "h3",
      "hr",
      "a",
      "code",
      "pre",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "title", "target", "rel"],
      ol: ["start"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    allowedStyles: {
      "*": {
        "text-align": [/^(left|right|center|justify)$/],
        "font-family": [
          /^(Arial|Georgia|Verdana|monospace|sans-serif|serif)$/i,
        ],
        "font-size": [/^(12|14|16|18|20|24|28|32)px$/],
        "line-height": [/^(1|1\.25|1\.5|1\.75|2)$/],
        "margin-left": [/^(0|24|48|72|96|120)px$/],
      },
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
    nestingLimit: 20,
  });
  const text = convert(bodyHtml, {
    wordwrap: false,
    selectors: [{ selector: "a", options: { ignoreHref: true } }],
  }).trim();
  if (!text || text.length > 100000)
    throw new AppError(
      400,
      "INVALID_BODY",
      "Enter a message with 1–100,000 characters of text.",
    );
  return { body: text, bodyHtml };
}
