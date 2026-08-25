import type { ReactNode, SVGProps } from "react";

/**
 * Hustronix icon pack — 24×24, 2px stroke, round caps/joins.
 * Matches the product icon sheet (nav + intelligence metaphors).
 */
export type HxIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number | string;
};

export const HX_ICON_STROKE = 2;

export function HxIcon({
  size = 24,
  strokeWidth = HX_ICON_STROKE,
  children,
  style,
  ...rest
}: HxIconProps & { children?: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      style={{ display: "block", flexShrink: 0, ...style }}
      {...rest}
    >
      {children}
    </svg>
  );
}

function icon(name: string, children: ReactNode) {
  function Icon(props: HxIconProps) {
    return <HxIcon {...props}>{children}</HxIcon>;
  }
  Icon.displayName = name;
  return Icon;
}

export const Home = icon(
  "Home",
  <>
    <path d="M4 10.8 12 3.8l8 7" />
    <path d="M6.2 9.8V20h11.6V9.8" />
    <path d="M10 20v-5.2h4V20" />
  </>,
);

/** Company Brain — side-profile lobes (icon sheet). */
export const Brain = icon(
  "Brain",
  <>
    <path d="M9.2 19.4c-1.8-.2-3.4-1.8-3.4-3.8 0-.9.3-1.7.8-2.3A4 4 0 0 1 6 10.2c0-2.4 1.9-4.3 4.3-4.3.6-1.5 2.1-2.5 3.8-2.5 2.1 0 3.8 1.4 4.3 3.3 1.7.4 2.9 1.9 2.9 3.7 0 1.2-.6 2.3-1.5 3 .4.7.6 1.5.6 2.4 0 2.3-1.8 4.1-4.1 4.1-.7 0-1.4-.2-2-.5-.7.7-1.7 1.1-2.8 1.1-.7 0-1.4-.2-2-.5" />
    <path d="M9.4 10.6c1.2-.6 2.6-.4 3.6.6 1.1-1.2 3-1.4 4.2-.2" />
    <path d="M9.2 14c1.3-.6 2.8-.3 3.8.8" />
  </>,
);

/** Decisions — balance scales (icon sheet). */
export const Scale = icon(
  "Scale",
  <>
    <path d="M12 3.4v14.4" />
    <path d="M7.2 20.6h9.6" />
    <path d="M5.2 3.4h13.6" />
    <path d="M7.6 3.4 4.4 11.2h6.4Z" />
    <path d="M16.4 3.4 13.2 11.2h6.4Z" />
    <path d="M4.4 11.2h6.4M13.2 11.2h6.4" />
  </>,
);

/** @deprecated Prefer Scale — kept for existing imports. */
export const Gavel = Scale;

export const Zap = icon("Zap", <path d="M13.2 3.2 6.5 13h6.2l-1.8 7.8 6.7-9.8h-6.2Z" />);

/** Signals — pulse / EKG (icon sheet). */
export const Activity = icon("Activity", <path d="M3.2 12h4.2l2.2-6.4 3.4 12.8L15.6 12H20.8" />);

/** Legacy radio rings — kept where broadcast metaphor is needed. */
export const Radio = icon(
  "Radio",
  <>
    <circle cx="12" cy="12" r="1.5" />
    <path d="M8.4 8.4a5.1 5.1 0 0 0 0 7.2" />
    <path d="M15.6 8.4a5.1 5.1 0 0 1 0 7.2" />
    <path d="M5.8 5.8a8.8 8.8 0 0 0 0 12.4" />
    <path d="M18.2 5.8a8.8 8.8 0 0 1 0 12.4" />
  </>,
);

/** Analytics — bar chart (icon sheet). */
export const BarChart3 = icon(
  "BarChart3",
  <>
    <path d="M4.4 20.2h15.2" />
    <path d="M7 20.2V11.2" />
    <path d="M12 20.2V6.4" />
    <path d="M17 20.2v-5.6" />
  </>,
);

