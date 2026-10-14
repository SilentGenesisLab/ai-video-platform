"use client";

import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";

export default function ExpandingTextarea({
  expanded,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { expanded: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!expanded) {
      element.style.height = "";
      return;
    }
    const resize = () => {
      element.style.height = "auto";
      const style = getComputedStyle(element);
      const border =
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      element.style.height = `${element.scrollHeight + border}px`;
    };
    resize();
    // Height changes must not trigger repeated resizing; only observe width.
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const nextWidth = element.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        resize();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, props.value]);

  return (
    <textarea
      {...props}
      ref={ref}
      data-expanded={expanded}
      style={{
        ...props.style,
        ...(expanded ? { overflowY: "hidden", resize: "none" } : {}),
      }}
    />
  );
}
