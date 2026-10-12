"use client";
import { useEffect } from "react";
export default function ThemePreferences() {
  useEffect(() => {
    const theme = localStorage.getItem("frameflow-studio-theme");
    document.documentElement.dataset.studioTheme =
      theme === "dark" ? "dark" : "light";
  }, []);
  return null;
}
