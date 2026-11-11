export interface MediaSlotDefinition {
  key: string

  label: string

  type: "photo" | "video"

  fileName: string

  queries: string[]

  optional?: boolean

  category?: string
}

export interface StoredMediaAsset {
  slot: string

  fileName: string

  sourceUrl: string

  contributor: string

  licenseNote: string

  provider: "Pexels" | "Pixabay"

  candidateId: string

  alt: string

  selectedAt: string
}

export interface LandingMediaConfig {
  ogImage: string

  heroVideo: string

  heroVideoWebm: string

  heroPoster: string

  loginSide: string

  gallery: Record<string, string>

  clips: Record<string, string>

  clipWebm: Record<string, string>

  clipPosters: Record<string, string>

  features: Record<string, string>
}

export interface MediaManifest {
  version: 1

  updatedAt: string

  assets: Record<string, StoredMediaAsset>

  media: LandingMediaConfig
}

export const MEDIA_SLOTS: MediaSlotDefinition[] = [
  {
    key: "og-base",

    label: "Open Graph / hero photo",

    type: "photo",

    fileName: "og-base.jpg",

    queries: [
      "aerial residential community modern architecture",

      "modern residential community exterior",

      "real estate residential buildings landscape",
    ],
  },

  {
    key: "hero",

    label: "Hero video",

    type: "video",

    fileName: "hero.mp4",

    queries: [
      "aerial residential community",

      "drone modern houses",

      "aerial apartment buildings",

      "real estate drone",
    ],
  },

  {
    key: "gallery:plots",

    label: "Plots / land",

    type: "photo",

    fileName: "plots-1.jpg",

    category: "plots",

    queries: ["empty land plot", "residential plot", "vacant land aerial"],
  },

  {
    key: "gallery:houses",

    label: "Houses",

    type: "photo",

    fileName: "houses-1.jpg",

    category: "houses",

    queries: ["modern house exterior", "contemporary residential homes"],
  },

  {
    key: "gallery:apartments",

    label: "Apartments",

    type: "photo",

    fileName: "apartments-1.jpg",

    category: "apartments",

    queries: ["apartment building exterior", "modern residential tower"],
  },

  {
    key: "gallery:shops",

    label: "Shops / market",

    type: "photo",

    fileName: "shops-1.jpg",

    category: "shops",

    queries: ["shopping plaza exterior", "modern retail storefronts"],
  },

  {
    key: "gallery:penthouse",

    label: "Penthouse / luxury interior",

    type: "photo",

    fileName: "penthouse-1.jpg",

    category: "penthouse",

    queries: ["luxury penthouse interior", "modern luxury apartment interior"],
  },

  {
    key: "gallery:towers",

    label: "Towers",

    type: "photo",

    fileName: "towers-1.jpg",

    category: "towers",

    queries: ["commercial tower exterior", "modern office tower architecture"],
  },

  {
    key: "gallery:commercial",

    label: "Commercial plaza / tower",

    type: "photo",

    fileName: "commercial-1.jpg",

    category: "commercial",

    queries: ["commercial plaza exterior", "modern commercial building"],
  },

  {
    key: "gallery:construction",

    label: "Construction progress",

    type: "photo",

    fileName: "construction-1.jpg",

    category: "construction",

    queries: ["construction site aerial", "building construction progress"],
  },

  {
    key: "clip:plots",

    label: "Plots / land clip",

    type: "video",

    fileName: "plots-clip.mp4",

    category: "plots",

    optional: true,

    queries: ["empty land plot drone", "residential land aerial"],
  },

  {
    key: "clip:houses",

    label: "Houses clip",

    type: "video",

    fileName: "houses-clip.mp4",

    category: "houses",

    optional: true,

    queries: ["modern house exterior", "residential houses drone"],
  },

  {
    key: "clip:apartments",

    label: "Apartments clip",

    type: "video",

    fileName: "apartments-clip.mp4",

    category: "apartments",

    optional: true,

    queries: ["apartment building aerial", "modern apartment exterior"],
  },

  {
    key: "clip:shops",

    label: "Shops / market clip",

    type: "video",

    fileName: "shops-clip.mp4",

    category: "shops",

    optional: true,

    queries: ["shopping plaza exterior", "modern retail stores"],
  },

  {
    key: "clip:towers",

    label: "Towers clip",

    type: "video",

    fileName: "towers-clip.mp4",

    category: "towers",

    optional: true,

    queries: ["commercial tower drone", "modern office tower exterior"],
  },

  {
    key: "clip:penthouse",

    label: "Penthouse / luxury interior clip",

    type: "video",

    fileName: "penthouse-clip.mp4",

    category: "penthouse",

    optional: true,

    queries: ["luxury penthouse interior", "modern luxury apartment interior"],
  },

  {
    key: "clip:commercial",

    label: "Commercial plaza / tower clip",

    type: "video",

    fileName: "commercial-clip.mp4",

    category: "commercial",

    optional: true,

    queries: ["commercial plaza drone", "modern office tower exterior"],
  },

  {
    key: "clip:construction",

    label: "Construction progress clip",

    type: "video",

    fileName: "construction-clip.mp4",

    category: "construction",

    optional: true,

    queries: ["construction site drone", "building construction progress"],
  },

  {
    key: "auth",

    label: "Login / signup side image",

    type: "photo",

    fileName: "login-side.jpg",

    queries: ["elegant modern house exterior", "modern architecture exterior"],
  },

  {
    key: "feature:facade",

    label: "Feature image — modern building facade",

    type: "photo",

    fileName: "feature-facade.jpg",

    queries: ["modern building facade", "contemporary architecture exterior"],
  },

  {
    key: "feature:blueprints",

    label: "Feature image — architect blueprint on desk",

    type: "photo",

    fileName: "feature-blueprints.jpg",

    queries: ["architect blueprint desk no people", "architectural plans desk"],
  },

  {
    key: "feature:keys",

    label: "Feature image — keys and house model",

    type: "photo",

    fileName: "feature-keys.jpg",

    queries: ["house keys miniature home model", "keys house model desk"],
  },
]

