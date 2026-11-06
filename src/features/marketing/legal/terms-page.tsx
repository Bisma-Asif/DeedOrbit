import { content } from "@/features/marketing/content"
import { LegalShell } from "@/features/marketing/legal/legal-shell"
import { termsSections } from "@/features/marketing/legal/legal-content"

export function TermsPage() {
  return <LegalShell title={content.legal.termsTitle} sections={termsSections} />
}
