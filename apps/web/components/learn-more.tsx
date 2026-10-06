"use client";
// "Info text, then Learn more, then a short modal, then the full write-up in How it works" (Round 3).

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/motion/modal";
import { CONCEPTS, type ConceptId } from "@/lib/concepts";
import { cn } from "@/lib/utils";

/** A small inline link-style button. Put it at the end of a sentence of info text. */
export function LearnMore({
  concept,
  label = "Learn more",
  className,
}: {
  concept: ConceptId;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const c = CONCEPTS[concept]!;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("learn-more", className)}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title={c.title}
        className="max-w-[480px] !bg-[rgba(26,28,33,0.74)]"
      >
        <div className="grid gap-3 text-fg2 leading-7">
          {c.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
        <Link
          href={`/docs#how-${c.id}`}
          onClick={() => setOpen(false)}
          className="btn btn-glassy mt-5 w-full no-underline"
        >
          Tell me more <ArrowRight size={15} aria-hidden />
        </Link>
      </Modal>
    </>
  );
}

/** One sentence of info text ending in Learn more. */
export function InfoText({
  children,
  concept,
  className,
}: {
  children: React.ReactNode;
  concept: ConceptId;
  className?: string;
}) {
  return (
    <p className={cn("t-meta", className)}>
      {children} <LearnMore concept={concept} />
    </p>
  );
}