export const ListChecks = icon(
  "ListChecks",
  <>
    <path d="M10 6.4h10.4" />
    <path d="M10 12h10.4" />
    <path d="M10 17.6h10.4" />
    <path d="M3.6 6.2l1.5 1.5 2.8-2.9" />
    <path d="M3.6 11.8l1.5 1.5 2.8-2.9" />
    <path d="M3.6 17.4l1.5 1.5 2.8-2.9" />
  </>,
);

export const Bell = icon(
  "Bell",
  <>
    <path d="M6.8 10a5.2 5.2 0 0 1 10.4 0v4.6l1.6 2.2H5.2L6.8 14.6Z" />
    <path d="M10 17.6a2 2 0 0 0 4 0" />
  </>,
);

export const BellOff = icon(
  "BellOff",
  <>
    <path d="M6.8 10a5.2 5.2 0 0 1 10.4 0v4.6l1.6 2.2H5.2L6.8 14.6Z" />
    <path d="M10 17.6a2 2 0 0 0 4 0" />
    <path d="M4.5 4.5 19.5 19.5" />
  </>,
);

export const Search = icon(
  "Search",
  <>
    <circle cx="10.5" cy="10.5" r="5.7" />
    <path d="m14.8 14.8 5 5" />
  </>,
);

export const Settings = icon(
  "Settings",
  <>
    <circle cx="12" cy="12" r="2.8" />
    <path d="M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M5.8 18.2l1.7-1.7M16.5 7.5l1.7-1.7" />
  </>,
);

export const Sparkles = icon("Sparkles", <path d="M12 3.4 14 10l6.6 2L14 14l-2 6.6L10 14l-6.6-2L10 10Z" />);

export const Rocket = icon(
  "Rocket",
  <>
    <path d="M12 3.2c2.2 4.2 3.6 8.2 3.6 11.2a3.6 3.6 0 1 1-7.2 0c0-3 1.4-7 3.6-11.2Z" />
    <circle cx="12" cy="11.2" r="1.25" />
    <path d="M9.2 16.6 7.6 21M14.8 16.6 16.4 21" />
  </>,
);

export const Building2 = icon(
  "Building2",
  <>
    <rect x="6.2" y="3.4" width="11.6" height="17.2" rx="1.6" />
    <path d="M10.4 20.6v-3.2h3.2v3.2" />
    <path d="M9 7.4h6v5.2H9Z" />
    <path d="M12 7.4v5.2M9 10h6" />
  </>,
);

export const User = icon(
  "User",
  <>
    <circle cx="12" cy="8" r="2.8" />
    <path d="M5.4 19.6c0-3.5 2.8-5.4 6.6-5.4s6.6 1.9 6.6 5.4" />
  </>,
);

export const Users = icon(
  "Users",
  <>
    <circle cx="9" cy="8.2" r="2.5" />
    <path d="M4.4 19.4c0-3 2.2-4.7 4.6-4.7s4.6 1.7 4.6 4.7" />
    <circle cx="16.2" cy="9" r="2.1" />
    <path d="M14.6 14.8c2.2.2 4.2 1.8 4.2 4.6" />
  </>,
);

export const Star = icon("Star", <path d="M12 3.6 14.4 9.2l6.1.6-4.6 4.2 1.4 6-5.3-3.2-5.3 3.2 1.4-6-4.6-4.2 6.1-.6Z" />);

export const Circle = icon("Circle", <circle cx="12" cy="12" r="7.6" />);

export const ChevronDown = icon("ChevronDown", <path d="M6 9.5 12 15.5 18 9.5" />);
export const ChevronLeft = icon("ChevronLeft", <path d="M14.5 6 8.5 12l6 6" />);
export const ChevronRight = icon("ChevronRight", <path d="M9.5 6 15.5 12l-6 6" />);

