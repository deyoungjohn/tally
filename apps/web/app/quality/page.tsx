import { notFound, redirect } from "next/navigation";
import { moduleFlags } from "@/lib/flags";

export const dynamic = "force-dynamic";

/** Quality is now the "Live fills" tab of the Trade page; this address stays so old links work. 404 with the `quality` flag off. */
export default function Page() {
  if (!moduleFlags().quality) notFound();
  redirect("/trade?tab=fills");
}