export const INITIAL_LANDING_MEDIA: LandingMediaConfig = {
  ogImage: "/media/willian-reis-GGLY--ZLZdU-unsplash.jpg",

  heroVideo: "/media/backgorund.mp4",

  heroVideoWebm: "",

  heroPoster: "/media/willian-reis-GGLY--ZLZdU-unsplash.jpg",

  loginSide: "/media/virender-singh-Zi7xTWDoiic-unsplash.jpg",

  gallery: {
    plots:
      "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80",

    houses:
      "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80",

    apartments:
      "https://images.unsplash.com/photo-1460317442991-0ec209397118?auto=format&fit=crop&w=1200&q=80",

    shops:
      "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80",

    towers:
      "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1200&q=80",

    commercial:
      "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",

    penthouse:
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",

    construction:
      "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=80",
  },

  clips: {
    plots: "",

    houses: "",

    apartments: "",

    shops: "",

    towers: "",

    commercial: "",

    penthouse: "",

    construction: "",
  },

  clipWebm: {
    plots: "",

    houses: "",

    apartments: "",

    shops: "",

    towers: "",

    commercial: "",

    penthouse: "",

    construction: "",
  },

  clipPosters: {
    plots: "",

    houses: "",

    apartments: "",

    shops: "",

    towers: "",

    commercial: "",

    penthouse: "",

    construction: "",
  },

  features: {
    facade: "/media/willian-reis-GGLY--ZLZdU-unsplash.jpg",

    blueprints: "/media/frames-for-your-heart-2d4lAQAlbDA-unsplash.jpg",

    keys: "/media/salman-saqib-WaC-JFfF21M-unsplash.jpg",
  },
}
