import type { CSSProperties, ImgHTMLAttributes } from "react";

type MarkProps = {
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  /** Extra zoom to crop PNG padding so the H reads at small sizes. Default 1.42. */
  zoom?: number;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "width" | "height">;

/**
 * Hustronix brand mark (hex H + gold spine).
 * Use for assistant identity: chat avatars, Ask, title icons — not decorative sparkles.
 */
export function HustronixMark({
  size = 24,
  className,
  style,
  title,
  zoom = 1.42,
  ...rest
}: MarkProps) {
  const dim = typeof size === "number" ? size : 24;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/hustronix-mark.png"
      alt={title ?? ""}
      width={dim}
      height={dim}
      className={className}
      style={{
        display: "block",
        flexShrink: 0,
        width: size,
        height: size,
        objectFit: "contain",
        mixBlendMode: "lighten",
        transform: zoom !== 1 ? `scale(${zoom})` : undefined,
        transformOrigin: "center",
        ...style,
      }}
      aria-hidden={title ? undefined : true}
      {...rest}
    />
  );
}
