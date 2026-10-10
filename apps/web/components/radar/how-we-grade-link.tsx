"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/motion/modal";
import { GRADE_BANDS, GRADE_INTRO, GRADE_RULES } from "@/lib/grade-rules";

/** "How we grade tokens": opens the short explanation in a modal, which ends in a link to the full one in the docs. */
export function HowWeGradeLink() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="how-we-grade-link"
        aria-haspopup="dialog"
        className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-[14.5px] link-text"
        onClick={() => setOpen(true)}
      >
        How we grade tokens
      </button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="How a grade is made"
        showClose
        className="max-w-[560px]"
      >
        <div data-testid="how-we-grade-modal" className="grid gap-3 text-fg2 leading-7">
          <p>{GRADE_INTRO}</p>
          <ul className="m-0 grid list-none gap-2 p-0">
            {GRADE_RULES.map(([h, b]) => (
              <li key={h} className="panel p-3">
                <p className="font-semibold text-fg">{h}</p>
                <p className="mt-0.5 text-[15px]">{b}</p>
              </li>
            ))}
          </ul>
          <p className="t-meta">{GRADE_BANDS}</p>
        </div>
        <Link
          href="/how-it-works#how-grades"
          onClick={() => setOpen(false)}
          data-testid="how-we-grade-docs"
          className="btn btn-glassy mt-5 w-full no-underline"
        >
          Read the full explanation in the docs <ArrowRight size={15} aria-hidden />
        </Link>
      </Modal>
    </>
  );
}
