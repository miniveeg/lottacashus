import { ChevronLeft, ChevronRight, MessageSquare, PanelLeft } from "lucide-react";
import { motion } from "framer-motion";
import { useSidebar } from "../../contexts/SidebarContext";
import { SidebarChat } from "./SidebarChat";
import { SidebarNav } from "./SidebarNav";
import "./Sidebar.css";

export function Sidebar() {
  const { isChatMode, toggleMode, collapsed, toggleCollapsed } = useSidebar();

  return (
    <aside
      className={`sidebar${isChatMode ? " sidebar--chat" : ""}${collapsed ? " sidebar--collapsed" : ""}`}
      aria-label={isChatMode ? "Live chat" : undefined}
    >
      <div className="sidebar__header">
        <motion.button
          type="button"
          className="sidebar__collapse-btn"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
        </motion.button>
      </div>

      <div className="sidebar__body">{isChatMode ? <SidebarChat /> : <SidebarNav />}</div>

      <div className="sidebar__footer">
        <motion.button
          type="button"
          className="sidebar__mode-btn"
          onClick={toggleMode}
          aria-label={isChatMode ? "Switch to sidebar navigation" : "Switch to live chat"}
          whileHover={{ y: -2, boxShadow: "0 6px 28px var(--lc-crimson-glow)" }}
          whileTap={{ scale: 0.98 }}
        >
          {isChatMode ? <PanelLeft size={16} aria-hidden="true" /> : <MessageSquare size={16} aria-hidden="true" />}
          <span className="sidebar__mode-btn-label">
            {isChatMode ? "Navigation" : "Live Chat"}
          </span>
        </motion.button>
      </div>
    </aside>
  );
}
