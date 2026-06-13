import { cn } from "@/lib/cn";
import {
  InstagramIcon,
  LinkedInIcon,
  XIcon,
} from "@/components/icons/brand-icons";

const socialLinks = [
  {
    href: "https://www.linkedin.com/company/hustronix/",
    label: "Hustronix on LinkedIn",
    Icon: LinkedInIcon,
  },
  {
    href: "https://www.instagram.com/hustronix.online",
    label: "Hustronix on Instagram",
    Icon: InstagramIcon,
  },
  {
    href: "https://x.com/hustronix31431",
    label: "Hustronix on X",
    Icon: XIcon,
  },
] as const;

const iconButtonClass = cn(
  "inline-flex size-10 items-center justify-center rounded-full",
  "border border-white/[0.1] bg-white/[0.03] text-hx-muted",
  "transition-colors duration-200",
  "hover:border-landing-gold/35 hover:bg-landing-gold/10 hover:text-landing-gold",
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-landing-gold/60",
);

export function SocialFooterLinks({ className }: { className?: string }) {
  return (
    <nav
      className={cn("flex items-center gap-2", className)}
      aria-label="Social media"
    >
      {socialLinks.map(({ href, label, Icon }) => (
        <a
          key={href}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={iconButtonClass}
          aria-label={label}
        >
          <Icon />
        </a>
      ))}
    </nav>
  );
}
