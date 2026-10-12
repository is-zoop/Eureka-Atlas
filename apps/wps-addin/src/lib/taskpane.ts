import type { WpsApplication, WpsTaskPane } from "./host.ts";

export function createPaneController() {
  let pane: WpsTaskPane | null = null;
  return (app: WpsApplication, baseUrl: string) => {
    if (!pane) {
      const created = app.CreateTaskPane(new URL("taskpane.html", baseUrl).href);
      created.DockPosition = 2; // msoCTPDockPositionRight, per the official ET template.
      created.Width = 360;
      pane = created;
    }
    pane.Visible = true;
  };
}
