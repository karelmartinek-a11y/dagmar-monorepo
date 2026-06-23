import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";
import AppShell from "./layout/AppShell";
import IntroGate from "./layout/IntroGate";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <IntroGate>
      <BrowserRouter>
        <AppShell>
          <App />
        </AppShell>
      </BrowserRouter>
    </IntroGate>
  </React.StrictMode>
);
