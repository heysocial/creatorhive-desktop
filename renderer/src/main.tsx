import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/api";
import { App } from "./App";
import { ErrorBoundary, installErrorReporting, onUncaughtError } from "./lib/errors";
import "./styles/app.css";

// Errors in this window go to Admin → Bugs (lib/errors.tsx), the sign-in screen's included.
installErrorReporting();

createRoot(document.getElementById("root")!, { onUncaughtError }).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
