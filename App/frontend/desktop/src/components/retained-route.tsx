import { Activity, useEffect, useState, type ReactNode } from "react";

/** Keep a visited workspace's local state while suspending its hidden effects. */
export function RetainedRoute(props: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(props.active);
  useEffect(() => {
    if (props.active) setVisited(true);
  }, [props.active]);
  if (!props.active && !visited) return null;
  return <Activity mode={props.active ? "visible" : "hidden"}>{props.children}</Activity>;
}
