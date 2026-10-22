import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/api";
import { App } from "./App";
import { Popout } from "./Popout";
import "./styles/app.css";

/* A pop-out window loads this same page with #popout/<kind>/<id>. */
const popout = /^#popout\/(dm|channel|thread|deal|lesson|settings|huddle)\/(.+)$/.exec(location.hash);
if (popout) document.documentElement.classList.add("is-popout");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {popout ? <Popout kind={popout[1]} id={decodeURIComponent(popout[2])} /> : <App />}
    </QueryClientProvider>
  </StrictMode>,
);
