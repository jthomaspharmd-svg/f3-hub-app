import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import EventPlannerMock from "./components/EventPlannerMock";
import "./index.css";
import { AoProvider } from "./ao/AoContext";
import { PaxDirectoryProvider } from "./pax/PaxDirectoryContext";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const isEventPlannerRoute =
  window.location.pathname === "/event-planner" ||
  (import.meta.env.DEV && window.location.pathname === "/__mock/event-planner");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <AoProvider>
      <PaxDirectoryProvider>
        {isEventPlannerRoute ? <EventPlannerMock /> : <App />}
      </PaxDirectoryProvider>
    </AoProvider>
  </React.StrictMode>
);
