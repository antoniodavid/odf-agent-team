export interface DependencyProbe {
  engram_cli: "available" | "missing"
  codegraph_cli: "available" | "missing"
  git: "available" | "missing"
  node: "available" | "missing"
  docker: "available" | "missing"
  python3: "available" | "missing"
}
export function dependencyProbe(): DependencyProbe
