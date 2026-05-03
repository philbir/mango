import { Fragment, type ReactNode } from "react";

/**
 * Lightweight markdown renderer for assistant chat. Supports:
 *
 *  - Fenced code blocks (```lang\ncode\n```) — rendered via `renderCodeBlock`
 *  - Headings (#, ##, ###)
 *  - Unordered lists (- or *), ordered lists (1.)
 *  - Block quotes (> …)
 *  - Inline code (`x`), bold (**x**), italic (*x* or _x_), links ([text](url))
 *  - Paragraphs separated by blank lines
 *
 * No HTML is interpreted — output is always sanitized text + react elements.
 */

interface Props {
  text: string;
  renderCodeBlock?: (lang: string, code: string, index: number) => ReactNode;
}

const splitFences = (
  text: string,
): Array<{ kind: "code"; lang: string; code: string } | { kind: "text"; text: string }> => {
  const out: Array<
    { kind: "code"; lang: string; code: string } | { kind: "text"; text: string }
  > = [];
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) {
      out.push({ kind: "text", text: text.slice(last, m.index) });
    }
    out.push({ kind: "code", lang: (m[1] ?? "").toLowerCase(), code: m[2] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
};

const renderInline = (raw: string, keyPrefix: string): ReactNode[] => {
  // Order matters — code spans first so we don't re-process their contents.
  const out: ReactNode[] = [];
  // Tokenize: split by code spans first.
  const codeRe = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = codeRe.exec(raw))) {
    if (m.index > last) {
      out.push(
        <Fragment key={`${keyPrefix}-${i++}`}>
          {renderEmphasis(raw.slice(last, m.index), `${keyPrefix}-${i}`)}
        </Fragment>,
      );
    }
    out.push(
      <code
        key={`${keyPrefix}-${i++}`}
        className="rounded bg-slate-200/70 px-1 py-px font-mono text-[0.85em] text-slate-800 dark:bg-slate-700/60 dark:text-slate-100"
      >
        {m[1]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    out.push(
      <Fragment key={`${keyPrefix}-${i++}`}>
        {renderEmphasis(raw.slice(last), `${keyPrefix}-${i}`)}
      </Fragment>,
    );
  }
  return out;
};

const renderEmphasis = (raw: string, keyPrefix: string): ReactNode[] => {
  const out: ReactNode[] = [];
  // bold: **x**, italic: *x* or _x_, link: [text](url)
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(raw))) {
    if (m.index > last) {
      out.push(<Fragment key={`${keyPrefix}-${i++}`}>{raw.slice(last, m.index)}</Fragment>);
    }
    const tok = m[1]!;
    if (tok.startsWith("**")) {
      out.push(
        <strong key={`${keyPrefix}-${i++}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const close = tok.indexOf("](");
      const text = tok.slice(1, close);
      const url = tok.slice(close + 2, -1);
      out.push(
        <a
          key={`${keyPrefix}-${i++}`}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sky-600 underline hover:text-sky-500 dark:text-sky-400"
        >
          {text}
        </a>,
      );
    } else {
      out.push(
        <em key={`${keyPrefix}-${i++}`} className="italic">
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    out.push(<Fragment key={`${keyPrefix}-${i++}`}>{raw.slice(last)}</Fragment>);
  }
  return out;
};

const renderTextBlock = (text: string, keyPrefix: string): ReactNode[] => {
  // Split into lines, group into blocks (paragraph, list, heading, blockquote).
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let para: string[] = [];
  let bi = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(
      <p
        key={`${keyPrefix}-p-${bi++}`}
        className="my-2 whitespace-pre-wrap leading-relaxed first:mt-0 last:mb-0"
      >
        {renderInline(para.join("\n"), `${keyPrefix}-p-${bi}`)}
      </p>,
    );
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    // Heading
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = (h[1] ?? "#").length;
      const inner = renderInline(h[2] ?? "", `${keyPrefix}-h-${bi}`);
      const cls =
        level === 1
          ? "mt-3 mb-2 text-lg font-semibold first:mt-0"
          : level === 2
            ? "mt-3 mb-1.5 text-base font-semibold first:mt-0"
            : "mt-2 mb-1 text-sm font-semibold first:mt-0";
      const Tag = (`h${level}` as unknown) as "h1" | "h2" | "h3";
      blocks.push(
        <Tag key={`${keyPrefix}-h-${bi++}`} className={cls}>
          {inner}
        </Tag>,
      );
      i++;
      continue;
    }

    // Block quote
    if (line.startsWith("> ")) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && (lines[i] ?? "").startsWith("> ")) {
        items.push((lines[i] ?? "").slice(2));
        i++;
      }
      blocks.push(
        <blockquote
          key={`${keyPrefix}-bq-${bi++}`}
          className="my-2 border-l-2 border-slate-300 pl-3 text-slate-600 dark:border-slate-600 dark:text-slate-300"
        >
          {renderInline(items.join("\n"), `${keyPrefix}-bq-${bi}`)}
        </blockquote>,
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={`${keyPrefix}-ul-${bi++}`}
          className="my-2 list-disc space-y-0.5 pl-5"
        >
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `${keyPrefix}-ul-${bi}-${j}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={`${keyPrefix}-ol-${bi++}`}
          className="my-2 list-decimal space-y-0.5 pl-5"
        >
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `${keyPrefix}-ol-${bi}-${j}`)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return blocks;
};

export const Markdown = ({ text, renderCodeBlock }: Props) => {
  const segments = splitFences(text);
  return (
    <div className="text-[13px] text-slate-800 dark:text-slate-200">
      {segments.map((seg, i) => {
        if (seg.kind === "code") {
          if (renderCodeBlock) {
            return (
              <Fragment key={`code-${i}`}>
                {renderCodeBlock(seg.lang, seg.code, i)}
              </Fragment>
            );
          }
          return (
            <pre
              key={`code-${i}`}
              className="my-2 overflow-x-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[12px] dark:border-slate-700 dark:bg-slate-900"
            >
              <code>{seg.code}</code>
            </pre>
          );
        }
        return (
          <Fragment key={`t-${i}`}>{renderTextBlock(seg.text, `t-${i}`)}</Fragment>
        );
      })}
    </div>
  );
};
