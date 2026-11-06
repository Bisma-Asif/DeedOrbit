import { content } from "@/features/marketing/content"
import { LegalShell } from "@/features/marketing/legal/legal-shell"
import { privacySections } from "@/features/marketing/legal/legal-content"

export function PrivacyPage() {
  return (
    <LegalShell title={content.legal.privacyTitle} sections={privacySections} />
  )
}