export const X = icon("X", <path d="M6 6 18 18M18 6 6 18" />);
export const Check = icon("Check", <path d="M5 12.2 9.8 17 19 7.6" />);
export const Minus = icon("Minus", <path d="M5 12h14" />);
export const Plus = icon("Plus", <path d="M12 5v14M5 12h14" />);

export const MoreHorizontal = icon(
  "MoreHorizontal",
  <>
    <circle cx="6.2" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="17.8" cy="12" r="1.15" fill="currentColor" stroke="none" />
  </>,
);
export const Ellipsis = MoreHorizontal;

export const Menu = icon("Menu", <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />);

export const PanelLeftClose = icon(
  "PanelLeftClose",
  <>
    <rect x="3.8" y="4.4" width="16.4" height="15.2" rx="2" />
    <path d="M10 4.4v15.2" />
    <path d="M16.4 9.4 13.2 12l3.2 2.6" />
  </>,
);

export const PanelLeftOpen = icon(
  "PanelLeftOpen",
  <>
    <rect x="3.8" y="4.4" width="16.4" height="15.2" rx="2" />
    <path d="M10 4.4v15.2" />
    <path d="M13.2 9.4 16.4 12l-3.2 2.6" />
  </>,
);

export const Send = icon("Send", <path d="M4.2 5.2 20.2 12 4.2 18.8 7.8 12Z" />);

export const MessageSquare = icon(
  "MessageSquare",
  <>
    <path d="M5 4.8h14v10.4H9.2L5 19.2Z" />
    <circle cx="9" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="10" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="0.9" fill="currentColor" stroke="none" />
  </>,
);
export const Mic = icon(
  "Mic",
  <>
    <rect x="9" y="3.6" width="6" height="10.2" rx="3" />
    <path d="M6.6 11.2a5.4 5.4 0 0 0 10.8 0" />
    <path d="M12 16.6V20.2" />
    <path d="M9.2 20.2h5.6" />
  </>,
);

export const Paperclip = icon(
  "Paperclip",
  <path d="M15.6 8.2 9.4 14.4a2.8 2.8 0 1 1-4-4l7.4-7.4a4 4 0 0 1 5.7 5.7l-7.6 7.6a5.2 5.2 0 1 1-7.4-7.4l6.8-6.8" />,
);

export const Type = icon(
  "Type",
  <>
    <path d="M5 6.2h14" />
    <path d="M12 6.2V18" />
    <path d="M8.4 18h7.2" />
  </>,
);

export const Share2 = icon(
  "Share2",
  <>
    <circle cx="18" cy="6.2" r="2.15" />
    <circle cx="6" cy="12" r="2.15" />
    <circle cx="18" cy="17.8" r="2.15" />
    <path d="m8.1 11.1 7.7-3.8M8.1 12.9l7.7 3.8" />
  </>,
);

export const ArrowUpRight = icon(
  "ArrowUpRight",
  <>
    <path d="M7 17 17 7" />
    <path d="M9 7h8v8" />
  </>,
);

export const ArrowDownRight = icon(
  "ArrowDownRight",
  <>
    <path d="M7 7 17 17" />
    <path d="M9 17h8V9" />
  </>,
);

export const ArrowRight = icon(
  "ArrowRight",
  <>
    <path d="M4.4 12h15.2" />
    <path d="M14 7 19.6 12 14 17" />
  </>,
);

export const ArrowLeft = icon(
  "ArrowLeft",
  <>
    <path d="M19.6 12H4.4" />
    <path d="M10 7 4.4 12 10 17" />
  </>,
);

export const AlertTriangle = icon(
  "AlertTriangle",
  <>
    <path d="M12 4.6 20.6 19.4H3.4Z" />
    <path d="M12 10v4.4" />
    <path d="M12 16.8v1" />
  </>,
);

export const Shield = icon("Shield", <path d="M12 3.6 19.2 6.6v6.2c0 4.1-2.8 6.6-7.2 8.1-4.4-1.5-7.2-4-7.2-8.1V6.6Z" />);

