export function isLiveConfigView(search: string): boolean {
  return new URLSearchParams(search).get("view") === "live-config";
}
