"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

/**
 * Client tab-switcher for the environment marketplace. The two grids are rendered on the SERVER
 * (EnvGallery) and passed in as nodes — this component only owns the active-tab state. Workspaces
 * is the default tab.
 */
export default function EnvTabs({
  workspaces,
  playbooks,
}: {
  workspaces: React.ReactNode;
  playbooks: React.ReactNode;
}) {
  return (
    <Tabs defaultValue="workspaces" data-testid="env-gallery">
      <TabsList>
        <TabsTrigger value="workspaces">Workspaces</TabsTrigger>
        <TabsTrigger value="playbooks">Playbooks</TabsTrigger>
      </TabsList>
      <TabsContent value="workspaces" className="pt-5">
        {workspaces}
      </TabsContent>
      <TabsContent value="playbooks" className="pt-5">
        {playbooks}
      </TabsContent>
    </Tabs>
  );
}
