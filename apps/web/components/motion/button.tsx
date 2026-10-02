"use client";
// Adapted from beUI `button` (beui.dev/components/motion/button), re-skinned with Tally's recipes (DESIGN.md §2.5).

import { type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { SPRING_PRESS } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "glassy" | "light" | "ghost" | "icon";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  glassy: "btn-glassy",
  light: "btn-light",
  ghost: "btn-ghost",
  icon: "btn-icon",
};

interface Common {
  variant?: ButtonVariant;
  /** Full width, 56px tall: the trade card's CTA. */
  big?: boolean;
  children?: ReactNode;
}

export type ButtonProps = Common & Omit<HTMLMotionProps<"button">, "children">;
export type ButtonLinkProps = Common & Omit<HTMLMotionProps<"a">, "children">;

function usePress() {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  return {
    whileTap: reduce ? undefined : { scale: 0.98 },
    whileHover: reduce || !canHover ? undefined : { scale: 1.015 },
    transition: SPRING_PRESS,
  };
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", big, className, children, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      {...usePress()}
      className={cn("btn", VARIANT_CLASS[variant], big && "w-full !h-14", className)}
      {...rest}
    >
      {children}
    </motion.button>
  );
});

export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = "primary", big, className, children, ...rest },
  ref,
) {
  return (
    <motion.a
      ref={ref}
      {...usePress()}
      className={cn("btn", VARIANT_CLASS[variant], big && "w-full !h-14", className)}
      {...rest}
    >
      {children}
    </motion.a>
  );
});