export const ShieldAlert = icon(
  "ShieldAlert",
  <>
    <path d="M12 3.6 19.2 6.6v6.2c0 4.1-2.8 6.6-7.2 8.1-4.4-1.5-7.2-4-7.2-8.1V6.6Z" />
    <path d="M12 9.4v4" />
    <path d="M12 15.8v1" />
  </>,
);

export const TrendingUp = icon(
  "TrendingUp",
  <>
    <path d="M3.6 16.2 9.2 10.6l3.8 3.4L20.4 6.8" />
    <path d="M14.8 6.8h5.6v5.6" />
  </>,
);

export const TrendingDown = icon(
  "TrendingDown",
  <>
    <path d="M3.6 7.8 9.2 13.4l3.8-3.4 7.4 7.2" />
    <path d="M14.8 17.2h5.6v-5.6" />
  </>,
);

export const Trophy = icon(
  "Trophy",
  <>
    <path d="M8 5.4h8v5a4 4 0 0 1-8 0Z" />
    <path d="M8 7.6H5.6a3 3 0 0 0 3 3.2" />
    <path d="M16 7.6h2.4a3 3 0 0 1-3 3.2" />
    <path d="M12 14.4v3M8.6 20.4h6.8" />
  </>,
);

export const GitBranch = icon(
  "GitBranch",
  <>
    <circle cx="6.2" cy="6.2" r="2.05" />
    <circle cx="6.2" cy="17.8" r="2.05" />
    <circle cx="17.8" cy="12" r="2.05" />
    <path d="M6.2 8.25v7.5" />
    <path d="M6.2 10.4c0 2.2 4.2 3.6 9.5 3.6" />
  </>,
);

export const Calendar = icon(
  "Calendar",
  <>
    <rect x="4" y="6.2" width="16" height="14" rx="2" />
    <path d="M8 4.4v3.2M16 4.4v3.2" />
    <path d="M4 10.4h16" />
    <path d="M8 13.4h1.6M12 13.4h1.6M16 13.4h1.6M8 16.8h1.6M12 16.8h1.6M16 16.8h1.6" />
  </>,
);

export const Clock = icon(
  "Clock",
  <>
    <circle cx="12" cy="12" r="7.8" />
    <path d="M12 7.4V12h4.4" />
  </>,
);

export const Phone = icon(
  "Phone",
  <>
    <path d="M8.4 5.4c1.1-1.2 3-1.3 4.2-.2l.8.9c.6.6.5 1.5-.2 2l-.9.7c1.7 2 3.6 3.7 5.8 5.1l.8-1c.6-.6 1.5-.7 2.1-.1l1 .9c1.2 1 1.3 2.9.1 4.1l-.7.7c-1.3 1.2-3.3 1.4-4.9.5-3.6-2-6.7-5.1-8.8-8.8-.9-1.6-.7-3.6.5-4.9z" />
    <path d="M16.2 5c1.4.2 2.7 1.1 3.4 2.4M17.4 3.4c2.1.4 3.8 1.9 4.6 4" />
  </>,
);

export const Target = icon(
  "Target",
  <>
    <circle cx="12" cy="12" r="7.8" />
    <circle cx="12" cy="12" r="4.3" />
    <circle cx="12" cy="12" r="1.2" />
  </>,
);

export const Tag = icon(
  "Tag",
  <>
    <path d="M4.4 11.6V4.4H12l8 8-7.6 7.6Z" />
    <circle cx="8.2" cy="8.2" r="1.2" />
  </>,
);

export const Bookmark = icon("Bookmark", <path d="M7.2 4.4h9.6v15.2L12 16 7.2 19.6Z" />);

