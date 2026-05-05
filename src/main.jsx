import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./lib/storage.js"; // installs window.storage shim
import HotelOps from "../HotelOps.jsx";
import { ToastProvider } from "./lib/toast.jsx";
import { CommandPalette } from "./lib/CommandPalette.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <HotelOps />
      <CommandPalette />
    </ToastProvider>
  </React.StrictMode>
);
