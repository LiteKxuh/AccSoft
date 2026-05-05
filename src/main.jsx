import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./lib/storage.js"; // installs window.storage shim
import HotelOps from "../HotelOps.jsx";
import { ToastProvider } from "./lib/toast.jsx";
import { CommandPalette } from "./lib/CommandPalette.jsx";

function paintFatal(title, detail) {
  const el = document.getElementById("root") || document.body;
  el.innerHTML = `
    <div style="font:14px/1.5 system-ui,sans-serif;color:#fff;background:#7f1d1d;padding:24px;height:100vh;overflow:auto;white-space:pre-wrap;">
      <div style="font-size:18px;font-weight:600;margin-bottom:12px;">HotelOps · render error</div>
      <div style="font-weight:600;margin-bottom:8px;">${title}</div>
      <div style="font-family:ui-monospace,Consolas,monospace;font-size:12px;background:#450a0a;padding:12px;border-radius:6px;">${detail || ""}</div>
    </div>`;
}

class StartupBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("StartupBoundary caught:", err, info); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ font: "14px/1.5 system-ui,sans-serif", color: "#fff", background: "#7f1d1d", padding: 24, height: "100vh", overflow: "auto", whiteSpace: "pre-wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>HotelOps · component crash</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{this.state.err.message}</div>
          <pre style={{ fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12, background: "#450a0a", padding: 12, borderRadius: 6 }}>{this.state.err.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element missing from index.html");
  ReactDOM.createRoot(rootEl).render(
    <StartupBoundary>
      <ToastProvider>
        <HotelOps />
        <CommandPalette />
      </ToastProvider>
    </StartupBoundary>
  );
} catch (err) {
  console.error("Bootstrap failure:", err);
  paintFatal(err?.message || "Bootstrap failure", err?.stack || String(err));
}
