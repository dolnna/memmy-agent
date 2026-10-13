import { Activity, useEffect, useState, type ReactNode } from "react";

/** Keep a visited workspace's local state, optionally leaving live work active while hidden. */
export function RetainedRoute(props: { active: boolean; children: ReactNode; preserveEffects?: boolean }) {
  const [visited, setVisited] = useState(props.active);
  useEffect(() => {
    if (props.active) setVisited(true);
  }, [props.active]);
  if (!props.active && !visited) return null;
  if (props.preserveEffects !== undefined) {
    return (
      <div style={{ display: props.active ? "contents" : "none" }}>
        <Activity mode={props.active || props.preserveEffects ? "visible" : "hidden"}>{props.children}</Activity>
      </div>
    );
  }
  return <Activity mode={props.active ? "visible" : "hidden"}>{props.children}</Activity>;
}
