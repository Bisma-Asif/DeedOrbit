import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { SessionProvider } from "./features/auth/session-provider"
import { MediaConfigProvider } from "./features/marketing/media-config"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Sits above the router so every screen can read grants and swap tenant. */}
    <MediaConfigProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MediaConfigProvider>
  </React.StrictMode>,
)
