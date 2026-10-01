"use client";
// Adapted from beUI `shared-layout-bg`: a pill that glides between hovered items (DESIGN.md §2.6).

import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import {
  Children,
  cloneElement,
  isValidElement,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  useId,
  useState,
} from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface SharedLayoutBgProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
  pillClassName?: string;
  /** Horizontal inset of the pill relative to each item (px). */
  inset?: number;
}

const variants: Variants = {
  initial: { opacity: 0, filter: "blur(6px)" },
  animate: { opacity: 1, filter: "blur(0px)" },
  exit: (isActive: boolean) => (!isActive ? { opacity: 0, filter: "blur(6px)" } : {}),
};
const reducedVariants: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: (isActive: boolean) => (!isActive ? { opacity: 0 } : {}),
};

export function SharedLayoutBg({
  children,
  className,
  pillClassName,
  inset = 0,
  onMouseLeave,
  ...props
}: SharedLayoutBgProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const uid = useId();
  const reduce = useReducedMotion();

  const items = Children.toArray(children)
    .filter(isValidElement)
    .map((child, index) => {
      const el = child as ReactElement<{
        className?: string;
        onMouseEnter?: () => void;
        children?: ReactNode;
      }>;
      const key = el.key ? String(el.key) : `item-${index}`;
      return cloneElement(
        el,
        {
          key,
          className: cn("relative", el.props.className),
          onMouseEnter: () => {
            el.props.onMouseEnter?.();
            setActiveId(key);
          },
        },
        <>
          <AnimatePresence custom={activeId !== null}>
            {activeId !== null ? (
              <motion.div
                variants={reduce ? reducedVariants : variants}
                initial="initial"
                animate="animate"
                exit="exit"
                custom={activeId !== null}
                className="pointer-events-none absolute inset-y-0"
                style={{ left: -inset, right: -inset }}
              >
                {activeId === key ? (
                  <motion.div
                    layoutId={`shared-bg-${uid}`}
                    transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                    className={cn(
                      "pointer-events-none h-full w-full rounded-full bg-white/[0.06]",
                      pillClassName,
                    )}
                  />
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <span className="relative z-10">{el.props.children}</span>
        </>,
      );
    });

  const handleLeave = (event: MouseEvent<HTMLElement>) => {
    setActiveId(null);
    onMouseLeave?.(event);
  };

  return (
    <motion.div
      {...(props as object)}
      layoutRoot
      onMouseLeave={handleLeave}
      className={cn("flex", className)}
    >
      {items}
    </motion.div>
  );
}
