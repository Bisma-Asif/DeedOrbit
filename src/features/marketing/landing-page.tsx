import { useState } from "react"

import { useEffect } from "react"

import { content } from "@/features/marketing/content"

import { useMarketingMedia } from "@/features/marketing/media-config"

import {
  MarketingLangProvider,
  useMarketingLang,
} from "@/features/marketing/i18n"

import { Navbar } from "@/features/marketing/navbar"

import { Hero } from "@/features/marketing/hero"

import { TrustStrip } from "@/features/marketing/trust-strip"

import { ProblemSolution } from "@/features/marketing/problem"

import { Features } from "@/features/marketing/features"

import { DashboardPreview } from "@/features/marketing/dashboard-preview"

import { Gallery } from "@/features/marketing/gallery"

import { HowItWorks } from "@/features/marketing/how-it-works"

import { Numbers } from "@/features/marketing/numbers"

import { Pricing } from "@/features/marketing/pricing"

import { Testimonials } from "@/features/marketing/testimonials"

import { Faq } from "@/features/marketing/faq"

import { CtaBand } from "@/features/marketing/cta-band"

import { Footer } from "@/features/marketing/footer"

import { CookieNotice } from "@/features/marketing/cookie-notice"

import { DemoModal } from "@/features/marketing/demo-modal"

import { cn } from "@/lib/utils"

/**
 * The public marketing home ("/"). It owns the language provider, the shared
 * "Book a Demo" modal state, and the ordering of every section from the brief.
 * Nothing here reaches into the authenticated app — this is a separate route tree.
 */

function LandingInner() {
  const { lang, t } = useMarketingLang()

  const media = useMarketingMedia()

  const [demoOpen, setDemoOpen] = useState(false)

  const openDemo = () => setDemoOpen(true)

  useEffect(() => {
    const title = t(content.site.title)

    const description = t(content.site.description)

    document.title = title

    const setMeta = (
      selector: string,

      attribute: "name" | "property",

      key: string,

      value: string,
    ) => {
      let tag = document.head.querySelector<HTMLMetaElement>(selector)

      if (!tag) {
        tag = document.createElement("meta")

        tag.setAttribute(attribute, key)

        document.head.append(tag)
      }

      tag.content = value
    }

    setMeta('meta[name="description"]', "name", "description", description)

    setMeta('meta[property="og:title"]', "property", "og:title", title)

    setMeta(
      'meta[property="og:description"]',

      "property",

      "og:description",

      description,
    )

    setMeta('meta[property="og:image"]', "property", "og:image", media.ogImage)

    setMeta('meta[name="twitter:title"]', "name", "twitter:title", title)

    setMeta(
      'meta[name="twitter:description"]',

      "name",

      "twitter:description",

      description,
    )

    setMeta(
      'meta[name="twitter:image"]',
      "name",
      "twitter:image",
      media.ogImage,
    )
  }, [media.ogImage, t])

  return (
    <div
      className={cn(
        "min-h-screen bg-background text-foreground antialiased",

        lang === "ur" && "mk-rtl",
      )}
    >
      <Navbar />
      <main>
        <Hero onBookDemo={openDemo} />
        <TrustStrip />
        <ProblemSolution />
        <Features />
        <DashboardPreview />
        <Gallery />
        <HowItWorks />
        <Numbers />
        <Pricing onBookDemo={openDemo} />
        <Testimonials />
        <Faq />
        <CtaBand onBookDemo={openDemo} />
      </main>
      {/* Scroll target for the "Contact" nav item; the footer carries the details. */}
      <div id="contact" className="scroll-mt-20" />
      <Footer onBookDemo={openDemo} />
      <CookieNotice />
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  )
}

export default function LandingPage() {
  return (
    <MarketingLangProvider>
      <LandingInner />
    </MarketingLangProvider>
  )
}
