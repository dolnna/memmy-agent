import { resolveFileType, type FileDisplayKind } from "../lib/file-type.js";

export type FileTypeIconSurface = "inline" | "row" | "card";

function FileKindGlyph({ kind, compact }: { kind: FileDisplayKind; compact: boolean }) {
  const common = {
    className: "file-type-icon__glyph",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: compact ? 1.65 : 1.35
  };
  if (kind === "pdf") return <path {...common} d="M12.8 29c2.6-3.8 4.6-8.9 5.2-13.2.8 4.8 2.8 8.7 5.4 11.4-4.2-.9-8-.2-10.6 1.8Z" />;
  if (kind === "spreadsheet") return <g {...common}><rect x="11.5" y="17.5" width="13" height="11" rx="1.2" /><path d="M16 17.5v11M20.5 17.5v11M11.5 21.2h13M11.5 24.8h13" /></g>;
  if (kind === "presentation") return <g {...common}><rect x="11.5" y="17.5" width="13" height="10.5" rx="1.2" /><path d="M18 19.8v5.4h4.8M18 19.8a5.4 5.4 0 0 1 4.8 5.4" /></g>;
  if (kind === "code") return <g {...common}><path d="m15.2 19-3.5 4 3.5 4M20.8 19l3.5 4-3.5 4" />{!compact ? <path d="m19.3 17.8-2.6 10.4" /> : null}</g>;
  if (kind === "image") return <g {...common}><rect x="11.5" y="17.5" width="13" height="11" rx="1.5" /><path d="m13.5 26 3.2-3.3 2.4 2.2 1.8-1.8 2.1 2.9" /><circle cx="20.9" cy="20.7" r="1" fill="currentColor" stroke="none" /></g>;
  if (kind === "video") return <g {...common}><rect x="11.5" y="17.5" width="13" height="11" rx="1.5" /><path d="m16.5 20.4 5.2 2.6-5.2 2.6Z" fill="currentColor" stroke="none" /></g>;
  if (kind === "audio") return <g {...common}><path d="M21.8 18.5v7.2M21.8 18.5l-6 1.4v7.2" /><ellipse cx="13.8" cy="27.2" rx="2" ry="1.4" fill="currentColor" stroke="none" /><ellipse cx="19.8" cy="25.8" rx="2" ry="1.4" fill="currentColor" stroke="none" /></g>;
  if (kind === "archive") return <g {...common}><path d="M17 16.5h3v3h-3zM17 19.5h3v3h-3zM17 22.5h3v3h-3z" /><path d="M16 28.5h5v-3h-5z" /></g>;
  if (kind === "markdown") return <g {...common}><path d="M11.8 27v-8l3.3 4 3.3-4v8M22 19v8M19.8 24.8 22 27l2.2-2.2" /></g>;
  if (kind === "word") return <g {...common}><path d="M12.5 18.5h11M12.5 22.5h11M12.5 26.5h8" />{!compact ? <path d="M10 18.5v8" /> : null}</g>;
  return <g {...common}><path d="M12.5 19h11M12.5 23h11M12.5 27h7.5" /></g>;
}

export function FileTypeIcon(props: { name: string; mime?: string; surface?: FileTypeIconSurface }) {
  const resolved = resolveFileType(props.name, props.mime);
  const surface = props.surface ?? "row";
  return (
    <span
      className={`file-type-icon file-type-icon--${surface} file-type-icon--${resolved.kind}`}
      aria-label={resolved.label}
      data-file-kind={resolved.kind}
    >
      <svg viewBox="0 0 36 40" aria-hidden="true" focusable="false">
        <path className="file-type-icon__paper" d="M5.5 2.5h17l8 8v27H5.5Z" />
        <path className="file-type-icon__fold" d="M22.5 2.5v8h8" />
        <path className="file-type-icon__fold-edge" d="m22.5 2.5 8 8" />
        <FileKindGlyph kind={resolved.kind} compact={surface === "inline"} />
        {surface === "card" ? <text className="file-type-icon__format-label" x="18" y="34.4" textAnchor="middle">{resolved.shortLabel}</text> : null}
      </svg>
    </span>
  );
}