export const FileText = icon(
  "FileText",
  <>
    <path d="M4.4 5.4h10.2v14H4.4Z" />
    <path d="M14.6 7.4h5v12h-5" />
    <rect x="6" y="7.8" width="4.4" height="3.2" rx="0.6" />
    <path d="M6 13h7M6 15.6h7M6 18.2h4.4" />
  </>,
);

export const FolderKanban = icon(
  "FolderKanban",
  <>
    <rect x="3.6" y="6.4" width="16.8" height="11.6" rx="2" />
    <path d="M6.6 9.6h10.8M6.6 12.4h10.8M6.6 15.2h7.4" />
  </>,
);

export const BookOpen = icon(
  "BookOpen",
  <>
    <rect x="7.2" y="4.2" width="12.2" height="15.6" rx="1.4" />
    <path d="M7.2 7.2H5M7.2 12H5M7.2 16.8H5" />
    <path d="M10.4 8.4h6M10.4 11.6h6M10.4 14.8h4.2" />
  </>,
);

export const LifeBuoy = icon(
  "LifeBuoy",
  <>
    <circle cx="12" cy="12" r="7.8" />
    <circle cx="12" cy="12" r="3.1" />
    <path d="M12 4.2v4.7M12 15.1v4.7M4.2 12h4.7M15.1 12h4.7" />
  </>,
);

export const Mail = icon(
  "Mail",
  <>
    <rect x="3.6" y="6.4" width="16.8" height="11.6" rx="2" />
    <path d="M3.8 8.6 12 14.2 20.2 8.6" />
  </>,
);

export const Laptop = icon(
  "Laptop",
  <>
    <path d="M3.6 18.6h16.8" />
    <path d="M6.4 18.6 8 8.4h9.6l1.4 10.2" />
  </>,
);

export const Monitor = icon(
  "Monitor",
  <>
    <rect x="3.6" y="4.2" width="16.8" height="11.4" rx="2" />
    <path d="M12 15.6v3.2M8.4 20.4h7.2" />
  </>,
);

export const Smartphone = icon(
  "Smartphone",
  <>
    <rect x="7.4" y="3.2" width="9.2" height="17.6" rx="2" />
    <path d="M10.4 5.4h3.2" />
    <circle cx="12" cy="18.4" r="0.85" />
  </>,
);

export const CreditCard = icon(
  "CreditCard",
  <>
    <rect x="3.4" y="6.4" width="17.2" height="11.6" rx="2" />
    <path d="M6.4 10.2h11.2M6.4 13h11.2M6.4 15.8h7.2" />
  </>,
);

export const Lock = icon(
  "Lock",
  <>
    <rect x="6.8" y="10.6" width="10.4" height="9" rx="1.6" />
    <path d="M9 10.6V7.8a3 3 0 0 1 6 0v2.8" />
  </>,
);

export const LogOut = icon(
  "LogOut",
  <>
    <path d="M10.2 5.4H5.2v13.2h5" />
    <path d="M10.2 12h9.2" />
    <path d="M16.2 8.4 19.4 12 16.2 15.6" />
  </>,
);

export const Plug = icon(
  "Plug",
  <>
    <path d="M9 4.4v4M15 4.4v4" />
    <path d="M8 8.4h8v5.2a4 4 0 0 1-8 0Z" />
    <path d="M12 13.6v6" />
  </>,
);

export const Layers = icon(
  "Layers",
  <>
    <path d="M4.4 8.4 12 4.4l7.6 4-7.6 4Z" />
    <path d="M4.4 12.4 12 16.4l7.6-4" />
    <path d="M4.4 16.4 12 20.4l7.6-4" />
  </>,
);

export const ScrollText = icon(
  "ScrollText",
  <>
    <rect x="6.4" y="3.8" width="11.2" height="16.4" rx="1.6" />
    <path d="M9 8.4h6M9 12h6M9 15.6h4" />
  </>,
);

