import { MixedModePage } from "../mixed-page";

export default async function RushPage({ searchParams }: PageProps<"/train/rush">) {
  const { tc } = await searchParams;
  return <MixedModePage mode="rush" tc={typeof tc === "string" ? tc : undefined} />;
}
