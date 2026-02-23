import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css"; // ✅ IMPORTANT: loads Tailwind/build CSS

// ✅ AO Provider (new)
import { AoProvider } from "./ao/AoContext";
import { PaxDirectoryProvider } from "./pax/PaxDirectoryContext";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AoProvider>
      <PaxDirectoryProvider>
        <App />
      </PaxDirectoryProvider>
    </AoProvider>
  </React.StrictMode>
);
