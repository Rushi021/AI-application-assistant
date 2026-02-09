import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { initAuthState } from "./store";

// Initialise auth state from storage before rendering
initAuthState();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
