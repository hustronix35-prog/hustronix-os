"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  type ComponentPropsWithoutRef,
  type ReactNode,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}
import { cn } from "@/lib/cn";
import { revealViewport } from "@/components/landing/scroll-reveal-config";

const ease = [0.22, 1, 0.36, 1] as const;

const itemFade = {
  hidden: { opacity: 0, y: 36 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.58, ease },
  },
};

export function Reveal({
  children,
  className,
  delay = 0,
  y = 44,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={revealViewport}
      transition={{ duration: 0.68, delay, ease }}
    >
      {children}
    </motion.div>
  );
}

const heroParent = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.1, delayChildren: 0.12 },
  },
};

const heroChild = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.62, ease },
  },
};

export function HeroReveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={heroParent}
    >
      {children}
    </motion.div>
  );
}

export function HeroRevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div variants={heroChild} className={className}>
      {children}
    </motion.div>
  );
}

export function RevealStaggerList({
  ordered,
  className,
  children,
}: {
  ordered?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const listVariants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: 0.1, delayChildren: 0.06 },
    },
  };
  if (reduce) {
    const Tag = ordered ? "ol" : "ul";
    return <Tag className={className}>{children}</Tag>;
  }
  const Tag = ordered ? motion.ol : motion.ul;
  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={revealViewport}
      variants={listVariants}
    >
      {children}
    </Tag>
  );
}

export function RevealStaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <li className={className}>{children}</li>;
  return (
    <motion.li variants={itemFade} className={className}>
      {children}
    </motion.li>
  );
}

/**
 * Subtle section-level entrance via IntersectionObserver + CSS (respects reduced motion).
 */
export function SectionEnter({
  ref: forwardedRef,
  children,
  className,
  ...rest
}: ComponentPropsWithoutRef<"section"> & { ref?: Ref<HTMLElement>; className?: string }) {
  const innerRef = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(reduce);

  useEffect(() => {
    if (reduce) return;
    const el = innerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { threshold: 0.08, rootMargin: "0px 0px -7% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reduce]);

  const setRefs = (node: HTMLElement | null) => {
    innerRef.current = node;
    assignRef(forwardedRef, node);
  };

  return (
    <section
      ref={setRefs}
      className={cn(
        "landing-section-enter",
        visible && "landing-section-enter--visible",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}