export const SlidersHorizontal = icon(
  "SlidersHorizontal",
  <>
    <path d="M4.4 7h15.2M4.4 12h15.2M4.4 17h15.2" />
    <circle cx="10" cy="7" r="1.9" />
    <circle cx="15.2" cy="12" r="1.9" />
    <circle cx="8.6" cy="17" r="1.9" />
  </>,
);

export const Trash2 = icon(
  "Trash2",
  <>
    <path d="M5 8h14" />
    <path d="M9 8V5.6h6V8" />
    <path d="M7.4 8v11.4h9.2V8" />
    <path d="M10.4 11.4v5M13.6 11.4v5" />
  </>,
);

export const Info = icon(
  "Info",
  <>
    <circle cx="12" cy="12" r="7.8" />
    <path d="M12 11v5.2" />
    <circle cx="12" cy="8.2" r="0.7" fill="currentColor" stroke="none" />
  </>,
);

export const CircleHelp = icon(
  "CircleHelp",
  <>
    <path d="M8.2 8.4a3.8 3.8 0 1 1 4 4.6c-1.2.5-1.8 1.4-1.8 2.8v.3" />
    <path d="M12 18.8v1.2" />
  </>,
);

export const CheckCircle2 = icon(
  "CheckCircle2",
  <>
    <circle cx="12" cy="12" r="7.8" />
    <path d="M8.2 12.2 10.8 15 16.2 9.4" />
  </>,
);

export const XCircle = icon(
  "XCircle",
  <>
    <circle cx="12" cy="12" r="7.8" />
    <path d="M9.2 9.2 14.8 14.8M14.8 9.2 9.2 14.8" />
  </>,
);

export const Maximize2 = icon(
  "Maximize2",
  <>
    <path d="M14.2 5.2h4.6V9.8" />
    <path d="M18.8 5.2 13.4 10.6" />
    <path d="M9.8 18.8H5.2v-4.6" />
    <path d="M5.2 18.8 10.6 13.4" />
  </>,
);

export const Minimize2 = icon(
  "Minimize2",
  <>
    <path d="M18.8 9.8h-4.6V5.2" />
    <path d="M18.8 5.2 13.4 10.6" />
    <path d="M5.2 14.2h4.6v4.6" />
    <path d="M5.2 18.8 10.6 13.4" />
  </>,
);

export const ZoomIn = icon(
  "ZoomIn",
  <>
    <circle cx="10.5" cy="10.5" r="5.7" />
    <path d="m14.8 14.8 5 5M10.5 8v5M8 10.5h5" />
  </>,
);

export const ZoomOut = icon(
  "ZoomOut",
  <>
    <circle cx="10.5" cy="10.5" r="5.7" />
    <path d="m14.8 14.8 5 5M8 10.5h5" />
  </>,
);

export const History = icon(
  "History",
  <>
    <path d="M5.2 12a6.8 6.8 0 1 0 1.8-4.6" />
    <path d="M5.2 4.8v4h4" />
    <path d="M12 9.4V12l2.4 1.5" />
  </>,
);

export const SquarePen = icon(
  "SquarePen",
  <>
    <rect x="4.4" y="4.4" width="10" height="10" rx="1.6" />
    <path d="M14.4 9.8 19.6 4.6" />
    <path d="M16.8 12.6 20 9.4 17.2 6.6 14 9.4" />
  </>,
);

export const Briefcase = icon(
  "Briefcase",
  <>
    <rect x="3.8" y="8.6" width="16.4" height="10.4" rx="1.8" />
    <path d="M9 8.6V6.4h6v2.2" />
    <path d="M3.8 13.2h16.4" />
  </>,
);

export const Download = icon(
  "Download",
  <>
    <path d="M12 4.5v10" />
    <path d="M8.2 11.2 12 15l3.8-3.8" />
    <path d="M5 18.5h14" />
  </>,
);

export const Filter = icon(
  "Filter",
  <>
    <path d="M4.5 6.5h15" />
    <path d="M7 12h10" />
    <path d="M10 17.5h4" />
  </>,
);
