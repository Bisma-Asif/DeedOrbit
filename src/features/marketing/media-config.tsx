import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"

import { content } from "@/features/marketing/content"

import { api } from "@/lib/api"

import type { LandingMediaConfig } from "@shared/media"

const MediaConfigContext = createContext<LandingMediaConfig>(content.media)

export function MediaConfigProvider({ children }: { children: ReactNode }) {
  const [media, setMedia] = useState(content.media)

  const refresh = useCallback(async () => {
    try {
      const result = await api.get<{ media: LandingMediaConfig | null }>(
        "/api/media/config",
      )

      if (result.media) setMedia(result.media)
    } catch (error) {
      console.error(
        "[media] Could not load the saved media configuration.",
        error,
      )
    }
  }, [])

  useEffect(() => {
    void refresh()

    window.addEventListener("media-config-changed", refresh)

    return () => window.removeEventListener("media-config-changed", refresh)
  }, [refresh])

  return (
    <MediaConfigContext.Provider value={media}>
      {children}
    </MediaConfigContext.Provider>
  )
}

export function useMarketingMedia(): LandingMediaConfig {
  return useContext(MediaConfigContext)
}
