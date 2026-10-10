import type { Metadata } from "next";
import { DesignShowcase } from "@/components/design-showcase";

export const metadata: Metadata = {
  title: "İnterfeys nümunələri — VisioFlow",
  description: "VisioFlow üçün üç alternativ iş sahəsini müqayisə et.",
};

export default function DesignsPage() {
  return <DesignShowcase />;
}
