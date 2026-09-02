import {
  useState,
  type ChangeEventHandler,
  type ClipboardEventHandler,
  type CSSProperties,
  type FormEventHandler,
  type KeyboardEventHandler,
  type Ref
} from "react";

interface ComposerHighlightSegment {
  text: string;
  command: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits slash commands from surrounding text without changing textarea layout. */
export function composerHighlightSegments(
  input: string,
  highlightedCommands: readonly string[]
): ComposerHighlightSegment[] {
  const commands = [...new Set(highlightedCommands.filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!commands.length || !input) return [{ text: input, command: false }];

  const commandPattern = commands.map(escapeRegExp).join("|");
  const matcher = new RegExp(`(^|\\s)(${commandPattern})(?=\\s|$)`, "gi");
  const segments: ComposerHighlightSegment[] = [];
  let cursor = 0;

  for (const match of input.matchAll(matcher)) {
    const matchIndex = match.index ?? 0;
    const leadingSpace = match[1] ?? "";
    const command = match[2] ?? "";
    const commandStart = matchIndex + leadingSpace.length;
    if (commandStart > cursor) {
      segments.push({ text: input.slice(cursor, commandStart), command: false });
    }
    segments.push({ text: command, command: true });
    cursor = commandStart + command.length;
  }
  if (cursor < input.length) {
    segments.push({ text: input.slice(cursor), command: false });
  }
  return segments.length ? segments : [{ text: input, command: false }];
}

/** Native textarea with an aligned backdrop that paints slash commands as inline chips. */
export function ComposerHighlightedTextarea(props: {
  value: string;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  rows?: number;
  highlightedCommands?: readonly string[];
  textareaRef?: Ref<HTMLTextAreaElement>;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onInput?: FormEventHandler<HTMLTextAreaElement>;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const segments = composerHighlightSegments(props.value, props.highlightedCommands ?? []);

  return (
    <div className="composer-rich-input composer-rich-input--highlighted">
      <div className="composer-rich-input__backdrop" aria-hidden="true">
        <div style={{ transform: `translateY(${-scrollTop}px)` }}>
          {segments.map((segment, index) => segment.command ? (
            <span key={index} className="composer-slash-chip">{segment.text}</span>
          ) : (
            <span key={index}>{segment.text}</span>
          ))}
          {props.value.endsWith("\n") ? "\n" : null}
        </div>
      </div>
      <textarea
        ref={props.textareaRef}
        value={props.value}
        placeholder={props.placeholder}
        rows={props.rows}
        style={props.style}
        onChange={props.onChange}
        onKeyDown={props.onKeyDown}
        onPaste={props.onPaste}
        onInput={props.onInput}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className={`${props.className ?? ""} composer-rich-input__field--highlighted`}
      />
    </div>
  );
}
